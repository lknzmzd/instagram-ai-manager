import { NextRequest, NextResponse } from "next/server";

function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (!cronSecret) return false;
  return authHeader === `Bearer ${cronSecret}`;
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const origin = new URL(req.url).origin;
    const res = await fetch(`${origin}/api/automation/worker`, {
      method: "POST",
      headers: {
        Authorization: req.headers.get("authorization") || ""
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
        proxy: "/api/automation/run-scheduled-posts -> /api/automation/worker"
      },
      { status: res.status }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown scheduled automation error"
      },
      { status: 500 }
    );
  }
}
