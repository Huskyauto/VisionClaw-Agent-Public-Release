# Security Model

VisionClaw is a multi-tenant platform with paid customer deliverables, an
admin-gated owner console, and an LLM that can call ~216 tools on behalf of
agents. This document is the threat model: who we defend against, how, and
what residual risk remains.

## Trust Boundaries

```
┌───────────────────────────────────────────────────────────────────────┐
│  Anonymous internet                                                   │
│  ───────────────────                                                  │
│  Can hit:  /landing, /store, /orders/:sessionId, /api/health,         │
│            Stripe + Coinbase webhooks (signature-verified)            │
│  Cannot:   anything else                                              │
└───────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Authenticated tenant (Replit-Auth user OR session bearer)            │
│  ─────────────────────────────────────────────────                    │
│  Reads/writes: ONLY rows where tenant_id = caller's tenant            │
│  Calls tools:  scoped per API-key (`chat`/`read`/`tools`/`admin`)     │
└───────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌───────────────────────────────────────────────────────────────────────┐
│  Admin tenant (ADMIN_TENANT_ID = 1, owner only)                       │
│  ─────────────────────────────────────────                            │
│  Mutates: persona/skill/policy config, service review queue,          │
│           cross-tenant logs (delivery_status), platform settings      │
└───────────────────────────────────────────────────────────────────────┘
```

## Authentication & Session

- **Replit-Auth (OAuth)** — primary user identity for the web UI. JWT verified
  per-request; tenant is resolved from `tenantCacheByReplitUser`.
- **Session bearer tokens** — short-lived, server-side stored, used by SPA.
- **Per-tenant API keys** — scope-stamped (`chat`, `read`, `tools`, `admin`)
  with a route-pattern allowlist enforced by `authMiddleware`.
- **Admin gate** — `isAdminRequest(req)` requires either an admin-flagged
  session OR a Replit-Auth user resolving to the admin tenant. **Never**
  defaults to admin for anonymous callers (Round 14 fix; tested in
  `tests/security/admin-gate.test.ts`).

## Tenant Isolation

The central invariant:

> Every table that holds tenant-owned data has a `tenant_id` column declared
> `.notNull()` with **no `.default(1)`**. Every INSERT must explicitly pass a
> tenantId. There is no fallback.

Enforced at three layers:
1. **Schema** — Drizzle column definitions (`shared/schema.ts`).
2. **Insert validators** — `createInsertSchema` from `drizzle-zod` reflects
   the not-null constraint into Zod, so route-handler input validation rejects
   missing tenantId before the row is built. Tested:
   `tests/storage/tenant-isolation.test.ts`.
3. **Storage interface** — `IStorage` methods accept tenantId as a required
   or first-class optional parameter and use it in WHERE clauses.

If any of those three regress, the others catch it.

## SSRF Defense

`template_scrape` and `readability_extract` fetch arbitrary URLs supplied by
agents. The defense is layered:

1. **Scheme allowlist** — only `http:` and `https:`.
2. **Hostname denylist** — `localhost`, `metadata.google.internal`, `*.internal`,
   `*.local` rejected by string match.
3. **Literal IP denylist** — IPv4 (10/8, 127/8, 169.254/16, 172.16-31/12,
   192.168/16, 0.0.0.0, multicast) and IPv6 (`::1`, `fc00::/7`, `fe80::/10`,
   `ff00::/8`, IPv4-mapped private) rejected.
4. **DNS-rebinding defense** — `isSafeDns()` resolves all A/AAAA records via
   `dns.lookup({all:true,verbatim:true})` and rejects if any resolves into a
   private range. Re-checked after redirects. Verified live: `localtest.me`
   (which resolves to `127.0.0.1`) is now blocked.
5. **Response cap** — streaming response aborts at 5 MB to bound bandwidth
   and memory.

Tested: `tests/security/ssrf.test.ts`.

## Stripe Webhook Hardening

- **Signature verification** — `stripe.webhooks.constructEvent()` with raw
  body parsing. Forged POSTs return 400. Verified live.
- **Replay safety** — Stripe-session-id dedupe at top of the service-product
  branch returns immediately on at-least-once webhook replays. Cross-process
  safety via DB lookup (`getDeliveryByStripePayment(paymentKey)`).
- **In-process race fix** — `pendingDeliveries.add()` happens *before* the
  async DB lookup, with try/finally release. Round 14 closed the
  claim-after-await race that could double-deliver under concurrent retries.
- **Recovery net** — the entire service-product branch is wrapped; any
  uncaught exception still best-effort writes a `failed` review item plus
  alerts the owner. If recovery itself fails, we return 5xx so Stripe retries.

## Recipe Validator (LLM-Output Gate)

The `template_scrape` tool asks an LLM to emit a CSS-selector recipe matching
a caller-supplied schema. Before that recipe is fed to `cheerio`, it passes
`validateRules()`:

- Must be a non-empty object.
- Each field's `selector` must be a string ≤ 500 chars.
- `attr` must be in a safe allowlist (`text`, `html`, `href`, `src`, `title`,
  `alt`, `value`, `id`, `class`, `name`) or start with `data-`.
- Nested `fields` re-validated; max depth 4, max 40 keys per level.

If validation fails, the recipe is discarded and the call falls back to a
repair-prompt retry. Tested: `tests/security/recipe-validator.test.ts`.

## Service Review Queue

Customer-facing service deliverables (e.g., the $49 Custom AI Research Report)
go through a human-review-then-graduate pipeline:

- Default **auto-ship OFF** for every new SKU.
- After N consecutive clean manual ships (default 10) *and* zero broken
  deliveries, owner can enable auto-ship per SKU.
- **Snap-back-on-broken** — any failed link verification flips auto-ship OFF,
  stamps `policyResetAt`, requires a fresh streak.
- **Sandboxed file streaming** — admin file-stream endpoint uses strict
  `path.sep` directory-boundary check (not string-prefix) to prevent
  traversal out of `uploads/`.

## Secret Management

- **Never** commit secrets. The push script `/tmp/push-gh.sh` scans 10+ secret
  patterns across all tracked files and refuses to push if any matches.
- Customer payment data: only the masked email and Stripe session ID are ever
  logged.
- Customer-facing order page (`/orders/:sessionId`) acts as a capability URL
  (the session ID is unguessable) and returns only a masked email
  (`b***@gmail.com`), never raw PII.

## Webhook & Provider Hardening

- **Coinbase Commerce** — webhook hard-rejects unsigned requests.
- **Stripe** — see *Stripe Webhook Hardening* above.
- **Tool dispatch** — both SSE chat paths strip underscore-prefixed args from
  model output before forcing `_tenantId` and `_invokedByModel=true`.
  The `exec` tool refuses model invocation entirely.

## Residual Risk

Documented openly in [`EVIDENCE.md`](./EVIDENCE.md) under "Known Limitations".
The headline items:

1. In-memory mutexes won't survive multi-instance horizontal scale-out
   (single replica today; DB-backed advisory locks needed before scale).
2. Per-tool & per-conversation usage caps not yet enforced in the chat tool
   loop (only per-message caps are).

## Reporting a Vulnerability

Email Bob Washburn at `huskyauto@gmail.com`. Please include reproduction steps
and don't disclose publicly until we've shipped a fix.
