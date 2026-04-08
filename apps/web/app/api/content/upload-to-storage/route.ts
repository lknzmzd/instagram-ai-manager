import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { uploadGeneratedImageToStorage } from "@/lib/storage";
import { logPostResult } from "@/lib/logger";

export async function POST(req: Request) {
  let contentItemId: string | null = null;
  let mediaUrl: string | null = null;

  try {
    const body = await req.json();
    const { id } = body;

    contentItemId = id ?? null;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing content item id" },
        { status: 400 }
      );
    }

    const { data: item, error: fetchError } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !item) {
      await logPostResult({
        contentItemId: id,
        status: "failed",
        errorMessage: "Content item not found"
      }).catch(() => null);

      return NextResponse.json(
        { success: false, error: "Content item not found" },
        { status: 404 }
      );
    }

    if (!item.generated_image_url) {
      await logPostResult({
        contentItemId: id,
        status: "failed",
        errorMessage: "No generated image found. Generate image first."
      }).catch(() => null);

      return NextResponse.json(
        {
          success: false,
          error: "No generated image found. Generate image first."
        },
        { status: 400 }
      );
    }

    if (!String(item.generated_image_url).startsWith("data:image/")) {
      await logPostResult({
        contentItemId: id,
        status: "failed",
        errorMessage: "Generated image is not a base64 data URL"
      }).catch(() => null);

      return NextResponse.json(
        {
          success: false,
          error: "Generated image is not a base64 data URL"
        },
        { status: 400 }
      );
    }

    // prevent duplicate upload
    if (item.public_image_url) {
      return NextResponse.json({
        success: true,
        item,
        message: "Already uploaded to storage"
      });
    }

    const uploaded = await uploadGeneratedImageToStorage({
      contentItemId: item.id,
      dataUrl: item.generated_image_url
    });

    mediaUrl = uploaded.publicUrl;

    const now = new Date().toISOString();

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("content_items")
      .update({
        public_image_url: uploaded.publicUrl,
        updated_at: now
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      await logPostResult({
        contentItemId: id,
        mediaUrl,
        status: "failed",
        errorMessage: `Uploaded to storage but failed to update DB: ${updateError.message}`
      }).catch(() => null);

      return NextResponse.json(
        { success: false, error: updateError.message },
        { status: 500 }
      );
    }

    // optional success log (useful for pipeline tracing)
    await logPostResult({
      contentItemId: id,
      mediaUrl,
      status: "success",
      caption: item.caption ?? null
    }).catch(() => null);

    return NextResponse.json({
      success: true,
      item: updated,
      publicUrl: uploaded.publicUrl
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown upload-to-storage error";

    await logPostResult({
      contentItemId,
      mediaUrl,
      status: "failed",
      errorMessage: message
    }).catch(() => null);

    return NextResponse.json(
      {
        success: false,
        error: message
      },
      { status: 500 }
    );
  }
}