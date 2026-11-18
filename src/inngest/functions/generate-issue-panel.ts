import { inngest } from "../client";
import { supabase, getSupabase, friendlySupabaseError } from "@/lib/supabase";
import { callGpuWorker } from "@/inngest/helpers";

export type GenerateIssuePanelEventPayload = {
  panelId: string;
  prompt: string;
  originalPrompt: string;
  characterIds: string[];
  characterReferenceUrls: string[];
  environmentId: string | null;
  environmentReferenceUrl: string | null;
  issueId: string;
  pageId: string;
};

export const generateIssuePanel = inngest.createFunction(
  {
    id: "generate-issue-panel",
    name: "Generate Issue Panel (multi-character + environment)",
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: "issue/panel.generate" },
  async ({ event, step, logger }) => {
    const { panelId, prompt, originalPrompt, characterReferenceUrls, environmentReferenceUrl, issueId, pageId } = event.data as GenerateIssuePanelEventPayload;
    if (!panelId || !prompt || !issueId || !pageId) throw new Error(`Missing payload: panelId=${panelId}, issueId=${issueId}`);

    try {
      getSupabase();
    } catch (configErr) {
      await (supabase.from("issue_panels") as unknown as { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } }).update({ status: "failed", error_message: String(configErr).slice(0, 500) }).eq("id", panelId);
      throw new Error(String(configErr));
    }

    logger.info("Generating issue panel", { panelId, issueId, pageId, characters: characterReferenceUrls?.length });

    const imageResult = await step.run("call-gpu-worker", async () => {
      const payload: Record<string, unknown> = {
        prompt,
        original_prompt: originalPrompt,
        character_reference_urls: characterReferenceUrls,
        character_reference_url: characterReferenceUrls[0] ?? null,
      };
      if (environmentReferenceUrl) {
        payload.environment_reference_url = environmentReferenceUrl;
        payload.environment_reference_urls = [environmentReferenceUrl];
      }
      return callGpuWorker(payload);
    });

    const publicUrl = await step.run("upload-to-supabase-storage", async () => {
      const filePath = `issue-panels/${issueId}/${pageId}/${panelId}.png`;
      const buffer = Buffer.from(imageResult.base64, "base64");
      const fileBlob = new Blob([new Uint8Array(buffer)], { type: imageResult.contentType || "image/png" });
      const client = getSupabase();
      const { error: uploadError } = await client.storage.from("comic-assets").upload(filePath, fileBlob, {
        contentType: imageResult.contentType || "image/png",
        upsert: true,
        cacheControl: "3600",
      });
      if (uploadError) {
        const friendly = friendlySupabaseError(uploadError as { message: string }, "Supabase storage upload");
        if (friendly?.includes("Invalid Compact JWS")) {
          await (client.from("issue_panels") as unknown as { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } }).update({ status: "failed", error_message: friendly.slice(0, 500) }).eq("id", panelId);
          throw new Error(`${friendly} — Check SUPABASE_SERVICE_ROLE_KEY and redeploy.`);
        }
        throw new Error(friendly || uploadError.message);
      }
      const { data } = client.storage.from("comic-assets").getPublicUrl(filePath);
      if (!data?.publicUrl) throw new Error("Failed to get public URL");
      return data.publicUrl;
    });

    await step.run("update-panel-status", async () => {
      const client = getSupabase();
      const { error } = await (client.from("issue_panels") as unknown as { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> } }).update({ image_url: publicUrl, status: "completed", error_message: null }).eq("id", panelId);
      if (error) {
        const friendly = friendlySupabaseError(error as { message: string }, "Update issue_panels");
        throw new Error(friendly || error.message);
      }
      return { panelId, publicUrl };
    });

    logger.info("Issue panel completed", { panelId, publicUrl });
    return { panelId, issueId, pageId, imageUrl: publicUrl };
  }
);
