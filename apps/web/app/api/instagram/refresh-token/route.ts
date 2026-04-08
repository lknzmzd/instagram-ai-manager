import { NextRequest, NextResponse } from "next/server";
import {
  getActiveInstagramAccount,
  refreshInstagramLongLivedToken,
  updateInstagramAccountToken
} from "@/lib/instagramTokens";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const account = await getActiveInstagramAccount();

    const refreshed = await refreshInstagramLongLivedToken(account.access_token);

    await updateInstagramAccountToken({
      accountId: account.id,
      accessToken: refreshed.accessToken,
      tokenType: refreshed.tokenType,
      expiresAt: refreshed.expiresAt
    });

    return NextResponse.json({
      success: true,
      refreshed: true,
      expires_at: refreshed.expiresAt
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown refresh error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}