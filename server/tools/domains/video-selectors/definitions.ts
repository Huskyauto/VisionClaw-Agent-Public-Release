/**
 * Tools-layer-split S32 — video-selectors-domain tool definitions.
 *
 * The Felix Visual Continuity (ViMax) frame-selection family (2 tools):
 * `select_references_for_frame` + `select_best_image`.
 * Definitions are a VERBATIM lift of the inline object literals previously in
 * server/tools.ts's TOOL_DEFINITIONS array — same name/description/parameters
 * (the LLM-facing contract is byte-identical); only their storage location
 * changes. The facade re-imports these const refs and splices them back at
 * their original array positions.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const selectReferencesForFrameDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "select_references_for_frame",
    description: "R99 — Felix Visual Continuity (ViMax #1, second half). For a target frame description and a video job_id, pick the ≤8 most-relevant references from the pool (tenant portraits + recent prior frames in this job) AND return the prompt-prefix that names them ('Image 0 = bob (front view), Image 2 = prior frame_5: gym establishing shot, generate a new image where ...'). Normally you don't call this directly — mpeg-engine calls it automatically before each scene's image generation. Exposed as a tool so you can dry-run a frame selection during planning.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "Video job id (vj_... or mpeg_...). If omitted, only registry portraits are considered." },
        frame_description: { type: "string", description: "What the next frame should show. Drives the LLM's reference picks." },
        max_references: { type: "number", description: "Cap on returned references (1-8, default 8)." },
      },
      required: ["frame_description"],
    },
  },
};

export const selectBestImageDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "select_best_image",
    description: "R99 — Felix Visual Continuity (ViMax #2). Given N candidate images (typically 3-4 generated for the same target frame) plus their reference shots, ask a vision LLM to grade each on character_consistency / spatial_consistency / description_accuracy and return the winner. Used by mpeg-engine for HERO frames (first scene per chapter or quality_tier='hero'); B-roll frames stay single-shot. Cost is N× the per-image cost. Returns {winner_index, winner_path, reason, scores, per_candidate}.",
    parameters: {
      type: "object",
      properties: {
        candidates: { type: "array", items: { type: "string" }, description: "Local paths to ≥2 candidate images (all generated for the SAME target frame)." },
        references: { type: "array", items: { type: "string" }, description: "Optional ≤4 reference image paths (portraits + prior frames) the candidates should match." },
        target_description: { type: "string", description: "What the frame is supposed to show (drives the description_accuracy axis)." },
      },
      required: ["candidates", "target_description"],
    },
  },
};

export const videoSelectorsDomainDefinitions: ToolDefinition[] = [
  selectReferencesForFrameDefinition,
  selectBestImageDefinition,
];
