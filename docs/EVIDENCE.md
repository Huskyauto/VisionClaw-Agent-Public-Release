# Evidence — What Actually Works, What's Experimental, What's Tracked

VisionClaw makes large platform claims. This document is the receipts. It's
updated every release pass.

> **Stance.** We'd rather show a real number we want to drive down than ship a
> green-CI lie. The TypeScript section below is a public burn-down, not a
> broken promise.

Last updated: April 26, 2026 (Round 15 — R74.13g tenant-context hardening).

> **How to read this document.** This is the **deep, dated audit trail** — the
> round-by-round receipts (architect review passes, call-site line numbers,
> exploit-class coverage). The numbers in each section are **point-in-time**,
> true as of the round that wrote them; they are kept verbatim as a historical
> record and are **not** re-edited to today's totals.
>
> For the **current** platform scale numbers, see
> [`docs/CURRENT_PLATFORM_TOTALS.md`](CURRENT_PLATFORM_TOTALS.md) (the single
> source of truth). For a fast **claim → evidence → verify-command** index of
> what's true right now, see [`docs/TRUST-RECEIPTS.md`](TRUST-RECEIPTS.md).

---

## CI Hard Gates

Two CI jobs are **hard gates** — a failure in either blocks merge to `main`:

| Gate | What it proves | Status |
|---|---|---|
| `build` | The production bundle compiles end-to-end via `npm run build` (single-port Express + Vite SSR build, prod entry `dist/index.cjs`). | ✅ green |
| `security-tests` | **158 tests across 16 files / 6 categories** (cost, queue, safety, security, storage, tools) covering SSRF + DNS-rebinding (7), admin gate (4), recipe shape + atomic write (10), webhook auth (4), trigger rate-limit (1), tenant isolation (5), conversation IDOR (3), background-queue spool (10), reclaim boundary (4), danger-command rails (43), cost-ledger rate card (19), tool-dispatch contract (7), and tenant-context hardening (41 — see Round 15 below). Run via `bash tests/run.sh`. | ✅ green |

The full test list lives in [`tests/`](../tests/). Every test maps to a real
exploit class we've either fixed or actively defend against — see *Tested
attack surface* below.

## CI Informational → now a Hard Gate (burn-down completed)

| Job | State at Round 15 | State today |
|---|---|---|
| `typecheck` (`tsc --noEmit`) | **336 type errors across 52 files** — informational, did not gate merge. | ✅ **0 errors — promoted to a hard gate.** A type regression now fails CI red. |

The burn-down promised in Round 15 ("target: 0 errors") was delivered: the
TypeScript job is clean and is now one of the CI hard gates (see
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). Verify with
`npm run check`.

---

## Tested Attack Surface

Every test in `tests/` defends a specific exploit class. If you find a
regression here, that's a P0.

### `tests/security/ssrf.test.ts` (7 tests)

Defends the URL fetch path used by `template_scrape` and `readability_extract`
against Server-Side Request Forgery.

- Rejects non-HTTP schemes (`file://`, `ftp://`, `gopher://`, `javascript:`).
- Rejects literal internal hostnames (`localhost`, `metadata.google.internal`,
  `*.internal`, `*.local`).
- Rejects all RFC1918 / loopback / link-local / cloud-metadata IPv4 (10/8,
  127/8, 169.254/16, 172.16-31/12, 192.168/16, 0.0.0.0).
- Rejects IPv6 loopback / ULA / link-local (`::1`, `fc00::/7`, `fe80::/10`).
- Rejects DNS-rebinding: any public hostname whose A/AAAA record resolves to
  a private IP. Verified live against `localtest.me` (resolves to `::1`) —
  this is the exact bypass we shipped a fix for in Round 14.

### `tests/security/admin-gate.test.ts` (4 tests)

Defends every `requireAdmin` route from anonymous escalation.

- Anonymous request with no settings cache → not admin.
- Anonymous request even when no admin PIN is configured → not admin (this is
  the Round 14 regression fix; pre-fix, fresh deployments could pass admin
  gates without any auth).
- Bogus or empty bearer tokens → not admin.

### `tests/security/recipe-validator.test.ts` (8 tests)

Defends the LLM-emitted CSS-selector recipe shape used by `template_scrape`
before it's run against `cheerio`.

- Rejects non-objects, empty rules, selectors > 500 chars.
- Rejects `attr` values not in the safe allowlist (e.g., `onclick`).
- Allows `data-*` attrs (allowlist exception).
- Rejects nesting deeper than `MAX_RECIPE_DEPTH`.
- Rejects more than `MAX_FIELDS_PER_LEVEL` keys per object.
- Happy-path with valid nested rules.

### `tests/storage/tenant-isolation.test.ts` (5 tests)

Defends the platform's central tenant-isolation invariant:
> *"All tenant_id columns are `.notNull()` with no `.default(1)`. Every INSERT
> must explicitly pass tenantId."*

If any insert schema regresses to letting `tenantId` fall through to a default,
every "this row belongs to tenant X" assumption in the platform breaks. These
tests prove the Zod insert schemas refuse:

- `insertConversationSchema` without `tenantId` → rejected.
- `insertMessageSchema` without `tenantId` → rejected.
- `insertMemoryEntrySchema` without `tenantId` → rejected.
- `insertConversationSchema` *with* `tenantId` → accepted.

### `tests/storage/tenant-scope.test.ts` (18 tests, R74.13g)

Defends the central `tenantScope(tenantId)` storage helper. Before R74.13g,
storage.ts had **11 inconsistent `if (tenantId)` truthy checks** that would
silently fall open on `0`, `NaN`, `-1`, `1.5`, `Infinity`, the string `"1"`,
and other non-integer junk — letting cross-tenant queries return "all rows."
The helper is the single place that decides what counts as "valid tenant
context," and these tests lock in every fail-open shape we'd previously seen
or could imagine:

- Rejects `0`, negative integers, `NaN`, `Infinity`, `-Infinity`.
- Rejects non-integers (`1.5`, `1.999`, `Number.EPSILON`).
- Rejects the string `"1"`, `null`, `undefined`, objects, arrays, booleans.
- Accepts only `Number.isInteger(n) && n > 0`.
- Verifies the resulting Drizzle filter is `eq(table.tenantId, n)` (exact match,
  no inadvertent `IN`/`OR` widening).

### `tests/storage/tenant-context.test.ts` (14 tests, R74.13g)

Defends the `assertTenantContext(tenantId, sourceTag)` runtime guard and its
`STRICT_TENANT_CONTEXT` env flag. The guard is what lets us flip the platform
from "permissive — log + return admin tenant" (today's default, for
backward-compatibility while we roll out call-site coverage) to "strict —
throw, refuse to execute" (CI gate, then prod). These tests prove both modes
behave correctly under every fail-open shape:

- Permissive mode: returns `ADMIN_TENANT_ID` and emits a warn-level log
  carrying the `sourceTag` so we can grep ops logs for residual fall-through.
- Strict mode (`STRICT_TENANT_CONTEXT=true`): throws with the source tag in
  the message, refuses to silently coerce.
- Same fail-open shape coverage as `tenant-scope.test.ts` so neither layer
  drifts from the other.
- `ADMIN_TENANT_ID` constant export verified — single source of truth, no
  hardcoded `1`s sprinkled through callers.

### `tests/storage/tenant-context-propagation.test.ts` (9 tests, R74.13g)

End-to-end propagation test. Exercises the actual call graph through
**chat → assertTenantContext → step-ledger withRun → AsyncLocalStorage →
recordExecution** and asserts the asserted tenantId survives every hop with
no implicit fallback to admin tenant. Includes a live-DB persist round-trip
so a regression that *compiles* but breaks the propagation chain still trips
the test:

- Asserted tenant flows through the full chat dispatch path without a
  fallback to admin tenant 1.
- `step-ledger.withRun` wraps the asserted tenant in AsyncLocalStorage and
  every nested `recordExecution` reads it back identically.
- Cross-tenant insert attempts on `executions` are rejected at the DB layer.
- Heartbeat task path: `executeTaskInner` → `processTaskOutput` →
  `processDelegations` all see the same asserted tenant.
- Fail-closed at the entry point if no tenant resolvable (strict mode).

---

## Round-by-Round Verification Scripts

Beyond unit tests, we keep end-to-end verification scripts under [`scripts/`](../scripts/).
These exercise full Stripe → webhook → DB → delivery loops. They aren't in CI
because they hit live providers, but they're run manually before each release
pass and the result is recorded:

| Script | What it verifies | Last result |
|---|---|---|
| `round8-bundle-delivery.ts` | Multi-file bundle delivery via the unified pipeline | ✅ |
| `round9-stripe-auto-delivery.ts` | Stripe webhook → exactly one delivery (replay-safe) | ✅ delivery #71 |
| `round10-product-slate.ts` | Product catalog round-trip | ✅ |
| `round11-kitchen-sink-stress.ts` | All 5 SKUs end-to-end concurrently | ✅ |
| `round12-drive-failure-recovery.ts` | Drive upload failure → recovery + retry | ✅ |
| `round13-storefront-stress.ts` | Anonymous storefront, rate limiting, PII masking | ✅ |
| Round 13.1 graduation test | Recipe graduates from LLM → cheerio after 3 successful runs | ✅ 5/5 |

---

## Round 15 — Tenant Context Hardening (R74.13g, Apr 26, 2026)

**What we set out to prove:** the four "solid all the way down" deliverables
(schema audit, `tenantScope()` helper, `STRICT_TENANT_CONTEXT` flag with
`assertTenantContext()` rollout, end-to-end propagation test) actually hold
under both static (signature-level) and runtime (call-graph) inspection — not
just at the entry point we were proudest of fixing.

### Deliverables and outcomes

| Deliverable | Verifier | Outcome |
|---|---|---|
| **T001** Schema audit covers every table | `rg -c "^export const \w+ = pgTable" shared/schema.ts` → 100; `docs/schema-tenant-audit.md` classifies all 100 | ✅ 100/100 covered (A.1=80 strict · A.2=5 fail-open · A.3=3 nullable · B=4 parent-linked · C=8 global) |
| **T002** `tenantScope()` helper rejects every fail-open shape | `tests/storage/tenant-scope.test.ts` | ✅ 18/18 pass |
| **T003** `assertTenantContext()` flag behavior + rollout | `tests/storage/tenant-context.test.ts` | ✅ 14/14 pass |
| **T004** End-to-end propagation chat → tool → ledger | `tests/storage/tenant-context-propagation.test.ts` (live-DB persist round-trip) | ✅ 9/9 pass |
| **TypeScript** | `npx tsc --noEmit` | ✅ exit 0, clean |
| **Runtime** | App restart — health 6/6, heartbeat running, port 5000 serving, zero startup errors | ✅ green |

### Code locations (so a reviewer can verify everything by `cat`)

If you're auditing this work without trusting the JSON test output, every
file below is checked in and greppable. Open any of them directly.

**New helper modules**

| File | Lines | What lives here |
|---|---|---|
| [`server/storage-helpers/tenant-scope.ts`](../server/storage-helpers/tenant-scope.ts) | 66 | `tenantScope(tenantId)` — strict integer-positive validator + Drizzle filter builder. The single source of truth for "what is a valid tenantId." |
| [`server/storage-helpers/tenant-context.ts`](../server/storage-helpers/tenant-context.ts) | 73 | `assertTenantContext(tenantId, sourceTag)` runtime guard + `STRICT_TENANT_CONTEXT` env flag + `ADMIN_TENANT_ID` constant. Permissive default (warn-log + return admin tenant), strict-on-flag (throw with source tag in message). |

**New test suites** (all use `node:test` + `node:assert/strict`, no vitest)

| File | Lines | Tests | Defends |
|---|---|---|---|
| [`tests/storage/tenant-scope.test.ts`](../tests/storage/tenant-scope.test.ts) | 93 | 18 | Every fail-open shape (`0`/`NaN`/`-1`/`1.5`/`Infinity`/`"1"`/`null`/`undefined`/objects/arrays/booleans) rejected; happy path accepted; resulting Drizzle filter is exact-match `eq()`. |
| [`tests/storage/tenant-context.test.ts`](../tests/storage/tenant-context.test.ts) | 152 | 14 | Permissive mode returns `ADMIN_TENANT_ID` + emits warn log carrying `sourceTag`; strict mode (`STRICT_TENANT_CONTEXT=true`) throws with source tag in message; same fail-open shape coverage as the scope helper so neither layer drifts. |
| [`tests/storage/tenant-context-propagation.test.ts`](../tests/storage/tenant-context-propagation.test.ts) | 210 | 9 | Live-DB end-to-end propagation: chat → `assertTenantContext` → step-ledger `withRun` → AsyncLocalStorage → `recordExecution` preserves the asserted tenantId; cross-tenant insert attempts rejected at the DB layer; heartbeat task chain (`executeTaskInner` → `processTaskOutput` → `processDelegations`) all see the same asserted tenant. |

**Audit document**

| File | Lines | What lives here |
|---|---|---|
| [`docs/schema-tenant-audit.md`](./schema-tenant-audit.md) | 101 | All **100 tables** in `shared/schema.ts` classified. Counts: A.1=80 strict, A.2=5 fail-open (`.default(1)`), A.3=3 nullable/missing, B=4 parent-linked, C=8 global. Every entry names the table + bucket + recommendation. |

**Call-site changes — `server/heartbeat.ts`**

| Line | Change |
|---|---|
| `599` | `assertTenantContext(task.tenantId, "heartbeat:tick:reportTaskFailureInsight:${task.type}")` — tick failure-report path. |
| `679` | `assertTenantContext(task.tenantId, "heartbeat:resolveTaskModel:${task.type}")` — model resolution path. |
| `788` | `assertTenantContext(task.tenantId, "heartbeat:executeTaskInner:${task.type}")` — **primary entry point** for the heartbeat task pipeline. |
| `1588` | `await processTaskOutput(task, output, persona, tenantId)` — threads asserted tenantId into the output processor. |
| `1589` | `await processDelegations(task, output, persona, tenantId)` — threads asserted tenantId into the delegation processor. |
| `1876, 1882` | `storage.getDailyNote(..., tenantId)` + `storage.upsertDailyNote({..., tenantId})` — daily-note path tenant-scoped (F5a fix). |
| `1995` | `storage.updateMemoryEntry(action.id, { status: "archived" }, tenantId)` — memory-archive path tenant-scoped (F5b fix). |

**Call-site changes — `server/chat-engine.ts`**

| Line | Change |
|---|---|
| `1973` | `assertTenantContext(conv.tenantId, "chat-engine:processMessage")` — **primary entry point** for the chat pipeline. |
| `1999` | `storage.createMessage({..., tenantId: tenantIdForScope})` — user-message persist tenant-scoped. |
| `2559` | `storage.createMessage({..., tenantId})` — workflow fast-path assistant write tenant-scoped (F5d fix). |
| `3437` | `storage.createMessage({..., tenantId: tenantIdForScope})` — main assistant-message persist tenant-scoped. |
| `3478` | `updateDailyLog(titleForLog, persona?.id, opts?.source, tenantId)` — call site passes asserted tenantId. |
| `3626, 3629, 3634` | `updateDailyLog` signature accepts `tenantId?`; inner `getDailyNote`/`upsertDailyNote` both tenant-scoped (F5c fix). |

**Storage helper rollout — `server/storage.ts`**

`rg -nc "tenantScope\(" server/storage.ts` → **8** call sites use the new
helper instead of the old `if (tenantId)` truthy check. Search:

```bash
rg -n "tenantScope\(" server/storage.ts
```

**Test runner wiring**

[`tests/run.sh`](../tests/run.sh) — lines 14–18 register all four storage
suites (existing `tenant-isolation` + the three new R74.13g suites) so the CI
`security-tests` hard gate runs them on every push.

### T005 — Architect code review (Furrow), iterative

Every pass found a real defect the previous pass missed. We ran the loop until
a pass returned **PASS** for the four-deliverable scope, no skipping.

| Pass | Verdict | Findings | Resolution |
|---|---|---|---|
| 1 | FAIL | F1: audit doc covered only 62/100 tables. F2: 5 raw `(task as any).tenantId` reads in heartbeat bypassing the asserted entry-point. F3: 17 `conv.tenantId` reads in chat-engine `_processMessageImpl` bypassing the asserted entry-point. | fix1: audit expanded to 100/100 (38 new entries, plus `plans` reclassified A.2 and `agentJobs.tenantId` reclassified A.3); bulk replace of unscoped reads in chat-engine; heartbeat reads converted to use the hoisted asserted tenantId. |
| 2 | FAIL | F2.b: 2 more `(task as any).tenantId` casts inside `processDelegations` that the F2 sed missed because of the cast-variant pattern. F2.c: `tick` failure-report and `resolveTaskModel` also did unscoped reads. | fix2: `processDelegations` signature extended to take `tenantId: number` as 4th param; `tick` and `resolveTaskModel` now use `assertTenantContext()` directly. |
| 3 | FAIL | F4: `processTaskOutput` had 4 hardcoded `tenantId: 1` literal writes (model_scout knowledge, knowledge type, Scribe content_review, memory entry) — direct cross-tenant contamination risk. | fix3: `processTaskOutput` signature extended to require `tenantId: number`; all 4 hardcoded writes use the threaded param. |
| 4 | FAIL | F5a: heartbeat daily-note path (`getDailyNote`/`upsertDailyNote`) omitted tenantId. F5b: heartbeat memory-archive (`updateMemoryEntry`) omitted tenantId. F5c: chat-engine `updateDailyLog` helper + its inner storage calls omitted tenantId. F5d: chat-engine workflow fast-path `createMessage` omitted tenantId (fail-closed at DB today, but propagation break). | fix4: tenantId threaded into all 5 sites; `updateDailyLog` signature extended; storage helpers use existing optional-tenantId params. |
| 5 | **PASS** | None for the four-deliverable scope. | — |

**Architect-found defects across the cycle: 31.** All shipped same session.

### What's intentionally out of scope (next round, documented)

These are real follow-ups, not unknowns. Each is gated by Bob's NO-`db:push`
hard rule — schema-shape changes get manual SQL migrations on a planned window,
not a checkpoint push.

- **A.2 → A.1 promotions.** Drop `.default(1)` on `plans`, `codeProposals`,
  `customers`, `invoices`, `expenses` after auditing every INSERT site
  explicitly passes tenantId.
- **A.3 fixes.** Add `tenantId` column to `deliveryLogs` (with backfill);
  `NOT NULL` on `agentJobs.tenantId` and `oauthSubscriptions.tenantId`.
- **`STRICT_TENANT_CONTEXT=true` CI flip.** Needs `assertTenantContext()`
  rolled out to remaining entry points (routes, webhooks, non-heartbeat cron
  jobs) first, otherwise CI cascades throws.

### Replay locally

```bash
# T002 — helper unit tests
node --import tsx --test tests/storage/tenant-scope.test.ts                  # 18/18

# T003 — flag behavior unit tests
node --import tsx --test tests/storage/tenant-context.test.ts                # 14/14

# T004 — end-to-end propagation (requires DATABASE_URL)
node --import tsx --test tests/storage/tenant-context-propagation.test.ts    # 9/9

# All R74.13g tenant-context tests in one shot
node --import tsx --test tests/storage/tenant-*.test.ts                      # 41/41

# Full security gate (all 158 tests across 16 files)
bash tests/run.sh
```

---

## Production Numbers

These are real, measurable, currently true:

| Metric | Value |
|---|---|
| Live URL | https://agenticcorporation.net |
| Verified deliveries (lifetime) | 71 (last: April 17, 2026) |
| Failed deliveries (silently dropped) | 0 |
| Stripe webhook duplicate-deliveries observed | 0 (tested under replay) |
| Admin-route IDOR exposures known | 0 (last fix: Round 14) |
| SSRF bypasses known | 0 (last fix: Round 14, DNS-rebinding) |
| Sustained uptime since last hardening pass | rolling — see `/healthz` |

---

## Known Limitations (Be Honest)

These are real constraints. Don't deploy past them without addressing.

1. **In-memory mutexes won't survive multi-instance deploy.** `withQueueLock`
   and `withRecipeLock` serialize JSON-file RMW *within one process*. Today
   we run a single replica so it's safe. Before horizontal scale-out, both
   need to migrate to a DB-backed advisory lock.
2. **`delivery_status` tool is admin-only until tenant-scoping lands.** The
   underlying `delivery_logs` table doesn't yet have a `tenant_id` column with
   backfill. Round 14 gated the tool to admin-tenant only as a stopgap.
3. **Per-tool & per-conversation usage caps not enforced in chat loop.** The
   limits exist in `usage-metering.ts` but aren't yet checked at every tool
   call in `routes.ts`. Only message-count limits are enforced today.
4. **`server/routes.ts` is ~12k lines.** Split-up is on the roadmap but
   non-trivial — every test of the live system today still routes through it.
5. **Manual QC required for each new service SKU.** Per Bob's principle:
   auto-ship is OFF by default for every new product. After 10 consecutive
   clean manual ships *and* zero broken deliveries, the owner can graduate
   that SKU to auto-ship. Snap-back-on-broken disables it again.

---

## How to Verify Locally

```bash
# Hard gates (mirror CI):
npm ci
npm run build                        # production bundle
bash tests/run.sh                    # security + tenant-isolation suites

# Informational:
npm run check 2>&1 | grep -c "error TS"   # current TS error count
```
