/**
 * Tools-layer-split S31 — character-portraits domain tool definitions.
 *
 * Felix Visual Continuity portrait-registry family (3 tools):
 * `register_character_portrait` + `list_character_portraits` +
 * `init_character_portraits`. Definitions are a VERBATIM lift of the inline
 * object literals previously in server/tools.ts's TOOL_DEFINITIONS array —
 * same name/description/parameters (the LLM-facing contract is byte-identical);
 * only their storage location changes. The facade re-imports these const refs
 * and splices them back at their original array positions.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const registerCharacterPortraitDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "register_character_portrait",
    description: "R99 — Felix Visual Continuity (ViMax #1). Manually add ONE canonical portrait of a recurring character or environment to the tenant's portrait registry. Identifier+view is the natural key (UPSERT — second call for same key replaces image_path). Views: 'front' | 'three_quarter' | 'side' | 'back' | 'env'. Use this when the customer uploads their own face/product/location photo and you want to skip generation. For automatic batch generation use init_character_portraits instead.",
    parameters: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Stable id for the character/asset, e.g. 'bob', 'sarah', 'gym_background'. Lowercased + underscored automatically." },
        view: { type: "string", description: "Which view this portrait represents. 'front' | 'three_quarter' | 'side' | 'back' | 'env'." },
        image_path: { type: "string", description: "Local path to the portrait file (must exist on disk)." },
        description: { type: "string", description: "Short description used by the reference selector (e.g. '35yo man, dark beard, blue eyes, athletic build')." },
      },
      required: ["identifier", "view", "image_path"],
    },
  },
};

export const listCharacterPortraitsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "list_character_portraits",
    description: "R99 — Felix Visual Continuity (ViMax #1). List every portrait in this tenant's registry, optionally filtered to one identifier. Call this BEFORE start_video_job to check whether a recurring character already has portraits — if not, call init_character_portraits.",
    parameters: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "Optional — return only portraits for this identifier. Omit to list all." },
      },
    },
  },
};

export const initCharacterPortraitsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "init_character_portraits",
    description: "R99 — Felix Visual Continuity (ViMax #1). Generate the canonical multi-view portrait set for one or more recurring characters/assets and store them in the registry. IDEMPOTENT — portraits already in the registry are skipped (no re-generation cost). Generates via gpt-image-2; views default to ['front','three_quarter','side']. HARD CAPS: 5 characters × 4 views per call. Once a character is in the registry, every video job rendered by mpeg-engine will automatically pull these portraits as visual references and pass them to gpt-image-2 — that's what stops 'character looks different in every shot.' Returns {created, skipped, failed}.",
    parameters: {
      type: "object",
      properties: {
        characters: {
          type: "array",
          description: "Up to 5 character/asset definitions.",
          items: {
            type: "object",
            properties: {
              identifier: { type: "string", description: "Stable id, e.g. 'bob'." },
              description: { type: "string", description: "Detailed visual description used to generate the portrait (age, build, hair, clothing, distinguishing features)." },
              views: { type: "array", items: { type: "string" }, description: "Optional override of view set. Default ['front','three_quarter','side']. Max 4 views." },
              source_image_path: { type: "string", description: "Optional reference photo to seed every portrait (e.g. customer's uploaded face) so the registry portraits match the real person." },
            },
            required: ["identifier", "description"],
          },
        },
        default_views: { type: "array", items: { type: "string" }, description: "Optional default view set applied to characters that don't specify their own. Default ['front','three_quarter','side']." },
      },
      required: ["characters"],
    },
  },
};

export const characterPortraitsDomainDefinitions: ToolDefinition[] = [
  registerCharacterPortraitDefinition,
  listCharacterPortraitsDefinition,
  initCharacterPortraitsDefinition,
];
