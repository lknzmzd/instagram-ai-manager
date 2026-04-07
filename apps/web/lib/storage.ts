import { supabaseAdmin } from "@/lib/supabase";

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);

  if (!match) {
    throw new Error("Invalid data URL format");
  }

  const mimeType = match[1];
  const base64Data = match[2];
  const buffer = Buffer.from(base64Data, "base64");

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
  const { mimeType, buffer } = parseDataUrl(params.dataUrl);
  const ext = getExtensionFromMime(mimeType);

  const path = `generated/${params.contentItemId}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("instagram-media")
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: false
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data } = supabaseAdmin.storage
    .from("instagram-media")
    .getPublicUrl(path);

  if (!data?.publicUrl) {
    throw new Error("Failed to get public URL from storage");
  }

  return {
    path,
    publicUrl: data.publicUrl
  };
}