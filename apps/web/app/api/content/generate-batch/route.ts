import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { generateBatch } from "@/lib/generateBatch";

const requestSchema = z.object({
  page_slug: z.string().min(1),
  count: z.number().int().min(1).max(20),
  goal: z.string().min(1)
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = requestSchema.parse(body);

    const { data: page, error: pageError } = await supabaseAdmin
      .from("pages")
      .select("*")
      .eq("slug", parsed.page_slug)
      .single();

    if (pageError || !page) {
      return NextResponse.json(
        { error: "Page not found" },
        { status: 404 }
      );
    }

    const { data: recentRows } = await supabaseAdmin
      .from("content_items")
      .select("concept_title")
      .eq("page_id", page.id)
      .order("created_at", { ascending: false })
      .limit(10);

    const recentConcepts =
      recentRows?.map((row) => row.concept_title).filter(Boolean) ?? [];

    const items = await generateBatch({
      page,
      count: parsed.count,
      goal: parsed.goal,
      recentConcepts
    });

    const rowsToInsert = items.map((item) => ({
      page_id: page.id,
      status: "drafted",
      post_type: item.post_type,
      concept_title: item.concept_title,
      visual_brief: item.visual_brief,
      on_image_text: item.on_image_text,
      caption: item.caption,
      hashtags: item.hashtags,
      voiceover_script: item.voiceover_script,
      created_by: "system"
    }));

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("content_items")
      .insert(rowsToInsert)
      .select("*");

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      items_created: inserted.length,
      items: inserted
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
