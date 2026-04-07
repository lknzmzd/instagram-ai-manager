type CanvaTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

type CanvaCreateDesignResponse = {
  design?: {
    id: string;
    title?: string;
  };
};

type CanvaCreateExportJobResponse = {
  job?: {
    id: string;
    status?: string;
  };
};

type CanvaExportJobResponse = {
  job?: {
    id: string;
    status: "in_progress" | "success" | "failed";
    result?: {
      urls?: string[];
    };
    error?: {
      code?: string;
      message?: string;
    };
  };
};

const CANVA_API_BASE = "https://api.canva.com/rest/v1";
const CANVA_AUTH_URL = "https://www.canva.com/api/oauth/authorize";
const CANVA_TOKEN_URL = `${CANVA_API_BASE}/oauth/token`;
const CANVA_ME_URL = `${CANVA_API_BASE}/users/me`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertOk(res: Response, text: string) {
  if (!res.ok) {
    throw new Error(`Canva API error ${res.status}: ${text}`);
  }
}

export function base64UrlEncode(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function generateCodeVerifier() {
  const crypto = require("node:crypto");
  return base64UrlEncode(crypto.randomBytes(64));
}

export function generateCodeChallenge(verifier: string) {
  const crypto = require("node:crypto");
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64UrlEncode(hash);
}

export function generateState() {
  const crypto = require("node:crypto");
  return base64UrlEncode(crypto.randomBytes(32));
}

export function getCanvaAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
  codeChallenge: string;
}) {
  const search = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: params.scopes,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256"
  });

  return `${CANVA_AUTH_URL}?${search.toString()}`;
}

export async function exchangeCanvaCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<CanvaTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri
  });

  const res = await fetch(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const text = await res.text();
  assertOk(res, text);

  return JSON.parse(text);
}

export async function getCanvaCurrentUser(accessToken: string) {
  const res = await fetch(CANVA_ME_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  const text = await res.text();
  assertOk(res, text);

  return JSON.parse(text);
}

/**
 * Creates a blank custom-size design in Canva.
 * This is a real Canva API call, but it does not yet place text on the canvas.
 */
export async function createCanvaDesign(params: {
  accessToken: string;
  title: string;
  width?: number;
  height?: number;
}) {
  const res = await fetch(`${CANVA_API_BASE}/designs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      design_type: {
        type: "custom",
        width: params.width ?? 1080,
        height: params.height ?? 1350
      },
      title: params.title
    })
  });

  const text = await res.text();
  assertOk(res, text);

  const data = JSON.parse(text) as CanvaCreateDesignResponse;
  const designId = data.design?.id;

  if (!designId) {
    throw new Error("Canva design ID missing from create design response");
  }

  return {
    designId,
    raw: data
  };
}

/**
 * Starts an export job for a Canva design.
 */
export async function createCanvaExportJob(params: {
  accessToken: string;
  designId: string;
  format?: "png" | "jpg" | "pdf";
}) {
  const fileType = params.format ?? "png";

  const res = await fetch(`${CANVA_API_BASE}/exports`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      design_id: params.designId,
      format: {
        type: fileType
      }
    })
  });

  const text = await res.text();
  assertOk(res, text);

  const data = JSON.parse(text) as CanvaCreateExportJobResponse;
  const jobId = data.job?.id;

  if (!jobId) {
    throw new Error("Canva export job ID missing");
  }

  return {
    jobId,
    raw: data
  };
}

/**
 * Polls the export job until success or failure.
 */
export async function waitForCanvaExport(params: {
  accessToken: string;
  jobId: string;
  attempts?: number;
  delayMs?: number;
}) {
  const attempts = params.attempts ?? 15;
  const delayMs = params.delayMs ?? 2000;

  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${CANVA_API_BASE}/exports/${params.jobId}`, {
      headers: {
        Authorization: `Bearer ${params.accessToken}`
      },
      cache: "no-store"
    });

    const text = await res.text();
    assertOk(res, text);

    const data = JSON.parse(text);
    const status = data?.job?.status;

    if (status === "success") {
      const urls = data?.job?.urls ?? [];

      return {
        status,
        urls,
        raw: data
      };
    }

    if (status === "failed") {
      const message =
        data?.job?.error?.message || "Canva export job failed";
      throw new Error(message);
    }

    await sleep(delayMs);
  }

  throw new Error("Timed out waiting for Canva export job");
}