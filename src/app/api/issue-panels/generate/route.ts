import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabase } from "@/lib/supabase";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";

// POST /api/issue-panels/generate
// Body: { issueId, pageId, prompt, characterIds: string[], environmentId?: string }
// Creates issue_panels row + panel_characters junction, fires Inngest events
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { issueId, pageId, prompt, characterIds, environmentId } = body as {
      issueId: string;
      pageId: string;
      prompt: string;
      characterIds: string[];
      environmentId?: string | null;
    };

    if (!issueId || !pageId || !prompt?.trim()) {
      return NextResponse.json({ error: "issueId, pageId, prompt required" }, { status: 400 });
    }
    if (!characterIds || !Array.isArray(characterIds) || characterIds.length === 0) {
      return NextResponse.json({ error: "At least one characterId required (multiselect)" }, { status: 400 });
    }

    // Validate issue/page exist and get next panel_index
    const { data: pageRow, error: pageErr } = await supabase
      .from("pages")
      .select("id, issue_id, page_number")
      .eq("id", pageId)
      .eq("issue_id", issueId)
      .maybeSingle();
    if (pageErr || !pageRow) {
      return NextResponse.json({ error: pageErr?.message || "Page not found for this issue" }, { status: 404 });
    }

    const { data: maxPanel } = await supabase
      .from("issue_panels")
      .select("panel_index")
      .eq("page_id", pageId)
      .order("panel_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextIndex = ((maxPanel as { panel_index: number } | null)?.panel_index ?? -1) + 1;

    // Fetch character refs to build combined prompt hint
    const { data: chars } = await supabase.from("characters").select("id, name, reference_image_url, description").in("id", characterIds);
    if (!chars || chars.length !== characterIds.length) {
      return NextResponse.json({ error: "One or more characters not found" }, { status: 404 });
    }

    let environmentUrl: string | null = null;
    if (environmentId) {
      const { data: env } = await supabase.from("environments").select("id, name, reference_image_url").eq("id", environmentId).maybeSingle();
      if (!env) return NextResponse.json({ error: "Environment not found" }, { status: 404 });
      environmentUrl = (env as { reference_image_url: string }).reference_image_url;
    }

    // Build enriched prompt: original prompt + character names + optional environment context
    const charNames = (chars as Array<{ name: string }>).map((c) => c.name).join(", ");
    const envName = environmentId ? ` in environment ${(await supabase.from("environments").select("name").eq("id", environmentId).maybeSingle().then(r => (r.data as { name: string } | null)?.name ?? ""))}` : "";
    // We store the user's prompt as-is, but also send enriched prompt to worker
    const enrichedPrompt = `Featuring characters: ${charNames}${envName ? ` — ${envName}` : ""}. Scene: ${prompt.trim()}`;

    const insertAny = (getSupabase().from("issue_panels") as unknown as {
      insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }> } };
    });

    const { data: inserted, error: insertErr } = await insertAny
      .insert({
        issue_id: issueId,
        page_id: pageId,
        panel_index: nextIndex,
        prompt: prompt.trim(),
        status: "pending",
        environment_id: environmentId || null,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json({ error: insertErr?.message || "Failed to create panel" }, { status: 500 });
    }

    const panelId = inserted.id as string;

    // Insert panel_characters junction
    const junctionRows = characterIds.map((cid) => ({ panel_id: panelId, character_id: cid }));
    // supabase insert for junction — bypass type check
    const pcInsert = (getSupabase().from("panel_characters") as unknown as { insert: (v: unknown) => Promise<{ error: { message: string } | null }> });
    const { error: pcErr } = await pcInsert.insert(junctionRows);
    if (pcErr) {
      // rollback panel
      await (getSupabase().from("issue_panels") as unknown as { delete: () => { eq: (c: string, v: unknown) => Promise<unknown> } }).delete().eq("id", panelId);
      return NextResponse.json({ error: pcErr.message }, { status: 500 });
    }

    // Fetch reference URLs for Inngest payload
    const characterReferenceUrls = (chars as Array<{ reference_image_url: string }>).map((c) => c.reference_image_url);

    try {
      await inngest.send({
        name: "issue/panel.generate",
        data: {
          panelId,
          prompt: enrichedPrompt,
          originalPrompt: prompt.trim(),
          characterIds,
          characterReferenceUrls,
          environmentId: environmentId || null,
          environmentReferenceUrl: environmentUrl,
          issueId,
          pageId,
        },
      });
    } catch (inngestError) {
      console.error("[issue-panels generate] Inngest send failed:", inngestError);
      const msg = String(inngestError);
      const isMissingKey =
        msg.includes("event key") ||
        msg.includes("INNGEST_EVENT_KEY") ||
        msg.includes("couldn't find an event key");
      const hint = isMissingKey
        ? " — Missing INNGEST_EVENT_KEY. Panel row was created (pending), but generation never started. Fix: Inngest → https://app.inngest.com/env/production/manage/keys → copy Event Key, then Vercel → comic-j6p9 (and comic) → Settings → Environment Variables → add INNGEST_EVENT_KEY (sensitive, all envs) + INNGEST_SIGNING_KEY (all envs) → redeploy."
        : "";
      // We already created DB rows; return 201 with warning so UI can retry after fixing env, instead of 500
      return NextResponse.json(
        {
          panelId,
          panelIndex: nextIndex,
          issueId,
          pageId,
          warning: `Panel created but Inngest dispatch failed: ${msg}${hint}`,
        },
        { status: 201 }
      );
    }

    return NextResponse.json({ panelId, panelIndex: nextIndex, issueId, pageId }, { status: 201 });
  } catch (e) {
    console.error("POST /api/issue-panels/generate error", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
