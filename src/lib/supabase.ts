import { createClient } from "@supabase/supabase-js";

/**
 * Supabase clients
 *
 * - `supabase` (server): uses SERVICE_ROLE_KEY, bypasses RLS. For API routes & Inngest.
 * - `supabaseBrowser` (client): uses ANON_KEY, respects RLS/policies. For browser uploads.
 *
 * Both use NEXT_PUBLIC_SUPABASE_URL. Server also needs SUPABASE_SERVICE_ROLE_KEY.
 * For local dev without env, we fall back to placeholder ONLY at build time to allow
 * `next build` to succeed — but throw a clear error at runtime instead of sending
 * an invalid JWS (which surfaces as "Invalid Compact JWS" from Supabase Storage).
 */

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  (process.env.NODE_ENV === "production" ? "" : "https://placeholder.supabase.co");

const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";

const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

// Build-time warnings (not runtime throw) — allow build without env
if (!process.env.NEXT_PUBLIC_SUPABASE_URL && typeof window === "undefined") {
  // Only warn on server build; browser will get runtime error below
  console.warn("[supabase] Missing NEXT_PUBLIC_SUPABASE_URL — using placeholder for build");
}

function isPlaceholder(value: string) {
  return !value || value.includes("placeholder") || value.length < 20;
}

function assertValidConfig(url: string, key: string, context: string) {
  if (isPlaceholder(url) || isPlaceholder(key)) {
    const hint =
      context === "server"
        ? "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env (production/preview/development) and redeploy. "
        : "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your .env.local for local dev.";
    throw new Error(
      `[supabase:${context}] Missing or placeholder credentials — Supabase will reject as "Invalid Compact JWS". ${hint} Got url=${url.slice(0, 30)}... key=${key.slice(0, 10)}...`
    );
  }
  // Basic JWT shape check (legacy keys are JWTs with 2 dots)
  if (key.startsWith("sb_")) {
    // New secret/publishable format — Supabase JS v2 supports it via apikey header, but Storage still validates JWS via JWT.
    // For new projects, use legacy service_role JWT (from Dashboard → API Keys → Legacy) or ensure Supabase JS is configured correctly.
    console.warn(`[supabase:${context}] Detected new sb_... key format. Ensure Supabase project allows it for Storage. Prefer legacy JWT for service_role if you see Invalid Compact JWS.`);
  } else if (!key.includes(".")) {
    throw new Error(
      `[supabase:${context}] Key does not look like a JWT (no dots) — will be rejected as Invalid Compact JWS. Use the legacy service_role JWT from Supabase Dashboard → Project Settings → API → Legacy API Keys, or the publishable key for anon.`
    );
  }
}

// Lazy clients — validate on first use, not at import time (allows build without env)
let _supabase: ReturnType<typeof createClient> | null = null;
let _supabaseBrowser: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (_supabase) return _supabase;
  // In production, require real credentials; in dev/build, allow placeholder but warn
  if (isPlaceholder(supabaseUrl) || isPlaceholder(supabaseServiceRoleKey)) {
    if (process.env.NODE_ENV === "production") {
      assertValidConfig(supabaseUrl, supabaseServiceRoleKey, "server");
    } else {
      console.warn("[supabase] Using placeholder credentials for build/dev — runtime Storage calls will fail with Invalid Compact JWS until real env vars are set");
    }
  }
  _supabase = createClient(supabaseUrl, supabaseServiceRoleKey || supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
}

export function getSupabaseBrowser() {
  if (_supabaseBrowser) return _supabaseBrowser;
  // Prefer anon key for browser; fall back to service_role only if explicitly allowed (not recommended)
  const browserKey = supabaseAnonKey || supabaseServiceRoleKey;
  if (isPlaceholder(supabaseUrl) || isPlaceholder(browserKey)) {
    if (typeof window !== "undefined") {
      // Browser runtime — throw helpful error instead of silent Invalid JWS
      console.error(
        `[supabase:browser] Missing credentials — upload will fail as "Invalid Compact JWS". Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and Vercel.`
      );
    }
  }
  _supabaseBrowser = createClient(supabaseUrl, browserKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabaseBrowser;
}

// Backwards-compatible default export used by existing code (server)
export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop) {
    const client = getSupabase();
    // @ts-expect-error proxy
    return client[prop];
  },
});

// Helper to detect and re-throw storage JWS errors with guidance
export function friendlySupabaseError(error: { message: string } | null, context: string): string | null {
  if (!error) return null;
  if (error.message.includes("Invalid Compact JWS") || error.message.includes("Invalid API key")) {
    return `${context} failed: ${error.message}. This usually means Supabase URL/key are missing, placeholder, or using new sb_secret key where legacy JWT is expected. Check Vercel env NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (legacy service_role JWT), and redeploy. Current URL: ${supabaseUrl}`;
  }
  return `${context} failed: ${error.message}`;
}

export type SupabaseClient = ReturnType<typeof getSupabase>;
