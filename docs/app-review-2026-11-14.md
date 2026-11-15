# Cross-app code review and source refresh — November 14, 2026

## Scope and evidence boundary

Owner-requested review across the application, followed by refreshed private and
sanitized public GitHub source and both READMEs. No application publication,
production mutation, paid inference, schema change or expanded tool permission
is included.

This was a risk-based cross-app review, not a line-by-line certification of the
entire repository. Independent inspection sampled authentication/CSRF, tenant
routes, Stripe checkout/webhooks, MCP, tool dispatch/safety, frontend data-loss
boundaries and public export/documentation. Repository scanners and bounded
regressions supplement inspection; none establishes production correctness.

## Findings and disposition

| Severity | Finding | Source repair |
|---|---|---|
| HIGH | A tenant could replay an old paid checkout after its subscription was canceled. | HTTP activation validates current provider status, customer, metadata and monthly USD price; stores subscription/customer bindings and conditionally preserves customer ownership. Checkout-activation and subscription-update webhook paths also inspect current provider state. |
| MEDIUM | MCP memory supersession hid an old fact after accepting only a volatile queued replacement. | Lock the owned active row; insert through existing storage redaction/tombstone checks and link the successor in one transaction. Failures roll back both writes. Confidence/quality rules remain; response identifies persisted replacement, not queue acceptance. |
| MEDIUM | Force-cancel could turn a completed video into a failed job and hide its links. | Tenant/job/status predicate updates only active states, including a completion-versus-cancel race at the SQL boundary. |
| LOW | MCP persona listing queried `active`, but the schema uses `is_active`. | Corrected the query and removed a stale hardcoded persona count from discovery text. |
| LOW | Selected operational logs exposed customer addresses or delivery-link fragments. | Removed those values without deleting delivery, email or failure-handling functionality. |
| Documentation | Public README promised one universal pipeline, universal tenant filtering and universal undo. Private architecture had stale tool/runtime counts and absolute loop claims. | Qualified execution/MCP/RLS/recovery statements, aligned registry/runtime references and updated latest-source summaries. |

Independent findings were confirmed against callers and production source before
editing. No independent finding was rejected as a false positive. The initial
review's unfinished GitHub/README requirements were expected pending work, not
evidence of a runtime vulnerability.

## Scanner results

- Initial dependency scan: **four moderate and one low advisory**, all in Hono
  4.13.13. Compatible update resolved to **4.13.18**; rescan returned **zero advisories**
  at all severities. This does not establish exploitability of the old version.
  The installer initially wrote an internal package-download URL; the portability
  gate caught it. The public HTTPS tarball matched the original SHA-512 integrity,
  so only that download location was corrected, without changing package bytes.
- Static-analysis scanner returned **incomplete**, with no findings in its
  returned subset. That is **not** a clean completed SAST result.
- Privacy/dataflow scanner returned **112 LOW reports** across runtime,
  administrative and historical scripts. Reports include expected provider data
  transfer and indirect call-chain allegations, not 112 confirmed leaks.
  Selected direct customer/link logs were minimized; remaining low reports have
  not all been individually adjudicated or cleared. Do not apply its suggested
  deletion of core delivery/registration calls.

## Regression strategy

`tests/security/app-review-integrity.test.ts` executes the actual compiled
billing, webhook, video and MCP handlers with isolated provider/database seams.
It covers canceled-subscription replay, valid and mismatched entitlement inputs,
terminal-job preservation, tenant predicates, memory insert/link rollback and
foreign-owner rejection, MCP confidence rejection, durable completion receipts
and the persona query. The transaction fixture verifies the storage contract;
it is not a live PostgreSQL integration or a Stripe/browser journey.

The canceled-checkout and terminal-video tests reproduced their failures before
the repairs. The MCP catalog test likewise failed against the original column.
The new transaction helper was introduced after its missing-module regression
failed. Obsolete mirrored queue-acceptance tests were removed because they
asserted the unsafe behavior instead of exercising the real implementation.
The new regressions are in the canonical test runner.

## Local verification results

- **159/159** credential-isolated regressions passed across 22 selected files:
  the new integrity regressions plus auth/admin, AHB, CSRF, execution/sandbox,
  cross-tenant HTTP, MCP ingress, webhook/payment, Demo Studio, dispatch and
  release-fact contracts. No failures, skips or cancellations.
- **13/13** current release/landing/sidebar/README/SEO checks passed after
  correcting tests that confused a retained historical entry with the newest
  release summary.
- Application **TypeScript passed** with a bounded 3.5-GiB heap.
- Domain-boundary preflight passed across **269 files / 92 domains**;
  stale-string preflight passed all **25 rules**.
- Agent-wiring audit passed with no dead tools, drift or schema gaps; **29
  pre-existing warning-only orphan tables** remain. No internal persona-facing
  tool or permission was added.
- All **three** package-portability/export-history/CI-image checks passed after
  the integrity-verified Hono URL correction.
- The **production build passed** in release-check mode, which skips development
  database snapshots. Four existing CJS `import.meta` warnings remain in the
  auxiliary load-test bundle. Build success is not production rollout.
- Remote repository receipts are separate acceptance evidence, not inferred
  from local checks.
- The first public-mirror attempt correctly stopped at export verification:
  graph-builder test scratch-directory prefixes matched the private SKU rule.
  Renamed only those synthetic prefixes; the sanitizer and verifier were not
  weakened. An old matching local/remote mirror commit was not treated as
  evidence that this new snapshot had shipped.
- Restarted development app served the landing page with current inventory;
  the initial six health checks passed. Anonymous `/api/auth/user` returned the
  expected 401. Startup retained existing warnings about memory growth,
  owner-only tool denials and a missing optional exploration-state file.

## Separate automated tenant-audit evidence

The retained degraded report generated at 23:50 UTC on November 14 covers
**722/866 files**, with **38 chunks pending** and **446 raw findings** (15
CRITICAL, 395 HIGH, 33 MEDIUM, 3 LOW). These are machine dispositions from a
separate existing audit, not 410 independently confirmed severe vulnerabilities
or a completed current-source assessment.

A sampled MCP-control-plane allegation is a **false positive**: it demands
`tenant_id` on the deliberately global `mcp_servers` table. The schema has no
tenant column and `/api/mcp/servers` requires `requirePlatformAdmin` before
access. No schema/authorization change was made to satisfy that incorrect
allegation. Remaining machine findings require source-aware triage; this review
does not clear them or rewrite the original audit evidence.

## Remaining limits

- Existing incomplete tenant-audit coverage and staged RLS remain unresolved;
  this review does not activate roles, policies or flags.
- External subscription state and database updates are not a distributed
  transaction. This repair prevents historical-session replay; it does not
  claim universal webhook ordering, multi-subscription lifecycle reconciliation
  or exactly-once entitlement transitions.
- No new live payment, paid model generation, email delivery, Drive delivery or
  video render was performed. No new authenticated browser pass was required
  for these server-side fixes; behavior was checked through compiled handlers.
- Internal persona permissions did not change. MCP-only tool descriptions expose
  the updated replacement contract to scoped clients; internal personas do not
  invoke that separate MCP memory surface.
- GitHub source publication is separate from running-application publication.
  The public mirror deliberately excludes private/proprietary records and
  ignored runtime assets; “all files” means eligible source under that policy.
