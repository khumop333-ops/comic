"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabaseBrowser, friendlySupabaseError } from "@/lib/supabase";

type Environment = {
  id: string;
  name: string;
  description: string | null;
  reference_image_url: string;
  created_at?: string;
};

export default function EnvironmentsPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [envs, setEnvs] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEnvs = useCallback(async () => {
    setLoading(true);
    try {
      const client = getSupabaseBrowser();
      const { data, error } = await client
        .from("environments")
        .select("id, name, description, reference_image_url, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        console.error(friendlySupabaseError(error as { message: string }, "Fetch environments") || error.message);
      } else {
        setEnvs((data as Environment[]) ?? []);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEnvs();
  }, [fetchEnvs]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!name.trim()) {
      setMessage({ type: "error", text: "Environment name is required." });
      return;
    }
    if (!file) {
      setMessage({ type: "error", text: "Please upload a reference image." });
      return;
    }
    setSubmitting(true);
    try {
      if (!file.type.startsWith("image/")) throw new Error("File must be an image");
      if (file.size > 10 * 1024 * 1024) throw new Error("Image must be under 10MB");

      const ext = file.name.split(".").pop() || "png";
      const safeName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const filePath = `environments/${Date.now()}-${safeName}.${ext}`;

      let client: ReturnType<typeof getSupabaseBrowser>;
      try {
        client = getSupabaseBrowser();
      } catch (configErr) {
        throw new Error(String(configErr));
      }

      const { error: uploadError } = await client.storage.from("comic-assets").upload(filePath, file, {
        contentType: file.type || "image/png",
        upsert: false,
        cacheControl: "3600",
      });

      if (uploadError) {
        const friendly = friendlySupabaseError(uploadError as { message: string }, "Storage upload");
        throw new Error(friendly || uploadError.message);
      }

      const { data: urlData } = client.storage.from("comic-assets").getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;
      if (!publicUrl) throw new Error("Failed to get public URL");

      const res = await fetch("/api/environments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          reference_image_url: publicUrl,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        await client.storage.from("comic-assets").remove([filePath]);
        throw new Error(json.error || "Failed to create environment");
      }

      setMessage({ type: "success", text: `"${name}" added!` });
      setName("");
      setDescription("");
      setFile(null);
      setPreview(null);
      setEnvs((prev) => [json.environment as Environment, ...prev]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setMessage({ type: "error", text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black">Environments</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Separate reference library like Characters — e.g. “Cyber City Rooftop”. Upload a name + image, then select it when creating panels.
        </p>
      </div>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">＋</span>
          <h2 className="text-lg font-bold">Add Environment</h2>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">
            comic-assets/environments/
          </span>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4 md:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Environment Name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. Cyber City Rooftop'
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Neon-lit skyline, rain-slick rooftops, hover-billboards…"
                rows={3}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reference Image *</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-black"
              />
              <p className="mt-1 text-xs text-neutral-500">Uploads to comic-assets/environments/ — used as background/style reference for panels.</p>
            </div>

            {message && (
              <div className={`rounded-lg px-3 py-2 text-sm ${message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Save Environment"}
            </button>
          </div>

          <div className="rounded-xl border bg-neutral-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-neutral-500">Preview</div>
            <div className="mt-3 aspect-square overflow-hidden rounded-xl border bg-white">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="preview" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-neutral-400">No image selected</div>
              )}
            </div>
            <div className="mt-3 text-xs text-neutral-600">
              <div className="font-medium">Library size: {envs.length} environments</div>
            </div>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold">Environment Library</h2>
        {loading ? (
          <div className="mt-4 text-sm text-neutral-500">Loading…</div>
        ) : envs.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-neutral-500">
            No environments yet — add one above. Examples: “Haunted Library”, “Neon Alley”, “Spaceship Bridge”.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {envs.map((env) => (
              <div key={env.id} className="overflow-hidden rounded-xl border bg-neutral-50">
                <div className="aspect-[16/10] overflow-hidden bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={env.reference_image_url} alt={env.name} className="h-full w-full object-cover" loading="lazy" />
                </div>
                <div className="p-3">
                  <div className="font-semibold text-sm">{env.name}</div>
                  {env.description && <p className="mt-1 text-xs text-neutral-600 line-clamp-2">{env.description}</p>}
                  <div className="mt-2 text-[11px] text-neutral-400">{env.id.slice(0, 8)}…</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="rounded-xl bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-300">
        <div className="font-semibold text-white">Multi-character note</div>
        <p className="mt-1">
          When creating panels in <a href="/create" className="underline text-white">/create</a>, you can select multiple characters (checkboxes) and one environment — the prompt combines them, e.g. “Featuring Luna + Kai in Cyber City Rooftop”.
        </p>
      </div>
    </div>
  );
}
