import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (!cronSecret) {
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
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

  return {
    ok: res.ok,
    status: res.status,
    data
  };
}

async function failItem(id: string, message: string, retryCount: number) {
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
    .eq("id", id);
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized"
        },
        { status: 401 }
      );
    }

    const now = new Date().toISOString();

    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .neq("publish_status", "published")
      .in("workflow_state", [
        "draft",
        "uploaded",
        "container_created",
        "container_ready"
      ])
      .or(`next_run_at.is.null,next_run_at.lte.${now}`)
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: error.message
        },
        { status: 500 }
      );
    }

    if (item.workflow_state === "draft") {
      const origin = new URL(req.url).origin;

      const res = await fetch(`${origin}/api/content/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
        cache: "no-store"
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Image generation failed");
      }

      await supabaseAdmin
        .from("content_items")
        .update({
          workflow_state: "uploaded",
          queue_status: "queued",
          next_run_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", item.id);

      return NextResponse.json({
        success: true,
        item_id: item.id,
        result: {
          step: "generate_image",
          next: "uploaded"
        }
      });
    }

    console.log("WORKER_SELECTED_ITEM", item);

    if (!item) {
      const { data: debugRows } = await supabaseAdmin
        .from("content_items")
        .select("id,status,publish_status,workflow_state,queue_status,public_image_url,next_run_at")
        .order("created_at", { ascending: false })
        .limit(5);

      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "No automation item ready",
        debugRows
      });
    }

    // ONLY AFTER this point item is guaranteed NOT NULL

    const retryCount = Number(item.retry_count ?? 0);

    if (retryCount >= 5) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "Retry limit reached",
        item_id: item.id
      });
    }

    await supabaseAdmin
      .from("content_items")
      .update({
        queue_status: "processing",
        last_error: null,
        updated_at: now
      })
      .eq("id", item.id);

    let current = item;

    if (!current.public_image_url) {
      const generated = await callInternalJson(
        req,
        "/api/content/generate-image",
        {
          id: current.id
        }
      );

      if (!generated.ok) {
        const msg =
          generated.data?.error ||
          generated.data?.raw ||
          "Image generation failed";

        await failItem(current.id, String(msg), retryCount);

        return NextResponse.json(
          {
            success: false,
            step: "generate_image",
            item_id: current.id,
            error: msg,
            meta: generated.data
          },
          { status: 500 }
        );
      }

      const { data: refreshed, error: refreshError } = await supabaseAdmin
        .from("content_items")
        .select("*")
        .eq("id", current.id)
        .single();

      if (refreshError || !refreshed?.public_image_url) {
        const msg = "Image generation finished, but public_image_url is missing";

        await failItem(current.id, msg, retryCount);

        return NextResponse.json(
          {
            success: false,
            step: "verify_public_image_url",
            item_id: current.id,
            error: msg
          },
          { status: 500 }
        );
      }

      current = refreshed;

      await supabaseAdmin
        .from("content_items")
        .update({
          workflow_state: "uploaded",
          render_status: "rendered",
          queue_status: "processing",
          updated_at: new Date().toISOString()
        })
        .eq("id", current.id);
    }

    const published = await callInternalJson(
      req,
      "/api/content/publish-instagram",
      {
        id: current.id,
        scheduled_run: true,
        debug: true
      }
    );

    if (!published.ok) {
      const msg =
        published.data?.error ||
        published.data?.raw ||
        "Instagram publish failed";

      await failItem(current.id, String(msg), retryCount);

      return NextResponse.json(
        {
          success: false,
          step: "publish_instagram",
          item_id: current.id,
          error: msg,
          meta: published.data
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      item_id: current.id,
      result: published.data
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown automation worker error"
      },
      { status: 500 }
    );
  }
}