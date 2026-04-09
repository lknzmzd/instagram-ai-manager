import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateBatch } from "@/lib/generateBatch";

export async function POST() {
  try {
    const { data: page } = await supabaseAdmin
      .from("pages")
      .select("*")
      .eq("slug", "mortaena")
      .single();

    const items = await generateBatch({
      page,
      count: 21,
      goal: "growth",
      recentConcepts: []
    });

    const now = new Date();
    const scheduleHours = [9, 12, 18];

    const rows = items.map((item, i) => {
      const dayOffset = Math.floor(i / 3);
      const hour = scheduleHours[i % 3];

      const scheduled = new Date(now);
      scheduled.setDate(now.getDate() + dayOffset);
      scheduled.setHours(hour, 0, 0, 0);

      return {
        page_id: page.id,
        status: "approved",
        prompt_status: "approved",
        automation_status: "pending",
        scheduled_for: scheduled.toISOString(),

        post_type: item.post_type,
        concept_title: item.concept_title,
        visual_brief: item.visual_brief,
        on_image_text: item.on_image_text,
        caption: item.caption,
        hashtags: item.hashtags
      };
    });

    await supabaseAdmin.from("content_items").insert(rows);

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: "Weekly generation failed" }, { status: 500 });
  }
}