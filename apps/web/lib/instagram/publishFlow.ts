export async function runPublishFlow(item, supabaseAdmin) {
  const GRAPH_URL = "https://graph.facebook.com/v24.0";

  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN!;
  const igUserId = process.env.INSTAGRAM_USER_ID!;
  const now = new Date().toISOString();

  // CREATE CONTAINER
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

    if (!res.ok) throw new Error(data.error?.message);

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

  // CHECK STATUS
  if (item.workflow_state === "container_created") {
    const res = await fetch(
      `${GRAPH_URL}/${item.container_id}?fields=status_code&access_token=${accessToken}`
    );

    const data = await res.json();

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

  // PUBLISH
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

    if (!res.ok) throw new Error(data.error?.message);

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