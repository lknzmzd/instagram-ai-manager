import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getValidInstagramCredentials } from "@/lib/instagramTokens";

const GRAPH_URL = "https://graph.facebook.com/v24.0";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    if (item.status !== "approved") {
      return NextResponse.json(
        {
          error: "Only approved items can be published",
          debug: {
            status: item.status,
            prompt_status: item.prompt_status
          }
        },
        { status: 400 }
      );
    }

    if (!item.public_image_url) {
      return NextResponse.json(
        { error: "No public image URL found. Upload to storage first." },
        { status: 400 }
      );
    }

    const { accessToken, instagramBusinessId } =
      await getValidInstagramCredentials();

    if (!accessToken || !instagramBusinessId) {
      return NextResponse.json(
        { error: "Instagram credentials missing" },
        { status: 500 }
      );
    }

    const caption = `${item.caption ?? ""}\n\n${
      Array.isArray(item.hashtags) ? item.hashtags.join(" ") : ""
    }`.trim();

    const createRes = await fetch(`${GRAPH_URL}/${instagramBusinessId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: item.public_image_url,
        caption,
        access_token: accessToken
      })
    });

    const createData = await createRes.json();

    if (!createRes.ok) {
      return NextResponse.json(
        {
          step: "create_media_container",
          error:
            createData?.error?.message ||
            "Failed to create IG media container",
          meta: createData
        },
        { status: 500 }
      );
    }

    const creationId = createData.id;

    if (!creationId) {
      return NextResponse.json(
        {
          step: "create_media_container",
          error: "Instagram creation_id missing",
          meta: createData
        },
        { status: 500 }
      );
    }

    const publishRes = await fetch(
      `${GRAPH_URL}/${instagramBusinessId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: accessToken
        })
      }
    );

    const publishData = await publishRes.json();

    if (!publishRes.ok) {
      return NextResponse.json(
        {
          step: "publish_media",
          error:
            publishData?.error?.message ||
            "Failed to publish Instagram media",
          meta: publishData
        },
        { status: 500 }
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("content_items")
      .update({
        publish_status: "published",
        instagram_creation_id: creationId,
        instagram_media_id: publishData.id,
        updated_at: new Date().toISOString(),
        published_at: new Date().toISOString()
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
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Unknown publish error"
      },
      { status: 500 }
    );
  }
}