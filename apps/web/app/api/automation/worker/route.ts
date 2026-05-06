import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runPublishFlow } from "@/lib/instagram/publishFlow";

const VERSION = "V7_3_DEDUP_READY_MEDIA_WORKER";
const MAX_RETRIES = 5;
const MAX_CANDIDATES = 10;
const DEFAULT_MIN_POST_GAP_MINUTES = 300; // 5 hours: allows 09:00, 15:00, 21:00 without bursts.
const DEFAULT_RECENT_DEDUP_LIMIT = 12;
const DEFAULT_SIMILARITY_THRESHOLD = 0.42;
const OPERATIONAL_START_MINUTE = 8 * 60 + 45; // 08:45 Berlin
const OPERATIONAL_END_MINUTE = 21 * 60 + 30; // 21:30 Berlin

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "is", "it",
  "of", "on", "or", "the", "to", "with", "without", "this", "that", "your", "you",
  "soft", "deep", "dark", "black", "white", "monochrome", "grain", "grainy", "cinematic",
  "light", "shadow", "shadows", "dim", "subtle", "heavy", "faint", "photo", "image"
]);

type ContentItem = Record<string, any>;

type DuplicateReason = {
  reason: string;
  matched_item_id?: string;
  matched_concept_title?: string;
  matched_instagram_media_id?: string | null;
  matched_published_at?: string | null;
  similarity?: number;
  lane?: string;
};

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const urlSecret = req.nextUrl.searchParams.get("secret");

  return (
    !!cronSecret &&
    (authHeader === `Bearer ${cronSecret}` || urlSecret === cronSecret)
  );
}

function getBerlinTimeHHMM(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function getBerlinMinuteOfDay(date: Date) {
  const [hour, minute] = getBerlinTimeHHMM(date).split(":").map(Number);
  return hour * 60 + minute;
}

function isOperationalWindow(date: Date) {
  const minuteOfDay = getBerlinMinuteOfDay(date);
  return (
    minuteOfDay >= OPERATIONAL_START_MINUTE &&
    minuteOfDay <= OPERATIONAL_END_MINUTE
  );
}

function getEnvNumber(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : fallback;

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
}

function getMinPostGapMinutes() {
  return getEnvNumber(
    "MIN_POST_GAP_MINUTES",
    DEFAULT_MIN_POST_GAP_MINUTES,
    0,
    24 * 60
  );
}

function getRecentDedupLimit() {
  return Math.floor(
    getEnvNumber("RECENT_DEDUP_LIMIT", DEFAULT_RECENT_DEDUP_LIMIT, 1, 50)
  );
}

function getSimilarityThreshold() {
  return getEnvNumber(
    "DEDUP_SIMILARITY_THRESHOLD",
    DEFAULT_SIMILARITY_THRESHOLD,
    0.2,
    0.95
  );
}

function isForce(req: NextRequest) {
  const value = req.nextUrl.searchParams.get("force");
  return value === "1" || value === "true" || value === "yes";
}

function normalizeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: unknown) {
  const normalized = normalizeText(value);

  return normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function tokenSet(value: unknown) {
  return new Set(tokenize(value));
}

function jaccardSimilarity(left: unknown, right: unknown) {
  const a = tokenSet(left);
  const b = tokenSet(right);

  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function compactPrompt(item: ContentItem) {
  return [
    item.concept_title,
    item.image_prompt,
    item.visual_brief,
    item.on_image_text,
    item.caption
  ]
    .filter(Boolean)
    .join(". ");
}

function classifyVisualLane(item: ContentItem) {
  const text = normalizeText(compactPrompt(item));

  if (/\b(stair|stairs|staircase|stairwell|stairway|spiral|riser|risers|ascent|descent|climb|steps?)\b/.test(text)) {
    return "staircase";
  }

  if (/\b(silhouette|figure|body|human|person|standing|watcher|shadow shaped|human shaped)\b/.test(text)) {
    return "human_shadow";
  }

  if (/\b(corridor|hallway|hall|t junction|passage|institutional|ceiling tiles)\b/.test(text)) {
    return "corridor";
  }

  if (/\b(door|doorway|threshold|entry|exit|frame)\b/.test(text)) {
    return "doorway";
  }

  if (/\b(glitch|vhs|static|analog|tear|tearing|interlaced|misalign|fault|scanline)\b/.test(text)) {
    return "glitch";
  }

  if (/\b(room|corner|wall|office|chamber|interior)\b/.test(text)) {
    return "room";
  }

  return "other";
}

function shouldSkipAsDuplicate(
  candidate: ContentItem,
  recentPublished: ContentItem[],
  similarityThreshold: number
): DuplicateReason | null {
  const candidatePrompt = normalizeText(candidate.image_prompt || compactPrompt(candidate));
  const candidateText = compactPrompt(candidate);
  const candidateLane = classifyVisualLane(candidate);

  for (const published of recentPublished) {
    const publishedPrompt = normalizeText(
      published.image_prompt || compactPrompt(published)
    );

    if (
      candidate.public_image_url &&
      published.public_image_url &&
      candidate.public_image_url === published.public_image_url
    ) {
      return {
        reason: "duplicate_public_image_url",
        matched_item_id: published.id,
        matched_concept_title: published.concept_title,
        matched_instagram_media_id: published.instagram_media_id,
        matched_published_at: published.published_at,
        lane: candidateLane
      };
    }

    if (candidatePrompt && publishedPrompt && candidatePrompt === publishedPrompt) {
      return {
        reason: "duplicate_image_prompt",
        matched_item_id: published.id,
        matched_concept_title: published.concept_title,
        matched_instagram_media_id: published.instagram_media_id,
        matched_published_at: published.published_at,
        lane: candidateLane
      };
    }

    if (
      normalizeText(candidate.concept_title) &&
      normalizeText(candidate.concept_title) === normalizeText(published.concept_title)
    ) {
      return {
        reason: "duplicate_concept_title",
        matched_item_id: published.id,
        matched_concept_title: published.concept_title,
        matched_instagram_media_id: published.instagram_media_id,
        matched_published_at: published.published_at,
        lane: candidateLane
      };
    }

    const similarity = jaccardSimilarity(candidateText, compactPrompt(published));
    if (similarity >= similarityThreshold) {
      return {
        reason: "near_duplicate_prompt_similarity",
        matched_item_id: published.id,
        matched_concept_title: published.concept_title,
        matched_instagram_media_id: published.instagram_media_id,
        matched_published_at: published.published_at,
        similarity: Number(similarity.toFixed(3)),
        lane: candidateLane
      };
    }
  }

  // Extra guard for the account's current weak point: repeated shadow/hall/stair thumbnails.
  // If the last two posts already use the same high-risk lane, do not publish another one.
  const highRiskLanes = new Set(["human_shadow", "staircase", "corridor"]);
  const lastTwo = recentPublished.slice(0, 2);
  if (highRiskLanes.has(candidateLane) && lastTwo.length > 0) {
    const match = lastTwo.find(
      (published) => classifyVisualLane(published) === candidateLane
    );

    if (match) {
      return {
        reason: "recent_visual_lane_repetition",
        matched_item_id: match.id,
        matched_concept_title: match.concept_title,
        matched_instagram_media_id: match.instagram_media_id,
        matched_published_at: match.published_at,
        lane: candidateLane
      };
    }
  }

  return null;
}

async function getDueReadyCandidates(nowIso: string) {
  return supabaseAdmin
    .from("content_items")
    .select("*")
    .eq("status", "approved")
    .eq("prompt_status", "approved")
    .neq("publish_status", "published")
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", nowIso)
    .not("public_image_url", "is", null)
    .neq("public_image_url", "")
    .not("queue_status", "eq", "posted")
    .not("queue_status", "eq", "permanently_failed")
    .not("queue_status", "eq", "skipped")
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
    .order("scheduled_for", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(MAX_CANDIDATES);
}

async function getRecentPublishedItems(limit: number) {
  return supabaseAdmin
    .from("content_items")
    .select(
      "id, concept_title, image_prompt, visual_brief, on_image_text, caption, public_image_url, instagram_media_id, published_at"
    )
    .eq("publish_status", "published")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(limit);
}

async function getOldestDueUnreadyItem(nowIso: string) {
  return supabaseAdmin
    .from("content_items")
    .select("id, concept_title, scheduled_for, render_status, queue_status, retry_count, last_error")
    .eq("status", "approved")
    .eq("prompt_status", "approved")
    .neq("publish_status", "published")
    .not("scheduled_for", "is", null)
    .lte("scheduled_for", nowIso)
    .or("public_image_url.is.null,public_image_url.eq.")
    .not("queue_status", "eq", "posted")
    .not("queue_status", "eq", "permanently_failed")
    .not("queue_status", "eq", "skipped")
    .order("scheduled_for", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
}

async function getRecentPublishedItem(now: Date, gapMinutes: number) {
  const sinceIso = new Date(now.getTime() - gapMinutes * 60 * 1000).toISOString();

  return supabaseAdmin
    .from("content_items")
    .select("id, concept_title, published_at, instagram_media_id")
    .eq("publish_status", "published")
    .not("published_at", "is", null)
    .gte("published_at", sinceIso)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

async function markDuplicateSkip(item: ContentItem, duplicate: DuplicateReason) {
  const message = `Skipped duplicate/near-duplicate before publishing: ${duplicate.reason}`;

  await supabaseAdmin
    .from("content_items")
    .update({
      workflow_state: "duplicate_skipped",
      queue_status: "skipped",
      scheduled_for: null,
      last_error: message,
      updated_at: new Date().toISOString()
    })
    .eq("id", item.id);

  return {
    id: item.id,
    concept_title: item.concept_title,
    scheduled_for: item.scheduled_for,
    duplicate
  };
}

async function markPermanentFailure(item: ContentItem, message: string) {
  await supabaseAdmin
    .from("content_items")
    .update({
      workflow_state: "permanently_failed",
      queue_status: "permanently_failed",
      last_error: message,
      updated_at: new Date().toISOString()
    })
    .eq("id", item.id);
}

async function markRetryFailure(item: ContentItem, message: string) {
  const retryCount = Number(item.retry_count ?? 0) + 1;

  await supabaseAdmin
    .from("content_items")
    .update({
      workflow_state: "failed",
      queue_status: retryCount >= MAX_RETRIES ? "permanently_failed" : "failed",
      last_error: message,
      retry_count: retryCount,
      next_run_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", item.id);
}

async function selectNonDuplicateCandidate(nowIso: string) {
  const [{ data: candidates, error: candidatesError }, { data: recent, error: recentError }] =
    await Promise.all([
      getDueReadyCandidates(nowIso),
      getRecentPublishedItems(getRecentDedupLimit())
    ]);

  if (candidatesError) {
    return { error: candidatesError, item: null, skippedDuplicates: [] };
  }

  if (recentError) {
    return { error: recentError, item: null, skippedDuplicates: [] };
  }

  const skippedDuplicates = [] as Array<Record<string, any>>;
  const recentPublished = recent || [];
  const threshold = getSimilarityThreshold();

  for (const candidate of candidates || []) {
    const duplicate = shouldSkipAsDuplicate(
      candidate,
      recentPublished,
      threshold
    );

    if (duplicate) {
      const skipped = await markDuplicateSkip(candidate, duplicate);
      skippedDuplicates.push(skipped);
      continue;
    }

    return { error: null, item: candidate, skippedDuplicates };
  }

  return { error: null, item: null, skippedDuplicates };
}

async function handle(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, version: VERSION, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const berlinTime = getBerlinTimeHHMM(nowDate);
    const force = isForce(req);
    const minPostGapMinutes = getMinPostGapMinutes();

    const { error, item, skippedDuplicates } = await selectNonDuplicateCandidate(nowIso);

    if (error) {
      return NextResponse.json(
        {
          success: false,
          version: VERSION,
          error: error.message
        },
        { status: 500 }
      );
    }

    if (!item) {
      const { data: blocked, error: blockedError } = await getOldestDueUnreadyItem(nowIso);

      return NextResponse.json({
        success: true,
        skipped: true,
        version: VERSION,
        reason: skippedDuplicates.length
          ? "Due media-ready items were skipped as duplicates; no safe item left to publish."
          : blocked
            ? "Due items exist, but none are media-ready. Render images first."
            : "No due media-ready item found",
        berlin_time: berlinTime,
        now: nowIso,
        mode: force ? "force" : "scheduled",
        skipped_duplicates: skippedDuplicates,
        blocked_unrendered_item: blocked || null,
        blocked_error: blockedError?.message || null
      });
    }

    if (!force && !isOperationalWindow(nowDate)) {
      return NextResponse.json({
        success: true,
        skipped: true,
        version: VERSION,
        item_id: item.id,
        concept_title: item.concept_title,
        reason: "Due item exists, but current Berlin time is outside operational window",
        berlin_time: berlinTime,
        operational_window: "08:45-21:30 Europe/Berlin",
        scheduled_for: item.scheduled_for,
        skipped_duplicates: skippedDuplicates
      });
    }

    if (!force && minPostGapMinutes > 0) {
      const { data: recent, error: recentError } = await getRecentPublishedItem(
        nowDate,
        minPostGapMinutes
      );

      if (recentError) {
        return NextResponse.json(
          {
            success: false,
            version: VERSION,
            error: recentError.message
          },
          { status: 500 }
        );
      }

      if (recent) {
        return NextResponse.json({
          success: true,
          skipped: true,
          version: VERSION,
          reason: "Recent post already published; skipping to prevent burst posting",
          berlin_time: berlinTime,
          min_post_gap_minutes: minPostGapMinutes,
          recent_post: recent,
          next_due_item: {
            id: item.id,
            concept_title: item.concept_title,
            scheduled_for: item.scheduled_for
          },
          skipped_duplicates: skippedDuplicates
        });
      }
    }

    const retryCount = Number(item.retry_count ?? 0);

    if (retryCount >= MAX_RETRIES) {
      await markPermanentFailure(item, item.last_error || "Retry limit reached");

      return NextResponse.json({
        success: true,
        skipped: true,
        version: VERSION,
        item_id: item.id,
        reason: "Retry limit reached",
        skipped_duplicates: skippedDuplicates
      });
    }

    await supabaseAdmin
      .from("content_items")
      .update({
        queue_status: "processing",
        last_error: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.id);

    if (!item.public_image_url) {
      return NextResponse.json(
        {
          success: false,
          version: VERSION,
          step: "media_ready_guard",
          item_id: item.id,
          concept_title: item.concept_title,
          error: "Worker selected an item without public_image_url. This should not happen in V7.3."
        },
        { status: 500 }
      );
    }

    try {
      const result = await runPublishFlow(item, supabaseAdmin);

      return NextResponse.json({
        success: true,
        version: VERSION,
        item_id: item.id,
        concept_title: item.concept_title,
        scheduled_for: item.scheduled_for,
        visual_lane: classifyVisualLane(item),
        published: result.step === "published",
        instagramMediaId: result.step === "published" ? result.media_id : null,
        berlin_time: berlinTime,
        mode: force ? "force" : "scheduled",
        skipped_duplicates: skippedDuplicates,
        result
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown publish flow error";

      await markRetryFailure(item, message);

      return NextResponse.json(
        {
          success: false,
          version: VERSION,
          item_id: item.id,
          concept_title: item.concept_title,
          error: message,
          skipped_duplicates: skippedDuplicates
        },
        { status: 500 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        version: VERSION,
        error: err instanceof Error ? err.message : "Unknown worker error"
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
