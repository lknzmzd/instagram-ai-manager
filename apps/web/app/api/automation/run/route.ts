import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { success: false, error: "CRON_SECRET is missing" },
      { status: 500 }
    );
  }

  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/api/automation/worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cronSecret}`
    },
    cache: "no-store"
  });

  const raw = await res.text();

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }

  return NextResponse.json(
    {
      ...data,
      proxy: "/api/automation/run -> /api/automation/worker"
    },
    { status: res.status }
  );
}
