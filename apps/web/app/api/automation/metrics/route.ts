import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getValidInstagramCredentials } from "@/lib/instagramTokens";

const GRAPH_URL = "https://graph.facebook.com/v24.0";

async function safeParseJson(response: Response) {
  const raw = await response.text();

  try {
    return JSON.parse(raw);
  } catch {
    return { raw, parse_error: true };
  }
}

export async function GET() {
  try {
    const { accessToken } = await getValidInstagramCredentials();

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Instagram access token missing" },
        { status: 500 }
      );
    }

    const { data: posts, error } = await supabaseAdmin
      .from("content_items")
      .select("id, instagram_media_id")
      .eq("workflow_state", "published")
      .not("instagram_media_id", "is", null);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    let collected = 0;
    const failures: any[] = [];

    for (const post of posts || []) {
      const res = await fetch(
        `${GRAPH_URL}/${post.instagram_media_id}?fields=like_count,comments_count,reach&access_token=${encodeURIComponent(
          accessToken
        )}`,
        {
          method: "GET",
          cache: "no-store"
        }
      );

      const data = await safeParseJson(res);

      if (!res.ok) {
        failures.push({
          content_id: post.id,
          error: data?.error?.message || "Failed to collect metrics"
        });
        continue;
      }

      const reach = Number(data?.reach ?? 0);
      const likes = Number(data?.like_count ?? 0);
      const comments = Number(data?.comments_count ?? 0);

      await supabaseAdmin.from("content_metrics").insert({
        content_id: post.id,
        views: reach,
        likes,
        comments,
        shares: 0,
        engagement_rate: reach > 0 ? (likes + comments) / reach : 0,
        collected_at: new Date().toISOString()
      });

      collected++;
    }

    return NextResponse.json({
      success: true,
      checked: posts?.length ?? 0,
      collected,
      failures
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown metrics collection error"
      },
      { status: 500 }
    );
  }
}