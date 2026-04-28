import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
}

async function call(req: NextRequest, path: string, payload: any) {
  const origin = new URL(req.url).origin;

  const res = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  const text = await res.text();

  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: { raw: text } };
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .neq("publish_status", "published")
      .not("public_image_url", "is", null)
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
        version: "V2_SKIP_IMAGE",
        reason: "No publish-ready item found. Need public_image_url first."
      });
    }

    const res = await call(req, "/api/content/publish-instagram", {
      id: item.id
    });

    return NextResponse.json({
      success: true,
      version: "V2_SKIP_IMAGE",
      step: "instagram_flow",
      item_id: item.id,
      result: res.data
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        version: "V2_SKIP_IMAGE",
        error: err instanceof Error ? err.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}