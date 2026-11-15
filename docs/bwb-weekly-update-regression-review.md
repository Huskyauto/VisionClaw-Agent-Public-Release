# Built With Bob weekly pipeline regression review

Reviewed November 13, 2026 after the shared video-verification update.

## Result

No regression found in the checked paths. No production rendering, paid
generation, delivery, email, setting change or publication was initiated.
This is not a fresh live end-to-end production certification.

## Evidence

- **276 existing checks passed**, no failures or skips, covering weekly chat
  routing, owner/policy/tenant launch boundaries, literal date/weight parsing,
  all selected Drive clips regardless of duration, complete transcription before
  planning and source-bound cache keys, Fish voice lock, weight guards,
  non-blocking first-person audit, photo selection, image/audio fingerprints,
  narration timing, progress, failure classification, EIO helpers, packaging,
  and actual output validation.
- Tests ran with a cleared environment, fake constructor-only SDK credentials
  and an unreachable fixture database, not inherited owner provider credentials.
  Discovery tests replace Drive/Scribe transports before bundling.
- **Four additional process-level checks passed** using the real BWB GitHub
  wrapper, real brand validator and real ffprobe output verifier. The farm,
  generation, progress database and delivery transports were replaced before
  bundling; the child inherited no credentials:
  1. Correct Fish/strict-voice, 1920×1080/30fps render options survived; delivery
     received the exact SHA-256-verified bytes; the orchestrator retained email
     ownership; the success sidecar retained the verification report.
  2. Corrupt output stopped before delivery and produced no success sidecar.
  3. A negative delivery receipt produced `success:false` and nonzero exit.
  4. A thrown delivery error preserved the farm output, cleaned the private copy
     and did not falsely complete the recap.
- The four expected production chain bundles existed locally following the
  previous successful release-check build. The production command resolver
  still selects plain Node bundles rather than requiring the tsx loader.
- Read-only production records: the latest weekly job completed November 9,
  2026 at 01:50 UTC (November 8 evening, Chicago), with both a render path and
  Drive URL. Earlier successful jobs were recorded November 1, October 25 and
  October 17. A prior November 1 attempt correctly refused an invented weight;
  the later attempt completed. These records establish retained status/link
  presence, not independent inspection of remote bytes or current connectivity.

## Preserved behavior and limits

The update did not change weekly discovery/planning, clip coverage, Fish
narration, weight truth, image production, farm settings, transcript/audio/image
reuse, approval ownership or publication permission. The new verifier adds
technical checks after the farm result; it does not edit the video.

Manual-only scheduling remains the intended policy; this review does not enable
autonomous production. A planner dry-run is not free: it can still transcribe,
synthesize and write checkpoints, so it was deliberately not used as an
offline test.

Live GitHub dispatch/runner availability, fresh Drive/Scribe/Fish/model calls,
email inbox receipt, the next weekly run and deployment of the new verifier
remain outside this evidence. Historical successful records do not prove that
the latest source is published.

Regression commands:

```bash
# Run under a cleared, non-credentialed test environment.
node --import tsx --test --test-concurrency=2 \
  tests/unit/bwb-*.test.ts tests/video/bwb-*.test.ts \
  tests/lib/bwb-recap-preflight.test.ts tests/unit/eio-read.test.ts \
  tests/unit/github-render-output-validation.test.ts \
  tests/unit/media-output-verification.test.ts
```

The reported 276 baseline checks preceded adding the four wrapper checks;
combined coverage is **280 passing checks**. No runtime code needed changing.
