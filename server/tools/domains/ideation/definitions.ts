/**
 * Tools-layer-split S26e — ideation-domain tool definition.
 *
 * The single structured-ideation tool (`ideation_session`) — backed solely by
 * `server/ideation-engine` (`runIdeationSession` / `formatIdeationAsMarkdown`).
 *
 * Definition is moved VERBATIM from the legacy TOOL_DEFINITIONS array (it was an
 * inline object literal, not a pre-existing const ref); the facade now re-imports
 * this const ref so the LLM-facing surface (name, description, parameter schema,
 * ordering) is byte-identical.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolDefinition } from "../../types";

export const ideationSessionDefinition: ToolDefinition = {
  type: "function",
  function: {
    name: "ideation_session",
    description: "Run a structured ideation session using proven innovation frameworks (SCAMPER, First Principles, Jobs to Be Done, Pre-mortem, How Might We, Constraint-Based). Takes a raw idea through 3 phases: Diverge (expand with 5-8 variations), Converge (stress-test 2-3 directions), Ship (produce an actionable one-pager with MVP scope, assumptions, and a Not Doing list). Use when brainstorming business ideas, product features, strategy pivots, or any creative problem-solving.",
    parameters: {
      type: "object",
      properties: {
        idea: { type: "string", description: "The raw idea or problem to explore" },
        phase: { type: "string", enum: ["diverge", "converge", "ship", "full"], description: "Which phase to run. 'full' runs all three phases in sequence. 'diverge' expands the idea, 'converge' evaluates directions, 'ship' produces the one-pager." },
        frameworks: { type: "array", items: { type: "string", enum: ["scamper", "first_principles", "jtbd", "premortem", "hmw", "constraints"] }, description: "Which frameworks to apply. Default: scamper, first_principles, jtbd, premortem." },
        context: { type: "string", description: "Additional context about the business, market, or constraints" },
        save_as_note: { type: "boolean", description: "Save the results as a daily note. Default false." },
      },
      required: ["idea"],
    },
  },
};

export const ideationDomainDefinitions: ToolDefinition[] = [
  ideationSessionDefinition,
];
