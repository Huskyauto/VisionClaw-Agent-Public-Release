# Republication blockers: retained-finding review

Scope: the 33 kept severe identities in the completed October 9 tenant audit,
plus production verifier memory admission. This is a remediation/evidence
record, **not** a replacement audit, release clearance, or permission to publish.
Report line numbers below identify that retained report; edited lines may move.

## Remediated boundaries

| Retained identity | Change |
| --- | --- |
| google-drive.ts:1348,1379 | Require tenant scope and authorize its remote file using the existing bounded ownership walker before fetching download metadata, bytes, or writing cache files. Every downloader caller now passes its originating tool/input/connection tenant; no unscoped fallback. |
| google-drive.ts:1412 | Require explicit trusted tenant for deletion, authorize before DELETE, and forward the dispatcher context. |
| google-drive.ts:1816 | Bind both project ID and tenant in the initial project SELECT. |
| heartbeat.ts:2643 | Tenant-specific delegation cap and duplicate checks, not ALL_TENANTS. |
| parallel-findings-bus.ts:40,125 | Reject non-positive/non-safe-integer scope before INSERT; the only application ingress passes server-owned ToolContext, not request parameters. |
| memory-graph.ts:668 | Count a link only when both endpoints belong to the requested tenant. |
| project-brain.ts:125 | Require caller tenant; authorize project and conversation together before filesystem side effects. HTTP ingress and the trusted backfill propagate their originating tenant. |
| routes/api-v1.ts:1328,1518 | Add direct message-tenant predicates independently of the owned conversation. |
| storage.ts:1140 | Require task tenant on the UPDATE and in IStorage, propagated from each selected task by heartbeat execution and startup schedule repair; no admin default. |

Regression tests execute production function declarations with query-recording
collaborators, plus focused source-contract checks. Each newly changed boundary
was observed failing before its implementation. These are not live customer-data
deletion tests or whole-repository release evidence.

## Candidate false-positive contracts and additional owner-role hardening

The bounded independent review corroborated shared catalogs, credential discovery,
pinned-hypothesis filtering, the internally admin-gated conversation helper, and
WhatsApp's separate owner state. It could not fully establish every claimed
caller-exclusivity premise below. Uncorroborated classifications remain
**UNVERIFIABLE**, not cleared. No new suppression entries have been added.

Its targeted follow-up established the executor retry/recovery/planner callers,
private tuner timer callers, single tenant-stamped paper ingress, guarded
cross-tenant experiment route, and validated tenant returned for the delegation
child. This supports those specific sites; it is not a universal exemption.

The separate failure review found and prompted correction of: Drive DELETE
HTTP failure falsely reporting success; a tenant-scoped heartbeat UPDATE falsely
reporting success on zero affected rows; and graph DB failures falsely reporting
empty counts. Regression tests observed each failing before those corrections.
The deletion-status defect is treated as HIGH deletion-integrity risk, rather
than CRITICAL: it falsely confirms an operation but does not itself bypass
authorization, destroy data, or move money. All three are in this session's scope.

| Retained identity | Evidence / contract |
| --- | --- |
| heartbeat.ts:2944,2459,2594; agentic-engines.ts:816; webhook-triggers.ts:318 | `shared/schema.ts` defines personas as a shared platform catalog, without tenantId/tenant_id. Storage persona accessors operate on that catalog. The referenced conversations/tasks still explicitly bind their actual tenant. Adding a nonexistent persona tenant predicate would break valid routing. |
| heartbeat.ts:3081 | The child is created in the same function with explicit tenantId. `createConversation` refuses missing/invalid scope. Its returned ID and tenant are used by tenant-scoped `getMessages`; no client-supplied foreign child ID enters this read. |
| seed.ts:3483 (two overlapping findings) | conversation_templates is a shared catalog with no tenant column, explicitly referencing shared personas. This is a server seed, not a tenant-controlled write. |
| routes/whatsapp.ts:113,123,157,145,168 | Undefined selects the separate legacy **owner** slot, not an all-tenant scope. `stateKey`/`phoneKey` separate "admin" from "tN"; auth-store owner deletion explicitly excludes t-prefixed tenant keys; owner phone writes target global agent_settings, whereas tenant writes bind tenants.id. Authenticated tenant identity is not read from body parameters. Added a prefix middleware requiring platform-admin role for the owner slot, including QR/status paths, while preserving the owner's existing session. Tests reject anonymous access and a non-admin principal claiming tenant 1, and prove ordinary tenant 2 never receives the owner alias. |
| auto-tuner.ts:568 | Private scheduled function is invoked only by the server's tuner timers. Its tenant-1 snapshot and cycle intentionally update the platform owner's tuning configuration. Tenant-invoked tuning separately receives its context; no customer tenant is inferred by this scheduler. |
| glasses-gateway.ts:157 | Authentication has no trusted tenant until the submitted credential hash resolves. The query checks the exact hash and revocation, then expiry/scopes; subsequent tool parameters and tenant ALS are stamped from the stored key tenant, never caller-provided tenant fields. This is credential discovery, not a customer row lookup authorized by an arbitrary ID. |
| paper-ingest.ts:673 | `ingestPaper` explicitly validates positive integer tenant before ingestion/database writes. Its sole application ingress in research handlers passes ctx.tenantId. The INSERT explicitly includes that tenant. |
| plan-executor.ts:741 | Internal approved-plan worker, not an HTTP/tool foreign-ID read. Planner approval CAS binds tenant; only successful approval kicks this executor, with startup recovery restricted to previously executable/recoverable plan rows. The executor claims approved state atomically, obtains the row's actual tenant, and executes under the claimed tenant/policy. Source probe selects dispatch semantics only. |
| platform-admin-conversations.ts:18 | Dedicated privileged cross-tenant inspection boundary checks `isPlatformAdmin(req)` internally before querying. All HTTP callers choose it only on platform-admin branches; ordinary callers use tenant-scoped storage. It is not an unrestricted getConversation helper or importable authority token. |
| routes.ts:2053 | Internal presenter-session writer requires constant-time verification of the server-owned SESSION_SECRET header before inspecting the payload or INSERT. Trusted server caller may act for its supplied positive tenant. Public tenants do not possess that secret; ordinary bearer/session auth does not authorize this endpoint. |
| self-improvement.ts:561 | Explicit ALL_TENANTS sentinel is used only by the `/api/experiments` platform-admin route, which rejects non-admin before import/query. The self-improvement tool passes ctx.tenantId; positive tenant paths add an experiments.tenantId predicate. |
| reasoning/handlers.ts:107 | `listActivePinned` always binds `WHERE tenant_id = opts.tenantId` and conjunctively applies the optional conversation filter. Supplying another tenant's conversation ID cannot remove the tenant predicate or return that tenant's hypotheses. |

Do not generalize these exceptions to arbitrary unscoped SQL, new write paths,
or different schema contracts. Suppression entries must retain narrow operation,
source-site/issue anchors and the specific demonstrated contract.

## Production memory evidence

An authenticated, read-only request to the published diagnostic endpoint returned
HTTP 200 with:

```
available=false; source=null; reason=cgroup-unresolved
v1: mounts=0, resolved=false, state=missing
v2: mounts=0, resolved=false, state=unresolved
snapshot=null
```

This establishes that the current production process has no exposed authoritative
memory-controller mount; the v2 membership is unresolved, not proven irrelevant.
It does **not** establish safe idle memory or an available v1 workaround.
Current fail-closed admission is therefore correct. No host-free-RAM fallback,
Node constrainedMemory estimate, increased heap, or invented quota is authorized.
The public documentation search supplied no supported way to expose those mounts.
Production verification remains blocked until an independently bounded execution
environment or readable authoritative runtime accounting is available. No
publication or external release propagation was performed by this remediation.

## Remaining release evidence

Independent review, compiler/regression checks, and a fresh source-bound completed
whole-repository audit must be recorded separately. Never edit the old report's
coverage/evidence hash or manufacture a zero-findings result from this document.

## Completed baseline scan and three additional fixes

The scan generated at `2026-10-10T04:34:49.574Z` covered **767/767 files,
68/68 chunks**, with zero failures, no unreadable files, no source change during
the run, and `degraded=false`. Its evidence hash is
`5f840b680224ddf966e4c1570a82ebfffedd81177f960412cfb04bb101a46c8f`.
It retained 37 severe candidate identities. Independent read-only review
classified three as confirmed MEDIUM gaps and 34 as FALSE POSITIVE.

Severity downgrades are explicit: Felix's run ID is created by its own
tenant-scoped insertion, and eviction IDs come from a tenant-scoped selection;
no current foreign-ID ingress was demonstrated. The classifier omission can
skip tenant BYOK/attribution, but cross-customer credential access was not
established. All three were corrected rather than deferred.

| Confirmed identity | Correction and evidence |
| --- | --- |
| reasoning-front-door.ts:109 | Validate positive safe-integer tenant before discovery; forward `input.tenantId` to preferred and fallback provider lookups. Missing context skips this optional classifier, preserving ordinary routing. Both provider branches and invalid-context denial are tested. |
| felix-loop.ts:684 | Both success and error UPDATEs now conjunct run ID with tenant. Tests evaluate both actual production tagged queries and their bound values. |
| storage.ts:708 | Eviction UPDATE independently conjuncts victim IDs with tenant. An injected polluted-victim list cannot expire a foreign-tenant row. |

Each missing boundary was observed RED before its correction. The four new
regressions pass; the combined retained-scope/verifier subset passed 60 tests.
Independent post-fix sensitive-surface/specification/silent-failure review
passed and reaffirmed the unchanged 34 false-positive sites.

### All 34 baseline false-positive identities

Line numbers identify the completed baseline report, not future source offsets.

| Identity | Verified narrow contract |
| --- | --- |
| agentic-features.ts:903 | Safe-integer array literal is a bound value inside Drizzle's tagged SQL, not executable SQL concatenation. |
| routes.ts:7086,7096,7106,7116,7134 | `requireAdmin` delegates to platform-admin authorization. This owner-only all-tenant backup restore is not tenant ingress; scoped storage validates positive tenant and imported messages use the created conversation's tenant. Personas are shared. |
| agentic-engines.ts:816; webhook-triggers.ts:206,318,322 | Personas have no tenant column: shared platform-managed catalog. Webhook conversations/events retain the validated trigger tenant. |
| agentic/executor.ts:231 | Supervisor ingress uses trusted tool/chat tenant, validates scope, and binds the ledger SELECT tenant. |
| auto-tuner.ts:568 | Private timer intentionally tunes the owner tenant; tenant-request tuning has separate explicit scope. |
| browser-tool.ts:953,978,1000,1024,1042 | Current authenticated routes and action dispatch pass tenant; legacy shared-browser branches are not tenant-request fallbacks. This is not approval of future unscoped callers. |
| crews-engine.ts:326,392 (array issue) | Array text is bound as a value, not executable SQL. Array parsing/integrity is distinct from SQL injection. |
| crews-engine.ts:392 (context-ID issue) | Execution reads only outputs already produced by current tenant's loaded crew tasks; foreign IDs remain inert, not arbitrary-row lookups. |
| delegation-events.ts:44,59 | SSE/polling use authenticated tenant and conversation ownership; current emitters stamp tenant. Legacy unscoped subscriber has no current caller. |
| doc-heading-tree.ts:184 | Tree SELECT binds tenant; current writer authorizes collection ID and tenant before creating the join reference. |
| glasses-gateway.ts:158 | Exact credential-hash/revocation discovery precedes knowing tenant; expiry/scopes checked, then stored-key tenant stamps execution. |
| heartbeat.ts:2115 | key_value_store is global repository-scanner state with no tenant column. |
| job-queue.ts:564 | Only current list caller is platform-admin guarded, intentionally global. |
| lib/owner-jury-api-route.ts:16 | Current ADMIN_TENANT_ID is the source constant 1, not configurable; additional server-owned ALS grant and lane/model gates remain. |
| platform-admin-conversations.ts:18 | Helper checks platform-admin role internally; callers choose it only on admin branches. |
| quarterly-intelligence.ts:343 | Runtime DDL declares non-null tenant; inserts/governor operations bind tenant. Schema-governance preference is not demonstrated isolation breach. |
| research-proposals.ts:368,762 | All current route/job/tool callers explicitly supply their authenticated/claimed tenant; legacy defaults are not exercised. |
| routes.ts:2054 | Constant-time server-secret authentication precedes positive-tenant validation and INSERT; ordinary customer credentials cannot authorize it. |
| seed.ts:3483 | conversation_templates and referenced personas are shared catalogs, with no tenant column. |
| self-improvement.ts:561 | Only platform-admin route uses ALL_TENANTS; tools pass context tenant and get tenant-filtered history. |

No audit report, evidence hash, coverage value, suppression list or deferral
list was edited to clear these candidates. These are individually evidenced
human-review dispositions, not a machine-zero result.

### Current-source verification and hold

After the three corrections, genuine staged compilation passed in 90.339
seconds on context
`2555ac0e80d3d59e5a6b3e48f0ac2669d4c38c566d986dca094b0e1be05cd8d6`.
Observed aggregate peak was 3,893,075,968 bytes under the finite 8-GiB cgroup;
guards and reserves were unchanged. Production build and read-only database
publication preflight passed; preview was restored and visually checked.
The older full audit remains valid evidence for its baseline only. A fresh
bounded current-source audit is running; it is not yet clearance.

Local public-surface burst smoke used the original Layer-1 harness logic,
10/50/100 concurrency for five seconds each, an in-memory `/healthz` mapping
instead of the intentionally protected `/api/health`, and a no-op email
transport. Native statuses: 4,318 HTTP200 and 2,089 HTTP429, zero 5xx or
transport failures. P95 at 100 concurrency: homepage 528ms, card 474ms, health
474ms. Rate-limited responses do not prove endpoint execution or authenticated
chat performance. The first stricter HTTP200-only attempt was inconclusive
(protected health/rate limits, then a VM-exit shim error), not a gate pass.

Workspace verifier standby is configured and remains `not_started`. Activation
flags/origin/credentials, publication, pushes, merges, hosting and external
release propagation remain held. Postpublication source matching and fenced
signed smoke are separate authorization/evidence gates.

## Refreshed audit and voice-wake closure

The next complete scan generated `2026-10-10T05:13:46.078Z`:
hash `36e1fcb45de2cf25ce04acf9282c652877923de6010ccbbb7e9fdb851a3d4eb9`,
767/767 files, 68/68 chunks, zero failures, no unreadable files,
`sourceChangedDuringRun=false`, `degraded=false`. It retained 29 severe
candidates. Independent caller/schema review classified 19 FALSE POSITIVE,
nine MEDIUM predicate/integrity gaps, and one confirmed HIGH shared
voice-wake configuration access defect. The earlier three corrected sites
were no longer retained. This report is historical after the following edits.

### Additional corrections

- Voice-wake GET/POST require the canonical platform-admin guard before file I/O.
  Settings hides/disables the shared owner controls for other tenants. Chat
  separately masks cached owner words, not merely the query request.
- Compatibility review caught ordinary TalkMode receiving `undefined` (its
  default is an empty list). Non-admins now receive only the stable public
  built-in defaults, matching the server defaults, preserving wake detection.
  This correction was independently re-reviewed and observed RED then GREEN.
- Auto-project messages independently bind conversation and tenant.
- Three research-program joins compare the parent/child tenants; the
  experiment/session join independently compares tenant too.
- `failJob` takes the actual claimed tenant at all four callers. SELECT and both
  failure UPDATEs retain scope plus existing attempt/status/live-lease fencing.
  Explicit NULL/global-job scope uses `IS NOT DISTINCT FROM`; missing or malformed
  scope is not an admin fallback. Missing scoped row causes no mutation.
- Owner startup project 15 update requires tenant 1 and tenant-1 conversation 272.
- Proposal embedding stamping requires valid scope before embedding and binds its
  UPDATE to proposal ID plus tenant; both current callers pass their real tenant.
- Phone pairing checks row tenant against claimed tenant and constrains its
  conversation lookup to that tenant. Deployment pairing-row format was not
  inspected; malformed claims fail closed rather than rerouting cross-tenant.

The eight corrected MEDIUM identities were auto-project, failJob, three research
joins, seed link, embedding stamp and phone pairing. No current attacker ingress
was established for those omissions: authoritative selections/private claimed-job
callers/validated parent relations prevented a demonstrated HIGH exploit.

### Remaining documented MEDIUM minimization gap

`routes.ts:999` still discovers all owner IDs for an exact upload basename,
then checks authenticated ownership and generically denies nonowners. This
intentional collision-discovery lookup does not return foreign IDs/content to
the client. Replacing it with a tenant-only lookup without preserving the
foreign-registered versus legacy-unregistered distinction would change legacy
asset access and signed-delivery behavior. Further metadata minimization remains
documented; it is not a demonstrated current HIGH/CRITICAL exploit or a new
machine-audit suppression.

The other 19 current identities retain narrow verified contracts: shared personas
(API dispatch/sessions/webhook), privileged export/import and goal-ledger,
server-secret presenter, server-owned capability telemetry, unused CEO in-memory
accessors, explicit current memory-section tenant caller, validated heading-tree
collection writer, owner-only income runtime, authorized project-context brain
reader, and privileged global zombie cleanup. Do not generalize these exceptions.

Latest checks: 33 focused regressions PASS; current `npm run publish:preflight`
PASS (full TypeScript, preflight compiler and read-only database catalog checks).
Independent security/compatibility review passes. No current-source full audit
or new immutable-stage compiler result is claimed by these checks.

Bob explicitly requested Republish after disclosure that final audit/review
clearance was pending. The original public VM/domain was confirmed through the
deployment service. This is authorization for the user-facing Publish action,
not proof that publishing occurred or that full-audit clearance exists. Automatic
pushes, external release propagation, standby activation and new hosting remain
held; no email or real customer-pairing write was performed.
