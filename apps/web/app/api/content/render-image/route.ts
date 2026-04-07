import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  createCanvaDesign,
  createCanvaExportJob,
  waitForCanvaExport
} from "@/lib/canva";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Missing content item id" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get("canva_access_token")?.value;

    if (!accessToken) {
      return NextResponse.json(
        { error: "No Canva access token found. Connect Canva first." },
        { status: 401 }
      );
    }

    const { data: item, error: fetchError } = await supabaseAdmin
      .from("content_items")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json(
        { error: "Content item not found" },
        { status: 404 }
      );
    }

    const { error: markError } = await supabaseAdmin
      .from("content_items")
      .update({
        render_status: "rendering"
      })
      .eq("id", id);

    if (markError) {
      return NextResponse.json(
        { error: markError.message },
        { status: 500 }
      );
    }

    /**
     * Real Canva scaffold:
     * 1. Create a design
     * 2. Export it
     * 3. Save design id + exported URL
     *
     * Note: this creates a blank exported design right now.
     * Text/template placement comes in the next phase.
     */
    const design = await createCanvaDesign({
      accessToken,
      title: item.concept_title || "Instagram Post",
      width: 1080,
      height: 1350
    });

    const exportJob = await createCanvaExportJob({
      accessToken,
      designId: design.designId,
      format: "png"
    });

    const exportResult = await waitForCanvaExport({
      accessToken,
      jobId: exportJob.jobId
    });

    const finalMediaUrl = exportResult.urls?.[0] || null;

    if (!finalMediaUrl) {
      throw new Error("Canva export completed but no file URL was returned");
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("content_items")
      .update({
        canva_design_id: design.designId,
        final_media_url: finalMediaUrl,
        media_type: "image",
        render_status: "rendered"
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      item: updated
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown render error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}