# Reasoned-review production shadow and canary

The reasoned reviewer is an advisory sidecar at the deliverable ensemble
candidate seam. The existing aggregator/legacy selector remains authoritative
unless every internal-canary gate passes. Delivery verification, grading,
approval, HITL, secret scanning, and delivery-proof gates are unchanged.

## Controls

All controls are off unless explicitly set:

- `REASONED_REVIEW_ENABLED=0` is the immediate global kill switch.
- `REASONED_REVIEW_DISABLED_TENANTS` and
  `REASONED_REVIEW_DISABLED_DELIVERABLES` are immediate scoped kill switches.
- Shadow requires `REASONED_REVIEW_SHADOW_ENABLED=1`,
  `REASONED_REVIEW_SHADOW_TENANTS`, and
  `REASONED_REVIEW_SHADOW_DELIVERABLES`.
- Canary additionally requires `REASONED_REVIEW_CANARY_ENABLED=1`,
  `REASONED_REVIEW_CANARY_TENANTS`, `REASONED_REVIEW_CANARY_DELIVERABLES`,
  and a caller-level `canaryEligible: true`.
- `REASONED_REVIEW_REVIEWER_MODELS` must name exactly the two explicitly priced
  reviewer models `z-ai/glm-5.3-flash,gpt-5-mini`. Unknown or unpriced
  models fail to baseline before any reviewer call. The actual provider-served
  model identities must also be distinct from every candidate generator model.

The adapter caps the candidate set at four, bounds the rubric and candidate
text, applies a per-run estimated-cost ceiling of `$0.05`, and atomically
reserves against a durable per-tenant daily ceiling of `$0.25` before reviewer
work. A canary automatically rolls back for 30 minutes after 10 canary attempts
contain at least 50% baseline fallbacks. The rollback affects selection only;
shadow evidence can continue during the cooldown.

Reservations are leases rather than permanent locks. A worker crash leaves its
reserved cost counted, but a retry may reclaim the same idempotency key after
two minutes only after conservatively reserving another full bounded attempt.
Finalization preserves the cumulative reservation, so a crash after paid
provider work cannot make a retry undercount the tenant's daily spend.
Rollback evaluation and final evidence persistence share the tenant advisory
lock, so concurrent canaries cannot select past the rollback threshold.

## Privacy and evidence

Candidate text is sent only in the bounded reviewer request and remains
ephemeral. Evidence stores tenant/deliverable scope, provenance, hashes,
reviewer independence, aggregate margin, degradation/disagreement, latency,
estimated cost, fallback reason, decision used, and rollback state. It does
not store prompts, candidate text, critiques, raw reviewer errors, or raw
reviewer transcripts. Reviewer failures persist only a bounded classification.
Writes are tenant-scoped and idempotent on `(tenant_id, idempotency_key)`.

## Promotion gate

Wider live selection is intentionally not implemented. An owner-reviewed,
held-out evidence packet must show at least:

- 100 held-out cases;
- quality lift of at least 0.05 over the baseline;
- degraded rate at most 5%;
- reviewer disagreement rate at most 10%;
- canary fallback rate at most 20%; and
- one successful automatic-rollback drill.

Evidence must also show no approval/HITL, privacy, budget, or delivery-safety
regression. Passing the metrics does not enable rollout automatically; a
separate owner-approved change is required.

## Migration rollback

Development migration creates only the new evidence table and its indexes; it
does not backfill or modify existing rows. To roll it back, stop the reviewer
with `REASONED_REVIEW_ENABLED=0`, then run:

```sql
DROP TABLE IF EXISTS reasoned_review_evidence;
```

No deployment or production migration is part of this activation task.