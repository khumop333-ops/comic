import { createClient } from "@supabase/supabase-js";

// Re-export validation helpers for storage
export function isAllowedImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.endsWith("supabase.co") && url.includes("comic-assets");
  } catch {
    return false;
  }
}

export function sanitizePrompt(prompt: string): string {
  // strip control chars, limit length, basic XSS hygiene for display (not for generation)
  return prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").slice(0, 2000).trim();
}
