"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border bg-white p-8 text-center shadow-sm">
      <h2 className="text-lg font-bold">Something went wrong</h2>
      <p className="mt-2 text-sm text-neutral-600 break-words">{error.message}</p>
      {error.digest && <p className="mt-1 text-xs text-neutral-400">Digest: {error.digest}</p>}
      <button onClick={reset} className="mt-6 rounded-full bg-neutral-900 px-5 py-2 text-sm font-semibold text-white hover:bg-black">
        Try again
      </button>
      <a href="/" className="ml-3 rounded-full border bg-white px-5 py-2 text-sm font-semibold hover:bg-neutral-50">
        Home
      </a>
    </div>
  );
}
