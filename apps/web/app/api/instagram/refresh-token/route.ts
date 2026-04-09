import { NextRequest, NextResponse } from "next/server";
import {
  getActiveInstagramAccount,
  getInstagramTokenHealth,
  getValidInstagramCredentials,
  hasInstagramTokenExpired,
  isInstagramTokenRefreshEligible,
  refreshInstagramLongLivedToken,
  shouldRefreshInstagramToken,
  updateInstagramAccountToken
} from "@/lib/instagramTokens";

function isAuthorized(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const health = await getInstagramTokenHealth();

    return NextResponse.json({
      success: true,
      health
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown token health error";

    return NextResponse.json(
      {
        success: false,
        error: message
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const account = await getActiveInstagramAccount();

    const isExpired = hasInstagramTokenExpired(account.expires_at);
    const shouldRefreshSoon = shouldRefreshInstagramToken(account.expires_at, 7);
    const isRefreshEligible = isInstagramTokenRefreshEligible(account);

    if (isExpired) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Instagram access token is expired. Reconnect the account and store a new long-lived token.",
          health: {
            accountId: account.id,
            accountName: account.account_name,
            instagramBusinessId: account.instagram_business_id,
            expiresAt: account.expires_at,
            lastRefreshedAt: account.last_refreshed_at,
            isExpired,
            shouldRefreshSoon,
            isRefreshEligible
          }
        },
        { status: 400 }
      );
    }

    if (!isRefreshEligible) {
      const credentials = await getValidInstagramCredentials({
        forceRefresh: false
      });

      return NextResponse.json({
        success: true,
        refreshed: false,
        reason: "Token is not yet eligible for refresh",
        health: {
          accountId: account.id,
          accountName: account.account_name,
          instagramBusinessId: account.instagram_business_id,
          expiresAt: credentials.expiresAt,
          lastRefreshedAt: account.last_refreshed_at,
          isExpired: credentials.isExpired,
          shouldRefreshSoon: credentials.shouldRefreshSoon,
          isRefreshEligible
        }
      });
    }

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
      expires_at: refreshed.expiresAt,
      token_type: refreshed.tokenType,
      health: {
        accountId: account.id,
        accountName: account.account_name,
        instagramBusinessId: account.instagram_business_id,
        expiresAt: refreshed.expiresAt,
        isExpired: false,
        shouldRefreshSoon: shouldRefreshInstagramToken(refreshed.expiresAt, 7),
        isRefreshEligible: false
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown refresh error";

    return NextResponse.json(
      {
        success: false,
        error: message
      },
      { status: 500 }
    );
  }
}