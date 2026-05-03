import { SupabaseClient } from "@supabase/supabase-js";
import { getActiveInstagramAccount, getValidInstagramCredentials } from "@/lib/instagramTokens";
import { logPostResult } from "@/lib/logger";

type ContentItem = {
  id: string;
  public_image_url: string | null;
  caption?: string | null;
  container_id?: string | null;
  workflow_state?: string | null;
  retry_count?: number | null;
};

type PublishResult =
  | { step: "container_created"; container_id: string }
  | { step: "waiting_container"; container_id: string; status_code?: string | null }
  | { step: "container_ready"; container_id: string }
  | { step: "published"; media_id: string; container_id: string };

const GRAPH_URL = "https://graph.facebook.com/v24.0";
const CONTAINER_POLL_ATTEMPTS = 6;
const CONTAINER_POLL_DELAY_MS = 2_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeJson(response: Response) {
  const raw = await response.text();

  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function graphError(data: any, fallback: string) {
  return (
    data?.error?.message ||
    data?.error?.error_user_msg ||
    data?.raw ||
    fallback
  );
}

async function getPublishCredentials() {
  try {
    return await getValidInstagramCredentials();
  } catch (error) {
    const dbAccount = await getActiveInstagramAccount().catch(() => null);

    if (dbAccount?.access_token && dbAccount?.instagram_business_id) {
      return {
        instagramBusinessId: dbAccount.instagram_business_id,
        accessToken: dbAccount.access_token
      };
    }

    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const instagramBusinessId = process.env.INSTAGRAM_BUSINESS_ID;

    if (accessToken && instagramBusinessId) {
      return { instagramBusinessId, accessToken };
    }

    throw error;
  }
}

async function createMediaContainer(params: {
  instagramBusinessId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
}) {
  const body = new URLSearchParams();
  body.set("image_url", params.imageUrl);
  body.set("caption", params.caption);
  body.set("access_token", params.accessToken);

  const res = await fetch(`${GRAPH_URL}/${params.instagramBusinessId}/media`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    cache: "no-store"
  });

  const data = await safeJson(res);

  if (!res.ok || !data?.id) {
    throw new Error(graphError(data, "Create Instagram media container failed"));
  }

  return String(data.id);
}

async function getContainerStatus(containerId: string, accessToken: string) {
  const url = new URL(`${GRAPH_URL}/${containerId}`);
  url.searchParams.set("fields", "status_code");
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store"
  });

  const data = await safeJson(res);

  if (!res.ok) {
    throw new Error(graphError(data, "Failed to check Instagram container status"));
  }

  return data?.status_code ? String(data.status_code) : null;
}

async function publishContainer(params: {
  instagramBusinessId: string;
  accessToken: string;
  containerId: string;
}) {
  const body = new URLSearchParams();
  body.set("creation_id", params.containerId);
  body.set("access_token", params.accessToken);

  const res = await fetch(`${GRAPH_URL}/${params.instagramBusinessId}/media_publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    cache: "no-store"
  });

  const data = await safeJson(res);

  if (!res.ok || !data?.id) {
    throw new Error(graphError(data, "Publish Instagram media failed"));
  }

  return String(data.id);
}

export async function runPublishFlow(
  item: ContentItem,
  supabaseAdmin: SupabaseClient
): Promise<PublishResult> {
  const now = new Date().toISOString();

  if (!item.public_image_url) {
    throw new Error("Missing public_image_url");
  }

  const { instagramBusinessId, accessToken } = await getPublishCredentials();

  let containerId = item.container_id || null;

  if (!containerId) {
    containerId = await createMediaContainer({
      instagramBusinessId,
      accessToken,
      imageUrl: item.public_image_url,
      caption: item.caption || ""
    });

    await supabaseAdmin
      .from("content_items")
      .update({
        container_id: containerId,
        workflow_state: "container_created",
        queue_status: "processing",
        last_error: null,
        updated_at: now
      })
      .eq("id", item.id);
  }

  let statusCode: string | null = null;

  for (let attempt = 1; attempt <= CONTAINER_POLL_ATTEMPTS; attempt++) {
    statusCode = await getContainerStatus(containerId, accessToken);

    if (statusCode === "ERROR") {
      throw new Error("Instagram container processing failed");
    }

    if (statusCode === "FINISHED") {
      break;
    }

    if (attempt < CONTAINER_POLL_ATTEMPTS) {
      await sleep(CONTAINER_POLL_DELAY_MS);
    }
  }

  if (statusCode !== "FINISHED") {
    const nextRunAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    await supabaseAdmin
      .from("content_items")
      .update({
        workflow_state: "container_created",
        queue_status: "waiting",
        next_run_at: nextRunAt,
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.id);

    return {
      step: "waiting_container",
      container_id: containerId,
      status_code: statusCode
    };
  }

  await supabaseAdmin
    .from("content_items")
    .update({
      workflow_state: "container_ready",
      queue_status: "processing",
      last_error: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", item.id);

  const mediaId = await publishContainer({
    instagramBusinessId,
    accessToken,
    containerId
  });

  const publishedAt = new Date().toISOString();

  await supabaseAdmin
    .from("content_items")
    .update({
      publish_status: "published",
      instagram_media_id: mediaId,
      workflow_state: "published",
      queue_status: "posted",
      published_at: publishedAt,
      next_run_at: null,
      last_error: null,
      updated_at: publishedAt
    })
    .eq("id", item.id);

  await logPostResult({
    contentItemId: item.id,
    mediaUrl: item.public_image_url,
    caption: item.caption ?? null,
    status: "success",
    instagramPostId: mediaId
  }).catch(() => null);

  return { step: "published", media_id: mediaId, container_id: containerId };
}
