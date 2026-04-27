import { runWorker } from "@/lib/queue/worker";

export async function GET() {
  await runWorker();
  return Response.json({ ok: true });
}