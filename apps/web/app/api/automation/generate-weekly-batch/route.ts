import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const DEFAULT_PAGE_SLUG = "mortaena";
const DEFAULT_GOAL = "growth";
const DEFAULT_COUNT = 21;
const DEFAULT_TIMEZONE = "Europe/Berlin";

function isAuthorized(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) return false;

  return authHeader === `Bearer ${cronSecret}`;
}

function getLocalDateString(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return `${map.year}-${map.month}-${map.day}`;
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

function zonedLocalToUtcIso(
  local: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  },
  timeZone: string
) {
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

    if (
      Number(map.year) === local.year &&
      Number(map.month) === local.month &&
      Number(map.day) === local.day &&
      Number(map.hour) === local.hour &&
      Number(map.minute) === local.minute
    ) {
      return candidate.toISOString();
    }
  }

  throw new Error(
    `Failed timezone conversion for ${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")} ${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")} in ${timeZone}`
  );
}

async function callInternalJson(
  req: NextRequest,
  path: string,
  payload: Record<string, unknown>
) {
  const origin = new URL(req.url).origin;

  const res = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  const raw = await res.text();

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }

  return { res, data };
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    let body: {
      page_slug?: string;
      goal?: string;
      count?: number;
      timezone?: string;
      force?: boolean;
    } = {};

    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const pageSlug = body.page_slug || DEFAULT_PAGE_SLUG;
    const goal = body.goal || DEFAULT_GOAL;
    const count = body.count || DEFAULT_COUNT;
    const timezone = body.timezone || DEFAULT_TIMEZONE;
    const force = body.force === true;

    if (count !== 21) {
      return NextResponse.json(
        {
          success: false,
          error: "Weekly automation count must be 21"
        },
        { status: 400 }
      );
    }

    const { data: page, error: pageError } = await supabaseAdmin
      .from("pages")
      .select("id, slug")
      .eq("slug", pageSlug)
      .single();

    if (pageError || !page) {
      return NextResponse.json(
        {
          success: false,
          error: "Page not found"
        },
        { status: 404 }
      );
    }

    const localStartDate = getLocalDateString(new Date(), timezone);
    const localEndDateExclusive = addDaysToDateString(localStartDate, 7);

    const [startYear, startMonth, startDay] = localStartDate.split("-").map(Number);
    const [endYear, endMonth, endDay] = localEndDateExclusive.split("-").map(Number);

    const startUtc = zonedLocalToUtcIso(
      {
        year: startYear,
        month: startMonth,
        day: startDay,
        hour: 0,
        minute: 0
      },
      timezone
    );

    const endUtc = zonedLocalToUtcIso(
      {
        year: endYear,
        month: endMonth,
        day: endDay,
        hour: 0,
        minute: 0
      },
      timezone
    );

    if (!force) {
      const { count: existingCount, error: existingError } = await supabaseAdmin
        .from("content_items")
        .select("*", { count: "exact", head: true })
        .eq("page_id", page.id)
        .not("scheduled_for", "is", null)
        .gte("scheduled_for", startUtc)
        .lt("scheduled_for", endUtc);

      if (existingError) {
        return NextResponse.json(
          {
            success: false,
            error: existingError.message
          },
          { status: 500 }
        );
      }

      if ((existingCount || 0) >= 21) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: "A full 7-day queue already exists",
          page_slug: pageSlug,
          timezone,
          existing_count: existingCount,
          window_start: startUtc,
          window_end: endUtc
        });
      }
    }

    const generated = await callInternalJson(
      req,
      "/api/content/generate-batch",
      {
        page_slug: pageSlug,
        count,
        goal,
        auto_queue: true,
        timezone,
        start_date: localStartDate
      }
    );

    if (!generated.res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: generated.data?.error || "Failed to generate weekly batch",
          meta: generated.data
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      automation: "weekly_batch_created",
      page_slug: pageSlug,
      goal,
      count,
      timezone,
      local_start_date: localStartDate,
      window_start: startUtc,
      window_end: endUtc,
      result: generated.data
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown weekly automation error"
      },
      { status: 500 }
    );
  }
}