# Company-report reliability investigation — 2026-10-22

## Car Fix research stall: bounded reads and coordinator-compatible concurrency

Read-only production checks matched the screenshot to package 2131. At
09:37–09:40 UTC it remained on attempt 1, researching, with 95 discovered,
2 reviewed, 93 pending and a renewing lease. The retained page map contained
two rendered pages and seven first-attempt browser failures. No package-model
spend was recorded. The last observed Camofox activity was around 09:27:50 UTC.
The exact blocked await cannot be identified from the existing telemetry;
do not claim a specific network or provider outage as proven.

Two deterministic defects were found locally:

- The three-minute loop condition does not bound an already-awaited browser,
  fetch, initial evidence collection or cleanup. DNS and browser coordination
  are outside some provider socket timers.
- Production starts multiple Camofox lanes against the same tenant-wide
  try-advisory-lock coordinator. Different session suffixes do not create
  different coordinator locks, so self-contention is recorded as failed pages.

The repair uses one Camofox lane, retaining the separate networkless Chromium
lane when configured. Both production engines share a scheduling group and
both require tenant workspace authorization, including human-control checks.
Research reads now share a 180-second admission deadline, with
75-second browser-action and 25-second fetch ceilings; cleanup gets a separate
10-second grace. A timed-out read blocks the package with a specific explanation,
not a fabricated successful/failed page or an automatic paid retry. Late values
and rejections are consumed without entering the crawler or durable checkpoints.
Already checkpointed pages remain retained. Queued cleanup checks its own
expiration before dispatch; each batch uses a fresh isolated session suffix,
so late remote effects cannot target a later continuation's session. Cleanup
of a timed-out, still-running browser action is not confirmed. Database
operations are still governed by the existing database/lease mechanisms
(20-second connection and 60-second server statement limits), not these read
timers; these are not a blanket handler wall-clock guarantee.

This is a verified local hang-prevention and concurrency repair, **not proof
that the live Car Fix crawl has recovered or that a particular underlying
provider call was cancelled**. No publication, production mutation, replacement
package, paid author/synthesis call, push or email is authorized by this repair.
Final focused regression run: 24/24 passed. Coverage includes hung browser,
fetch and cleanup calls, late sibling-result rejection, expired queued cleanup,
human-mode denial of the optional remote engine, grouped scheduling, sibling
retention, production lane selection and normal multi-batch research without
revisiting successful pages.

Independent review identified a missing successful-sibling clock recheck,
the pre-existing remote-engine human-control bypass, and expired queued cleanup.
All three were fixed with focused regressions. The follow-up review confirmed
the sibling/auth fixes and accurately limited the DB guarantee; its subsequent
medium cleanup finding was fixed and confirmed with the deterministic
hung-navigation/expired-cleanup/late-settlement test, without a third review.
The production build passed after the final cleanup change; workspace restart,
startup logs and the public landing screenshot confirmed the app serves.
The full typecheck passed before that final small cleanup-fencing change.
At 09:49:59 UTC the untouched live package still showed 2/95 on attempt 1
with no package-model reservations. It needs the new build before this repair
can affect it; publishing and successful continuation are not yet verified.

## Subsequent failure: valid saved references exceeded the hydrated author limit

Production package 2033 stopped again at 7/9 authors, 1/3 syntheses and no
verified report/audio pairs. Its failure reference was
`649c58b1-580d-4172-8a01-a7f3ce4f429a`. Read-only inspection and offline replay
confirmed the executive/opportunities Gemini corrections pass provenance,
substance and schema validation, but code's quotation expansion produces
26,553 / 26,813 JSON characters, above the 25,000-character author allowance.
Another provider correction is not needed to repair these local representations.

### Repair and explicit character-policy decision

After full hydration/validation, only an overflowing contract-2 author may use
compact, same-catalog references instead of duplicate quotation text. Exact
hydrate-round-trip equality is mandatory: every source identity, word, block,
heading, advisory paragraph and unknown survives. The provider responses remain
immutable; existing complete siblings retain their original accepted text.

The **25,000-character check now measures the actual compact author transport**,
not the expanded intermediate. This is an intentional character-policy change,
not a claim of identical expanded-character semantics. Both compact and fully
expanded reports remain under the existing 30,000-byte ceiling. Legacy author
rules, the 200,000-character / 240,000-byte full request gate, 42,000-character
synthesis output, 48,000-character narration and monetary ceilings are unchanged.
New syntheses consume references against their supplied catalog after
revalidation; historical syntheses receive restored full text.

### Verification, not live completion

- Exact saved candidates recover at 24,393 characters / 24,447 bytes and
  23,944 characters / 23,966 bytes. The in-memory explicit-resume simulation
  accepts 9/9 authors with zero author/correction purchases.
- All eight prior complete slots (seven authors and readiness synthesis) stayed
  byte-identical; both saved corrective responses stayed byte-identical.
- Real synthesis preflight admitted the executive request at 115,116 characters
  / 115,658 bytes and opportunities at 117,664 / 118,075. Injected reservation
  stops prevented all spending/provider dispatch. Conservative reservation
  estimates were $2.8769 / $2.90107, not charges or quotes for the full package.
- Shared release inventory passed 114/114. Final focused tests passed 8/8 after
  adding privacy-safe fixtures at the two exact character boundaries and a
  synthetic nine-author/three-synthesis workflow. The latter verifies expanded
  final report content, not actual narration or customer delivery.
- Compiler/build passed. Independent review passed with no security findings,
  explicitly flagging the character-policy change for disclosure. Preview
  restarted and public landing rendered.

No paid continuation or production write was performed. Publish the workspace,
then use the existing owner/snapshot-gated **same-package** resume controls.
Do not create a fresh package or repurchase the two received author corrections.
Two syntheses, narration, final artifacts and delivery remain live-unverified.
Unattended multi-company reliability is still not established.

## Status and scope

Initial read-only production investigation, followed by the owner-approved
workspace redesign and offline verification. Not published or live-proven.
No production writes, new model calls, paid retries, live continuation, customer
messages, Git pushes or publication were performed. Existing receipts remain
unchanged. The redesign below is now implemented in the workspace; operational
details and verification boundaries are in `docs/company-report-package.md`.

## Confirmed findings

### 1. The initial failure was a limitation/source identity defect

Andersen stopped at the executive GPT author after three readiness authors
completed. Its original and one permitted corrective response both contain:

> Retrieved customer-feedback sample: 0 review excerpts. Customer satisfaction,
> strengths and complaints remain unassessed; absence of a usable sample is not
> evidence of good or bad service.

The response cites S3. This exact text is present in the supplied research
limitations, but not in S3 or any retrieved source. Validation is correct to
reject the claimed citation. Treating this as fabricated company evidence would
also be incorrect: it is a real research-scope note assigned an unrelated ID.

### 2. This is a recurring contract failure, not an isolated provider fault

The completed dental package's original opportunities Claude response also
cited S3 for a verbatim research limitation that was not in S3:

> Network captures are byte-capped and may be partial even when structured data parses.

Its correction passed. Andersen repeated the same error in its correction.
Different providers therefore exhibit the same limitation/citation mismatch.
The dental readiness author also needed size corrections and a separately
approved targeted repair. These observations do not prove every historical
failure has the same cause.

### 3. Correction feedback does not identify the failing content

The runtime supplies a fixed validation label, original report and original
evidence. For an excerpt failure it does not supply the section/block path,
bad source ID, or distinguish source quotations from research limitations.
The validator exits at its first failure. Consequently the single paid
correction must rediscover the problem across an entire detailed report, and
can repeat it or expose a second problem after fixing the first.

### 4. The output contract delegates mechanical work to models

Each of twelve reports must generate detailed prose, preserve six exact
headings, quote exact source bytes, select source IDs, serialize valid JSON,
and fit combined character/UTF-8/narration budgets. One unresolved invalid
response stops the package. Current controls appropriately prevent uncontrolled
retries but do not make generation reliable.

The contract is strongest as an integrity gate but too brittle as a production
interface. Loosening quotation validation would hide the symptom, not repair it.

### 5. Research coverage and model-visible evidence are different

Andersen's retained evidence has 65 sources. Compilation receives the first
30 sources, with 29,693 source characters in this snapshot. Further source and
per-source limits are disclosed by the projection.

This did NOT cause the latest mismatch: the rejected limitation was visible
in the supplied projected limitations. However, source selection is positional,
not a documented relevance/coverage selection across all usable company pages.
Do not equate crawl/review coverage with all captured content informing a report.

### 6. Existing checks are necessary but not a reliability benchmark

The prior focused tests and exact saved-correction replays proved local repairs.
They did not establish unattended completion rates across independent companies.
The earlier Gemini fix worked: Andersen's saved Gemini correction is accepted.
The package subsequently stopped at a different author. Claims must distinguish
an accepted response, offline full-workflow simulation and actual verified delivery.

## Verified module map

- company-report-package: worker orchestration and durable checkpoint host.
- company-package-v3 / company-compilation-matrix: twelve slots and stop/resume rules.
- company-compilation-content: evidence projection, prompts and acceptance.
- company-compilation-runtime: provider calls, fixed correction feedback and spend.
- business-report-evidence: source identities, quotation validation and appendices.
- company-package-publication: accepted synthesis to Fish narration/PDF delivery.
- company-report-packages routes: authenticated admission and owner Continue.

Owner/tenant enforcement, exact saved claims, uncertain-outcome stops, source
validation, caps and delivery verification must remain intact in any redesign.

## Recommended redesign, before another live test

1. Build one immutable, bounded evidence catalog before drafting. Give exact
   quotations, measurements and research limitations distinct typed identities.
   Preserve source provenance and keep linked-only destinations distinct.
2. Models select evidence/excerpt identities and write advisory analysis. The
   application inserts exact quotations and citation labels. Unknown IDs and
   stale catalog identities fail closed. A source quote must never become a
   research limitation, or vice versa, merely to pass acceptance.
3. Validate all bounded report blocks locally before consuming the one permitted
   paid correction. Return all safely enumerable faults with exact block paths
   and fixed diagnostic reasons. Do not add model judges or automatic retries.
4. Assemble fixed headings, source registers and limitation disclosures in code;
   keep model work focused on substantive company-specific analysis. Perform
   size/expansion and narration admission before paid downstream operations.
5. Test the complete generation/acceptance/restart/publication path against a
   retained, privacy-safe, multi-company failure corpus. Include limitations
   mis-cited as sources, altered quotes, missing JSON closures, multiple faults,
   bounds, unknown IDs, truncation, restart and provider ambiguity.

Keep nine authors, three syntheses, three complete PDF/MP3 pairs, the teaser,
existing model/audio caps and source honesty. This proposal does not reduce
report depth, add reviewers, alter historical receipts or authorize extra spend.

## Admission and recovery constraints

- Version/bind the new model-output contract explicitly; never reinterpret old
  receipts as if they had used the new contract.
- Do not silently relabel Andersen's wrong S3 citation, delete the failing block,
  exempt it from validation or grant another correction.
- Preserve Andersen's accepted authors, failed response and used correction.
  Recovery must be separately designed and admitted under existing authority;
  rebuilding the future output contract alone does not complete that package.
- Live reliability remains unknown until an authorized end-to-end run completes
  and all delivered files are verified. No publish recommendation is warranted
  from this investigation alone.
