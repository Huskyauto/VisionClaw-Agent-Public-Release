# Post-publication corrective review — 2026-10-19

Status: owner subsequently republished; **five-pilot production verification
passed** on2026-10-19. No additional push or publication was performed during
verification. Earlier development evidence below is preserved as historical
evidence, not relabeled as production testing. This is a disposition of retained
findings, not a new whole-repository security certification.

Published five-pilot results, browser persistence/deletion, access-control checks
and cleanup: [production verification](five-pilot-production-verification.md).

## Scope and preserved limits

Owner-approved work: fix interactive pilot routing, paid-provider failures, all
28 retained severe audit findings, and investigate browser warnings. Owner-only
pilot execution, normal tool-policy enforcement, existing tenant authority,
free-first routing, the existing daily paid ceiling and tool budgets are unchanged.
No schema, dependency, credential, flag, new tool, autonomous worker or permission
change. No active mission or permission to publish.

## Functional corrections

- Felix and Forge keep eligible owner pilot work in the current chat rather
  than delegating to workers that cannot execute owner-only actions. First calls
  are enforced for actual action requests, not passive mentions or opt-outs.
  Natural requests such as “describe the governance pilot” are recognized.
  Explicit action/kind tuples remain pending until each has a successful result;
  failed or uncertain calls stop forcing instead of initiating retries. Ordinary
  tool guards and loop/budget limits remain authoritative.
- CheaperInference stream creation now has a65-second outer bound around its
 60-second SDK deadline. A rejected paid pin cannot silently become the default
  model. Initialization, creation, failover, iterator failure, progress timeout,
  client interruption and empty completion cannot automatically retry/substitute
  that paid dispatch. Partial text and partial tool bytes are included. Failure
  evidence and prior tool results persist; paid interruption has an uncertainty
  marker, not a false “client disconnected” explanation. Reflection is skipped.
- The earlier production four-cent reservation is **unresolved, not a confirmed
  charge**. It was neither released nor replayed. Development smoke results
  cannot settle that earlier production request.
- Imports retain platform-admin full-system restore semantics. Existing tenant
  destinations are checked; legacy records without a tenant retain the owner
  default. Message ownership must match its source conversation. Personas are
  remapped to successfully restored IDs, or explicitly verified existing global
  catalog IDs; failed imported personas never fall back to an unrelated old ID.
  Orphans and children of rejected conversations count as rejected. The settings
  screen shows imported and rejected counts, with an explicit partial-failure
  warning rather than an unconditional success message.
- Six early operational handlers now explicitly validate the session before
  their unchanged platform-admin checks: cache stats, Drive and OneDrive health,
  demo warmup/exit and Felix demo checks. They precede the global API middleware;
  previously even a valid owner Bearer request failed the unpopulated-role check.
  Public setup/status, presenter and Stripe contracts are unchanged. Demo POSTs
  retain the existing CSRF middleware. This is separate from the28 retained rows.

## All28 retained audit dispositions

Historical evidence: `data/tenant-isolation-audit/latest.json`, retained
`severeDispositions` entries with `disposition=kept`; evidence hash
`ef5301581d51ce57b24295896afd82c8449706ea5c13b7009d54716ca39c5f11`.
That run reported807 files,69/69 successful chunks and no source changes during
its run. **Those are historical scan facts, not a rescan of these corrections.**
Locations below identify the original retained rows; lines moved after edits.
The original audit artifact remains intact.

| # | Original location | Disposition and authority reasoning |
|---|---|---|
| 1 | `agentic-engines.ts:816` | False positive: personas are the shared global specialist catalog, not a tenant-owned table. Inventing a tenant predicate would break the schema/contract. |
| 2 | `backup.ts:11` | No established injection: query values come from internal backup-folder constants and Drive-generated parent IDs, not an external request input. Upstream query interpolation is not PostgreSQL execution. Retain this provenance constraint. |
| 3 | `crews-engine.ts:326` | Robustness fixed: the old value was already a bound SQL parameter, not SQL injection. Replaced manual array-literal quoting with a JSON-bound typed PostgreSQL array; quotes and backslashes stay data. |
| 4 | `crews-engine.ts:392` | Robustness fixed: typed text/integer arrays replace manual literals. Integer references require exact positive32-bit integers; absent/empty arrays preserve NULL semantics. |
| 5 | `heartbeat.ts:2116` | False positive: this fork-scan key/value state uses a platform-global table without a tenant column. |
| 6 | `heartbeat.ts:2158` | Same global fork-scan state contract; a nonexistent tenant column must not be invented. |
| 7 | `job-queue.ts:392` | Boundary fixed: `completeJob` uses exact `tenant_id IS NOT DISTINCT FROM` matching. Null ownership no longer means “every tenant.” |
| 8 | `job-queue.ts:439` | False positive: existing `IS NOT DISTINCT FROM` matches only the same nullable owner; NULL does not match every tenant. |
| 9 | `job-queue.ts:481` | Same null-safe exact-owner requeue fence as #8. |
| 10 | `job-queue.ts:572` | Deliberate platform-admin queue listing; ordinary customer-facing callers supply their tenant. This is not authority granted by omitting a tenant in a public request. |
| 11 | `lib/parallel-findings-bus.ts:41` | Trusted execution context supplies the publishing tenant; the internal bus is not an unauthenticated arbitrary-tenant INSERT surface. |
| 12 | `lib/pinned-hypotheses.ts:221` | Boundary fixed: INSERT SELECT atomically requires both the hypothesis and referenced memory/knowledge/message/job to belong to the tenant. Strict positive reference IDs and explicit tenant validation prevent ambiguous references. |
| 13 | `persona-export.ts:39` | False positive: skills are a global catalog, with optional global persona association, not tenant-owned records. |
| 14 | `persona-sync.ts:1219` | Same global skills catalog; global sync totals reflect that schema. |
| 15 | `platform-admin-conversations.ts:21` | Intentional verified platform-admin cross-tenant diagnostic read, not a customer route. |
| 16 | `routes.ts:1984` | Intentional opaque presenter-capability route. Possession of the valid session token is this endpoint's access contract; adding unrelated login/tenant requirements would break sharing. |
| 17 | `routes.ts:2027` | Same opaque presenter capability for TTS. No arbitrary tenant selector is introduced. |
| 18 | `routes.ts:7116` | Admin restore hardening: imported memories retain only validated existing destinations, with the documented legacy owner default and safe persona remapping. |
| 19 | `routes.ts:7126` | Same hardening for imported knowledge. |
| 20 | `routes.ts:7136` | Same hardening for conversations, plus unique source identity, remapped personas, message ownership matching and honest orphan/rejection accounting. |
| 21 | `routes.ts:7154` | Same hardening for heartbeat tasks. Valid multi-tenant admin backups are not collapsed into tenant1. |
| 22 | `seed.ts:3500` | False positive: conversation templates are a global seeded catalog, not tenant-owned rows. |
| 23 | `self-improvement.ts:561` | Explicit `ALL_TENANTS` is deliberate platform-admin experiment-history authority. Ordinary tenant callers remain scoped. |
| 24 | `situation-room.ts:153` | Boundary fixed: the joined messages table is fenced to the same requested tenant as conversations. A valid conversation ID alone is not a message-owner fence. |
| 25 | `storage.ts:961` | Boundary fixed: memory embedding backfill requires an explicit `TenantScope`; per-task heartbeat passes its tenant, verified platform-admin bulk route passes explicit `ALL_TENANTS`. |
| 26 | `storage.ts:972` | Same explicit-scope correction for knowledge embedding backfill. |
| 27 | `storage.ts:1417` | Deliberate authenticated platform-admin full-system export, required for cross-tenant backup/restore. Not an ordinary customer export contract. |
| 28 | `webhook-triggers.ts:318` | False positive: fallback persona selection reads the global persona catalog; created conversations still use the trigger's tenant. |

Totals: five genuine boundary corrections (#7,12,24,25,26); four privileged-restore
hardening rows (#18–21); two array robustness fixes (#3–4); seventeen retained
non-exploitable/intentional-authority dispositions. No finding is “closed” merely
because a caller was renamed or a scanner result was deleted.

## Independent review and verification

The independent review initially returned FAIL. It found real paid partial-stream
mislabeling, orphan-message undercounting and failed-persona fallback, plus
insufficient natural-language/explicit-batch pilot progress handling. These were
corrected, not dismissed. The shared persona catalog remains global by schema;
persona-map validation therefore verifies global IDs rather than inventing a
tenant column.

-70 targeted tests passed, zero failures: routing/opt-out/progress contracts,
  paid pin/deadline/recovery policy, real synthetic progress timeouts after text
  and tool fragments, accurate persisted paid-abort markers, provider/budget
  guards, evidence authority, nullable queue ownership, backfill scope, workload
  join, import destination/persona mapping, bound arrays and the six early
  operational session-hydration contracts. The latter regression was observed
  failing before the six middleware additions and passing afterward.
- Independent touched/sensitive/requirement closure review: PASS after fixing
  its findings. Focused independent review of the later six-route correction:
  PASS, with all existing platform-admin and CSRF gates retained.
- Final full TypeScript and production build passed after the last source edit.
  The development workflow was restarted after that batch and serves requests.
- Canonical development HTTP import restored exactly one valid conversation and
  message while rejecting one invalid persona, one dependent conversation, four
  mismatched/orphan/invalid messages and one invalid destination each for memory
  and knowledge. No customer records were changed.
- Real Forge natural-language describe invoked `business_pilot` successfully.
  A single Felix conversation completed health, release, governance, cost and
  readiness with successful guarded outputs; no delegation or failover occurred.
- One distinct, bounded paid Luna streaming probe returned READY-CHECK with no
  stream errors or failover. It was not a retry of the earlier production turn.
- Local read-only burst:18 requests, concurrency3, p50=12ms, p95=40ms, zero
  failures. These small development observations are not production-scale proof.
- Authenticated browser import showed both rejected records, zero imported rows,
  an Import Results rejection notice and the partial-completion warning.
- After operational-route correction, owner GETs to both health endpoints and
  cache stats returned200; anonymous, forged-session/tenant/admin headers and
  invalid `vc_` key requests returned401. No demo operation was invoked to test
  its authorization. No valid customer or API-key credential was borrowed.
- Development runtime checks are not evidence that production has changed.

Exact synthetic reports and conversations were removed. Both retained fixture
sessions were revoked through the existing server helper, the development
serving cache refreshed, and protected-request401 verified before deleting the
four private fixture files. Earlier unsuccessful harnesses did not retain their
new session tokens; explicit retirement of those is unverified. No real user's
credential was read/rotated or unrelated session revoked.

## Browser warnings and remaining evidence limits

Retained browser output did not identify the URL behind the generic `ERR_FAILED`
bootstrap warning. `/api/auth/user`401 can be normal alternate-auth discovery
when this installation uses PIN/token login; that status alone does not prove
the authenticated application is broken. Auth remains fail-closed.

Bootstrap failure logs now identify the static endpoint (`/api/auth/user`,
`/api/auth/status` or `/api/settings`) without printing credentials or request
values. No auth bypass, origin relaxation or credential change was made to hide
a browser warning. Do not claim an unidentified transient network failure fixed.

The focused development browser pass identified two actual403s on Drive and
OneDrive health before import, reproduced even with the canonical owner token.
Explicit session validation fixed their root cause; owner HTTP now200 while
unauthorized callers remain rejected. The browser import itself succeeded with
honest rejection reporting. Its passive capture observed no ERR_FAILED event,
so the earlier generic transient failure remains unidentified, not “fixed.”

The repository-wide file-size gate independently reports sixteen oversized
legacy modules. This is pre-existing structural debt, not a new security finding
or a passing gate. This corrective batch does not raise ceilings or disable the
gate; the main router shrank via import extraction, and the settings import hook
was extracted rather than adding more inline UI behavior. A broad unrelated
module-splitting campaign is not represented as completed here.
