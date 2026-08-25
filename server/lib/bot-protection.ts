import type { Request, Response } from "express";

// Bot-protection gate for public, UNAUTHENTICATED endpoints (lead capture,
// instant audit, archive-rescue demo/checkout). Two layers:
//
//   1. Honeypot  — a decoy `company_website` field the real client renders
//      visually hidden. Humans never see/fill it; naive form-filling bots do.
//      Any non-empty value => silent fake-success (we do NOT tip the bot off).
//      Zero cost; completely inert for legitimate submissions that omit it.
//
//   2. Cloudflare Turnstile (opt-in via requireTurnstile) — verifies a
//      proof-of-human token against Cloudflare's siteverify endpoint. This is
//      the real defense against direct-to-API bots that never render the form.
//
// FAIL-OPEN by design: when TURNSTILE_SECRET_KEY is unset (keys not configured
// yet) OR Cloudflare is unreachable (outage/timeout), Turnstile verification is
// skipped so the public forms keep working. The always-on per-IP rate limiter
// on every one of these endpoints is the backstop. Activation is a pure config
// change: set TURNSTILE_SECRET_KEY (server) + VITE_TURNSTILE_SITE_KEY (client)
// and protection goes live with no code change.

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileConfigured(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY;
}

/**
 * One-time boot warning when exactly ONE of the two Turnstile keys is set.
 * A half-configured pair is a footgun: server-side verify is live but the
 * client never renders the widget (or vice-versa), so every real submit would
 * arrive token-less. We still fail open (nothing breaks), but the operator
 * almost certainly meant to set both. Returns the message it logged (or null).
 */
export function warnIfPartialBotConfig(): string | null {
  const hasSecret = !!process.env.TURNSTILE_SECRET_KEY;
  const hasSite = !!process.env.VITE_TURNSTILE_SITE_KEY;
  if (hasSecret === hasSite) return null; // both set or both unset = fine
  const missing = hasSecret ? "VITE_TURNSTILE_SITE_KEY" : "TURNSTILE_SECRET_KEY";
  const msg = `[bot-protection] PARTIAL Turnstile config — ${missing} is missing. Bot protection stays FAIL-OPEN (forms keep working) until BOTH keys are set.`;
  console.warn(msg);
  return msg;
}

export function isHoneypotTripped(body: any): boolean {
  const v = body?.company_website;
  return typeof v === "string" && v.trim().length > 0;
}

async function verifyTurnstileToken(
  token: string | undefined,
  ip?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, reason: "disabled" }; // fail-open: not configured
  if (!token || typeof token !== "string") return { ok: false, reason: "missing-token" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);
    const resp = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: controller.signal,
    });
    const data: any = await resp.json().catch(() => ({}));
    if (data?.success === true) return { ok: true };
    const codes = Array.isArray(data?.["error-codes"])
      ? data["error-codes"].join(",")
      : "verify-failed";
    return { ok: false, reason: codes };
  } catch (e: any) {
    // Network error / timeout → fail OPEN so a Cloudflare outage can't take
    // down the public forms. Rate-limiting + honeypot remain in force.
    console.warn(`[bot-protection] turnstile verify error (fail-open): ${e?.message}`);
    return { ok: true, reason: "verify-error-failopen" };
  } finally {
    clearTimeout(timer);
  }
}

export interface BotProtectionOpts {
  /** Require a valid Cloudflare Turnstile token (still fails open if unconfigured). */
  requireTurnstile?: boolean;
}

/**
 * Enforce bot protection on a public request. Returns true when the request
 * should proceed; when it returns false the response has ALREADY been sent and
 * the caller must `return` immediately.
 *
 * Call this AFTER the per-IP rate-limit check (so flooders are throttled before
 * we spend an outbound Turnstile verify) and AFTER any body parser (multer/json)
 * has populated `req.body`.
 */
export async function enforceBotProtection(
  req: Request,
  res: Response,
  opts: BotProtectionOpts = {},
): Promise<boolean> {
  if (isHoneypotTripped(req.body)) {
    // Silent fake-success — never reveal that the honeypot caught it.
    res.status(200).json({ ok: true });
    return false;
  }
  if (opts.requireTurnstile) {
    const token =
      (req.body?.turnstileToken as string | undefined) ??
      (req.body?.captchaToken as string | undefined) ??
      (req.headers["cf-turnstile-response"] as string | undefined);
    const v = await verifyTurnstileToken(token, req.ip);
    if (!v.ok) {
      res.status(403).json({ error: "Human verification failed. Please retry." });
      return false;
    }
  }
  return true;
}
