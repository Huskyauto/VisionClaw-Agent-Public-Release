# FFmpeg Skill: fit with VisionClaw's existing media system

Reviewed 2026-11-13. This is a source/capability comparison, not an installation,
end-to-end render test, security clearance or production verification.

## Recommendation

**Implementation follow-through:** Bob selected verification first. The shared
technical evaluator, generic/BWB delivery integration, explicit diagnostic
coverage and verified-copy upload retries are implemented and locally tested.
See `docs/media-output-verification.md` for evidence and remaining limits.
Captions, loudness and export profiles remain outside this implementation.

Borrow selected verification and delivery patterns rather than installing 42
tools or replacing the existing editor/orchestrators.

Priority order:
1. Share an explicit, measured output-verification contract across delivery paths.
2. Add an ASS/libass caption fallback for builds without `drawtext`.
3. Add real integrated loudness/true-peak measurement and opt-in normalization.
4. Add explicit platform export presets with safe-zone visual previews.

Keep this work separate from the unfinished Fable hardening contract unless Bob
chooses to combine them. No runtime code, packages, credentials, schema or
deployment settings changed during this review.

## Sources and review boundary

Upstream: https://github.com/kajisho5/ffmpeg-skill

README snapshot:
https://github.com/kajisho5/ffmpeg-skill/blob/08dece2fe6243f3cc1864486318dd685b5ade38f/README.md

The README's 42-tool inventory and compatibility section were inspected. The
prior review also inspected upstream `scripts/check.py`; the full upstream
implementation and claimed test corpus were not independently audited or run.

Local comparison covered editing tools, composition/concatenation, async process
execution, binary/capability discovery, deliverable grading, durable video-job
finalization, the GitHub-farm wrappers/common code, BWB artifact validation and
the render-worker surface. Targeted repository searches supported the inventory;
"no dedicated path found" is not proof that every possible implementation is absent.

## Existing module map and actual boundaries

- `server/video-editor.ts`: word-level transcription, transcript-driven filler
  and gap cuts, EDL rendering, burned captions and opt-in Drive upload.
- `server/tools/domains/video-editor/definitions.ts`: the three existing agent
  tools expose transcription, filler cutting and caption burning.
- `server/mpeg-engine.ts`: scene composition, image motion, transitions,
  concatenation and adding/replacing audio.
- `server/lib/ffmpeg-async.ts`: async execution, timeout, bounded output and
  process cleanup. Do not add a competing subprocess framework.
- `server/lib/ffmpeg-paths.ts` and `server/lib/ffmpeg-preflight.ts`: bundled binary
  resolution, executable health checks, encoder/filter discovery and caching.
- `server/deliverable-grader.ts`: actual stream probing, codecs, duration, A/V
  duration drift, optional supplied transcript rules and black-frame detection
  for videos below five minutes; audio volume detection.
- `server/video-job-runner.ts`: chapter jobs, recovery, concat, a required final
  basic-file gate and tenant-bound durable Drive delivery.
- `scripts/lib/video-output-validation.ts`: a stable no-symlink delivery copy
  and actual ffprobe enforcement of positive duration, H.264/AAC and 1920x1080.
  `scripts/bwb-render-github.ts` calls this validator before its delivery.
- `scripts/lib/github-render-farm.ts`, `scripts/render-github-generic.ts`,
  `server/render-client.ts` and `services/render-worker/src/render.ts`: existing
  farm/worker orchestration. An upstream batch/watch/render engine would duplicate
  jobs and resource control, not simply add an editing filter.

The richer deliverable grader is exposed through
`server/tools/domains/quality/handlers.ts`. The inspected generic video-job
finalization path calls `verifyFinalVideo`, not that richer grader. Do not
describe every existing video as unverified: the paths enforce different checks.

## Concrete gaps worth addressing

### 1. Consistent measured verification before delivery

The generic job's `verifyFinalVideo` checks minimum size, MP4 `ftyp` bytes and
positive duration supplied by concat. That is not the same as independently
probing the completed file. The BWB delivery validator does probe actual streams
but has a fixed landscape format contract. The separate grader has richer
checks, but it is not the common mandatory finalizer.

Reuse these pieces behind one configurable report:
- actual expected streams, duration/timeline tolerance, codec, dimensions,
  frame rate/pixel format and audio requirements;
- explicit PASS, WARN, FAIL, UNKNOWN and SKIPPED outcomes;
- bounded optional black/freeze/silence checks with declared sampling coverage;
- identity bound to the exact bytes delivered, preserving the stronger existing
  stable-snapshot protection rather than replacing it with size/mtime alone.

The grader's black-detection error currently returns no segments and a diagnostic
string; its caller discards that string. A failed detector should be UNKNOWN,
not indistinguishable from a successful clean scan. Its five-minute cutoff must
also remain explicit, not be presented as full-video content clearance.

Block delivery on definite technical contract failures. Do not block intentionally
silent videos, still-image scenes or artistic black frames without an explicit
content contract. Preserve resumable jobs and avoid re-rendering accepted media
merely because reporting or delivery failed.

### 2. Captions that work with the available renderer

The existing local `burnCaptions` implementation refuses when `drawtext` is
missing. The resolved development FFmpeg lacks that filter, but has `subtitles`.
Upstream's ASS/libass caption route offers a useful fallback without replacing
the FFmpeg binary or introducing another transcription provider.

Preserve exact word timestamps, declared casing, line/chunk policy and source
text; encode ASS text and paths safely rather than accepting caller filter
graphs. Confirm actual font/glyph rendering with a small synthetic fixture:
the presence of `subtitles` alone is not proof that every font or script works.
Use tenant-owned temporary sidecars, bounded execution and existing opt-in
delivery. Keep the existing drawtext route on environments where it works.
This finding concerns the inspected local editing tool, not proof that remote
BWB/farm caption rendering is broken.

### 3. Real loudness, not a relabeled volume reading

`gradeAudio` uses `volumedetect` mean/max dB. These are not integrated LUFS and
true peak in dBTP. Upstream's measured loudness workflow is a genuine additional
capability rather than another transcription or caption tool.

Start with measurement. Make normalization explicit; use a chosen target and
post-encode measurement, keep original inputs, and stream-copy video when only
audio changes. Preserve Fish narration identity and BWB's content/coverage rules.
Do not automatically retry/re-encode without a strict attempt/resource bound.

### 4. Destination exports and safe-zone previews

Native composition and caption placement exist. The reviewed surface does not
provide the upstream-style unified set of destination presets, safe-zone visual
overlays and post-export checks.

A small shared profile table can drive requested aspect/size/fps/codec/audio
targets and a contact-sheet preview. Reuse existing job/delivery identity.
Platform guidance must be labeled advisory unless the caller supplies a strict
limit. Do not silently speed up, shorten, crop or remove source material to fit.
Center crop is not subject tracking; captions need actual glyph/filter support.

## Full 42-tool disposition

Existing = overlapping native primitives, not a claim of identical CLI parity.
Candidate = useful gap/pattern. Defer = no current requirement justifying adoption.

| Upstream tool | Disposition |
|---|---|
| probe | Existing; enrich a shared validation report |
| scenes | Candidate later; measured proxies are not semantic highlights |
| look | Candidate: contact sheets and safe-zone previews |
| cut | Existing EDL/filler cuts; smart-copy precision is a later comparison |
| join | Existing concat/transitions; preserve current resume identity |
| silence | Existing transcript-gap cuts; waveform/speech-aware mode could extend them |
| fit | Existing render sizing overlaps; destination presets are a useful extension |
| crop | Candidate only as an explicit user-requested rectangle operation |
| cropdetect | Defer unless letterbox analysis is needed |
| deinterlace | Defer without an interlaced-footage requirement |
| denoise | Defer pending real noisy-input fixtures |
| redact | Candidate later; fixed rectangles do not detect faces or license plates |
| sphere | Defer without a 360-video requirement |
| straighten | Defer without a horizon-correction requirement |
| insert | Existing scene/title-card primitives |
| background | Existing scene/background primitives |
| reverse | Defer |
| stabilize | Defer pending real shaky-footage fixtures |
| sequence | Existing still-image scene composition overlaps |
| waveform | Candidate later for audiograms |
| freeze | Existing still-scene primitives overlap; precise frame-hold API is not verified |
| pad | Existing silence/end-padding composition overlaps |
| speedramp | Defer; do not change narration timing automatically |
| loop | Defer without an explicit looping requirement |
| broll | Existing scene composition overlaps; non-destructive timed cutaways could extend it |
| metadata | Candidate later for chapter-marker export |
| grid | Defer without a multi-panel requirement |
| audio | Existing add/replace/mix primitives overlap; typed cleanup/ducking is a later candidate |
| sync | Candidate later for multiple recordings; audio alignment is not lip-sync proof |
| loudness | Priority: actual LUFS/true-peak measurement and bounded opt-in normalization |
| caption | Priority: ASS fallback for the drawtext-missing local build; safe zones/multilingual parity later |
| overlay | Existing composition overlaps; explicit timed overlays could extend it |
| graphics | Existing titles/scenes overlap; avoid a second graphics framework |
| color | Defer HDR/LUT adoption until real source/output color fixtures exist |
| export | Priority: destination profiles and measured results |
| proxy | Candidate later for bounded analysis previews; never substitute for originals |
| check | Highest priority: common exact-output report and delivery integration |
| report | Reuse existing jobs UI; a technical report can summarize the common report |
| render | Do not adopt another orchestrator |
| batch | Do not introduce a separate watcher/cache/concurrency owner |
| multicam | Defer without a multiple-camera requirement |
| verify | Borrow fixture/verification discipline; do not claim upstream CI proves local compatibility |

## Actual local binary compatibility check

Only version/filter-list commands were run; no footage was processed.

- Resolved FFmpeg: **7.0.2-static**.
- Resolved ffprobe: **4.0.2-static**.
- Present filters: `loudnorm`, `ebur128`, `blackdetect`, `freezedetect`,
  `silencedetect`, `subtitles`, `vidstabdetect`, `zscale`.
- `drawtext` is absent.

Upstream v3 refuses FFmpeg **or ffprobe** versions below 6.1. Therefore its
unmodified current toolkit is not compatible with this resolved local pair.
This does not prove the current native pipeline is broken: its supported probe
queries are a different contract. Native adaptation can use filters already
available, while a future ffprobe upgrade needs package/build compatibility
checks and separate render-worker/farm verification.

Do not infer remote or production binary parity from these development probes.

## Implementation shape and acceptance

Prefer native TypeScript adapters using existing safe argv execution, tenant-owned
paths and resource limits. No new model calls or speech-model downloads are
needed for the first verification/loudness work. Keep concurrency within the
current 4 GB budget and declare partial sampling rather than scanning unlimited
video on the web request path.

Test with small synthetic fixtures: valid AV, corrupt/truncated media, missing
required audio, explicit silent-video intent, wrong dimensions/codec, detector
failure/timeout, loudness out of target, and exact delivered-artifact identity.
Do not render a real paid BWB job as a smoke test or change its locked format.
Adding agent-facing tools later requires ordinary registration, authority policy,
tenant-safe paths and persona knowledge wiring; the upstream MCP server supplies
none of VisionClaw's customer authorization merely by running locally.
