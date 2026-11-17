import { inngest } from "../client";
import { supabase, getSupabase, friendlySupabaseError } from "@/lib/supabase";

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

type GpuWorkerResponseJson = {
  image?: string;
  image_url?: string;
  url?: string;
  output?: string;
  result?: string;
};

function extractImageBuffer(
  raw: ArrayBuffer | Buffer | Uint8Array,
  contentType: string | null,
  jsonCandidate?: GpuWorkerResponseJson | null
): { buffer: Buffer; contentType: string } | null {
  if (jsonCandidate) {
    const b64 =
      jsonCandidate.image ?? jsonCandidate.image_url ?? jsonCandidate.url ?? jsonCandidate.output ?? jsonCandidate.result;
    if (b64 && typeof b64 === "string") {
      if (b64.startsWith("http://") || b64.startsWith("https://")) return null;
      const base64Data = b64.includes(",") ? b64.split(",")[1] : b64;
      if (base64Data.length > 100) {
        try {
          const buffer = Buffer.from(base64Data, "base64");
          return { buffer, contentType: "image/png" };
        } catch {}
      }
    }
  }

  const buf: Buffer = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof Uint8Array
      ? Buffer.from(raw)
      : Buffer.from(raw as ArrayBuffer);

  if (contentType?.startsWith("image/")) return { buffer: buf, contentType };

  if (buf.length > 4) {
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    if (isPng) return { buffer: buf, contentType: "image/png" };
    if (isJpeg) return { buffer: buf, contentType: "image/jpeg" };
  }

  if (buf.length > 0) return { buffer: buf, contentType: contentType || "image/png" };
  return null;
}

export const generateIssuePanel = inngest.createFunction(
  {
    id: "generate-issue-panel",
    name: "Generate Issue Panel (multi-character + environment)",
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: "issue/panel.generate" },
  async ({ event, step }) => {
    const {
      panelId,
      prompt,
      originalPrompt,
      characterReferenceUrls,
      environmentReferenceUrl,
      issueId,
      pageId,
    } = event.data as GenerateIssuePanelEventPayload;

    if (!panelId || !prompt || !issueId || !pageId) {
      throw new Error(`Missing payload: panelId=${panelId}, issueId=${issueId}, pageId=${pageId}`);
    }

    try {
      getSupabase();
    } catch (configErr) {
      await (supabase.from("issue_panels") as unknown as { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } }).update({ status: "failed" }).eq("id", panelId);
      throw new Error(String(configErr));
    }

    const imageResult = await step.run("call-gpu-worker", async () => {
      const gpuWorkerUrl = process.env.GPU_WORKER_URL;
      if (!gpuWorkerUrl) throw new Error("GPU_WORKER_URL env var is not set");

      // Multi-character + environment: send all reference URLs
      const payload: Record<string, unknown> = {
        prompt,
        original_prompt: originalPrompt,
        character_reference_urls: characterReferenceUrls,
        character_reference_url: characterReferenceUrls[0] ?? null, // backward compat
      };
      if (environmentReferenceUrl) {
        payload.environment_reference_url = environmentReferenceUrl;
        payload.environment_reference_urls = [environmentReferenceUrl];
      }

      const res = await fetch(gpuWorkerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`GPU worker failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`);
      }

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const json = (await res.json()) as GpuWorkerResponseJson;
        const remoteUrl = json.image_url || json.url;
        if (remoteUrl && (remoteUrl.startsWith("http://") || remoteUrl.startsWith("https://"))) {
          const imgRes = await fetch(remoteUrl);
          if (!imgRes.ok) throw new Error(`Failed to fetch remote image: ${imgRes.status}`);
          const buf = await imgRes.arrayBuffer();
          const ext = extractImageBuffer(buf, imgRes.headers.get("content-type") || "image/png", null);
          if (!ext) throw new Error("Failed to extract remote image");
          return { base64: ext.buffer.toString("base64"), contentType: ext.contentType };
        }
        const extracted = extractImageBuffer(Buffer.from(""), contentType, json);
        if (extracted) return { base64: extracted.buffer.toString("base64"), contentType: extracted.contentType };
        throw new Error(`GPU worker returned JSON without recognizable image field: ${JSON.stringify(json).slice(0, 500)}`);
      } else {
        const arrayBuffer = await res.arrayBuffer();
        const extracted = extractImageBuffer(arrayBuffer, contentType, null);
        if (!extracted) throw new Error("GPU worker returned empty image");
        return { base64: extracted.buffer.toString("base64"), contentType: extracted.contentType };
      }
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
          await (client.from("issue_panels") as unknown as { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<unknown> } }).update({ status: "failed" }).eq("id", panelId);
          throw new Error(`${friendly} — Check Vercel env SUPABASE_SERVICE_ROLE_KEY (legacy JWT) and redeploy.`);
        }
        throw new Error(friendly || uploadError.message);
      }

      const { data } = client.storage.from("comic-assets").getPublicUrl(filePath);
      if (!data?.publicUrl) throw new Error("Failed to get public URL from Supabase storage");
      return data.publicUrl;
    });

    await step.run("update-panel-status", async () => {
      const client = getSupabase();
      const { error } = await (client.from("issue_panels") as unknown as { update: (v: unknown) => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> } }).update({ image_url: publicUrl, status: "completed" }).eq("id", panelId);
      if (error) {
        const friendly = friendlySupabaseError(error as { message: string }, "Update issue_panels");
        throw new Error(friendly || error.message);
      }
      return { panelId, publicUrl };
    });

    return { panelId, issueId, pageId, imageUrl: publicUrl };
  }
);
