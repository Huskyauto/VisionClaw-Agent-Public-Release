/**
 * Pure HyDE retrieval observability helpers.
 *
 * This module deliberately has no database or provider imports. The chat path
 * uses these functions to classify queries and compare result sets, while the
 * report script uses the same aggregation contract without opening a database
 * in unit tests.
 */

export const HYDE_QUERY_CATEGORIES = [
  "short_ack",
  "code_question",
  "general",
] as const;

export type HydeQueryCategory = (typeof HYDE_QUERY_CATEGORIES)[number];
export type HydeRetrievalSurface = "personal_memory" | "agent_knowledge";
export type HydeComparisonFailureReason =
  | "hyde_embedding"
  | "raw_embedding_timeout"
  | "raw_embedding_unavailable"
  | "comparison_error";

export async function generateBoundedShadowEmbedding(
  message: string,
  generate: (text: string, signal: AbortSignal) => Promise<number[] | null>,
  timeoutMs = 8_000,
): Promise<{
  embedding: number[] | null;
  reason: Exclude<HydeComparisonFailureReason, "hyde_embedding"> | null;
  error?: unknown;
}> {
  const abortController = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const work = generate(message, abortController.signal).then(
    (embedding) => ({ kind: "result" as const, embedding }),
    (error) => ({ kind: "error" as const, error }),
  );
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => {
      abortController.abort();
      resolve({ kind: "timeout" });
    }, Math.max(1, timeoutMs));
  });
  try {
    const outcome = await Promise.race([work, timeout]);
    if (outcome.kind === "timeout") {
      return { embedding: null, reason: "raw_embedding_timeout" };
    }
    if (outcome.kind === "error") {
      return { embedding: null, reason: "comparison_error", error: outcome.error };
    }
    return outcome.embedding
      ? { embedding: outcome.embedding, reason: null }
      : { embedding: null, reason: "raw_embedding_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export function classifyHydeQuery(message: string): HydeQueryCategory {
  const text = String(message || "").trim();
  if (
    text.length <= 80 &&
    /^(?:ok(?:ay)?|yes|no|thanks?|thank you|got it|sounds good|understood|great|cool|sure|yep|nope|right|all good)[.!?\s]*$/i.test(
      text,
    )
  ) {
    return "short_ack";
  }

  if (
    /```|(?:\b(?:code|typescript|javascript|python|sql|query|function|api|bug|error|stack\s*trace|exception|compile|npm|git|regex|database|schema|endpoint|implement|refactor|test)\b)/i.test(
      text,
    )
  ) {
    return "code_question";
  }

  return "general";
}

export interface HydeResultComparison {
  overlapCount: number;
  differentTop5: number;
  /** Mean absolute 1-based rank movement for memories present in both lists. */
  rankDisplacement: number | null;
}

function topUnique(ids: readonly (number | string)[], topK: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const key = String(id);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= topK) break;
  }
  return out;
}

export function compareHydeResults(
  hydeIds: readonly (number | string)[],
  rawIds: readonly (number | string)[],
  topK = 5,
): HydeResultComparison {
  const requestedK = Number.isInteger(topK) && topK > 0 ? topK : 5;
  const hydeTop = topUnique(hydeIds, requestedK);
  const rawTop = topUnique(rawIds, requestedK);
  // A store with fewer than K results cannot have "different" entries for
  // the missing slots. Compare the available result depth instead.
  const k = Math.min(requestedK, hydeTop.length, rawTop.length);
  const hydeComparable = hydeTop.slice(0, k);
  const rawComparable = rawTop.slice(0, k);
  const rawRanks = new Map(rawComparable.map((id, index) => [id, index]));
  const common = hydeComparable.filter((id) => rawRanks.has(id));
  const movement = common.reduce(
    (sum, id) => sum + Math.abs(hydeComparable.indexOf(id) - rawRanks.get(id)!),
    0,
  );

  return {
    overlapCount: common.length,
    differentTop5: k - common.length,
    rankDisplacement: common.length
      ? Number((movement / common.length).toFixed(2))
      : null,
  };
}

export interface RetrievalQualityScore {
  recallAt5: number;
  reciprocalRank: number;
}

export function scoreRetrievalQuality(
  rankedIds: readonly (string | number)[],
  relevantIds: readonly (string | number)[],
): RetrievalQualityScore {
  const ranked = rankedIds.slice(0, 5).map(String);
  const relevant = new Set(relevantIds.map(String));
  if (relevant.size === 0) throw new Error("quality case requires at least one relevant id");
  const hits = ranked.filter((id) => relevant.has(id));
  const firstRelevantRank = ranked.findIndex((id) => relevant.has(id));
  return {
    recallAt5: Number((new Set(hits).size / relevant.size).toFixed(4)),
    reciprocalRank: firstRelevantRank >= 0 ? Number((1 / (firstRelevantRank + 1)).toFixed(4)) : 0,
  };
}

export interface HydeQualityCaseResult {
  id: string;
  category: HydeQueryCategory;
  evaluated: boolean;
  raw?: RetrievalQualityScore;
  hyde?: RetrievalQualityScore;
  failure?: string;
}

export interface HydeQualityAggregate {
  expectedSamples: number;
  evaluatedSamples: number;
  wins: number;
  losses: number;
  ties: number;
  rawRecallAt5: number | null;
  hydeRecallAt5: number | null;
  rawMrr: number | null;
  hydeMrr: number | null;
  scoreDelta: number | null;
  decision: "improved" | "regressed" | "inconclusive" | "insufficient";
  failures: Array<{ id: string; category: HydeQueryCategory; reason: string }>;
  categories: Array<{
    category: HydeQueryCategory;
    samples: number;
    wins: number;
    losses: number;
    ties: number;
    scoreDelta: number | null;
  }>;
}

export function aggregateHydeQuality(
  cases: readonly HydeQualityCaseResult[],
  minSamples = 8,
  decisiveMargin = 0.01,
): HydeQualityAggregate {
  const evaluated = cases.filter(
    (item): item is HydeQualityCaseResult & { raw: RetrievalQualityScore; hyde: RetrievalQualityScore } =>
      item.evaluated && Boolean(item.raw) && Boolean(item.hyde),
  );
  const score = (value: RetrievalQualityScore) => (value.recallAt5 + value.reciprocalRank) / 2;
  const classify = (item: (typeof evaluated)[number]) => {
    const delta = score(item.hyde) - score(item.raw);
    return delta > decisiveMargin ? "win" : delta < -decisiveMargin ? "loss" : "tie";
  };
  const wins = evaluated.filter((item) => classify(item) === "win").length;
  const losses = evaluated.filter((item) => classify(item) === "loss").length;
  const ties = evaluated.length - wins - losses;
  const rawRecallAt5 = average(evaluated.map((item) => item.raw.recallAt5));
  const hydeRecallAt5 = average(evaluated.map((item) => item.hyde.recallAt5));
  const rawMrr = average(evaluated.map((item) => item.raw.reciprocalRank));
  const hydeMrr = average(evaluated.map((item) => item.hyde.reciprocalRank));
  const scoreDelta =
    rawRecallAt5 === null || hydeRecallAt5 === null || rawMrr === null || hydeMrr === null
      ? null
      : Number((((hydeRecallAt5 + hydeMrr) - (rawRecallAt5 + rawMrr)) / 2).toFixed(4));
  let decision: HydeQualityAggregate["decision"] = "insufficient";
  if (evaluated.length === cases.length && evaluated.length >= minSamples && scoreDelta !== null) {
    if (scoreDelta > decisiveMargin && wins > losses && hydeRecallAt5! >= rawRecallAt5!) decision = "improved";
    else if (scoreDelta < -decisiveMargin || losses > wins) decision = "regressed";
    else decision = "inconclusive";
  }
  const categories = HYDE_QUERY_CATEGORIES.map((category) => {
    const rows = evaluated.filter((item) => item.category === category);
    const categoryWins = rows.filter((item) => classify(item) === "win").length;
    const categoryLosses = rows.filter((item) => classify(item) === "loss").length;
    const rawAvg = average(rows.map((item) => score(item.raw)));
    const hydeAvg = average(rows.map((item) => score(item.hyde)));
    return {
      category,
      samples: rows.length,
      wins: categoryWins,
      losses: categoryLosses,
      ties: rows.length - categoryWins - categoryLosses,
      scoreDelta: rawAvg === null || hydeAvg === null ? null : Number((hydeAvg - rawAvg).toFixed(4)),
    };
  });
  return {
    expectedSamples: cases.length,
    evaluatedSamples: evaluated.length,
    wins,
    losses,
    ties,
    rawRecallAt5,
    hydeRecallAt5,
    rawMrr,
    hydeMrr,
    scoreDelta,
    decision,
    failures: cases
      .filter((item) => !item.evaluated)
      .map((item) => ({ id: item.id, category: item.category, reason: item.failure ?? "unknown" })),
    categories,
  };
}

function normalizedTokens(value: string): Set<string> {
  return new Set(
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

function tokenJaccard(left: string, right: string): number {
  const a = normalizedTokens(left);
  const b = normalizedTokens(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  return overlap / union.size;
}

export function assertHydeGoldenSetIsHeldOut(args: {
  corpusId: unknown;
  frozen: unknown;
  documents: readonly { id: string; text: string }[];
  cases: readonly { id: string; query: string; relevantIds: readonly string[] }[];
  promptExamples: readonly { user: string; output: string }[];
}): void {
  if (args.corpusId !== "hyde-heldout-v1" || args.frozen !== true) {
    throw new Error("HyDE golden corpus must declare the frozen held-out identity");
  }
  const documents = new Map(args.documents.map((document) => [document.id, document.text]));
  for (const item of args.cases) {
    for (const example of args.promptExamples) {
      if (tokenJaccard(item.query, example.user) >= 0.45) {
        throw new Error(`HyDE golden query overlaps a prompt example: ${item.id}`);
      }
      for (const relevantId of item.relevantIds) {
        const relevant = documents.get(relevantId);
        if (relevant && tokenJaccard(relevant, example.output) >= 0.45) {
          throw new Error(`HyDE golden target overlaps a prompt example: ${item.id}`);
        }
      }
    }
  }
}

export function assertHydeSemanticSeparation(args: {
  caseId: string;
  queryToPromptUserSimilarities: readonly number[];
  targetToPromptOutputSimilarities: readonly number[];
  maxSimilarity?: number;
}): void {
  const maxSimilarity = args.maxSimilarity ?? 0.86;
  const observed = Math.max(
    0,
    ...args.queryToPromptUserSimilarities,
    ...args.targetToPromptOutputSimilarities,
  );
  if (!Number.isFinite(observed) || observed >= maxSimilarity) {
    throw new Error(`HyDE golden case is semantically contaminated by a prompt example: ${args.caseId}`);
  }
}

export function assertHydeGoldenManifest(args: {
  corpusId: string;
  actualSha256: string;
  caseIds: readonly string[];
  manifest: {
    corpusId?: unknown;
    corpusVersion?: unknown;
    canonicalSha256?: unknown;
    caseCount?: unknown;
    caseIds?: unknown;
  };
}): void {
  if (new Set(args.caseIds).size !== args.caseIds.length) {
    throw new Error("HyDE golden corpus has duplicate case ids");
  }
  const expectedIds = args.manifest.caseIds;
  if (
    args.manifest.corpusId !== args.corpusId ||
    args.manifest.corpusVersion !== 1 ||
    args.manifest.canonicalSha256 !== args.actualSha256 ||
    args.manifest.caseCount !== args.caseIds.length ||
    !Array.isArray(expectedIds) ||
    expectedIds.length !== args.caseIds.length ||
    expectedIds.some((id, index) => id !== args.caseIds[index])
  ) {
    throw new Error("HyDE golden corpus does not match its reviewed manifest");
  }
}

export type HydeObservation =
  | {
      kind: "attempt";
      retrievalId: string;
      surface: HydeRetrievalSurface;
      category: HydeQueryCategory;
      outcome: "success" | "timeout" | "error" | "empty";
    }
  | {
      kind: "shadow";
      retrievalId: string;
      surface: HydeRetrievalSurface;
      category: HydeQueryCategory;
      deltaTop5: number;
      rankDisplacement: number | null;
    }
  | {
      kind: "comparison_failure";
      retrievalId: string;
      surface: HydeRetrievalSurface;
      category: HydeQueryCategory;
      reason: string;
    };

export interface HydeBreakdownAggregate {
  attempts: number;
  successes: number;
  timeouts: number;
  errors: number;
  emptyResponses: number;
  shadowComparisons: number;
  missingComparisons: number;
  comparisonCoveragePct: number | null;
  avgDeltaTop5: number | null;
  avgRankDisplacement: number | null;
}

export interface HydeCategoryAggregate extends HydeBreakdownAggregate {
  category: HydeQueryCategory;
}

export interface HydeSurfaceAggregate extends HydeBreakdownAggregate {
  surface: HydeRetrievalSurface;
}

export interface HydeAggregate {
  attempts: number;
  successes: number;
  timeouts: number;
  errors: number;
  emptyResponses: number;
  timeoutRatePct: number;
  shadowComparisons: number;
  comparisonFailures: number;
  missingComparisons: number;
  missingTerminals: number;
  comparisonCoveragePct: number | null;
  avgDeltaTop5: number | null;
  avgRankDisplacement: number | null;
  categories: HydeCategoryAggregate[];
  surfaces: HydeSurfaceAggregate[];
  recommendation: string | null;
}

export function hydeAggregateNeedsAttention(
  aggregate: Pick<
    HydeAggregate,
    "attempts" | "errors" | "emptyResponses" | "missingComparisons" | "missingTerminals" | "recommendation"
  >,
  malformedRows = 0,
): boolean {
  return (
    aggregate.attempts === 0 ||
    aggregate.errors > 0 ||
    aggregate.emptyResponses > 0 ||
    aggregate.missingComparisons > 0 ||
    aggregate.missingTerminals > 0 ||
    malformedRows > 0 ||
    Boolean(aggregate.recommendation)
  );
}

export function parseHydeReportJson(stdout: string): unknown {
  const marker = '{\n  "generatedAt"';
  const start = stdout.lastIndexOf(marker);
  if (start < 0) throw new Error("HyDE report JSON marker not found");
  return JSON.parse(stdout.slice(start));
}

function average(values: number[]): number | null {
  return values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : null;
}

export function aggregateHydeObservations(
  observations: readonly HydeObservation[],
  timeoutAlertPct = 20,
): HydeAggregate {
  type Bucket = {
    attempts: number;
    successes: number;
    timeouts: number;
    errors: number;
    emptyResponses: number;
    deltas: number[];
    movements: number[];
    comparisonFailures: number;
    missingTerminals: number;
  };
  const newBucket = (): Bucket => ({
    attempts: 0,
    successes: 0,
    timeouts: 0,
    errors: 0,
    emptyResponses: 0,
    deltas: [],
    movements: [],
    comparisonFailures: 0,
    missingTerminals: 0,
  });
  const categories = new Map<HydeQueryCategory, Bucket>();
  for (const category of HYDE_QUERY_CATEGORIES) {
    categories.set(category, newBucket());
  }
  const surfaceNames: HydeRetrievalSurface[] = ["personal_memory", "agent_knowledge"];
  const surfaces = new Map<HydeRetrievalSurface, Bucket>(
    surfaceNames.map((surface) => [surface, newBucket()]),
  );
  const total = newBucket();
  const attemptsById = new Map<string, Extract<HydeObservation, { kind: "attempt" }>>();
  const shadowsById = new Map<string, Extract<HydeObservation, { kind: "shadow" }>>();
  const failuresById = new Map<string, Extract<HydeObservation, { kind: "comparison_failure" }>>();
  for (const observation of observations) {
    if (observation.kind === "attempt") {
      if (!attemptsById.has(observation.retrievalId)) attemptsById.set(observation.retrievalId, observation);
    } else if (observation.kind === "shadow") {
      if (!shadowsById.has(observation.retrievalId)) shadowsById.set(observation.retrievalId, observation);
    } else {
      if (!failuresById.has(observation.retrievalId)) failuresById.set(observation.retrievalId, observation);
    }
  }

  for (const attempt of attemptsById.values()) {
    const buckets = [total, categories.get(attempt.category)!, surfaces.get(attempt.surface)!];
    for (const bucket of buckets) {
      bucket.attempts++;
      if (attempt.outcome === "success") bucket.successes++;
      else if (attempt.outcome === "timeout") bucket.timeouts++;
      else if (attempt.outcome === "error") bucket.errors++;
      else bucket.emptyResponses++;
    }
    if (attempt.outcome !== "success") continue;

    const shadow = shadowsById.get(attempt.retrievalId);
    const failure = failuresById.get(attempt.retrievalId);
    if (shadow && shadow.surface === attempt.surface) {
      const delta = Number(shadow.deltaTop5);
      const displacement = shadow.rankDisplacement === null ? null : Number(shadow.rankDisplacement);
      for (const bucket of buckets) {
        bucket.deltas.push(delta);
        if (displacement !== null) bucket.movements.push(displacement);
      }
    } else if (failure && failure.surface === attempt.surface) {
      for (const bucket of buckets) bucket.comparisonFailures++;
    } else {
      for (const bucket of buckets) bucket.missingTerminals++;
    }
  }

  const timeoutRatePct = total.attempts
    ? Number(((total.timeouts / total.attempts) * 100).toFixed(1))
    : 0;
  const formatBucket = (bucket: Bucket): HydeBreakdownAggregate => ({
    attempts: bucket.attempts,
    successes: bucket.successes,
    timeouts: bucket.timeouts,
    errors: bucket.errors,
    emptyResponses: bucket.emptyResponses,
    shadowComparisons: bucket.deltas.length,
    missingComparisons: Math.max(0, bucket.successes - bucket.deltas.length),
    comparisonCoveragePct: bucket.successes
      ? Number(((bucket.deltas.length / bucket.successes) * 100).toFixed(1))
      : null,
    avgDeltaTop5: average(bucket.deltas),
    avgRankDisplacement: average(bucket.movements),
  });
  const categoryAggregates = HYDE_QUERY_CATEGORIES.map((category) => {
    const bucket = categories.get(category)!;
    return {
      category,
      ...formatBucket(bucket),
    };
  }).sort((a, b) => {
    if (a.avgDeltaTop5 === null && b.avgDeltaTop5 === null) return 0;
    if (a.avgDeltaTop5 === null) return 1;
    if (b.avgDeltaTop5 === null) return -1;
    return b.avgDeltaTop5 - a.avgDeltaTop5;
  });

  return {
    attempts: total.attempts,
    successes: total.successes,
    timeouts: total.timeouts,
    errors: total.errors,
    emptyResponses: total.emptyResponses,
    timeoutRatePct,
    shadowComparisons: total.deltas.length,
    comparisonFailures: total.comparisonFailures,
    missingComparisons: Math.max(0, total.successes - total.deltas.length),
    missingTerminals: total.missingTerminals,
    comparisonCoveragePct: total.successes
      ? Number(((total.deltas.length / total.successes) * 100).toFixed(1))
      : null,
    avgDeltaTop5: average(total.deltas),
    avgRankDisplacement: average(total.movements),
    categories: categoryAggregates,
    surfaces: surfaceNames.map((surface) => ({ surface, ...formatBucket(surfaces.get(surface)!) })),
    recommendation:
      timeoutRatePct > timeoutAlertPct
        ? `HyDE timeout rate is ${timeoutRatePct}% (above ${timeoutAlertPct}%): set MEMORY_HYDE_ENABLED=0 or reduce the HyDE budget before relying on this path.`
        : null,
  };
}