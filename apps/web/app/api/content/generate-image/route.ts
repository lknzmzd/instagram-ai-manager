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
  const parts = [
    item.image_prompt?.trim(),
    item.concept_title?.trim(),
    item.visual_brief?.trim(),
    item.on_image_text?.trim()
  ].filter(Boolean);

  return parts.join(". ").trim();
}

async function markImageFailure(id: string, errorMessage: string) {
  await supabaseAdmin
    .from("content_items")
    .update({
      render_status: "failed",
      last_error: errorMessage,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);
}

export async function POST(req: Request) {
  let contentItemId: string | null = null;

  try {
    const body = await req.json();
    const { id, force = false } = body as {
      id?: string;
      force?: boolean;
    };

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
      await markImageFailure(id, "Image prompt is empty");

      return NextResponse.json(
        {
          success: false,
          error: "Image prompt is empty"
        },
        { status: 400 }
      );
    }

    const model = "gpt-image-1";

    let imageResponse: any;

    try {
      imageResponse = await openai.images.generate({
        model,
        prompt: promptText,
        size: "1024x1024"
      });
    } catch (apiError) {
      const message =
        apiError instanceof Error
          ? apiError.message
          : "OpenAI image generation request failed";

      await markImageFailure(id, `OpenAI image generation failed: ${message}`);

      return NextResponse.json(
        {
          success: false,
          error: `OpenAI image generation failed: ${message}`
        },
        { status: 500 }
      );
    }

    const firstImage = imageResponse?.data?.[0];

    if (!firstImage) {
      await markImageFailure(id, "No image returned from OpenAI");

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
      await markImageFailure(
        id,
        "OpenAI returned an image, but no usable URL/base64 payload was found"
      );

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
        last_error: null,
        updated_at: now
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      await markImageFailure(
        id,
        `Generated image but failed to save in DB: ${updateError.message}`
      );

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

    if (contentItemId) {
      await markImageFailure(contentItemId, message).catch(() => null);
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}