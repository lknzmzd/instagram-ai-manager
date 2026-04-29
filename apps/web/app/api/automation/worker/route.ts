import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runPublishFlow } from "@/lib/instagram/publishFlow";

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  return !!cronSecret && authHeader === `Bearer ${cronSecret}`;
}

function getBerlinTimeHHMM(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function isPublishSlot(berlinTime: string) {
  const allowedSlots = ["09:00", "15:00", "21:00"];

  const [nowHour, nowMinute] = berlinTime.split(":").map(Number);
  const nowTotal = nowHour * 60 + nowMinute;

  return allowedSlots.some((slot) => {
    const [slotHour, slotMinute] = slot.split(":").map(Number);
    const slotTotal = slotHour * 60 + slotMinute;

    return nowTotal >= slotTotal && nowTotal < slotTotal + 15;
  });
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const berlinTime = getBerlinTimeHHMM(nowDate);
    const allowedSlots = ["09:00", "15:00", "21:00"];

    if (!isPublishSlot(berlinTime)) {
      return NextResponse.json({
        success: true,
        skipped: true,
        version: "V6_3_POSTS_PER_DAY",
        reason: "Not a publish slot",
        berlin_time: berlinTime,
        allowed_slots: allowedSlots
      });
    }

    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("status", "approved")
      .neq("publish_status", "published")
      .not("public_image_url", "is", null)
      .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          success: false,
          version: "V6_3_POSTS_PER_DAY",
          error: error.message
        },
        { status: 500 }
      );
    }

    if (!item) {
      return NextResponse.json({
        success: true,
        skipped: true,
        version: "V6_3_POSTS_PER_DAY",
        reason: "No publish-ready item found",
        berlin_time: berlinTime
      });
    }

    const retryCount = Number(item.retry_count ?? 0);

    if (retryCount >= 5) {
      await supabaseAdmin
        .from("content_items")
        .update({
          workflow_state: "permanently_failed",
          queue_status: "permanently_failed",
          last_error: item.last_error || "Retry limit reached",
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id);

      return NextResponse.json({
        success: true,
        skipped: true,
        version: "V6_3_POSTS_PER_DAY",
        item_id: item.id,
        reason: "Retry limit reached"
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

    try {
      const result = await runPublishFlow(item, supabaseAdmin);

      return NextResponse.json({
        success: true,
        version: "V6_3_POSTS_PER_DAY",
        item_id: item.id,
        result
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown publish flow error";

      await supabaseAdmin
        .from("content_items")
        .update({
          workflow_state: "failed",
          queue_status: "failed",
          last_error: message,
          retry_count: retryCount + 1,
          next_run_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id);

      return NextResponse.json(
        {
          success: false,
          version: "V6_3_POSTS_PER_DAY",
          item_id: item.id,
          error: message
        },
        { status: 500 }
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        version: "V6_3_POSTS_PER_DAY",
        error: err instanceof Error ? err.message : "Unknown worker error"
      },
      { status: 500 }
    );
  }
}