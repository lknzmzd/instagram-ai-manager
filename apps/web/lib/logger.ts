import { supabaseAdmin } from "@/lib/supabase";

type LogPostResultParams = {
  contentItemId?: string | null;
  mediaUrl?: string | null;
  caption?: string | null;
  status: "success" | "failed";
  errorMessage?: string | null;
  instagramPostId?: string | null;
};

export async function logPostResult(params: LogPostResultParams) {
  const payload = {
    content_item_id: params.contentItemId ?? null,
    media_url: params.mediaUrl ?? null,
    caption: params.caption ?? null,
    status: params.status,
    error_message: params.errorMessage ?? null,
    instagram_post_id: params.instagramPostId ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from("post_logs")
    .insert(payload)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to write post log: ${error.message}`);
  }

  return data;
}

export async function getRecentPostLogs(limit = 10) {
  const { data, error } = await supabaseAdmin
    .from("post_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load post logs: ${error.message}`);
  }

  return data ?? [];
}