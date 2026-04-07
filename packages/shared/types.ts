export type PageProfile = {
  id: string;
  slug: string;
  display_name: string;
  niche: string;
  tone: string;
  visual_style: string;
  target_audience: string | null;
  allowed_topics: string[];
  banned_topics: string[];
  caption_rules: Record<string, unknown>;
  hashtag_rules: Record<string, unknown>;
  posting_frequency: Record<string, unknown> | null;
  default_format: string;
  approval_mode: string;
};

export type GeneratedContentItem = {
  concept_title: string;
  visual_brief: string;
  on_image_text: string;
  caption: string;
  hashtags: string[];
  voiceover_script: string | null;
  post_type: string;
  goal: string;
};

export type ContentItem = {
  id: string;
  page_id: string;
  status: string;
  post_type: string;
  concept_title: string;
  visual_brief: string;
  on_image_text: string;
  caption: string;
  hashtags: string[] | null;
  voiceover_script: string | null;
  canva_design_id: string | null;
  final_media_url: string | null;
  media_type: string | null;
  render_status: string | null;
  publish_status: string | null;
  instagram_creation_id: string | null;
  instagram_media_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  public_image_url: string | null;
};