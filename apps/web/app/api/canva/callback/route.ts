import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeCanvaCode } from "@/lib/canva";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ error: `Canva OAuth error: ${error}` }, { status: 400 });
  }

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get("canva_oauth_state")?.value;
  const codeVerifier = cookieStore.get("canva_code_verifier")?.value;

  if (!savedState || state !== savedState) {
    return NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 });
  }

  if (!codeVerifier) {
    return NextResponse.json({ error: "Missing PKCE code verifier" }, { status: 400 });
  }

  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  const redirectUri = process.env.CANVA_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      {
        error: "Missing Canva env vars",
        debug: {
          CANVA_CLIENT_ID: !!clientId,
          CANVA_CLIENT_SECRET: !!clientSecret,
          CANVA_REDIRECT_URI: !!redirectUri
        }
      },
      { status: 500 }
    );
  }

  try {
    const tokenData = await exchangeCanvaCode({
      code,
      codeVerifier,
      clientId,
      clientSecret,
      redirectUri
    });

    cookieStore.set("canva_access_token", tokenData.access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/"
    });

    if (tokenData.refresh_token) {
      cookieStore.set("canva_refresh_token", tokenData.refresh_token, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/"
      });
    }

    cookieStore.delete("canva_oauth_state");
    cookieStore.delete("canva_code_verifier");

    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}?canva=connected`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Canva callback error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}