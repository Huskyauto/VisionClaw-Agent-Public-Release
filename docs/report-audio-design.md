# Full-report audio companion

## Requested outcome
Each AI Readiness and Executive/Opportunities PDF includes a clickable Google
Drive link to one MP3 reading the complete delivered report, not a summary.
The audio reads the same customer sections, action plan, limitations, sources
and disclaimer. The listening instructions themselves are not narrated.

## Design gate
1. Cost: existing ElevenLabs included allowance, fixed Flash model/voice;
   no fallback or LLM rewriting. Reserve at most 36,000 characters per report
   under an account-wide lock, checking provider allowance with a
   2,000-character reserve and subtracting outstanding local claims.
   Chunk at 6,000 characters; reject oversized input, never truncate it.
   No audio is generated before the report review gate. Other ElevenLabs
   consumers share the account, so this local gate cannot guarantee their
   concurrent use will not consume the remaining allowance.
2. State: tenant-scoped durable audio bytes and control receipts in existing
   Postgres tables; local PDFs remain rebuildable caches.
3. Failure: required audio fails closed. Uncertain generation/upload stops
   rather than repeating a paid side effect or delivering a partial pair.
4. Identity: tenant, order, report kind, complete transcript and voice/version
   bind the receipt and Drive recovery key. Atomic claim precedes generation.
5. Isolation: only the existing owner-operated report boundary can create
   narration; no new public route, tool, table or customer-email authority.
   Adapter construction itself enforces the owner boundary, so only that one
   tenant may hold report-audio reservations for the account. Receipt and
   pending-reservation queries remain explicitly scoped to the owner tenant.
6. Stop: existing report-handoff stop switch applies; fixed safe logs reveal
   status, not report text. No fallback silently spends money.
7. Authority: jury/Muse approve report prose; deterministic code reads it.
   Narration cannot modify the report or approve sending. Existing owner
   review and report-only behavior remain unchanged.
8. Delta: one fixed TTS provider and one existing customer-safe Drive uploader,
   not broader agent authority. Tests cover full content, chunk boundaries,
   replay refusal, tenant/content identity, unsafe URLs and PDF annotations.

## Delivery details
Use the established customer-delivery Drive permission checks and a durable
artifact key. A customer MP3 is accessible to anyone holding its reader link,
as with existing customer download delivery; never grant public write access.
Drive playback may take time to process; the PDF explains downloading the MP3
if preview is not yet ready. No automatic customer sends or publishing.

## Acceptance evidence
Implementation and verification status are recorded in replit.md. Unit checks
with injected provider/storage do not establish live TTS or Drive availability.
The anonymous Edge endpoint returned HTTP 403 in availability checks; it is
not a working free fallback.
