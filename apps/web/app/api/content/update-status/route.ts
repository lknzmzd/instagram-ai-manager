import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, status, extra_fields } = body;

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };

    if (typeof status === "string") {
      updatePayload.status = status;
    }

    if (extra_fields && typeof extra_fields === "object") {
      Object.assign(updatePayload, extra_fields);
    }

    const { data, error } = await supabaseAdmin
      .from("content_items")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, item: data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown update status error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}