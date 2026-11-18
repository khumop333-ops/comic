export function friendlyGpuError(err: unknown, context: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("GPU_WORKER_URL")) return `${context}: GPU_WORKER_URL not set. Set in Vercel env (e.g. RunPod / ngrok) and redeploy.`;
  if (msg.includes("timeout") || msg.includes("AbortError")) return `${context}: GPU worker timed out (90s). Worker may be cold or overloaded. Retry.`;
  if (msg.includes("429")) return `${context}: GPU worker rate-limited. Wait 30s and retry.`;
  return `${context}: ${msg}`;
}

export async function fetchWithTimeout(url: string, init: RequestInit, ms = 90_000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export function validateGpuUrl(url: string | undefined): string {
  if (!url) throw new Error("GPU_WORKER_URL env var is not set");
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) throw new Error("GPU_WORKER_URL must be http/https");
    return url;
  } catch {
    throw new Error(`GPU_WORKER_URL is not a valid URL: ${url}`);
  }
}
