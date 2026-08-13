/**
 * tool-smoke-core — PURE logic for the staged Tool Smoke-Test & Documentation
 * Program. No DB / LLM / filesystem / tenant here (so it is query-free unit-
 * testable + lives in tsc scope per the offline-eval invariant). The thin driver
 * in `scripts/tool-smoke-test.ts` reads the real tool registry SoT and does IO.
 *
 * The program's goal: incrementally smoke-test + document every registered agent
 * tool in small stages so coverage is trustworthy over a few weeks, rather than a
 * single risky big-bang invocation of all ~394 tools.
 *
 * SMOKE CLASS — decides whether a tool MAY be auto live-invoked in a smoke run:
 *   - "live-safe": risk=safe, non-network, fast/normal speed, no approval / trusted
 *     / value-cap / irreversible gate. Cheap, side-effect-free → safe to invoke.
 *   - "doc-only": anything destructive/sensitive/network/slow/gated. NEVER auto-
 *     invoked; documented + flagged for a deliberate human-in-the-loop smoke.
 */

export type SmokeClass = "live-safe" | "doc-only";

/** Minimal projection of a tool's registry + policy facts the classifier needs.
 *  Mirrors the real shapes in server/tool-registry.ts (ToolMeta) and
 *  server/safety/destructive-tool-policy.ts (ToolPolicy) without importing them
 *  (keeps this module pure + dependency-light for unit tests). */
export interface ToolSmokeInput {
  name: string;
  description?: string;
  categories?: string[];
  /** ToolMeta.speed — "fast" | "normal" | "slow" | "very_slow"; undefined ⇒ unregistered meta. */
  speed?: string;
  /** ToolMeta.isNetworkTool — true ⇒ touches the network (external/costly/side-effecting). */
  isNetworkTool?: boolean;
  /** TOOL_POLICIES[name].risk — "safe" | "sensitive" | "destructive"; undefined ⇒ unlisted (treated safe). */
  risk?: string;
  /** Human-facing severity label, e.g. LOW/MEDIUM/HIGH/CRITICAL. */
  riskClass?: string;
  requiresApproval?: boolean;
  trustedPersonasOnly?: boolean;
  requiresStructuredArgs?: boolean;
  hasValueCap?: boolean;
  irreversible?: boolean;
  /** True ⇒ the tool has an explicit entry in TOOL_POLICIES (vs. defaulting safe).
   *  DOCUMENTATION ONLY — not disqualifying. The structural fail-closed lives in
   *  `risk` (caller passes getEffectiveToolRisk(), which name-infers destructive
   *  for an unregistered suspicious name). Surfaced in the worklist verdict so a
   *  reviewer can see whether a tool's safe posture is declared or merely default. */
  explicitPolicy?: boolean;
}

/** One fully-classified tool row written to the manifest. */
export interface ToolSmokeRecord extends ToolSmokeInput {
  smokeClass: SmokeClass;
  /** Why the tool landed in its class (the gates that forced doc-only). */
  reasons: string[];
}

/**
 * Classify a tool fail-safe: a tool is live-safe ONLY when nothing about it can
 * mutate state, move money, hit the network, cost real tokens, or require a gate.
 * Any uncertainty (unregistered meta, suspicious risk) lands it in doc-only.
 */
export function classifySmoke(t: ToolSmokeInput): { smokeClass: SmokeClass; reasons: string[] } {
  const reasons: string[] = [];

  // NOTE on fail-closed: in this codebase TOOL_POLICIES is a *dangerous-tool*
  // registry — safe tools intentionally have no entry and default to safe. The
  // fail-closed guard for an unregistered dangerous tool is therefore NAME
  // INFERENCE (a suspicious name resolves risk=destructive), which the caller
  // MUST resolve via getEffectiveToolRisk() and pass in as `risk` here. So an
  // absent explicit policy is NOT itself disqualifying (that would empty the
  // live-safe set); `explicitPolicy` is surfaced as documentation only.
  const risk = (t.risk ?? "safe").toLowerCase();
  if (risk === "destructive") reasons.push("risk=destructive");
  else if (risk === "sensitive") reasons.push("risk=sensitive");
  else if (risk !== "safe") reasons.push(`risk=${risk} (unknown ⇒ doc-only)`);

  if (t.isNetworkTool) reasons.push("network tool (external/costly side-effect)");

  const speed = (t.speed ?? "").toLowerCase();
  if (speed === "slow" || speed === "very_slow") reasons.push(`speed=${speed} (likely LLM/expensive)`);
  else if (!t.speed) reasons.push("no registry meta (unregistered ⇒ doc-only)");

  if (t.requiresApproval) reasons.push("requiresApproval (HITL)");
  if (t.trustedPersonasOnly) reasons.push("trustedPersonasOnly");
  if (t.hasValueCap) reasons.push("has maxValue cap (moves a measured quantity)");
  if (t.irreversible) reasons.push("irreversible (snapshot-guarded)");

  return { smokeClass: reasons.length === 0 ? "live-safe" : "doc-only", reasons };
}

/** Build the manifest record for one tool. */
export function buildSmokeRecord(t: ToolSmokeInput): ToolSmokeRecord {
  const { smokeClass, reasons } = classifySmoke(t);
  return { ...t, smokeClass, reasons };
}

/**
 * Partition tool names into deterministic, stable stages. Names are sorted first
 * so the same tool always lands in the same stage across runs (stability is what
 * lets the program resume across weeks). Throws fail-closed on a bad stage size.
 */
export function partitionStages(names: string[], stageSize: number): string[][] {
  if (!Number.isInteger(stageSize) || stageSize < 1) {
    throw new Error(`partitionStages: stageSize must be a positive integer, got ${stageSize}`);
  }
  const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  const stages: string[][] = [];
  for (let i = 0; i < sorted.length; i += stageSize) {
    stages.push(sorted.slice(i, i + stageSize));
  }
  return stages;
}

/** 1-based stage number a given tool falls in (0 if not found). */
export function stageOfTool(stages: string[][], name: string): number {
  for (let i = 0; i < stages.length; i++) {
    if (stages[i].includes(name)) return i + 1;
  }
  return 0;
}

export interface SmokeProgress {
  totalTools: number;
  totalStages: number;
  stageSize: number;
  completedStages: number[];
  completedStageCount: number;
  toolsVerified: number;
  toolsPending: number;
  liveSafeCount: number;
  docOnlyCount: number;
  /** 1-based next stage to work, or 0 when every stage is complete. */
  nextStage: number;
  percentComplete: number;
}

/**
 * Compute program progress from the records, the stage partition, and the set of
 * tool NAMES already signed off. Progress is tracked by tool name (not by bare
 * stage number) so it survives registry churn: if a tool is added/removed/renamed
 * between sessions and stage membership shifts, completion recomputes correctly —
 * a stage counts as complete ONLY when every tool currently in it is signed off.
 * Unknown names in the raw set are ignored (a removed tool can't over-count).
 */
export function computeProgress(
  records: ToolSmokeRecord[],
  stages: string[][],
  stageSize: number,
  completedToolsRaw: string[],
): SmokeProgress {
  const totalStages = stages.length;
  const known = new Set(records.map((r) => r.name));
  const completedTools = new Set((completedToolsRaw ?? []).filter((n) => typeof n === "string" && known.has(n)));

  const completedStages: number[] = [];
  let nextStage = 0;
  for (let i = 0; i < totalStages; i++) {
    const stage = stages[i];
    const done = stage.length > 0 && stage.every((name) => completedTools.has(name));
    if (done) completedStages.push(i + 1);
    else if (nextStage === 0) nextStage = i + 1;
  }

  const toolsVerified = records.filter((r) => completedTools.has(r.name)).length;
  const liveSafeCount = records.filter((r) => r.smokeClass === "live-safe").length;

  return {
    totalTools: records.length,
    totalStages,
    stageSize,
    completedStages,
    completedStageCount: completedStages.length,
    toolsVerified,
    toolsPending: Math.max(0, records.length - toolsVerified),
    liveSafeCount,
    docOnlyCount: records.length - liveSafeCount,
    nextStage,
    percentComplete: totalStages === 0 ? 0 : Math.round((completedStages.length / totalStages) * 100),
  };
}

/** Compact, doc-friendly summary of a JSON-schema parameters object. */
export function summarizeParams(parameters: any): Array<{ name: string; type: string; required: boolean }> {
  const props = parameters?.properties;
  if (!props || typeof props !== "object") return [];
  const required: string[] = Array.isArray(parameters?.required) ? parameters.required : [];
  return Object.keys(props).map((name) => {
    const p = props[name] ?? {};
    const type = Array.isArray(p.type) ? p.type.join("|") : (p.type ?? (p.enum ? "enum" : "any"));
    return { name, type: String(type), required: required.includes(name) };
  });
}
