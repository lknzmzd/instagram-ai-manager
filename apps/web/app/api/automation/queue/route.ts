import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_items")
      .select(`
        id,
        concept_title,
        caption,
        status,
        prompt_status,
        queue_status,
        render_status,
        publish_status,
        scheduled_for,
        published_at,
        public_image_url,
        instagram_media_id,
        automation_batch_id,
        created_at
      `)
      .not("scheduled_for", "is", null)
      .order("scheduled_for", { ascending: true })
      .limit(50);

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: error.message
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      queue: data ?? []
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load automation queue"
      },
      { status: 500 }
    );
  }
}