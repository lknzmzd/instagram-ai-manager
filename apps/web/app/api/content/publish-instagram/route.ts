import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runPublishFlow } from "@/lib/instagram/publishFlow";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();

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
        { success: false, error: "Item not found" },
        { status: 404 }
      );
    }

    try {
      const result = await runPublishFlow(item, supabaseAdmin);

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
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}