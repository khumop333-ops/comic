import { inngest } from "../client";
import { supabase, getSupabase, friendlySupabaseError } from "@/lib/supabase";
import { callGpuWorker } from "@/inngest/helpers";

export type GeneratePanelEventPayload = {
  panelId: string;
  prompt: string;
  characterReferenceUrl: string;
  comicId: string;
};

export const generatePanel = inngest.createFunction(
  {
    id: "generate-panel",
    name: "Generate Comic Panel",
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: "comic/panel.generate" },
  async ({ event, step, logger }) => {
    const { panelId, prompt, characterReferenceUrl, comicId } = event.data as GeneratePanelEventPayload;
    if (!panelId || !prompt || !comicId) throw new Error(`Missing payload: panelId=${panelId}, comicId=${comicId}`);

    try {
      getSupabase();
    } catch (configErr) {
      await (supabase.from("comic_panels") as unknown as { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } }).update({ status: "failed", error_message: String(configErr).slice(0, 500) }).eq("id", panelId);
      throw new Error(String(configErr));
    }

    logger.info("Generating panel", { panelId, comicId, prompt: prompt.slice(0, 80) });

    const imageResult = await step.run("call-gpu-worker", async () => {
      return callGpuWorker({ prompt, character_reference_url: characterReferenceUrl, character_reference_urls: [characterReferenceUrl] });
    });

    const publicUrl = await step.run("upload-to-supabase-storage", async () => {
      const filePath = `panels/${comicId}/${panelId}.png`;
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
          await (client.from("comic_panels") as unknown as { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } }).update({ status: "failed", error_message: friendly.slice(0, 500) }).eq("id", panelId);
          throw new Error(`${friendly} — Check SUPABASE_SERVICE_ROLE_KEY (legacy JWT) and redeploy.`);
        }
        throw new Error(friendly || uploadError.message);
      }
      const { data } = client.storage.from("comic-assets").getPublicUrl(filePath);
      if (!data?.publicUrl) throw new Error("Failed to get public URL");
      return data.publicUrl;
    });

    await step.run("update-panel-status", async () => {
      const client = getSupabase();
      const { error } = await (client.from("comic_panels") as unknown as { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> } }).update({ image_url: publicUrl, status: "completed", error_message: null }).eq("id", panelId);
      if (error) {
        const friendly = friendlySupabaseError(error as { message: string }, "Update comic_panels");
        throw new Error(friendly || error.message);
      }
      return { panelId, publicUrl };
    });

    logger.info("Panel completed", { panelId, publicUrl });
    return { panelId, comicId, imageUrl: publicUrl };
  }
);
