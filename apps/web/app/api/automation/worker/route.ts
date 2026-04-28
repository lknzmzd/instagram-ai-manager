import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

async function call(req: NextRequest, path: string, payload: any) {
  const origin = new URL(req.url).origin;

  const res = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const text = await res.text();

  try {
    return { ok: res.ok, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, data: { raw: text } };
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data: item } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .neq("publish_status", "published")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!item) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "No items"
      });
    }

    // =========================================
    // STEP 1: IMAGE
    // =========================================
    if (!item.public_image_url) {
      const res = await call(req, "/api/content/generate-image", { id: item.id });

      return NextResponse.json({
        success: true,
        step: "generate_image",
        result: res.data
      });
    }

    // =========================================
    // STEP 2: INSTAGRAM FLOW
    // =========================================
    const res = await call(req, "/api/content/publish-instagram", {
      id: item.id
    });

    return NextResponse.json({
      success: true,
      step: "instagram_flow",
      result: res.data
    });

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