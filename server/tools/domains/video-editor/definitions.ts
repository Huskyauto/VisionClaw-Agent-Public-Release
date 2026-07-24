/**
 * Tools-layer-split S30 — video-editor-domain tool definitions.
 *
 * The word-level video auto-editing family (3 tools):
 * `video_transcribe_words` + `video_cut_fillers` + `video_burn_captions`.
 * Definitions are a VERBATIM lift of the inline object literals previously in
 * server/tools.ts's TOOL_DEFINITIONS array — same name/description/parameters
 * (the LLM-facing contract is byte-identical); only their storage location
 * changes. The facade re-imports these const refs and splices them back at
 * their original array positions.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const videoTranscribeWordsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "video_transcribe_words",
    description: "Transcribe a video or audio file with WORD-LEVEL timestamps and speaker labels using ElevenLabs Scribe. Returns words[] with {word, start, end, speaker}. Use this BEFORE video_cut_fillers or video_burn_captions — both need the words[] output. Accepts a local path or /uploads/<file>.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", description: "Path to the video/audio file (mp4, mp3, wav, m4a, webm). Accepts /uploads/<filename> or absolute paths." },
      },
      required: ["source"],
    },
  },
};

export const videoCutFillersDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "video_cut_fillers",
    description: "Auto-edit a raw video by cutting filler words (um, uh, like, you know...) and dead silence. Pass the words[] from video_transcribe_words. Renders a polished MP4 with 30ms audio fades at every cut so it sounds clean. Optional: upload result to Drive and share the link.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", description: "Path to the source video file." },
        words: { type: "array", items: { type: "object" }, description: "words[] array from video_transcribe_words" },
        customFillers: { type: "array", items: { type: "string" }, description: "Extra filler words to cut beyond the defaults" },
        cutSilenceLongerThan: { type: "number", description: "Cut silences longer than this many seconds. Default 0.6." },
        outputName: { type: "string", description: "Output filename (without extension). Default: cut-<timestamp>." },
        uploadToDrive: { type: "boolean", description: "Upload finished MP4 to Drive and return shareable link. Default true." },
        driveLabel: { type: "string", description: "Drive folder label. Default: 'Video Editor Output'." },
      },
      required: ["source", "words"],
    },
  },
};

export const videoBurnCaptionsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "video_burn_captions",
    description: "Burn TikTok/Reels-style captions onto a video — short UPPERCASE chunks (default 2 words at a time) timed to the speech. Pass the words[] from video_transcribe_words. Returns a new MP4 with captions baked in. Optional Drive upload.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", description: "Path to the source video file." },
        words: { type: "array", items: { type: "object" }, description: "words[] array from video_transcribe_words" },
        wordsPerChunk: { type: "number", description: "Words per caption chunk. Default 2." },
        fontSize: { type: "number", description: "Caption font size in pixels. Default 64." },
        upperCase: { type: "boolean", description: "Force UPPERCASE. Default true." },
        position: { type: "string", enum: ["bottom", "center", "top"], description: "Caption position. Default bottom." },
        outputName: { type: "string", description: "Output filename (without extension)." },
        uploadToDrive: { type: "boolean", description: "Upload finished MP4 to Drive. Default true." },
        driveLabel: { type: "string", description: "Drive folder label. Default: 'Video Editor Output'." },
      },
      required: ["source", "words"],
    },
  },
};

export const videoEditorDomainDefinitions: ToolDefinition[] = [
  videoTranscribeWordsDefinition,
  videoCutFillersDefinition,
  videoBurnCaptionsDefinition,
];
