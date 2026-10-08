/**
 * Pure, query-free score functions for evaluating the context pipeline itself.
 *
 * These metrics deliberately do not decide whether production context should be
 * blocked. They make Write/Select/Compress/Isolate regressions observable while
 * leaving existing safety and authorization gates authoritative.
 */

export interface SelectionScore {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
}

export interface WriteSelectionScore extends SelectionScore {
  forbiddenSelectedIds: string[];
  passed: boolean;
}

export interface SelectSelectionScore extends SelectionScore {
  forbiddenSelectedIds: string[];
  passed: boolean;
}

export interface CompressionRetentionScore {
  requiredCount: number;
  retainedRequiredCount: number;
  survivalRecall: number;
  missingRequiredIds: string[];
  forbiddenRetainedIds: string[];
  passed: boolean;
}

export interface IsolationScore {
  missingRequiredIds: string[];
  leakedIds: string[];
  passed: boolean;
}

export interface ContextPolicyScorecard {
  totalOperations: 4;
  evaluatedOperations: number;
  coverage: number;
  degraded: boolean;
  failedOperations: Array<"write" | "select" | "compress" | "isolate">;
  passed: boolean;
  write?: WriteSelectionScore;
  select?: SelectSelectionScore;
  compress?: CompressionRetentionScore;
  isolate?: IsolationScore;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
}

function selectionScore(selectedIds: string[], expectedIds: string[]): SelectionScore {
  const selected = new Set(uniqueIds(selectedIds));
  const expected = new Set(uniqueIds(expectedIds));
  const truePositive = [...selected].filter((id) => expected.has(id)).length;
  const falsePositive = [...selected].filter((id) => !expected.has(id)).length;
  const falseNegative = [...expected].filter((id) => !selected.has(id)).length;

  return {
    truePositive,
    falsePositive,
    falseNegative,
    precision:
      selected.size === 0 ? (expected.size === 0 ? 1 : 0) : truePositive / selected.size,
    recall:
      expected.size === 0 ? (selected.size === 0 ? 1 : 0) : truePositive / expected.size,
  };
}

/**
 * Grade a memory-write decision against durable gold facts and forbidden facts.
 * IDs are deduplicated for scoring but forbidden IDs retain the selected order
 * in the diagnostic result.
 */
export function scoreWriteSelection(input: {
  selectedIds: string[];
  durableIds: string[];
  forbiddenIds?: string[];
}): WriteSelectionScore {
  const score = selectionScore(input.selectedIds, input.durableIds);
  const forbidden = new Set(uniqueIds(input.forbiddenIds ?? []));
  const forbiddenSelectedIds = uniqueIds(input.selectedIds).filter((id) => forbidden.has(id));

  return {
    ...score,
    forbiddenSelectedIds,
    passed:
      score.precision === 1 &&
      score.recall === 1 &&
      forbiddenSelectedIds.length === 0,
  };
}

/** Grade retrieved context against required evidence and known distractors. */
export function scoreSelectSelection(input: {
  selectedIds: string[];
  relevantIds: string[];
  forbiddenIds?: string[];
}): SelectSelectionScore {
  const score = selectionScore(input.selectedIds, input.relevantIds);
  const forbidden = new Set(uniqueIds(input.forbiddenIds ?? []));
  const forbiddenSelectedIds = uniqueIds(input.selectedIds).filter((id) => forbidden.has(id));

  return {
    ...score,
    forbiddenSelectedIds,
    passed:
      score.precision === 1 &&
      score.recall === 1 &&
      forbiddenSelectedIds.length === 0,
  };
}

/** Grade whether compression preserved required facts without retaining forbidden state. */
export function scoreCompressionRetention(input: {
  retainedIds: string[];
  requiredIds: string[];
  forbiddenIds?: string[];
}): CompressionRetentionScore {
  const retained = new Set(uniqueIds(input.retainedIds));
  const required = uniqueIds(input.requiredIds);
  const forbidden = new Set(uniqueIds(input.forbiddenIds ?? []));
  const missingRequiredIds = required.filter((id) => !retained.has(id));
  const forbiddenRetainedIds = uniqueIds(input.retainedIds).filter((id) => forbidden.has(id));
  const retainedRequiredCount = required.length - missingRequiredIds.length;

  return {
    requiredCount: required.length,
    retainedRequiredCount,
    survivalRecall:
      required.length === 0 ? 1 : retainedRequiredCount / required.length,
    missingRequiredIds,
    forbiddenRetainedIds,
    passed: missingRequiredIds.length === 0 && forbiddenRetainedIds.length === 0,
  };
}

/** Grade a handoff by checking required state and forbidden parent state separately. */
export function scoreIsolation(input: {
  observedIds: string[];
  requiredIds?: string[];
  forbiddenIds?: string[];
}): IsolationScore {
  const observed = new Set(uniqueIds(input.observedIds));
  const missingRequiredIds = uniqueIds(input.requiredIds ?? []).filter(
    (id) => !observed.has(id),
  );
  const forbidden = new Set(uniqueIds(input.forbiddenIds ?? []));
  const leakedIds = uniqueIds(input.observedIds).filter((id) => forbidden.has(id));

  return {
    missingRequiredIds,
    leakedIds,
    passed: missingRequiredIds.length === 0 && leakedIds.length === 0,
  };
}

/**
 * Aggregate operation scores without allowing an untested operation to look
 * like a passing run. The default threshold requires all four operations.
 */
export function scoreContextPolicy(input: {
  write?: Parameters<typeof scoreWriteSelection>[0];
  select?: Parameters<typeof scoreSelectSelection>[0];
  compress?: Parameters<typeof scoreCompressionRetention>[0];
  isolate?: Parameters<typeof scoreIsolation>[0];
}): ContextPolicyScorecard {
  const write = input.write ? scoreWriteSelection(input.write) : undefined;
  const select = input.select ? scoreSelectSelection(input.select) : undefined;
  const compress = input.compress ? scoreCompressionRetention(input.compress) : undefined;
  const isolate = input.isolate ? scoreIsolation(input.isolate) : undefined;
  const evaluated = [write, select, compress, isolate].filter(
    (result): result is NonNullable<typeof result> => result !== undefined,
  );
  const evaluatedOperations = evaluated.length;
  const coverage = evaluatedOperations / 4;
  const failedOperations: ContextPolicyScorecard["failedOperations"] = [];
  if (write && !write.passed) failedOperations.push("write");
  if (select && !select.passed) failedOperations.push("select");
  if (compress && !compress.passed) failedOperations.push("compress");
  if (isolate && !isolate.passed) failedOperations.push("isolate");
  const degraded = evaluatedOperations !== 4;

  return {
    totalOperations: 4,
    evaluatedOperations,
    coverage,
    degraded,
    failedOperations,
    passed: !degraded && failedOperations.length === 0,
    write,
    select,
    compress,
    isolate,
  };
}