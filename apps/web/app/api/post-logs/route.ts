import { NextResponse } from "next/server";
import { getRecentPostLogs } from "@/lib/logger";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  try {
    const logs = await getRecentPostLogs(20);

    return NextResponse.json({
      success: true,
      logs
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to load post logs"
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const { error } = await supabaseAdmin
      .from("post_logs")
      .delete()
      .not("id", "is", null);

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
      message: "All post logs deleted"
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to clear post logs"
      },
      { status: 500 }
    );
  }
}