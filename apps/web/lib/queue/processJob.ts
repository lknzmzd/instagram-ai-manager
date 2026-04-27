// /lib/queue/processJob.ts

import {
  generateImage,
  uploadToStorage,
  createContainer,
  checkContainer,
  publishPost
} from "./steps";

export async function processJob(item) {
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
      return;
  }
}