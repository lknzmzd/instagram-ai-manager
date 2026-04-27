import {
  generateImage,
  uploadToStorage,
  createContainer,
  checkContainer,
  publishPost
} from "./steps";

type ContentItem = {
  id: string;
  workflow_state?: string | null;
  retry_count?: number | null;
  public_image_url?: string | null;
};

export async function processJob(item: ContentItem) {
  switch (item.workflow_state) {
    case "approved":
      return generateImage(item);

    case "image_generated":
      return uploadToStorage(item);

    case "uploaded":
      return createContainer(item);

    case "container_created":
      return checkContainer(item);

    case "container_ready":
      return publishPost(item);

    default:
      return null;
  }
}