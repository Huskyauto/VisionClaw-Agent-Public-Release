import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET || "";
const DEFAULT_TTL_MS = 30 * 60 * 1000;
// Hard upper bound on any signed-URL lifetime. Caller-supplied ttlMs is clamped
// to this so a bug or hostile caller can't mint a near-immortal token; bounds
// the blast radius if a signed URL ever leaks.
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function boundTtl(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return DEFAULT_TTL_MS;
  return Math.min(ttlMs, MAX_TTL_MS);
}

// R74.13d M2: fail-closed in production. Without SESSION_SECRET, the previous
// behaviour was to emit unsigned `/uploads/<file>` URLs that bypass tenant
// isolation entirely. In a real deployment SESSION_SECRET is always set, so
// the only way this branch could fire in prod is misconfiguration — and in
// that case silently disabling signing is worse than crashing loudly.
if (!SECRET) {
  if (IS_PRODUCTION) {
    throw new Error("[upload-signing] SESSION_SECRET is required in production for signed upload URLs.");
  }
  console.warn("[upload-signing] SESSION_SECRET not set — uploads will be unsigned (DEV ONLY).");
}

function signingKey(): string {
  if (!SECRET) {
    throw new Error("SESSION_SECRET is required to sign upload URLs");
  }
  return SECRET;
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", signingKey()).update(payload).digest("hex");
}

export function signUploadUrl(
  filename: string,
  tenantId: number,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  if (!SECRET) {
    // Dev-only branch — production is blocked at module load above.
    return `/uploads/${encodeURIComponent(filename)}`;
  }
  const exp = Date.now() + boundTtl(ttlMs);
  const payload = `${filename}|${tenantId}|${exp}`;
  const sig = hmac(payload);
  return `/uploads/${encodeURIComponent(filename)}?tid=${tenantId}&exp=${exp}&sig=${sig}`;
}

export function verifyUploadSig(
  filename: string,
  tenantId: number,
  exp: number,
  sig: string,
): boolean {
  if (!SECRET) return false;
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (!/^[a-f0-9]{64}$/.test(sig)) return false;
  const expected = hmac(`${filename}|${tenantId}|${exp}`);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Signed self-hosted video-job MP4 stream/download URL. A plain `<a download>`
// or `<video src>` can't carry the Bearer auth header the SPA uses, so the
// download route is auth-gate-exempt and verifies this HMAC (jobId + tenant +
// mode + expiry) itself. `mode` is "inline" (Watch — plays in the browser) or
// "dl" (Download MP4 — attachment disposition). Mirrors signUploadUrl.
export function signVideoDownloadUrl(
  jobId: string,
  tenantId: number,
  inline: boolean,
  ttlMs: number = DEFAULT_TTL_MS,
): string {
  if (!SECRET) {
    throw new Error("SESSION_SECRET is required to sign video download URLs");
  }
  const mode = inline ? "inline" : "dl";
  const exp = Date.now() + boundTtl(ttlMs);
  const sig = hmac(`vj-dl|${jobId}|${tenantId}|${mode}|${exp}`);
  return `/api/video-jobs/${encodeURIComponent(jobId)}/download?tid=${tenantId}&mode=${mode}&exp=${exp}&sig=${sig}`;
}

export function verifyVideoDownloadSig(
  jobId: string,
  tenantId: number,
  mode: string,
  exp: number,
  sig: string,
): boolean {
  if (!SECRET) return false;
  if (mode !== "inline" && mode !== "dl") return false;
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (!/^[a-f0-9]{64}$/.test(sig)) return false;
  const expected = hmac(`vj-dl|${jobId}|${tenantId}|${mode}|${exp}`);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}
