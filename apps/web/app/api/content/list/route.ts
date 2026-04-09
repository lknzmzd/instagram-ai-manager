import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_items")
      .select(`
        id,
        status,
        post_type,
        concept_title,
        visual_brief,
        on_image_text,
        caption,
        hashtags,
        final_media_url,
        render_status,
        publish_status,
        image_prompt,
        prompt_status,
        public_image_url,
        published_at,
        instagram_media_id,
        created_at,
        updated_at
      `)
      .order("created_at", { ascending: false })
      .limit(100);

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
      items: data ?? []
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load content items"
      },
      { status: 500 }
    );
  }
}