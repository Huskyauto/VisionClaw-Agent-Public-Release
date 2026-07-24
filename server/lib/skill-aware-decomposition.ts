// Proactive skill-aware re-decomposition (SkillWeaver "Skill-Aware Decomposition",
// arXiv:2606.18051). The paper's empirical finding is that decomposition quality is
// the primary bottleneck for compositional skill routing, and that re-decomposing a
// plan *conditioned on the skills that actually exist* — before executing — buys a
// large accuracy gain in a single iteration. VisionClaw's task planner previously
// only discovered an unusable tool reactively (a step fails at execution → costly
// replanFromFailure). This module holds the PURE detection logic so it can be unit
// tested without importing server/tools.ts (which opens the Postgres pool at load).

// Tools that the task planner is not permitted to dispatch (mirrors the guard in
// server/task-planner.ts executeStep). A decomposed step that references one of
// these is a guaranteed reactive failure, so we catch it at planning time instead.
export const PLANNER_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  "plan_and_execute",
  "sessions_spawn",
  "subagents",
  "lobster",
  "exec",
  "run_self_improvement",
]);

export interface DecomposedStepLike {
  id: number;
  action: string;
  tool?: string;
}

export interface ToolIssue {
  id: number;
  action: string;
  tool: string;
  reason: "blocked" | "unknown";
}

// Returns the steps whose assigned tool cannot actually be run: either it is
// blocked inside the planner, or it is not a registered/available tool at all
// (the LLM hallucinated a name, or named a tool the planner can't reach).
export function findUnsupportedToolSteps(
  steps: ReadonlyArray<DecomposedStepLike>,
  availableTools: ReadonlySet<string>,
): ToolIssue[] {
  const issues: ToolIssue[] = [];
  for (const s of steps) {
    const tool = s.tool;
    if (!tool || tool === "none") continue;
    if (PLANNER_BLOCKED_TOOLS.has(tool)) {
      issues.push({ id: s.id, action: s.action, tool, reason: "blocked" });
      continue;
    }
    // Fail-open: if the registry is empty (e.g. an import-order race before
    // server/tools.ts has registered anything), do NOT flag every step as
    // unknown — that would force a pointless, possibly-worse re-decomposition.
    if (availableTools.size > 0 && !availableTools.has(tool)) {
      issues.push({ id: s.id, action: s.action, tool, reason: "unknown" });
    }
  }
  return issues;
}

// Human/LLM-readable feedback block describing each unusable-tool step, fed back
// into the re-decomposition prompt so the planner re-plans with full knowledge of
// which tools it may NOT use.
export function buildRefineFeedback(issues: ReadonlyArray<ToolIssue>): string {
  return issues
    .map(
      (i) =>
        `- Step "${i.action}" uses tool "${i.tool}" which is ${
          i.reason === "blocked"
            ? "BLOCKED inside the task planner"
            : "NOT a registered/available tool"
        }.`,
    )
    .join("\n");
}

// Structural validity of a (re)decomposed plan: every dependsOn must point at a
// real, non-self step id, and the dependency graph must be acyclic. A refine pass
// that fixes a tool name but corrupts the dependency graph is operationally WORSE,
// not better — canRun() in the executor only runs a step once all its deps are
// done/skipped, so a dangling or cyclic dep leaves steps permanently pending →
// skipped. Returns an empty array when the plan is structurally sound.
export function findStructuralIssues(
  steps: ReadonlyArray<{ id: number; dependsOn?: number[] }>,
): string[] {
  const issues: string[] = [];
  const ids = new Set(steps.map((s) => s.id));
  for (const s of steps) {
    for (const d of s.dependsOn ?? []) {
      if (!Number.isInteger(d)) {
        issues.push(`step ${s.id} has non-integer dependency ${d}`);
      } else if (d === s.id) {
        issues.push(`step ${s.id} depends on itself`);
      } else if (!ids.has(d)) {
        issues.push(`step ${s.id} depends on unknown step ${d}`);
      }
    }
  }
  // Only run cycle detection once all dependency references are known-valid.
  if (issues.length === 0) {
    const indeg = new Map<number, number>();
    const succ = new Map<number, number[]>();
    for (const s of steps) {
      indeg.set(s.id, 0);
      succ.set(s.id, []);
    }
    for (const s of steps) {
      for (const d of s.dependsOn ?? []) {
        indeg.set(s.id, (indeg.get(s.id) ?? 0) + 1); // edge d → s (d before s)
        succ.get(d)!.push(s.id);
      }
    }
    const queue = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id);
    let visited = 0;
    while (queue.length) {
      const id = queue.shift()!;
      visited++;
      for (const nx of succ.get(id) ?? []) {
        indeg.set(nx, (indeg.get(nx) ?? 0) - 1);
        if (indeg.get(nx) === 0) queue.push(nx);
      }
    }
    if (visited < steps.length) issues.push("dependency graph contains a cycle");
  }
  return issues;
}

// The single acceptance gate for a re-decomposition. A refined plan is accepted
// ONLY if it is non-empty, STRICTLY reduces the tool-mismatch count, AND is
// structurally sound — guaranteeing the refine pass can never hand back a plan
// that is worse than the original. Anything else → caller keeps the original.
export function shouldAcceptRefinement(
  originalIssueCount: number,
  refinedSteps: ReadonlyArray<DecomposedStepLike & { dependsOn?: number[] }>,
  availableTools: ReadonlySet<string>,
): { accept: boolean; remaining: number; structural: string[] } {
  if (refinedSteps.length === 0) {
    return { accept: false, remaining: Number.POSITIVE_INFINITY, structural: ["empty plan"] };
  }
  const remaining = findUnsupportedToolSteps(refinedSteps, availableTools).length;
  const structural = findStructuralIssues(refinedSteps);
  return {
    accept: remaining < originalIssueCount && structural.length === 0,
    remaining,
    structural,
  };
}
