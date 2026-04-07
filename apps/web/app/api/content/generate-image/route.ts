import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabase";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Missing content item id" },
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
        { error: "Content item not found" },
        { status: 404 }
      );
    }

    if (item.prompt_status !== "approved") {
      return NextResponse.json(
        { error: "Prompt must be approved before generating image" },
        { status: 400 }
      );
    }

    const promptText =
      item.image_prompt ||
      `${item.concept_title}. ${item.visual_brief}. ${item.on_image_text}`;

    const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini";

    const imageResponse = await openai.images.generate({
      model,
      prompt: promptText,
      size: "1024x1536"
    });

    const firstImage = imageResponse.data?.[0];

    if (!firstImage) {
      return NextResponse.json(
        { error: "No image returned from OpenAI" },
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
        { error: "OpenAI returned an image, but no usable URL/base64 payload was found" },
        { status: 500 }
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("content_items")
      .update({
        generated_image_url: generatedImageUrl,
        render_status: "image_generated",
        image_prompt: promptText,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      item: updated
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown generate image error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}