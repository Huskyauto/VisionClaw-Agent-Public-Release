import { ADMIN_TENANT_ID } from "./auth";
import { MODEL_REGISTRY } from "./providers";

const MAX_WINDOW = 20;

export function modelHasVision(modelId: string): boolean {
  const entry = MODEL_REGISTRY.find(m => m.id === modelId);
  return entry?.capabilities?.includes("vision") ?? false;
}

export function windowMessages(msgs: { role: string; content: string }[]) {
  if (msgs.length <= MAX_WINDOW) return msgs;
  return msgs.slice(msgs.length - MAX_WINDOW);
}

const HIGH_COMPLEXITY_PATTERNS = [
  /\b(debug|refactor|architect|design|implement|optimize|analyze|compare|evaluate|review|audit|plan|strategy|diagnose)\b/i,
  /\b(step[- ]by[- ]step|break\s*down|pros?\s*(?:and|&|vs)\s*cons?|trade[- ]?offs?|root\s*cause)\b/i,
  /\b(algorithm|data\s*structure|system\s*design|security|migration|performance|scaling)\b/i,
  /\bwhy\s+(does|is|are|do|did|would|should|can't|won't|doesn't)\b/i,
  /\b(how\s+(?:would|should|can|do)\s+(?:I|we|you))\b/i,
  /\b(what\s+(?:are\s+the|is\s+the\s+best|would\s+happen|should))\b/i,
];

const MEDIUM_COMPLEXITY_PATTERNS = [
  /\b(explain|describe|summarize|create|build|write|generate|draft|help\s+me)\b/i,
  /\b(how\s+(?:to|do)|what\s+is|can\s+you)\b/i,
  /\b(email|report|document|proposal|outline|list|research)\b/i,
  /\b(code|function|script|api|database|query|endpoint)\b/i,
];

export function autoDetectThinkingLevel(message: string): string {
  if (!message || message.length < 5) return "off";

  const wordCount = message.split(/\s+/).length;
  const questionMarks = (message.match(/\?/g) || []).length;
  const hasCodeBlock = /```[\s\S]*```/.test(message);
  const hasMultipleQuestions = questionMarks >= 2;

  let score = 0;

  for (const pattern of HIGH_COMPLEXITY_PATTERNS) {
    if (pattern.test(message)) score += 3;
  }
  for (const pattern of MEDIUM_COMPLEXITY_PATTERNS) {
    if (pattern.test(message)) score += 1;
  }

  if (wordCount > 100) score += 3;
  else if (wordCount > 40) score += 2;
  else if (wordCount > 15) score += 1;

  if (hasCodeBlock) score += 2;
  if (hasMultipleQuestions) score += 2;

  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  if (score >= 1) return "low";

  return "off";
}

const DEFAULT_MAX_TOOL_ROUNDS = 7;
const DEFAULT_MAX_TOTAL_TOOL_CALLS = 25;
const DEFAULT_MAX_TOOL_CALLS_PER_ROUND = 6;
export const COMPLETION_RESERVE_CALLS = 4;

const RESEARCH_TOOL_PATTERN = /(?:^|_)(?:web|search|browse|browser|research|scrape|crawl|fetch|lookup|discover|find)(?:_|$)/i;
const FINALIZATION_TOOL_PATTERN = /(?:synthes|summar|create|write|file|document|pdf|slides|spreadsheet|project|deliver|upload|drive|email|verify)/i;
export type CompletionStage = "synthesis" | "artifact" | "registration" | "delivery";

export function classifyCompletionStage(toolName: string): CompletionStage | null {
  if (/(?:deliver|upload|drive|email|verify)/i.test(toolName)) return "delivery";
  if (/(?:project|register)/i.test(toolName)) return "registration";
  if (/(?:create|write|file|document|pdf|slides|spreadsheet)/i.test(toolName)) return "artifact";
  if (/(?:synthes|summar)/i.test(toolName)) return "synthesis";
  return null;
}

export function completionStageSucceeded(toolName: string, value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.error || result.success === false || result.ok === false) return false;
  const status = String(result.status || "").toLowerCase();
  if (/(?:fail|error|pending|uncertain|partial|blocked)/.test(status)) return false;
  if (result.success === true || result.ok === true || /^(?:complete|completed|success|sent|delivered|uploaded|created|registered)$/.test(status)) return true;

  const stage = classifyCompletionStage(toolName);
  if (stage === "artifact") return Boolean(result.filePath || result.path || result.file_url || result.documentId);
  if (stage === "registration") {
    const project = result.project;
    return Boolean(result.projectId || (project && typeof project === "object" && (project as Record<string, unknown>).id));
  }
  if (stage === "delivery") return Boolean(result.viewUrl || result.downloadUrl || result.deliveryId || result.messageId || result.emailId);
  if (stage === "synthesis") return Boolean(result.summary || result.report || result.content);
  return false;
}

export function researchRateLimitRecoveryInstruction(toolName: string, error: string): string | null {
  const isResearchTool = RESEARCH_TOOL_PATTERN.test(toolName);
  const isHardLimit = /^RATE LIMITED:/i.test(error) &&
    /(?:last hour|daily limit|times today|hard usage ceiling)/i.test(error);
  if (!isResearchTool || !isHardLimit) return null;
  return "RESEARCH CAP REACHED: Do not retry this lookup pattern. For CMMC work, use discover_cmmc_prospects once because it is the bounded official SAM.gov source and has a separate budget. Otherwise immediately finish, save, register, and deliver the best truthful report using verified evidence already collected. Clearly label any coverage gap. A research limit is not permission to abandon the deliverable.";
}

export interface CompletionReservePlan {
  reserveActive: boolean;
  allowedTools: string[];
  allowedToolIndexes: number[];
  deferredResearchTools: string[];
  deferredResearchToolIndexes: number[];
  blockedCompletionToolIndexes: number[];
  overCapacityToolIndexes: number[];
  remainingCalls: number;
  failure?: {
    budgetKind: "tool_calls";
    resumable: true;
    deferredResearchCount: number;
  };
}

/**
 * Applies the per-turn completion reserve without mutating the issued-call
 * count. A tool call which has already been issued cannot be safely revoked;
 * only new, nonessential research is deferred. Finalization tools remain
 * eligible until the existing hard cap is exhausted.
 */
export function planCompletionReserve(input: {
  issuedCalls: number;
  maxTotalCalls: number;
  proposedTools: string[];
  completedStages?: CompletionStage[];
  researchClosed?: boolean;
  allowedRecoveryResearchTools?: string[];
}): CompletionReservePlan {
  const maxTotalCalls = Math.max(0, input.maxTotalCalls);
  const issuedCalls = Math.max(0, Math.min(input.issuedCalls, maxTotalCalls));
  const reserveCalls = Math.min(COMPLETION_RESERVE_CALLS, maxTotalCalls);
  // At normal caps this is the requested 70% mark. On a deliberately smaller
  // configured cap, begin earlier rather than allowing research to consume the
  // four-call completion reserve before that percentage is reached.
  const reserveThreshold = Math.min(
    Math.ceil(maxTotalCalls * 0.7),
    Math.max(0, maxTotalCalls - reserveCalls),
  );
  const reserveActive = issuedCalls >= reserveThreshold || Boolean(input.researchClosed);
  const remainingCalls = Math.max(0, maxTotalCalls - issuedCalls);
  const allowedTools: string[] = [];
  const allowedToolIndexes: number[] = [];
  const deferredResearchTools: string[] = [];
  const deferredResearchToolIndexes: number[] = [];
  const blockedCompletionToolIndexes: number[] = [];
  const overCapacityToolIndexes: number[] = [];
  let admittedNonFinalization = 0;
  const occupiedStages = new Set(input.completedStages || []);
  const recoveryTools = new Set(input.allowedRecoveryResearchTools || []);
  const admittedRecoveryTools = new Set<string>();
  const nonFinalizationLimit = reserveActive
    ? Math.max(0, remainingCalls - reserveCalls)
    : remainingCalls;

  for (const [index, tool] of input.proposedTools.entries()) {
    const isResearch = RESEARCH_TOOL_PATTERN.test(tool);
    const isFinalization = FINALIZATION_TOOL_PATTERN.test(tool);
    const completionStage = classifyCompletionStage(tool);
    if (recoveryTools.has(tool) && admittedRecoveryTools.has(tool)) {
      deferredResearchTools.push(tool);
      deferredResearchToolIndexes.push(index);
      continue;
    }
    if (input.researchClosed && isResearch && !isFinalization && !recoveryTools.has(tool)) {
      deferredResearchTools.push(tool);
      deferredResearchToolIndexes.push(index);
      continue;
    }
    if (reserveActive && isResearch && !isFinalization && !recoveryTools.has(tool)) {
      deferredResearchTools.push(tool);
      deferredResearchToolIndexes.push(index);
      continue;
    }
    if (reserveActive && completionStage) {
      if (occupiedStages.has(completionStage)) {
        blockedCompletionToolIndexes.push(index);
        continue;
      }
      occupiedStages.add(completionStage);
    }
    if (reserveActive && !isFinalization && admittedNonFinalization >= nonFinalizationLimit) {
      if (isResearch) {
        deferredResearchTools.push(tool);
        deferredResearchToolIndexes.push(index);
      } else {
        overCapacityToolIndexes.push(index);
      }
      continue;
    }
    if (allowedTools.length < remainingCalls) {
      allowedTools.push(tool);
      allowedToolIndexes.push(index);
      if (recoveryTools.has(tool)) admittedRecoveryTools.add(tool);
      if (!isFinalization) admittedNonFinalization++;
    } else {
      overCapacityToolIndexes.push(index);
    }
  }

  return {
    reserveActive,
    allowedTools,
    allowedToolIndexes,
    deferredResearchTools,
    deferredResearchToolIndexes,
    blockedCompletionToolIndexes,
    overCapacityToolIndexes,
    remainingCalls,
    ...(deferredResearchTools.length > 0
      ? {
          failure: {
            budgetKind: "tool_calls" as const,
            resumable: true as const,
            deferredResearchCount: deferredResearchTools.length,
          },
        }
      : {}),
  };
}

function parseIntCap(raw: string | undefined, fallback: number, min: number, max: number, label: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    console.warn(`[tool-budget] Ignoring invalid ${label}="${raw}" (must be an integer ${min}..${max}) — using ${fallback}.`);
    return fallback;
  }
  return n;
}

export function resolveToolBudget(tenantId: number): { maxRounds: number; maxTotal: number; maxPerRound: number } {
  const isAdmin = tenantId === ADMIN_TENANT_ID;
  return isAdmin
    ? {
        maxRounds: parseIntCap(process.env.MAX_TOOL_ROUNDS_ADMIN, 20, 1, 50, "MAX_TOOL_ROUNDS_ADMIN"),
        maxTotal: parseIntCap(process.env.MAX_TOTAL_TOOL_CALLS_ADMIN, 40, 1, 40, "MAX_TOTAL_TOOL_CALLS_ADMIN"),
        maxPerRound: parseIntCap(process.env.MAX_TOOL_CALLS_PER_ROUND_ADMIN, 8, 1, 50, "MAX_TOOL_CALLS_PER_ROUND_ADMIN"),
      }
    : {
        maxRounds: parseIntCap(process.env.MAX_TOOL_ROUNDS, DEFAULT_MAX_TOOL_ROUNDS, 1, 50, "MAX_TOOL_ROUNDS"),
        maxTotal: parseIntCap(process.env.MAX_TOTAL_TOOL_CALLS, DEFAULT_MAX_TOTAL_TOOL_CALLS, 1, 200, "MAX_TOTAL_TOOL_CALLS"),
        maxPerRound: parseIntCap(process.env.MAX_TOOL_CALLS_PER_ROUND, DEFAULT_MAX_TOOL_CALLS_PER_ROUND, 1, 50, "MAX_TOOL_CALLS_PER_ROUND"),
      };
}