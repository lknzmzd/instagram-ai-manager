import { supabaseAdmin } from "@/lib/supabase";

export async function generateBatch(topic: string) {
  const prompts = [
    `Dark minimal concept about ${topic}`,
    `Psychological hook about ${topic}`,
    `Controversial fact about ${topic}`
  ];

  for (const prompt of prompts) {
    await supabaseAdmin.from("content_items").insert({
      prompt,
      status: "approved",
      workflow_state: "approved",
      queue_status: "queued",
      next_run_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
  }
}