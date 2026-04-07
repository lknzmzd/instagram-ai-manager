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
}): Promise<GeneratedContentItem[]> {
  const { page, count, goal, recentConcepts = [] } = params;

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
Avoid repeating these concepts: ${JSON.stringify(recentConcepts)}

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