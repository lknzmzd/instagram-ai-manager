import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const ALLOWED_LOCAL_HOURS = new Set([9, 12, 18]);
const TIMEZONE = "Europe/Berlin";

function isAuthorized(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) return false;

  return authHeader === `Bearer ${cronSecret}`;
}

function getBerlinNowParts(date = new Date()) {
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

  return { res, data };
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const berlin = getBerlinNowParts(now);

    if (!ALLOWED_LOCAL_HOURS.has(berlin.hour)) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "Current Berlin hour is not a publish slot",
        berlin_time: berlin
      });
    }

    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("queue_status", "ready")
      .neq("publish_status", "published")
      .not("scheduled_for", "is", null)
      .lte("scheduled_for", now.toISOString())
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
        reason: "No ready scheduled post found",
        berlin_time: berlin
      });
    }

    const processingAt = new Date().toISOString();

    await supabaseAdmin
      .from("content_items")
      .update({
        queue_status: "processing",
        updated_at: processingAt
      })
      .eq("id", item.id);

    // Step 1: generate image if missing
    if (!item.generated_image_url) {
      const generated = await callInternalJson(
        req,
        "/api/content/generate-image",
        {
          id: item.id
        }
      );

      if (!generated.res.ok) {
        await supabaseAdmin
          .from("content_items")
          .update({
            queue_status: "failed",
            updated_at: new Date().toISOString()
          })
          .eq("id", item.id);

        return NextResponse.json(
          {
            success: false,
            step: "generate_image",
            error: generated.data?.error || "Failed to generate image",
            item_id: item.id,
            meta: generated.data
          },
          { status: 500 }
        );
      }
    }

    // Step 2: upload to storage if missing
    const { data: afterGenerate } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("id", item.id)
      .single();

    if (!afterGenerate?.public_image_url) {
      const uploaded = await callInternalJson(
        req,
        "/api/content/upload-to-storage",
        {
          id: item.id,
          scheduled_run: true
        }
      );

      if (!uploaded.res.ok) {
        await supabaseAdmin
          .from("content_items")
          .update({
            queue_status: "failed",
            updated_at: new Date().toISOString()
          })
          .eq("id", item.id);

        return NextResponse.json(
          {
            success: false,
            step: "upload_to_storage",
            error: uploaded.data?.error || "Failed to upload to storage",
            item_id: item.id,
            meta: uploaded.data
          },
          { status: 500 }
        );
      }
    }

    // Step 3: publish to Instagram
    const published = await callInternalJson(
      req,
      "/api/content/publish-instagram",
      {
        id: item.id,
        scheduled_run: true
      }
    );

    if (!published.res.ok) {
      await supabaseAdmin
        .from("content_items")
        .update({
          queue_status: "failed",
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id);

      return NextResponse.json(
        {
          success: false,
          step: "publish_instagram",
          error: published.data?.error || "Failed to publish to Instagram",
          item_id: item.id,
          meta: published.data
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      scheduled: true,
      item_id: item.id,
      scheduled_for: item.scheduled_for,
      publish_result: published.data,
      berlin_time: berlin
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown scheduled automation error"
      },
      { status: 500 }
    );
  }
}