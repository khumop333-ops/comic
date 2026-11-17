"use client";

import { useEffect, useState, useCallback } from "react";

type LibraryIssue = {
  id: string;
  title: string;
  issue_number: number;
  description: string | null;
  cover_image_url: string | null;
  pages: Array<{
    id: string;
    page_number: number;
    title: string | null;
    panels: Array<{
      id: string;
      panel_index: number;
      prompt: string;
      image_url: string | null;
      status: string;
      environment_id: string | null;
      characters: Array<{ id: string; name: string; reference_image_url: string }>;
      environment: { id: string; name: string; reference_image_url: string } | null;
    }>;
  }>;
};

export default function LibraryPage() {
  const [issues, setIssues] = useState<LibraryIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());

  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/library");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to fetch library");
      setIssues(json.issues as LibraryIssue[]);
      // auto-expand first issue
      if (json.issues.length > 0) {
        setExpandedIssues(new Set([json.issues[0].id as string]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  const toggleIssue = (id: string) => {
    setExpandedIssues((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black">Library / Projects</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Ordered catalog: <span className="font-semibold">Issues → Pages → Panels</span> — Issue 1 p1/p2/p3, Issue 2 p1/p2/p3, etc. Clean hierarchy from new tables.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/create" className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            ＋ Create
          </a>
          <button onClick={fetchLibrary} className="rounded-full border bg-white px-4 py-2 text-sm font-semibold hover:bg-neutral-50">
            Refresh
          </button>
        </div>
      </div>

      {loading && <div className="rounded-xl border bg-white p-8 text-center text-sm text-neutral-500">Loading catalog…</div>}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load library: {error}
        </div>
      )}

      {!loading && !error && issues.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-white p-8 text-center">
          <div className="text-sm font-semibold">No issues yet</div>
          <p className="mt-1 text-sm text-neutral-500">Create your first issue in <a href="/create" className="underline font-medium text-indigo-600">/create</a> — it will appear here as Issue 1 → Page 1 → Panels.</p>
          <a href="/create" className="mt-4 inline-block rounded-full bg-neutral-900 px-5 py-2 text-sm font-semibold text-white">Go to Creator →</a>
        </div>
      )}

      {!loading && !error && issues.length > 0 && (
        <div className="space-y-4">
          <div className="text-xs text-neutral-500">
            {issues.length} issue{issues.length !== 1 ? "s" : ""} • {issues.reduce((acc, i) => acc + i.pages.length, 0)} pages •{" "}
            {issues.reduce((acc, i) => acc + i.pages.reduce((a, p) => a + p.panels.length, 0), 0)} panels
          </div>

          {issues
            .slice()
            .sort((a, b) => a.issue_number - b.issue_number)
            .map((issue) => {
              const isExpanded = expandedIssues.has(issue.id);
              const pageCount = issue.pages.length;
              const panelCount = issue.pages.reduce((acc, p) => acc + p.panels.length, 0);

              return (
                <section key={issue.id} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                  <button
                    onClick={() => toggleIssue(issue.id)}
                    className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left hover:bg-neutral-50"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">
                        #{issue.issue_number}
                      </span>
                      <div>
                        <div className="font-bold">Issue {issue .issue_number}: {issue.title}</div>
                        {issue.description && <div className="text-xs text-neutral-500 line-clamp-1">{issue.description}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="rounded-full bg-neutral-100 px-2.5 py-1 font-medium">
                        {pageCount} page{pageCount !== 1 ? "s" : ""} • {panelCount} panel{panelCount !== 1 ? "s" : ""}
                      </span>
                      <span className="text-neutral-400">{isExpanded ? "▾" : "▸"}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t bg-neutral-50">
                      {issue.pages.length === 0 ? (
                        <div className="p-6 text-center text-sm text-neutral-500">No pages yet — add one in /create.</div>
                      ) : (
                        <div className="divide-y">
                          {issue.pages
                            .slice()
                            .sort((a, b) => a.page_number - b.page_number)
                            .map((page) => (
                              <div key={page.id} className="bg-white">
                                <div className="flex items-center gap-3 bg-neutral-50 px-6 py-3">
                                  <span className="rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white">
                                    Page {page.page_number}
                                  </span>
                                  {page.title && <span className="text-sm font-medium">{page.title}</span>}
                                  <span className="text-xs text-neutral-500">{page.panels.length} panels</span>
                                  <span className="ml-auto text-[11px] text-neutral-400 font-mono">{page.id.slice(0, 8)}</span>
                                </div>

                                {page.panels.length === 0 ? (
                                  <div className="px-6 py-4 text-sm text-neutral-500">No panels on this page yet.</div>
                                ) : (
                                  <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
                                    {page.panels
                                      .slice()
                                      .sort((a, b) => a.panel_index - b.panel_index)
                                      .map((panel) => (
                                        <div key={panel.id} className="overflow-hidden rounded-xl border bg-neutral-50">
                                          <div className="aspect-[4/3] overflow-hidden bg-white">
                                            {panel.status === "completed" && panel.image_url ? (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img src={panel.image_url} alt={panel.prompt} className="h-full w-full object-cover" loading="lazy" />
                                            ) : panel.status === "failed" ? (
                                              <div className="flex h-full w-full items-center justify-center bg-red-50 p-4 text-center text-sm text-red-600">
                                                Generation failed
                                              </div>
                                            ) : (
                                              <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4">
                                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" />
                                                <div className="text-xs font-medium text-neutral-500">Pending…</div>
                                              </div>
                                            )}
                                          </div>
                                          <div className="p-3">
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">
                                                Panel {panel.panel_index + 1}
                                              </span>
                                              <span
                                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                                  panel.status === "completed"
                                                    ? "bg-green-100 text-green-700"
                                                    : panel.status === "failed"
                                                      ? "bg-red-100 text-red-700"
                                                      : "bg-amber-100 text-amber-700"
                                                }`}
                                              >
                                                {panel.status}
                                              </span>
                                            </div>
                                            <p className="mt-1 line-clamp-3 text-sm leading-snug text-neutral-700">{panel.prompt}</p>

                                            {panel.characters.length > 0 && (
                                              <div className="mt-2 flex flex-wrap gap-1">
                                                {panel.characters.map((c) => (
                                                  <span
                                                    key={c.id}
                                                    className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                                                    title={c.reference_image_url}
                                                  >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={c.reference_image_url} alt={c.name} className="h-4 w-4 rounded-full object-cover" />
                                                    {c.name}
                                                  </span>
                                                ))}
                                              </div>
                                            )}

                                            {panel.environment && (
                                              <div className="mt-1 flex items-center gap-1 text-[11px] text-teal-700">
                                                <span className="rounded-full bg-teal-50 px-2 py-0.5 font-medium">
                                                  🌆 {panel.environment.name}
                                                </span>
                                              </div>
                                            )}

                                            {panel.image_url && (
                                              <a
                                                href={panel.image_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:underline"
                                              >
                                                Open image →
                                              </a>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
        </div>
      )}

      <div className="rounded-xl border bg-white p-4 text-xs leading-relaxed text-neutral-600">
        <div className="font-semibold text-neutral-900">How ordering works</div>
        <p className="mt-1">
          Issues ordered by <code className="rounded bg-neutral-100 px-1">issue_number</code>, pages by{" "}
          <code className="rounded bg-neutral-100 px-1">page_number</code>, panels by{" "}
          <code className="rounded bg-neutral-100 px-1">panel_index</code>. Example: Issue 1 → Page 1 (panels 1-3), Page 2 (panels 1-2), then Issue 2 → Page 1, etc. This is a clean
          break from the legacy flat <code>comics</code> table.
        </p>
      </div>
    </div>
  );
}
