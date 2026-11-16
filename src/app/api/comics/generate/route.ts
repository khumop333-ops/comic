import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";

type GenerateRequestBody = {
  title: string;
  characterId: string;
  scriptLines: string[];
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateRequestBody;
    const { title, characterId, scriptLines } = body;

    // Validation
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!characterId || typeof characterId !== "string") {
      return NextResponse.json({ error: "characterId is required" }, { status: 400 });
    }
    if (!Array.isArray(scriptLines) || scriptLines.length === 0) {
      return NextResponse.json({ error: "scriptLines must be a non-empty array" }, { status: 400 });
    }

    const cleanScriptLines = scriptLines
      .map((l) => (typeof l === "string" ? l.trim() : ""))
      .filter(Boolean);

    if (cleanScriptLines.length === 0) {
      return NextResponse.json({ error: "scriptLines contains no valid prompts" }, { status: 400 });
    }

    // Fetch character reference_image_url from characters table
    const { data: character, error: charError } = await supabase
      .from("characters")
      .select("id, reference_image_url")
      .eq("id", characterId)
      .single();

    if (charError || !character) {
      return NextResponse.json(
        { error: `Character not found: ${charError?.message || characterId}` },
        { status: 404 }
      );
    }

    const characterReferenceUrl = (character as { reference_image_url: string }).reference_image_url;

    if (!characterReferenceUrl) {
      return NextResponse.json(
        { error: "Character is missing reference_image_url" },
        { status: 400 }
      );
    }

    // Create new row in comics
    const { data: comic, error: comicError } = await supabase
      .from("comics")
      .insert({
        title: title.trim(),
        character_id: characterId,
      })
      .select("id, title, character_id")
      .single();

    if (comicError || !comic) {
      return NextResponse.json({ error: `Failed to create comic: ${comicError?.message}` }, { status: 500 });
    }

    const comicId = (comic as { id: string }).id;

    // Insert placeholder rows into comic_panels with status: 'pending'
    const panelRows = cleanScriptLines.map((prompt, idx) => ({
      comic_id: comicId,
      prompt,
      status: "pending" as const,
      panel_number: idx + 1,
      order_index: idx,
    }));

    const { data: insertedPanels, error: panelsError } = await supabase
      .from("comic_panels")
      .insert(panelRows)
      .select("id, comic_id, prompt, status");

    if (panelsError || !insertedPanels) {
      // Attempt cleanup of comic if panel insert fails
      await supabase.from("comics").delete().eq("id", comicId);
      return NextResponse.json({ error: `Failed to create panels: ${panelsError?.message}` }, { status: 500 });
    }

    const panels = insertedPanels as Array<{ id: string; comic_id: string; prompt: string; status: string }>;

    // Fire "comic/panel.generate" Inngest event for each panel
    // Use step-based batch send to avoid partial failure blocking
    const events = panels.map((panel) => ({
      name: "comic/panel.generate" as const,
      data: {
        panelId: panel.id,
        prompt: panel.prompt,
        characterReferenceUrl: characterReferenceUrl,
        comicId,
      },
    }));

    try {
      await inngest.send(events);
    } catch (inngestError) {
      console.error("[generate] Inngest send failed:", inngestError);
      // Panels remain pending; caller can retry. Return partial success with warning.
      return NextResponse.json(
        {
          comicId,
          comic,
          panels,
          warning: `Comic and panels created but Inngest dispatch failed: ${String(inngestError)}`,
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        comicId,
        comic,
        panels,
        message: `Created comic with ${panels.length} panels. Generation jobs dispatched.`,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error("[POST /api/comics/generate] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
