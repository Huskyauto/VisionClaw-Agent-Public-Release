# Targeted release checks

## Purpose and authority

Use `npm run release:check -- --base <commit-sha>` to run bounded, deterministic
release checks against an explicit source-comparison baseline. A publication
marker is a candidate comparison point, not proof that a deployment succeeded.
The command never publishes, pushes, runs model inference, or marks the full
tenant audit complete. Successful automated checks still require independent
review of changed security boundaries and unresolved known findings.

Review changes, known problem areas and uncertain areas; expand for evidence
of wider impact. An unknown changed production path blocks automatic scope
selection rather than being silently treated as documentation.

## Design gate

1. **Cost/scale:** no model inference, charges or customer sends; sequential subprocesses,
   fixed regression list, explicit command deadlines and a 3 GiB compiler heap.
2. **State:** workspace-only reports under ignored `.local/release-checks/`.
   They are evidence for this source snapshot, not production authority.
   Loss of a report means rerunning the checks.
3. **Failure:** missing files, Git errors, unknown scope, failed commands,
   timeouts or source changes produce a nonzero exit. No partial pass.
4. **Identity:** report includes resolved baseline, current source digest and
   the exact check names/results; review must bind the same source snapshot.
   Root release instructions/READMEs, roadmap, generated totals and dated update
   documents are source-bound, including newly added documents. Release-document
   changes select public-interface regressions. Mutable audit checkpoint/report
   outputs are not build inputs; audit implementation and the separate strict
   full-audit readiness gate remain unchanged.
5. **Scope/limits:** local developer command, not a tenant-facing endpoint or
   agent tool. No new permissions or paid-provider fallback.
6. **Stop:** subprocess time budgets kill process groups; no automatic retry.
   Interrupting the runner stops its active child.
7. **Authority:** automated checks cannot supply their own independent review
   or owner publication approval. Known findings remain open until adjudicated.
8. **Evidence delta:** existing serial model audit is not removed or relabeled.
   This runner makes the changed scope and deterministic evidence reproducible,
   without pretending those checks prove absence of vulnerabilities.

## Scope policy

The policy covers the current auth-revocation, safe-fetch, audit-worker,
audit-transport, document ownership, mission-payment association, plan ownership
and public-interface changes plus their regression tests. Payment scope also
runs the development-database mission lifecycle with constructed Stripe events;
pause application/background job consumers during this check so fixture jobs
cannot cause real background work. This does not exercise a live charge.
Other production paths require deliberate scope expansion and relevant tests.
Documentation, retained research and generated audit progress are identified
separately; changing those does not establish security clearance.

The inventory used for drift detection covers tracked application, build and
test inputs, documentation/build metadata (including imported release facts),
tracked data inputs other than audit progress, plus changed inputs. Changed-path
membership is also checked again after execution. Hashing source is not a model
audit of it.
Unknown dependencies are a review question: the regex-based codebase graph is
not complete enough to authorize excluding callers.

The build runs with `--release-check`: this skips DB-backed development export,
does not read/preserve an old development snapshot, and rejects a build that
still contains `dist/dev-data-snapshot.json`. Normal builds retain their existing
behavior. This removes a generated export from check artifacts, not original
database records.

The command's success message is **AUTOMATED_CHECKS_PASSED_REVIEW_REQUIRED**,
never “safe,” “certified,” or authorization to publish. Independent review must
also consider known and uncertain areas outside the textual diff.

The older `scripts/verify-republish-readiness.ts` remains the strict
**full-audit** validator. It will still reject an incomplete or stale full audit.
The new command does not override it or manufacture a full-audit receipt.

## Known-finding review during this implementation

The 26 retained severe allegations in the historical October 19 audit were
reviewed against current code and callers, not assumed fixed by passing tests.
Three revealed the same real PDF ownership bypass. The correction reads
authoritative upload bytes under an exact filename-and-tenant predicate, supports
both base64 DB records and tenant-bound Object Storage keys with metadata/byte
size checks and a bounded download wait, supplies
trusted tenant context to inspection, rejects arbitrary workspace files and
gives outputs unique names. The same source-read guard covers PDF header images;
the same output-name protection covers the sibling PDF generators.

Independent targeted review found and corrected two more boundaries:
orchestration-plan getters now require a positive safe tenant and compare the
plan tenant; mission Payment Links now set PaymentIntent metadata as well as
link/session metadata. Reused mission links are updated before return, and old
link payments/refunds recover attribution through exact parent/session IDs.
Malformed metadata, ambiguous/paginated sessions and mismatched parent IDs fail
closed. Owner and approved-stage checks and per-refund deduplication remain.
Provider reads are bounded to ten seconds each with no automatic SDK retry.

The final source review adjudicated the 26 historical allegations as 20
contradicted on their inspected callers/constraints, five corrected in source,
and one conditional shared-inbox limitation. Shared-primary-inbox polling uses
provider message IDs globally; tenant-visible reads/replies remain scoped.
Global provider-ID uniqueness is **not proved**. Duplicate IDs, account-wide
webhooks covering additional inboxes, or multi-recipient messages can suppress
or misroute delivery; no reachable HIGH/CRITICAL counterexample was established
under the configured single-primary-inbox contract. Revisit deduplication and
recipient routing before enabling multiple physical inboxes. This is not a
universal provider-identity or delivery guarantee.

The separate payment-association counterexample is corrected in source. A
read-only enumeration found no Payment Links in the configured live Stripe
account, so no historical remote repair was performed or claimed. Real charge
and refund behavior remains post-publication verification, not an offline test.
Memory-stats/PDF default-tenant concerns had contrary current-code evidence;
aggregate spend is intentionally platform-wide and transaction-locked.
Remote-browser DNS pinning remains the previously recorded infrastructure
residual, conditional on private-network access remaining disabled.

The independent reviewer passed the changed boundaries with no demonstrated
current HIGH/CRITICAL blocker, conditional on the final automated batch.
Neither that review nor these checks complete the full audit, prove the live
deployment's source identity, authorize a push, or authorize publication.
