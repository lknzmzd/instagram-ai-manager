import { SupabaseClient } from "@supabase/supabase-js";

type ContentItem = {
  id: string;
  public_image_url: string | null;
  caption?: string | null;
  container_id?: string | null;
  workflow_state?: string | null;
};

export async function runPublishFlow(
  item: ContentItem,
  supabaseAdmin: SupabaseClient
): Promise<{ step: string; media_id?: string }> {
  const GRAPH_URL = "https://graph.facebook.com/v24.0";

  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN!;
  const igUserId = process.env.INSTAGRAM_BUSINESS_ID!;
  const now = new Date().toISOString();

  if (!item.public_image_url) {
    throw new Error("Missing public_image_url");
  }

  if (!item.container_id) {
    const res = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
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
        updated_at: now
      })
      .eq("id", item.id);

    return { step: "container_created" };
  }

  if (item.workflow_state === "container_created") {
    const res = await fetch(
      `${GRAPH_URL}/${item.container_id}?fields=status_code&access_token=${accessToken}`
    );

    const data = await res.json();

    if (data.status_code === "ERROR") {
      throw new Error("Container failed");
    }

    if (data.status_code !== "FINISHED") {
      return { step: "waiting_container" };
    }

    await supabaseAdmin
      .from("content_items")
      .update({
        workflow_state: "container_ready",
        updated_at: now
      })
      .eq("id", item.id);

    return { step: "container_ready" };
  }

  if (item.workflow_state === "container_ready") {
    const res = await fetch(`${GRAPH_URL}/${igUserId}/media_publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
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
        updated_at: now
      })
      .eq("id", item.id);

    return { step: "published", media_id: data.id };
  }

  return { step: "noop" };
}