/**
 * Bounded acquire-versus-act policy inspired by Active Inference as Context
 * Acquisition for AI Agents (arXiv:2608.19202). This is intentionally a pure
 * scorer: callers supply their task-relevant estimates, while safety and tool
 * policy remain hard constraints outside its utility calculation.
 */

export type ContextActionKind =
  | "act"
  | "ask_user"
  | "retrieve_memory"
  | "inspect_attachment"
  | "call_safe_tool";

export interface ContextActionCandidate {
  id: string;
  kind: ContextActionKind;
  /** Estimated lift in probability of a correct/useful task outcome, 0..1. */
  expectedTaskSuccessLift: number;
  /** Estimated reduction in decision-relevant uncertainty, 0..1. */
  expectedInformationGain: number;
  tokenCost: number;
  latencyMs: number;
  userTurns: number;
  /**
   * A hard eligibility input from the safety/privacy/policy layer. False means
   * the candidate cannot be selected, regardless of its theoretical utility.
   */
  safetyAllowed: boolean;
}

export interface ContextAcquisitionPolicy {
  informationGainWeight: number;
  tokenCostWeight: number;
  latencyMsWeight: number;
  userTurnPenalty: number;
  /** Required utility margin above the best act-now option. */
  minAcquireScore: number;
  maxTokenCost?: number;
  maxLatencyMs?: number;
  maxUserTurns?: number;
}

export interface ScoredContextAction {
  id: string;
  kind: ContextActionKind;
  eligible: boolean;
  utility: number;
  expectedValue: number;
  informationValue: number;
  tokenPenalty: number;
  latencyPenalty: number;
  userTurnPenalty: number;
  exclusionReason?: string;
}

export interface ContextActionDecision {
  selected: ScoredContextAction;
  shouldAcquire: boolean;
  reason: string;
  ranked: ScoredContextAction[];
}

const CONTEXT_ACTION_KINDS = new Set<ContextActionKind>([
  "act",
  "ask_user",
  "retrieve_memory",
  "inspect_attachment",
  "call_safe_tool",
]);

function cleanUnitScore(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function cleanNonNegative(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function validPolicy(policy: ContextAcquisitionPolicy): boolean {
  const requiredValues = [
    policy.informationGainWeight,
    policy.tokenCostWeight,
    policy.latencyMsWeight,
    policy.userTurnPenalty,
    policy.minAcquireScore,
  ];
  const optionalBudgets = [
    policy.maxTokenCost,
    policy.maxLatencyMs,
    policy.maxUserTurns,
  ].filter((value) => value !== undefined);
  return [...requiredValues, ...optionalBudgets].every(
    (value) => Number.isFinite(value) && value >= 0,
  );
}

function fallbackAction(): ScoredContextAction {
  return {
    id: "act-now",
    kind: "act",
    eligible: true,
    utility: 0,
    expectedValue: 0,
    informationValue: 0,
    tokenPenalty: 0,
    latencyPenalty: 0,
    userTurnPenalty: 0,
  };
}

function scoreCandidate(
  candidate: ContextActionCandidate,
  policy: ContextAcquisitionPolicy,
): ScoredContextAction {
  const fallback = {
    id: String(candidate.id || "unnamed"),
    kind: candidate.kind,
    eligible: false,
    utility: Number.NEGATIVE_INFINITY,
    expectedValue: 0,
    informationValue: 0,
    tokenPenalty: 0,
    latencyPenalty: 0,
    userTurnPenalty: 0,
  } as ScoredContextAction;

  if (!candidate.safetyAllowed) {
    return { ...fallback, exclusionReason: "blocked by safety or policy" };
  }
  if (!candidate.id?.trim()) {
    return { ...fallback, exclusionReason: "missing candidate id" };
  }
  if (!CONTEXT_ACTION_KINDS.has(candidate.kind)) {
    return { ...fallback, exclusionReason: "invalid context action kind" };
  }
  if (
    cleanUnitScore(candidate.expectedTaskSuccessLift) === null ||
    cleanUnitScore(candidate.expectedInformationGain) === null ||
    cleanNonNegative(candidate.tokenCost) === null ||
    cleanNonNegative(candidate.latencyMs) === null ||
    cleanNonNegative(candidate.userTurns) === null
  ) {
    return { ...fallback, exclusionReason: "invalid value estimate" };
  }
  if (
    (policy.maxTokenCost !== undefined && candidate.tokenCost > policy.maxTokenCost) ||
    (policy.maxLatencyMs !== undefined && candidate.latencyMs > policy.maxLatencyMs) ||
    (policy.maxUserTurns !== undefined && candidate.userTurns > policy.maxUserTurns)
  ) {
    return { ...fallback, exclusionReason: "outside context-acquisition budget" };
  }

  const expectedValue = candidate.expectedTaskSuccessLift;
  const informationValue = candidate.expectedInformationGain * policy.informationGainWeight;
  const tokenPenalty = candidate.tokenCost * policy.tokenCostWeight;
  const latencyPenalty = candidate.latencyMs * policy.latencyMsWeight;
  const userTurnPenalty = candidate.userTurns * policy.userTurnPenalty;

  return {
    id: candidate.id,
    kind: candidate.kind,
    eligible: true,
    utility: expectedValue + informationValue - tokenPenalty - latencyPenalty - userTurnPenalty,
    expectedValue,
    informationValue,
    tokenPenalty,
    latencyPenalty,
    userTurnPenalty,
  };
}

function rank(actions: ScoredContextAction[]): ScoredContextAction[] {
  return [...actions].sort(
    (a, b) => b.utility - a.utility || a.id.localeCompare(b.id),
  );
}

/**
 * Choose a single safe context action or return the best available act-now
 * action. Bad estimates fail open to act-now; they never cause the policy to
 * suppress an existing safety/authorization decision.
 */
export function chooseContextAction(input: {
  candidates: ContextActionCandidate[];
  policy: ContextAcquisitionPolicy;
}): ContextActionDecision {
  if (!validPolicy(input.policy)) {
    const fallback = fallbackAction();
    return {
      selected: fallback,
      shouldAcquire: false,
      reason: "invalid policy; preserving act-now fallback",
      ranked: [fallback],
    };
  }

  const scored = input.candidates.map((candidate) => scoreCandidate(candidate, input.policy));
  const validActs = scored.filter((candidate) => candidate.eligible && candidate.kind === "act");
  const bestAct = rank(validActs)[0] ?? fallbackAction();
  const validAcquisitions = rank(
    scored.filter((candidate) => candidate.eligible && candidate.kind !== "act"),
  );
  const bestAcquisition = validAcquisitions[0];

  if (
    bestAcquisition &&
    bestAcquisition.utility > bestAct.utility + input.policy.minAcquireScore
  ) {
    return {
      selected: bestAcquisition,
      shouldAcquire: true,
      reason:
        `${bestAcquisition.kind} clears the act-now utility by ` +
        `${(bestAcquisition.utility - bestAct.utility).toFixed(3)}.`,
      ranked: rank([...scored, ...(validActs.length === 0 ? [bestAct] : [])]),
    };
  }

  return {
    selected: bestAct,
    shouldAcquire: false,
    reason: bestAcquisition
      ? `act-now remains better after the required acquisition margin of ${input.policy.minAcquireScore.toFixed(3)}.`
      : "no eligible context action improved on act-now.",
    ranked: rank([...scored, ...(validActs.length === 0 ? [bestAct] : [])]),
  };
}