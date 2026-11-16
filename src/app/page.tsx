import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl py-16">
      <div className="rounded-2xl border bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">
          Comic Panel Generation Pipeline
        </p>
        <h1 className="mt-3 text-4xl font-black leading-tight">
          Generate consistent comic panels <br />
          <span className="text-indigo-600">with your characters.</span>
        </h1>
        <p className="mt-4 max-w-xl text-neutral-600">
          Create a character library with reference images, write a multi-line script, and let the
          Inngest background pipeline + GPU worker render each panel to Supabase Storage.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/comics/create"
            className="rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Go to Comic Creator →
          </Link>
          <a
            href="/api/inngest"
            className="rounded-full border bg-white px-6 py-3 text-sm font-semibold hover:bg-neutral-50"
          >
            Inngest endpoint
          </a>
        </div>
        <div className="mt-10 grid gap-4 text-sm">
          <div className="rounded-xl bg-neutral-50 p-4">
            <div className="font-semibold">1. Supabase</div>
            <div className="text-neutral-600">
              Tables: <code>characters</code>, <code>comics</code>, <code>comic_panels</code> · Bucket:{" "}
              <code>comic-assets</code>
            </div>
          </div>
          <div className="rounded-xl bg-neutral-50 p-4">
            <div className="font-semibold">2. Inngest Event</div>
            <div className="text-neutral-600">
              <code>comic/panel.generate</code> with{" "}
              <code>{"{ panelId, prompt, characterReferenceUrl, comicId }"}</code>
            </div>
          </div>
          <div className="rounded-xl bg-neutral-50 p-4">
            <div className="font-semibold">3. GPU Worker</div>
            <div className="text-neutral-600">
              POST <code>process.env.GPU_WORKER_URL</code> with{" "}
              <code>{"{ prompt, character_reference_url }"}</code> → image → upload to{" "}
              <code>/panels/${"{comicId}"}/${"{panelId}"}.png</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
