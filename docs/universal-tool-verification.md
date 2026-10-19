# Tool-output verification

Every completed tool dispatch now receives a bounded deterministic postflight.
This includes custom and future tool names: there is no name allowlist that can
silently omit a new tool. Early authorization/refusal gates remain unchanged.

## Read the receipt

Plain-object results carry server-owned `_outputVerification`:
- `failed`: invalid/contradictory/error output or failed artifact contract.
- `pending`: queued/running work or uncertain completion, not a finished product.
- `unverified`: baseline structure was inspected but outcome proof is missing,
  incomplete, over budget or unavailable.
- `checked`: only the stated `artifact_contract` passed—not universal correctness.

`independentOutcomeVerified:false` is intentional. A success flag, URL, ID,
producer page count or cloud link never proves the entire customer request.
`retryOriginalAction:false` means reconcile an existing action before repeating
a send, append, upload, payment or other consequential operation.

Arrays, primitive values and non-plain objects keep their original shapes.
Their observations are available to diagnostics subscribers and aggregate
counters; current JSON clients do not gain an invented wrapper/receipt.

## Stronger checks

- **Generated artifacts:** the 25 registry-marked product tools have an adapter.
  For an owner invocation it requires a durable intent committed in the SAME
  operation, matching tenant/name/hash, plus a valid local file within approved
  roots. It reads a bounded immutable snapshot, compares SHA-256 to that intent,
  and invokes the existing format contract and tenant-scoped audit.
- Paths, artifact IDs and hashes supplied in a tool result do not establish
  this authority. Concurrent operations and ambiguous revisions cannot share
  a proof. Customers' local paths are not probed by this generic owner adapter.
- **write_file:** exact UTF-8 bytes are read back before optional Drive upload.
  Appends verify the appended region, not old file contents. Read-back failure
  stops further side effects and reports uncertainty.
- **Final delivery:** the existing mandatory delivery verifier and downloaded
  Drive byte/size checks remain authoritative. They are not replaced.
- **Legacy product hints:** `_productVerification` no longer labels mere
  metadata/presence checking `PASSED`; it says `BASIC_CHECKS_ONLY`.
- **Automatic convenience delivery:** instant-play requires checked postflight
  AND the actual inspected snapshot; its publisher writes those bytes instead
  of reopening either result-path alias or a symlink. Local artifact checks do
  not prove remote delivery. Both normal/retry legacy URL-only auto-email
  shortcuts are therefore held; the canonical delivery pipeline remains the
  owner of verified ready emails. This can hold older convenience flows without
  evidence; do not weaken the checks to re-enable them. Their primary provider
  action may already have happened. A result-provided cloud URL is not certified.

## Coverage and limits

Run `npx tsx scripts/tool-verification-coverage.ts --write` for the source-derived
catalog in `docs/tool-verification-coverage.json`. It inventories all 427 tools,
baseline coverage and additional evidence requirements. It is NOT a list of
427 live-provider certifications or 427 bespoke semantic validators.

No new model/provider calls, retries, tables, permissions or public endpoints.
Structure inspection visits at most 256 nodes/depth 6. Artifact snapshots are
limited to 10 MB, reuse the 80-page/10-second PDF worker, and have a 12-second
outer wait. The wait is not an OS deadline for arbitrary synchronous filesystem
operations. Busy, larger, cloud-only or unbound artifacts remain unverified.

Known remaining work is deliberately explicit in the catalog: per-action
provider read-back for external mutations, tenant-scoped persisted-state
read-back for other writes, source/factual QA, visual/media decoding and
customer-request acceptance coverage. No universal correctness percentage is
claimed. Existing source, visual, media, grade and delivery-proof checks remain
necessary.
