# Context attribution and jury access repair

Owner approved development repair on October 4, 2026. No production publish,
credential change, original-task replay, outreach or paid inference testing.

## Outcome and acceptance
- A pending research checkpoint must not become a fabricated user instruction or
  redirect an unrelated jury question. Explicit resumption remains available.
- Model-visible background data has source, source_id, injected_at and trust.
  Record a tenant-scoped turn manifest; existing sessions_history can inspect it.
  Historical turns lacking manifests must not acquire invented historical evidence.
- Default owner aggregation selects a ready zero-marginal lane, retaining the
  intended Opus model when Profundo can serve it. Explicit provider pins remain
  fail-closed; unavailable seats never become successful or shrink quorum.
- Keep deadlines bounded and distinguish timeout from model/credential absence.
  No automatic retries of ambiguous inference or prior tool effects.

## Design gate
1. No new inference calls or retries; one bounded manifest upsert per model round.
   Resume reads/claims occur only for explicit resume/provenance intent.
2. Existing tenant-scoped PostgreSQL checkpoint storage; no local durable state.
3. Manifest write failure is logged; optional resume data is omitted if it cannot
   be recorded. Normal answers remain available. Jury failure degrades explicitly.
4. Turn manifest identity is conversation + persisted user-message id; writes
   upsert that exact identity. Existing research claim lease remains unchanged.
5. No new table, permission or tool. Inspector verifies session ownership first
   and reads only returned message identities, with the existing bounded limit.
6. Existing provider health and cost-policy switches remain authoritative.
   Read-only provenance is available through sessions_history.
7. User controls resumption. Agents cannot promote background data to a user
   instruction, change credential authority, relax quorum or grant paid access.
8. No concurrency/agent/autonomy expansion. Synthetic tests compare current-task
   message identity, unrelated/resume/provenance paths, isolation and lane choice.

## Evidence limits
Catalog success is not inference proof. A stored conversation model is not the
served model. Provider outages cannot be eliminated or promised never to recur.
System provenance identifies assembled prompt segments, not a new independently
verified origin for each fact inside an existing memory/system-prompt bundle.
The incident's non-streaming processMessage path records a bounded union of
prepared blocks; a model-visible JSON frame does not change the cached prefix.
This is assembly evidence, not proof of remote receipt or successful inference.