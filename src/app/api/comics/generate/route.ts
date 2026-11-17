import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabase, friendlySupabaseError } from "@/lib/supabase";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";

type GenerateRequestBody = {
  title: string;
  characterId: string;
  scriptLines: string[];
};

// Actual DB schema (from Supabase project hzegkbmgkvwhvtqdkuqr):
// characters(id, created_at, name, description, reference_image_url)
// comics(id, created_at, title, status)
// comic_panels(id, comic_id, character_id, panel_index, prompt_used, image_url, status)
// Note: spec used different names (character_id on comics, prompt/panel_number) — we handle both via fallback.

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GenerateRequestBody;
    const { title, characterId, scriptLines } = body;

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

    // Validate Supabase config early — gives helpful error instead of Invalid Compact JWS later
    try {
      getSupabase();
    } catch (configErr) {
      return NextResponse.json({ error: String(configErr) }, { status: 500 });
    }

    // Fetch character reference_image_url
    const { data: character, error: charError } = await supabase
      .from("characters")
      .select("id, reference_image_url")
      .eq("id", characterId)
      .single();

    if (charError || !character) {
      const msg = friendlySupabaseError(charError as unknown as { message: string }, "Fetch character") || charError?.message;
      return NextResponse.json({ error: `Character not found: ${msg || characterId}` }, { status: 404 });
    }

    const characterReferenceUrl = (character as { reference_image_url: string }).reference_image_url;
    if (!characterReferenceUrl) {
      return NextResponse.json({ error: "Character is missing reference_image_url" }, { status: 400 });
    }

    // Create row in comics — actual schema: title, status (no character_id)
    // Try with status, fallback to just title for compatibility
    let comic: { id: string } | null = null;
    let comicError: { message: string } | null = null;

    // Attempt 1: title + status
    const attempt1 = await (supabase.from("comics") as unknown as { insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } } }).insert({ title: title.trim(), status: "generating" }).select("id, title, status").single();
    if (!attempt1.error && attempt1.data) {
      comic = attempt1.data as { id: string };
    } else {
      // Attempt 2: just title (if status column missing or other)
      const attempt2 = await (supabase.from("comics") as unknown as { insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } } }).insert({ title: title.trim() }).select("id, title").single();
      if (!attempt2.error && attempt2.data) {
        comic = attempt2.data as { id: string };
      } else {
        // Attempt 3: legacy spec with character_id (for projects that have it)
        const attempt3 = await (supabase.from("comics") as unknown as { insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } } }).insert({ title: title.trim(), character_id: characterId }).select("id").single();
        if (!attempt3.error && attempt3.data) {
          comic = attempt3.data as { id: string };
        } else {
          comicError = attempt3.error || attempt2.error || attempt1.error;
        }
      }
    }

    if (!comic) {
      const friendly = friendlySupabaseError(comicError, "Create comic");
      return NextResponse.json({ error: friendly || comicError?.message || "Failed to create comic" }, { status: 500 });
    }

    const comicId = comic.id;

    // Insert placeholder rows into comic_panels with correct schema:
    // actual: comic_id, character_id, panel_index, prompt_used, status, image_url
    const panelRowsActual = cleanScriptLines.map((promptUsed, idx) => ({
      comic_id: comicId,
      character_id: characterId,
      panel_index: idx,
      prompt_used: promptUsed,
      status: "pending" as const,
      image_url: null,
    }));

    // Legacy fallback (if schema matches spec): comic_id, prompt, panel_number
    const panelRowsLegacy = cleanScriptLines.map((prompt, idx) => ({
      comic_id: comicId,
      prompt,
      status: "pending" as const,
      panel_number: idx + 1,
      order_index: idx,
    }));

    let insertedPanels: Array<{ id: string; comic_id: string; prompt_used?: string; prompt?: string; status: string }> | null = null;
    let panelsError: { message: string } | null = null;

    const actualInsert: { data: typeof insertedPanels; error: { message: string } | null } = await (supabase.from("comic_panels") as unknown as { insert: (v: unknown) => { select: (s: string) => Promise<{ data: typeof insertedPanels; error: { message: string } | null }> } }).insert(panelRowsActual).select("id, comic_id, prompt_used, status, panel_index") as unknown as { data: typeof insertedPanels; error: { message: string } | null };
    if (!actualInsert.error && actualInsert.data) {
      insertedPanels = actualInsert.data as unknown as typeof insertedPanels;
    } else {
      // Try legacy column names
      const legacyInsert: { data: typeof insertedPanels; error: { message: string } | null } = await (supabase.from("comic_panels") as unknown as { insert: (v: unknown) => { select: (s: string) => Promise<{ data: typeof insertedPanels; error: { message: string } | null }> } }).insert(panelRowsLegacy).select("id, comic_id, prompt, status") as unknown as { data: typeof insertedPanels; error: { message: string } | null };
      if (!legacyInsert.error && legacyInsert.data) {
        insertedPanels = legacyInsert.data as unknown as typeof insertedPanels;
      } else {
        panelsError = (legacyInsert.error || actualInsert.error) as { message: string };
      }
    }

    if (!insertedPanels) {
      await supabase.from("comics").delete().eq("id", comicId);
      const friendly = friendlySupabaseError(panelsError, "Create panels");
      return NextResponse.json({ error: friendly || panelsError?.message || "Failed to create panels" }, { status: 500 });
    }

    // Normalize for Inngest dispatch (handle both prompt and prompt_used)
    const panelsForEvents = (insertedPanels as unknown as Array<{ id: string; comic_id: string; prompt_used?: string; prompt?: string }>).map((p) => ({
      panelId: p.id,
      prompt: (p as unknown as { prompt_used?: string; prompt?: string }).prompt_used || (p as unknown as { prompt?: string }).prompt || "",
      comicId: p.comic_id,
    }));

    const events = panelsForEvents.map((panel) => ({
      name: "comic/panel.generate" as const,
      data: {
        panelId: panel.panelId,
        prompt: panel.prompt,
        characterReferenceUrl: characterReferenceUrl,
        comicId: panel.comicId,
      },
    }));

    try {
      await inngest.send(events);
    } catch (inngestError) {
      console.error("[generate] Inngest send failed:", inngestError);
      const inngestMsg = String(inngestError);
      const isMissingKey =
        inngestMsg.includes("event key") ||
        inngestMsg.includes("INNGEST_EVENT_KEY") ||
        inngestMsg.includes("couldn't find an event key");
      const hint = isMissingKey
        ? " — Missing INNGEST_EVENT_KEY. Your comic/panels rows were created (polling will stay 'pending'), but background generation never started. Fix: Inngest dashboard → https://app.inngest.com/env/production/manage/keys → copy Event Key, then Vercel → comic-j6p9 (and comic) → Settings → Environment Variables → add INNGEST_EVENT_KEY (sensitive, all envs) + INNGEST_SIGNING_KEY (all envs) → redeploy. For local dev run `npx inngest-cli dev` or set INNGEST_EVENT_KEY in .env.local. Current branch preview needs the key too."
        : "";
      return NextResponse.json(
        {
          comicId,
          comic,
          panels: insertedPanels,
          warning: `Comic and panels created but Inngest dispatch failed: ${inngestMsg}${hint}`,
        },
        { status: 201 }
      );
    }

    return NextResponse.json(
      {
        comicId,
        comic,
        panels: insertedPanels,
        message: `Created comic with ${(insertedPanels as unknown as unknown[]).length} panels. Generation jobs dispatched.`,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error("[POST /api/comics/generate] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    // Detect Invalid Compact JWS and give actionable hint
    if (message.includes("Invalid Compact JWS")) {
      return NextResponse.json(
        {
          error: `${message}. Hint: Check Vercel env NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set to the Comic project (hzegkbmgkvwhvtqdkuqr) legacy JWTs and redeploy.`,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
