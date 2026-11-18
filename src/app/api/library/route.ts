import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const issueId = url.searchParams.get("issue_id"); // optional filter

  // Support ETag / caching
  const ifNoneMatch = req.headers.get("if-none-match");

  let issuesQuery = supabase.from("issues").select("id, title, issue_number, description, cover_image_url, created_at").order("issue_number", { ascending: true });

  if (issueId) {
    issuesQuery = supabase.from("issues").select("id, title, issue_number, description, cover_image_url, created_at").eq("id", issueId);
  } else {
    issuesQuery = issuesQuery.range(0, limit - 1);
  }

  const { data: issues, error: issuesErr } = await issuesQuery;
  if (issuesErr) return NextResponse.json({ error: issuesErr.message }, { status: 500 });
  if (!issues || issues.length === 0) return NextResponse.json({ issues: [] });

  const issueIds = (issues as Array<{ id: string }>).map((i) => i.id);

  const { data: pages, error: pagesErr } = await supabase.from("pages").select("id, issue_id, page_number, title, created_at").in("issue_id", issueIds).order("page_number", { ascending: true });
  if (pagesErr) return NextResponse.json({ error: pagesErr.message }, { status: 500 });

  const pageIds = (pages as Array<{ id: string }>)?.map((p) => p.id) ?? [];

  let panels: unknown[] = [];
  let panelCharacters: unknown[] = [];
  let charactersById: Record<string, { id: string; name: string; reference_image_url: string }> = {};
  let environmentsById: Record<string, { id: string; name: string; reference_image_url: string }> = {};

  if (pageIds.length > 0) {
    const { data: panelsData, error: panelsErr } = await supabase
      .from("issue_panels")
      .select("id, issue_id, page_id, panel_index, prompt, image_url, status, environment_id, error_message, created_at")
      .in("page_id", pageIds)
      .order("panel_index", { ascending: true });
    if (panelsErr) return NextResponse.json({ error: panelsErr.message }, { status: 500 });
    panels = (panelsData as unknown[]) ?? [];

    const panelIds = (panels as Array<{ id: string }>).map((p) => p.id);
    if (panelIds.length > 0) {
      const { data: pcData } = await supabase.from("panel_characters").select("panel_id, character_id").in("panel_id", panelIds);
      panelCharacters = (pcData as unknown[]) ?? [];
      const charIds = [...new Set((panelCharacters as Array<{ character_id: string }>).map((r) => r.character_id))];
      if (charIds.length > 0) {
        const { data: chars } = await supabase.from("characters").select("id, name, reference_image_url").in("id", charIds);
        for (const c of (chars as Array<{ id: string; name: string; reference_image_url: string }>) ?? []) charactersById[c.id] = c;
      }
      const envIds = [...new Set((panels as Array<{ environment_id: string | null }>).map((p) => p.environment_id).filter(Boolean) as string[])];
      if (envIds.length > 0) {
        const { data: envs } = await supabase.from("environments").select("id, name, reference_image_url").in("id", envIds);
        for (const e of (envs as Array<{ id: string; name: string; reference_image_url: string }>) ?? []) environmentsById[e.id] = e;
      }
    }
  }

  const pagesByIssue = new Map<string, typeof pages>();
  for (const p of (pages as Array<{ issue_id: string }>) ?? []) {
    const arr = pagesByIssue.get(p.issue_id) ?? [];
    arr.push(p as never);
    pagesByIssue.set(p.issue_id, arr as never);
  }

  const panelsByPage = new Map<string, typeof panels>();
  for (const pl of panels as Array<{ page_id: string }>) {
    const arr = panelsByPage.get(pl.page_id) ?? [];
    arr.push(pl as never);
    panelsByPage.set(pl.page_id, arr as never);
  }

  const pcByPanel = new Map<string, string[]>();
  for (const row of panelCharacters as Array<{ panel_id: string; character_id: string }>) {
    const arr = pcByPanel.get(row.panel_id) ?? [];
    arr.push(row.character_id);
    pcByPanel.set(row.panel_id, arr);
  }

  const enrichedIssues = (issues as Array<{ id: string }>).map((issue) => {
    const issuePages = pagesByIssue.get(issue.id) ?? [];
    const enrichedPages = (issuePages as Array<{ id: string }>).map((page) => {
      const pagePanels = (panelsByPage.get(page.id) ?? []) as Array<{ id: string; environment_id: string | null; panel_index: number }>;
      const enrichedPanels = pagePanels
        .sort((a, b) => a.panel_index - b.panel_index)
        .map((panel) => {
          const charIds = pcByPanel.get(panel.id) ?? [];
          return { ...panel, characters: charIds.map((cid) => charactersById[cid]).filter(Boolean), environment: panel.environment_id ? environmentsById[panel.environment_id] ?? null : null };
        });
      return { ...page, panels: enrichedPanels };
    });
    return { ...issue, pages: enrichedPages };
  });

  const body = JSON.stringify({ issues: enrichedIssues });
  // simple ETag
  const etag = `W/"${body.length}-${enrichedIssues.length}"`;
  if (ifNoneMatch === etag) return new NextResponse(null, { status: 304 });

  const res = new NextResponse(body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60", ETag: etag } });
  return res;
}
