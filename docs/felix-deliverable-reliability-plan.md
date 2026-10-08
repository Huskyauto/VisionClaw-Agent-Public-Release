# Felix Deliverable Reliability Plan
**Owner:** Bob (huskyauto@gmail.com) · **Lead persona:** Felix (id 2) · **Status:** Active · **Started:** 2026-05-04

## North-star goal
> A customer prompt that asks for a video, audio, PDF, slide deck, or small HTML app must reliably produce a complete, high-quality, customer-ready artifact — *frictionless*, no half-finished audio, no timeouts, no "Felix said done but the file isn't there".

## Non-negotiable acceptance bar (per format)

| Format | Hard requirements before "done" can be returned |
|---|---|
| **Video MP4** | H.264 + AAC; `+faststart`; **audio track present end-to-end with no >250 ms silence gap that wasn't in the script**; total duration within ±5 % of sum-of-narration-durations; opens in Drive HTML5 preview; signed URL HEAD 200 |
| **Audio MP3** | 44.1 kHz / mono or stereo; LUFS in -23 to -16 range; **last 1.5 s of every chunk verified as audible** (not silence-padded fail); ID3 title set; signed URL HEAD 200 |
| **PDF**  | Page count matches outline; fonts embedded; first page renders; signed URL HEAD 200 |
| **Slides** | Photo present where required (R98.6); narration-script row count == slide count; export to PPTX + PDF both succeed; signed URL HEAD 200 |
| **HTML app** | Single-file `index.html` (or zipped bundle ≤ 2 MB); opens in Chrome headless without console errors; passes a per-app smoke test (e.g. password generator emits 12-char string); signed URL HEAD 200 |

## Workstreams (in dependency order)

### W1 — Video pipeline reliability  *(audio dropout + parallel + timeout-resilient)*  ⚡ **STARTS FIRST**
**Why first:** This is the active customer-facing pain Bob called out twice ("audio gets lost halfway", "videos time out"). Every other workstream sits on top of a working render.

**W1.0 Diagnose** — instrument `server/mpeg-engine.ts` (`mpeg_produce` + `mpeg_produce_parallel`) and `server/voice.ts` to log per-chunk: TTS request bytes, TTS response bytes, ffmpeg input duration, ffmpeg output duration, concat segment count, final-mux audio-stream duration, **expected vs measured audio duration delta**. Run a synthetic 8-chapter / 12-min video; capture where the delta first exceeds 250 ms.

**W1.1 Audio-completeness verifier** — new helper `verifyAudioCompleteness(filePath, expectedDurationSec, narrationScript)`:
1. ffprobe the muxed MP4 → measured audio duration.
2. Compare to `Σ chunk.expectedDurationSec` (from TTS response or word-timing transcript).
3. If delta > 250 ms OR audio stream missing OR last-frame-of-audio is silence > 1.5 s → return `{ok:false, reason}`.
4. Surface in `verify_deliverable` so any video that fails completeness can never satisfy the deliverable contract.

**W1.2 TTS chunk retry + checksum** — wrap every ElevenLabs chunk call in:
- 3-attempt exponential backoff (1 s / 4 s / 12 s).
- Persist chunk to disk **before** ffmpeg sees it; re-probe duration; reject if duration < 95 % of expected.
- One bad chunk after 3 retries → fail the whole render with a *clear* error (no silent half-finished MP4).

**W1.3 Per-chapter background workers (parallel processing)** — promote `mpeg_produce_parallel` from "concurrent inside one tool call" to *true* background workers:
- Each chapter rendered in its own background job (existing `runBackgroundJob` infra).
- Per-chapter timeout: 5 min. Total wall-clock cap removed (job continues even if the chat turn ends).
- On chapter completion, write `project_files` row + emit progress event.
- Final concat happens when the **last** chapter row appears in `project_files` — not on a timer.
- Removes the entire "10-min wall clock cut my render" failure mode.

**W1.4 Resumable concat** — concat manifest stored on disk; if the concat step itself fails, a follow-up tool call (`finalize_video <jobId>`) can re-run JUST the concat without re-rendering the chapters. Reduces re-cost on transient ffmpeg crashes.

**Acceptance:** 12-min, 8-chapter test video renders 5 consecutive times with zero audio gaps and zero timeouts; `verify_deliverable` blocks on any audio-completeness fail.

---

### W2 — Refuse-to-declare-done gate  *(blocking, three-of-three proof)*
Felix's `assistant.content` cannot return a "done"-class statement (regex on "ready", "delivered", "uploaded", "done", "finished") unless within the same conversation turn the runtime has observed:
1. **Artifact proof** — `verify_deliverable` returned `{ok:true}` for the latest artifact path.
2. **URL proof** — a signed download URL was generated AND `HEAD` request to it returned 200.
3. **Delivery proof** — `project_files` row exists AND a delivery channel (Drive / email / WhatsApp) returned an ack id.

If any of three is missing, the chat-engine rewrites the assistant turn to "still working — finalizing <missing-piece>" and re-injects the gap as a system message so Felix tries again. Implementation point: `server/chat-engine.ts` post-tool-loop, before `return`.

**Acceptance:** synthetic test where Felix tries to fake a "done" without one of the proofs → turn is auto-rewritten and Felix retries.

---

### W3 — Vision/audio quality grader with bounded revise  *(max 2 cycles, then escalate)*
Per-format rubric in `server/deliverable-contracts.ts`:
- **Slides:** vision LLM checks photo-on-required-slide, on-brand colors ≥ 3/5, narration-matches-slide-content, no broken layout. Score 0-100.
- **Video:** sample 10 frames + audio waveform; check no >2 s black, audio in -23 to -16 LUFS, no meta-narration phrases ("in this video I will…").
- **PDF:** render first + middle + last page; check no broken layout, fonts embedded.
- **Audio:** waveform + transcript; check LUFS, no end-cut, transcript matches script ≥ 95 %.

If score < 85 → auto-revise once with critique embedded as a system message. If still < 85 after one revision → escalate to Bob via `owner-notification` with artifact + critique + planned next attempt. Do not ship.

**Acceptance:** intentionally-bad test deck (no photo on slide 5) → grader catches → auto-revise inserts photo → grader re-passes → ship.

---

### W4 — Prompt → Contract router  *(planner-level pipeline binding)*
New step `classify_deliverable_request` runs before Felix sees the prompt. Output: `{format, params}` where `format ∈ {video, audio, pdf, slides, html_app, image, none}`. Each format has ONE canonical pipeline (DAG of tool calls + validators + delivery step) stored in `server/deliverable-contracts.ts`. Felix fills content slots; the runtime executes the DAG. Closes the entire class of "Felix forgot to call X" failures.

**Acceptance:** 20 synthetic prompts (3 per format) → router classifies correctly ≥ 95 %; pipeline always executes the same shape per format.

---

### W5 — Small HTML app builder skill  *(net-new capability)*
Customers asking for "a password generator", "a calculator", "a unit converter", "a simple game" — Felix should produce a **single-file `index.html`** (or zipped `index.html` + `app.css` + `app.js` ≤ 2 MB).

**W5.1 New tool `build_html_app`** (the 285th):
- Inputs: `{appType, requirements, brandColors?, owner?: 'customer'}`.
- LLM generates spec → HTML/CSS/JS → write to `project-assets/html-apps/<slug>-<timestamp>/index.html`.
- Vite-style sanity build (or just node.js HTML validator) — must parse, no `<script src="external">` to non-allowlisted CDNs.
- Headless Chrome smoke test: open file, run a per-app-type assertion (password generator → click button → expect ≥ 8-char string in DOM; calculator → click "2 + 3 =" → expect "5").
- On pass: zip + upload to Drive + return signed URL.
- On fail: capture console errors → one auto-revise → if still fails, escalate.

**W5.2 New skill `.agents/skills/html-app-builder/SKILL.md`** — patterns, security rules (no eval, no inline-script with user data, sandbox iframe if app accepts user input), per-app-type smoke-test cookbook.

**W5.3 Persona allowlist** — Felix + Forge get `build_html_app` in `allowed_tools`. Add to `TOOL_REGISTRY` + `safety_profile.restricted_categories` review (low-risk = no intent gate, but smoke-test gate is mandatory).

**Acceptance:** 5 test prompts (password generator, BMI calculator, tip calculator, color-palette picker, simple to-do list) → all 5 produce working single-file HTML apps that pass the per-app smoke test.

---

### W6 — Golden-path nightly replay  *(regression cannot reach a customer silently)*
For each format, store one canonical prompt + expected artifact fingerprint:
- Duration ±5 %, page count exact, file size ±20 %.
- Narration coverage ≥ 95 % (transcript matches script).
- Brand-color presence ≥ 3 of 5.
- Photo-on-required-slides: 100 %.
- HTML app: smoke test passes.

Cron runs nightly, cost-capped at $1 total. Any miss → freeze that pipeline at last-known-good revision + email Bob via `owner-notification`. Hooks into existing `weekly-maintenance` skill cadence (run daily for deliverables, weekly for deps).

**Acceptance:** intentional regression PR (e.g. break TTS chunk handling) → nightly replay catches it within 24 h, freezes pipeline, emails Bob.

---

### W7 — Positive-exemplar memory  *(mirror of R98.7 failure-pattern memory)*
On every successful delivery (W3 grade ≥ 90, no customer redo within 7 d) → write `STRATEGIC_WIN_V1:` row to `memory_entries` with prompt-fingerprint, pipeline used, critic score, artifact link. Felix recalls both failures AND wins matching the prompt fingerprint at task start. Lets Felix copy the working recipe instead of re-inventing.

**Acceptance:** after 10 successful deliveries, Felix's `recall_strategic_wins` returns ≥ 1 close-fingerprint match for a fresh prompt of the same format.

---

## Per-workstream production-pipeline checklist
Each W must satisfy ALL of these before moving to the next:

- [ ] Code change implemented
- [ ] `npx tsc --noEmit` clean
- [ ] LSP diagnostics clean
- [ ] Unit/synthetic test passes (workstream-specific acceptance bar)
- [ ] Architect post-edit-code-review pass — no HIGH severity findings
- [ ] `replit.md` updated (R-round bumped, tool count if applicable, defense gaps if any)
- [ ] `website-surface-sync` skill run if any user-visible surface changed
- [ ] Auto Git Push committed
- [ ] (When natural release boundary) `suggest_deploy` + production verification
- [ ] (When release-cutting threshold met) Public Mirror Push

## Ordering rationale
1. **W1 first** — Bob's loudest current pain. Without a reliable render, everything else is academic.
2. **W2 second** — biggest safety net per hour of build time. Bolts onto existing `verify_deliverable`.
3. **W3 third** — catches what slips past W2's binary gate (quality, not just presence).
4. **W5 fourth** — net-new capability Bob explicitly asked for; independent of W4/W6/W7.
5. **W4 fifth** — architectural; benefits from W2+W3 already being in place.
6. **W6 sixth** — needs W1-W3 to exist so the replay has a stable target.
7. **W7 last** — quality-of-life; depends on W3 grades existing.

## Out of scope (for now)
- Live video editing / multi-cam — current scope is generated content only.
- Real-time collaborative editing of slides — async generation is the contract.
- Mobile-app builder — explicitly only HTML apps for W5.
- Refactoring `server/voice.ts` ElevenLabs streaming layer — only adding wrapper retry logic, not rewriting.

## Open questions for Bob (non-blocking)
1. For HTML apps — should we offer a hosted preview URL (Replit hosting) in addition to the Drive download? (Default: download only.)
2. For audio LUFS bar — strict broadcast standard (-23 LUFS ±1) or YouTube-friendly (-14 to -16)? (Default: YouTube range.)
3. For W6 nightly replay cost cap — $1/night ok or should we go higher? (Default: $1 cap, alert Bob if hit twice in a week.)
