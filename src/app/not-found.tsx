import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border bg-white p-8 text-center shadow-sm">
      <h2 className="text-lg font-bold">Page not found</h2>
      <p className="mt-2 text-sm text-neutral-600">The page you’re looking for doesn’t exist.</p>
      <Link href="/" className="mt-6 inline-block rounded-full bg-neutral-900 px-5 py-2 text-sm font-semibold text-white hover:bg-black">
        Go home
      </Link>
    </div>
  );
}
