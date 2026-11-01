# Review follow-ups and report-package republish checklist

Owner direction: fix the immediate issues, save the remaining work, and prepare
the report-package redesign for republication and testing. Git pushing remains
held; use the existing Replit publication, not a backup fork or an unrelated
Railway source push. No new paid report run is implied.

## Immediate release slice

- [x] Paid stream creation/provider failures mark the turn interrupted, retain
  paid uncertainty and completed tool receipts, and do not auto-retry/substitute.
- [x] Interrupted turns persist before exiting; skip success broadcast, title,
  learning and sent hooks. The browser treats terminal provider errors as fatal
  without suggesting an automatic resend.
- [x] Remove explicit phone/JID, sender-label and message-preview interpolation
  from reviewed WhatsApp connection, approval load/update, inbound, warning and
  failed-send logs. This is not an assertion that every app log is PII-free.
- [x] Add a shared, explicit 24-file offline report-release inventory.
  `bash scripts/test-report-package-release.sh` bounds execution to 240 seconds,
  one test file at a time. The local suite and private CI consume this inventory.
- [x] The release inventory passed 109 tests, zero failures/skips before the
  final log-only/privacy-assertion expansion. All five updated focused
  regressions passed afterward. Final TypeScript and production build passed;
  the compiled client contains the no-automatic-resend copy.
- [x] Application restarted and public landing rendered. Nine development-only
  GET probes returned 200 for homepage/agent card and expected unauthenticated
  401 for the protected health endpoint. This is a bounded smoke check, not
  model/DB/queue performance certification or a production load test.
- [ ] Owner completes Publish, then verifies the newly published build rather
  than testing the previously live bundle.
- [ ] Confirm the protected company-package form/configuration, then obtain
  explicit approval for any new report purchase or historical paid continuation.

The report package still uses the implemented nine concurrent authors plus
three dependency-bound syntheses, evidence references with deterministic
quotation insertion, retained historical receipts, $150 model / $5 narration
ceilings, and PDF/MP3/teaser delivery. Offline fixtures are not live availability
or customer-delivery proof.

## Saved work — prioritized, not silently resolved

### 1. Compatible dependency security patches — high priority

Review report: `.local/reviews/2026-10-22-app-review.md`.

- `@anthropic-ai/claude-code@2.1.169`:
  `GHSA-pq7j-f95f-qfcv`; scanner reports fix at 2.1.179.
- Installed `undici@7.29.0` beneath Cheerio/JSdom:
  `GHSA-rfgv-xxqx-mfg5`, `GHSA-w293-vg96-wgc3`; reported fix 7.29.1.
  The root Undici is a different 6.x copy. Do not replace that major blindly.
- `brace-expansion@5.0.9`:
  `GHSA-6j4f-fj2g-mc7p`, `GHSA-qhr7-859c-m2p7`.
  Resolve all current advisories with compatible patches and confirm every
  nested copy; legacy CJS consumers cannot be forced onto a new export shape.
- Establish exact paths for the additional scanner records for
  `brace-expansion@1.1.18` and `braces@3.0.3`.
- Vite 7.3.6 has a reported Windows-specific editor advisory, fixed at 7.3.7;
  distinguish development Windows exposure from this Linux VM.

Why deferred: keep the report-testing release surgical rather than combine it
with unverified dependency-tree refreshes. No reachable exploit was established;
this is not a security clearance or permission to suppress advisories.
Use the package-management/dependency-upgrade procedure, bounded checks and a
fresh scan. Existing deferral `GHSA-mh99-v99m-4gvg` does not cover these IDs.
Do not run the auto-healer or restore Git auto-push just to perform this cleanup.

### 2. Establish Python scanner provenance before claiming app exposure

Four raw critical records were two alias pairs for `certifi@2026.7.22` and
`h11@0.9.0`; Starlette records also appeared. The default Python environment
did not contain these distributions and root `pyproject.toml` had no dependencies.
Find the exact scanned artifact/interpreter and reachable feature. Unresolved
origin is neither confirmed production exposure nor a false-positive verdict.
Deduplicate aliases, then patch the owning runtime if applicable.

### 3. Complete source-bound security audit coverage

The general static scan returned `incomplete=true`, not a clean result.
The tenant artifact at `data/tenant-isolation-audit/degraded-latest.json`
(2026-10-22T06:38:22.083Z) listed 828 candidate files but zero successful chunks
and zero files audited after the first of 70 chunks timed out.
Recover bounded/resumable coverage with exact source identity and truthful
degraded status. Do not call inventory totals audited totals, widen suppressions,
or initiate unbounded paid model runs.

### 4. Finish whole-suite test classification

Original review inventory: 73 changed test files, 68 absent from local suite
selection, 25 absent from default private CI selectors.
The new explicit report-release inventory closes an important subset, not the
entire gap. Recompute remaining omissions against the new selectors; do not
repeat the old counts as current residual counts.
Classify every test as offline, database/integration, or separately approved
live-provider work; make local/private CI selection consume a validated common
inventory. Do not indiscriminately glob all tests with owner credentials.

### 5. Stronger interrupted-stream integration evidence

The regression covers actual persistence-expression semantics, client error
classification, cleanup ordering and safe copy. Add an injected HTTP/SSE test
for a connected paid creation failure and a mid-stream failure with completed
tool output. Assert saved row, aborted marker, client error status, no success
broadcast/sent hook, and no retry or substitution, without a real provider call.

### 6. Repair the load-test runbook/harness mismatch

The runbook describes a local gate, but `scripts/loadtest-layer1.ts` defaults to
the production domain and sends an owner email. Do not run it unchanged as an
offline/local release check. Use bounded local GET-only probes for this release.
Later reconcile the target default, email opt-in and actually measured metrics;
public endpoint latency is not model, auth, DB or queue latency certification.

## Publication and first live test

1. Publish to the existing verified deployment at `https://agenticcorporation.net`.
2. Verify new production startup/version and owner-only package access without
   submitting a paid job.
3. Choose exactly one test package or retained package continuation; agree the
   allowance before dispatch. Preserve paid/uncertain operation identities.
4. Verify durable research coverage, nine-plus-three operation counts, retained
   siblings/restart reuse, conservative reservations, and three PDF/MP3 pairs
   plus teaser. Distinguish reserved allowance from actual provider charges.
5. If a stage stops, inspect the exact retained receipt and failure reference;
   do not create another package or repurchase an uncertain operation.
