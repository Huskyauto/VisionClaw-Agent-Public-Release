# Verifier memory authority and recovery strategy

## Goal and constraints

Restore safe proposal verification where Linux exposes enforced memory accounting, and explain why admission remains deferred elsewhere. Do not infer a deployment limit from host RAM, Node's constrained-memory estimate, a caller value, or a configured heap size. Publication remains a separate owner decision.

## Design gate

1. **Cost:** no model/provider calls. Read only bounded kernel metadata and memory counters; cap mount records and process ancestry. The admin diagnostic is rate-limited and does not launch work.
2. **State:** readers are stateless. Existing PostgreSQL job leases and fenced capacity deferrals remain authoritative; diagnostic reads cannot update jobs.
3. **Failure:** missing, malformed, ambiguous, unreadable or incomplete memory authority fails closed. Return fixed diagnostic labels, never raw kernel paths or exception text.
4. **Idempotency:** GET is observation only. Existing queue claim/lease/attempt fences continue unchanged.
5. **Tenant/limits:** diagnostic requires the authenticated owner/admin tenant and current admin role. No request-supplied paths or limits. Use no-store responses and bounded authorized request rate.
6. **Stop/observation:** owner controls publishing and can revert the change. Existing parent-RSS, memory-reserve, child timeout and in-flight memory checks remain enabled. Diagnostic identifies the selected enforced source or a fixed deferral reason.
7. **Authority:** the kernel supplies memory limits/usage; code validates them; the independent reviewer checks the boundary; the owner approves publication. Agents cannot approve their own limits or change the safety policy through this endpoint.
8. **Capability delta:** only a previously unsupported, demonstrably bounded controller can enable existing verification. No larger heap, additional concurrency, relaxed reserve, new model access or tenant authority. Tests must prove malformed and incomplete data still refuses execution.

## Implementation and acceptance

- Resolve cgroup mounts and the current process membership from kernel metadata, not a guessed fixed path.
- Preserve the effective v2 limit and tightest ancestor headroom.
- Refuse subtree bind mounts that hide parent accounting. Even v1's effective-limit statistic cannot prove hidden-parent headroom or reveal sibling usage.
- Support v1 only with finite limits, hierarchical accounting, readable aggregate usage, and evidence that hidden tighter ancestor limits are not being omitted.
- Retain strict deferral where no complete authority can be established; missing v2 alone is not evidence that a hypothetical v1 fallback works.
- Add an owner-only read-only diagnostic and an existing admin UI view. Return only controller classifications and aggregate memory numbers.
- Test denied callers before any probe, sanitized failures, bounded reads, legitimate finite sources, tighter parents and ambiguous/malformed layouts.
- The production reader caps actual filesystem reads before allocation (256 KiB, with overflow detection and descriptor cleanup). Per-controller ancestry, read-count and aggregate-byte budgets further constrain probes. Missing mounts are checked against process memberships before an alternate controller can be selected.
- Owner-admin authorization follows the existing trusted owner/session helper, not request headers or API-key tenancy. Diagnostic availability is not a queue-completion receipt.

## Production rollout and unresolved case

Current production evidence proves the expected v2 mount is absent and one conventional v1 filename is missing; it does not identify every v1 mount. Development tests are not proof of production support.

After a separately approved publish, inspect the admin diagnostic first. If an enforced source is available, verify a tenant-scoped queued proposal, its persisted outcome and continuing web health. Do not manually mark a proposal verified or force the queue past admission.

If production exposes no complete finite accounting source, keep jobs deferred. The next strategy is a verifier isolated behind its own independently enforced resource boundary, or a platform-supported accounting interface—not a host-free-RAM fallback or an arbitrary memory-limit setting.