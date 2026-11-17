"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getSupabaseBrowser, friendlySupabaseError } from "@/lib/supabase";

type Character = {
  id: string;
  name: string;
  description: string | null;
  reference_image_url: string;
};

type Environment = {
  id: string;
  name: string;
  description: string | null;
  reference_image_url: string;
};

type Issue = {
  id: string;
  title: string;
  issue_number: number;
  description: string | null;
};

type Page = {
  id: string;
  issue_id: string;
  page_number: number;
  title: string | null;
};

type IssuePanel = {
  id: string;
  issue_id: string;
  page_id: string;
  panel_index: number;
  prompt: string;
  image_url: string | null;
  status: string;
  environment_id: string | null;
};

export default function CreateIssuePage() {
  // Libraries
  const [characters, setCharacters] = useState<Character[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [libLoading, setLibLoading] = useState(true);

  // Issue/Page creation
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [newIssueDesc, setNewIssueDesc] = useState("");
  const [issueCreating, setIssueCreating] = useState(false);
  const [issueMsg, setIssueMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [selectedIssueId, setSelectedIssueId] = useState<string>("");
  const [newPageTitle, setNewPageTitle] = useState("");
  const [pageCreating, setPageCreating] = useState(false);
  const [pageMsg, setPageMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string>("");

  // Panel creation (multi-character + environment)
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");
  const [panelPrompt, setPanelPrompt] = useState("");
  const [panelCreating, setPanelCreating] = useState(false);
  const [panelMsg, setPanelMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Live panels
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
      const { data, error } = await client
        .from("issue_panels")
        .select("id, issue_id, page_id, panel_index, prompt, image_url, status, environment_id")
        .eq("page_id", pageId)
        .order("panel_index", { ascending: true });
      if (error) {
        console.error(friendlySupabaseError(error as { message: string }, "Fetch panels") || error.message);
        return;
      }
      setPanels((data as IssuePanel[]) ?? []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Polling for live panels
  useEffect(() => {
    if (!selectedPageId) {
      setPanels([]);
      return;
    }
    setPanelsLoading(true);
    fetchPanels(selectedPageId).finally(() => setPanelsLoading(false));
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => fetchPanels(selectedPageId), 3000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [selectedPageId, fetchPanels]);

  const handleCreateIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setIssueMsg(null);
    if (!newIssueTitle.trim()) {
      setIssueMsg({ type: "error", text: "Issue title required" });
      return;
    }
    setIssueCreating(true);
    try {
      const res = await fetch("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newIssueTitle.trim(), description: newIssueDesc.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create issue");
      setIssueMsg({ type: "success", text: `Issue #${json.issue.issue_number}: "${json.issue.title}" created!` });
      const newIssue = json.issue as Issue;
      setIssues((prev) => [...prev, newIssue].sort((a, b) => a.issue_number - b.issue_number));
      setSelectedIssueId(newIssue.id);
      setNewIssueTitle("");
      setNewIssueDesc("");
    } catch (err) {
      setIssueMsg({ type: "error", text: err instanceof Error ? err.message : String(err) });
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
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_id: selectedIssueId, title: newPageTitle.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create page");
      setPageMsg({ type: "success", text: `Page ${json.page.page_number} created!` });
      const newPage = json.page as Page;
      setPages((prev) => [...prev, newPage].sort((a, b) => a.page_number - b.page_number));
      setSelectedPageId(newPage.id);
      setNewPageTitle("");
    } catch (err) {
      setPageMsg({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPageCreating(false);
    }
  };

  const toggleCharacter = (id: string) => {
    setSelectedCharIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const handleCreatePanel = async (e: React.FormEvent) => {
    e.preventDefault();
    setPanelMsg(null);
    if (!selectedIssueId || !selectedPageId) {
      setPanelMsg({ type: "error", text: "Select an issue and page first" });
      return;
    }
    if (selectedCharIds.length === 0) {
      setPanelMsg({ type: "error", text: "Select at least one character (checkboxes)" });
      return;
    }
    if (!panelPrompt.trim()) {
      setPanelMsg({ type: "error", text: "Prompt required" });
      return;
    }
    setPanelCreating(true);
    try {
      const res = await fetch("/api/issue-panels/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueId: selectedIssueId,
          pageId: selectedPageId,
          prompt: panelPrompt.trim(),
          characterIds: selectedCharIds,
          environmentId: selectedEnvId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create panel");
      setPanelMsg({ type: "success", text: `Panel ${json.panelIndex + 1} queued — generating with ${selectedCharIds.length} character(s)!` });
      setPanelPrompt("");
      // immediate fetch
      fetchPanels(selectedPageId);
    } catch (err) {
      setPanelMsg({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPanelCreating(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black">Create — Issues → Pages → Panels</h1>
        <p className="mt-1 text-sm text-neutral-600">
          New hierarchy (clean break from flat comics). Create Issues, add Pages, then generate Panels with <span className="font-semibold">multi-character</span> +{" "}
          <span className="font-semibold">environment</span> reference. Library ordering: Issue 1 p1/p2/p3, Issue 2 p1/p2/p3.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href="/library" className="rounded-full border bg-white px-3 py-1 text-xs font-medium hover:bg-neutral-50">
            View Library →
          </a>
          <a href="/comics/create" className="rounded-full border bg-white px-3 py-1 text-xs font-medium hover:bg-neutral-50">
            Legacy Comic Creator
          </a>
          <a href="/environments" className="rounded-full border bg-white px-3 py-1 text-xs font-medium hover:bg-neutral-50">
            Environments
          </a>
        </div>
      </div>

      {libLoading ? (
        <div className="rounded-xl border bg-white p-6 text-sm text-neutral-500">Loading libraries…</div>
      ) : (
        <>
          {/* Issue + Page creation */}
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">1</span>
                <h2 className="text-lg font-bold">Issues</h2>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">{issues.length} total</span>
              </div>

              <form onSubmit={handleCreateIssue} className="mt-4 space-y-3">
                <div>
                  <label className="text-sm font-medium">New Issue Title *</label>
                  <input
                    value={newIssueTitle}
                    onChange={(e) => setNewIssueTitle(e.target.value)}
                    placeholder="e.g. The Beginning, Nightfall, etc."
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <input
                    value={newIssueDesc}
                    onChange={(e) => setNewIssueDesc(e.target.value)}
                    placeholder="Optional — what this issue is about"
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                </div>
                {issueMsg && (
                  <div className={`rounded-lg px-3 py-2 text-sm ${issueMsg.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{issueMsg.text}</div>
                )}
                <button
                  type="submit"
                  disabled={issueCreating}
                  className="w-full rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {issueCreating ? "Creating…" : "Create Issue (auto-numbered)"}
                </button>
              </form>

              <div className="mt-6">
                <label className="text-sm font-medium">Select Issue *</label>
                {issues.length === 0 ? (
                  <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No issues yet — create one above.</div>
                ) : (
                  <select
                    value={selectedIssueId}
                    onChange={(e) => setSelectedIssueId(e.target.value)}
                    className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                  >
                    {issues.map((iss) => (
                      <option key={iss.id} value={iss.id}>
                        Issue #{iss.issue_number}: {iss.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-sm font-bold text-white">2</span>
                <h2 className="text-lg font-bold">Pages</h2>
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">{pages.length} in selected issue</span>
              </div>

              {!selectedIssueId ? (
                <div className="mt-4 rounded-lg border border-dashed p-4 text-center text-sm text-neutral-500">Select an issue first</div>
              ) : (
                <>
                  <form onSubmit={handleCreatePage} className="mt-4 space-y-3">
                    <div>
                      <label className="text-sm font-medium">New Page Title (optional)</label>
                      <input
                        value={newPageTitle}
                        onChange={(e) => setNewPageTitle(e.target.value)}
                        placeholder="e.g. Rooftop Chase"
                        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                      />
                      <p className="mt-1 text-xs text-neutral-500">Auto-numbered per issue — Page 1, 2, 3…</p>
                    </div>
                    {pageMsg && (
                      <div className={`rounded-lg px-3 py-2 text-sm ${pageMsg.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{pageMsg.text}</div>
                    )}
                    <button
                      type="submit"
                      disabled={pageCreating}
                      className="w-full rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {pageCreating ? "Creating…" : "Add Page to Issue"}
                    </button>
                  </form>

                  <div className="mt-6">
                    <label className="text-sm font-medium">Select Page *</label>
                    {pages.length === 0 ? (
                      <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No pages yet — add one above.</div>
                    ) : (
                      <select
                        value={selectedPageId}
                        onChange={(e) => setSelectedPageId(e.target.value)}
                        className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                      >
                        {pages.map((p) => (
                          <option key={p.id} value={p.id}>
                            Page {p.page_number}
                            {p.title ? `: ${p.title}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>

          {/* Panel creation with multi-character + environment */}
          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">3</span>
              <h2 className="text-lg font-bold">Create Panel — Multi-Character + Environment</h2>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">prompt combines selections</span>
            </div>

            {!selectedPageId ? (
              <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-neutral-500">Select an issue and page to create panels</div>
            ) : (
              <form onSubmit={handleCreatePanel} className="mt-6 space-y-5">
                {/* Characters multi-select */}
                <div>
                  <label className="text-sm font-medium">Characters * (checkboxes — select multiple)</label>
                  <p className="text-xs text-neutral-500">e.g. Luna + Kai together. Prompt will combine as “Featuring Luna, Kai…”</p>
                  {characters.length === 0 ? (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      No characters yet — add in <a href="/comics/create" className="underline font-medium">/comics/create</a> Section A.
                    </div>
                  ) : (
                    <div className="mt-2 grid gap-2 rounded-xl border bg-neutral-50 p-3 sm:grid-cols-2">
                      {characters.map((c) => {
                        const checked = selectedCharIds.includes(c.id);
                        return (
                          <label
                            key={c.id}
                            className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3 hover:bg-neutral-50 ${checked ? "border-indigo-500 ring-1 ring-indigo-500" : ""}`}
                          >
                            <input type="checkbox" checked={checked} onChange={() => toggleCharacter(c.id)} className="h-4 w-4 rounded border-neutral-300 text-indigo-600" />
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.reference_image_url} alt={c.name} className="h-10 w-10 rounded-full object-cover" />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold leading-none">{c.name}</div>
                              {c.description && <div className="mt-1 line-clamp-1 text-xs text-neutral-500">{c.description}</div>}
                            </div>
                            {checked && <span className="ml-auto text-xs font-bold text-indigo-600">✓</span>}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {selectedCharIds.length > 0 && (
                    <div className="mt-2 text-xs text-neutral-600">
                      Selected: {selectedCharIds.map((id) => characters.find((c) => c.id === id)?.name).join(", ")}
                    </div>
                  )}
                </div>

                {/* Environment select */}
                <div>
                  <label className="text-sm font-medium">Environment (optional — single select)</label>
                  <p className="text-xs text-neutral-500">e.g. Cyber City Rooftop — will be sent as environment_reference_url to GPU worker</p>
                  {environments.length === 0 ? (
                    <div className="mt-1 rounded-lg border bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                      No environments — create in <a href="/environments" className="underline text-indigo-600">/environments</a>.
                    </div>
                  ) : (
                    <select
                      value={selectedEnvId}
                      onChange={(e) => setSelectedEnvId(e.target.value)}
                      className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                    >
                      <option value="">— No environment (character-only) —</option>
                      {environments.map((env) => (
                        <option key={env.id} value={env.id}>
                          {env.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {selectedEnvId && environments.find((e) => e.id === selectedEnvId) && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={environments.find((e) => e.id === selectedEnvId)!.reference_image_url}
                        alt="env"
                        className="h-8 w-8 rounded object-cover"
                      />
                      <span>{environments.find((e) => e.id === selectedEnvId)!.name} — reference will be included in generation</span>
                    </div>
                  )}
                </div>

                {/* Prompt */}
                <div>
                  <label className="text-sm font-medium">Panel Prompt *</label>
                  <textarea
                    value={panelPrompt}
                    onChange={(e) => setPanelPrompt(e.target.value)}
                    placeholder="Luna and Kai standing on a rainy rooftop at night, neon city behind them, cinematic comic style"
                    rows={3}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  />
                  <p className="mt-1 text-xs text-neutral-500">
                    This will be combined with selected characters + environment: e.g. “Featuring: Luna, Kai in Cyber City Rooftop — [your prompt]” and sent as{" "}
                    <code className="rounded bg-neutral-100 px-1">prompt</code> + <code className="bg-neutral-100 px-1">character_reference_urls[]</code> + environment to{" "}
                    <code className="bg-neutral-100 px-1">GPU_WORKER_URL</code>.
                  </p>
                </div>

                {panelMsg && (
                  <div className={`rounded-lg px-3 py-2 text-sm ${panelMsg.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{panelMsg.text}</div>
                )}

                <button
                  type="submit"
                  disabled={panelCreating}
                  className="w-full rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {panelCreating ? "Queuing…" : `Generate Panel → Issue ${issues.find((i) => i.id === selectedIssueId)?.issue_number ?? "?"} Page ${pages.find((p) => p.id === selectedPageId)?.page_number ?? "?"}`}
                </button>
              </form>
            )}
          </section>

          {/* Live panels */}
          <section className="rounded-2xl border bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">4</span>
              <h2 className="text-lg font-bold">Live Panels</h2>
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">Polling every 3s</span>
              {selectedPageId && <span className="text-xs text-neutral-500">Page ID: {selectedPageId.slice(0, 8)}…</span>}
            </div>

            {!selectedPageId ? (
              <div className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-neutral-500">Select a page to see its panels live</div>
            ) : panelsLoading && panels.length === 0 ? (
              <div className="mt-4 text-center text-sm text-neutral-500">Loading panels…</div>
            ) : panels.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-neutral-500">No panels yet on this page — create one above.</div>
            ) : (
              <>
                <div className="mt-2 text-xs text-neutral-500">
                  {panels.filter((p) => p.status === "completed").length} / {panels.length} completed • polling every 3 seconds
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {panels.map((panel) => (
                    <div key={panel.id} className="overflow-hidden rounded-xl border bg-neutral-50">
                      <div className="aspect-[4/3] overflow-hidden bg-white">
                        {panel.status === "completed" && panel.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={panel.image_url} alt={panel.prompt} className="h-full w-full object-cover" loading="lazy" />
                        ) : panel.status === "failed" ? (
                          <div className="flex h-full w-full items-center justify-center bg-red-50 p-4 text-center text-sm text-red-600">Generation failed</div>
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" />
                            <div className="text-xs font-medium text-neutral-500">Pending — GPU worker…</div>
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">Panel {panel.panel_index + 1}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${panel.status === "completed" ? "bg-green-100 text-green-700" : panel.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
                          >
                            {panel.status}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-3 text-sm leading-snug text-neutral-700">{panel.prompt}</p>
                        {panel.image_url && (
                          <a href={panel.image_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:underline">
                            Open image →
                          </a>
                        )}
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
