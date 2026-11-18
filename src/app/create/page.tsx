"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { getSupabaseBrowser, friendlySupabaseError } from "@/lib/supabase";

type Character = { id: string; name: string; description: string | null; reference_image_url: string };
type Environment = { id: string; name: string; description: string | null; reference_image_url: string };
type Issue = { id: string; title: string; issue_number: number; description: string | null };
type Page = { id: string; issue_id: string; page_number: number; title: string | null };
type IssuePanel = { id: string; issue_id: string; page_id: string; panel_index: number; prompt: string; image_url: string | null; status: string; environment_id: string | null; error_message?: string | null };

export default function CreateIssuePage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [libLoading, setLibLoading] = useState(true);

  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [newIssueDesc, setNewIssueDesc] = useState("");
  const [issueCreating, setIssueCreating] = useState(false);
  const [issueMsg, setIssueMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [selectedIssueId, setSelectedIssueId] = useState<string>("");
  const [newPageTitle, setNewPageTitle] = useState("");
  const [pageCreating, setPageCreating] = useState(false);
  const [pageMsg, setPageMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string>("");

  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");
  const [panelPrompt, setPanelPrompt] = useState("");
  const [panelCreating, setPanelCreating] = useState(false);
  const [panelMsg, setPanelMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [panels, setPanels] = useState<IssuePanel[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLibraries = useCallback(async () => {
    setLibLoading(true);
    try {
      const client = getSupabaseBrowser();
      const [charsRes, envsRes, issuesRes] = await Promise.all([
        client.from("characters").select("id, name, description, reference_image_url").order("created_at", { ascending: false }),
        client.from("environments").select("id, name, description, reference_image_url").order("created_at", { ascending: false }),
        client.from("issues").select("id, title, issue_number, description").order("issue_number", { ascending: true }),
      ]);
      if (!charsRes.error && charsRes.data) setCharacters(charsRes.data as Character[]);
      if (!envsRes.error && envsRes.data) setEnvironments(envsRes.data as Environment[]);
      if (!issuesRes.error && issuesRes.data) {
        const iss = issuesRes.data as Issue[];
        setIssues(iss);
        if (iss.length > 0 && !selectedIssueId) setSelectedIssueId(iss[0].id);
      }
    } catch (e) {
      console.error(e);
    }
    setLibLoading(false);
  }, [selectedIssueId]);

  const fetchPages = useCallback(async (issueId: string) => {
    if (!issueId) {
      setPages([]);
      setSelectedPageId("");
      return;
    }
    try {
      const client = getSupabaseBrowser();
      const { data, error } = await client.from("pages").select("id, issue_id, page_number, title").eq("issue_id", issueId).order("page_number", { ascending: true });
      if (!error && data) {
        const pgs = data as Page[];
        setPages(pgs);
        if (pgs.length > 0 && !selectedPageId) setSelectedPageId(pgs[0].id);
        if (pgs.length === 0) setSelectedPageId("");
      }
    } catch (e) {
      console.error(e);
    }
  }, [selectedPageId]);

  useEffect(() => {
    fetchLibraries();
  }, [fetchLibraries]);

  useEffect(() => {
    if (selectedIssueId) fetchPages(selectedIssueId);
  }, [selectedIssueId, fetchPages]);

  const fetchPanels = useCallback(async (pageId: string) => {
    if (!pageId) {
      setPanels([]);
      return;
    }
    try {
      const client = getSupabaseBrowser();
      const { data, error } = await client.from("issue_panels").select("id, issue_id, page_id, panel_index, prompt, image_url, status, environment_id, error_message").eq("page_id", pageId).order("panel_index", { ascending: true });
      if (error) {
        console.error(friendlySupabaseError(error as { message: string }, "Fetch panels") || error.message);
        return;
      }
      setPanels((data as IssuePanel[]) ?? []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Polling + Realtime
  useEffect(() => {
    if (!selectedPageId) {
      setPanels([]);
      return;
    }
    setPanelsLoading(true);
    fetchPanels(selectedPageId).finally(() => setPanelsLoading(false));
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => fetchPanels(selectedPageId), 6000);

    // Realtime subscription for instant updates (if enabled in Supabase)
    let channel: ReturnType<ReturnType<typeof getSupabaseBrowser>["channel"]> | null = null;
    try {
      const client = getSupabaseBrowser();
      channel = client
        .channel(`panels-${selectedPageId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "issue_panels", filter: `page_id=eq.${selectedPageId}` }, () => fetchPanels(selectedPageId))
        .subscribe();
    } catch {}

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (channel) {
        try {
          getSupabaseBrowser().removeChannel(channel);
        } catch {}
      }
    };
  }, [selectedPageId, fetchPanels]);

  const handleCreateIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIssueMsg(null);
    if (!newIssueTitle.trim()) {
      setIssueMsg({ type: "error", text: "Issue title required (1-200 chars)" });
      return;
    }
    setIssueCreating(true);
    try {
      const res = await fetch("/api/issues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newIssueTitle.trim(), description: newIssueDesc.trim() || null }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create issue");
      setIssueMsg({ type: "success", text: `Issue #${json.issue.issue_number}: "${json.issue.title}" created!` });
      const newIssue = json.issue as Issue;
      setIssues((prev) => [...prev, newIssue].sort((a, b) => a.issue_number - b.issue_number));
      setSelectedIssueId(newIssue.id);
      setNewIssueTitle("");
      setNewIssueDesc("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setIssueMsg({ type: "error", text: msg.includes("Rate limited") ? "Rate limited — wait 60s" : msg });
    } finally {
      setIssueCreating(false);
    }
  };

  const handleCreatePage = async (e: React.FormEvent) => {
    e.preventDefault();
    setPageMsg(null);
    if (!selectedIssueId) {
      setPageMsg({ type: "error", text: "Select an issue first" });
      return;
    }
    setPageCreating(true);
    try {
      const res = await fetch("/api/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issue_id: selectedIssueId, title: newPageTitle.trim() || null }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create page");
      setPageMsg({ type: "success", text: `Page ${json.page.page_number} created!` });
      const newPage = json.page as Page;
      setPages((prev) => [...prev, newPage].sort((a, b) => a.page_number - b.page_number));
      setSelectedPageId(newPage.id);
      setNewPageTitle("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPageMsg({ type: "error", text: msg.includes("Rate limited") ? "Rate limited — wait 60s" : msg });
    } finally {
      setPageCreating(false);
    }
  };

  const toggleCharacter = (id: string) => setSelectedCharIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const handleCreatePanel = async (e: React.FormEvent) => {
    e.preventDefault();
    setPanelMsg(null);
    if (!selectedIssueId || !selectedPageId) {
      setPanelMsg({ type: "error", text: "Select an issue and page first" });
      return;
    }
    if (selectedCharIds.length === 0) {
      setPanelMsg({ type: "error", text: "Select at least one character" });
      return;
    }
    if (!panelPrompt.trim()) {
      setPanelMsg({ type: "error", text: "Prompt required (3-2000 chars)" });
      return;
    }
    setPanelCreating(true);
    try {
      const res = await fetch("/api/issue-panels/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issueId: selectedIssueId, pageId: selectedPageId, prompt: panelPrompt.trim(), characterIds: selectedCharIds, environmentId: selectedEnvId || null }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create panel");
      if (json.warning) setPanelMsg({ type: "error", text: json.warning });
      else setPanelMsg({ type: "success", text: `Panel ${json.panelIndex + 1} queued — generating with ${selectedCharIds.length} character(s)!` });
      setPanelPrompt("");
      fetchPanels(selectedPageId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPanelMsg({ type: "error", text: msg.includes("Rate limited") ? "Rate limited — wait 60s" : msg });
    } finally {
      setPanelCreating(false);
    }
  };

  const handleRetry = async (panelId: string) => {
    const res = await fetch("/api/issue-panels/generate", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ panelId }) });
    const json = await res.json();
    if (!res.ok) alert(json.error || "Retry failed");
    else fetchPanels(selectedPageId);
  };

  const handleDeletePanel = async (panelId: string) => {
    if (!confirm("Delete this panel?")) return;
    const client = getSupabaseBrowser();
    const { error } = await (client.from("issue_panels") as unknown as { delete: () => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> } }).delete().eq("id", panelId);
    if (error) alert(error.message);
    else fetchPanels(selectedPageId);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black">Create — Issues → Pages → Panels</h1>
        <p className="mt-1 text-sm text-neutral-600">New hierarchy (clean break from flat comics). Create Issues, add Pages, then generate Panels with <span className="font-semibold">multi-character</span> + <span className="font-semibold">environment</span> reference. Library ordering: Issue 1 p1/p2/p3, Issue 2 p1/p2/p3.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/library" className="rounded-full border bg-white px-3 py-1 text-xs font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900">View Library →</a>
          <a href="/comics/create" className="rounded-full border bg-white px-3 py-1 text-xs font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900">Legacy Comic Creator</a>
          <a href="/environments" className="rounded-full border bg-white px-3 py-1 text-xs font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900">Environments</a>
        </div>
      </div>

      {libLoading ? (
        <div className="rounded-xl border bg-white p-6 text-sm text-neutral-500">Loading libraries…</div>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white" aria-hidden>1</span>
                <h2 className="text-lg font-bold">Issues</h2>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">{issues.length} total</span>
              </div>
              <form onSubmit={handleCreateIssue} className="mt-4 space-y-3" noValidate>
                <div>
                  <label htmlFor="issue-title" className="text-sm font-medium">New Issue Title <span className="text-red-600">*</span></label>
                  <input id="issue-title" value={newIssueTitle} onChange={(e) => setNewIssueTitle(e.target.value)} placeholder="e.g. The Beginning" required maxLength={200} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <label htmlFor="issue-desc" className="text-sm font-medium">Description</label>
                  <input id="issue-desc" value={newIssueDesc} onChange={(e) => setNewIssueDesc(e.target.value)} placeholder="Optional — what this issue is about" maxLength={1000} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-indigo-500" />
                </div>
                {issueMsg && <div role="alert" className={`rounded-lg px-3 py-2 text-sm ${issueMsg.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{issueMsg.text}</div>}
                <button type="submit" disabled={issueCreating} className="w-full rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">{issueCreating ? "Creating…" : "Create Issue (auto-numbered atomic)"}</button>
              </form>
              <div className="mt-6">
                <label htmlFor="select-issue" className="text-sm font-medium">Select Issue *</label>
                {issues.length === 0 ? <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No issues yet — create one above.</div> : <select id="select-issue" value={selectedIssueId} onChange={(e) => setSelectedIssueId(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">{issues.map((iss) => <option key={iss.id} value={iss.id}>Issue #{iss.issue_number}: {iss.title}</option>)}</select>}
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white" aria-hidden>2</span>
                <h2 className="text-lg font-bold">Pages</h2>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">{pages.length} in selected issue</span>
              </div>
              {!selectedIssueId ? <div className="mt-4 rounded-lg border border-dashed p-4 text-center text-sm text-neutral-500">Select an issue first</div> : <>
                <form onSubmit={handleCreatePage} className="mt-4 space-y-3" noValidate>
                  <div>
                    <label htmlFor="page-title" className="text-sm font-medium">New Page Title (optional)</label>
                    <input id="page-title" value={newPageTitle} onChange={(e) => setNewPageTitle(e.target.value)} placeholder="e.g. Rooftop Chase" maxLength={200} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500" />
                    <p className="mt-1 text-xs text-neutral-500">Auto-numbered atomically per issue — Page 1, 2, 3…</p>
                  </div>
                  {pageMsg && <div role="alert" className={`rounded-lg px-3 py-2 text-sm ${pageMsg.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{pageMsg.text}</div>}
                  <button type="submit" disabled={pageCreating} className="w-full rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600">{pageCreating ? "Creating…" : "Add Page to Issue"}</button>
                </form>
                <div className="mt-6">
                  <label htmlFor="select-page" className="text-sm font-medium">Select Page *</label>
                  {pages.length === 0 ? <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No pages yet — add one above.</div> : <select id="select-page" value={selectedPageId} onChange={(e) => setSelectedPageId(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600">{pages.map((p) => <option key={p.id} value={p.id}>Page {p.page_number}{p.title ? `: ${p.title}` : ""}</option>)}</select>}
                </div>
              </>}
            </section>
          </div>

          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white" aria-hidden>3</span>
              <h2 className="text-lg font-bold">Create Panel — Multi-Character + Environment</h2>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hidden sm:inline">prompt combines selections</span>
            </div>
            {!selectedPageId ? <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-neutral-500">Select an issue and page to create panels</div> : (
              <form onSubmit={handleCreatePanel} className="mt-6 space-y-5" noValidate>
                <div>
                  <fieldset>
                    <legend className="text-sm font-medium">Characters <span className="text-red-600">*</span> (checkboxes — select 1-5)</legend>
                    <p className="text-xs text-neutral-500">e.g. Luna + Kai together. Prompt will combine as “Featuring Luna, Kai…”</p>
                    {characters.length === 0 ? <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No characters yet — add in <a href="/comics/create" className="underline font-medium">/comics/create</a> Section A.</div> : (
                      <div className="mt-2 grid gap-2 rounded-xl border bg-neutral-50 p-3 sm:grid-cols-2">
                        {characters.map((c) => {
                          const checked = selectedCharIds.includes(c.id);
                          return (
                            <label key={c.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3 hover:bg-neutral-50 focus-within:ring-2 focus-within:ring-indigo-500 ${checked ? "border-indigo-500 ring-1 ring-indigo-500" : ""}`}>
                              <input type="checkbox" checked={checked} onChange={() => toggleCharacter(c.id)} aria-label={`Select character ${c.name}`} className="h-4 w-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-600" />
                              <span className="relative h-10 w-10 overflow-hidden rounded-full flex-shrink-0">
                                <Image src={c.reference_image_url} alt={c.name} fill className="object-cover" sizes="40px" unoptimized />
                              </span>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold leading-none">{c.name}</div>
                                {c.description && <div className="mt-1 line-clamp-1 text-xs text-neutral-500">{c.description}</div>}
                              </div>
                              {checked && <span className="ml-auto text-xs font-bold text-indigo-600" aria-hidden>✓</span>}
                            </label>
                          );
                        })}
                      </div>
                    )}
                    {selectedCharIds.length > 0 && <div className="mt-2 text-xs text-neutral-600">Selected: {selectedCharIds.map((id) => characters.find((c) => c.id === id)?.name).join(", ")}</div>}
                  </fieldset>
                </div>

                <div>
                  <label htmlFor="env-select" className="text-sm font-medium">Environment (optional — single select)</label>
                  <p className="text-xs text-neutral-500">e.g. Cyber City Rooftop — will be sent as environment_reference_url to GPU worker</p>
                  {environments.length === 0 ? <div className="mt-1 rounded-lg border bg-neutral-50 px-3 py-2 text-sm text-neutral-600">No environments — create in <a href="/environments" className="underline text-indigo-600">/environments</a>.</div> : <select id="env-select" value={selectedEnvId} onChange={(e) => setSelectedEnvId(e.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">{[<option key="none" value="">— No environment (character-only) —</option>, ...environments.map((env) => <option key={env.id} value={env.id}>{env.name}</option>)]}</select>}
                  {selectedEnvId && environments.find((e) => e.id === selectedEnvId) && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
                      <span className="relative h-8 w-8 overflow-hidden rounded flex-shrink-0"><Image src={environments.find((e) => e.id === selectedEnvId)!.reference_image_url} alt="env" fill className="object-cover" unoptimized /></span>
                      <span>{environments.find((e) => e.id === selectedEnvId)!.name} — reference will be included</span>
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="panel-prompt" className="text-sm font-medium">Panel Prompt <span className="text-red-600">*</span></label>
                  <textarea id="panel-prompt" value={panelPrompt} onChange={(e) => setPanelPrompt(e.target.value)} placeholder="Luna and Kai standing on a rainy rooftop at night, neon city behind them, cinematic comic style" rows={3} required maxLength={2000} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600" />
                  <p className="mt-1 text-xs text-neutral-500">Combined as “Featuring: Luna, Kai in Cyber City Rooftop — [your prompt]” and sent as <code className="rounded bg-neutral-100 px-1">prompt</code> + <code className="bg-neutral-100 px-1">character_reference_urls[]</code> to <code className="bg-neutral-100 px-1">GPU_WORKER_URL</code> with 90s timeout.</p>
                </div>

                {panelMsg && <div role="alert" className={`rounded-lg px-3 py-2 text-sm ${panelMsg.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{panelMsg.text}</div>}

                <button type="submit" disabled={panelCreating} className="w-full rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">{panelCreating ? "Queuing…" : `Generate Panel → Issue ${issues.find((i) => i.id === selectedIssueId)?.issue_number ?? "?"} Page ${pages.find((p) => p.id === selectedPageId)?.page_number ?? "?"}`}</button>
              </form>
            )}
          </section>

          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white" aria-hidden>4</span>
              <h2 className="text-lg font-bold">Live Panels</h2>
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">Realtime + polling every 6s</span>
              {selectedPageId && <span className="text-xs text-neutral-500">Page ID: {selectedPageId.slice(0, 8)}…</span>}
            </div>

            {!selectedPageId ? <div className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-neutral-500">Select a page to see its panels live</div> : panelsLoading && panels.length === 0 ? <div className="mt-4 text-center text-sm text-neutral-500">Loading panels…</div> : panels.length === 0 ? <div className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-neutral-500">No panels yet on this page — create one above.</div> : (
              <>
                <div className="mt-2 text-xs text-neutral-500">{panels.filter((p) => p.status === "completed").length} / {panels.length} completed • realtime + polling</div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {panels.map((panel) => (
                    <div key={panel.id} className="overflow-hidden rounded-xl border bg-neutral-50 flex flex-col">
                      <div className="aspect-[4/3] overflow-hidden bg-white relative">
                        {panel.status === "completed" && panel.image_url ? <Image src={panel.image_url} alt={panel.prompt} fill className="object-cover" sizes="(max-width:768px) 100vw, 33vw" unoptimized /> : panel.status === "failed" ? <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-red-50 p-4 text-center"><div className="text-sm font-semibold text-red-700">Generation failed</div>{panel.error_message && <div className="text-xs text-red-600 line-clamp-2">{panel.error_message}</div>}<div className="mt-1 flex gap-2"><button onClick={() => handleRetry(panel.id)} className="rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700">Retry</button><button onClick={() => handleDeletePanel(panel.id)} className="rounded-full border bg-white px-3 py-1 text-xs font-semibold hover:bg-neutral-50">Delete</button></div></div> : <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4"><div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" aria-label="Loading" /><div className="text-xs font-medium text-neutral-500">Pending — GPU worker…</div></div>}
                      </div>
                      <div className="p-3 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">Panel {panel.panel_index + 1}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${panel.status === "completed" ? "bg-green-100 text-green-700" : panel.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{panel.status}</span>
                        </div>
                        <p className="mt-1 line-clamp-3 text-sm leading-snug text-neutral-700">{panel.prompt}</p>
                        {panel.image_url && <a href={panel.image_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:underline">Open image →</a>}
                      </div>
                      <div className="px-3 pb-3 flex gap-2">
                        <button onClick={() => handleDeletePanel(panel.id)} className="text-xs font-medium text-neutral-500 hover:text-red-600">Delete panel</button>
                        <span className="ml-auto text-[11px] text-neutral-400 font-mono">{panel.id.slice(0, 6)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
