import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runPublishFlow } from "@/lib/instagram/publishFlow";

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

    const now = new Date().toISOString();

    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .neq("publish_status", "published")
      .not("public_image_url", "is", null)
      .or(`next_run_at.is.null,next_run_at.lte.${now}`)
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
        version: "V5_DIRECT_FLOW",
        reason: "No publish-ready item found"
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

    try {
      const result = await runPublishFlow(item, supabaseAdmin);

      return NextResponse.json({
        success: true,
        version: "V5_DIRECT_FLOW",
        item_id: item.id,
        result
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown publish flow error";

      await supabaseAdmin
        .from("content_items")
        .update({
          workflow_state: "failed",
          queue_status: "failed",
          last_error: message,
          retry_count: Number(item.retry_count ?? 0) + 1,
          next_run_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id);

      return NextResponse.json(
        {
          success: false,
          version: "V5_DIRECT_FLOW",
          item_id: item.id,
          error: message
        },
        { status: 500 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        version: "V5_DIRECT_FLOW",
        error: err instanceof Error ? err.message : "Unknown worker error"
      },
      { status: 500 }
    );
  }
}