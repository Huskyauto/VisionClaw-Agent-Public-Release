/**
 * Tools-layer-split S25y — voice-profile-domain tool definitions.
 *
 * The 2 per-tenant brand-voice tools (`build_voice_profile`, `get_voice_profile`,
 * R79 MarTech Bundle) — a single coherent cluster backed solely by
 * `server/martech-bundle` (`buildVoiceProfile` / `getVoiceProfile`). Grep confirmed
 * these are the ONLY two callers of those two backing fns.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they were
 * inline object literals, not pre-existing const refs); the facade now re-imports
 * these const refs so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const buildVoiceProfileDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "build_voice_profile",
    description: "R79 (MarTech Bundle, after Charlie Hills' voice-builder MIT) — synthesize a per-tenant brand-voice profile (about-me.md + voice.md + topic pillars + audience) from interview answers plus 1-10 raw writing samples. Stored in tenant_voice_profiles, unique on (tenantId, profileName), default profile name 'default'. Subsequent calls upsert and bump version. Read by generate_hooks, format_post, generate_content_matrix, score_post so the output sounds consistent across channels. Use whenever a tenant onboards, refreshes their voice, or wants a second persona-style profile (e.g. profileName='formal').",
    parameters: {
      type: "object",
      properties: {
        profile_name: { type: "string", description: "Optional name for this profile (default 'default'). Use to keep multiple voices, e.g. 'default' / 'formal' / 'newsletter'." },
        about_me_answers: { type: "string", description: "Free-form interview answers — name, role, company, audience, what they actually do, beliefs, recurring stories." },
        samples: { type: "array", items: { type: "string" }, description: "1-10 raw writing samples (>=50 chars each) the LLM analyzes to derive voice rules." },
        pillars: { type: "array", items: { type: "string" }, description: "Optional explicit topic pillars. If omitted, derived from samples." },
        audience: { type: "string", description: "Optional explicit audience description. If omitted, derived from samples." },
      },
      required: ["about_me_answers", "samples"],
    },
  },
};

export const getVoiceProfileDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "get_voice_profile",
    description: "R79 — fetch a stored voice profile (about-me + voice + pillars + audience) for the current tenant. Use to inspect what is currently in force or to copy a profile into another channel-specific persona. Returns null when no profile exists for that name.",
    parameters: {
      type: "object",
      properties: {
        profile_name: { type: "string", description: "Profile name to fetch (default 'default')." },
      },
    },
  },
};

export const voiceProfileDomainDefinitions: ToolDefinition[] = [
  buildVoiceProfileDefinition,
  getVoiceProfileDefinition,
];
