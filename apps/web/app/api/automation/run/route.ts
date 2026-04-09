import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const BASE = process.env.NEXT_PUBLIC_APP_URL;

async function callApi(path: string, body: any) {
  await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function GET() {
  try {
    const now = new Date().toISOString();

    const { data: item } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("automation_status", "pending")
      .lte("scheduled_for", now)
      .order("scheduled_for", { ascending: true })
      .limit(1)
      .single();

    if (!item) {
      return NextResponse.json({ message: "No scheduled items" });
    }

    // STEP 1 → generate image
    await callApi("/api/content/generate-image", { id: item.id });

    // STEP 2 → upload
    await callApi("/api/content/upload-to-storage", { id: item.id });

    // STEP 3 → publish
    await callApi("/api/content/publish-instagram", { id: item.id });

    // mark done
    await supabaseAdmin
      .from("content_items")
      .update({
        automation_status: "done"
      })
      .eq("id", item.id);

    return NextResponse.json({ success: true, id: item.id });
  } catch (e) {
    return NextResponse.json({ error: "Automation run failed" }, { status: 500 });
  }
}