import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabase } from "@/lib/supabase";
import { inngest } from "@/inngest/client";
import { issuePanelGenerateSchema, parseOrError } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { sanitizePrompt } from "@/lib/supabase-safe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`panel:${ip}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limited, try again shortly", retryAfterMs: rl.retryAfterMs }, { status: 429 });

  try {
    const body = await req.json();
    const parsed = parseOrError(issuePanelGenerateSchema, body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { issueId, pageId, prompt, characterIds, environmentId } = parsed.data;
    const cleanPrompt = sanitizePrompt(prompt);

    // Validate existence via single query
    const { data: pageRow, error: pageErr } = await supabase.from("pages").select("id, issue_id, page_number").eq("id", pageId).eq("issue_id", issueId).maybeSingle();
    if (pageErr || !pageRow) return NextResponse.json({ error: pageErr?.message || "Page not found for this issue" }, { status: 404 });

    // Fetch character refs
    const { data: chars } = await supabase.from("characters").select("id, name, reference_image_url, description").in("id", characterIds);
    if (!chars || chars.length !== characterIds.length) return NextResponse.json({ error: "One or more characters not found" }, { status: 404 });

    let environmentUrl: string | null = null;
    let envName = "";
    if (environmentId) {
      const { data: env } = await supabase.from("environments").select("id, name, reference_image_url").eq("id", environmentId).maybeSingle();
      if (!env) return NextResponse.json({ error: "Environment not found" }, { status: 404 });
      environmentUrl = (env as { reference_image_url: string }).reference_image_url;
      envName = (env as { name: string }).name;
    }

    const charNames = (chars as Array<{ name: string }>).map((c) => c.name).join(", ");
    const envPart = envName ? ` in environment ${envName}` : "";
    const enrichedPrompt = `Featuring characters: ${charNames}${envPart}. Scene: ${cleanPrompt}`;

    // Use transactional RPC for atomic insert
    const { data: panelId, error: rpcErr } = await (getSupabase().rpc as unknown as (fn: string, params: unknown) => Promise<{ data: string | null; error: { message: string } | null }>)(
      "create_issue_panel",
      {
        p_issue_id: issueId,
        p_page_id: pageId,
        p_prompt: cleanPrompt,
        p_environment_id: environmentId || null,
        p_character_ids: characterIds,
      }
    );

    let finalPanelId = panelId as unknown as string | null;
    let finalIndex: number | null = null;

    if (rpcErr || !panelId) {
      // Fallback to old path (if RPC not deployed yet)
      const { data: maxPanel } = await supabase.from("issue_panels").select("panel_index").eq("page_id", pageId).order("panel_index", { ascending: false }).limit(1).maybeSingle();
      const nextIndex = ((maxPanel as { panel_index: number } | null)?.panel_index ?? -1) + 1;
      const { data: inserted, error: insertErr } = await (getSupabase().from("issue_panels") as unknown as {
        insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: { id: string; panel_index: number } | null; error: { message: string } | null }> } };
      })
        .insert({ issue_id: issueId, page_id: pageId, panel_index: nextIndex, prompt: cleanPrompt, status: "pending", environment_id: environmentId || null })
        .select("id, panel_index")
        .single();
      if (insertErr || !inserted) return NextResponse.json({ error: insertErr?.message || rpcErr?.message || "Failed to create panel" }, { status: 500 });
      finalPanelId = inserted.id;
      finalIndex = inserted.panel_index;
      const junctionRows = characterIds.map((cid) => ({ panel_id: finalPanelId, character_id: cid }));
      const { error: pcErr } = await (getSupabase().from("panel_characters") as unknown as { insert: (v: unknown) => Promise<{ error: { message: string } | null }> }).insert(junctionRows);
      if (pcErr) {
        await (getSupabase().from("issue_panels") as unknown as { delete: () => { eq: (c: string, v: unknown) => Promise<unknown> } }).delete().eq("id", finalPanelId);
        return NextResponse.json({ error: pcErr.message }, { status: 500 });
      }
    } else {
      // RPC succeeded, fetch index for response
      const { data: panelRow } = await supabase.from("issue_panels").select("panel_index").eq("id", panelId).single();
      finalIndex = (panelRow as { panel_index: number } | null)?.panel_index ?? 0;
    }

    if (!finalPanelId) return NextResponse.json({ error: "Failed to create panel (no id)" }, { status: 500 });

    const characterReferenceUrls = (chars as Array<{ reference_image_url: string }>).map((c) => c.reference_image_url);

    try {
      await inngest.send({
        name: "issue/panel.generate",
        data: {
          panelId: finalPanelId,
          prompt: enrichedPrompt,
          originalPrompt: cleanPrompt,
          characterIds,
          characterReferenceUrls,
          environmentId: environmentId || null,
          environmentReferenceUrl: environmentUrl,
          issueId,
          pageId,
        },
      });
    } catch (inngestError) {
      const msg = String(inngestError);
      const isMissingKey = msg.includes("event key") || msg.includes("INNGEST_EVENT_KEY");
      const hint = isMissingKey
        ? " — Missing INNGEST_EVENT_KEY. Panel is pending but not queued. Add keys in Vercel → redeploy, or `npx inngest-cli dev` locally."
        : "";
      return NextResponse.json(
        { panelId: finalPanelId, panelIndex: finalIndex, issueId, pageId, warning: `Panel created but not queued: ${msg}${hint}` },
        { status: 201 }
      );
    }

    return NextResponse.json({ panelId: finalPanelId, panelIndex: finalIndex, issueId, pageId }, { status: 201 });
  } catch (e) {
    console.error("POST /api/issue-panels/generate error", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// Retry failed panel
export async function PATCH(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`panel-retry:${ip}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  try {
    const { panelId } = (await req.json()) as { panelId: string };
    if (!panelId) return NextResponse.json({ error: "panelId required" }, { status: 400 });

    const { data: panel, error: pErr } = await supabase.from("issue_panels").select("id, issue_id, page_id, prompt, environment_id, status").eq("id", panelId).single();
    if (pErr || !panel) return NextResponse.json({ error: "Panel not found" }, { status: 404 });

    if ((panel as { status: string }).status === "completed") return NextResponse.json({ error: "Panel already completed" }, { status: 400 });

    // Reset to pending
    await (getSupabase().from("issue_panels") as unknown as { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> } }).update({ status: "pending", error_message: null }).eq("id", panelId);

    const { data: pcRows } = await supabase.from("panel_characters").select("character_id").eq("panel_id", panelId);
    const characterIds = (pcRows as Array<{ character_id: string }>)?.map((r) => r.character_id) ?? [];
    const { data: chars } = await supabase.from("characters").select("reference_image_url, name").in("id", characterIds);
    const characterReferenceUrls = (chars as Array<{ reference_image_url: string }>)?.map((c) => c.reference_image_url) ?? [];
    const charNames = (chars as Array<{ name: string }>)?.map((c) => c.name).join(", ") ?? "";

    let envUrl: string | null = null;
    if ((panel as { environment_id: string | null }).environment_id) {
      const { data: env } = await supabase.from("environments").select("reference_image_url").eq("id", (panel as { environment_id: string }).environment_id).single();
      envUrl = (env as { reference_image_url: string } | null)?.reference_image_url ?? null;
    }

    await inngest.send({
      name: "issue/panel.generate",
      data: {
        panelId,
        prompt: `Retry: Featuring ${charNames}. Scene: ${(panel as { prompt: string }).prompt}`,
        originalPrompt: (panel as { prompt: string }).prompt,
        characterIds,
        characterReferenceUrls,
        environmentId: (panel as { environment_id: string | null }).environment_id,
        environmentReferenceUrl: envUrl,
        issueId: (panel as { issue_id: string }).issue_id,
        pageId: (panel as { page_id: string }).page_id,
      },
    });

    return NextResponse.json({ ok: true, panelId });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
