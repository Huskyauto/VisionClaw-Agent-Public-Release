/**
 * Tools-layer-split S25x — design-doc-domain tool definitions.
 *
 * The 1 native design-language extraction tool (`generate_design_doc`, R125+37 —
 * URL → semantic DESIGN.md) — a single coherent cluster backed solely by
 * `server/design-doc-tool` (`generateDesignDoc`). (`deep_research`, the other
 * web-adjacent remainder, was already migrated to the research domain; it is NOT
 * part of this slice.)
 *
 * The definition is moved VERBATIM from the legacy TOOL_DEFINITIONS array (it was
 * an inline object literal, not a pre-existing const ref); the facade now
 * re-imports this const ref so the LLM-facing surface (name, description,
 * parameter schema, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const generateDesignDocDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "generate_design_doc",
    description: "R125+37 — Reverse-engineer ANY public web page's visual design language into a structured, reusable DESIGN.md. Fetches the page's HTML + same-origin CSS (SSRF-jailed, https-only) and runs ONE synthesis pass that extracts: color ROLES + relationships, typography (families/scale/weights), spacing & layout rhythm, recurring component patterns, visual voice, and reuse do/don'ts. Native — no external service (refero.design-inspired). Use BEFORE recreating/cloning a site's look, when a user says 'make it look like <url>', or to capture a brand's design system as an agent-readable artifact. Set persist=true to also save it under project-assets/design-docs/. Returns markdown in design_md (raw fetched HTML is fenced internally and never returned to the caller).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public https:// URL of the page to analyze. Must resolve to a public host — private/internal/metadata/loopback addresses are rejected (SSRF jail)." },
        persist: { type: "boolean", description: "Optional. If true, also writes the DESIGN.md to project-assets/design-docs/<host>-DESIGN.md and returns persisted_path. Default false (returns the doc inline only)." },
      },
      required: ["url"],
    },
  },
};

export const designDocDomainDefinitions: ToolDefinition[] = [
  generateDesignDocDefinition,
];
