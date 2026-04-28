import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runPublishFlow } from "@/lib/instagram/publishFlow";

export async function POST(req: Request) {
  let contentItemId: string | null = null;

  try {
    const { id } = await req.json();

    contentItemId = id ?? null;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing id" },
        { status: 400 }
      );
    }

    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !item) {
      return NextResponse.json(
        { success: false, item_id: id, error: "Item not found" },
        { status: 404 }
      );
    }

    if (item.publish_status === "published") {
      return NextResponse.json({
        success: true,
        item_id: id,
        skipped: true,
        reason: "Already published"
      });
    }

    if (!item.public_image_url) {
      const message = "Missing public_image_url";

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
        .eq("id", id);

      return NextResponse.json(
        { success: false, item_id: id, error: message },
        { status: 400 }
      );
    }

    await supabaseAdmin
      .from("content_items")
      .update({
        queue_status: "processing",
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    try {
      const result = await runPublishFlow(item, supabaseAdmin);

      const queueStatus =
        result.step === "published"
          ? "posted"
          : result.step === "waiting_container"
            ? "waiting"
            : "processing";

      await supabaseAdmin
        .from("content_items")
        .update({
          queue_status: queueStatus,
          last_error: null,
          next_run_at:
            result.step === "waiting_container"
              ? new Date(Date.now() + 60 * 1000).toISOString()
              : null,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      return NextResponse.json({
        success: true,
        item_id: id,
        result
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown publish error";

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
        .eq("id", id);

      return NextResponse.json(
        {
          success: false,
          item_id: id,
          error: message
        },
        { status: 500 }
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (contentItemId) {
      await supabaseAdmin
        .from("content_items")
        .update({
          workflow_state: "failed",
          queue_status: "failed",
          last_error: message,
          updated_at: new Date().toISOString()
        })
        .eq("id", contentItemId);
    }

    return NextResponse.json(
      {
        success: false,
        item_id: contentItemId,
        error: message
      },
      { status: 500 }
    );
  }
}