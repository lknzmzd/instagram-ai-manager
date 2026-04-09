import { NextResponse } from "next/server";
import { getInstagramTokenHealth } from "@/lib/instagramTokens";

export async function GET() {
  try {
    const health = await getInstagramTokenHealth();

    return NextResponse.json({
      success: true,
      health
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load Instagram token status"
      },
      { status: 500 }
    );
  }
}