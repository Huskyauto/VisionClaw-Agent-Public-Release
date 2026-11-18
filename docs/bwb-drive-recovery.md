# Built With Bob: automatic private Drive recovery

## Contract

Canonical weekly production and both BWB render backends now await private Drive
checkpoints. This is automatic, not an optional prompt instruction.
It applies to owner BWB work, not other tenants' customer videos.

Saved progressively:

- Selected input identities and each completed transcript, also retained as a
  per-clip database checkpoint before uploading. A retry reuses that transcript.
- The exact script, supplied photographs, generated images and `.prompt`
  fingerprints.
- Narration and `.voice` fingerprints; local fallback chapter/audio artifacts.
- Farm manifest and secrets-free input bundle, GitHub run identity and available
  completed chapter archives as the farm is polled.
- Final media, thumbnail, result sidecar and delivery evidence.

The early selected-week input folder is linked from the per-video folder through
`input-recovery-folder.json`; the combined transcripts are also copied into the
per-video folder. No credentials or arbitrary workspace directory is exported.

Every saved version has an immutable content identity. An inventory records
original names, file IDs, sizes and SHA-256. The service checks owner-only Drive
permissions and downloads the bytes to compare them before acknowledging a
checkpoint. Unchanged assets still need a verified remote copy. Old versions
are not overwritten.

## Failure and limits

`BWB recovery paused:` stops advancement instead of silently accepting an
unprotected artifact. It does not trigger a new farm purchase or a local-render
fallback. Keep the local files, restore Drive access and retry the checkpoint.
Do not publish over an in-flight production filesystem before preserving its
completed files. Backup is not a delivery or YouTube publication approval.

No cloud service can provide literal 100% availability. The enforced promise is
verified recovery of completed checkpoint units before progression, not
instruction-level snapshots during a provider call. Concurrent work already in
flight can finish; new batches do not advance past a failed checkpoint.

The companion watcher backfills an already-running old process. It cannot
retroactively enforce awaited checkpoints inside that process. It exits when the
result sidecar is backed up, on an upload failure, or after one hour.

## Owner recovery commands

Find the named **BWB Recovery VIDEO_ID** folder in the owner's Drive or the
`[bwb-recovery] verified` logs. Select the newest immutable inventory by creation
time for a single snapshot. By default restore the entire folder: the command
merges immutable inventories from all prior processes, so a restart's partial
inventory cannot hide earlier completed work. Older versions remain available.

```bash
# Development checkout: verify and restore the selected inventory.
npx tsx scripts/bwb-recovery-restore.ts FOLDER_ID

# Published build: use bundled Node, never tsx in the production VM.
node dist/bwb-recovery-restore.cjs FOLDER_ID
```

Restoration requires that same authorized owner Drive connection. It checks
folder boundaries, private permissions, sizes and SHA-256, rejects traversal and
symlinks, and refuses to overwrite different local work. Original media/script
paths are restored; operational JSON and farm archives are placed under ignored
`generated-artifacts/bwb-restored/VIDEO_ID/`.

If completed final media exists, deliver that file through the normal delivery
pipeline; do not rerender just to repair a delivery or backup. If only source
assets exist, resume the canonical renderer with the recovered original script,
Fish voice and fingerprints. A retained GitHub run receipt and input bundle
permit targeted artifact recovery instead of repeating discovery or planning.

```bash
# Backfill a previously started run; not needed for future canonical checkpoints.
npx tsx scripts/bwb-recovery-watch.ts VIDEO_ID --follow
```

## November 15 recovery evidence

The original 18-scene script and Bob photograph were reused. Bob explicitly
approved replacing only the unavailable generated graphics.
The completed 300.634-second 1920x1080 H.264/AAC video was delivered to Drive.
The companion verified the retained checkpoints, exact script, original photo,
17 generated scene images and prompt sidecars, all 18 Fish clips and voice
sidecars, final MP4, thumbnail and result sidecar.

The final inventory contains **76 recovery artifacts**. A live restore check
downloaded the script, one generated PNG and one Fish MP3 into an isolated
directory and verified their exact SHA-256/size receipts.

- Completed video: https://drive.google.com/file/d/REDACTED_DRIVE_FILE_ID/view
- Private recovery folder: https://drive.google.com/drive/folders/1e6Y5jHVu229_0qecBJwdbj9NtobdqSsu

The new automatic hooks are development changes until an owner-approved
publication. The current completed video and verified recovery folder already
exist independently of that publication.
