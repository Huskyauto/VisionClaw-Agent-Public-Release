import crypto from "crypto";
import { logSilentCatch } from "./lib/silent-catch";

// R79.3d — Signed approve/deny tokens for HITL email links.
// Bob requested clickable approve/deny URLs in escalation emails so he doesn't
// have to open the workspace or fish out WhatsApp every time. Token is an
// HMAC-signed JSON payload `{cid, decision, tid, exp}` packed as
// `<base64url-payload>.<base64url-signature>`. We sign with SESSION_SECRET
// (same key safety-layer.ts uses) with CRON_SECRET as fallback. If neither is
// present the process generates a random secret at boot — links will work for
// the lifetime of the process but won't survive a restart, which is the
// correct fail-safe.

const SECRET =
  process.env.HITL_TOKEN_SECRET ||
  process.env.SESSION_SECRET ||
  process.env.CRON_SECRET ||
  crypto.randomBytes(32).toString("hex");

if (!process.env.HITL_TOKEN_SECRET && !process.env.SESSION_SECRET && !process.env.CRON_SECRET) {
  console.warn(
    "[hitl-tokens] No HITL_TOKEN_SECRET/SESSION_SECRET/CRON_SECRET set — using ephemeral random secret. Email approve/deny links will break across process restarts.",
  );
}

export interface HitlTokenPayload {
  cid: string;
  decision: "approve" | "deny";
  tid: number;
  exp: number;
}

export function signHitlToken(p: HitlTokenPayload): string {
  const json = JSON.stringify(p);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function verifyHitlToken(token: unknown): HitlTokenPayload | null {
  if (typeof token !== "string" || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(b64).digest("base64url");
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch (_silentErr) {
    logSilentCatch("server/hitl-tokens.ts", _silentErr);
    return null;
  }
  let payload: HitlTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch (_silentErr) {
    logSilentCatch("server/hitl-tokens.ts", _silentErr);
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.cid !== "string" || !payload.cid) return null;
  if (payload.decision !== "approve" && payload.decision !== "deny") return null;
  if (typeof payload.tid !== "number" || !Number.isFinite(payload.tid)) return null;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
  if (Date.now() > payload.exp) return null;
  return payload;
}

export function resolveBaseUrl(): string {
  const explicit = process.env.HITL_PUBLIC_BASE_URL || process.env.OAUTH_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}`;
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) return `https://${replitDomains.split(",")[0].trim()}`;
  return "http://localhost:5000";
}

export function buildHitlLinks(cid: string, tid: number, ttlMs: number = 24 * 60 * 60 * 1000): { approveUrl: string; denyUrl: string } {
  const exp = Date.now() + ttlMs;
  const base = resolveBaseUrl();
  const approveTok = signHitlToken({ cid, decision: "approve", tid, exp });
  const denyTok = signHitlToken({ cid, decision: "deny", tid, exp });
  return {
    approveUrl: `${base}/api/hitl/approve?token=${encodeURIComponent(approveTok)}`,
    denyUrl: `${base}/api/hitl/deny?token=${encodeURIComponent(denyTok)}`,
  };
}
