export async function GET() {
  const posts = await supabaseAdmin
    .from("content_items")
    .select("id, instagram_media_id")
    .eq("workflow_state", "published");

  for (const post of posts.data || []) {
    const res = await fetch(
      `https://graph.facebook.com/v24.0/${post.instagram_media_id}?fields=like_count,comments_count,reach`
    );

    const data = await res.json();

    await supabaseAdmin.from("content_metrics").insert({
      content_id: post.id,
      views: data.reach,
      likes: data.like_count,
      comments: data.comments_count,
      engagement_rate:
        data.reach > 0
          ? (data.like_count + data.comments_count) / data.reach
          : 0
    });
  }

  return Response.json({ ok: true });
}