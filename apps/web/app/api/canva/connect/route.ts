import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  getCanvaAuthUrl
} from "@/lib/canva";

export async function GET() {
  const clientId = process.env.CANVA_CLIENT_ID;
  const redirectUri = process.env.CANVA_REDIRECT_URI;
  const scopes = process.env.CANVA_SCOPES;

  if (!clientId || !redirectUri || !scopes) {
    return NextResponse.json(
      { error: "Missing Canva env vars" },
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
    secure: false,
    path: "/"
  });

  cookieStore.set("canva_code_verifier", codeVerifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
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