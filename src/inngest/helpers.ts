import { fetchWithTimeout, validateGpuUrl } from "@/lib/gpu";

export type GpuWorkerResponseJson = {
  image?: string;
  image_url?: string;
  url?: string;
  output?: string;
  result?: string;
};

export function extractImageBuffer(
  raw: ArrayBuffer | Buffer | Uint8Array,
  contentType: string | null,
  jsonCandidate?: GpuWorkerResponseJson | null
): { buffer: Buffer; contentType: string } | null {
  if (jsonCandidate) {
    const b64 = jsonCandidate.image ?? jsonCandidate.image_url ?? jsonCandidate.url ?? jsonCandidate.output ?? jsonCandidate.result;
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
  const buf: Buffer = Buffer.isBuffer(raw) ? raw : raw instanceof Uint8Array ? Buffer.from(raw) : Buffer.from(raw as ArrayBuffer);
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

export async function callGpuWorker(payload: Record<string, unknown>): Promise<{ base64: string; contentType: string }> {
  const gpuWorkerUrl = validateGpuUrl(process.env.GPU_WORKER_URL);
  const res = await fetchWithTimeout(
    gpuWorkerUrl,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    90_000
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GPU worker failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = (await res.json()) as GpuWorkerResponseJson;
    const remoteUrl = json.image_url || json.url;
    if (remoteUrl && (remoteUrl.startsWith("http://") || remoteUrl.startsWith("https://"))) {
      const imgRes = await fetchWithTimeout(remoteUrl, {}, 30_000);
      if (!imgRes.ok) throw new Error(`Failed to fetch remote image: ${imgRes.status}`);
      const buf = await imgRes.arrayBuffer();
      const ext = extractImageBuffer(buf, imgRes.headers.get("content-type") || "image/png", null);
      if (!ext) throw new Error("Failed to extract remote image");
      return { base64: ext.buffer.toString("base64"), contentType: ext.contentType };
    }
    const extracted = extractImageBuffer(Buffer.from(""), contentType, json);
    if (extracted) return { base64: extracted.buffer.toString("base64"), contentType: extracted.contentType };
    throw new Error(`GPU worker JSON without image field: ${JSON.stringify(json).slice(0, 500)}`);
  } else {
    const ab = await res.arrayBuffer();
    const extracted = extractImageBuffer(ab, contentType, null);
    if (!extracted) throw new Error("GPU worker returned empty image");
    return { base64: extracted.buffer.toString("base64"), contentType: extracted.contentType };
  }
}
