import OpenAI from "openai";
import type { GeneratedContentItem, PageProfile } from "../../../packages/shared/types";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function generateBatch(params: {
  page: PageProfile;
  count: number;
  goal: string;
  recentConcepts?: string[];
  recentVisuals?: string[];
}): Promise<GeneratedContentItem[]> {
  const { page, count, goal, recentConcepts = [], recentVisuals = [] } = params;

  const prompt = `
Generate ${count} Instagram content ideas for this page.

Page slug: ${page.slug}
Niche: ${page.niche}
Tone: ${page.tone}
Visual style: ${page.visual_style}
Allowed topics: ${JSON.stringify(page.allowed_topics)}
Banned topics: ${JSON.stringify(page.banned_topics)}
Caption rules: ${JSON.stringify(page.caption_rules)}
Hashtag rules: ${JSON.stringify(page.hashtag_rules)}
Default format: ${page.default_format}
Goal: ${goal}
Avoid repeating these recent concept titles: ${JSON.stringify(recentConcepts)}
Avoid repeating these recent visual prompts/briefs: ${JSON.stringify(recentVisuals)}

Hard diversity rules:
- Do not create two consecutive items with the same main setting.
- Max 2 hallway/corridor visuals in the entire batch.
- Max 2 staircase/stairwell visuals in the entire batch.
- Max 2 human-shadow/silhouette visuals in the entire batch.
- Use at least 6 different visual lanes across the batch: corridor, staircase, doorway, object close-up, room corner, exterior night, reflection/mirror, abstract texture, signage/symbol, distorted camera frame.
- Every item must have a distinct subject, camera angle, distance, texture, and light source.
- Do not reuse the same nouns repeatedly: hallway, corridor, stair, shadow, silhouette, doorway.
- If the page style is dark/minimal, keep the mood but vary the object/scene architecture.

Return strict JSON array only.
Each item must include:
- concept_title
- visual_brief
- on_image_text
- caption
- hashtags
- voiceover_script
- post_type
- goal
`;

  const response = await openai.responses.create({
    model: "gpt-5",
    input: prompt
  });

  const text = response.output_text?.trim();

  if (!text) {
    throw new Error("No AI output received");
  }

  try {
    return JSON.parse(text) as GeneratedContentItem[];
  } catch {
    throw new Error("Failed to parse AI JSON output");
  }
}