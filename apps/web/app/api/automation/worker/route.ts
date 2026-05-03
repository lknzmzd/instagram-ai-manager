import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runPublishFlow } from "@/lib/instagram/publishFlow";

const VERSION = "V7_SINGLE_PASS_PUBLISHER";
const ALLOWED_SLOTS = ["09:00", "15:00", "21:00"];
const MAX_RETRIES = 5;

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

function isPublishSlot(berlinTime: string) {
  const [nowHour, nowMinute] = berlinTime.split(":").map(Number);
  const nowTotal = nowHour * 60 + nowMinute;

  return ALLOWED_SLOTS.some((slot) => {
    const [slotHour, slotMinute] = slot.split(":").map(Number);
    const slotTotal = slotHour * 60 + slotMinute;

    return nowTotal >= slotTotal && nowTotal < slotTotal + 20;
  });
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

    if (!isPublishSlot(berlinTime)) {
      return NextResponse.json({
        success: true,
        skipped: true,
        version: VERSION,
        reason: "Not a publish slot",
        berlin_time: berlinTime,
        allowed_slots: ALLOWED_SLOTS
      });
    }

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
        reason: "No due publish-ready item found",
        berlin_time: berlinTime
      });
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
        published: result.step === "published",
        instagramMediaId: result.step === "published" ? result.media_id : null,
        berlin_time: berlinTime,
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
