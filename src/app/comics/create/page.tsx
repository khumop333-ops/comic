"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, getSupabase, getSupabaseBrowser, friendlySupabaseError } from "@/lib/supabase";

type Character = {
  id: string;
  name: string;
  description: string | null;
  reference_image_url: string;
  created_at?: string;
};

// Matches actual DB: comic_panels(id, comic_id, character_id, panel_index, prompt_used, image_url, status)
type ComicPanelDB = {
  id: string;
  comic_id: string;
  character_id?: string;
  panel_index?: number;
  prompt_used?: string;
  prompt?: string; // legacy fallback
  image_url: string | null;
  status: "pending" | "completed" | "failed" | string;
  panel_number?: number; // legacy
  order_index?: number; // legacy
  created_at?: string;
};

export default function CreateComicPage() {
  const [charName, setCharName] = useState("");
  const [charDescription, setCharDescription] = useState("");
  const [charFile, setCharFile] = useState<File | null>(null);
  const [charPreview, setCharPreview] = useState<string | null>(null);
  const [charSubmitting, setCharSubmitting] = useState(false);
  const [charMessage, setCharMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [characters, setCharacters] = useState<Character[]>([]);
  const [charactersLoading, setCharactersLoading] = useState(true);

  const [comicTitle, setComicTitle] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>("");
  const [scriptText, setScriptText] = useState("");
  const [comicSubmitting, setComicSubmitting] = useState(false);
  const [comicMessage, setComicMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [activeComicId, setActiveComicId] = useState<string | null>(null);
  const [panels, setPanels] = useState<ComicPanelDB[]>([]);
  const [panelsLoading, setPanelsLoading] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchCharacters = useCallback(async () => {
    setCharactersLoading(true);
    try {
      const client = getSupabaseBrowser();
      const { data, error } = await client
        .from("characters")
        .select("id, name, description, reference_image_url, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        const friendly = friendlySupabaseError(error as { message: string }, "Fetch characters");
        console.error(friendly || error.message);
        // Show user-friendly error if it's JWS
        if (error.message.includes("Invalid Compact JWS")) {
          setCharMessage({ type: "error", text: friendly || error.message });
        }
      } else {
        setCharacters((data as Character[]) ?? []);
        if (data && data.length > 0 && !selectedCharacterId) {
          setSelectedCharacterId((data[0] as Character).id);
        }
      }
    } catch (e) {
      console.error("fetchCharacters config error:", e);
    }
    setCharactersLoading(false);
  }, [selectedCharacterId]);

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  useEffect(() => {
    if (!charFile) {
      setCharPreview(null);
      return;
    }
    const url = URL.createObjectURL(charFile);
    setCharPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [charFile]);

  const handleAddCharacter = async (e: React.FormEvent) => {
    e.preventDefault();
    setCharMessage(null);

    if (!charName.trim()) {
      setCharMessage({ type: "error", text: "Character name is required." });
      return;
    }
    if (!charFile) {
      setCharMessage({ type: "error", text: "Please upload a reference image." });
      return;
    }

    setCharSubmitting(true);
    try {
      if (!charFile.type.startsWith("image/")) throw new Error("File must be an image");
      if (charFile.size > 10 * 1024 * 1024) throw new Error("Image must be under 10MB");

      const ext = charFile.name.split(".").pop() || "png";
      const safeName = charName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const filePath = `characters/${Date.now()}-${safeName}.${ext}`;

      let client: ReturnType<typeof getSupabaseBrowser>;
      try {
        client = getSupabaseBrowser();
      } catch (configErr) {
        throw new Error(String(configErr));
      }

      const { error: uploadError } = await client.storage.from("comic-assets").upload(filePath, charFile, {
        contentType: charFile.type || "image/png",
        upsert: false,
        cacheControl: "3600",
      });

      if (uploadError) {
        const friendly = friendlySupabaseError(uploadError as { message: string }, "Storage upload");
        throw new Error(friendly || uploadError.message);
      }

      const { data: urlData } = client.storage.from("comic-assets").getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;
      if (!publicUrl) throw new Error("Failed to get public URL for character image");

      const { data: inserted, error: insertError } = await (client.from("characters") as unknown as { insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } } }).insert({
          name: charName.trim(),
          description: charDescription.trim() || null,
          reference_image_url: publicUrl,
        }).select("id, name, description, reference_image_url, created_at").single();

      if (insertError) {
        await client.storage.from("comic-assets").remove([filePath]);
        const friendly = friendlySupabaseError(insertError as { message: string }, "DB insert");
        throw new Error(friendly || insertError.message);
      }

      setCharMessage({ type: "success", text: `Character "${charName}" created!` });
      setCharName("");
      setCharDescription("");
      setCharFile(null);
      setCharPreview(null);
      const newChar = inserted as Character;
      setCharacters((prev) => [newChar, ...prev]);
      setSelectedCharacterId(newChar.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create character";
      // Special handling for Invalid Compact JWS
      if (msg.includes("Invalid Compact JWS")) {
        setCharMessage({
          type: "error",
          text: `${msg} — Check Vercel env vars NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set correctly and redeploy. For local dev, set them in .env.local (Comic project: https://hzegkbmgkvwhvtqdkuqr.supabase.co).`,
        });
      } else {
        setCharMessage({ type: "error", text: msg });
      }
    } finally {
      setCharSubmitting(false);
    }
  };

  const handleCreateComic = async (e: React.FormEvent) => {
    e.preventDefault();
    setComicMessage(null);

    if (!comicTitle.trim()) {
      setComicMessage({ type: "error", text: "Comic title is required." });
      return;
    }
    if (!selectedCharacterId) {
      setComicMessage({ type: "error", text: "Please select a character." });
      return;
    }
    const lines = scriptText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setComicMessage({ type: "error", text: "Please enter at least one panel prompt (one per line)." });
      return;
    }

    setComicSubmitting(true);
    try {
      const res = await fetch("/api/comics/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: comicTitle.trim(),
          characterId: selectedCharacterId,
          scriptLines: lines,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create comic");

      const comicId = json.comicId as string;
      setActiveComicId(comicId);
      setComicMessage({
        type: "success",
        text: `Comic "${comicTitle}" created with ${lines.length} panels! Generating…`,
      });
      setPanels([]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setComicMessage({ type: "error", text: msg });
    } finally {
      setComicSubmitting(false);
    }
  };

  const fetchPanels = useCallback(async (comicId: string) => {
    try {
      const client = getSupabaseBrowser();
      // Use actual DB columns: panel_index, prompt_used, image_url, status; fallback to legacy prompt/panel_number for older data
      const { data, error } = await client
        .from("comic_panels")
        .select("id, comic_id, character_id, panel_index, prompt_used, prompt, image_url, status, panel_number, order_index, created_at")
        .eq("comic_id", comicId)
        .order("panel_index", { ascending: true })
        .order("panel_number", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) {
        const friendly = friendlySupabaseError(error as { message: string }, "Fetch panels");
        console.error(friendly || error.message);
        return;
      }
      setPanels((data as ComicPanelDB[]) ?? []);
    } catch (e) {
      console.error("fetchPanels config error:", e);
    }
  }, []);

  useEffect(() => {
    if (!activeComicId) return;
    setPanelsLoading(true);
    fetchPanels(activeComicId).finally(() => setPanelsLoading(false));
    pollingRef.current = setInterval(() => fetchPanels(activeComicId), 3000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeComicId, fetchPanels]);

  const [recentComics, setRecentComics] = useState<Array<{ id: string; title: string; created_at: string }>>([]);
  useEffect(() => {
    try {
      const client = getSupabaseBrowser();
      client
        .from("comics")
        .select("id, title, created_at")
        .order("created_at", { ascending: false })
        .limit(5)
        .then(({ data, error }) => {
          if (error) {
            console.error("recentComics fetch error:", error.message);
            return;
          }
          if (data) setRecentComics(data as typeof recentComics);
        });
    } catch {}
  }, [activeComicId, characters]);

  // Helper to get display prompt/panel number regardless of schema
  const getPanelPrompt = (p: ComicPanelDB) => p.prompt_used || p.prompt || "";
  const getPanelIndex = (p: ComicPanelDB, idx: number) =>
    (p.panel_index !== undefined && p.panel_index !== null ? p.panel_index + 1 : p.panel_number ?? idx + 1);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black">Comic Creator</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Build your character library, write a script, and watch panels generate live via Inngest + GPU worker.
        </p>
      </div>

      {/* Section A */}
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">A</span>
          <h2 className="text-lg font-bold">Add Character</h2>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
            Reference image → comic-assets/characters/
          </span>
        </div>

        <form onSubmit={handleAddCharacter} className="mt-6 grid gap-4 md:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Character Name *</label>
              <input
                value={charName}
                onChange={(e) => setCharName(e.target.value)}
                placeholder="e.g. Luna the Detective"
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={charDescription}
                onChange={(e) => setCharDescription(e.target.value)}
                placeholder="Short description, traits, outfit…"
                rows={3}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reference Image *</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setCharFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-black"
              />
              <p className="mt-1 text-xs text-neutral-500">Uploads to Supabase Storage bucket comic-assets/characters/. Requires anon key.</p>
            </div>

            {charMessage && (
              <div className={`rounded-lg px-3 py-2 text-sm ${charMessage.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {charMessage.text}
              </div>
            )}

            <button
              type="submit"
              disabled={charSubmitting}
              className="w-full rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {charSubmitting ? "Saving…" : "Save Character"}
            </button>
          </div>

          <div className="rounded-xl border bg-neutral-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-neutral-500">Preview</div>
            <div className="mt-3 aspect-square overflow-hidden rounded-xl border bg-white">
              {charPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={charPreview} alt="preview" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-neutral-400">No image selected</div>
              )}
            </div>
            <div className="mt-3 text-xs text-neutral-600">
              <div className="font-medium">Library size: {characters.length} characters</div>
              {characters.length > 0 && (
                <ul className="mt-2 max-h-32 space-y-1 overflow-auto text-xs">
                  {characters.slice(0, 5).map((c) => (
                    <li key={c.id} className="truncate">
                      • {c.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </form>
      </section>

      {/* Section B */}
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">B</span>
          <h2 className="text-lg font-bold">Create Comic</h2>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">Fires comic/panel.generate per panel</span>
        </div>

        <form onSubmit={handleCreateComic} className="mt-6 space-y-4">
          <div>
            <label className="text-sm font-medium">Comic Title *</label>
            <input
              value={comicTitle}
              onChange={(e) => setComicTitle(e.target.value)}
              placeholder="e.g. Luna and the Midnight Heist"
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Character *</label>
            {charactersLoading ? (
              <div className="mt-1 rounded-lg border px-3 py-2 text-sm text-neutral-500">Loading characters…</div>
            ) : characters.length === 0 ? (
              <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                No characters yet — add one in Section A first.
              </div>
            ) : (
              <select
                value={selectedCharacterId}
                onChange={(e) => setSelectedCharacterId(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
              >
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {selectedCharacterId && characters.find((c) => c.id === selectedCharacterId) && (
              <div className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={characters.find((c) => c.id === selectedCharacterId)!.reference_image_url}
                  alt="character ref"
                  className="h-8 w-8 rounded-full object-cover"
                />
                <span className="truncate">Reference: {characters.find((c) => c.id === selectedCharacterId)!.reference_image_url.slice(0, 60)}…</span>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">Script — one panel per line *</label>
            <textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              placeholder={`Luna standing on a rainy rooftop at night, neon city behind her\nClose-up of Luna holding a glowing key, determined expression\nLuna leaping across buildings, cape flowing`}
              rows={6}
              className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
            />
            <p className="mt-1 text-xs text-neutral-500">Each non-empty line becomes a panel prompt. Server creates placeholders with status pending and fires Inngest events.</p>
          </div>

          {comicMessage && (
            <div className={`rounded-lg px-3 py-2 text-sm ${comicMessage.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{comicMessage.text}</div>
          )}

          <button type="submit" disabled={comicSubmitting} className="w-full rounded-full bg-neutral-900 px-6 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">
            {comicSubmitting ? "Creating…" : "Generate Comic Panels"}
          </button>

          {recentComics.length > 0 && (
            <div className="rounded-xl bg-neutral-50 p-3">
              <div className="text-xs font-semibold text-neutral-600">Recent comics — click to view panels:</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {recentComics.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveComicId(c.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${activeComicId === c.id ? "bg-neutral-900 text-white" : "bg-white hover:bg-neutral-100"}`}
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </section>

      {/* Section C */}
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">C</span>
            <h2 className="text-lg font-bold">Live Panels</h2>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Polling Supabase every 3s</span>
          </div>
          {activeComicId && <div className="text-xs text-neutral-600">Comic ID: <code className="rounded bg-neutral-100 px-1 py-0.5">{activeComicId.slice(0, 12)}…</code></div>}
        </div>

        {!activeComicId ? (
          <div className="mt-6 rounded-xl border border-dashed p-8 text-center text-sm text-neutral-500">
            No active comic yet. Create a comic in Section B — its panels will appear here automatically as Inngest marks them completed.
          </div>
        ) : panelsLoading && panels.length === 0 ? (
          <div className="mt-6 text-center text-sm text-neutral-500">Loading panels…</div>
        ) : panels.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed p-8 text-center text-sm text-neutral-500">No panels found for this comic yet.</div>
        ) : (
          <>
            <div className="mt-2 text-xs text-neutral-500">
              {panels.filter((p) => p.status === "completed").length} / {panels.length} completed • polling every 3 seconds
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {panels.map((panel, idx) => (
                <div key={panel.id} className="overflow-hidden rounded-xl border bg-neutral-50">
                  <div className="aspect-[4/3] overflow-hidden bg-white">
                    {panel.status === "completed" && panel.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={panel.image_url} alt={getPanelPrompt(panel)} className="h-full w-full object-cover" loading="lazy" />
                    ) : panel.status === "failed" ? (
                      <div className="flex h-full w-full items-center justify-center bg-red-50 p-4 text-center text-sm text-red-600">Generation failed</div>
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900" />
                        <div className="text-xs font-medium text-neutral-500">Pending — generating via GPU worker…</div>
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-widest text-neutral-500">Panel {getPanelIndex(panel, idx)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${panel.status === "completed" ? "bg-green-100 text-green-700" : panel.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                        {panel.status}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 text-sm leading-snug text-neutral-700">{getPanelPrompt(panel)}</p>
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

      <div className="rounded-xl bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-300">
        <div className="font-semibold text-white">How it works</div>
        <ol className="mt-1 list-decimal pl-4">
          <li>Character reference images are uploaded to <code className="text-white">comic-assets/characters/</code> and saved in <code className="text-white">characters</code>.</li>
          <li>Creating a comic inserts into <code className="text-white">comics</code> + placeholder <code className="text-white">comic_panels</code> with status pending (actual DB: comic_id, character_id, panel_index, prompt_used).</li>
          <li>
            For each panel the API fires <code className="text-white">comic/panel.generate</code> Inngest event → background function calls <code className="text-white">GPU_WORKER_URL</code>, uploads
            result to <code className="text-white">panels/${"{comicId}"}/${"{panelId}"}.png</code>, and updates <code className="text-white">image_url</code> + <code className="text-white">status = completed</code>.
          </li>
          <li>This page polls Supabase every 3s so images appear live. If you see “Invalid Compact JWS”, check Vercel env for Comic project.</li>
        </ol>
      </div>
    </div>
  );
}
