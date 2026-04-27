import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const TIMEZONE = "Europe/Berlin";
const ALLOWED_HOURS = new Set([9, 12, 18]);

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (!cronSecret) return false;
  return authHeader === `Bearer ${cronSecret}`;
}

function getBerlinTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
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

async function failItem(id: string, message: string) {
  await supabaseAdmin
    .from("content_items")
    .update({
      queue_status: "failed",
      last_error: message,
      retry_count: 1,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const berlin = getBerlinTime();

    if (!ALLOWED_HOURS.has(berlin.hour)) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "Not a publish slot",
        berlin_time: berlin
      });
    }

    const now = new Date().toISOString();

    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("queue_status", "ready")
      .neq("publish_status", "published")
      .not("scheduled_for", "is", null)
      .lte("scheduled_for", now)
      .order("scheduled_for", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    if (!item) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "No due ready item",
        berlin_time: berlin
      });
    }

    await supabaseAdmin
      .from("content_items")
      .update({
        queue_status: "processing",
        last_error: null,
        updated_at: now
      })
      .eq("id", item.id);

    let current = item;

    if (!current.public_image_url) {
      const generated = await callInternalJson(
        req,
        "/api/content/generate-image",
        { id: current.id }
      );

      if (!generated.ok) {
        const msg =
          generated.data?.error ||
          generated.data?.raw ||
          "Failed to generate image";

        await failItem(current.id, String(msg));

        return NextResponse.json(
          {
            success: false,
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

        await failItem(current.id, msg);

        return NextResponse.json(
          {
            success: false,
            step: "verify_public_image_url",
            item_id: current.id,
            error: msg
          },
          { status: 500 }
        );
      }

      current = refreshed;
    }

    const published = await callInternalJson(
      req,
      "/api/content/publish-instagram",
      {
        id: current.id,
        scheduled_run: true
      }
    );

    if (!published.ok) {
      const msg =
        published.data?.error ||
        published.data?.raw ||
        "Failed to publish to Instagram";

      await failItem(current.id, String(msg));

      return NextResponse.json(
        {
          success: false,
          step: "publish_instagram",
          item_id: current.id,
          error: msg,
          meta: published.data
        },
        { status: 500 }
      );
    }

    const instagramMediaId =
      published.data?.instagramMediaId ||
      published.data?.item?.instagram_media_id ||
      null;

    if (!instagramMediaId) {
      const msg = "Publish returned success but Instagram media ID is missing";

      await failItem(current.id, msg);

      return NextResponse.json(
        {
          success: false,
          step: "verify_instagram_media_id",
          item_id: current.id,
          error: msg,
          meta: published.data
        },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from("content_items")
      .update({
        queue_status: "posted",
        publish_status: "published",
        instagram_media_id: instagramMediaId,
        last_error: null,
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", current.id);

    return NextResponse.json({
      success: true,
      item_id: current.id,
      instagramMediaId,
      berlin_time: berlin,
      result: published.data
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown scheduled automation error"
      },
      { status: 500 }
    );
  }
}