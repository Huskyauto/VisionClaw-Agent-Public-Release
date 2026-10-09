export interface RetrievalEvaluationInput {
  rankedIds: string[];
  relevantIds: string[];
  authorizedIds: string[];
  k: number;
}

export interface RetrievalEvaluation {
  k: number;
  returnedAtK: number;
  relevantAtK: number;
  precisionAtK: number;
  recallAtK: number;
  meanReciprocalRankAtK: number;
  ndcgAtK: number;
  authorizationLeakageCount: number;
  authorizationLeakageRate: number;
}

function validate(input: RetrievalEvaluationInput): void {
  if (!Number.isSafeInteger(input.k) || input.k <= 0 || input.k > 1000) {
    throw new Error("retrieval evaluation: k must be a safe integer from 1 to 1000");
  }
  for (const [name, values] of [
    ["rankedIds", input.rankedIds],
    ["relevantIds", input.relevantIds],
    ["authorizedIds", input.authorizedIds],
  ] as const) {
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) {
      throw new Error(`retrieval evaluation: ${name} must contain non-empty string IDs`);
    }
  }
  if (new Set(input.rankedIds).size !== input.rankedIds.length) {
    throw new Error("retrieval evaluation: rankedIds must be unique");
  }
}

function discountedGain(rank: number): number {
  return 1 / Math.log2(rank + 1);
}

export function evaluateRetrieval(input: RetrievalEvaluationInput): RetrievalEvaluation {
  validate(input);
  const ranked = input.rankedIds.slice(0, input.k);
  const relevant = new Set(input.relevantIds);
  const authorized = new Set(input.authorizedIds);
  const relevantAtK = ranked.filter((id) => relevant.has(id)).length;
  const precisionAtK = relevantAtK / input.k;
  const recallAtK = relevant.size > 0 ? relevantAtK / relevant.size : 0;
  const firstRelevantIndex = ranked.findIndex((id) => relevant.has(id));
  const meanReciprocalRankAtK = firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1);
  const dcg = ranked.reduce(
    (sum, id, index) => sum + (relevant.has(id) ? discountedGain(index + 1) : 0),
    0,
  );
  const idealRelevantCount = Math.min(input.k, relevant.size);
  const idealDcg = Array.from({ length: idealRelevantCount }, (_value, index) => discountedGain(index + 1))
    .reduce((sum, gain) => sum + gain, 0);
  const ndcgAtK = idealDcg > 0 ? dcg / idealDcg : 0;
  const authorizationLeakageCount = ranked.filter((id) => !authorized.has(id)).length;

  return {
    k: input.k,
    returnedAtK: ranked.length,
    relevantAtK,
    precisionAtK,
    recallAtK,
    meanReciprocalRankAtK,
    ndcgAtK,
    authorizationLeakageCount,
    authorizationLeakageRate: ranked.length > 0 ? authorizationLeakageCount / ranked.length : 0,
  };
}