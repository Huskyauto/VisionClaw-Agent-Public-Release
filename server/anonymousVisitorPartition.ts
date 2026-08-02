import type { Request } from "express";
import "express-session"; // pulls in the Request.sessionID type augmentation
import crypto from "crypto";

// Persisting this marker is how we force express-session (mounted with
// `saveUninitialized: false`) to issue a Set-Cookie on the first anonymous
// checkout, so subsequent retries reuse the same `sessionID`.
declare module "express-session" {
  interface SessionData {
    lastAnonCheckoutAt?: number;
  }
}

// Accept either `clientIdempotencyToken` or the standard `Idempotency-Key`
// header. Format is restricted so it can't be used to spray Stripe's
// idempotency space or to grief other visitors.
const CLIENT_TOKEN_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function readClientIdempotencyToken(req: Request): string | null {
  const fromBody = typeof req.body?.clientIdempotencyToken === "string"
    ? req.body.clientIdempotencyToken
    : null;
  const headerVal = req.get("idempotency-key");
  const fromHeader = typeof headerVal === "string" ? headerVal : null;
  const candidate = fromBody ?? fromHeader;
  if (candidate && CLIENT_TOKEN_RE.test(candidate)) return candidate;
  return null;
}

// Per-visitor partition for anonymous Stripe checkouts. Replaces weak
// per-visitor identities like `ip` or `tenant 0` that let two strangers
// behind the same NAT/CDN edge collide on a single Stripe idempotency key.
//
// Identity is sourced in priority order so dedup works even before the
// session cookie has round-tripped:
//   1. A client-supplied token (body `clientIdempotencyToken` or the
//      `Idempotency-Key` header). The frontend generates this once per
//      mounted checkout button, so two near-simultaneous POSTs from a
//      cookieless first-click send the same token and Stripe dedups.
//   2. `req.sessionID` once the session cookie has been issued — stable
//      per visitor and unique across visitors (even behind the same NAT),
//      so cross-visitor collisions are impossible. We touch the session
//      so the cookie is set on the first checkout and reused on retries.
//   3. A fresh UUID as a defensive fallback if neither is available.
export function anonymousVisitorPartition(req: Request): string {
  const clientToken = readClientIdempotencyToken(req);
  if (clientToken) return `anon_tok_${clientToken}`;
  if (req.sessionID && req.session) {
    req.session.lastAnonCheckoutAt = Date.now();
    return `anon_sess_${req.sessionID}`;
  }
  return `anon_uuid_${crypto.randomUUID()}`;
}
