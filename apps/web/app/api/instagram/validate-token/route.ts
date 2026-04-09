import { NextResponse } from "next/server";
import {
  getActiveInstagramAccount,
  validateInstagramAccessToken
} from "@/lib/instagramTokens";

export async function GET() {
  try {
    const account = await getActiveInstagramAccount();
    const validation = await validateInstagramAccessToken(account);

    return NextResponse.json({
      success: true,
      active_account: {
        id: account.id,
        account_name: account.account_name,
        instagram_business_id: account.instagram_business_id,
        expires_at: account.expires_at,
        last_refreshed_at: account.last_refreshed_at,
        is_active: account.is_active
      },
      validation
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to validate token"
      },
      { status: 500 }
    );
  }
}