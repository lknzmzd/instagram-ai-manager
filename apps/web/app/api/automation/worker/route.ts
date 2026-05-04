import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runPublishFlow } from "@/lib/instagram/publishFlow";

const VERSION = "V7_1_DUE_SCHEDULE_WORKER";
const MAX_RETRIES = 5;
const DEFAULT_MIN_POST_GAP_MINUTES = 300; // 5 hours: allows 09:00, 15:00, 21:00 without bursts.
const OPERATIONAL_START_MINUTE = 8 * 60 + 45; // 08:45 Berlin
const OPERATIONAL_END_MINUTE = 21 * 60 + 30; // 21:30 Berlin

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const urlSecret = req.nextUrl.searchParams.get("secret");

  return (
    !!cronSecret &&
    (authHeader === `Bearer ${cronSecret}` || urlSecret === cronSecret)
  );
}

function getBerlinTimeHHMM(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function getBerlinMinuteOfDay(date: Date) {
  const [hour, minute] = getBerlinTimeHHMM(date).split(":").map(Number);
  return hour * 60 + minute;
}

function isOperationalWindow(date: Date) {
  const minuteOfDay = getBerlinMinuteOfDay(date);
  return (
    minuteOfDay >= OPERATIONAL_START_MINUTE &&
    minuteOfDay <= OPERATIONAL_END_MINUTE
  );
}

function getMinPostGapMinutes() {
  const raw = process.env.MIN_POST_GAP_MINUTES;
  const parsed = raw ? Number(raw) : DEFAULT_MIN_POST_GAP_MINUTES;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_MIN_POST_GAP_MINUTES;
  }

  return parsed;
}

function isForce(req: NextRequest) {
  const value = req.nextUrl.searchParams.get("force");
  return value === "1" || value === "true" || value === "yes";
}

async function callInternalJson(
  req: NextRequest,
  path: string,
  payload: Record<string, unknown>
) {
  const origin = new URL(req.url).origin;

  const res = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  const raw = await res.text();

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }

  return {
    ok: res.ok,
    status: res.status,
    data
  };
}

async function getDueItem(nowIso: string) {
  return supabaseAdmin
    .from("content_items")
    .select("*")
    .eq("status", "approved")
    .eq("prompt_status", "approved")
    .neq("publish_status", "published")
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", nowIso)
    .not("queue_status", "eq", "posted")
    .not("queue_status", "eq", "permanently_failed")
    .not("queue_status", "eq", "skipped")
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
    .order("scheduled_for", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
}

async function getRecentPublishedItem(now: Date, gapMinutes: number) {
  const sinceIso = new Date(now.getTime() - gapMinutes * 60 * 1000).toISOString();

  return supabaseAdmin
    .from("content_items")
    .select("id, concept_title, published_at, instagram_media_id")
    .eq("publish_status", "published")
    .not("published_at", "is", null)
    .gte("published_at", sinceIso)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

async function markPermanentFailure(item: any, message: string) {
  await supabaseAdmin
    .from("content_items")
    .update({
      workflow_state: "permanently_failed",
      queue_status: "permanently_failed",
      last_error: message,
      updated_at: new Date().toISOString()
    })
    .eq("id", item.id);
}

async function markRetryFailure(item: any, message: string) {
  const retryCount = Number(item.retry_count ?? 0) + 1;

  await supabaseAdmin
    .from("content_items")
    .update({
      workflow_state: "failed",
      queue_status: retryCount >= MAX_RETRIES ? "permanently_failed" : "failed",
      last_error: message,
      retry_count: retryCount,
      next_run_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", item.id);
}

async function handle(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, version: VERSION, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const berlinTime = getBerlinTimeHHMM(nowDate);
    const force = isForce(req);
    const minPostGapMinutes = getMinPostGapMinutes();

    const { data: item, error } = await getDueItem(nowIso);

    if (error) {
      return NextResponse.json(
        {
          success: false,
          version: VERSION,
          error: error.message
        },
        { status: 500 }
      );
    }

    if (!item) {
      return NextResponse.json({
        success: true,
        skipped: true,
        version: VERSION,
        reason: "No due item found",
        berlin_time: berlinTime,
        now: nowIso,
        mode: force ? "force" : "scheduled"
      });
    }

    if (!force && !isOperationalWindow(nowDate)) {
      return NextResponse.json({
        success: true,
        skipped: true,
        version: VERSION,
        item_id: item.id,
        concept_title: item.concept_title,
        reason: "Due item exists, but current Berlin time is outside operational window",
        berlin_time: berlinTime,
        operational_window: "08:45-21:30 Europe/Berlin",
        scheduled_for: item.scheduled_for
      });
    }

    if (!force && minPostGapMinutes > 0) {
      const { data: recent, error: recentError } = await getRecentPublishedItem(
        nowDate,
        minPostGapMinutes
      );

      if (recentError) {
        return NextResponse.json(
          {
            success: false,
            version: VERSION,
            error: recentError.message
          },
          { status: 500 }
        );
      }

      if (recent) {
        return NextResponse.json({
          success: true,
          skipped: true,
          version: VERSION,
          reason: "Recent post already published; skipping to prevent burst posting",
          berlin_time: berlinTime,
          min_post_gap_minutes: minPostGapMinutes,
          recent_post: recent,
          next_due_item: {
            id: item.id,
            concept_title: item.concept_title,
            scheduled_for: item.scheduled_for
          }
        });
      }
    }

    const retryCount = Number(item.retry_count ?? 0);

    if (retryCount >= MAX_RETRIES) {
      await markPermanentFailure(item, item.last_error || "Retry limit reached");

      return NextResponse.json({
        success: true,
        skipped: true,
        version: VERSION,
        item_id: item.id,
        reason: "Retry limit reached"
      });
    }

    await supabaseAdmin
      .from("content_items")
      .update({
        queue_status: "processing",
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.id);

    let current = item;

    if (!current.public_image_url) {
      const generated = await callInternalJson(req, "/api/content/generate-image", {
        id: current.id
      });

      if (!generated.ok) {
        const msg =
          generated.data?.error ||
          generated.data?.raw ||
          "Failed to generate image";

        await markRetryFailure(current, String(msg));

        return NextResponse.json(
          {
            success: false,
            version: VERSION,
            step: "generate_image",
            item_id: current.id,
            error: msg,
            meta: generated.data
          },
          { status: 500 }
        );
      }

      const { data: refreshed, error: refreshError } = await supabaseAdmin
        .from("content_items")
        .select("*")
        .eq("id", current.id)
        .single();

      if (refreshError || !refreshed?.public_image_url) {
        const msg = "Image generated but public_image_url is still missing";

        await markRetryFailure(current, msg);

        return NextResponse.json(
          {
            success: false,
            version: VERSION,
            step: "verify_public_image_url",
            item_id: current.id,
            error: msg
          },
          { status: 500 }
        );
      }

      current = refreshed;
    }

    try {
      const result = await runPublishFlow(current, supabaseAdmin);

      return NextResponse.json({
        success: true,
        version: VERSION,
        item_id: current.id,
        concept_title: current.concept_title,
        scheduled_for: current.scheduled_for,
        published: result.step === "published",
        instagramMediaId: result.step === "published" ? result.media_id : null,
        berlin_time: berlinTime,
        mode: force ? "force" : "scheduled",
        result
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown publish flow error";

      await markRetryFailure(current, message);

      return NextResponse.json(
        {
          success: false,
          version: VERSION,
          item_id: current.id,
          concept_title: current.concept_title,
          error: message
        },
        { status: 500 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        version: VERSION,
        error: err instanceof Error ? err.message : "Unknown worker error"
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
