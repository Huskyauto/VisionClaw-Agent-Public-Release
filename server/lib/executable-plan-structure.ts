export interface ExecutablePlanStepLike {
  n: unknown;
  depends_on?: unknown;
}

export function normalizeLegacyExecutablePlanStepIds<
  T,
>(steps: ReadonlyArray<T>): unknown[] {
  return steps.map((step, index) => {
    if (step === null || typeof step !== "object" || Array.isArray(step)) return step;
    const record = step as Record<string, unknown>;
    return {
      ...record,
      n: record.n === undefined ? index + 1 : record.n,
    };
  });
}

export function validateExecutablePlanStructure(
  steps: ReadonlyArray<unknown>,
): string[] {
  const issues: string[] = [];
  const ids = new Set<number>();

  for (let index = 0; index < steps.length; index++) {
    const rawStep = steps[index];
    if (rawStep === null || typeof rawStep !== "object" || Array.isArray(rawStep)) {
      issues.push(`step at position ${index + 1} is not an object`);
      continue;
    }
    const id = (rawStep as ExecutablePlanStepLike).n;
    if (!Number.isInteger(id) || (id as number) <= 0) {
      issues.push(`step at position ${index + 1} has invalid id ${JSON.stringify(id)}`);
      continue;
    }
    if (ids.has(id as number)) {
      issues.push(`duplicate step id ${id}`);
      continue;
    }
    ids.add(id as number);
  }

  for (const rawStep of steps) {
    if (rawStep === null || typeof rawStep !== "object" || Array.isArray(rawStep)) continue;
    const step = rawStep as ExecutablePlanStepLike;
    if (!Number.isInteger(step.n) || (step.n as number) <= 0) continue;
    if (step.depends_on !== undefined && !Array.isArray(step.depends_on)) {
      issues.push(`step ${step.n} has invalid depends_on ${JSON.stringify(step.depends_on)}`);
      continue;
    }
    const dependencies = Array.isArray(step.depends_on) ? step.depends_on : [];
    for (const dependency of dependencies) {
      if (!Number.isInteger(dependency) || (dependency as number) <= 0) {
        issues.push(`step ${step.n} has invalid dependency ${JSON.stringify(dependency)}`);
      } else if (dependency === step.n) {
        issues.push(`step ${step.n} depends on itself`);
      } else if (!ids.has(dependency as number)) {
        issues.push(`step ${step.n} depends on unknown step ${dependency}`);
      }
    }
  }

  if (issues.length > 0) return issues;

  const indegree = new Map<number, number>();
  const successors = new Map<number, number[]>();
  const validSteps = steps as ExecutablePlanStepLike[];
  for (const step of validSteps) {
    const id = step.n as number;
    indegree.set(id, 0);
    successors.set(id, []);
  }
  for (const step of validSteps) {
    const id = step.n as number;
    for (const dependency of (step.depends_on as number[] | undefined) ?? []) {
      indegree.set(id, (indegree.get(id) ?? 0) + 1);
      successors.get(dependency)!.push(id);
    }
  }

  const ready = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift()!;
    visited++;
    for (const successor of successors.get(id) ?? []) {
      const next = (indegree.get(successor) ?? 0) - 1;
      indegree.set(successor, next);
      if (next === 0) ready.push(successor);
    }
  }

  if (visited !== steps.length) issues.push("dependency graph contains a cycle");
  return issues;
}