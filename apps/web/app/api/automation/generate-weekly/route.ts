import { NextRequest } from "next/server";
import { POST as runWeeklyBatch } from "../generate-weekly-batch/route";

export async function GET() {
  const req = new Request("http://localhost/api/automation/generate-weekly-batch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET || ""}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });

  return runWeeklyBatch(req as unknown as NextRequest);
}

export async function POST() {
  const req = new Request("http://localhost/api/automation/generate-weekly-batch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET || ""}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });

  return runWeeklyBatch(req as unknown as NextRequest);
}