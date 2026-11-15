# Measured video output verification

Scope approved: verification first. No captions, normalization, export presets,
new tools, paid calls, binary upgrades or publication.

## Design gate

1. Cost: one bounded 20-second probe per final output; zero API/model cost.
   Optional diagnostics scan at most the first 60 seconds, with a 30-second
   execution cap per detector, sequentially. Default is no content scan.
2. State: reuse existing job checkpoints. Stable copies and reports on disk are
   recoverable caches, not a new durability system; Drive remains the durable
   artifact store. Disk loss permits reconstruction from existing chapters.
3. Failure: required probe/identity checks fail closed, including UNKNOWN.
   Optional detector failures are UNKNOWN, not a clean scan. No automatic edits.
4. Identity/retry: SHA-256 binds reports to the stable delivered copy. Retain a
   verified job output before upload, and reverify it on retry instead of concat.
5. Tenant/limits: no new route/query/permission. Existing owned job and delivery
   guards remain; fixed argv, sanitized subprocess environment, bounded buffers.
6. Observation/stop: reports expose each result and coverage. No autonomous
   loop or runtime bypass switch; owner may stop the existing job/workflow.
7. Authority: code-owned technical policy only; agents cannot approve their own
   output by writing PASS. Optional artistic-content warnings do not veto video.
8. Delta: no expanded model/tool/tenant/autonomy scope. Verify synthetic media,
   strict BWB compatibility, invalid contracts and delivery retry behavior.

## Contract

Required checks measure a real video stream, positive finite duration, valid
dimensions and any explicitly expected audio, codec, dimensions, frame rate,
pixel format or timeline tolerance. Missing required evidence blocks delivery.
Intentional audio-free video is supported by `requireAudio: false`.

Results use PASS, WARN, FAIL, UNKNOWN and SKIPPED. Technical acceptance is not
creative approval, speech intelligibility, caption correctness or full decode
integrity. The default probe does not decode the entire video. Optional
black/freeze/silence scans report start/end coverage and remain advisory.

The BWB adapter retains its h264/aac 1920×1080 requirement and no-symlink stable
copy. Generic finalization uses the same evaluator with its native AV contract,
without imposing BWB dimensions. Existing low-level MP4 size/header checks remain.

## Development verification — November 13, 2026

- 24 focused regressions passed: real synthetic AV and audio-free video, corrupt
  output, forged MP4 header, required-stream/codec/dimensions/fps/pixel-format/
  duration mismatches, symlink rejection, exact stable-copy identity, advisory
  black detection, detector failure, tenant mismatch and upload-failure retry.
- Retained-output mutation was rejected before upload; restoring the exact bytes
  allowed successful stubbed delivery, followed by an idempotent cached result.
- Application plus touched script/test TypeScript passed; release-check build
  passed with existing PostCSS/CJS import-meta warnings; stale-string gate clean.
- Restarted development server returned HTTP 200 at `/healthz`; the public
  landing page rendered. Anonymous browser logging included an unauthorized
  resource and one failed resource request; no authenticated video UI was tested.
- All 18 development personas received measured-verification/retry doctrine;
  wiring audit passed with existing warn-only tool-sprawl/orphan-table findings.
- Scoped self-review covered the touched delivery/paths/subprocess/checkpoint and
  persona surfaces. No unsolicited reviewer agent or whole-platform clearance.
- An initial finalization regression reached the existing live incident/automatic
  second-opinion path (logged result cost $0.0347). Incident and DB-mirror
  collaborators were then explicitly isolated; five exact synthetic development
  job rows were removed. The final regression pass used only local fixtures and
  stubbed delivery/incident/persistence, not a paid BWB render or real upload.

Limits: full-video decode/content clearance, actual timeout injection, live
Drive transport, remote farm binary parity and production rollout were not
tested. The generic job's retained copy remains a recoverable local cache;
publication/FS loss may require chapter recovery. No publication was performed.
