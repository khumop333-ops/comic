import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Comic Studio — Panel Generation Pipeline",
    template: "%s | Comic Studio",
  },
  description: "Generate comic book panels with character consistency via Supabase + Inngest + GPU worker. Create characters, environments, issues→pages→panels.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://comic-j6p9.vercel.app"),
  openGraph: {
    title: "Comic Studio",
    description: "Consistent characters, cinematic panels. Build your library, generate with Inngest + GPU.",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "Comic Studio", description: "Generate consistent comic panels with your characters" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-full focus:bg-neutral-900 focus:px-4 focus:py-2 focus:text-white">
          Skip to content
        </a>
        <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <a href="/" className="text-lg font-black tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 rounded-full px-2 py-1 -ml-2">
              COMIC<span className="text-indigo-600">STUDIO</span>
            </a>
            <nav className="flex items-center gap-2 sm:gap-3 text-sm" aria-label="Primary">
              <a href="/create" className="rounded-full bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600">
                Create
              </a>
              <a href="/library" className="rounded-full border bg-white px-4 py-2 font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900">
                Library
              </a>
              <a href="/environments" className="hidden rounded-full border bg-white px-4 py-2 font-medium hover:bg-neutral-50 sm:inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900">
                Environments
              </a>
              <a href="/comics/create" className="hidden rounded-full bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-black md:inline-block focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900">
                Legacy
              </a>
            </nav>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 py-8 text-center text-xs text-neutral-500">
          <span className="rounded-full bg-white border px-3 py-1">Built with Supabase + Inngest + GPU worker • <a href="/api/inngest" className="underline hover:text-neutral-900">Inngest endpoint</a></span>
        </footer>
      </body>
    </html>
  );
}
