import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET || "";
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

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
  const exp = Date.now() + ttlMs;
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
