# Example Outputs

This folder shows the *kind* of work the agent team actually produces, so you
can judge the platform by its output rather than its README.

## Committed samples (real, in-repo)

These are genuine structured artifacts, checked in so you can open them with
zero setup:

| File | What it is | Produced by |
|---|---|---|
| [`content-calendar.csv`](content-calendar.csv) | A two-week multi-channel content calendar. | the marketing-week autopilot flow |
| [`competitor-analysis.md`](competitor-analysis.md) | A structured competitor brief. | the competitive-analysis flow |

We keep only lightweight text formats in the repo on purpose — committing large
binaries (PDF/PPTX/XLSX/MP4) would bloat the clone for everyone.

## Live samples (rich formats)

The binary-format deliverables — generated slide decks (PPTX), styled reports
(PDF), spreadsheets (XLSX), and rendered videos (MP4) — are served live from the
public gallery, where they are produced by the real pipeline rather than
hand-made:

**https://agenticcorporation.net/gallery**

That page is backed by `/api/public/gallery` (a cached, read-only endpoint), so
what you see there is the actual output of the deployed system.

## How these are generated

Deliverables flow through deterministic pipelines with quality gates (vision/
audio grading + bounded auto-revise) rather than a single model call. The
contracts live in `server/deliverable-contracts.ts` and the pipeline in
`server/delivery-pipeline.ts`. Every human-facing file is emitted through a
single delivery path so links are stable and streamable.
