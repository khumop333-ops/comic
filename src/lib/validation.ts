import { z } from "zod";

// Shared Zod schemas for all API routes — server-side validation only
export const characterSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().nullable(),
  reference_image_url: z.string().url().refine((u) => u.includes("supabase.co") || u.includes("comic-assets"), {
    message: "reference_image_url must be a Supabase comic-assets URL",
  }),
});

export const environmentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().nullable(),
  reference_image_url: z.string().url().refine((u) => u.includes("supabase.co") || u.includes("comic-assets"), {
    message: "reference_image_url must be a Supabase comic-assets URL",
  }),
});

export const issueSchema = z.object({
  title: z.string().trim().min(1).max(200),
  issue_number: z.number().int().positive().optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  cover_image_url: z.string().url().nullable().optional(),
});

export const pageSchema = z.object({
  issue_id: z.string().uuid(),
  page_number: z.number().int().positive().optional(),
  title: z.string().trim().max(200).optional().nullable(),
});

export const issuePanelGenerateSchema = z.object({
  issueId: z.string().uuid(),
  pageId: z.string().uuid(),
  prompt: z.string().trim().min(3).max(2000),
  characterIds: z.array(z.string().uuid()).min(1).max(5),
  environmentId: z.string().uuid().nullable().optional(),
});

export const legacyComicGenerateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  characterId: z.string().uuid(),
  scriptLines: z.array(z.string().trim().min(1).max(2000)).min(1).max(20),
});

export function parseOrError<T>(schema: z.ZodSchema<T>, data: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const res = schema.safeParse(data);
  if (res.success) return { ok: true, data: res.data };
  const msg = res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  return { ok: false, error: msg };
}
