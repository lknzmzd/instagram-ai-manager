import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { generateBatch } from "@/lib/generateBatch";

const requestSchema = z.object({
  page_slug: z.string().min(1),
  count: z.number().int().min(1).max(21),
  goal: z.string().min(1),

  // when true, items are prepared for full automation
  auto_queue: z.boolean().optional().default(false),

  // Europe/Berlin by default
  timezone: z.string().min(1).optional().default("Europe/Berlin"),

  // optional local start date in YYYY-MM-DD
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function getBatchId() {
  return `batch_${Date.now()}`;
}

function formatInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: map.weekday
  };
}

function getTodayInTimeZone(timeZone: string) {
  const now = new Date();
  const parts = formatInTimeZone(now, timeZone);

  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day
  ).padStart(2, "0")}`;
}

function addDaysToDateString(dateStr: string, days: number) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);

  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function zonedLocalToUtcIso(local: LocalParts, timeZone: string) {
  const target = {
    year: local.year,
    month: local.month,
    day: local.day,
    hour: local.hour,
    minute: local.minute
  };

  const guessUtcMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    0
  );

  for (let offsetMinutes = -24 * 60; offsetMinutes <= 24 * 60; offsetMinutes += 15) {
    const candidate = new Date(guessUtcMs - offsetMinutes * 60 * 1000);

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(candidate);

    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

    const candidateLocal = {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour),
      minute: Number(map.minute)
    };

    if (
      candidateLocal.year === target.year &&
      candidateLocal.month === target.month &&
      candidateLocal.day === target.day &&
      candidateLocal.hour === target.hour &&
      candidateLocal.minute === target.minute
    ) {
      return candidate.toISOString();
    }
  }

  throw new Error(
    `Failed to convert local time ${local.year}-${String(local.month).padStart(
      2,
      "0"
    )}-${String(local.day).padStart(2, "0")} ${String(local.hour).padStart(
      2,
      "0"
    )}:${String(local.minute).padStart(2, "0")} in ${timeZone} to UTC`
  );
}

function buildPostingSlots(params: {
  count: number;
  timeZone: string;
  startDate: string;
}) {
  const postingHours = [9, 12, 18];
  const slots: string[] = [];

  for (let i = 0; i < params.count; i++) {
    const dayOffset = Math.floor(i / postingHours.length);
    const slotIndex = i % postingHours.length;
    const localDate = addDaysToDateString(params.startDate, dayOffset);

    const [year, month, day] = localDate.split("-").map(Number);
    const hour = postingHours[slotIndex];

    const scheduledFor = zonedLocalToUtcIso(
      {
        year,
        month,
        day,
        hour,
        minute: 0
      },
      params.timeZone
    );

    slots.push(scheduledFor);
  }

  return slots;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = requestSchema.parse(body);

    const { data: page, error: pageError } = await supabaseAdmin
      .from("pages")
      .select("*")
      .eq("slug", parsed.page_slug)
      .single();

    if (pageError || !page) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 });
    }

    const { data: recentRows } = await supabaseAdmin
      .from("content_items")
      .select("concept_title")
      .eq("page_id", page.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const recentConcepts =
      recentRows?.map((row) => row.concept_title).filter(Boolean) ?? [];

    const items = await generateBatch({
      page,
      count: parsed.count,
      goal: parsed.goal,
      recentConcepts
    });

    const batchId = getBatchId();
    const startDate = parsed.start_date || getTodayInTimeZone(parsed.timezone);
    const slots = parsed.auto_queue
      ? buildPostingSlots({
          count: items.length,
          timeZone: parsed.timezone,
          startDate
        })
      : [];

    const rowsToInsert = items.map((item, index) => ({
      page_id: page.id,

      // full automation mode: create items already ready for pipeline
      status: parsed.auto_queue ? "approved" : "drafted",
      prompt_status: parsed.auto_queue ? "approved" : "pending",
      queue_status: parsed.auto_queue ? "ready" : "pending",

      post_type: item.post_type,
      concept_title: item.concept_title,
      visual_brief: item.visual_brief,
      on_image_text: item.on_image_text,
      caption: item.caption,
      hashtags: item.hashtags,
      voiceover_script: item.voiceover_script,

      automation_batch_id: parsed.auto_queue ? batchId : null,
      scheduled_for: parsed.auto_queue ? slots[index] : null,

      created_by: "system"
    }));

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("content_items")
      .insert(rowsToInsert)
      .select("*");

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      automation_enabled: parsed.auto_queue,
      batch_id: parsed.auto_queue ? batchId : null,
      timezone: parsed.timezone,
      start_date: startDate,
      items_created: inserted.length,
      scheduled_slots: parsed.auto_queue ? slots : [],
      items: inserted
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown server error";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}