# Fable 5.2 owner escalation

## Scope and design gate

Owner-approved on November 11, 2026: add an explicit high-end model option, not
an automatic routing promotion. Keep existing free/subscription routes. Choose
model capability by complexity, reasoning, scope and risk; use ordinary tools
without an LLM where sufficient, Haiku-class for bounded repetitive work,
Sonnet-class for routine implementation, and deliberate Fable escalation for
hard reasoning or failed verification. This does not select Replit Agent's model.

1. **Cost:** $8/M input, $40/M output; 1M context, 128,000 output maximum.
   Reserve a conservative request maximum before dispatch against the existing
   $30 shared UTC-day paid-AI budget. No automatic paid retries.
2. **State:** existing Postgres budget reservations and cost ledger only.
3. **Failures:** authorization, malformed input, missing usage, ledger failure
   and failed settlement fail closed. Ambiguous dispatch retains its hold and
   disables reuse of that client; no automatic replay.
4. **Identity:** a server-created attempt UUID per dispatch; reused budget
   attempts cannot be reserved twice. No automatic retry after uncertain work.
5. **Tenant:** explicit platform-admin selection in the owner tenant only;
   reject generic metered/cost-exempt and pinned alternate-provider grants.
   Existing request rate limits and tool policies are unchanged.
6. **Stop/observe:** select another model or set `FABLE_52_DISABLED=1`;
   metered-deny options and the shared budget still stop dispatch. Ledger and
   reservation rows retain actual usage and unresolved holds.
7. **Authority:** owner selects; Felix/Replit assess suggestions; ordinary
   guarded tools execute; budgets and authorization are not model-editable.
8. **Delta:** offline comparisons pin denied access, exact identity, unchanged
   default tiers, request compatibility, reserve-before-dispatch, no retry and
   durable usage requirements. No claim of improved quality without live evals.

## Compatibility and privacy

Use Anthropic's official OpenAI-compatible endpoint. Omit unsupported sampling
and thinking overrides; adaptive thinking is always on. Reject forced tool use
rather than weakening its semantics. The compatibility endpoint does not expose
effort control or prompt caching; do not claim either was enabled.

Fable 5.2 requires 30-day provider retention and is not a zero-retention lane.
This owner-only option is not permission to forward sensitive customer data.

Sources retrieved November 11, 2026:
- https://platform.claude.com/docs/en/models/fable-5-2/overview
- https://platform.claude.com/docs/en/api/openai-sdk

## Verification boundary

Local evidence: 58 focused offline checks passed, covering registry/pricing,
real provider admission and closed facade, malformed request bounds, mandatory
ledger failures, reserve/settle ordering, no-replay policy, existing 5.1/Astra
compatibility, aggregate budget concurrency and legal-page processor coverage.
Full TypeScript and release-check build passed; existing build warnings remain.
Persona synchronization and the wiring audit passed for all 18 development personas.

Offline verification does not establish account entitlement, live inference,
provider quality, published availability or production adoption. No paid probe
or publication is part of this change.

## Subsequent owner-authorized live acceptance attempt

On November 11, 2026 (owner timezone), the owner requested a real system
review. One streaming review of two non-sensitive transport modules was
attempted through `getClientForModel` with explicit owner flags and tenant
context, no tools, no automatic retry, an 8,192-token output bound and a
60-cent maximum reservation. The attempt failed before releasing a review.
Database readback confirmed the reservation remains held with no actual usage
settlement and no Fable 5.2 cost-ledger entry. A held reservation is not proof
of a provider charge or of no provider-side processing.

A subsequent **non-inference** authenticated model lookup returned HTTP 200
and exact ID `claude-fable-5-2`: configured account authentication and model
discovery work. This does not establish successful inference. The completion
failure's exact upstream cause was not retained; the 60-second request deadline
is a hypothesis, not a confirmed diagnosis. No second inference request or
publication was performed. Full live acceptance therefore remains incomplete.

## Explicitly authorized longer review — completed

The owner then approved one more bounded review. A per-request **exact
180,000 ms** option is now honored by both the Fable wrapper's abort deadline
and its mandatory-ledger SDK call. Default calls remain at 60,000 ms;
arbitrary larger overrides still receive that default. No retries, automatic
routes, customer access, permissions or production settings changed.

The second workspace request completed in about 81 seconds end-to-end,
including local admission/readback. The returned model ID was
`claude-fable-5-2`; the stream ended with `stop` and returned a substantive
read-only review of the two source modules. Observed usage was 4,814 input
and 7,450 output tokens. Database readback independently confirmed:

- one matching streaming usage-ledger entry for **$0.336512**;
- the new **58-cent** reservation settled to **34 cents** (whole-cent
  conservative budget accounting, not a second charge);
- the first request's **60-cent uncertain hold** remains untouched.

The evidence and source hashes are retained in the private workspace diagnostic
record `.local/fable52-long-review-result.json`. No further inference was sent.

### Review findings and implementation judgment

The review is advisory. It cannot certify the whole system or unshown callers.

1. **MEDIUM integration limitation, not the reviewer's claimed HIGH on the
   tested path:** normal web-chat creation still has a 65-second outer bound.
   It does not currently request the new 180-second diagnostic option. The
   successful diagnostic called the guarded provider directly and had no such
   outer timer. Exposing a long-review option in web chat would require
   coordinating those deadlines; this test is not evidence that web chat
   supports 180 seconds. Database-reservation latency also consumes part of
   the normal outer allowance.
2. **MEDIUM confirmed conservative-capacity gap:** an access change or abort
   after reservation but provably before `create` still retains the hold and
   latches that client. This prevents overspend but can consume daily capacity
   without an inference call. Safe cleanup should distinguish proven
   pre-dispatch cancellation from ambiguous dispatched work. Generic 400/401
   errors alone must not be treated as proof of no provider charge.
3. **LOW conditional shared-helper gap:** an uncooperative transport can
   fulfill after the outer timeout, with no explicit cleanup of a late live
   stream. The Fable wrapper drains and accounts before returning, so the
   review did not demonstrate an unaccounted Fable stream. Broader transport
   cleanup needs targeted tests rather than blind adoption of the suggested
   generic `abort() ?? return()` expression.

These findings are recorded, not silently fixed or declared cleared.
The review confirmed the displayed reservation arithmetic did not expose an
overspend path. This live result proves the owner-only workspace provider,
streaming usage persistence and settlement path for this one request, not
production/UI acceptance or general model quality. The original failure's
exact cause remains unproven.

## Complex audit-recovery consultation — no usable answer

The owner next requested advice on a difficult unresolved code issue. The
selected issue was the tenant-isolation audit's source-current resumable
completion: the inspected checkpoint retained 72 of 327 chunks, the most
recent degraded report had 64 complete / 263 pending at an earlier timestamp,
and the workflow tail ended at its controller deadline.

One read-only request supplied line-numbered source excerpts, controller and
checkpoint code, operating constraints and aggregate failure evidence, without
customer records or credentials. Admission reserved 162 cents under a disclosed
$2 maximum. The returned model was `claude-fable-5-2`, but it finished with
`length`, 26,253 input / 14,000 completion tokens and **no visible answer**.
The persisted usage cost was $0.770024; the reservation settled to 78 cents.
End-to-end runtime was about 154 seconds. This is a paid, accounted request,
not a successful consultation or a proposed solution.

There was no automatic retry, audit rerun, application change or publication.
The retained diagnostic record is
`.local/fable52-complex-audit-review-result.json`. Any further consultation
should reduce the evidence packet to one specific checkpoint/restart question
and explicitly consider output/deadline capacity; no reviewer finding or
implementation recommendation can be attributed to this empty response.
