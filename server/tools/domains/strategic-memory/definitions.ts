/**
 * Tools-layer-split S26h — strategic-memory-domain tool definitions.
 *
 * The strategic-lesson / strategic-win reflection memory family (4 tools):
 * `record_failure_pattern` / `recall_failure_patterns` (R98.7) and their
 * SUCCESS mirror `record_strategic_win` / `recall_strategic_wins` (R98.12 W7).
 * All four persist to / read from `memory_entries` (categories
 * 'strategic_lesson' / 'strategic_win') via INLINE db logic — no backing lib.
 *
 * Definitions are moved VERBATIM from the legacy TOOL_DEFINITIONS array (they
 * were inline object literals, not pre-existing const refs); the facade now
 * re-imports these const refs so the LLM-facing surface (name, description,
 * parameter schema, ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const recordFailurePatternDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "record_failure_pattern",
    description: "R98.7 — Record a strategic mistake you (or another persona) just made so you don't repeat it next session. Persisted into memory_entries with category='strategic_lesson' and surfaced by recall_failure_patterns at the start of any related task. USE THIS whenever Bob points out a regression, OR you catch yourself making a mistake you've made before, OR a tool result reveals a planning failure (not just a parameter typo — those are handled by the existing self_reflection lesson loop). Be concrete: name the pattern, the trigger, the fix, and a one-line self-check question. Stored per-tenant + per-persona.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Short name for the mistake, e.g. 'planning-prose narration', 'forgot photo on first-person slide', 'silent quit on tool error'." },
        trigger: { type: "string", description: "When this mistake tends to happen — the situation/context. e.g. 'producing a video with 4+ slides', 'on the LAST step of a multi-tool task'." },
        fix: { type: "string", description: "What to do instead, in actionable terms. e.g. 'call plan_video_production first; never write narration myself'." },
        self_check: { type: "string", description: "A one-line question I should ask myself to catch this regression. e.g. 'do any narration strings sound like a table of contents?'" },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "How bad it gets if it recurs. critical = customer-facing breakage; high = wasted hour of work; medium = annoying; low = cosmetic." },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags so future recall can filter (e.g. ['video','tts'], ['delivery','drive'], ['code'])." },
      },
      required: ["pattern", "trigger", "fix", "severity"],
    },
  },
};

export const recallFailurePatternsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "recall_failure_patterns",
    description: "R98.7 — Pull your past strategic mistakes so you don't repeat them. CALL THIS at the START of any non-trivial task and AGAIN before declaring it done. Returns the most recently-recorded patterns for this persona/tenant, optionally filtered by tags. Pair with the static `data/personas/felix/known-failure-patterns.md` file (loaded automatically into context for Felix); this tool returns the LIVE additions Bob and you have recorded since.",
    parameters: {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" }, description: "Optional tags to filter by (e.g. ['video'] or ['code','delivery']). Empty = all recent patterns." },
        limit: { type: "number", description: "Max patterns to return (default 10, max 50)." },
      },
      required: [],
    },
  },
};

export const recordStrategicWinDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "record_strategic_win",
    description: "R98.12 W7 — Mirror of record_failure_pattern for SUCCESSES. Persist a strategic WIN (a planning move, tool combination, prompt approach, or workflow that produced an unusually good outcome) so recall_strategic_wins can surface it next session. Use whenever Bob praises a result, OR you notice you nailed something on the first try, OR a tool combination produced a deliverable Felix would normally botch. Be concrete: name the win, the trigger that prompted it, the technique, and a one-line do-this-again cue. Stored per-tenant + per-persona under category='strategic_win'.",
    parameters: {
      type: "object",
      properties: {
        win: { type: "string", description: "Short name of the winning move. ≤200 chars. E.g. 'Two-call director→produce_video pattern produced 30s ad in one shot'." },
        trigger: { type: "string", description: "What conditions/request caused you to use this move. ≤500 chars." },
        technique: { type: "string", description: "The specific technique/tool sequence/prompt shape that worked. ≤500 chars." },
        do_this_again: { type: "string", description: "One-line cue to remind your future self when to repeat this. ≤300 chars." },
        impact: { type: "string", enum: ["low", "medium", "high", "exemplar"], description: "How much this beat baseline. 'exemplar' = recallable as a gold-standard example." },
        tags: { type: "array", items: { type: "string" }, description: "Lowercase tags for filtering." },
      },
      required: ["win", "trigger", "technique", "impact"],
    },
  },
};

export const recallStrategicWinsDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "recall_strategic_wins",
    description: "R98.12 W7 — Pull strategic wins recorded by record_strategic_win, tenant + persona scoped. Optional tag filter. CALL THIS at task start (alongside recall_failure_patterns) so you start from your best known patterns instead of cold. Returns parsed structured rows including win, trigger, technique, do_this_again cue, impact, tags, recorded_at.",
    parameters: {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" }, description: "Optional. Substring-match against any tag." },
        impact_min: { type: "string", enum: ["low", "medium", "high", "exemplar"], description: "Optional minimum impact threshold. Default 'low' (return all)." },
        limit: { type: "number", description: "Max rows. Default 20, capped 100." },
      },
      required: [],
    },
  },
};

export const strategicMemoryDomainDefinitions: ToolDefinition[] = [
  recordFailurePatternDefinition,
  recallFailurePatternsDefinition,
  recordStrategicWinDefinition,
  recallStrategicWinsDefinition,
];
