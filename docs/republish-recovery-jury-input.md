# Republish Recovery — Jury Input

**Date:** 2026-09-03. **Release:** preserve `R125+155.2+sec12`.

## Decision requested

Give a concrete plan to complete this release safely now and make future releases repeatable. The jury must say whether the project is safe to republish now, safe only after listed evidence, or not safe.

Do not recommend disabling tenant isolation, bypassing the autonomous-spend governor, inventing production credentials, enabling jury auto-apply, weakening safety/auth checks, or publishing without explicit owner approval.

## Verified state

- TypeScript, production build, full Node suite (245 suites, zero failures), focused tenant tests (28/28), and agent-wiring audit (416 tools, 18 personas, zero drift/leaks/schema gaps) passed.
- Workflow configuration review passed with no CRITICAL/HIGH/MEDIUM findings.
- The deployed app is recorded healthy at `https://agenticcorporation.net`; changed code has not been republished.
- Mutation/heavy workflows, tenant-audit remediation, jury auto-apply, and metered calls are disabled.
- Publishing requires separate explicit owner approval.

## Release blocker history

The tenant-isolation audit covers 658 server files in 61 large model-review chunks. A prior single-shot run stalled around chunk 10/61. A timeout fix closed unbounded model, client-resolution, precision, jury, budget-claim, notification, retry, and production-wait paths. Budget denial now writes a degraded report and exits nonzero. A stale `$30.50` whole-run reservation was corrected to a guarded `$0.01` reservation for the provider-enforced free route; metered mode still reserves per-chunk cost using the provider’s shared predicate.

The audit is now resumable: each successful chunk is atomically checkpointed; checkpoints are source/model/prompt/config bound, checksummed, canonical contiguous prefixes; malformed, stale, non-contiguous, wrong-file, capped, failed, or partial state cannot exit green. Planned partial slices exit 7 and resume. Full coverage requires all 61 chunks, all 658 files, every oversized-file window, no unreadables, and non-degraded precision triage.

Live proof: chunk 1 was checkpointed and the next run resumed at chunk 2. An automatic eight-chunk dry-run loop is currently advancing from that checkpoint; its current report remains non-authoritative until final completion.

## Current questions

1. Is the resumable-slice design sufficient for a safe release gate?
2. What exact operator sequence completes the current audit and establishes republish readiness?
3. Which evidence must precede owner approval, and what belongs in post-publish verification?
4. What are the correct responses to slice failure, checkpoint loss/corruption, budget denial, route change, or precision failure?
5. How should scheduled audits avoid becoming a single long release dependency?
6. What progress, timeout, cost, and stop metrics should be required?
7. Is any partial, stale, malformed, capped, or configuration-mismatched state still capable of being mistaken for full coverage?

## Required output

Return `FIX`, `ACCEPT`, or `ESCALATE`, followed by:

- a prioritized plan for completing this release;
- a durable future release/audit operating model;
- explicit evidence and stop conditions;
- cost and time controls;
- remaining risks and disagreements;
- a direct republish-safe/not-safe conclusion.
