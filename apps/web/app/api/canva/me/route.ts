import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCanvaCurrentUser } from "@/lib/canva";

export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("canva_access_token")?.value;

  if (!accessToken) {
    return NextResponse.json(
      { error: "No Canva access token found. Connect Canva first." },
      { status: 401 }
    );
  }

  try {
    const me = await getCanvaCurrentUser(accessToken);
    return NextResponse.json({ success: true, me });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Canva me error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}