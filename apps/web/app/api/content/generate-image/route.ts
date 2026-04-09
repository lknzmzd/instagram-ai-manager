import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabase";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function buildPromptText(item: {
  image_prompt?: string | null;
  concept_title?: string | null;
  visual_brief?: string | null;
  on_image_text?: string | null;
}) {
  return (
    item.image_prompt ||
    `${item.concept_title ?? ""}. ${item.visual_brief ?? ""}. ${item.on_image_text ?? ""}`.trim()
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, force = false } = body as {
      id?: string;
      force?: boolean;
    };

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
      return NextResponse.json(
        { success: false, error: "Content item not found" },
        { status: 404 }
      );
    }

    if (item.prompt_status !== "approved") {
      return NextResponse.json(
        {
          success: false,
          error: "Prompt must be approved before generating image"
        },
        { status: 400 }
      );
    }

    if (item.generated_image_url && !force) {
      return NextResponse.json({
        success: true,
        reused: true,
        message: "Image already exists",
        item
      });
    }

    const promptText = buildPromptText(item);

    if (!promptText) {
      return NextResponse.json(
        {
          success: false,
          error: "Image prompt is empty"
        },
        { status: 400 }
      );
    }

    const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini";

    const imageResponse = await openai.images.generate({
      model,
      prompt: promptText,
      size: "1024x1536"
    });

    const firstImage = imageResponse.data?.[0];

    if (!firstImage) {
      return NextResponse.json(
        { success: false, error: "No image returned from OpenAI" },
        { status: 500 }
      );
    }

    let generatedImageUrl: string | null = null;

    if ("b64_json" in firstImage && firstImage.b64_json) {
      generatedImageUrl = `data:image/png;base64,${firstImage.b64_json}`;
    } else if ("url" in firstImage && firstImage.url) {
      generatedImageUrl = firstImage.url;
    }

    if (!generatedImageUrl) {
      return NextResponse.json(
        {
          success: false,
          error:
            "OpenAI returned an image, but no usable URL/base64 payload was found"
        },
        { status: 500 }
      );
    }

    const now = new Date().toISOString();

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("content_items")
      .update({
        generated_image_url: generatedImageUrl,
        render_status: "rendered",
        image_prompt: promptText,
        updated_at: now
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { success: false, error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      reused: false,
      item: updated
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown generate image error";

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}