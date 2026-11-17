import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Comic Studio — Panel Generation Pipeline",
  description: "Generate comic book panels with character consistency via Supabase + Inngest + GPU worker",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <a href="/" className="text-lg font-black tracking-tight">
              COMIC<span className="text-indigo-600">STUDIO</span>
            </a>
            <nav className="flex items-center gap-3 text-sm">
              <a href="/create" className="rounded-full bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700">
                Create
              </a>
              <a href="/library" className="rounded-full border bg-white px-4 py-2 font-medium hover:bg-neutral-50">
                Library
              </a>
              <a href="/environments" className="hidden rounded-full border bg-white px-4 py-2 font-medium hover:bg-neutral-50 sm:inline-block">
                Environments
              </a>
              <a
                href="/comics/create"
                className="hidden rounded-full bg-neutral-900 px-4 py-2 font-medium text-white hover:bg-black md:inline-block"
              >
                Legacy
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
