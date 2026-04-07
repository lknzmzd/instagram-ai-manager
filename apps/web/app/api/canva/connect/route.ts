import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  getCanvaAuthUrl
} from "@/lib/canva";

export async function GET() {
  const clientId = env.CANVA_CLIENT_ID;
  const redirectUri = env.CANVA_REDIRECT_URI;
  const scopes = env.CANVA_SCOPES;

  if (!clientId || !redirectUri || !scopes) {
    return NextResponse.json(
      {
        error: "Missing Canva env vars",
        debug: {
          CANVA_CLIENT_ID: !!clientId,
          CANVA_REDIRECT_URI: !!redirectUri,
          CANVA_SCOPES: !!scopes
        }
      },
      { status: 500 }
    );
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const cookieStore = await cookies();

  cookieStore.set("canva_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/"
  });

  cookieStore.set("canva_code_verifier", codeVerifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/"
  });

  const authUrl = getCanvaAuthUrl({
    clientId,
    redirectUri,
    scopes,
    state,
    codeChallenge
  });

  return NextResponse.redirect(authUrl);
}