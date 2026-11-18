import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabase, friendlySupabaseError } from "@/lib/supabase";
import { inngest } from "@/inngest/client";
import { legacyComicGenerateSchema, parseOrError } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { sanitizePrompt } from "@/lib/supabase-safe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`comic:${ip}`, 15, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limited, retry shortly", retryAfterMs: rl.retryAfterMs }, { status: 429 });

  try {
    const body = await req.json();
    const parsed = parseOrError(legacyComicGenerateSchema, body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { title, characterId, scriptLines } = parsed.data;
    const cleanScriptLines = scriptLines.map(sanitizePrompt).filter(Boolean);
    if (cleanScriptLines.length === 0) return NextResponse.json({ error: "scriptLines contains no valid prompts" }, { status: 400 });

    try {
      getSupabase();
    } catch (configErr) {
      return NextResponse.json({ error: String(configErr) }, { status: 500 });
    }

    const { data: character, error: charError } = await supabase.from("characters").select("id, reference_image_url").eq("id", characterId).single();
    if (charError || !character) {
      const msg = friendlySupabaseError(charError as unknown as { message: string }, "Fetch character") || charError?.message;
      return NextResponse.json({ error: `Character not found: ${msg || characterId}` }, { status: 404 });
    }

    const characterReferenceUrl = (character as { reference_image_url: string }).reference_image_url;
    if (!characterReferenceUrl) return NextResponse.json({ error: "Character is missing reference_image_url" }, { status: 400 });

    let comic: { id: string } | null = null;
    let comicError: { message: string } | null = null;

    const attempt1 = await (supabase.from("comics") as unknown as { insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } } }).insert({ title: title.trim(), status: "generating" }).select("id, title, status").single();
    if (!attempt1.error && attempt1.data) {
      comic = attempt1.data as { id: string };
    } else {
      const attempt2 = await (supabase.from("comics") as unknown as { insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } } }).insert({ title: title.trim() }).select("id, title").single();
      if (!attempt2.error && attempt2.data) {
        comic = attempt2.data as { id: string };
      } else {
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

    const panelRowsActual = cleanScriptLines.map((promptUsed, idx) => ({
      comic_id: comicId,
      character_id: characterId,
      panel_index: idx,
      prompt_used: promptUsed,
      status: "pending" as const,
      image_url: null,
    }));

    const panelRowsLegacy = cleanScriptLines.map((prompt, idx) => ({
      comic_id: comicId,
      prompt,
      status: "pending" as const,
      panel_number: idx + 1,
      order_index: idx,
    }));

    let insertedPanels: Array<{ id: string; comic_id: string; prompt_used?: string; prompt?: string; status: string }> | null = null;
    let panelsError: { message: string } | null = null;

    const actualInsert: { data: typeof insertedPanels; error: { message: string } | null } = (await (supabase.from("comic_panels") as unknown as { insert: (v: unknown) => { select: (s: string) => Promise<{ data: typeof insertedPanels; error: { message: string } | null }> } }).insert(panelRowsActual).select("id, comic_id, prompt_used, status, panel_index")) as unknown as { data: typeof insertedPanels; error: { message: string } | null };
    if (!actualInsert.error && actualInsert.data) {
      insertedPanels = actualInsert.data as unknown as typeof insertedPanels;
    } else {
      const legacyInsert: { data: typeof insertedPanels; error: { message: string } | null } = (await (supabase.from("comic_panels") as unknown as { insert: (v: unknown) => { select: (s: string) => Promise<{ data: typeof insertedPanels; error: { message: string } | null }> } }).insert(panelRowsLegacy).select("id, comic_id, prompt, status")) as unknown as { data: typeof insertedPanels; error: { message: string } | null };
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

    const panelsForEvents = (insertedPanels as unknown as Array<{ id: string; comic_id: string; prompt_used?: string; prompt?: string }>).map((p) => ({
      panelId: p.id,
      prompt: (p as unknown as { prompt_used?: string; prompt?: string }).prompt_used || (p as unknown as { prompt?: string }).prompt || "",
      comicId: p.comic_id,
    }));

    const events = panelsForEvents.map((panel) => ({
      name: "comic/panel.generate" as const,
      data: { panelId: panel.panelId, prompt: panel.prompt, characterReferenceUrl: characterReferenceUrl, comicId: panel.comicId },
    }));

    try {
      await inngest.send(events);
    } catch (inngestError) {
      console.error("[generate] Inngest send failed:", inngestError);
      const inngestMsg = String(inngestError);
      const isMissingKey = inngestMsg.includes("event key") || inngestMsg.includes("INNGEST_EVENT_KEY");
      const hint = isMissingKey
        ? " — Missing INNGEST_EVENT_KEY. Comic saved but not queued. Add keys in Vercel → redeploy or run `npx inngest-cli dev`."
        : "";
      return NextResponse.json({ comicId, comic, panels: insertedPanels, warning: `Created but not queued: ${inngestMsg}${hint}` }, { status: 201 });
    }

    return NextResponse.json({ comicId, comic, panels: insertedPanels, message: `Created comic with ${(insertedPanels as unknown as unknown[]).length} panels. Generation dispatched.` }, { status: 201 });
  } catch (err: unknown) {
    console.error("[POST /api/comics/generate] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("Invalid Compact JWS")) {
      return NextResponse.json({ error: `${message}. Hint: Check Vercel NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY` }, { status: 500 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
