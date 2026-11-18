"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
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
      const { data, error } = await client.from("environments").select("id, name, description, reference_image_url, created_at").order("created_at", { ascending: false });
      if (error) console.error(friendlySupabaseError(error as { message: string }, "Fetch environments") || error.message);
      else setEnvs((data as Environment[]) ?? []);
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
    if (file.size > 10 * 1024 * 1024) {
      setMessage({ type: "error", text: "Image must be under 10MB (enforced server-side too)." });
      return;
    }
    setSubmitting(true);
    try {
      if (!file.type.startsWith("image/")) throw new Error("File must be an image");
      const ext = file.name.split(".").pop() || "png";
      const safeName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const filePath = `environments/${Date.now()}-${safeName}.${ext}`;
      const client = getSupabaseBrowser();
      const { error: uploadError } = await client.storage.from("comic-assets").upload(filePath, file, {
        contentType: file.type || "image/png",
        upsert: false,
        cacheControl: "3600",
      });
      if (uploadError) throw new Error(friendlySupabaseError(uploadError as { message: string }, "Storage upload") || uploadError.message);
      const { data: urlData } = client.storage.from("comic-assets").getPublicUrl(filePath);
      const publicUrl = urlData.publicUrl;
      if (!publicUrl) throw new Error("Failed to get public URL");

      const res = await fetch("/api/environments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, reference_image_url: publicUrl }),
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
      if (msg.includes("Rate limited")) setMessage({ type: "error", text: "Rate limited — wait a moment and retry." });
      else setMessage({ type: "error", text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this environment? Panels using it will keep their reference but show as empty.")) return;
    const res = await fetch(`/api/environments?id=${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) alert(json.error || "Delete failed");
    else setEnvs((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black">Environments</h1>
        <p className="mt-1 text-sm text-neutral-600">Separate reference library like Characters — e.g. “Cyber City Rooftop”. Upload a name + image, then select it when creating panels.</p>
      </div>

      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white" aria-hidden>＋</span>
          <h2 className="text-lg font-bold">Add Environment</h2>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600">comic-assets/environments/</span>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4 md:grid-cols-[1fr_260px]" noValidate>
          <div className="space-y-4">
            <div>
              <label htmlFor="env-name" className="text-sm font-medium">
                Environment Name <span className="text-red-600">*</span>
              </label>
              <input id="env-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cyber City Rooftop" required aria-required className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600" />
            </div>
            <div>
              <label htmlFor="env-desc" className="text-sm font-medium">
                Description
              </label>
              <textarea id="env-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Neon-lit skyline, rain-slick rooftops, hover-billboards…" rows={3} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600" />
            </div>
            <div>
              <label htmlFor="env-file" className="text-sm font-medium">
                Reference Image <span className="text-red-600">*</span>
              </label>
              <input id="env-file" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required className="mt-1 block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" />
              <p className="mt-1 text-xs text-neutral-500">Uploads to comic-assets/environments/ — used as background/style reference for panels. Max 10MB.</p>
            </div>

            {message && (
              <div role="alert" className={`rounded-lg px-3 py-2 text-sm ${message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {message.text}
              </div>
            )}

            <button type="submit" disabled={submitting} className="w-full rounded-full bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">
              {submitting ? "Saving…" : "Save Environment"}
            </button>
          </div>

          <div className="rounded-xl border bg-neutral-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-neutral-500">Preview</div>
            <div className="mt-3 aspect-square overflow-hidden rounded-xl border bg-white relative">
              {preview ? <Image src={preview} alt="preview" fill className="object-cover" unoptimized /> : <div className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-neutral-400">No image selected</div>}
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
          <div className="mt-4 rounded-xl border border-dashed p-8 text-center text-sm text-neutral-500">No environments yet — add one above. Examples: “Haunted Library”, “Neon Alley”, “Spaceship Bridge”.</div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {envs.map((env) => (
              <div key={env.id} className="group overflow-hidden rounded-xl border bg-neutral-50 flex flex-col">
                <div className="aspect-[16/10] overflow-hidden bg-white relative">
                  <Image src={env.reference_image_url} alt={env.name} fill className="object-cover" sizes="(max-width:768px) 100vw, 33vw" unoptimized />
                </div>
                <div className="p-3 flex-1">
                  <div className="font-semibold text-sm line-clamp-1">{env.name}</div>
                  {env.description && <p className="mt-1 text-xs text-neutral-600 line-clamp-2">{env.description}</p>}
                  <div className="mt-2 text-[11px] text-neutral-400 font-mono">{env.id.slice(0, 8)}…</div>
                </div>
                <div className="flex gap-2 p-3 pt-0">
                  <a href={env.reference_image_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-teal-700 hover:underline">Open image →</a>
                  <button onClick={() => handleDelete(env.id)} className="ml-auto text-xs font-medium text-red-600 hover:text-red-700">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
