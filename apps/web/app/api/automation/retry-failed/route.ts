import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const MAX_RETRIES = 3;

function isAuthorized(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) return false;
  return authHeader === `Bearer ${cronSecret}`;
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data: failedItems, error } = await supabaseAdmin
      .from("content_items")
      .select("id, retry_count, scheduled_for, last_error")
      .eq("queue_status", "failed")
      .neq("publish_status", "published")
      .lt("retry_count", MAX_RETRIES)
      .order("scheduled_for", { ascending: true })
      .limit(5);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    if (!failedItems || failedItems.length === 0) {
      return NextResponse.json({
        success: true,
        retried: 0,
        message: "No failed items eligible for retry"
      });
    }

    const ids = failedItems.map((item) => item.id);

    const { error: updateError } = await supabaseAdmin
      .from("content_items")
      .update({
        queue_status: "ready",
        updated_at: new Date().toISOString()
      })
      .in("id", ids);

    if (updateError) {
      return NextResponse.json(
        { success: false, error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      retried: ids.length,
      ids
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown retry automation error"
      },
      { status: 500 }
    );
  }
}