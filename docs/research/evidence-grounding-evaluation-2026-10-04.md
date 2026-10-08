# Source-grounding evaluation — October 4, 2026

## Verdict
Keep the source-bound observer advisory. This small evaluation supports its ability to flag supplied-document contradictions with live semantic review, not a guarantee of truth or improved generated answers. Literal/numeric matching alone is too limited. A decimal-format false warning was found and corrected without expanding model permissions, fetching, or approval authority.

## Primary publications
- Resideo T6 Pro installation instructions, document 33-00181EFS-19, Rev. 05-22, English page 12; product identity on page 1. https://customer.resideo.com/resources/techlit/TechLitDocuments/33-00000s/33-00181EFS.pdf
- Microsoft Annual Report 2024, Summary Results of Operations and Fiscal Year 2024 Compared with Fiscal Year 2023. https://www.microsoft.com/investor/reports/ar24/index.html

Manufacturer specification values were checked against a rendered PDF page, not the noisy web/OCR extraction. Source inputs preserve the PDF text and the financial table's year/unit headings; they are not generated factual summaries. Only bounded excerpts were supplied, not the full publications.

## Method
24 new, engineer-authored statements: 10 supported, 12 contradicted and 2 not established by the supplied excerpts. Labels and primary excerpts were frozen before execution. Cases cover literal matches, altered earlier/final numbers, Fahrenheit/Celsius formatting, reversed qualifications, wrong product identity, electrical-rating rows, millions/billions, fiscal-year swaps, revenue/net-income confusion and unsupported future claims.

The comparator is the same observer's deterministic path. The live path is the existing production source-review adapter: GPT-5.4 Modelfarm-only, six-second deadline, no retries, no metered fallback. Two sequential calls evaluated the original set; one additional manufacturer-only call retested the formatting fix. All three returned completed semantic coverage and persisted tenant-scoped audit records. No ensemble answers were generated or compared.

A possible/provisional conflict is counted as a flag, not as proof of contradiction. Support from an AI interpretation remains provisional. Unresolved is an abstention, not a correct contradiction detection.

## Original results (24 statements)
| Outcome | Deterministic only | With live semantic review |
|---|---:|---:|
| Wrong statements flagged | 2 / 12 | 12 / 12 |
| Correct statements recognized | 2 / 10 | 9 / 10 |
| False conflict warnings on correct statements | 1 / 10 | 1 / 10 |
| Wrong statements incorrectly supported | 0 / 12 | 0 / 12 |
| Unsupported statements incorrectly supported | 0 / 2 | 0 / 2 |
| Wrong statements left unresolved | 10 / 12 | 0 / 12 |

The original live path classified 23/24 as expected. The same false positive remained because deterministic conflict flags are not overturned by semantic review.

## False warning and narrow fix
The source writes 32.0 °C, while a correct statement writes 32 °C. The old comparison treated numeric spellings as different values. Decimal values now normalize exactly as strings: separator formatting, trailing fractional zeros, leading zeros and signed zero do not create a numeric conflict. No binary floating-point conversion is used, so distinct large integers remain distinct. This does not certify equivalent statements, reconcile every number in a sentence, or convert units: unresolved statements still need advisory review.

Held-out regression forms separately covered temperature, currency separators, current, signed zero, actual different values, different units and large integers. The targeted manufacturer retest recognized all five correct statements, flagged all six wrong statements and left the one unsupported statement unresolved: 12/12 as expected, zero false warnings. The financial live batch was not repeated; its original 12/12 result remains separately reported. The complete deterministic set was rerun and its false-warning count fell from one to zero, but it still caught only two of twelve wrong statements.

Assessment version was advanced to source-observation-v1.1 after the retest so older receipts cannot match the current assessment rules. This stamp-only change was checked by regression; no fourth live call was made.

## Observer latency
- Original manufacturer batch: 5.96 seconds, nine semantic units assessed.
- Original financial batch: 4.46 seconds, ten semantic units assessed.
- Manufacturer post-fix retest: 5.22 seconds, ten semantic units assessed.
- Deterministic-only initial median: 0.123 milliseconds per statement; cold maximum 12.85 milliseconds.

Runtime measurements include semantic review and database audit persistence; they exclude source acquisition/extraction and answer generation. Three calls are not a latency/reliability benchmark. The original manufacturer run was close to the review deadline; timeout behavior remains an important operational limit. No invoice or wider cost/performance gain was measured.

## Evidence and reproducibility
Fixture SHA-256: cc67048a77ecc5fca50541fb10eaa9da7aae72f6f126e02084659fb43b88df75
Manufacturer PDF SHA-256: 14972a8ad6c2af4777d336ec277fae57be25af0693e5bdf73e260010a4ece8ed
Financial HTML SHA-256: 2b49e38b25f3bea8634b603ad5db64ba0803f27e27f93cc406884e6990974065

A companion JSON retains frozen source excerpts, oracle cases, per-case statuses, coverage summaries and timings. Full transient provider receipts are not duplicated in this deliverable. These are documentary-support labels authored by the implementing engineer, not independent blinded truth labels.

## Limits and next decision
This is a small, non-blind diagnostic, not a general accuracy claim. Official publications can themselves be stale or wrong. Primary excerpts may omit decisive context. Successful quotation checks do not prove entailment. The evaluation does not show fewer errors in generated answers, automatic correction, final assembled-report coverage, or reliable performance across repeated live calls.

Recommendation: retain observation-only deployment posture. Before any automatic shipment gate, use independently labeled, unseen full-report cases and measure false warnings, missed contradictions, review availability and added delay. Do not add another judge merely because this small test succeeded.
