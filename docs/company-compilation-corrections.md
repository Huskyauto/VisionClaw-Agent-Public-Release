# October 21: unsent dental correction after JSONB persistence

Live evidence confirmed the targeted readiness repair completed. The ninth
author (`author:opportunities:claude-opus-5-5`) then failed its verbatim-source
check. Its first correction claim was saved, but central spending rejected its
insertion-order-sensitive digest after PostgreSQL JSONB reordered the raw
response. No correction reservation exists for that operation; runtime always
reserves before provider dispatch. This is not an uncertain paid call.

New ordinary correction receipts use explicit digest version 2: recursively
sorted JSON object keys, exact string contents and array order. Existing version
1 receipts, targeted grants and spending keys remain unchanged. The central
spender also rejects ANY prior correction reservation for the operation,
regardless of digest version.

`company-compilation-unspent-recovery.ts` source-binds reconciliation to the
exact saved owner package, research subject, operation, legacy claim and canonical
raw-response digest. It requires the original reservation, existing one-shot
approval, valid unchanged cap, blocked inactive state, the same validator failure,
and absence of all correction/targeted reservations. It refuses received,
reserved, different, replaced, targeted or already-reconciled claims.

The existing owner-only Continue route rechecks that binding under its row lock,
archives the entire old unsent claim as `reconciledUnspentClaim`, and lets the
normal one-shot policy create a new canonical claim. It does not reserve, call a
provider, alter research or approve another correction. Central reservation,
lease, cap, kill-switch, validation and no-retry rules still apply at dispatch.
Do not manually delete claims, spending keys or response receipts in production.

Offline evidence: `scripts/company-unspent-correction-offline-replay.ts` consumes
the private retained CSV outside served roots. It round-trips checkpoints through
real development PostgreSQL JSONB SELECTs, while job storage, providers and
delivery are fakes. It checks the real resume route and central reservation,
preserved original receipts and archived claim, one simulated correction, three
simulated syntheses, three simulated report/audio pairs and teaser, and duplicate
reservation rejection. This is not proof of live model output or file delivery.

# Bounded company compilation corrections

Owner approved one automatic corrective call per original author/synthesis step,
within the existing $150 package model cap. Publication and Git pushes remain held.

## Design gate

1. Cost: 12 original operations, at most 12 corrective operations; every call
   reserves its conservative maximum under the existing parent row lock. The
   aggregate model allowance is never raised and cannot exceed $150 for this policy.
2. State: original and correction receipts, phases and approval live in the
   existing Postgres job payload; no local-disk dependency.
3. Failure: validation failures can qualify; unknown model identities, refusals,
   transport failures, lost leases and ambiguous paid claims cannot. A failed or
   uncertain correction stops. Receipt persistence precedes validation.
4. Identity: correction key binds original operation and original response digest.
   Durable claimed state and unique spend reservation prevent duplicate dispatch.
   Existing manual replacements and automatic corrections are mutually exclusive.
5. Scope: owner tenant only, v3 only, exact pinned model, original evidence and
   headings, unchanged content/output limits, existing processing window and cap.
6. Stop/observe: existing REPORT_EVIDENCE_HANDOFFS_DISABLED stops spending;
   approval is explicit at creation/resume. Per-operation correction phases are
   exposed in owner status. No new scheduler or independent repair agent.
7. Authority: owner approves; deterministic server validators select eligible
   failures; model proposes replacement text but cannot edit validation, spend,
   evidence, approval or stop rules. Server alone accepts it.
8. Evidence: compare unchanged 12-operation success path with invalid-output
   correction, second failure, crashes, timeouts, cap/tenant/lease rejection,
   wrong identity and resume. Offline tests do not prove live delivery.

## Operator guidance

Use the company-package form, not a jury or generic retry tool. Creation consent
includes bounded corrections. Existing packages require explicit opt-in on
Continue; ordinary Continue without opt-in never silently upgrades authority.
Correction uses the same model and supplied sources plus fixed validator feedback.
Feedback is nested inside the existing user-data message so the guarded Argon
transport retains its exact two-message contract. If the optional prior response
would overflow context admission, it is explicitly omitted from the correction
input; original intake, evidence and all three synthesis drafts remain intact.
Original responses and all spend reservations remain retained. Completed reports,
Fish audio, and verified delivery receipts are reused by the existing continuation.
The request includes a serialized-JSON budget for every required section, with
headroom for metadata and unknowns. Author-size corrections include the actual
canonical character/UTF-8 byte counts and each section's measured size from the
existing validator; the fixed failure code alone is not adequate repair guidance.
These are model instructions, not a guarantee of compliance. Acceptance still
enforces the original hard bounds and complete-content/evidence requirements.
When the correction is received but invalid, status must say so rather than
claiming its outcome is uncertain. Continue is unavailable for that invalid
receipt; it may finish validation of an already saved valid correction without
another dispatch. Claimed corrections remain uncertain and require reconciliation.
If correction fails, inspect the displayed reason and retained receipts; do not
start a new package or buy another replacement without separate exact authority.

## Separately approved dental exception

Bob explicitly approved one additional targeted correction of the saved dental
readiness/GPT draft, inside the unchanged $150 package cap. This is NOT a second
automatic correction policy for other operations or companies.

The source-owned grant in `company-compilation-targeted-repair.ts` binds the
owner tenant, package, report operation, research/intake subject, original
response digest and failed-correction digest. The ordinary correction policy
remains one per operation. A new Continue on the matching blocked package
persists this exact grant under the existing owner-only locked resume transaction.
It preserves the original and failed correction and records a third, separate
`targetedRepair` receipt. Other jobs cannot gain this permission by submitting
an approval flag or copying the persisted approval.

- Cost/scale: one extra pinned-model call for the exact approved draft; the
  shared row-locked reservation, current processing window and $150 cap apply.
- State: approval, claim and receipt live in the existing package payload, not
  local files. A retained invalid correction must exist, with both paid claims.
- Failure: only the approved received author-size failure qualifies; refusal,
  changed bytes/subject, wrong model, uncertain claim or manual replacement
  fails closed. A failed or uncertain targeted repair cannot be purchased again.
- Identity: a unique reservation binds the failed correction digest; claim
  precedes dispatch, and receipt persistence precedes validation.
- Tenant/limits: only the exact owner package; all original evidence/content,
  JSON, narration and model-identity checks remain unchanged.
- Stop: the existing report-handoff kill switch remains authoritative.
- Authority: Bob approves; source-owned exact bindings and deterministic
  validators admit; the model cannot approve, change limits or widen retries.
- Evidence: unit tests plus the private read-only retained-checkpoint replay
  cover owner API resume, one mocked reservation/dispatch, preserved receipts,
  full mocked completion and replay. No offline result proves live completion.

Operator: after the update is published with owner approval, open the existing
dental package and use **Continue saved package** with the original allowances.
Do not create another package, delete either failed response, or change claim
phases to free a retry. If the targeted receipt is claimed/uncertain, reconcile;
if it is received/invalid, stop. On success the remaining eleven original steps,
Fish narration and verified PDF/audio delivery continue through the normal path.
The request uses exact size measurements and an 18,000-character JSON target
with six section budgets. The hard author limit is still 25,000 characters and
30,000 UTF-8 bytes; no validator is relaxed or saved prose clipped to claim success.

Read-only offline replay (the checkpoint must be private; fake delivery only):

```
npx tsx scripts/company-targeted-correction-offline-replay.ts /tmp/private-checkpoint.json
```
