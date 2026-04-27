import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getValidInstagramCredentials } from "@/lib/instagramTokens";
import { logPostResult } from "@/lib/logger";

const GRAPH_URL = "https://graph.facebook.com/v24.0";
const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 15;

async function safeParseJson(response: Response) {
  const raw = await response.text();

  try {
    return JSON.parse(raw);
  } catch {
    return {
      raw,
      parse_error: true
    };
  }
}

function buildCaption(item: {
  caption?: string | null;
  hashtags?: string[] | null;
}) {
  const caption = item.caption ?? "";
  const hashtags = Array.isArray(item.hashtags) ? item.hashtags.join(" ") : "";
  return `${caption}\n\n${hashtags}`.trim();
}

function isTokenExpiredMessage(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("error validating access token") ||
    normalized.includes("session has expired") ||
    normalized.includes("access token has expired")
  );
}

async function waitForContainerReady(params: {
  creationId: string;
  accessToken: string;
}) {
  for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const statusRes = await fetch(
      `${GRAPH_URL}/${params.creationId}?fields=id,status_code&access_token=${encodeURIComponent(
        params.accessToken
      )}`,
      {
        method: "GET",
        cache: "no-store"
      }
    );

    const statusData = await safeParseJson(statusRes);

    if (!statusRes.ok) {
      return {
        success: false,
        status: "api_error",
        error: statusData?.error?.message || "Container status check failed",
        meta: statusData
      };
    }

    if (statusData?.status_code === "FINISHED") {
      return {
        success: true,
        status: "finished",
        meta: statusData
      };
    }

    if (statusData?.status_code === "ERROR") {
      return {
        success: false,
        status: "error",
        error: "Instagram container processing failed",
        meta: statusData
      };
    }
  }

  return {
    success: false,
    status: "timeout",
    error: "Timeout waiting for Instagram container to finish processing",
    meta: null
  };
}

async function tryResolveMediaId(params: {
  creationId: string;
  accessToken: string;
}) {
  try {
    const statusRes = await fetch(
      `${GRAPH_URL}/${params.creationId}?fields=id,status_code&access_token=${encodeURIComponent(
        params.accessToken
      )}`,
      {
        method: "GET",
        cache: "no-store"
      }
    );

    const statusData = await safeParseJson(statusRes);

    if (!statusRes.ok) {
      return {
        mediaId: null,
        meta: statusData
      };
    }

    return {
      mediaId: statusData?.id ?? null,
      meta: statusData
    };
  } catch {
    return {
      mediaId: null,
      meta: null
    };
  }
}

async function markScheduledFailure(params: {
  id: string;
  retryCount?: number | null;
  errorMessage?: string;
}) {
  const retryCount = Number(params.retryCount ?? 0);

  await supabaseAdmin
    .from("content_items")
    .update({
      queue_status: "failed",
      workflow_state: "failed",
      last_error: params.errorMessage ?? "Publish failed",
      retry_count: retryCount + 1,
      next_run_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", params.id);
}

export async function POST(req: Request) {
  let contentItemId: string | null = null;
  let mediaUrl: string | null = null;
  let caption: string | null = null;

  try {
    const body = await req.json();

    const { id, scheduled_run = false } = body as {
      id?: string;
      scheduled_run?: boolean;
      debug?: boolean;
    };

    const debug =
      (body as any)?.debug === true || process.env.NODE_ENV !== "production";

    contentItemId = id ?? null;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing id" },
        { status: 400 }
      );
    }

    const { data: item, error: itemError } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("id", id)
      .single();

    if (itemError || !item) {
      await logPostResult({
        contentItemId: id,
        status: "failed",
        errorMessage: "Item not found"
      }).catch(() => null);

      return NextResponse.json(
        { success: false, error: "Item not found" },
        { status: 404 }
      );
    }

    const retryCount = Number(item.retry_count ?? 0);

    if (item.publish_status === "published") {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "Already published",
        item
      });
    }

    if (item.status !== "approved") {
      const errorMessage = `Only approved items can be published. Current status: ${item.status}`;

      await logPostResult({
        contentItemId: id,
        mediaUrl: item.public_image_url ?? null,
        caption: item.caption ?? null,
        status: "failed",
        errorMessage
      }).catch(() => null);

      if (scheduled_run) {
        await markScheduledFailure({
          id,
          retryCount,
          errorMessage
        });
      }

      return NextResponse.json(
        {
          success: false,
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
      const errorMessage = "No public image URL found. Upload to storage first.";

      await logPostResult({
        contentItemId: id,
        caption: item.caption ?? null,
        status: "failed",
        errorMessage
      }).catch(() => null);

      if (scheduled_run) {
        await markScheduledFailure({
          id,
          retryCount,
          errorMessage
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: errorMessage
        },
        { status: 400 }
      );
    }

    mediaUrl = item.public_image_url;
    caption = buildCaption(item);

    const { accessToken, instagramBusinessId } =
      await getValidInstagramCredentials();

    if (!accessToken || !instagramBusinessId) {
      const errorMessage = "Instagram credentials missing";

      await logPostResult({
        contentItemId: id,
        mediaUrl,
        caption,
        status: "failed",
        errorMessage
      }).catch(() => null);

      if (scheduled_run) {
        await markScheduledFailure({
          id,
          retryCount,
          errorMessage
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: errorMessage
        },
        { status: 500 }
      );
    }

    if (scheduled_run) {
      await supabaseAdmin
        .from("content_items")
        .update({
          queue_status: "processing",
          workflow_state: "uploaded",
          last_error: null,
          updated_at: new Date().toISOString()
        })
        .eq("id", id);
    }

    const createRes = await fetch(`${GRAPH_URL}/${instagramBusinessId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: mediaUrl,
        caption,
        access_token: accessToken
      })
    });

    const createData = await safeParseJson(createRes);

    if (!createRes.ok) {
      const createErrorMessage =
        createData?.error?.message || "Failed to create IG media container";

      await logPostResult({
        contentItemId: id,
        mediaUrl,
        caption,
        status: "failed",
        errorMessage: `create_media_container: ${createErrorMessage} | meta: ${safeMeta(
          createData
        )}`
      }).catch(() => null);

      if (scheduled_run) {
        await markScheduledFailure({
          id,
          retryCount,
          errorMessage: createErrorMessage
        });
      }

      const payload: any = {
        success: false,
        step: "create_media_container",
        error: isTokenExpiredMessage(createErrorMessage)
          ? "Instagram access token expired. Reconnect account and update token in the active database record."
          : createErrorMessage,
        meta: sanitizeMeta(createData)
      };

      if (debug) payload.debugMeta = { create: sanitizeMeta(createData) };

      return NextResponse.json(payload, {
        status: isTokenExpiredMessage(createErrorMessage) ? 401 : 500
      });
    }

    const creationId = createData?.id;

    if (!creationId) {
      const errorMessage = "Instagram creation_id missing";

      await logPostResult({
        contentItemId: id,
        mediaUrl,
        caption,
        status: "failed",
        errorMessage: `${errorMessage} | meta: ${safeMeta(createData)}`
      }).catch(() => null);

      if (scheduled_run) {
        await markScheduledFailure({
          id,
          retryCount,
          errorMessage
        });
      }

      const payload: any = {
        success: false,
        step: "create_media_container",
        error: errorMessage,
        meta: sanitizeMeta(createData)
      };

      if (debug) payload.debugMeta = { create: sanitizeMeta(createData) };

      return NextResponse.json(payload, { status: 500 });
    }

    await supabaseAdmin
      .from("content_items")
      .update({
        workflow_state: "container_created",
        container_id: creationId,
        instagram_creation_id: creationId,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    const waitResult = await waitForContainerReady({
      creationId,
      accessToken
    });

    if (!waitResult.success) {
      const waitError =
        waitResult.error || "Instagram container was not ready for publishing";

      await logPostResult({
        contentItemId: id,
        mediaUrl,
        caption,
        status: "failed",
        errorMessage: `wait_for_container: ${waitError} | meta: ${safeMeta(
          waitResult.meta
        )}`
      }).catch(() => null);

      if (scheduled_run) {
        await supabaseAdmin
          .from("content_items")
          .update({
            workflow_state: "container_created",
            queue_status: "retry",
            last_error: waitError,
            retry_count: retryCount + 1,
            next_run_at: new Date(Date.now() + 60 * 1000).toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", id);
      }

      const payload: any = {
        success: false,
        step: "wait_for_container",
        error: waitError,
        meta: sanitizeMeta(waitResult.meta)
      };

      if (debug) {
        payload.debugMeta = {
          create: sanitizeMeta(createData),
          wait: sanitizeMeta(waitResult.meta)
        };
      }

      return NextResponse.json(payload, { status: 500 });
    }

    await supabaseAdmin
      .from("content_items")
      .update({
        workflow_state: "container_ready",
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

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

    const publishData = await safeParseJson(publishRes);

    if (!publishRes.ok) {
      const publishErrorMessage =
        publishData?.error?.message || "Failed to publish Instagram media";

      await logPostResult({
        contentItemId: id,
        mediaUrl,
        caption,
        status: "failed",
        errorMessage: `publish_media: ${publishErrorMessage} | meta: ${safeMeta(
          publishData
        )}`
      }).catch(() => null);

      if (scheduled_run) {
        await markScheduledFailure({
          id,
          retryCount,
          errorMessage: publishErrorMessage
        });
      }

      const payload: any = {
        success: false,
        step: "publish_media",
        error: isTokenExpiredMessage(publishErrorMessage)
          ? "Instagram access token expired. Reconnect account and update token in the active database record."
          : publishErrorMessage,
        meta: sanitizeMeta(publishData)
      };

      if (debug) payload.debugMeta = { publish: sanitizeMeta(publishData) };

      return NextResponse.json(payload, {
        status: isTokenExpiredMessage(publishErrorMessage) ? 401 : 500
      });
    }

    let instagramMediaId = publishData?.id ?? null;
    let resolveMeta: any = null;

    if (!instagramMediaId) {
      const resolved = await tryResolveMediaId({
        creationId,
        accessToken
      });

      instagramMediaId = resolved.mediaId;
      resolveMeta = resolved.meta;
    }

    const now = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      publish_status: "published",
      workflow_state: "published",
      queue_status: scheduled_run ? "posted" : item.queue_status ?? null,
      instagram_creation_id: creationId,
      container_id: creationId,
      instagram_media_id: instagramMediaId,
      last_error: null,
      updated_at: now,
      published_at: now
    };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("content_items")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      await logPostResult({
        contentItemId: id,
        mediaUrl,
        caption,
        status: "failed",
        instagramPostId: instagramMediaId,
        errorMessage: `Published to Instagram, but failed to update content_items: ${updateError.message}`
      }).catch(() => null);

      return NextResponse.json(
        {
          success: false,
          error: updateError.message
        },
        { status: 500 }
      );
    }

    await logPostResult({
      contentItemId: id,
      mediaUrl,
      caption,
      status: "success",
      instagramPostId: instagramMediaId
    });

    const successPayload: any = {
      success: true,
      scheduled_run,
      instagramCreationId: creationId,
      instagramMediaId,
      mediaIdResolvedLater: !publishData?.id && !!instagramMediaId,
      mediaIdMissingButPublishAccepted: !publishData?.id && !instagramMediaId,
      resolveMeta: sanitizeMeta(resolveMeta),
      item: updated
    };

    if (debug) {
      successPayload.debugMeta = {
        create: sanitizeMeta(createData),
        wait: sanitizeMeta(waitResult.meta),
        publish: sanitizeMeta(publishData),
        resolve: sanitizeMeta(resolveMeta)
      };
    }

    return NextResponse.json(successPayload);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown publish error";

    await logPostResult({
      contentItemId,
      mediaUrl,
      caption,
      status: "failed",
      errorMessage
    }).catch(() => null);

    return NextResponse.json(
      {
        success: false,
        error: errorMessage
      },
      { status: 500 }
    );
  }
}

function safeMeta(obj: unknown) {
  try {
    return JSON.stringify(obj);
  } catch {
    try {
      return String(obj);
    } catch {
      return "[unserializable meta]";
    }
  }
}

function sanitizeMeta(obj: any) {
  if (!obj || typeof obj !== "object") return obj;

  const clone: Record<string, any> = {};

  for (const [k, v] of Object.entries(obj)) {
    if (typeof k === "string") {
      const lk = k.toLowerCase();

      if (
        lk.includes("access_token") ||
        lk.includes("accesstoken") ||
        lk === "token"
      ) {
        clone[k] = "[redacted]";
        continue;
      }
    }

    clone[k] = v;
  }

  return clone;
}