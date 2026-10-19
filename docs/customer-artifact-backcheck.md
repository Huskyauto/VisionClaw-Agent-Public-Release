# Customer artifact backcheck

This native check applies reverse-engineering discipline to customer artifacts:
begin with the customer's requirements, inspect the resulting bytes, and verify
observable acceptance properties rather than trusting the producer's success.
It supplements—not replaces—source review, visual grading and delivery proof.

## Use

Existing `verify_deliverable` accepts `acceptance_criteria`; existing
`deliver_product` accepts the identical object as `acceptanceCriteria`.

```json
{
  "requiredText": ["Aldon Company", "Implementation roadmap"],
  "expectedLinks": ["https://drive.google.com/file/d/ACTUAL_VERIFIED_AUDIO_ID/view"],
  "minimumPages": 3
}
```

Replace the example with the customer's real requirements and the matching
verified recording URL. Declare criteria before production. Do not derive an
easier checklist from the finished artifact or remove failed requirements.
Producers supply criteria; their origin is not cryptographically authenticated
user intent. Existing authorization and customer-send approval remain separate.

## Automatic and explicit checks

- Every PDF reaching the existing delivery verifier is parsed from full bounded
  bytes. A header alone no longer establishes a valid PDF.
- HTTP/HTTPS PDF link annotations must have usable rectangles inside the page.
  Malformed/unsafe URI annotations fail inspection.
- A page with the explicit "listen to the full report" or "play audio" promise
  needs a usable HTTP(S) annotation on that page. This heuristic alone does not
  prove the drawn button itself is clickable or that its target is the recording.
- `expectedLinks` requires exact normalized PDF hyperlink URLs, not printed URL
  text. Supply the independently verified matching MP3 URL to reject mismatches.
- Required phrases are compared against whitespace-normalized PDF extracted text
  or text source. This does not prove the words are visually legible or visible
  in rendered HTML. HTML still needs its existing browser/quality checks.
- Page-count criteria apply to PDFs. Unavailable/unsupported required checks fail
  explicitly. Identity-only coverage on other media is not media verification.

## Receipt and recovery

`VerifyResult.backcheck` includes inspector version, SHA-256 of the inspected
bytes, criteria hash, coverage, pages, checked counts and failure codes.
The existing tenant-scoped `delivery_verifications` audit diagnostics retain
the receipt. Delivery rechecks the byte hash and freezes that snapshot before
upload; changed bytes fail rather than inheriting the old check.

Criteria persist in server-owned delivery metadata and are restored on retry.
Changing criteria under an existing idempotency key is refused; removing them
cannot weaken a retained contract. Reserved-receipt workflows currently reject
explicit criteria rather than pretending to bind them.

Snapshots must also match the tenant-scoped immutable artifact intent. The
existing durability gate downloads the resulting/recovered Drive file and checks
its SHA-256 and size before completion. Secret scanning reads the same frozen
buffer used for upload. Completed receipt lookups always check filenames and
the entire companion list; byte checks are optional only for source-less
lookups of that same recorded package. Supplied changed/unavailable bytes or
insufficient historical identity require reconciliation or a new delivery key.

## Limits and operations

No new service, dependencies, model calls, network probes, database tables or
permissions. Existing PDF libraries run in a terminated worker with an empty
environment, no tsx loader, 128 MB V8 old-generation heap and a 10-second deadline.
At most two workers per process; maximum 10 MB input and 80 PDF pages. Busy,
oversized or incomplete inspection is an explicit failed check, not approval.
The worker is a resource boundary, not an OS sandbox or malicious-parser guarantee.

Known limits: this does not certify factual/source accuracy, visual clipping,
button-label/rectangle alignment, narrator accent, media decoding, remote URL
availability, or successful customer receipt. Keep existing specialized checks.

The method is inspired by the evidence/reconstruction/independent-validation
workflow in the owner-supplied REA paper. No REA source was imported or installed.
