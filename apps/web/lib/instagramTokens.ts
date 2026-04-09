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

export type ValidInstagramCredentials = {
  instagramBusinessId: string;
  accessToken: string;
  tokenSource: "existing" | "refreshed";
  expiresAt: string | null;
  shouldRefreshSoon: boolean;
  isExpired: boolean;
};

export type InstagramTokenValidationResult = {
  valid: boolean;
  error?: string | null;
  meta?: {
    app_id?: string;
    type?: string;
    application?: string;
    expires_at?: number;
    is_valid?: boolean;
    profile_id?: string;
    user_id?: string;
    scopes?: string[];
  } | null;
  instagramUser?: {
    id?: string;
    username?: string;
  } | null;
  matchesStoredBusinessId?: boolean | null;
};

const REFRESH_BEFORE_DAYS = 7;
const MIN_REFRESH_AGE_HOURS = 24;
const GRAPH_BASE = "https://graph.facebook.com";

function addSecondsToNow(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function hoursBetween(dateIso: string | null) {
  if (!dateIso) return null;

  const ms = new Date(dateIso).getTime();
  if (Number.isNaN(ms)) return null;

  return (Date.now() - ms) / (1000 * 60 * 60);
}

export function hasInstagramTokenExpired(expiresAt: string | null) {
  if (!expiresAt) return false;

  const expiryMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiryMs)) return false;

  return expiryMs <= Date.now();
}

export function shouldRefreshInstagramToken(
  expiresAt: string | null,
  refreshBeforeDays = REFRESH_BEFORE_DAYS
) {
  if (!expiresAt) return true;

  const expiryMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiryMs)) return true;

  const nowMs = Date.now();
  const thresholdMs = refreshBeforeDays * 24 * 60 * 60 * 1000;

  return expiryMs - nowMs <= thresholdMs;
}

export function isInstagramTokenRefreshEligible(account: InstagramAccountRow) {
  if (hasInstagramTokenExpired(account.expires_at)) {
    return false;
  }

  const refreshBaseTime =
    account.last_refreshed_at || account.updated_at || account.created_at || null;

  const ageHours = hoursBetween(refreshBaseTime);

  if (ageHours === null) {
    return true;
  }

  return ageHours >= MIN_REFRESH_AGE_HOURS;
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

async function safeJson(response: Response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function validateInstagramAccessToken(
  account?: InstagramAccountRow
): Promise<InstagramTokenValidationResult> {
  const activeAccount = account ?? (await getActiveInstagramAccount());
  const appToken = process.env.META_APP_ID && process.env.META_APP_SECRET
    ? `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`
    : null;

  if (!appToken) {
    return {
      valid: false,
      error: "META_APP_ID or META_APP_SECRET is missing"
    };
  }

  const debugUrl = new URL(`${GRAPH_BASE}/debug_token`);
  debugUrl.searchParams.set("input_token", activeAccount.access_token);
  debugUrl.searchParams.set("access_token", appToken);

  const debugRes = await fetch(debugUrl.toString(), {
    method: "GET",
    cache: "no-store"
  });

  const debugData = await safeJson(debugRes);

  if (!debugRes.ok) {
    return {
      valid: false,
      error:
        debugData?.error?.message ||
        debugData?.raw ||
        "Failed to debug Instagram token",
      meta: null,
      instagramUser: null,
      matchesStoredBusinessId: null
    };
  }

  const tokenData = debugData?.data;
  const isValid = Boolean(tokenData?.is_valid);

  if (!isValid) {
    return {
      valid: false,
      error: tokenData?.error?.message || "Token is not valid",
      meta: tokenData ?? null,
      instagramUser: null,
      matchesStoredBusinessId: null
    };
  }

  const meUrl = new URL(`${GRAPH_BASE}/v24.0/me`);
  meUrl.searchParams.set("fields", "id,username");
  meUrl.searchParams.set("access_token", activeAccount.access_token);

  const meRes = await fetch(meUrl.toString(), {
    method: "GET",
    cache: "no-store"
  });

  const meData = await safeJson(meRes);

  let instagramUser: { id?: string; username?: string } | null = null;
  let matchesStoredBusinessId: boolean | null = null;

  if (meRes.ok) {
    instagramUser = {
      id: meData?.id,
      username: meData?.username
    };

    if (meData?.id) {
      matchesStoredBusinessId =
        String(meData.id) === String(activeAccount.instagram_business_id);
    }
  }

  return {
    valid: true,
    error: null,
    meta: tokenData ?? null,
    instagramUser,
    matchesStoredBusinessId
  };
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

  let data: {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: {
      message?: string;
      type?: string;
      code?: number;
      error_subcode?: number;
    };
  };

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Instagram refresh failed: ${text}`);
  }

  if (!res.ok) {
    const message =
      data?.error?.message || text || "Instagram refresh request failed";
    throw new Error(`Instagram refresh failed: ${message}`);
  }

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

export async function getValidInstagramCredentials(
  options?: {
    forceRefresh?: boolean;
    refreshBeforeDays?: number;
  }
): Promise<ValidInstagramCredentials> {
  const forceRefresh = options?.forceRefresh ?? false;
  const refreshBeforeDays = options?.refreshBeforeDays ?? REFRESH_BEFORE_DAYS;

  const account = await getActiveInstagramAccount();

  const liveValidation = await validateInstagramAccessToken(account);

  if (!liveValidation.valid) {
    throw new Error(
      liveValidation.error ||
        "Instagram access token is invalid. Reconnect the account and store a new long-lived token."
    );
  }

  if (liveValidation.matchesStoredBusinessId === false) {
    throw new Error(
      "Stored instagram_business_id does not match the token owner. Update the active database record."
    );
  }

  const isExpired = hasInstagramTokenExpired(account.expires_at);
  const shouldRefreshSoon = shouldRefreshInstagramToken(
    account.expires_at,
    refreshBeforeDays
  );

  if (isExpired) {
    throw new Error(
      "Instagram access token is expired. Reconnect the account and store a new long-lived token."
    );
  }

  const needsRefresh = forceRefresh || shouldRefreshSoon;

  if (!needsRefresh) {
    return {
      instagramBusinessId: account.instagram_business_id,
      accessToken: account.access_token,
      tokenSource: "existing",
      expiresAt: account.expires_at,
      shouldRefreshSoon,
      isExpired: false
    };
  }

  const eligibleForRefresh = isInstagramTokenRefreshEligible(account);

  if (!eligibleForRefresh) {
    return {
      instagramBusinessId: account.instagram_business_id,
      accessToken: account.access_token,
      tokenSource: "existing",
      expiresAt: account.expires_at,
      shouldRefreshSoon,
      isExpired: false
    };
  }

  try {
    const refreshed = await refreshInstagramLongLivedToken(account.access_token);

    await updateInstagramAccountToken({
      accountId: account.id,
      accessToken: refreshed.accessToken,
      tokenType: refreshed.tokenType,
      expiresAt: refreshed.expiresAt
    });

    return {
      instagramBusinessId: account.instagram_business_id,
      accessToken: refreshed.accessToken,
      tokenSource: "refreshed",
      expiresAt: refreshed.expiresAt,
      shouldRefreshSoon: shouldRefreshInstagramToken(
        refreshed.expiresAt,
        refreshBeforeDays
      ),
      isExpired: false
    };
  } catch {
    return {
      instagramBusinessId: account.instagram_business_id,
      accessToken: account.access_token,
      tokenSource: "existing",
      expiresAt: account.expires_at,
      shouldRefreshSoon: true,
      isExpired: false
    };
  }
}

export async function getInstagramTokenHealth() {
  const account = await getActiveInstagramAccount();
  const validation = await validateInstagramAccessToken(account);

  return {
    accountId: account.id,
    accountName: account.account_name,
    instagramBusinessId: account.instagram_business_id,
    expiresAt: account.expires_at,
    lastRefreshedAt: account.last_refreshed_at,
    isExpired: hasInstagramTokenExpired(account.expires_at),
    shouldRefreshSoon: shouldRefreshInstagramToken(account.expires_at),
    isRefreshEligible: isInstagramTokenRefreshEligible(account),
    metaValid: validation.valid,
    metaError: validation.error ?? null,
    tokenOwnerId: validation.instagramUser?.id ?? null,
    tokenOwnerUsername: validation.instagramUser?.username ?? null,
    matchesStoredBusinessId: validation.matchesStoredBusinessId
  };
}