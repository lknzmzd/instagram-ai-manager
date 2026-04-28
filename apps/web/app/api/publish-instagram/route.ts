import { ContentItem } from "@/lib/types/contentItem";
import { SupabaseClient } from "@supabase/supabase-js";

export async function runPublishFlow(
  item: ContentItem,
  supabaseAdmin: SupabaseClient
) {
  const GRAPH_URL = "https://graph.facebook.com/v24.0";

  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN!;
  const igUserId = process.env.INSTAGRAM_USER_ID!;

  if (!item.public_image_url) {
    throw new Error("Missing public_image_url");
  }

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
        workflow_state: "container_created"
      })
      .eq("id", item.id);

    return { step: "container_created" };
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
      return { step: "waiting_container" };
    }

    await supabaseAdmin
      .from("content_items")
      .update({
        workflow_state: "container_ready"
      })
      .eq("id", item.id);

    return { step: "container_ready" };
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
        workflow_state: "published"
      })
      .eq("id", item.id);

    return {
      step: "published",
      media_id: data.id
    };
  }

  return { step: "no_action" };
}