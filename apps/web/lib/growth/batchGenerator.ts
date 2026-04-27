export async function generateBatch(topic: string) {
  const prompts = [
    `Dark minimal concept about ${topic}`,
    `Psychological hook about ${topic}`,
    `Controversial fact about ${topic}`
  ];

  for (const prompt of prompts) {
    await supabaseAdmin.from("content_items").insert({
      prompt,
      workflow_state: "approved",
      next_run_at: new Date().toISOString()
    });
  }
}