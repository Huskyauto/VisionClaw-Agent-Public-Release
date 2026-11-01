# Current sequence and October 22 lossless recovery

See [Company-package operating sequence](company-package-sequence.md) for the
complete version-3 path, recovery boundaries, explicit transport-policy change
and the distinction between offline evidence and live completion.

# Current one-submission workflow (productionVersion 3)

## Reliability redesign — workspace implementation, not published

All nine unfinished authors run concurrently. A category's synthesis starts as
soon as its three accepted drafts are durably saved. Checkpoints remain serialized
under the renewable lease; failed operations do not discard successful siblings.
Every model call still reserves against the original $150 ceiling.

New requests use a versioned, provenance-bound evidence catalog. Models select
source-excerpt or research-limitation IDs; code inserts exact text, citations and
assigned headings. Unknown, stale or type-confused references fail closed.
Publication and narration consume expanded canonical reports, not opaque IDs.
Corrections receive bounded block locations and fixed diagnostic reasons.
The dedicated contact-email field stays out of compilation prompts.

Historical responses remain immutable and keep their original contract. An
entire quotation matching exactly one retained research limitation may produce
a separately recorded canonical derivation with its own limitation citation
and explicit “not a company finding” label. This is not fuzzy matching,
cross-source quotation repair or another paid correction. Status shows when
that no-model-call recovery is available through **Continue saved package**.

Website batches use up to three isolated workers sharing one page queue.
Two use Camofox; configured remote Chromium can provide the third. The latter
renders socket-pinned HTML with JavaScript and ALL browser networking disabled;
it does not verify dynamic behavior. Without that service the third worker uses
Camofox. Failed static captures can be retried with Camofox. Existing ten-attempt
batch, two-attempt page, discovery and time limits remain.

Only failures proven to precede reservation are marked known-unspent. Explicit
continuation can reconcile those original, corrective or targeted-repair claims
only when the matching reservation is absent. Reserved/uncertain calls are never
automatically repeated.

Offline checks exercise provider grants, budgets, full MP3 decode, three
report/audio pairs, three-page teaser, retained-work recovery, parallel timing
and browser-network isolation. This is not proof of live provider reliability.
No new paid run, production continuation, Git push or publication was performed.

On Company Reports or AI Readiness, the owner enters the company name and public
website or business-domain email, optionally supplies context, approves the displayed limits, then clicks
**Create three reports + audio** once. Bare domains are normalized to HTTPS by the
form. Repeated submissions with the same request identity reuse the durable job.
Business email supplies a starting website URL, not proof of company ownership.
**Prepare another package** clears every visible and optional field, including
industry, CRM, notes and pasted intake, and persists the empty draft with a new
request identity. Saved packages remain available separately in Recent packages.
Known personal-mail domains require an explicit website; the existing public
research URL/DNS/redirect safety checks still apply. Contact email is saved only.

The saved research is compiled independently by GPT-5.4, Claude Opus 5.5 and
Gemini 4 Argon for each of three categories (nine author operations). Claude Sonnet
5.5 synthesizes each category's three compilations (three synthesis operations).
There are no initial/final juries or extra aggregate model calls. Each final report
must pass structural, substantive and exact source-quotation/citation checks.
Formatting tolerance does not require another model call: omitted citation lists
on recommendations/assumptions become empty lists; noncontiguous quoted lines
become separate quotes only if every line matches the same projected source in
any presentation order, with or without an explicit ellipsis. Unknown citations,
unsupported wording and malformed explicit citation lists remain rejected.

**Bounded corrections (development; owner publication still required):** explicit
form approval permits at most one corrective model call per original author or
synthesis operation, within the unchanged model allowance, no higher than $150.
Fixed deterministic validation failures and received pinned-model truncations
can qualify. Refusals, unknown model identities, uncertain claims, transport errors,
lost leases and unknown validation errors do not. Original and corrective receipts
remain durable; correction failure stops rather than starting another retry.
Existing packages require explicit opt-in on Continue. Prior manual replacements
and automatic corrections cannot both buy another call for the same operation.
See [correction policy and operator guidance](company-compilation-corrections.md).

Final outputs: AI Readiness, Business Review and Revenue Opportunities, each with
one complete Fish s2-pro/Onyx MP3 and a PDF containing the exact clickable recording
link. Written source registers are excluded from speech. Drive destinations and
private downloads appear only after validation; there are no automatic emails.
New v3 submissions also include a three-page customer-facing teaser PDF: one
page for each report, with the $497 full-package offer and the instruction
“Make checks payable to Robert Washburn.” on every page. It is extracted from
accepted syntheses with no additional research, model calls or narration.
The package is not complete until the teaser has a verified Drive delivery
and a private package download.

Teaser change design: zero model/audio spend; existing tenant-scoped immutable
file storage and fenced job checkpoints remain authoritative. Retain generated
bytes before upload and use a package/subject/byte-hash delivery key so retries
reuse them. Failure blocks completion without repeating full-report publication.
Existing stop/deadline controls apply; no new email, publication, payment or
tool authority. Verify three pages, exact report order, $497 offer, completed-slot
reuse and rejected/unverified delivery in offline tests.

Default maximum reservations: $150 for report-model operations, plus $5 for
narration/up to 150,000 total narrated characters. Limits are not actual charges.
Raw replies and per-chunk audio bytes are retained before acceptance/assembly.
Uncertain paid dispatches are not automatically retried. Safe owner continuation
reuses retained work; upload recovery uses the existing exact durable artifact key.

Author requests reserve up to 16,384 output tokens each; final syntheses reserve
up to 32,768. Provider reasoning can consume part of that allowance. These do not
raise the original dollar ceiling, author text/input bounds, or narrated-body caps.
A confirmed retained `length` response can be replaced once per exact operation,
only with fresh owner snapshot approval. Different stopped operations need separate
approvals. The original response and reservation, prior replacements and completed
work remain intact. An uncertain dispatch or a second truncation of the same
operation never unlocks another paid attempt.

### Fish audio finishing and status recovery

The normal worker uses Fish s2-pro with the configured Onyx reference. It saves
and validates each purchased segment before assembling a full MP3, uploads that
MP3 with the validated `artifact:` durable-key namespace, verifies public-reader
access, embeds its exact listening link into the PDF, and verifies PDF delivery.
The Drive key is validated before any new narration purchase. Existing narration
identity/chunk names are unchanged, so upload recovery reuses saved audio rather
than synthesizing it again.

Status includes saved/total audio segments and publication stage. Authentication
failures stop polling immediately and label displayed progress as last known;
Check status remains available. Signing in restores status access, not automatic
approval to resume or duplicate a job. A running job is no longer labeled
“Starting” indefinitely.

### LZL production completion — October 20, 2026

After owner republication, the supported application resume endpoint accepted the
original saved package. The normal worker completed all three PDF/audio pairs and
reached phase `done` at 2026-10-21 00:12 UTC (October 20 in America/Chicago).
Production read-only verification confirmed succeeded job status, three completed
reports/files, 12 completed model slots, no state error, and unchanged $150 model
and $5 narration ceilings.

| Report | PDF pages | Full MP3 bytes | Full decode / embedded link |
| --- | ---: | ---: | --- |
| AI Readiness Report | 22 | 30,655,254 | PASS / exact match |
| Business Review | 24 | 32,424,892 | PASS / exact match |
| Revenue Opportunities | 22 | 33,948,353 | PASS / exact match |

All six delivered files were downloaded from their public Drive identities.
The readiness MP3 exactly matched the independently verified assembly of the
four pre-existing purchased chunks. The executive and opportunities narrations
each saved five chunks through the original worker, without repeating completed
model calls. No manual upload, replacement package, customer email, agent
publication, or production SQL mutation was used to complete delivery.

The third pair's verification was interrupted by a development-workspace reset,
not a production failure. Re-downloaded PDF/MP3 hashes matched the first download,
and the final full decode and embedded-link check passed. Production completion
and durable Drive delivery survived loss of the private temporary verification
files.

Historical documentation below describes v1/v2 jobs, which remain unchanged.

# Full company package operation

Owner-only UI: enter company and public website, or a business-domain contact
email from which to infer the website. Personal-mail domains cannot establish
which company website is correct; supply the website in that case. Notes,
principal, industry, CRM and intake documents are optional. Email is saved as
contact information; no customer email, invoice or charge is sent automatically.

## Research

The existing durable worker processes ten page attempts per batch. It saves
discovered URLs, sitemap queues, successful captures and per-page attempt counts.
Successful pages are not recrawled on continuation. Failed pages get a second
attempt in another batch. All discovered eligible URLs must reach a terminal
state before report drafting. Unresolved failures remain coverage limitations,
not proof of a complete website examination. Public discovery cannot prove there
are no hidden, unlinked, private or inaccessible pages.

Limits: 5,000 page URLs, 500 sitemap files, 24 hours. Safety limits stop the package
instead of silently generating a sample. Raw retained page captures and compiler
source excerpts differ: compiler excerpts are bounded to 65,000 characters and
the limitation is disclosed. Never promise every retained byte was read by every model.

The setup panel performs configuration-only checks before accepting a new job;
it does not contact a model or certify provider availability. Main-content
projection supports semantic HTML and explicit Elementor page boundaries.
Feedback markers in text OR attributes exclude their whole bounded section or
embedded template; ambiguous boundaries fail closed. Retained paragraphs must
appear in the actual browser capture. Coverage distinguishes rendered pages
from pages contributing usable factual excerpts. KML/KMZ files are not pages.

## Production and review

- Readiness: GPT-5.4, direct OpenAI.
- Executive/business growth: Claude Sonnet 5.5, direct Anthropic.
- Opportunities: Gemini 4 Argon, OpenRouter.
- Existing three-family report jury, direct Gemini compilation and final report
  validation stay active. An additional Gemini review reads all three completed
  reports together before the package is marked done.
- Direct drafting/review/compilation reserves at most $30 per package. This is
  a conservative admission ceiling, not a quote for actual cost. Existing browser,
  ElevenLabs included-character admission and Drive controls remain separate.
- A model assignment is not a served-model receipt. Sections retain reported
  identities and exact responses. Missing/truncated/mismatched outputs do not pass.

Review projections preserve every included source's text, ID, URL, retrieval
time and verified checksum. Repeated rendered-page URL labels are factored out.
Large inventories of excluded/non-evidence page URLs are summarized separately
by exclusion reason and distinct count, explicitly disclosing that exact lists
remain private and that reason counts can overlap. This never turns excluded
pages into facts, changes the saved evidence/draft identity, or raises the
180,000-character review/compiler bound. Jurors independently read the checked
snapshot representation bound by their existing receipts; its serialization stays
unchanged. Only the compiler additionally factors identical long source text into
explicit backward source-ID references and repeated correction prose into exact
checklist references. The full source bytes and complete checklist entries remain
available in the same packet, with reference-reading instructions. Distinct source
provenance, unmatched correction tails, votes and unknowns are never removed.

Paid calls reserve atomically against the parent before dispatch. Completed
sections are reusable by exact input/model identity. Ambiguous charged outcomes
remain blocked: neither agents nor operators should restart by clearing claims.
Use the established report recovery procedure for accepted/uncertain reviews.

## Deliverables and recovery

Three private full-report PDFs, three one-page teaser PDFs, combined teaser PDF,
and links to each report's complete American-English Eric MP3. Audio uses the
existing full-narration quota, merging, decoding, Drive-permission and PDF-link
gates; teasers have no audio.
MP3 Drive URLs are existing bearer delivery links: anyone receiving a link may
be able to play it. The owner-only package page is not an additional Drive login gate.

Open the package from Recent packages to inspect status, individual failures,
available files and reserved/remaining model budget. A failed draft does not
revoke accepted siblings while those siblings are still finishing.

1. If offered, **Refresh saved research — no model calls** upgrades old captured
   excerpts using bounded public HTML fetches, never a new browser crawl, model
   call, or new evidence collector. It requires completed discovery and no pending
   browser work. It stops after research for another explicit approval.
   Stale excerpts are replaced or removed, source IDs are not recycled. This
   migration is refused if any completed report/full artifact is already bound
   to the old evidence.
2. **Continue saved reports** requires the current package snapshot and the
   normal report-cost approval. Unconfirmed paid drafts require a separate
   acknowledgement that earlier attempts may already have incurred charges.
   Original reservations stay counted; a bounded new attempt has its own
   server-authorized identity. Completed exact-input/model receipts are reused.
3. A child stopped solely because its parent was unavailable can be reinitialized
   only before any review/compiler spending, with exact parent/company/tenant
   bindings. Its original input/state is retained in history. Uncertain paid
   review/compiler work is NOT silently reset by this control: inspect it using
   the existing report recovery procedure. Completed-report evidence migration
   is not supported.
   An initial jury that stopped with zero successful votes can also be restarted
   by this explicit owner control only when there are no review/compiler spending
   reservations, no executed jury events and no accepted sections or fulfillment.
   Its old input, state and jury audits remain in recovery history. A single
   review/compiler reservation forbids this shortcut.
4. **Continue N verified reports** is a separate, explicit owner approval for
   already-paid initial reviews that finished successfully but never reserved
   compilation. The read-only preview rechecks all three pinned reviewers, owned
   receipt IDs, exact original snapshot hashes, valid ballots, correction text,
   full compiler size/safety, original window and remaining budget. An incomplete
   or invalid ballot is not repaired or retried by this action.
   The POST binds the preview to locked parent/child records and the exact
   compiler packet. It resumes only eligible children at compilation, preserving
   their paid responses, corrections, request IDs, digests, original evidence and
   spending. Other reports stay blocked. No new draft or initial jury is queued.
   This may spend remaining model allowance after approval and is not a guarantee
   that the remaining allowance can finish the package.

The server serializes acceptance, rejects stale previews and makes repeated
clicks idempotent. Draft/research recovery renews its processing window; verified
compiler continuation keeps the original package window and child expiry. Neither
raises the $30 total model ceiling. Agents must not clear claims, create a replacement
package to bypass a block, or interpret configuration-ready as live success.

Stop switch: REPORT_EVIDENCE_HANDOFFS_DISABLED=1. Direct paid model permissions
still require the existing owner direct-jury opt-in; this feature does not turn
on metered routing for ordinary agents. Public/restricted-key file transports
remain excluded from the package namespace.
