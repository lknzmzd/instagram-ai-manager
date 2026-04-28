import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const GRAPH_URL = "https://graph.facebook.com/v24.0";

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing id" },
        { status: 400 }
      );
    }

    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !item) {
      throw new Error("Item not found");
    }

    if (!item.public_image_url) {
      throw new Error("No image to publish");
    }

    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN!;
    const igUserId = process.env.INSTAGRAM_USER_ID!;

    // STEP 1: Create media container
    const containerRes = await fetch(
      `${GRAPH_URL}/${igUserId}/media`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          image_url: item.public_image_url,
          caption: item.caption || "",
          access_token: accessToken
        })
      }
    );

    const containerData = await containerRes.json();

    if (!containerRes.ok) {
      throw new Error(
        containerData.error?.message || "Failed to create container"
      );
    }

    const creationId = containerData.id;

    // STEP 2: Poll until ready (IMPORTANT)
    let attempts = 0;
    let status = "IN_PROGRESS";

    while (status !== "FINISHED" && attempts < 10) {
      await new Promise((r) => setTimeout(r, 3000));

      const statusRes = await fetch(
        `${GRAPH_URL}/${creationId}?fields=status_code&access_token=${accessToken}`
      );

      const statusData = await statusRes.json();
      status = statusData.status_code;

      if (status === "ERROR") {
        throw new Error("Container processing failed");
      }

      attempts++;
    }

    if (status !== "FINISHED") {
      throw new Error("Container timeout");
    }

    // STEP 3: Publish
    const publishRes = await fetch(
      `${GRAPH_URL}/${igUserId}/media_publish`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: accessToken
        })
      }
    );

    const publishData = await publishRes.json();

    if (!publishRes.ok) {
      throw new Error(
        publishData.error?.message || "Publish failed"
      );
    }

    // STEP 4: Update DB
    await supabaseAdmin
      .from("content_items")
      .update({
        publish_status: "published",
        instagram_media_id: publishData.id,
        workflow_state: "published"
      })
      .eq("id", id);

    return NextResponse.json({
      success: true,
      media_id: publishData.id
    });

  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}