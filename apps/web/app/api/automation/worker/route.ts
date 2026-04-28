import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runPublishFlow } from "@/lib/instagram/publishFlow";

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
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
        version: "V3_DIRECT_FLOW",
        reason: "No publish-ready item"
      });
    }

    const result = await runPublishFlow(item, supabaseAdmin);

    return NextResponse.json({
      success: true,
      version: "V3_DIRECT_FLOW",
      item_id: item.id,
      result
    });

  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        version: "V3_DIRECT_FLOW",
        error: err instanceof Error ? err.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}