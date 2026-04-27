import { supabaseAdmin } from "@/lib/supabase";

type ContentItem = {
  id: string;
  workflow_state?: string | null;
  retry_count?: number | null;
  public_image_url?: string | null;
};

export async function generateImage(item: ContentItem) {
  await supabaseAdmin
    .from("content_items")
    .update({
      last_error:
        "generateImage step is not directly implemented in queue yet. Use /api/content/generate-image before publishing.",
      workflow_state: "failed",
      queue_status: "failed",
      updated_at: new Date().toISOString()
    })
    .eq("id", item.id);
}

export async function uploadToStorage(item: ContentItem) {
  if (!item.public_image_url) {
    throw new Error("No public_image_url found for upload step");
  }

  await supabaseAdmin
    .from("content_items")
    .update({
      workflow_state: "uploaded",
      render_status: "rendered",
      updated_at: new Date().toISOString()
    })
    .eq("id", item.id);
}

export async function createContainer(item: ContentItem) {
  await supabaseAdmin
    .from("content_items")
    .update({
      workflow_state: "uploaded",
      updated_at: new Date().toISOString()
    })
    .eq("id", item.id);
}

export async function checkContainer(item: ContentItem) {
  await supabaseAdmin
    .from("content_items")
    .update({
      workflow_state: "container_ready",
      updated_at: new Date().toISOString()
    })
    .eq("id", item.id);
}

export async function publishPost(item: ContentItem) {
  await supabaseAdmin
    .from("content_items")
    .update({
      next_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", item.id);
}