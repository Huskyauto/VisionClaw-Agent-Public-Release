# Company-package operating sequence and completion evidence

## Scope

This describes the existing owner-only version-3 path, not the older
initial-jury/compiler/final-jury workflow. A queue handler returning successfully
does not mean a company package is complete. The package's terminal business
state and its verified artifacts are authoritative.

## Sequence

| Step | Operation and completion condition | Durable/recovery boundary |
|---|---|---|
| 1 | Admit company name, website or business-domain email, optional context and explicit spending/correction choices. | Owner authentication, request identity and existing package limits. Email is not sent to the author models or automatically contacted. |
| 2 | Discover and process public website evidence in resumable batches. | Retain the research map, successful captures, failed-page disclosures and progress. Bounded reads and browser coordination apply. Finished processing is not perfect coverage. |
| 3 | Project evidence and build a typed, content-bound catalog. | Retain full research; disclose model projection limits. Exact source excerpts and research limitations have distinct identities. |
| 4 | Dispatch nine independent authors, three per category. | Claim and checkpoint before reserving spend; retain the response before acceptance. Model identities stay pinned; SDK paid-call retries remain disabled. |
| 5 | Parse, validate and canonicalize received authors. | Never rewrite originals/corrections. Reject refusals, truncation, invented citations and ambiguous JSON. Lossless advisory subdivision and catalog reference transport require no provider call. |
| 6 | Start a category's fourth-model synthesis when its three authors are accepted. | Include all three accepted drafts and their exact evidence catalog. Admit the complete request before reserving spend. Retain the synthesis before full validation. |
| 7 | Validate all three final reports and admit complete narration. | Six ordered sections, substantive depth, exact factual citations, final JSON <=42,000 characters and narration <=48,000 characters per report. All syntheses are required before package narration admission. |
| 8 | Generate Fish narration in separately retained chunks. | Existing separate $5/150,000-character allowance; claim before purchase, save purchased bytes before decode/assembly, verify retained hashes. An uncertain missing chunk does not trigger another paid call. |
| 9 | Decode chunks, assemble and validate the complete MP3; upload and verify access. | Stable artifact identity and retained chunks support local/upload recovery. No alternative provider or automatic repurchase. |
| 10 | Render the complete report and evidence appendices, embed its exact listening URL, persist and verify the PDF/audio relationship. | Reuse the stored PDF rather than silently changing an existing artifact. |
| 11 | Deliver each PDF and require verified access before marking its report done. | Stable delivery idempotency identity. Failed delivery retains report and audio work. |
| 12 | Derive the separate three-page teaser from accepted recommendations, verify page count and deliver it. | No new research, model calls or narration. The full reports are separate; teaser delivery failure cannot mark the package done. |
| 13 | Mark the package done only with three linked PDF/MP3 pairs and the verified teaser. | Restarting a completed package must not dispatch models, repurchase narration or redeliver completed artifacts. |

Implementation entry points: `server/routes/company-report-packages.ts`,
`server/lib/company-report-package.ts`, `company-package-v3.ts`,
`company-compilation-matrix.ts`, `company-compilation-parallel.ts`,
`company-compilation-runtime.ts`, `company-compilation-content.ts`,
`company-package-publication.ts` and `company-package-teaser-publication.ts`.

## October 22 lossless author recovery policy

Two mechanical failures are handled together:

- Reference-contract advisory paragraphs longer than 3,000 characters can be
  subdivided without changing any character, ordering, citation or block type.
  Each resulting paragraph must fit the existing block bounds; subdivision
  cannot exceed 24 blocks per section. Facts and limitation references are not
  rewritten. Full content/evidence validation still runs afterward.
  Rendering may trim paragraph-edge whitespace and add paragraph labels or
  boundaries; character preservation describes canonical text, not identical
  PDF layout or spoken whitespace.
- Catalog-bound authors use the existing **30,000 UTF-8-byte wire envelope**.
  This deliberately replaces their additional 25,000-character gate and the
  separate 30,000-byte gate on locally duplicated hydrated quotations.
  Historical non-reference authors retain the 25,000-character/30,000-byte
  expanded transport contract. This is an explicit representation-policy
  change, not a claim that all former size guards are unchanged.

Every quotation is still hydrated and validated before compact reference
transport is accepted; the encoder proves exact decode/encode equivalence.
The entire synthesis request still must fit **200,000 characters and 240,000
UTF-8 bytes** and pass the existing egress check before any reservation.
Final synthesis, narration, model-spend and correction limits are unchanged.
No prose is condensed, no source is reassigned, no accepted sibling is replaced,
and no received paid response is repurchased by this recovery.

Why: the model reads the compact draft plus the same evidence catalog, not a
second unsent copy of each excerpt. A local expansion overage need not imply
an oversized provider request. Truly oversized compact drafts remain rejected.

## Verification and its limits

The focused reference-budget tests prove the observed 3,071/3,018-character
paragraph behavior, exact text preservation, multibyte bounds, invalid-source
rejection, legacy compatibility and the complete three-draft request envelope.

The publication tests exercise the real request/grant/reservation path with
injected provider responses and delivery transports; real synthetic MP3
decoding/assembly, PDF listening-link inspection and three-page teaser checks
remain active. The reference-contract workflow is exercised for HVAC, plumbing
and automotive fixtures. Separate interruption/error tests cover saved chunks,
uncertain purchases, upload/permission/delivery failures and restart reuse.

These tests do **not** establish current provider availability, the factual or
commercial quality of generated advice, real narration completeness, live
Drive delivery, published-build parity or an unattended completion rate.
After explicit publication approval, use the existing owner-confirmed Continue
control on the same saved package; do not create another package or reset spend.
Live acceptance requires opening all actual delivered files and confirming
complete narration, matching listening links and the separate teaser.
