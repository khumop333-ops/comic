import { Inngest } from "inngest";

// Inngest client — reads eventKey/signingKey from env when available.
// Vercel + Inngest integration auto-injects INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY
// (via integration config icfg_...). If they are missing we still construct the
// client so imports/builds don't throw; API routes will catch the missing-key
// error at send-time and return an actionable message instead of crashing.
const eventKey = process.env.INNGEST_EVENT_KEY || undefined;
const signingKey = process.env.INNGEST_SIGNING_KEY || undefined;

if (!eventKey && process.env.NODE_ENV === "production") {
  // Don't throw at import time — let `inngest.send()` throw with its own
  // helpful message, which our API route catches and surfaces with setup steps.
  // Build-time logs only.
  console.warn(
    "[inngest] INNGEST_EVENT_KEY is not set — events cannot be sent to Inngest Cloud. " +
      "Add it in Vercel → Project Settings → Environment Variables (or via `npx inngest-cli dev` locally). " +
      "Get keys at https://app.inngest.com → Settings → API Keys."
  );
}

export const inngest = new Inngest({
  id: "comic-studio",
  name: "Comic Studio",
  eventKey,
  signingKey,
});
