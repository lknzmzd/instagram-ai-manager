import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { uploadGeneratedImageToStorage } from "@/lib/storage";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing content item id" }, { status: 400 });
    }

    const { data: item, error: fetchError } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: "Content item not found" }, { status: 404 });
    }

    if (!item.generated_image_url) {
      return NextResponse.json(
        { error: "No generated image found. Generate image first." },
        { status: 400 }
      );
    }

    if (!String(item.generated_image_url).startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Generated image is not a base64 data URL" },
        { status: 400 }
      );
    }

    const uploaded = await uploadGeneratedImageToStorage({
      contentItemId: item.id,
      dataUrl: item.generated_image_url
    });

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("content_items")
      .update({
        public_image_url: uploaded.publicUrl,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      item: updated
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown upload-to-storage error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}