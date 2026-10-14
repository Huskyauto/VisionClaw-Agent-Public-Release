# Republish tenant-audit triage — October 13, 2026

## Authority and release status

The completed report at `data/tenant-isolation-audit/latest.json` was generated
at `2026-10-13T09:26:33.700Z`: 772/772 files, 68/68 chunks, no failed chunks,
unreadable files, source changes during the run or degraded coverage.
It retained 36 severe findings: 192 precision suppressions and 23 existing
allowlist suppressions accounted for the other 215 severe findings.
There were no deferred real risks.

That report is now **historical maintenance evidence**: the repairs below
change its source hash. No findings, dispositions, suppressions or report hashes
were manually rewritten. Per `replit.md` § Schema & DB, republish readiness uses
`npm run publish:preflight` and the Publish schema comparison; a whole-repository
model audit must not be restarted or used as a republish gate.
`scripts/verify-republish-readiness.ts` checks audit freshness, not the standing
publication policy. Publication and Git pushing remain held.

## Confirmed findings repaired

| Original identity | Repair |
| --- | --- |
| `server/doc-heading-tree.ts:179` | Bind `doc_collections` to the tree caller's tenant in the LEFT JOIN. Keep owned trees visible when no owned collection matches. |
| `server/skillify.ts:91` | Bind the intent-distillation message excerpt directly to the caller tenant. |
| `server/skillify.ts:201` | Bind the conversation-analysis message read directly to the caller tenant. |
| `server/skillify.ts:329` | Bind the final skill-construction message excerpt directly to the caller tenant. |
| `server/minds-engine.ts:501` | Bind worker transcript messages directly to tenant, in addition to the parent conversation join. |
| `server/routes/memory.ts:193` | Use the established `isPlatformAdmin(req)` authority for the linked-memory batch, consistently with its source and graph checks. Tenant number 1 alone no longer removes the predicate. |
| `server/oauth-subscriptions.ts:1143` | Missing customer YouTube grants could invoke owner-secret bootstrap. `seedYouTubeIfMissing` now checks `isPlatformGoogleConnectorTenant` before any DB query, environment access or network request. Customers must use their own connection or remain disconnected. |
| `server/process-watchdog.ts:127,180` | Cancellation and orphan events now use trusted registered/tracked tenant identity, rather than owner-tenant fallback. All three registration callers supply task or persisted plan identity. Invalid/missing identity suppresses event publication while local cancellation still succeeds. |

The YouTube defect was reproduced with synthetic credentials: the old customer
branch made two queries, read three credential fields and attempted one refresh.
The guarded branch does none of these. The owner bootstrap remains available.
A read-only production metadata query found one YouTube connection, under the
owner tenant, and no customer YouTube rows. No tokens were selected, decoded or
printed; this does not establish historical absence of misuse.

## Source-verified benign paths

These are investigation conclusions, **not new native audit dispositions**.
No broad suppression or tenant remapping is justified by this document.

| Original identities | Evidence and scope |
| --- | --- |
| `server/agentic/harness-adaptation.ts:219` | Platform nightly self-harness; `runHarnessAdaptation` takes window/dry-run options, not a customer tenant. Mining is intentionally restricted to owner spans. |
| `server/capability-review.ts:428` | The shown chat caller passes its already tenant-resolved conversation and context into the stamped insert. |
| `server/chat-engine.ts:4706` | `attachCitations` receives the third tenant argument; storage updates the message with both message ID and tenant. It does not attach tenant-owned citation-table rows by foreign ID. |
| `server/heartbeat.ts:81,85` | Reported lines are inaccurate. The matching approval updates follow `createHeartbeatTask` in the same flow and use the newly returned row ID. Both constructors explicitly pass the trusted tenant. Defense-in-depth now also binds that tenant directly in both approval UPDATEs. |
| `server/job-queue.ts:572` | Identified unscoped listing caller is the platform-admin-only operator job route. |
| `server/lib/bineval.ts:167,214` | Stateless SDK question/verdict completions, not tenant-owned provider resource reads/writes. The alleged absent DB/resource tenant filter is not applicable. This does not certify billing attribution. |
| `server/persona-export.ts:39` | `skills` and `personas` are shared schema tables without tenant columns. |
| `server/platform-admin-conversations.ts:18` | Explicit `isPlatformAdmin(req)` check protects the intentional cross-tenant conversation boundary. |
| `server/project-brain.ts:325` | Sole shown loader caller selects the project by both project ID and tenant before reading its artifact. |
| `server/research-proposals.ts:368` | Identified replay route validates the admin session/tenant and supplies the tenant explicitly. |
| `server/research-proposals.ts:762` | Identified research route supplies caller tenant; queued research uses its persisted job tenant. |
| `server/routes.ts:2022` | Presenter tokens are intentional bearer capabilities for the selected presentation, not ordinary session-tenant lookups. |
| `server/routes.ts:7098,7108,7118` | Platform-admin import restores exported ownership metadata. Forcing all restored rows into tenant 1 would corrupt customer ownership. |
| `server/routes/goal-ledger.ts:95` | Platform-admin-only operator ledger intentionally includes platform-wide jobs. |
| `server/seed.ts:3468` | `conversation_templates` is a shared table without a tenant column. |
| `server/sessions.ts:69`, `server/subagents.ts:297`, `server/voice.ts:297`, `server/webhook-triggers.ts:318` | Referenced personas are shared schema rows, not tenant-owned persona tables. |
| `server/storage.ts:577` | Full-system backup; identified API caller is admin-gated. Preserve original tenant metadata. |
| `server/storage.ts:960,970` | Identified callers are system maintenance and admin-gated missing-embedding operations. |

## Independently reviewed authority contracts

- `server/routes.ts:2056`: independent review confirmed the constant-time
  master-key check before accepting tenantId, and the sole Slides issuer's
  trusted Google tool context. This establishes an internal issuer contract,
  not general customer-session authorization.
- `server/process-watchdog.ts:127,180`: independent review confirmed event reads
  and channel/subscriber routing use the event tenant. Customer task labels are
  no longer placed in owner-tenant or other customers' event feeds. The existing
  high-salience notification to the platform operator is a distinct privileged
  audience, not evidence of cross-customer access.
- The reviewer corrected its earlier persona advisory: personas, skills and
  conversation templates are shared schema tables without tenant columns.
- No broad maintenance-scan, optional-default or exported-recorder exceptions
  were added. Privileged caller coverage remains maintenance investigation work.

## Verification boundaries

Focused regression checks cover compiled SQL/fixture boundaries and public
distillation/bootstrap functions using injected drivers and synthetic provider
responses. They do not prove live PostgreSQL races, live provider billing,
browser sign-in journeys or historical production behavior.
The focused batch passed 22/22; TypeScript passed with a 2200 MiB heap cap.
The independent source/security follow-up passed the changed source.
A new production build passed with development-data synchronization disabled.
The three new security test files are registered in the canonical test runner.
`npm run publish:preflight` subsequently passed: database reachable, no new
non-portable FK parent keys, and all public constraints validated. The earlier
no-difference Publish schema comparison remains applicable because no schema
changes were made. No live concurrency, billing or historical misuse claim is
made. Git/publication remain held.
