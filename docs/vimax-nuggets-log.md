# ViMax Nuggets — Future-Work Log

Source: research dive into [HKUDS/ViMax](https://github.com/HKUDS/ViMax) on May 8, 2026 (3.3k stars).
License: MIT (free to adapt).
Architecture: Python+uv multi-agent video generation framework — Director, Screenwriter, Producer, Video Generator. Three input modes (Idea2Video, Novel2Video, Script2Video) plus AutoCameo (user-photo cameo).

This log captures patterns discovered in ViMax that map onto Felix's video pipeline, ranked by ROI for VisionClaw. Nothing was integrated in this pass — Bob's stated higher priority is real users, not more video pipeline polish before anyone has complained about the current quality. Pick the next nugget when actual customer demand for narrative-quality video appears.

Stack mismatch warning: ViMax is Python/asyncio/langchain with doubao/seedream/veo image+video providers. VisionClaw is TS/Node with the gpt-image-2 cascade (HARD RULE in replit.md). **Lift the patterns, not the code.**

## ViMax agents inventory (for reference)

`character_extractor`, `character_portraits_generator`, `screenwriter`, `script_planner`, `script_enhancer`, `scene_extractor`, `event_extractor`, `global_information_planner`, `novel_compressor`, `storyboard_artist`, `camera_image_generator`, `reference_image_selector`, `best_image_selector`. Pipelines: `idea2video`, `novel2movie`, `script2video`. Tools: image generators (doubao_seedream, nanobanana), video generators (doubao_seedance, veo), reranker (bge), render_backend.

## What VisionClaw already has (no port needed)

✅ **Idempotent "skip if exists" pattern** — R98.14 `start_video_job/check_video_job/finalize_video` with idempotent concat retry. ViMax confirms our architecture (every step writes to disk first, re-runs cost zero on completed steps).

✅ **Wave-table parallelism** — R98.16 wave parallelism in `mpeg_produce_parallel` matches ViMax's `asyncio.gather` over camera-gen + video-gen tasks.

✅ **Pydantic structured output everywhere** — Zod equivalents throughout `server/validation.ts` + `server/deliverable-contracts.ts`.

✅ **Quality grading on deliverables** — `grade_deliverable` is the whole-video equivalent of ViMax's per-image grading (see #2 below for the per-image gap).

✅ **Deterministic deliverable pipelines** — Felix's fixed pipelines + auto-revise loop is conceptually parallel to ViMax's central orchestrator.

✅ **First-person photo cameo** — R98.6 `set_my_profile_photo` is half of ViMax's AutoCameo + Character Portrait Registry pattern.

## Backlog — ranked by ROI for VisionClaw

### #1 — Reference Image Selector + Character Portrait Registry (HIGHEST ROI, ~3-4 days)

**The problem they solved:** "Bob looks different in every shot." Same problem Built With Bob videos and any Felix video with a recurring product/person hits.

**Their solution:**
- At job start, generate canonical character portraits ONCE in multiple views (front / side / back / 3/4) and store in a `character_portraits_registry`.
- For every new frame, an LLM (`ReferenceImageSelector`) picks ≤8 most relevant references from the pool (portraits + prior generated frames in chronological order) AND writes the prompt that explicitly says `"Image 0 = Bob's face, Image 2 = the gym background, generate a new image where Bob is doing X..."`.
- The image generator gets concrete reference indices, not vague prose. Recency-weighted (later frames preferred over earlier ones).

**Map to VisionClaw:**
- New schema table: `video_job_image_pool (job_id, frame_idx, identifier, view, image_path, description, embedding, created_at)` — tenant-scoped per usual, every INSERT must pass `tenantId`.
- New tools (~3): `register_character_portrait(jobId, identifier, view, imagePath)`, `select_references_for_frame(jobId, frameDesc) -> {indices, promptPrefix}`, plus the registry-init helper.
- Wiring change in `server/video/mpeg-engine.generateImageForScene` to consult the pool before each scene generation and feed the explicit "Image N = ..." prompt prefix to gpt-image-2.
- ~250 lines net + tests + architect pass.

**Why this is #1:** R98.6 already added profile-photo auto-attach for first-person slides. The other half (the prior-frame chronological pool + the LLM that picks which references to reuse) is what gives 2-minute Built With Bob videos consistent visual identity instead of Felix's current "fresh image each scene" drift. Single biggest visible quality win available.

### #2 — Best Image Selector (high ROI, ~1-2 days)

**Their pattern:** For every important frame, generate **N candidates in parallel** (typically 3-4), then a vision LLM grades them on (a) Character Consistency, (b) Spatial Consistency, (c) Description Accuracy. Pick the winner with explanation, throw away the others.

**Why it matters:** Felix has whole-deliverable grading but no **per-image** quality gating — generates one image per scene and ships it. ViMax burns 3-4× the image cost per shot but the consistency gain on long videos is the difference between "looks coherent" and "looks like 30 unrelated images stitched together."

**Map to VisionClaw:**
- New helper `selectBestImage({ candidates, references, target_description })` — single vision-LLM call returning winning path + reason.
- Drop-in addition to `mpeg_produce_parallel`.
- Cost guardrail: only fire on first-person + product-hero scenes via a `quality_tier` flag; B-roll keeps single-shot generation.
- ~120 lines + tests.

**Pairs naturally with #1** (shared image pool infrastructure). Bundle them as a single "Felix Visual Continuity" workstream when ready.

### #3 — First Frame / Last Frame / Motion Decomposition (medium-high ROI, ~2-3 days)

**Their pattern:** Every shot decomposed by an LLM into three parts:
- `ff_desc` — static snapshot at start
- `lf_desc` — static snapshot at end
- `motion_desc` — what happens between, using camera-language (pan, dolly, push-in) AND character-by-clothing-not-name to avoid identity confusion

Then they generate first frame as image, last frame as image, condition the video generator on BOTH.

**Why it matters:** Modern video gen (Veo3, Sora, Kling, Seedance) accepts first+last frame conditioning and the result is dramatically better than text-only prompts. Felix's current pipeline gives the video model a single text prompt per scene. Half-effective.

**Map to VisionClaw:**
- Gate behind a model-capability check matrix in `server/video/providers.ts` — Sora/Veo3/Kling support it, others don't.
- Felix's `mpeg-engine.generateImageForScene` already pre-bakes scene images. Splitting into `ff_image` + `lf_image` + `motion_text` and passing both to the generator (when supported) is the upgrade.
- ~200 lines + provider matrix + tests.

### #4 — Camera Tree (architectural insight, narrower applicability)

**Their pattern:** Build a parent-child tree of cameras where parent shots (wide) contain child shots (close-up). Generate the parent first, then for each child, run a short "transition video" from the parent's frame, extract the last frame as the new camera position, then composite the missing characters in. Solves multi-angle continuity (over-the-shoulder reverse-shots) for narrative video.

**Verdict for VisionClaw: SKIP for now.** Felix's videos are 95% single-camera narration (talking head + B-roll cutaways). Camera Tree shines for narrative/cinematic content with multiple angles per scene — that's a future workstream if VisionClaw ever pushes into actual short-film generation, but it's overkill for the YouTube long-form pipeline. Revisit only if a customer asks for cinematic narrative video.

### #5 — Novel Compressor + RAG-based long script segmentation (low ROI for now)

**Their pattern:** Long input (full novel) → `novel_compressor` agent extracts beats → `script_planner` segments into episodic scenes via RAG.

**Verdict:** VisionClaw's Felix pipelines start from short user prompts, not novel-length input. Pattern is interesting if we ever build "turn this audiobook into a video series" but no current demand.

## Recommended ship order (when demand appears)

**Round 1 — "Felix Visual Continuity" (R99 candidate):** Bundle nuggets #1 + #2. Shared image-pool infrastructure, single new schema table, ~5 new tools. Solves the visible weakness (consistency drift across long videos). Estimated 1 week including architect pass + load test.

**Round 2 — "Felix Motion Decomposition" (R100 candidate):** Nugget #3 + provider capability matrix. Only after #1 + #2 are landed and we've proven the image-pool primitives work.

**Skip indefinitely:** #4, #5 unless customer demand materializes.

## Trigger conditions

Don't ship any of this until at least one of:
- 3+ paying users complain about video character/scene consistency
- A high-profile Built With Bob video gets called out for visual drift
- Felix's `grade_deliverable` auto-revise loop starts hitting iteration caps on continuity-related rubrics
- A competitor ships character-consistent long-form AI video and it becomes table stakes

Until then: file this and move on.

---

## Adjacent candidates (non-ViMax, logged for the same purpose)

### Supertonic on-device TTS (supertone-inc/supertonic) — logged 2026-05-14

**Source:** https://github.com/supertone-inc/supertonic (Apr 2026, Supertonic 3)
**License:** MIT code + OpenRAIL-M model weights (restricted-use clauses — needs legal pass before commercial ship)
**What:** 99M-param ONNX TTS, ~398 MB total weights, 31 languages, ~167× realtime on CPU, browser inference via WebGPU+WASM, fixed-voice (no cloning), expressive tags `<laugh>` `<breath>` `<sigh>`. Runtimes: Python, Node.js, browser, Java, C++, C#, Go, Swift, iOS, Rust, Flutter.

**Why we didn't ship it now:**
- BWB videos are brand-locked to OpenAI "onyx" — fixed-voice Supertonic can't replace the YouTube pipeline.
- 398 MB ONNX bundle is too heavy to bake into the Replit chat-engine container; would compete with render workers for CPU.
- Adds a new dependency surface without a customer pulling for it today.

**Where it WOULD earn its keep (trigger conditions):**
1. **In-chat "instant TTS preview" UX** — let users hear a narration draft in the browser ($0, WebGPU) before paying Fish/ElevenLabs to render the final. Strongest single-feature case; ~1 week to wire as a frontend-only preview tier under the existing TTS escalation ladder.
2. **[Your Product] mobile / PWA** — on-device, offline, free coach voice in airplane mode. Native fit for a wellness app; should be the default TTS the day that artifact ships.
3. **Fallback tier under Fish/ElevenLabs** when quotas blow or providers 5xx — last-resort "audio still ships" guarantee.

**Skip indefinitely unless:**
- [Your Product] goes mobile/PWA, OR
- A paying user asks for browser-side narration preview, OR
- Fish + ElevenLabs both have a same-day outage and a customer is blocked on audio delivery

Until then: file and move on.

### Open-Sora 2.0 (hpcaitech/Open-Sora) — logged 2026-05-14

**Source:** https://github.com/hpcaitech/Open-Sora (v2.0 released 2025-03-12, last push 2026-04-09, 29k stars)
**License:** Apache-2.0 (code + weights — clean for commercial use, no OpenRAIL-style restrictions)
**Paper:** arXiv:2503.09642 — 11B-param diffusion video model, trained for $200K, matches 11B HunyuanVideo and 30B Step-Video on VBench + human preference.
**What:** Text-to-image-to-video pipeline (T2I2V) — uses Flux for the still frame, then animates. Both T2V and I2V from one checkpoint. 5s clips at 1024×576 or 576×1024 (256/768px native, native 16:9 and 9:16). Needs H100/H200-class GPU + flash-attn — not Replit-runnable.

**Why this is interesting now (validation, not adoption):**
- **Their T2I2V architecture is exactly Felix's current pipeline.** A frontier open-source team independently arrived at "bake the image first, then animate" — same reason Felix pre-bakes gpt-image-2 frames and passes `imagePath` (not `imagePrompt`) into `mpeg_produce_parallel`. Worth citing as architectural validation the next time someone asks "should Felix go pure-T2V?" The answer is no, and now there's a peer-reviewed paper backing the call.
- **5-second clip as the unit of animation** — matches the "hero shot" pattern (animated B-roll between still+narration scenes) without breaking the existing chapter/scene model. `mpeg_produce_parallel` already concats per-segment, so a 5s animated clip slots in next to a 10s still+narration clip with no engine change.

**Where it WOULD earn its keep (trigger conditions):**
1. **Per-scene "hero" animation tier** — when a Felix scene is marked `tier: "hero"`, route through Open-Sora (self-hosted on H100 or via Video Ocean API) instead of a still + Ken Burns pan. Keeps stills for body scenes (cheap), animates only the intro/outro/CTA frames (high-impact). Strongest single-feature case if customer demand for "more cinematic" arrives.
2. **I2V upgrade path for BWB visuals** — keep current still→Ken-Burns for cost ($0.01/scene), add an `animate_hero_shot` tool that takes the same `imagePath` and returns a 5s MP4 clip. Same input shape, additive cost only.
3. **VBench as the eval rail** — paper cites VBench scores. If/when Felix's `grade_deliverable` adds a vision-quality rubric, VBench (or its sub-rubrics) is the obvious benchmark to anchor against rather than ad-hoc LLM grading.

**Why we didn't ship it now:**
- Not Replit-runnable. Self-host or Video Ocean API both add infra/cost without a paying customer asking for animated hero shots.
- BWB videos are currently shipping fine with stills + Ken Burns; no customer has called out static-frame fatigue.
- 11B model inference is multi-second per clip on H100; today's mpeg_produce_parallel pipeline ships a 30s 3-chapter video in 33s end-to-end (last Golden Path run). Adding an I2V hop per scene would 2-3× wallclock without a clear quality win for the current brand.

**Skip indefinitely unless:**
- A paying customer asks for "more cinematic" or "animated" video, OR
- A high-profile Built With Bob video gets called out for looking too static, OR
- Video Ocean (or similar managed I2V API) drops below ~$0.05/clip with sub-2s latency

Until then: file, cite as architectural validation in the next "should Felix go pure-T2V?" debate, and move on.

### fal.ai video-starter-kit (fal-ai-community/video-starter-kit) — logged 2026-05-14

**Source:** https://github.com/fal-ai-community/video-starter-kit (MIT, TypeScript, last push 2025-06-12, ~2.3k stars)
**What:** Next.js + Remotion + fal.ai starter app demonstrating Minimax / Hunyuan / LTX video models with multi-clip composition, audio tracks, voiceover, IndexedDB-side storage. Not a library — a reference implementation.

**Why this one IS different from Open-Sora and Mochi:**
- **fal.ai is a managed API** — no GPU, no self-hosting, no flash-attn. Callable from Replit today with a key. Directly closes the "not Replit-runnable" objection that gates Open-Sora 2.0 and Mochi.
- **TS-native** — matches our Express/Node stack. No Python sidecar.
- **Multiple video models behind one billing surface** — Minimax, Hunyuan, LTX, and others. Pick-best-per-scene without N integrations.
- **Remotion ("React for video") is a real second nugget** — declarative scene composition in JSX, programmatically renderable. Alternative to our current raw-ffmpeg `mpeg_produce_parallel` pipeline for the *composition* layer (not generation).

**Where it WOULD earn its keep (trigger conditions):**
1. **fal.ai as the managed I2V provider for `animate_hero_shot`** — directly retires the "not Replit-runnable" blocker on the Open-Sora hero-shot tier. Same `imagePath` input, returns a 5s MP4 clip. ~$0.02-0.10/clip range depending on model. This is the FIRST lever to pull if a customer asks for cinematic BWB.
2. **Provider-routed video model selection** — same pattern as our existing provider cascade for LLMs. `generate_video_clip(imagePath, motion)` routes Minimax for fast/cheap, Hunyuan for quality, LTX for stylized, with fallback chain on 5xx. Wraps fal.ai with our cost-aware cascade.
3. **Remotion as the future composition layer** — programmatic JSX scene assembly with deterministic output. If we ever hit the limits of raw ffmpeg concat (e.g. wanting text overlays, transitions, captions baked from data), Remotion is the obvious next step. Today's ffmpeg pipeline ships in 33s end-to-end so there's no immediate need, but it's a clean upgrade path.

**Why we still don't ship it today:**
- Today's pain was Felix not calling video tools, not video tools producing bad output. R112.16 already closed that.
- No paying customer has asked for animated hero shots.
- Adding a fal.ai provider integration is a real surface (API key, billing, rate limits, error mapping, cost telemetry) — only worth it once there's pull.

**Recommended order if/when triggered:**
1. **Phase 1:** Wire fal.ai as a video provider (1-2 days). Add `animate_hero_shot(imagePath, motionPrompt, durationSec)` tool, route through Minimax-fast first, treat as opt-in per-scene (`tier: "hero"`).
2. **Phase 2:** Expand to Hunyuan/LTX as quality/style tiers, wire cost-aware cascade.
3. **Phase 3 (only if needed):** Consider Remotion for declarative composition — but only if ffmpeg pipeline starts hitting real limits (captions, lower-thirds, programmatic motion graphics).

**Skip indefinitely unless:**
- A paying customer asks for cinematic / animated BWB, OR
- A high-profile Built With Bob video gets called out for looking static, OR
- We want to A/B "still + Ken Burns" vs "animated hero" on a single BWB short and see if engagement moves

Note: this nugget supersedes the Open-Sora 2.0 entry's "not Replit-runnable" objection. When a customer pulls, fal.ai (this stack) is the path; Open-Sora 2.0 (self-hosted) is the fallback if fal.ai pricing/quality stops working.

### claude-code-video-toolkit (digitalsamba/claude-code-video-toolkit) — logged 2026-05-14

**Source:** https://github.com/digitalsamba/claude-code-video-toolkit (MIT, Python+TS, last push 2026-05-11 — 3 days ago, 1.1k stars, 190 forks)
**What:** A production-grade video toolkit purpose-built for Claude Code (and via migration, Codex). Skills + slash commands + templates + Python tools for the end-to-end pipeline: voiceover (Qwen3-TTS, ElevenLabs), image gen (FLUX.2), music (ACE-Step), video gen (LTX-2), composition (Remotion + MoviePy), cloud GPU (Modal, RunPod). Sprint-review videos for Digital Samba's mobile arm are the author's own use case — same "explainer / B-roll narrated walkthrough" shape as BWB.

**Why this one is the most directly relevant of the four:**
Same problem space, same agent paradigm. They've solved several pieces we've felt pain on. The transferable nuggets are concrete:

1. **Intent-vs-reality project reconciliation** — their `project.json` tracks lifecycle (`planning → assets → review → audio → editing → rendering → complete`) and "automatically reconciles intent (what you planned) with reality (what files exist)." This is **exactly the missing layer** that let Felix narrate a phantom job ID today: he claimed a render existed because his plan said it should. A reconciliation pass that walks the plan against disk + DB + spans before declaring "delivered" would have caught it loudly instead of silently. Concretely: between Felix's render-claim and his delivery-claim, run `verify_job_artifacts(jobId)` that asserts (a) `video_jobs` row exists, (b) MP4 file exists on disk, (c) `delivery_logs` row exists with `email_sent=true`. R112.16 closes the *delivery* leg of that; a full intent/reality check would catch the *render* leg too.

2. **Scene transitions library** — they ship `glitch()`, `rgbSplit()`, `zoomBlur()`, `lightLeak()`, `clockWipe()`, `pixelate()`, `checkerboard()` (+ stock Remotion `slide/fade/wipe/flip`). BWB currently does plain `fade` only. Direct lift candidate: add 2-3 transitions (clockWipe + lightLeak feel on-brand) to mpeg_produce_parallel's chapter-boundary concat. ~$0 cost, pure ffmpeg filter graph, real quality bump.

3. **Skills directory pattern is interchangeable with ours** — they use `.claude/skills/<name>/` with a migration script that copies into `~/.codex/skills/`. We use `.agents/skills/<name>/`. Same shape. Their `remotion-best-practices`, `ffmpeg`, `moviepy`, `qwen-edit`, `acestep`, `ltx2`, `runpod` skills are essentially ready-to-import reference material for Felix — at minimum the `remotion-best-practices` + `ffmpeg` ones could feed `scripts/agent-knowledge-refresh.ts` as third-party reference docs.

4. **Brand-profile JSON pattern validates ours** — their `brands/<name>/brand.json` + `voice.json` + `assets/` mirrors what we do via `data/youtube/brand-style-guide.md` + Fish Audio refs. Validates that "brand as data not prose" is the right shape; we just store it in markdown today. If we ever multi-brand (BWB + Bob-on-wellness-program + a customer's), the JSON-per-brand layout is a clean upgrade path.

5. **AGENTS.md generated-block pattern** — their migration script appends a *generated block* (delimited by markers) into `AGENTS.md` while preserving manual content outside it. This is exactly the surgical-injection pattern we want for our `replit-md-maintenance` skill — generated stats/counts inside markers, prose outside. We already do something similar with replit-md-compact, but the marker convention is worth borrowing if we ever expand to a multi-file generated-block system.

**The piece I'd NOT lift:** their cloud-GPU dependency (Modal/RunPod) and Python-tool-bridge architecture. Our Felix lives in TS/Express; we'd want the *patterns* (reconciliation, transitions, skills) without the Python sidecar.

**Where it WOULD earn its keep (trigger conditions + recommended order):**

| Priority | Nugget | Effort | When to pull |
|---|---|---|---|
| **P1 (do soon-ish)** | Intent/reality reconciliation pass in Felix's tools_doc — every "I rendered X" claim must verify `video_jobs` row + disk file + spans before proceeding | ~1 day | Next time Felix narrates a phantom anything — this is the systemic fix for today's failure mode. R112.16 only closed half of it. |
| **P2 (low-hanging quality bump)** | Steal 2-3 chapter-boundary transitions (clockWipe + lightLeak feel BWB-on-brand) into `mpeg_produce_parallel` | ~half day | Next time a BWB video feels visually flat at chapter cuts |
| **P3 (when fal.ai gets wired)** | Pull their `remotion-best-practices` skill content as reference doc | ~1 hr | Once we wire fal.ai (previous nugget) and want Remotion as the composition layer |
| **P4 (when we go multi-brand)** | Move brand-style-guide.md → brands/<name>/brand.json + voice.json | ~1 day | First non-BWB brand we ship |

**Why we still don't ship any of it today:**
- R112.16 already shipped the delivery-leg reconciliation (autoDeliver flag enforced). Adding the render-leg reconciliation is sensible but not urgent until we see another failure of that kind.
- Transitions are quality, not reliability. No customer has complained that BWB transitions look flat.
- Their skills are reference material; ingesting them into `.agents/skills/` is research, not work, until we have a concrete trigger.

**Skip P1 indefinitely unless:** Felix narrates another phantom job (render OR delivery) in the next 2-3 BWB ships. If we go 3 clean videos in a row, R112.16 alone was enough and the reconciliation layer is a "would be nice" not "must have."

**The one-line takeaway:** This repo is the closest thing to a peer-reviewed answer to "how should an AI agent ship videos." Our Felix architecture is broadly the same; their `project.json` reconciliation is the one piece we genuinely don't have, and it's the systemic root of today's phantom-job-ID failure. Watch the next 2-3 BWB renders before deciding whether to build it.

### ArcReel (ArcReel/ArcReel) — character/entity consistency — logged 2026-06-27

**Source:** https://github.com/ArcReel/ArcReel (**AGPL-3.0 — viral copyleft, NEVER import code; re-author the idea only**, Python/FastAPI + React 19 + Claude Agent SDK, multi-provider AI video workbench: novel → screenplay → character sheets → storyboard → clips → final cut + CapCut/剪映 draft export)

**Verdict:** validation-not-import (same pattern as the other external agent repos). Stack mismatch (Python/Docker vs our native-TS), AGPL blocks any code lift, and we already have ~80% natively (multi-persona orchestration, multi-provider media cascade, async queue w/ reserved/background slots, cost ledger + orchestration-efficiency telemetry, chunk-and-parallel, BWB script-JSON → render-farm, Fish-voice TTS). It is the strongest open *reference* for NARRATIVE AI video, not a merge target.

**The one genuinely transferable IDEA (future-work):** **character/entity visual-consistency layer.**
- Generate a **locked character design sheet** (a reference portrait/turnaround) FIRST, then pass it as an `imagePath` reference into every downstream storyboard + video shot so the character looks identical across cuts.
- Tag recurring **props / scenes as "clues"** that persist as references across shots for cross-cut continuity.
- This is the entity-level analog of our existing **scene-image fingerprint** trick (`docs` / memory `bwb-scene-image-fingerprint`): we already de-jumble *scene* slides by prompt-sha256 sidecar, but we have **no character/entity reference-anchoring** today.

**Why we DON'T ship it now:** BWB is first-person selfie/documentary talking-head — there are no recurring fictional characters or props to keep consistent, so this layer earns nothing for the current product. It is purely speculative until the video direction changes.

**Trigger conditions (build ONLY if one fires):**
1. BWB (or a new video product) goes **multi-character / narrative / fiction** — i.e. recurring on-screen characters that must look the same shot-to-shot.
2. A **customer pulls** for character-driven video (explainer mascot, branded recurring character, dramatized scenario).
3. We add **image-to-video with recurring entities** where drift between clips becomes visible.

**Recommended shape if/when triggered:** a `data/`-persisted character/entity registry per project (`{name, designSheetImagePath, role}`) + a clue registry (`{label, refImagePath}`), threaded as reference `imagePath`s into `generate_image` (storyboard) and the I2V tool (`animate_hero_shot` from the fal.ai nugget). Pure additive layer on the existing media cascade — no rewrite. ~2-3 days.

**Secondary (minor) borrowables, lower priority:** grid_4/6/9 image → split cells as first/last frames to drive video (cheap continuity lever, only if clip volume scales); editable CapCut draft export instead of flat MP4 (off-strategy for fully-autonomous flow; only if we ever want a human-in-the-loop edit step).

**One-line takeaway:** ArcReel proves the narrative-video agent pattern and hands us one clean idea — anchor recurring characters/props to a locked reference image for cross-shot consistency — that we should build *only* if BWB ever stops being talking-head.
