import { supabaseAdmin } from "@/lib/supabase";

export type InstagramAccountRow = {
  id: string;
  account_name: string | null;
  instagram_business_id: string;
  access_token: string;
  token_type: string | null;
  scopes: string[] | null;
  expires_at: string | null;
  last_refreshed_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function addSecondsToNow(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function shouldRefreshInstagramToken(
  expiresAt: string | null,
  refreshBeforeDays = 7
) {
  if (!expiresAt) return true;

  const expiryMs = new Date(expiresAt).getTime();
  const nowMs = Date.now();
  const thresholdMs = refreshBeforeDays * 24 * 60 * 60 * 1000;

  return expiryMs - nowMs <= thresholdMs;
}

export async function getActiveInstagramAccount(): Promise<InstagramAccountRow> {
  const { data, error } = await supabaseAdmin
    .from("instagram_accounts")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .single();

  if (error || !data) {
    throw new Error("No active Instagram account found");
  }

  return data as InstagramAccountRow;
}

export async function refreshInstagramLongLivedToken(currentToken: string) {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", currentToken);

  const res = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store"
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Instagram refresh failed: ${text}`);
  }

  const data = JSON.parse(text) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new Error("Instagram refresh returned no access_token");
  }

  return {
    accessToken: data.access_token,
    tokenType: data.token_type ?? "Bearer",
    expiresAt: data.expires_in ? addSecondsToNow(data.expires_in) : null
  };
}

export async function updateInstagramAccountToken(params: {
  accountId: string;
  accessToken: string;
  tokenType: string | null;
  expiresAt: string | null;
}) {
  const { error } = await supabaseAdmin
    .from("instagram_accounts")
    .update({
      access_token: params.accessToken,
      token_type: params.tokenType,
      expires_at: params.expiresAt,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", params.accountId);

  if (error) {
    throw new Error(`Failed to update Instagram token: ${error.message}`);
  }
}

export async function getValidInstagramCredentials() {
  const account = await getActiveInstagramAccount();

  if (shouldRefreshInstagramToken(account.expires_at, 7)) {
    const refreshed = await refreshInstagramLongLivedToken(account.access_token);

    await updateInstagramAccountToken({
      accountId: account.id,
      accessToken: refreshed.accessToken,
      tokenType: refreshed.tokenType,
      expiresAt: refreshed.expiresAt
    });

    return {
      instagramBusinessId: account.instagram_business_id,
      accessToken: refreshed.accessToken
    };
  }

  return {
    instagramBusinessId: account.instagram_business_id,
    accessToken: account.access_token
  };
}