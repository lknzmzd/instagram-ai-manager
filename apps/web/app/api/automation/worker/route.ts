import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .neq("publish_status", "published")
      .not("public_image_url", "is", null)
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
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
        version: "V4_FIRE_AND_FORGET",
        reason: "No publish-ready item found"
      });
    }

    const origin = new URL(req.url).origin;

    await supabaseAdmin
      .from("content_items")
      .update({
        queue_status: "processing",
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.id);

    // Fire-and-forget: do NOT await the publish response.
    // This prevents Cloudflare 522 timeout from the worker route.
    fetch(`${origin}/api/content/publish-instagram`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: item.id,
        scheduled_run: true,
        debug: true
      }),
      cache: "no-store"
    }).catch(async (err) => {
      await supabaseAdmin
        .from("content_items")
        .update({
          queue_status: "failed",
          workflow_state: "failed",
          last_error:
            err instanceof Error ? err.message : "Fire-and-forget publish failed",
          retry_count: Number(item.retry_count ?? 0) + 1,
          next_run_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id);
    });

    return NextResponse.json({
      success: true,
      version: "V4_FIRE_AND_FORGET",
      step: "publish_triggered",
      item_id: item.id
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        version: "V4_FIRE_AND_FORGET",
        error: err instanceof Error ? err.message : "Unknown worker error"
      },
      { status: 500 }
    );
  }
}