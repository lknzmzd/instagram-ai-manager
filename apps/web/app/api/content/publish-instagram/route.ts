import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runPublishFlow } from "@/lib/instagram/publishFlow";
import { logPostResult } from "@/lib/logger";

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
        published: true,
        skipped: true,
        reason: "Already published",
        instagramMediaId: item.instagram_media_id ?? null,
        item
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

    const result = await runPublishFlow(item, supabaseAdmin);

    const { data: refreshed } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("id", id)
      .single();

    return NextResponse.json({
      success: true,
      item_id: id,
      published: result.step === "published",
      instagramMediaId: result.step === "published" ? result.media_id : null,
      result,
      item: refreshed ?? item
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown publish error";

    if (contentItemId) {
      const { data: current } = await supabaseAdmin
        .from("content_items")
        .select("retry_count")
        .eq("id", contentItemId)
        .single();

      await supabaseAdmin
        .from("content_items")
        .update({
          workflow_state: "failed",
          queue_status: "failed",
          last_error: message,
          retry_count: Number(current?.retry_count ?? 0) + 1,
          next_run_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", contentItemId);

      await logPostResult({
        contentItemId,
        status: "failed",
        errorMessage: message
      }).catch(() => null);
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
