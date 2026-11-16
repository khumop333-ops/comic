import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client initialized with service role key.
 * Uses NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as required.
 * Service role bypasses RLS — suitable for server-side Inngest functions & API routes.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role-key";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.warn("[supabase] Missing NEXT_PUBLIC_SUPABASE_URL env var — using placeholder for build");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[supabase] Missing SUPABASE_SERVICE_ROLE_KEY env var — using placeholder for build");
}

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Re-export type helper for convenience
export type SupabaseClient = typeof supabase;
