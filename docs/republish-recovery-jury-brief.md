# Republish Recovery and Release Reliability — Jury Brief

**Date:** 2026-09-03  
**Project:** VisionClaw  
**Release target:** Preserve `R125+155.2+sec12`  
**Purpose:** Ask the independent jury for a concrete plan that gets the current release safely republished and prevents the release process from becoming a recurring operational dead end.

## Decision requested

Recommend the smallest safe sequence that:

1. completes the current release validation;
2. gets the application to a republish-ready state;
3. preserves tenant isolation, spend controls, review gates, and the explicit owner approval requirement;
4. makes future whole-repository validation reliable, resumable, observable, and affordable.

The jury must not recommend bypassing a security gate, disabling tenant isolation, inventing production credentials, turning on jury auto-apply, or publishing without explicit owner approval.

## Current verified state

- The application code/build path has passed TypeScript checking and production build.
- The latest full Node suite passed: 245 suites, zero failures; Playwright E2E was intentionally skipped with `RUN_E2E=0`.
- The focused tenant-isolation tests passed previously: 28/28.
- Agent wiring audit passed: 416 tools, 18 personas, zero dead tools, zero persona drift, zero trusted leaks, zero schema gaps, and zero orphan skills.
- The workflow configuration was independently reviewed and passed with no CRITICAL/HIGH/MEDIUM findings.
- The public deployed application is recorded as healthy at `https://agenticcorporation.net`, but the changed code has not been republished.
- Automatic mutation/heavy workflows are frozen. Jury auto-apply and tenant-audit remediation are disabled.
- Publishing/deploying still requires separate explicit owner approval.

## What went wrong

### 1. The whole-repository audit was a fragile single-shot process

The tenant-isolation audit scans 658 relevant server files in 61 large model-review chunks. A prior run stalled around chunk 10/61 and had to be terminated. A per-model-call timeout was added, but a single uninterrupted run was still operationally too long.

### 2. The audit had several unbounded lifecycle paths

The following were found and fixed:

- provider client resolution outside the original deadline;
- precision-triage model calls without a deadline;
- optional jury calls without an outer deadline;
- budget-claim database operations without a deadline;
- owner notification/inbox operations without a deadline;
- unbounded parse-retry configuration;
- a precision-budget denial that could be followed by a false-green result;
- initial budget denial exiting green without a degraded report;
- an environment spelling mismatch that could under-reserve metered calls.

### 3. The cost estimate did not match the enforced free route

With `ALLOW_METERED_LLM=0`, the provider layer routes the first-pass audit to the free Replit/modelfarm lane. The old audit reservation still estimated `$0.50 × 61 = $30.50`, while earlier outstanding reservations consumed most of the daily cap. The audit was denied even though the selected first-pass route was free.

The audit now uses the provider’s shared metered-mode predicate: free-only runs retain the budget guard with the minimum `$0.01` reservation, while metered runs reserve the configured per-chunk estimate.

### 4. The saved report was not sufficient release evidence

Forced-timeout and budget-denial smoke runs overwrote the latest report with degraded partial results. The process now treats those reports as non-green and the full audit must regenerate authoritative artifacts.

## Changes already implemented

- Hard deadlines for first-pass model calls, precision triage, optional jury calls, budget claims, and owner notifications.
- AbortSignal forwarding to first-pass and precision model calls.
- Hard cap of two additional parse retries.
- Degraded exit code 5 for failed/incomplete coverage, budget denial, and precision degradation.
- Explicit finite production-priority wait.
- Source/config/prompt-bound, checksum-verified, contiguous resumable audit checkpoints.
- Atomic checkpoint persistence after each successful chunk.
- Failed chunks are not marked complete or skipped.
- Capped or partial runs cannot exit green.
- Partial planned slices use exit code 7 and automatically resume.
- The live proof completed and checkpointed chunk 1; the next process resumed at chunk 2.
- An automatic eight-chunk resume loop is currently running with metered calls, mutation, jury, and email disabled.

## Current recovery position

At the time this brief was prepared, the resumable loop had verified a 61-chunk source set and was progressing from the saved checkpoint rather than restarting. The most recent inspected checkpoint contained 3/61 completed chunks; the loop was actively processing the next slice.

The current report is intentionally not treated as release evidence until the loop reaches the final authoritative summary:

- all 61 required chunks successful;
- all 658 files covered, including every overlapping window of oversized files;
- zero pending chunks;
- zero unreadable files;
- precision triage complete and non-degraded;
- no unresolved CRITICAL/HIGH findings after the existing approved handling;
- generated report files match that final run.

## Non-negotiable constraints

- Do not publish or deploy without explicit owner approval.
- Do not bypass the autonomous-spend governor.
- Do not substitute development credentials for production credentials.
- Do not enable jury auto-apply or audit remediation during release validation.
- Do not weaken or remove tenant predicates, ownership checks, auth gates, safety profiles, or destructive-tool policy.
- Do not treat a partial, stale, budget-denied, timed-out, or capped audit as clean.
- Keep the application startup group limited to the application; mutation/heavy workflows must remain deliberate, not automatic.
- Preserve release identifier `R125+155.2+sec12` unless the release process itself requires a documented security suffix update.

## Questions for the jury

1. Is the current resumable-slice design sufficient for a safe release gate, or is there a smaller safer change needed before republish?
2. What exact sequence should the operator follow from the current checkpoint to a completed republish-ready state?
3. Which evidence is mandatory before owner approval, and which checks can remain post-publish verification?
4. What should happen when a slice fails, the checkpoint is lost, the budget is denied, the model route changes, or precision triage cannot complete?
5. How should future scheduled audits avoid becoming a single long blocking release dependency?
6. What observability and alerting prove that the audit is making progress rather than silently looping?
7. Is there any remaining risk that a partial, stale, malformed, capped, or configuration-mismatched checkpoint could be mistaken for full coverage?

## Desired jury output

Return:

- a verdict of `FIX`, `ACCEPT`, or `ESCALATE`;
- a prioritized plan for the current recovery;
- a durable future operating model;
- explicit stop conditions and evidence requirements;
- cost and time controls;
- any remaining risks or disagreements;
- a clear statement of whether republish is safe now, safe only after the listed checks, or not safe.

## Jury triage outcome — 2026-09-03

The full brief exceeded the jury wrapper's hard 8 KB request cap, so a compact but complete input was created at `docs/republish-recovery-jury-input.md`.

The compact input was accepted and processed with metered routing and auto-apply disabled. The result was:

- **Verdict:** `ESCALATE`
- **Majority:** 1/3
- **Concordance:** unavailable
- **Latency:** 77,212 ms
- **Queue/code mutation:** none (`--dry-run`, `JURY_AUTOAPPLY=0`)

Seat results:

1. `openference/deepseek-v4-pro` returned `FIX`. Its available rationale said the resumable-slice design is technically sound, but the release is not republish-ready until the full 61-chunk audit completes.
2. `z-ai/glm-5.2` returned an empty response and therefore counted as `ESCALATE`.
3. `claude-sonnet-5` was unavailable because its pinned provider lane requires the owner's metered override and therefore counted as `ESCALATE`.

The aggregator and normal fallback were unavailable; the contradiction resolver also timed out after 45 seconds. The platform correctly refused to convert one substantive vote into a jury consensus.

**Interpretation:** this is not jury approval or rejection. It is an infrastructure-limited escalation. The only defensible shared conclusion is that republishing is not yet authorized because the release audit is incomplete. A valid jury consensus requires either restored free/flat-rate seats or an explicit owner-authorized metered rerun.

At the last checkpoint inspection after this jury run, the resumable release audit had completed 9/61 chunks and had automatically continued to the next bounded slice.

## Owner-authorized paid jury rerun

The owner explicitly authorized one metered jury rerun. It ran with `meteredOverride=true`, `JURY_AUTOAPPLY=0`, and no publishing action. The spend governor reported `$0.50/$20` used for the owner jury allowance.

### Result

- **Formal verdict:** `ESCALATE`
- **Majority:** 1/3
- **Semantic concordance:** 0.825
- **Substantive seats:** 2/3
- **Code/queue mutation:** none

Votes:

1. **DeepSeek V4 Pro — `FIX`.** The resumable design is sound, but the release gate is not met until all 61 chunks, all 658 files, all oversized-file windows, zero unreadables, and non-degraded precision triage are complete. It additionally recommends a deterministic release-readiness assertion, a failure-response runbook, post-publish verification, and moving routine scheduled audits outside the ordinary release path.
2. **Claude Sonnet 5 — `ACCEPT`.** No additional audit-engine code change is required now because the resumable design and fail-closed gates are already implemented and proven. Let the current audit finish and gate publish on its authoritative result. Reopen as `FIX` only if a slice fails, the checkpoint becomes invalid, or final precision/reporting is degraded.
3. **GLM 5.2 — `ESCALATE`.** Provider returned an empty response, so this seat supplied no evidence.

The `FIX`/`ACCEPT` disagreement is about whether to add another release-gate wrapper now, not about whether it is safe to publish immediately. Both substantive jurors agree that the project is **not republish-ready until the complete authoritative audit passes**.

## Consolidated plan

### Current release

1. Keep the bounded resumable audit running from its verified checkpoint.
2. On exit 7, automatically start the next bounded slice.
3. On a real chunk failure, stop; repair that failure; resume from the first absent chunk.
4. If the checkpoint is corrupt, stale, non-contiguous, route/config mismatched, or lost, discard it and restart from chunk 1.
5. Accept the final audit only when it proves:
   - 61/61 required chunks complete;
   - 658/658 relevant files covered;
   - every oversized-file window covered;
   - zero failed and zero pending chunks;
   - zero unreadable files;
   - precision triage completed without degradation;
   - no unresolved release-blocking finding;
   - final Markdown and JSON reports were generated from that completed run.
6. Re-run the production build and the focused release checks after the final report.
7. Present the completed evidence to the owner for the explicit publish action.
8. After publishing, verify production health, changed endpoints, tenant-isolation behavior, agent-wiring drift, and that mutation/metered controls remain in the intended state.

### Future releases

1. Keep model-assisted whole-repository audits resumable and source/config/prompt bound.
2. Use bounded slices with visible `completed/required`, current chunk, elapsed time, last-success time, route, and spend status.
3. Make partial progress a distinct non-green state; never reuse a capped or degraded run as release evidence.
4. Keep ordinary scheduled drift audits independent from the immediate publish action. A release should consume fresh, valid evidence rather than launch an unbounded audit synchronously.
5. Maintain explicit failure handling:
   - slice failure → stop and resume after repair;
   - checkpoint corruption/loss → restart;
   - budget denial → degraded/nonzero, no publish;
   - provider route or evidence configuration change → invalidate checkpoint;
   - precision failure → halt and re-triage.
6. Keep auto-apply, mutation workflows, and publishing as separate authority boundaries.

## Current conclusion

There is a workable path to republish. The project should not be abandoned and the release gate should not be bypassed. The current release becomes republish-ready only after the resumable audit and final verification complete. The current loop is the agreed recovery mechanism.
