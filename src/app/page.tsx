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
            href="/create"
            className="rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            New: Create Issues →
          </Link>
          <Link
            href="/library"
            className="rounded-full bg-neutral-900 px-6 py-3 text-sm font-semibold text-white hover:bg-black"
          >
            Library
          </Link>
          <Link
            href="/environments"
            className="rounded-full border bg-white px-6 py-3 text-sm font-semibold hover:bg-neutral-50"
          >
            Environments
          </Link>
          <a
            href="/api/inngest"
            className="rounded-full border bg-white px-6 py-3 text-sm font-semibold hover:bg-neutral-50"
          >
            Inngest
          </a>
        </div>
        <div className="mt-10 grid gap-4 text-sm">
          <div className="rounded-xl bg-neutral-50 p-4">
            <div className="font-semibold">1. Supabase — New Hierarchy</div>
            <div className="text-neutral-600">
              <code>environments</code> · <code>issues</code> (issue_number) · <code>pages</code>{" "}
              (page_number) · <code>issue_panels</code> + <code>panel_characters</code> junction —
              ordered Issue→Page→Panel. Legacy <code>comics/comic_panels</code> still supported. Bucket{" "}
              <code>comic-assets</code> paths: <code>characters/</code>, <code>environments/</code>,{" "}
              <code>issue-panels/</code>
            </div>
          </div>
          <div className="rounded-xl bg-neutral-50 p-4">
            <div className="font-semibold">2. Inngest Events</div>
            <div className="text-neutral-600">
              <code>comic/panel.generate</code> (legacy) & <code>issue/panel.generate</code>{" "}
              (multi-char+env: <code>{`{ panelId, prompt, characterReferenceUrls[], environmentReferenceUrl, issueId, pageId }`}</code>)
            </div>
          </div>
          <div className="rounded-xl bg-neutral-50 p-4">
            <div className="font-semibold">3. GPU Worker</div>
            <div className="text-neutral-600">
              POST <code>GPU_WORKER_URL</code> with{" "}
              <code>{`{ prompt, character_reference_urls, environment_reference_url }`}</code> → image
              → <code>{`issue-panels/{issueId}/{pageId}/{panelId}.png`}</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
