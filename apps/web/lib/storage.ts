import { supabaseAdmin } from "@/lib/supabase";

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);

  if (!match) {
    throw new Error("Invalid data URL format");
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, "base64");

  if (!buffer.length) {
    throw new Error("Decoded file buffer is empty");
  }

  return { mimeType, buffer };
}

function getExtensionFromMime(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

export async function uploadGeneratedImageToStorage(params: {
  contentItemId: string;
  dataUrl: string;
}) {
  if (!params.contentItemId?.trim()) {
    throw new Error("contentItemId is required");
  }

  if (!params.dataUrl?.startsWith("data:image/")) {
    throw new Error("Only image data URLs are supported");
  }

  const { mimeType, buffer } = parseDataUrl(params.dataUrl);
  const ext = getExtensionFromMime(mimeType);

  const safeId = params.contentItemId.replace(/[^a-zA-Z0-9_-]/g, "");
  const path = `generated/${safeId}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("instagram-media")
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: false
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: publicData } = supabaseAdmin.storage
    .from("instagram-media")
    .getPublicUrl(path);

  let publicUrl = publicData?.publicUrl ?? null;

  if (!publicUrl) {
    const expires = 60 * 60 * 24 * 7; // 7 days
    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from("instagram-media")
      .createSignedUrl(path, expires);

    if (signedError || !signedData?.signedUrl) {
      throw new Error("Failed to get public or signed URL from storage");
    }

    publicUrl = signedData.signedUrl;
  }

  return {
    path,
    publicUrl
  };
}