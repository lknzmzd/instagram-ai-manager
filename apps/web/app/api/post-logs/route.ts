import { NextResponse } from "next/server";
import { getRecentPostLogs } from "@/lib/logger";

export async function GET() {
  try {
    const logs = await getRecentPostLogs(10);

    return NextResponse.json({
      success: true,
      logs
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load post logs"
      },
      { status: 500 }
    );
  }
}