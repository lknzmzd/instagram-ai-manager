import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";

async function postJson(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error || `Request failed: ${path}`);
  }

  return data;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const pageSlug = body.page_slug || "mortaena";
    const count = Number(body.count || 3);
    const goal = body.goal || "growth";

    const { data: runRow, error: runInsertError } = await supabaseAdmin
      .from("automation_runs")
      .insert({
        page_slug: pageSlug,
        target_count: count,
        status: "running"
      })
      .select("*")
      .single();

    if (runInsertError || !runRow) {
      return NextResponse.json(
        { error: runInsertError?.message || "Failed to create automation run" },
        { status: 500 }
      );
    }

    const details: Array<Record<string, unknown>> = [];
    let successCount = 0;
    let failureCount = 0;

    // Step 1: generate 3 content items
    const generated = await postJson("/api/content/generate-batch", {
      page_slug: pageSlug,
      count,
      goal
    });

    const items = Array.isArray(generated.items) ? generated.items : [];

    for (const item of items) {
      const logEntry: Record<string, unknown> = {
        content_item_id: item.id,
        concept_title: item.concept_title,
        steps: []
      };

      try {
        // Step 2: approve content
        await postJson("/api/content/update-status", {
          id: item.id,
          status: "approved",
          extra_fields: {
            prompt_status: "approved"
          }
        });
        (logEntry.steps as Array<unknown>).push("approved");

        // Step 3: generate image
        await postJson("/api/content/generate-image", {
          id: item.id
        });
        (logEntry.steps as Array<unknown>).push("image_generated");

        // Step 4: upload to storage
        await postJson("/api/content/upload-to-storage", {
          id: item.id
        });
        (logEntry.steps as Array<unknown>).push("uploaded_to_storage");

        // Step 5: publish to Instagram
        await postJson("/api/content/publish-instagram", {
          id: item.id
        });
        (logEntry.steps as Array<unknown>).push("published_to_instagram");

        logEntry.status = "success";
        successCount += 1;
      } catch (err) {
        logEntry.status = "failed";
        logEntry.error =
          err instanceof Error ? err.message : "Unknown pipeline error";
        failureCount += 1;
      }

      details.push(logEntry);
    }

    const finalStatus =
      failureCount === 0
        ? "success"
        : successCount > 0
        ? "partial_success"
        : "failed";

    await supabaseAdmin
      .from("automation_runs")
      .update({
        success_count: successCount,
        failure_count: failureCount,
        status: finalStatus,
        details,
        finished_at: new Date().toISOString()
      })
      .eq("id", runRow.id);

    return NextResponse.json({
      success: true,
      run_id: runRow.id,
      status: finalStatus,
      success_count: successCount,
      failure_count: failureCount,
      details
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown automation error"
      },
      { status: 500 }
    );
  }
}