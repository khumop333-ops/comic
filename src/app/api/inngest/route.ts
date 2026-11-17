import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { generatePanel } from "@/inngest/functions/generate-panel";
import { generateIssuePanel } from "@/inngest/functions/generate-issue-panel";

// Ensure Node.js runtime (supabase-js + fetch handling)
export const runtime = "nodejs";

// Inngest serve handler - registers all background functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [generatePanel, generateIssuePanel],
});
