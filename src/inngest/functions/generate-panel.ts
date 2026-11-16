import { inngest } from "../client";
import { supabase } from "@/lib/supabase";

export type GeneratePanelEventPayload = {
  panelId: string;
  prompt: string;
  characterReferenceUrl: string;
  comicId: string;
};

type GpuWorkerResponseJson = {
  image?: string; // base64 (with or without data URI prefix)
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
  // If JSON was returned with embedded image, handle separately
  if (jsonCandidate) {
    const b64 =
      jsonCandidate.image ?? jsonCandidate.image_url ?? jsonCandidate.url ?? jsonCandidate.output ?? jsonCandidate.result;
    if (b64 && typeof b64 === "string") {
      // Might be data URI or raw base64 or remote URL
      if (b64.startsWith("http://") || b64.startsWith("https://")) {
        // Remote URL - caller should fetch separately
        return null;
      }
      const base64Data = b64.includes(",") ? b64.split(",")[1] : b64;
      // Heuristic: if string is very short and not base64-like, skip
      if (base64Data.length > 100) {
        try {
          const buffer = Buffer.from(base64Data, "base64");
          return { buffer, contentType: "image/png" };
        } catch {
          // fall through
        }
      }
    }
  }

  // Normalize to Buffer
  const buf: Buffer = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof Uint8Array
      ? Buffer.from(raw)
      : Buffer.from(raw as ArrayBuffer);

  // Raw binary image
  if (contentType?.startsWith("image/")) {
    return { buffer: buf, contentType };
  }

  // Try to detect PNG/JPEG magic bytes
  if (buf.length > 4) {
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    if (isPng) return { buffer: buf, contentType: "image/png" };
    if (isJpeg) return { buffer: buf, contentType: "image/jpeg" };
  }

  // Fallback assume PNG
  if (buf.length > 0) {
    return { buffer: buf, contentType: contentType || "image/png" };
  }

  return null;
}

export const generatePanel = inngest.createFunction(
  {
    id: "generate-panel",
    name: "Generate Comic Panel",
    retries: 2,
    concurrency: {
      limit: 5,
    },
  },
  { event: "comic/panel.generate" },
  async ({ event, step }) => {
    const { panelId, prompt, characterReferenceUrl, comicId } =
      event.data as GeneratePanelEventPayload;

    if (!panelId || !prompt || !comicId) {
      throw new Error(
        `Missing required payload fields: panelId=${panelId}, comicId=${comicId}, prompt=${prompt?.slice(0, 50)}`
      );
    }

    // Step 1: Call GPU worker (Kaggle FastAPI / ngrok) to generate image
    const imageResult = await step.run("call-gpu-worker", async () => {
      const gpuWorkerUrl = process.env.GPU_WORKER_URL;
      if (!gpuWorkerUrl) {
        throw new Error("GPU_WORKER_URL env var is not set");
      }

      const res = await fetch(gpuWorkerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          character_reference_url: characterReferenceUrl,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`GPU worker failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`);
      }

      const contentType = res.headers.get("content-type") || "";

      // Handle JSON vs binary
      if (contentType.includes("application/json")) {
        const json = (await res.json()) as GpuWorkerResponseJson;

        // If JSON contains a remote URL, fetch it
        const remoteUrl = json.image_url || json.url;
        if (remoteUrl && (remoteUrl.startsWith("http://") || remoteUrl.startsWith("https://"))) {
          const imgRes = await fetch(remoteUrl);
          if (!imgRes.ok) throw new Error(`Failed to fetch remote image: ${imgRes.status}`);
          const buf = await imgRes.arrayBuffer();
          return {
            buffer: Buffer.from(buf),
            contentType: imgRes.headers.get("content-type") || "image/png",
          };
        }

        // Otherwise try to extract base64
        // Need raw buffer for fallback detection, but we already consumed body as JSON.
        // Reconstruct from json.
        const extracted = extractImageBuffer(Buffer.from(""), contentType, json);
        if (extracted) return extracted;

        throw new Error(`GPU worker returned JSON without recognizable image field: ${JSON.stringify(json).slice(0, 500)}`);
      } else {
        // Binary image response
        const arrayBuffer = await res.arrayBuffer();
        const extracted = extractImageBuffer(arrayBuffer, contentType, null);
        if (!extracted) throw new Error("GPU worker returned empty image");
        return extracted;
      }
    });

    // Step 2: Upload to Supabase Storage bucket `comic-assets` under /panels/${comicId}/${panelId}.png
    const publicUrl = await step.run("upload-to-supabase-storage", async () => {
      const filePath = `panels/${comicId}/${panelId}.png`;

      // Upload with upsert in case of retries
      const { error: uploadError } = await supabase.storage
        .from("comic-assets")
        // Use Uint8Array view for storage; cast for TS compatibility across Node/Edge
        .upload(filePath, new Uint8Array(imageResult.buffer as unknown as ArrayBuffer) as unknown as File, {
          contentType: imageResult.contentType || "image/png",
          upsert: true,
          cacheControl: "3600",
        });

      if (uploadError) {
        throw new Error(`Supabase storage upload failed: ${uploadError.message}`);
      }

      // Retrieve public URL
      const { data } = supabase.storage.from("comic-assets").getPublicUrl(filePath);

      if (!data?.publicUrl) {
        throw new Error("Failed to get public URL from Supabase storage");
      }

      return data.publicUrl;
    });

    // Step 3: Update comic_panels table where id = panelId
    await step.run("update-panel-status", async () => {
      const { error } = await supabase
        .from("comic_panels")
        .update({
          image_url: publicUrl,
          status: "completed",
        })
        .eq("id", panelId);

      if (error) {
        throw new Error(`Failed to update comic_panels: ${error.message}`);
      }

      return { panelId, publicUrl };
    });

    return {
      panelId,
      comicId,
      imageUrl: publicUrl,
    };
  }
);
