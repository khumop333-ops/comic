# Security Updates

## CVE-2025-66478 — Next.js 15.3.0

Vercel blocked deployment due to a known security vulnerability in `next@15.3.0`.

**Fix:** Bumped `next` and `eslint-config-next` to `15.5.29` (latest 15.x backport, patched).

- Commit `fab659a` on `main`: `fix: update Next.js to 15.5.29 to patch CVE-2025-66478`
- Verified with `npm install` and `npm run build` (passes — 7 routes)
- Branch `arena/d24b20f0-comic` contains the same fix plus this documentation for PR tracking.

If you need to update again, run:

```bash
npm install next@latest eslint-config-next@latest
npm run build
git push origin main
```
