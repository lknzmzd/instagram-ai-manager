import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const GRAPH_URL = "https://graph.facebook.com/v24.0";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ success: false, error: "Missing id" }, { status: 400 });
    }

    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !item) throw new Error("Item not found");

    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN!;
    const igUserId = process.env.INSTAGRAM_USER_ID!;

    // =========================================
    // STEP 1: CREATE CONTAINER
    // =========================================
    if (!item.container_id) {
      const res = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: item.public_image_url,
          caption: item.caption || "",
          access_token: accessToken
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Create container failed");
      }

      await supabaseAdmin
        .from("content_items")
        .update({
          container_id: data.id,
          workflow_state: "container_created",
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      return NextResponse.json({
        success: true,
        step: "container_created"
      });
    }

    // =========================================
    // STEP 2: CHECK STATUS
    // =========================================
    if (item.workflow_state === "container_created") {
      const res = await fetch(
        `${GRAPH_URL}/${item.container_id}?fields=status_code&access_token=${accessToken}`
      );

      const data = await res.json();
      const status = data.status_code;

      if (status === "ERROR") {
        throw new Error("Container failed");
      }

      if (status !== "FINISHED") {
        return NextResponse.json({
          success: true,
          step: "waiting_container"
        });
      }

      await supabaseAdmin
        .from("content_items")
        .update({
          workflow_state: "container_ready",
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      return NextResponse.json({
        success: true,
        step: "container_ready"
      });
    }

    // =========================================
    // STEP 3: PUBLISH
    // =========================================
    if (item.workflow_state === "container_ready") {
      const res = await fetch(`${GRAPH_URL}/${igUserId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: item.container_id,
          access_token: accessToken
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Publish failed");
      }

      await supabaseAdmin
        .from("content_items")
        .update({
          publish_status: "published",
          instagram_media_id: data.id,
          workflow_state: "published",
          updated_at: new Date().toISOString()
        })
        .eq("id", id);

      return NextResponse.json({
        success: true,
        step: "published",
        media_id: data.id
      });
    }

    return NextResponse.json({
      success: true,
      message: "No action needed"
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