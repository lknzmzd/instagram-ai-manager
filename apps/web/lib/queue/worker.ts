// /lib/queue/worker.ts

import { supabaseAdmin } from "@/lib/supabase";
import { processJob } from "./processJob";

export async function runWorker() {
  const { data: jobs } = await supabaseAdmin
    .from("content_items")
    .select("*")
    .lte("next_run_at", new Date().toISOString())
    .limit(5);

  for (const job of jobs || []) {
    try {
      await processJob(job);
    } catch (err: any) {
      await supabaseAdmin
        .from("content_items")
        .update({
          workflow_state: "failed",
          last_error: err.message,
          retry_count: job.retry_count + 1
        })
        .eq("id", job.id);
    }
  }
}