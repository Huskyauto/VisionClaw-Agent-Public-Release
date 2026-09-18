# Delegation Supervisor — Tiered Enforcement Model

**Version:** 0.5.1 (REVISED DRAFT)
**Date:** 2026-09-12  
**Original author:** Spark (external CEO/orchestrator layer)  
**Revisions:** v0.2–v0.4 Replit-side architecture and safety review; v0.5 Spark review response corrected through independent authority review; v0.5.1 Spark merge corrections
**Status:** Draft for Bob's approval. Not approved. Not implemented.

## Changelog

- **v0.5.1 (2026-09-12):** Resolves the v0.5 version collision, fixes §7 capitalization, and adds the independent held-out corpus owner/checker staffing decision to §14.
- **v0.5.0 (2026-09-12):** Incorporates Spark's useful v0.5 revisions while correcting authority and lifecycle regressions found in independent review: independently controlled held-out evaluation, traffic-scaled rollout gates, phased implementation, scoped operator grants, fallback readiness, and affirmative no-side-effect evidence.
- **v0.4.0 (2026-09-12):** Adds a verified owner-direct mode that lets Bob bypass Spark and work directly with any agent at any time without bypassing structural security, tenant, spend, side-effect, or audit controls.
- **v0.3.0 (2026-09-12):** Defines trusted cross-tenant principal/scope encoding, reservation lifecycle and crash recovery, and measurable rollout promotion/abort criteria after independent architecture review.
- **v0.2.0 (2026-09-12):** Preserves tiered enforcement while closing authority-capture, bypass, tenant-scope, resource-ownership, budget, partial-side-effect, receipt, recusal, timeout, and policy-versioning gaps.
- **v0.1.0 (2026-09-12):** Initial Spark draft.

---

## 1. Purpose

Convert the R128 delegation contract from main-agent guidance backed by regression tests into verifiable runtime enforcement without placing an LLM in the critical path of every dispatch.

Tiered enforcement keeps low-risk validation deterministic and inexpensive while reserving model or human judgment for work whose ambiguity or consequences justify it.

## 2. Non-negotiable design principles

1. **Every delegation crosses the guarded dispatcher.** Tier 0 may use a compact contract, but no delegation is exempt from the dispatch boundary.
2. **Deterministic where possible; judgment where necessary.**
3. **Missing, malformed, stale, or unsupported contracts fail closed before execution.**
4. **Tool, data, resource, and side-effect permissions are applied by the executor and never trusted from agent output.**
5. **No adaptive component can write, select, weaken, or bypass the policy that judges it.**
6. **Authority is dispersed:** requester, policy owner, validator, executor, reviewer, and final security gate remain separable.
7. **Spark supervises delegation but does not own the enforcement policy or override platform security.**
8. **Safety failures close; advisory quality failures may open; exhausted budgets halt honestly.**
9. **Completed external side effects are reconciled, never blindly retried.**
10. **The verified owner can bypass Spark and work directly with agents at any time.** Owner-direct access bypasses supervisory review, not structural platform protections.

## 3. Authority structure

| Role | Responsibility |
|---|---|
| Main agent | Plans work and requests delegation with a complete contract |
| Guarded dispatcher | Sole dispatch path; validates contract and policy version; resolves final tier; acquires ownership claims |
| Runtime executor | Applies server-owned tool, path, tenant, resource, spend, and side-effect restrictions |
| Spark | Proposes schema/tier improvements; reviews Tier 2; audits Tier 0/1 samples; handles eligible escalations |
| Independent reviewer | Reviews Tier 3 and every delegation where Spark is requester, beneficiary, policy proposer, or otherwise conflicted |
| Server-verified platform owner | May invoke owner-direct mode, approves actions already requiring owner authorization, and adjudicates policy changes or exceptional appeals |
| Authorized operator | Holds owner-delegated authority through server-issued, scoped, expiring grants; may approve only named non-critical Tier 0–2 classes within stated caps; cannot approve Tier 3 or protected surfaces, policy changes, or invoke, inherit, delegate, or replay owner-direct authority |
| Existing security gates | Final authority over tenant isolation, authentication, payments, secrets, destructive actions, production operations, and other protected surfaces |

Spark may **propose** contract-schema and tier-rule changes but may not activate them. Policy changes require a separate owner-controlled or independently reviewed change path with tests, versioning, rollback, and an audit receipt.

A denial is final for that immutable contract attempt. A requester may submit a new contract that addresses the stated reason. Security-gate denials cannot be appealed into approval by Spark, the requester, or the dispatcher.

The verified owner may choose `owner_direct` at any time and communicate or work directly with any agent without Spark participating, approving, observing in real time, or selecting the agent. This is an owner routing right, not a transfer of security-policy authority.

### 3.1 Authorized operator grants

- Operators are named principals. Each grant is server-issued, explicitly scoped to named approval classes with stated caps, expiring, and receipted at issuance, use, expiry, and revocation.
- Operator approvals apply only to named Tier 0–2 matters and never to Tier 3; tenant, payment, secret, destructive, production, or authority-policy surfaces; or any limit increase whose tier-plus-one review requires Tier 3 authority.
- Grants and approvals cannot be delegated, inherited, or replayed. Revocation atomically invalidates every unconsumed approval and prevents new dispatcher grants. A completed action remains historically valid; already-executing work follows normal cancellation or reconciliation rules rather than retaining operator authority.
- Every operator approval is revalidated at dispatcher-grant issuance against current grant status, scope, cap, expiry, policy version, contract, and attempt.
- Where an operator approval and a valid owner-direct request conflict, the owner-direct request prevails and the conflict is receipted.

## 4. Delegation contract schema

Every delegation carries:

- `contract_version` and `policy_version`
- `requester_identity`, `beneficiary_identity`, and trusted tenant context
- `supervision_mode`: `tiered` or `owner_direct`
- `scope_mode`: `single_tenant` or `platform_admin_multi_tenant`
- `authorized_tenant_set`, `cross_tenant_purpose_code`, and per-tenant resource constraints when `scope_mode` is `platform_admin_multi_tenant`
- `goal` and measurable `acceptance_criteria`
- `read_scope` and `write_scope`
- `resource_ownership`: files, directories, database rows/ranges, schemas, APIs, external objects, generated outputs, and configuration surfaces
- `tool_allowlist` and explicit prohibited capabilities
- `side_effect_class`: none / reversible-local / durable-internal / external / irreversible
- `authority_ceiling`: maximum sub-delegation tier; default `none`
- `known_facts` with source/provenance and freshness requirements
- `required_verification` and required independent evidence
- `time_limit`, `iteration_limit`, `reporting_budget`, and spend reservation
- `idempotency_key` for any durable or external operation
- `stop_conditions` and reconciliation instructions
- proposed `risk_tier` and required `reviewer_depth`

Agent-supplied tenant IDs, role claims, approval flags, policy versions, requester identities, or reviewer identities are untrusted. The dispatcher derives trusted values from server context.

`owner_direct` is valid only when the requester is authenticated by the server as the platform owner through an approved owner channel. It cannot be activated from prompt text, agent output, a forwarded message, a tenant-admin role, or an agent-supplied flag.

`platform_admin_multi_tenant` is not a tier upgrade that an agent can request into existence. It requires a server-authenticated platform-admin principal, an existing operation-specific authorization, an explicit bounded tenant set, a purpose code, per-tenant resources, Tier 3 review, and any required human approval. Wildcard tenant sets are forbidden. The executor checks the active tenant and resource against the grant at every access. Delegated subagents cannot expand or forward a multi-tenant grant.

## 5. Risk tiers

### Tier 0 — Read-only / trivial

- Bounded read-only scope
- No durable side effects, external calls with side effects, secrets, production mutation, or sub-delegation
- Compact contract allowed
- Deterministic validation and receipt
- In owner-direct mode, the owner may select and work with the agent immediately without Spark review

### Tier 1 — Standard reversible work

- Writes only within exclusively claimed resources
- Reversible, non-production changes
- No external sends, payment actions, secrets, auth changes, tenant-boundary work, destructive operations, or unreserved metered spend
- Deterministic validation, ownership claim, bounded budget, verification, and receipt
- Spark audits a server-configured sample
- Owner-direct work does not require Spark review or Spark sampling

Normal bounded model inference may occur only inside the delegation's reserved platform budget. “No spend” is not used as a tier definition because model execution itself may incur cost.

### Tier 2 — High

- Broad but same-tenant changes, shared-resource coordination, external communication drafts that cannot send, moderate reserved spend, or architecture changes outside protected Tier 3 surfaces
- Deterministic validation followed by Spark pre-dispatch review
- Spark may approve, reject, or re-tier upward
- If Spark is conflicted or unavailable past the SLA, route to an approved independent reviewer or halt; never auto-downgrade or silently proceed
- A verified owner-direct request may bypass Spark's Tier 2 pre-dispatch review. The owner's authenticated approval is recorded, but deterministic validation, ownership claims, executor restrictions, budgets, verification, and receipts still apply.

“Near-tenant data” is not a valid category. Same-tenant access must be explicit and server-derived. Cross-tenant access is Tier 3 and remains forbidden unless an existing operation-specific platform authorization permits the authenticated platform-admin principal and every target tenant/resource is encoded in the grant.

### Tier 3 — Critical

- Production mutation
- Tenant-boundary access
- Authentication, authorization, secrets, payments, schema migrations, destructive or irreversible actions
- Durable external sends or fulfillment
- Safety-policy, enforcement-policy, evaluator, or authority-boundary changes
- Material autonomous-loop or self-modification changes

Tier 3 requires deterministic validation, an independent reviewer, and every existing domain-specific gate. Spark may provide advisory review but cannot satisfy the independent-review requirement when conflicted.

In owner-direct mode, Spark is omitted. The owner works directly with the selected agent, but Tier 3 independent review and existing human/domain security gates remain in force. If an existing protected action already defines the verified owner as its required human approver, owner-direct mode satisfies only that human-approval role; it does not waive any separate independent, tenant, auth, payment, secret, migration, destructive-action, or production gate.

The requester may propose a tier. Deterministic rules can only keep or raise it. Down-tiering requires a new immutable contract plus approval from a reviewer authorized for the original higher tier; protected rule matches cannot be waived.

## 6. Guarded dispatcher

- All delegation APIs, helper methods, replay paths, retries, scheduled jobs, and internal callers converge on one guarded dispatch capability.
- Direct or legacy dispatch paths reject unless they present a dispatcher-issued execution grant.
- The grant is short-lived, single-use, contract-bound, policy-version-bound, scope-bound, and unforgeable. A single-tenant grant carries exactly one trusted tenant. A multi-tenant grant carries the explicit authorized tenant set, purpose code, and per-tenant resource constraints.
- Policy is server-owned, versioned, integrity-protected, rollback-capable, and unavailable for runtime mutation by the main agent or Spark.
- Contract validation includes strict shape, supported versions, trusted-context binding, tier-floor rules, conflict checks, budget reservation, and reviewer requirements.
- Ownership uses atomic leases/claims, not read-then-write checks.
- Conflicts cover every owned resource, not only files.
- Shared source files, schemas, lockfiles, generated files, configuration, and overlapping database resources cannot have concurrent writers.
- Executor enforcement is rechecked at every tool call and side-effect boundary; menu filtering alone is insufficient.
- Delegations cannot grant themselves tools, tenant scope, reviewer status, increased limits, or sub-delegation authority.
- Owner-direct grants are bound to the verified owner session/channel, selected agent, immutable contract, and attempt. They cannot be delegated, replayed by another identity, converted into standing agent authority, or used to widen future non-owner requests.

## 7. Spark's duties and limits

Spark may:

1. Review Tier 2 contracts before execution.
2. Audit a policy-selected sample of completed Tier 0/1 delegations.
3. Publish evidence-backed policy recommendations.
4. Handle non-conflicted limit, classification, and malformed-contract escalations.
5. Record signed audit decisions with bounded rationale.

Spark may not:

1. Activate or directly edit enforcement policy.
2. Approve its own requests, policies, evaluations, budget increases, or authority expansions.
3. Override deterministic tier floors or existing security gates.
4. Choose the independent reviewer for a delegation where Spark is conflicted.
5. Suppress, delete, or rewrite audit receipts.
6. Block, delay, downgrade, reroute, or require its own approval for a valid owner-direct request.

**Recusal:** Spark recuses when it is requester, beneficiary, policy proposer, evidence producer, evaluator selector, or otherwise materially conflicted. The dispatcher determines recusal from trusted context, not Spark's self-report.

## 7.1 Owner-direct mode

The platform owner can invoke owner-direct mode at any time from a server-verified owner session or approved owner channel.

Owner-direct mode guarantees:

1. The owner chooses the agent and communicates with it directly.
2. Spark is not required to approve, mediate, summarize, reroute, or remain in the interaction loop.
3. Spark unavailability cannot block owner-direct Tier 0–2 work.
4. The owner can stop the direct session and return to tiered supervision at any time.
5. The selected agent receives only the tools, tenant scope, resources, budget, and side-effect authority allowed by the validated contract and existing platform policy.
6. The owner may revise and resubmit a rejected contract but cannot turn a security denial into approval by relabeling the same attempt.
7. Owner-direct activity remains receipted so the owner can inspect what occurred and reconcile uncertain side effects.

Owner-direct mode does **not**:

- disable the guarded dispatcher or executor checks
- create wildcard tenant access
- bypass authentication, tenant isolation, payment, secret, destructive-action, migration, production, idempotency, spend, or side-effect controls
- let an agent impersonate the owner or carry owner authority into another session
- permit Spark or another agent to invoke owner-direct mode on the owner's behalf
- erase the independent-review requirement for Tier 3

## 8. Review ordering

1. Trusted-context derivation
2. Deterministic contract validation and tier-floor resolution
3. Atomic resource and spend reservation
4. Required review: Spark/independent under `tiered`; verified owner approval substitutes only for Spark review under `owner_direct`
5. Existing security and human-approval gates
6. Dispatcher-issued execution grant
7. Executor enforcement at each action boundary
8. Completion verification, settlement, and receipt finalization

No review approval bypasses a later security gate.

## 9. Budgets, limits, and retries

- Every delegation has wall-clock, iteration, output, and spend limits.
- Metered spend is reserved atomically before the call and settled against actual usage afterward.
- Lower requested limits are allowed; higher limits require review at one tier above the delegation, capped at Tier 3/human authority.
- A limit breach prevents new work. Before any side-effect boundary it transitions atomically to `halted_limit_released`; after a side-effect boundary it transitions to `uncertain_completion` or `reconciliation_required`.
- Timeout or disconnect does not imply that an external side effect failed.
- Durable/external actions require idempotency keys, checkpoints, and provider/local receipts.
- Provider success followed by local persistence failure becomes `uncertain_completion` and routes to reconciliation. It is never an ordinary retry.
- Retries reuse the original contract, policy version, execution identity, idempotency key, and settled ownership unless an authorized reviewer approves a new attempt.

### 9.1 Reservation state machine

The dispatcher persists one transactional lifecycle:

`requested → validated → reserved → reviewing → approved → executing → settling → terminal`

Alternative terminal transitions are:

- `validated/reviewing → rejected_released`
- `reserved/reviewing → expired_released`
- `approved → cancelled_pre_execution_released` only before execution begins
- `reserved/reviewing/approved → halted_limit_released` only before a side-effect boundary
- `executing → failed_no_side_effect_released` only with affirmative evidence that no durable side effect occurred: both an authoritative provider terminal non-acceptance result obtained after the provider's defined consistency window and a durable, gap-free executor attestation proving dispatch never crossed the side-effect boundary. Missing, delayed, unavailable, or inconclusive evidence routes to `uncertain_completion`.
- `executing/settling → uncertain_completion` when side-effect finality is unknown
- `executing/settling → reconciliation_required` when evidence conflicts or local persistence fails after provider acceptance

Rules:

1. Resource claims and maximum spend are reserved atomically with the `reserved` transition after deterministic validation and before asynchronous review.
2. Reservations use durable leases with a bounded expiry. Only the dispatcher may renew them, and only while the review/execution heartbeat and immutable contract remain valid.
3. Rejection, pre-execution cancellation, review timeout, unsupported reviewer outage, or lease expiry atomically releases resource claims and unconsumed spend.
4. Execution start is a compare-and-set transition. A late approval cannot revive an expired or released reservation.
5. Spend settlement is idempotent by delegation/attempt/reservation ID. Actual usage is charged once; unused reservation is released once.
6. Resource release is idempotent and cannot release another attempt's claim.
7. A crash-recovery worker scans expired non-terminal reservations. Pre-execution records release safely; executing or side-effect-bearing records enter reconciliation rather than being assumed failed.
8. Renewal, release, settlement, and recovery each append a receipt event.
9. Reviewer latency cannot consume more than the reserved review-window allowance or strand ownership indefinitely.
10. The terminal transition, release of resource claims/unconsumed spend, and terminal receipt event are one atomic persistence operation for every `_released` state.

## 10. Audit receipts

Receipts are append-only and tenant-scoped. A `dispatch_intent` receipt is durably recorded before execution; later events append state transitions.

Required fields:

- receipt version and event timestamp
- delegation ID, attempt ID, idempotency key, and contract hash
- trusted requester, beneficiary, tenant, and reviewer identities
- scope mode; authorized tenant set and purpose code for multi-tenant operations
- supervision mode (`tiered` or `owner_direct`)
- for `owner_direct`: trusted owner-principal reference, authentication/channel assurance reference, bound owner session, selected agent, attempt, and the decision that verified owner approval substituted for Spark review
- proposed/final tier, policy version, decision, and bounded rationale code/reference
- resource claims, tool grant, authority ceiling, and reserved limits
- review and security-gate outcomes
- execution state and side-effect evidence
- verification result, spend settlement, and final status

Valid terminal states include:

- `completed_verified`
- `rejected_released`
- `expired_released`
- `cancelled_pre_execution_released`
- `halted_limit_released`
- `failed_no_side_effect_released`
- `uncertain_completion`
- `reconciliation_required`

This enum is canonical for reservation persistence, recovery workers, terminal checks, and receipt validation. `_released` means the terminal state, release of all releasable claims/unconsumed spend, and terminal receipt were committed atomically. `uncertain_completion` and `reconciliation_required` intentionally retain only the claims/reservations required for bounded reconciliation under server policy.

Receipt content must be redacted before persistence. Authentication assurance is recorded as a bounded server-owned reference and assurance level, never as credentials, cookies, tokens, raw session identifiers, or secrets. Secrets, raw credentials, unrestricted prompts, and unnecessary customer data never enter the receipt. Hash chaining provides tamper evidence but does not replace access control, durable storage, backups, or independent verification.

Retention, summary compaction, and sampling are server policy. Critical receipts and unresolved uncertain-completion records cannot be sampled away or compacted before resolution and the required retention period.

## 11. Availability and fallback

- Tier 0/1 do not depend on Spark availability.
- Owner-direct Tier 0–2 never depends on Spark availability.
- Tier 2 Spark review is asynchronous with a server-owned SLA.
- Spark timeout routes to a preapproved independent reviewer when available; otherwise the delegation halts.
- Tier 3 never falls back to a lower review depth.
- Reviewer/provider outage cannot be converted into approval.
- Kill switches can stop new dispatches by tier, tenant, tool, or side-effect class without Spark's consent.
- A Spark-specific kill switch or outage cannot disable owner-direct access. Platform emergency safety kill switches may still halt affected tools or side-effect classes for every requester, including the owner, and must provide a clear reason and recovery path.

## 12. Acceptance criteria

- [ ] Every dispatch path, including retries, replay, schedules, and internal helpers, requires a dispatcher-issued grant.
- [ ] Direct/legacy dispatch attempts without a valid grant are rejected.
- [ ] Missing, malformed, stale-version, cross-tenant-mismatched, or unsupported contracts fail closed before execution.
- [ ] Agent-forged tenant, role, approval, policy, or reviewer fields are ignored and rejected where relevant.
- [ ] Atomic ownership prevents concurrent overlap across files, database resources, APIs, external objects, schemas, generated outputs, lockfiles, and configuration.
- [ ] Tier 2 cannot start without a valid non-conflicted review.
- [ ] Tier 3 requires independent concurrence plus all applicable security/human gates.
- [ ] Spark recusal is derived and enforced by the dispatcher.
- [ ] A server-verified owner can select any agent and execute Tier 0–2 work without Spark approval, mediation, routing, or availability.
- [ ] Tier 3 owner-direct work omits Spark but retains independent review and every applicable protected-action gate.
- [ ] Prompt text, tenant admins, agents, forwarded messages, and untrusted flags cannot activate owner-direct mode.
- [ ] Authorized operators cannot invoke, inherit, delegate, or replay owner-direct authority unless they are independently authenticated as the platform owner.
- [ ] Owner-direct authority is session/attempt-bound, non-delegable, non-replayable, and cannot become standing agent authority.
- [ ] Spark cannot block or reroute a valid owner-direct request.
- [ ] Owner-direct activity remains contract-bound, executor-restricted, budgeted, verified, and receipted.
- [ ] Owner-direct receipts independently prove the trusted owner principal, assurance reference, bound session/agent/attempt, and Spark-review substitution without storing credentials or raw session secrets.
- [ ] Spark cannot activate policy changes or review its own authority/budget expansion.
- [ ] Executor restrictions remain effective even when agent output requests broader access.
- [ ] Spend is reserved before metered work and settled afterward.
- [ ] Limit breaches prevent new work and emit a durable state transition.
- [ ] Rejection, expiry, pre-execution cancellation, limit halt, and proven no-side-effect failure use the exact canonical `_released` terminal states and atomically persist release plus receipt.
- [ ] External-side-effect crash windows produce reconciliation rather than duplicate execution.
- [ ] Receipts are tenant-scoped, redacted, append-only, complete, tamper-evident, and durable.
- [ ] Spark/reviewer outages never lower the required tier or produce implicit approval.
- [ ] Policy rollback and kill switches work without cooperation from Spark or the delegated agent.
- [ ] Held-out adversarial tests cover tier gaming, grant replay, identity forgery, overlapping ownership, receipt tampering, direct dispatch, reviewer conflict, and partial external completion.
- [ ] The held-out corpus owner and checker are independent of implementation, enforcement-policy authorship, reviewer selection, Spark's Tier 2 review role, and every evaluated agent. Spark may contribute only disclosed non-held-out cases. The corpus and scoring rubric are versioned, access-controlled, and receipted; implementers and evaluated agents cannot see held-out cases or labels before evaluation.

## 13. Implementation sequence

Implementation proceeds in phases so the deterministic core delivers value before the heavier review machinery while preserving mandatory spend controls:

- **Phase 1 — deterministic core (steps 1–6):** dispatch inventory, contract schema and tier floors, receipt persistence, atomic resource claims, idempotency, spend reservation/settlement, guarded dispatcher in report-only mode, then Tier 0/1 enforcement. If spend reservation is not ready, enforcement is limited to delegations structurally incapable of metered calls.
- **Phase 2 — lifecycle and review (steps 7–8):** complete reservation expiry/recovery and crash reconciliation; connect Tier 2 Spark review with a tested fallback reviewer; add Tier 3 independent review.
- **Phase 3 — hardening and rollout (steps 9–10):** independently controlled held-out evaluations, bounded tenant/tier rollout, kill switches, and tested rollback.

1. Inventory every current dispatch, replay, retry, scheduler, and internal execution path.
2. Define the strict versioned contract and deterministic tier-floor rules.
3. Build receipt persistence, atomic resource claims, idempotency, and spend reservation first.
4. Introduce the guarded dispatcher in report-only mode and measure false classifications.
5. Add executor-side grant enforcement and adversarial tests.
6. Enforce Tier 0/1 after parity is proven.
7. Connect Spark asynchronously for Tier 2 with recusal and timeout routing.
8. Add Tier 3 independent review while retaining all existing domain gates.
9. Run held-out safety, tenant, cost, crash-window, and bypass evaluations.
10. Enable by bounded tenant/tier rollout with kill switches and rollback.

### 13.1 Rollout promotion gates

Defaults below are proposals and require owner approval before rollout. Promotion requires **all** conditions:

1. Dispatch-path inventory demonstrates 100% of known dispatch, retry, replay, scheduler, and internal-helper paths either use the dispatcher or are structurally unable to execute.
2. Report-only mode runs for at least 14 consecutive days and observes at least 200 representative dispatches across every enabled tier/path class, scaled to actual traffic. If production traffic yields fewer, synthetic fixtures make up the remainder, cover every low-volume protected class, and the owner approves the adjusted count before promotion. Classification/advisory findings never block a structurally valid, server-verified owner-direct request during report-only mode; authentication, grant integrity, tenant, budget, and existing security gates enforce from day one.
3. Zero accepted malformed contracts, forged identities, unauthorized tenant scopes, protected-surface under-tier classifications, direct-dispatch bypasses, missing pre-execution receipts, duplicate side effects, or leaked reservations.
4. Deterministic classification disagreement against the approved labeled corpus is at most 2%, with zero downward errors on protected Tier 3 cases.
5. Reservation recovery drills show zero stranded claims/spend and idempotent settlement after rejection, timeout, process crash, and late reviewer response.
6. Deterministic dispatcher availability is at least 99.9% during the observation window, excluding planned maintenance.
7. Added p95 latency for Tier 0/1 deterministic validation is at most 50 ms, measured at the dispatcher boundary inclusive of lease acquisition and receipt persistence. Report-only measurement must demonstrate this budget is realistic before it becomes a promotion requirement.
8. Independent review confirms the enabled policy version and held-out adversarial corpus pass.
9. The Tier 2 fallback independent reviewer is provisioned, tested, and has a defined SLA before Tier 2 enforcement is enabled. If the fallback is absent or unavailable at runtime, the delegation halts; required review never fails open.

Immediate abort/rollback triggers:

- any tenant mismatch or unauthorized cross-tenant access
- any direct-dispatch bypass
- any protected action executed below its tier floor
- any duplicate or unreceipted durable side effect
- any missing or forgeable execution grant
- any reservation leak, double settlement, or spend above the hard ceiling
- any ability for Spark, requester, or worker to activate its own policy/authority expansion
- any non-owner activation, replay, delegation, or persistence of owner-direct authority

Rollback stops issuing new grants for the affected tier/tenant/tool immediately. Pre-execution grants are revoked and reservations released. In-flight work that has crossed a side-effect boundary is not blindly killed or retried; it is checkpointed, allowed only the minimum safe finalization needed, or moved to `uncertain_completion`/`reconciliation_required`. Rollback behavior itself is tested before enforcement.

## 14. Decisions still requiring owner approval

1. Exact deterministic tier-floor matrix.
2. Spark Tier 2 SLA and the approved independent fallback.
3. Initial audit sampling rate and retention periods.
4. Reviewer implementation and independence requirements.
5. Resource-claim granularity for database and external objects.
6. Initial report-only duration and rollout cohort.
7. Human approval requirements above existing protected actions.
8. Owner approval or revision of the proposed rollout thresholds in §13.1.
9. Approved owner-authentication channels and session re-verification interval for owner-direct mode.
10. Who serves as the independent held-out corpus owner/checker; this role must satisfy the independence requirements in §12.

---

## Review verdict (v0.5.1)

**Direction approved; proceed to implementation planning only after the owner decisions in §14.** Spark's v0.5 review supplied useful operator-grant, rollout, sequencing, fallback, evaluation-independence, and side-effect-evidence improvements. Independent review rejected the uploaded draft's unsafe details and they are corrected here. The architecture keeps routine dispatch deterministic, preserves the owner's direct access to every agent, and retains independent enforcement at protected boundaries.

Remaining before implementation:

1. Owner decisions in §14, especially the tier-floor matrix, Spark Tier 2 SLA, fallback reviewer, and owner-authentication channels.
2. Independent control of the held-out corpus and checker.
3. Confirmation of the phased implementation scope.

Runtime behavior remains **UNVERIFIABLE** until implemented and adversarially tested.