/**
 * Tools-layer-split S21 — media-domain tool definitions.
 *
 * Selection: the 8 CONTIGUOUS media/video tools in both the legacy
 * TOOL_DEFINITIONS array and (interleaved) the legacy switch — `generate_audio`,
 * `produce_video`, `plan_video_production`, `create_slideshow_video`,
 * `mpeg_produce`, `mpeg_produce_parallel`, `mpeg_concat`, `mpeg_add_audio`.
 *
 * ALL 8 definitions move verbatim (byte-clean inventory diff). Only 6 handlers
 * migrate (see handlers.ts): the mpeg_* quartet + produce_video +
 * plan_video_production. `generate_audio` and `create_slideshow_video` STAY
 * LEGACY because their switch arms use tools.ts module-scope helpers
 * (`db`/`sql`, `logSilentCatch`, the `_ffprobePath` alias) — moving those
 * helpers is out of scope for a mechanical slice (S5 write_file precedent: def
 * moves, handler stays legacy until its module-scope deps are addressed).
 *
 * Definitions are VERBATIM copies of the objects previously inline in
 * `server/tools.ts` TOOL_DEFINITIONS (no renames, no description edits, no
 * schema changes).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const generateAudioDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "generate_audio",
    description: "Generate audio narration from text using text-to-speech. Default provider (R110.3+): Fish Audio s2-pro (primary, ~$0.001/scene, ~10 req/s capacity). Auto-cascades Fish → OpenAI → Edge on rate-limit/quota error. Saves the audio file and uploads to Google Drive. Use this to create voiceover narration for videos, podcasts, or audio content.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to convert to speech. Can be a full script or narration." },
        voice: { type: "string", description: "Voice to use. For OpenAI: alloy, echo, fable, onyx, nova, shimmer. For ElevenLabs: any voice ID. Default: onyx." },
        provider: { type: "string", enum: ["fish", "openai", "elevenlabs", "edge"], description: "TTS provider. Default (R110.3): fish (Fish Audio s2-pro, BYO FISH_AUDIO_API_KEY w/ API-credit wallet — Bob's primary, no OpenAI 429s). 'openai' = gpt-4o-mini-tts brand voice 'onyx' (rate-limited under burst). 'elevenlabs' = premium ElevenLabs. 'edge' = Microsoft Edge anonymous read-aloud (free, no key, no rate limits — last-resort fallback). Tool auto-cascades on any rate-limit / quota / 5xx so videos no longer fail for 'RATE LIMITED' alone." },
        filename: { type: "string", description: "Output filename (without extension). Default: 'narration'" },
        project_id: { type: "number", description: "Project ID to attach the audio file to (optional)" },
        strictVoice: { type: "boolean", description: "Brand-voice lock (R125+14+sec3). When true, the cross-provider cascade is DISABLED — if the requested provider/voice can't synthesize (e.g. Fish rate-limit), the tool returns an error INSTEAD of silently substituting a different provider's voice (OpenAI/Edge can't reproduce a Fish voice clone, so the cascade would otherwise ship a generic non-brand voice). Used by Built With Bob renders so a transient Fish failure fails the render rather than shipping in the wrong voice. Default false." },
      },
      required: ["text"],
    },
  },
};

export const produceVideoDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "produce_video",
    description: "⛔ NOT for Bob's Built With Bob WEEKLY RECAP — use bwb_weekly_build instead. CINEMATIC NARRATED VIDEO. R125: this tool is now a thin compatibility shim — every call is transparently forwarded to `build_video_from_brief` so users get the consistent job-based UX (top progress banner + inline chat card + /jobs page + auto-deliver email). RETURNS the brief-pipeline shape: { job_id, watch_progress_url, total_chapters, total_scenes, estimated_duration_sec, message, instructions }. Tell the user the `watch_progress_url` and the estimated duration. DO NOT poll check_video_job or call finalize_video — the background runner handles render → concat → Drive upload → email automatically. Pass `email_to` to enable auto-delivery. PREFER calling `build_video_from_brief` directly for new code (cleaner contract, accepts a free-form brief). slide_scripts is still accepted and is converted into a chapter-tagged brief internally. ⛔ NOT for Bob's Built With Bob WEEKLY RECAP — that forwards to the generic brief planner and yields stale evergreen chapters; use `bwb_weekly_build` (auto-discovers + transcribes THIS week's real clips, renders in parallel on the GitHub farm).",
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "Single narration script (legacy). For perfect sync, use slide_scripts instead." },
        allow_silent_slides: { type: "boolean", description: "R98.5 opt-out: bypass the half-silent-video guard. Default false. Only set true if you GENUINELY want a video where some slides are narrated and others are silent text-card holds. Bob's normal complaint comes from accidental empty narration; do not set this just to make the validator stop complaining." },
        allow_invented_face: { type: "boolean", description: "R98.5 opt-out: bypass the first-person self-image rule. Default false. Only set true if the user has explicitly approved an AI-generated stand-in face for the slides where they speak in first person. Default behavior: ask the user for a real photo of themselves and pass it via slide_scripts[i].image_path." },
        slide_scripts: {
          type: "array",
          items: { type: "object", properties: {
            narration: { type: "string", description: "FINAL spoken-aloud script the audience will hear on this slide. NOT your planning notes. NOT 'I will explain X'. Write what the voice-over says VERBATIM, in second person if addressing the viewer (e.g. 'Three weeks in, the hunger is gone.'). 1-3 sentences per slide is the sweet spot. R98.5 VALIDATOR: tool will REJECT (success:false, no video built) any slide whose narration matches planning-prose patterns ('I'll explain', 'first I'll cover', 'in this video', 'today I'll', 'let me tell you about how I', 'we'll explore/look at') — Felix kept shipping meta-videos that describe the video instead of being the video. Also REJECTS if the video is mostly-silent (>30% of slides have empty narration while others have narration) — empty-narration slides become 2s holds with text-card fallback, producing the half-narrated/blue-card video Bob hit in production. R98.5 SELF-IMAGE RULE: if narration uses first-person speaker claims ('I'm Bob', 'my name is X', 'I lost N pounds', 'my journey') AND you have NOT supplied `image_path` for that slide, STOP and ask the user for a photo of themselves before calling produce_video. Don't invent a face for the user." },
            title: { type: "string", description: "Optional slide title overlay (used as fallback if image generation fails)." },
            image_prompt: { type: "string", description: "R98.2 — Cinematic image prompt for THIS slide. The tool will pre-bake a real photographic/illustrative scene image via the gpt-image-2 / DALL-E 3 / Gemini cascade — NOT a flat blue background with text. Be specific: subject, setting, lighting, mood (e.g. 'A professional chef plating a colorful Mediterranean salad in a bright sunlit kitchen, shallow depth of field, food-magazine style'). If omitted, the prompt is auto-derived from narration + title — but providing it gives much better visuals." },
            image_path: { type: "string", description: "Optional pre-existing image file for this slide (workspace-relative path). Skips image generation entirely. Use for logos, headshots, charts you've already produced." },
          } },
          description: "RECOMMENDED: Per-slide narration scripts. Each entry maps to one slide. Audio is generated per-slide and each slide displays for exactly as long as its narration. R98.2 visuals: by default the tool pre-bakes a real cinematic image for each slide via the gpt-image-2 / DALL-E 3 / Gemini cascade (same engine that powers high-end videos), with Ken Burns motion + crossfade transitions ON. To override, pass `image_prompt` per slide for art direction, or `image_path` to use an existing image. Pass `text_slides_only:true` (top-level) to opt out and use the cheap blue-background text cards instead. R98.1 FAIL-CLOSED: if TTS fails for any slide the tool returns success:false with the failed slide indices — it will NEVER ship a video with silent slides. The narration field MUST be the final voice-over text, NOT planning narrative.",
        },
        pdf_path: { type: "string", description: "Path to PDF slide deck (optional). If missing or corrupt, cinematic AI images are auto-generated per slide (R98.2)." },
        text_slides_only: { type: "boolean", description: "R98.2 — Set true to opt OUT of cinematic image generation and use the cheap blue/black text-card fallback. Default false (cinematic)." },
        title: { type: "string", description: "Video title (used in filename and metadata). Default: 'video'" },
        voice_provider: { type: "string", enum: ["fish", "openai", "elevenlabs", "edge"], description: "TTS provider for narration. Default (R110.3): fish (Fish Audio s2-pro, primary). All providers auto-cascade to OpenAI → Edge on rate-limit/quota errors." },
        voice: { type: "string", description: "Voice name. OpenAI: alloy/echo/fable/onyx/nova/shimmer. Default: onyx." },
        crossfade_ms: { type: "number", description: "Crossfade transition duration in milliseconds between slides. Default: 500. Set 0 for hard cuts." },
        transition_type: { type: "string", enum: ["fade", "fadeblack", "fadewhite", "wipeleft", "wiperight", "wipeup", "wipedown", "slideleft", "slideright", "dissolve", "pixelize", "radial", "circlecrop", "circleopen", "circleclose", "smoothleft", "smoothright", "zoomin"], description: "Transition type between slides. Default: 'fade'." },
        ken_burns: { type: "boolean", description: "Enable Ken Burns effect — slow zoom/pan on each slide for cinematic motion. Default: false." },
        ken_burns_intensity: { type: "number", description: "Ken Burns zoom intensity (1.0-1.5). Default: 1.15." },
        background_music_path: { type: "string", description: "Path to background music file. Mixed at lower volume under narration." },
        music_volume: { type: "number", description: "Background music volume (0.0-1.0). Default: 0.15." },
        email_to: { type: "string", description: "End-user email address. STRONGLY RECOMMENDED whenever the customer expects a deliverable — sends a branded email with a 'Watch Now' button (instant playback, no Drive transcoder wait), a 'Download to your device' button, and a 'Save to Google Drive' link. If you have the customer's email and they're expecting a video, ALWAYS pass it. The watch_url is also returned in the tool result either way, so you can paste it into chat too." },
        project_id: { type: "number", description: "Project ID to register the video file (optional)" },
      },
      required: [],
    },
  },
};

export const planVideoProductionDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "plan_video_production",
    description: "R98.3 — VIDEO DIRECTOR. Use this BEFORE produce_video whenever a user asks for a high-quality narrated video on ANY subject (e.g. 'make a video explaining heat pumps', 'I need a 60-second cinematic ad for my coffee shop', 'turn this article into a video'). You give the director a topic + duration + audience and it returns a fully-structured production plan: per-slide narration written for voice-over, per-slide cinematic image_prompt with art direction, recommended voice + tone, and a ready-to-pass `produce_video_args` object. Then you call `produce_video(...result.produce_video_args, email_to: <customer_email>)` and ship the watch_url. This is the 'thinking layer' that decomposes the request into scenes — you do NOT need to write narration or image prompts yourself; the director does it. Honors target duration (~150 words/min spoken pace). Returns: { plan_summary, slide_count, estimated_duration_sec, produce_video_args }.",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "What the video is about. Be as specific as the user was — pass their exact request through. Example: 'Explain how heat pumps work to a homeowner considering one for their 2000 sq ft house.'" },
        target_duration_seconds: { type: "number", description: "Desired total video length in seconds. Default 60. The director will pick a slide count (typically 1 slide per 8-12s) and pace narration accordingly." },
        audience: { type: "string", description: "Who is watching. Examples: 'homeowners', 'first-time investors', 'small business owners', 'middle-school students'. Drives vocabulary + visual style." },
        tone: { type: "string", description: "Emotional register. Examples: 'educational and warm', 'dramatic cinematic', 'upbeat motivational', 'calm and authoritative', 'fun and playful'. Default: 'professional and engaging'." },
        style_notes: { type: "string", description: "Optional art direction passed verbatim to every image prompt. Examples: 'shot on 35mm film', 'photoreal documentary style', 'flat illustrated infographic style', 'consistent character: a 35-year-old woman with red hair'." },
        source_material: { type: "string", description: "Optional source text (article, transcript, script, notes) the director should ground the video in. Without this the director uses general knowledge of the topic." },
        voice_preference: { type: "string", description: "Optional voice override. OpenAI: alloy/echo/fable/onyx/nova/shimmer. If omitted the director picks the best voice for the tone+audience." },
        call_to_action: { type: "string", description: "Optional final-slide CTA. Example: 'Visit example.com to book a free consultation.' If omitted no CTA slide is added." },
      },
      required: ["topic"],
    },
  },
};

export const createSlideshowVideoDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "create_slideshow_video",
    description: "Create a cinematic video from slide images + audio using FFmpeg. Supports per-slide audio sync, Ken Burns motion effects (zoom/pan on stills for cinematic feel), 30+ transition types (fade, wipe, slide, dissolve, zoom, etc.), background music mixing under narration, and PDF-to-slides conversion.",
    parameters: {
      type: "object",
      properties: {
        pdf_path: { type: "string", description: "Path to a PDF slide deck. Pages will be auto-converted to images." },
        slides: {
          type: "array",
          items: { type: "object", properties: { image_path: { type: "string", description: "Path to image file" }, duration: { type: "number", description: "Duration in seconds (auto-calculated from audio if per-slide audio is provided)" }, audio_path: { type: "string", description: "Per-slide audio file path for perfect sync" } } },
          description: "Array of slide objects with image paths and optional per-slide audio.",
        },
        audio_path: { type: "string", description: "Single audio narration file (mp3/wav). For better sync, use per-slide audio_path in slides array instead." },
        background_music_path: { type: "string", description: "Path to background music file (mp3/wav). Mixed at lower volume under narration for professional feel." },
        music_volume: { type: "number", description: "Background music volume (0.0-1.0). Default: 0.15 (15% — subtle background)." },
        output_filename: { type: "string", description: "Output video filename (without extension). Default: 'slideshow_video'" },
        project_id: { type: "number", description: "Project ID to attach the video file to (optional)" },
        title: { type: "string", description: "Title for the video (used in metadata)" },
        duration_per_slide: { type: "number", description: "Duration in seconds per slide when using pdf_path. Default: auto-calculated from audio length." },
        crossfade_ms: { type: "number", description: "Crossfade transition in milliseconds between slides. Default: 0 (hard cut)." },
        transition_type: { type: "string", enum: ["fade", "fadeblack", "fadewhite", "wipeleft", "wiperight", "wipeup", "wipedown", "slideleft", "slideright", "slideup", "slidedown", "dissolve", "pixelize", "radial", "circlecrop", "circleopen", "circleclose", "smoothleft", "smoothright", "zoomin", "diagtl", "diagtr", "horzopen", "horzclose", "vertopen", "vertclose"], description: "Transition type between slides. Default: 'fade'. Use 'fadeblack' for cinematic, 'dissolve' for elegant, 'wipeleft' for dynamic, 'zoomin' for dramatic." },
        ken_burns: { type: "boolean", description: "Enable Ken Burns effect — slow zoom/pan on each slide for cinematic motion. Makes static images look alive. Default: false." },
        ken_burns_intensity: { type: "number", description: "Ken Burns zoom intensity (1.0-1.5). Default: 1.15 (15% zoom). Higher = more dramatic motion." },
      },
      required: [],
    },
  },
};

export const mpegProduceDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "mpeg_produce",
    description: "HIGH-PERFORMANCE MPEG video production engine with PARALLEL TTS generation. Creates MP4 videos from scenes with narration, images, transitions, and Ken Burns effects. Has a generous 10-minute timeout so it can produce full-length videos without interruption. IMPORTANT: For scenes using a provided image file (like a logo), set imagePath — the engine will display it full-screen without cropping. For AI-generated visuals, set imagePrompt instead. R125+13.16: per-scene OPT-IN Veo (Google's top-tier video gen) via videoClipPrompt — use SELECTIVELY for hero scenes ($0.40-0.75/sec generated, capped at GEMINI_OMNI_FLASH_MAX_SCENES_PER_JOB=12 default), b-roll stays on the cheap still-image + Ken Burns path. Do NOT use introText or outroText. Set crossfadeMs to 0 for reliable playback. Use this for YouTube videos, intro/promo videos, explainer videos, and any standalone video content.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Video title (used in filename, metadata, and Drive upload)" },
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              narration: { type: "string", description: "Narration text for this scene (TTS generated automatically)" },
              title: { type: "string", description: "On-screen title text for this scene" },
              imagePath: { type: "string", description: "Path to an existing image file to use as the scene background" },
              imagePrompt: { type: "string", description: "AI prompt to generate a scene background image (used if imagePath not provided)" },
              videoClipPrompt: { type: "string", description: "R125+13.16 OPT-IN — text prompt for Google Veo 3.1 fast video clip (capped at 8s by adapter, audio drives final length). Per-scene gate; OMIT for cheap still-image+Ken Burns. Use for HERO scenes only (~$0.40-0.75/sec). Auto-falls-back to still-image on any Veo error/quota/wall-budget exceeded — never bricks a render. Per-job cap GEMINI_OMNI_FLASH_MAX_SCENES_PER_JOB (default 12)." },
              durationOverride: { type: "number", description: "Force scene duration in seconds (otherwise auto-calculated from narration length)" },
              qualityTier: { type: "string", enum: ["hero", "broll"], description: "R99 Felix Visual Continuity — 'hero' = best-of-N candidates for image gen (default 3, env VIDEO_HERO_CANDIDATES), 'broll' = single-shot cheap. Omit → first scene auto-promotes to hero, rest are broll." },
            },
          },
          description: "Array of scenes. Each scene can have narration (auto-TTS), a title overlay, and an image (path or AI-generated). Scenes are assembled in order with transitions.",
        },
        voice: { type: "string", description: "TTS voice name. OpenAI: alloy/echo/fable/onyx/nova/shimmer. ElevenLabs: any voice name. Default: onyx." },
        voiceProvider: { type: "string", enum: ["fish", "openai", "elevenlabs", "edge"], description: "TTS provider. Default (R110.5): fish (Fish Audio s2-pro, primary — bypasses OpenAI rate limits). All providers auto-cascade Fish → OpenAI → Edge on rate-limit/quota errors." },
        strictVoice: { type: "boolean", description: "Brand-voice lock (R125+14+sec3). When true, a Fish failure fails the render instead of cascading to a different provider's (non-brand) voice. Required for Built With Bob renders. Default false." },
        resolution: { type: "string", enum: ["720p", "1080p", "4k"], description: "Video resolution. Default: 1080p." },
        fps: { type: "number", description: "Frames per second. Default: 30." },
        transition: { type: "string", enum: ["fade", "fadeblack", "fadewhite", "wipeleft", "wiperight", "dissolve", "pixelize", "radial", "circlecrop", "circleopen", "smoothleft", "smoothright", "zoomin"], description: "Transition between scenes. Default: fade." },
        crossfadeMs: { type: "number", description: "Crossfade duration in milliseconds. Default: 500." },
        kenBurns: { type: "boolean", description: "Enable Ken Burns cinematic motion on scenes. Default: false." },
        kenBurnsIntensity: { type: "number", description: "Ken Burns zoom intensity (1.0-1.5). Default: 1.15." },
        backgroundMusicPath: { type: "string", description: "Path to background music file (mixed under narration)" },
        musicVolume: { type: "number", description: "Background music volume (0.0-1.0). Default: 0.12." },
        introText: { type: "string", description: "Text for auto-generated intro scene (optional)" },
        outroText: { type: "string", description: "Text for auto-generated outro scene (optional)" },
        emailTo: { type: "string", description: "Email address to send the Google Drive link to" },
        projectId: { type: "number", description: "Project ID to register the video in (optional)" },
        uploadToDrive: { type: "boolean", description: "Upload to Google Drive (default: true)" },
      },
      required: ["title", "scenes"],
    },
  },
};

export const mpegProduceParallelDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "mpeg_produce_parallel",
    description: "PARALLEL CHAPTER-BASED video production. Splits a video into chapters, each built by a separate parallel worker (TTS + images + encoding all concurrent), then concatenates into the final MP4. Has a generous 10-minute timeout so it can produce full-length videos without interruption. IMPORTANT: For scenes using a provided image file (like a logo), set imagePath — the engine will display it full-screen without cropping. For AI-generated visuals, set imagePrompt. R125+13.16: per-scene OPT-IN Veo via videoClipPrompt — hero scenes only, b-roll stays on still-image+Ken Burns ($0.40-0.75/sec, per-job cap GEMINI_OMNI_FLASH_MAX_SCENES_PER_JOB=12, auto-fallback on any error). Set crossfadeMs to 0 for reliable playback. Use for any video with multiple chapters or sections.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Video title (used in filename, metadata, and Drive upload)" },
        chapters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              chapterTitle: { type: "string", description: "Name of this chapter (e.g., 'Introduction', 'Architecture', 'Demo')" },
              scenes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    narration: { type: "string", description: "Narration text for this scene (TTS generated automatically)" },
                    title: { type: "string", description: "On-screen title text for this scene" },
                    imagePath: { type: "string", description: "Path to an existing image file" },
                    imagePrompt: { type: "string", description: "AI prompt to generate a scene background image" },
                    videoClipPrompt: { type: "string", description: "R125+13.16 OPT-IN — Google Veo 3.1 fast video clip (≤8s, audio drives final length). Use ONLY for hero scenes (~$0.40-0.75/sec). Auto-falls-back to still-image on Veo error/quota/wall-budget. Per-job cap GEMINI_OMNI_FLASH_MAX_SCENES_PER_JOB (default 12)." },
                    durationOverride: { type: "number", description: "Force scene duration in seconds" },
                    qualityTier: { type: "string", enum: ["hero", "broll"], description: "R99 Felix Visual Continuity — 'hero' = best-of-N candidates for image gen (default 3, env VIDEO_HERO_CANDIDATES), 'broll' = single-shot cheap. Omit → first scene auto-promotes to hero." },
                  },
                },
                description: "Scenes within this chapter",
              },
            },
            required: ["chapterTitle", "scenes"],
          },
          description: "Array of chapters, each with a title and array of scenes. All chapters are produced in parallel (up to maxParallelChapters concurrent).",
        },
        maxParallelChapters: { type: "number", description: "Maximum concurrent chapter workers. Default: 4." },
        voice: { type: "string", description: "TTS voice. Default: onyx." },
        voiceProvider: { type: "string", enum: ["fish", "openai", "elevenlabs", "edge"], description: "TTS provider. Default (R110.5): fish (Fish Audio s2-pro, primary — bypasses OpenAI rate limits). All providers auto-cascade Fish → OpenAI → Edge on rate-limit/quota errors." },
        strictVoice: { type: "boolean", description: "Brand-voice lock (R125+14+sec3). When true, a Fish failure fails the render instead of cascading to a different provider's (non-brand) voice. Required for Built With Bob renders. Default false." },
        resolution: { type: "string", enum: ["720p", "1080p", "4k"], description: "Video resolution. Default: 1080p." },
        fps: { type: "number", description: "Frames per second. Default: 30." },
        transition: { type: "string", enum: ["fade", "fadeblack", "fadewhite", "wipeleft", "wiperight", "dissolve", "pixelize", "radial", "smoothleft", "smoothright", "zoomin"], description: "Transition between chapters. Default: fade." },
        crossfadeMs: { type: "number", description: "Crossfade duration in milliseconds. Default: 400." },
        kenBurns: { type: "boolean", description: "Enable Ken Burns motion on scenes. Default: false." },
        kenBurnsIntensity: { type: "number", description: "Ken Burns intensity (1.0-1.5). Default: 1.15." },
        backgroundMusicPath: { type: "string", description: "Path to background music file" },
        musicVolume: { type: "number", description: "Background music volume (0.0-1.0). Default: 0.12." },
        emailTo: { type: "string", description: "Email address to send the Drive link to" },
        projectId: { type: "number", description: "Project ID to register the video in" },
        uploadToDrive: { type: "boolean", description: "Upload to Google Drive (default: true)" },
      },
      required: ["title", "chapters"],
    },
  },
};

export const mpegConcatDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "mpeg_concat",
    description: "Concatenate multiple video clips into a single MP4. Supports transitions between clips. Use for joining separate video segments, combining b-roll, or assembling multi-part videos.",
    parameters: {
      type: "object",
      properties: {
        clipPaths: { type: "array", items: { type: "string" }, description: "Array of file paths to video clips to join (in order)" },
        outputName: { type: "string", description: "Output filename (without extension)" },
        transition: { type: "string", description: "Transition type between clips (e.g., fade, dissolve). Default: none (hard cut)." },
        crossfadeMs: { type: "number", description: "Crossfade duration in milliseconds. Default: 0." },
      },
      required: ["clipPaths", "outputName"],
    },
  },
};

export const mpegAddAudioDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "mpeg_add_audio",
    description: "Use when finalizing a video deliverable that needs voice-over, music bed, or sound mix — typically AFTER produce_video has rendered the visual track and generate_audio has produced the narration. Two modes: replace original audio entirely, OR mix new audio under existing audio at a chosen ratio. Returns the new video file path.",
    parameters: {
      type: "object",
      properties: {
        videoPath: { type: "string", description: "Path to the input video file" },
        audioPath: { type: "string", description: "Path to the audio file to add" },
        outputName: { type: "string", description: "Output filename (without extension)" },
        replaceAudio: { type: "boolean", description: "If true, replaces original audio. If false, mixes both tracks. Default: false." },
      },
      required: ["videoPath", "audioPath"],
    },
  },
};

/** Full ordered set (facade array order), for any consumer that wants the
 * domain's definitions. */
export const mediaDomainDefinitions: ToolDefinition[] = [
  generateAudioDefinition,
  produceVideoDefinition,
  planVideoProductionDefinition,
  createSlideshowVideoDefinition,
  mpegProduceDefinition,
  mpegProduceParallelDefinition,
  mpegConcatDefinition,
  mpegAddAudioDefinition,
];
