import { NextResponse } from "next/server";
import { uploadGeneratedImageToStorage } from "@/lib/storage";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { contentItemId, dataUrl } = body;

    if (!contentItemId || !dataUrl) {
      return NextResponse.json(
        { success: false, error: "Missing contentItemId or dataUrl" },
        { status: 400 }
      );
    }

    const result = await uploadGeneratedImageToStorage({
      contentItemId,
      dataUrl
    });

    return NextResponse.json({
      success: true,
      path: result.path,
      publicUrl: result.publicUrl
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown upload error"
      },
      { status: 500 }
    );
  }
}