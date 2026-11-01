# Google AX assessment

Reviewed October 28, 2026. Verdict: retain as an execution-infrastructure reference; do not install or replace native orchestration.

## Primary sources

- https://github.com/google/ax
- https://github.com/google/ax/blob/main/README.md
- https://github.com/google/ax/blob/main/SECURITY.md
- https://github.com/google/ax/blob/main/DESIGN.md
- https://github.com/google/ax/blob/main/docs/concepts.md
- https://github.com/google/ax/blob/main/docs/roadmap.md

These are mutable main-branch documents; findings are as of the review date.

## Observed versus promotional claims

- AX is in Google's public repository and uses Apache-2.0 licensing. Its README explicitly warns of heavy development and likely major breaking changes.
- The reviewed README says **millions** of tasks per cluster, not the screenshot's billions. This is a design/positioning statement, not a verified throughput result. No scale benchmark was established in this review.
- AX uses Task, Workspace, and Model resources. Workspace setup includes Git, MCP, and skills; tasks support sandboxing, CPU/memory limits, debug shell access, and suspend/resume through Agent Substrate.
- Current installation requires Kubernetes with Agent Substrate, container images/registry, Go and kubectl. The documented deployment also provisions PostgreSQL. This is not a small TypeScript dependency for the current VM.
- Current DESIGN describes PostgreSQL-backed resource state and distributed leases, with actor-owned state fetched from Substrate rather than duplicated in AX.
- Current SECURITY explicitly says the AX API has no authentication or authorization, anyone with access can manipulate resources, atespaces are not a tenant boundary, and debug services allow arbitrary commands/file access inside the sandbox.
- Budget guardrails, governance, automatic idle suspension and other improvements appear in the roadmap. Their listing is not proof of implemented hard dollar limits.
- The screenshot is stale against main: its plural workspace binding and workspace goal differ from the current README, and `ax watch` has been replaced there with `ax describe`.
- Suspend/resume is documented, but checkpointing cannot by itself undo an external payment, email, or model request. Exactly-once external effects still require application-level evidence and idempotency.

## Native comparison and cross-case review

Inspected native execution supervision, process governance, orchestration ledger and bounded verifier worker surfaces. This is a limited source-level comparison, not a comprehensive security audit.

| Case | Existing native observation | AX implication |
|---|---|---|
| Repeated failing tool calls | Execution supervisor tracks failures and blocks repeated identical failures | Avoid replacing useful native behavior with infrastructure lifecycle alone |
| Tenant spend governance | Process governor evaluates tenant-scoped daily spend and proactive budgets | Monitoring is not proof of a universally enforced spend ceiling; AX sandbox CPU limits are not API-dollar caps either |
| Process restart | Orchestration ledger includes restart-resume state | Semantic job recovery overlaps, but is not equivalent to freezing an arbitrary process |
| Worker completion after lost authority | Bounded verifier worker uses heartbeat, claim ownership and fenced completion | Preserve fencing even if execution is moved to an external sandbox |
| Untrusted code | Process/resource controls inspected here do not establish a hardened OS sandbox | Isolated external execution is the most relevant potential addition; requires a separate security and cost trial |
| Cross-customer access | AX SECURITY explicitly disclaims atespace tenant isolation | Never substitute atespaces for native authorization |
| Email/payment during suspension | No execution freeze can retract a completed remote effect | Retain authoritative receipts, idempotency and uncertain-outcome handling |

## Bounded candidate

HYPOTHESIS: An externally isolated disposable worker could reduce exposure from untrusted code without breaking native authority, recovery, or operating budgets.

BASELINE: Current bounded worker and native authorization/receipts, not a deliberately unguarded subprocess.

TEST: Only when untrusted execution is a demonstrated need, compare in a separate restricted environment using synthetic fixtures and no owner secrets. Include filesystem and credential escape attempts, cross-tenant requests, CPU/memory exhaustion, network egress, crash/lease loss, and suspension during a mocked remote side effect. Measure isolation, duplicate effects, completion, total memory, latency and total operating cost.

DISPROOF/STOP: Any authority leak, stale-worker completion, duplicated consequential effect, unsupported recovery semantics, or cost exceeding the benefit. Do not expose the unauthenticated AX API publicly.

VALIDATION STATUS: Untested native adaptation. No cluster was provisioned, no executable AX benchmark ran, no dependencies or runtime code changed, and no performance or security improvement is claimed. Cross-case analysis above is source-level evidence only.

REVISIT: A real requirement for many isolated untrusted workers, a supported external hosting budget, and verified AX authentication/isolation maturity.
