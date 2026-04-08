import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getValidInstagramCredentials } from "@/lib/instagramTokens";
import { logPostResult } from "@/lib/logger";

const GRAPH_URL = "https://graph.facebook.com/v24.0";

async function safeParseJson(response: Response) {
  const raw = await response.text();

  try {
    return JSON.parse(raw);
  } catch {
    return {
      raw,
      parse_error: true,
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

export async function POST(req: Request) {
  let contentItemId: string | null = null;
  let mediaUrl: string | null = null;
  let caption: string | null = null;

  try {
    const body = await req.json();
    const { id } = body;

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
        errorMessage: "Item not found",
      }).catch(() => null);

      return NextResponse.json(
        { success: false, error: "Item not found" },
        { status: 404 }
      );
    }

    if (item.status !== "approved") {
      await logPostResult({
        contentItemId: id,
        mediaUrl: item.public_image_url ?? null,
        caption: item.caption ?? null,
        status: "failed",
        errorMessage: `Only approved items can be published. Current status: ${item.status}`,
      }).catch(() => null);

      return NextResponse.json(
        {
          success: false,
          error: "Only approved items can be published",
          debug: {
            status: item.status,
            prompt_status: item.prompt_status,
          },
        },
        { status: 400 }
      );
    }

    if (!item.public_image_url) {
      await logPostResult({
        contentItemId: id,
        caption: item.caption ?? null,
        status: "failed",
        errorMessage: "No public image URL found. Upload to storage first.",
      }).catch(() => null);

      return NextResponse.json(
        {
          success: false,
          error: "No public image URL found. Upload to storage first.",
        },
        { status: 400 }
      );
    }

    mediaUrl = item.public_image_url;
    caption = buildCaption(item);

    const { accessToken, instagramBusinessId } =
      await getValidInstagramCredentials();

    if (!accessToken || !instagramBusinessId) {
      await logPostResult({
        contentItemId: id,
        mediaUrl,
        caption,
        status: "failed",
        errorMessage: "Instagram credentials missing",
      }).catch(() => null);

      return NextResponse.json(
        {
          success: false,
          error: "Instagram credentials missing",
        },
        { status: 500 }
      );
    }

    const createRes = await fetch(`${GRAPH_URL}/${instagramBusinessId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: mediaUrl,
        caption,
        access_token: accessToken,
      }),
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
        errorMessage: `create_media_container: ${createErrorMessage}`,
      }).catch(() => null);

      return NextResponse.json(
        {
          success: false,
          step: "create_media_container",
          error: isTokenExpiredMessage(createErrorMessage)
            ? "Instagram access token expired. Reconnect account and update token in the active database record."
            : createErrorMessage,
          meta: createData,
        },
        { status: isTokenExpiredMessage(createErrorMessage) ? 401 : 500 }
      );
    }

    const creationId = createData?.id;

    if (!creationId) {
      await logPostResult({
        contentItemId: id,
        mediaUrl,
        caption,
        status: "failed",
        errorMessage: "Instagram creation_id missing",
      }).catch(() => null);

      return NextResponse.json(
        {
          success: false,
          step: "create_media_container",
          error: "Instagram creation_id missing",
          meta: createData,
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
          access_token: accessToken,
        }),
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
        errorMessage: `publish_media: ${publishErrorMessage}`,
      }).catch(() => null);

      return NextResponse.json(
        {
          success: false,
          step: "publish_media",
          error: isTokenExpiredMessage(publishErrorMessage)
            ? "Instagram access token expired. Reconnect account and update token in the active database record."
            : publishErrorMessage,
          meta: publishData,
        },
        { status: isTokenExpiredMessage(publishErrorMessage) ? 401 : 500 }
      );
    }

    const instagramMediaId = publishData?.id ?? null;
    const now = new Date().toISOString();

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("content_items")
      .update({
        publish_status: "published",
        instagram_creation_id: creationId,
        instagram_media_id: instagramMediaId,
        updated_at: now,
        published_at: now,
      })
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
        errorMessage: `Published to Instagram, but failed to update content_items: ${updateError.message}`,
      }).catch(() => null);

      return NextResponse.json(
        {
          success: false,
          error: updateError.message,
        },
        { status: 500 }
      );
    }

    await logPostResult({
      contentItemId: id,
      mediaUrl,
      caption,
      status: "success",
      instagramPostId: instagramMediaId,
    });

    return NextResponse.json({
      success: true,
      instagramCreationId: creationId,
      instagramMediaId,
      item: updated,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown publish error";

    await logPostResult({
      contentItemId,
      mediaUrl,
      caption,
      status: "failed",
      errorMessage,
    }).catch(() => null);

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}