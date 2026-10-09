export type TriagePhase = "reproduce" | "localize" | "reduce" | "fix" | "guard";
export type ErrorLayer = "frontend" | "api" | "database" | "build" | "external" | "test" | "unknown";
export type TriageSeverity = "critical" | "high" | "medium" | "low";

export interface ErrorEvidence {
  toolName: string;
  errorMessage: string;
  params: Record<string, any>;
  timestamp: number;
  layer: ErrorLayer;
  stackHint?: string;
}

export interface TriageResult {
  phase: TriagePhase;
  layer: ErrorLayer;
  severity: TriageSeverity;
  rootCause: string;
  evidence: ErrorEvidence[];
  diagnosis: string;
  suggestedFix: string;
  shouldBlock: boolean;
  retryStrategy: RetryStrategy | null;
  guard: string | null;
}

export interface RetryStrategy {
  action: "retry_same" | "retry_corrected" | "use_alternative" | "escalate";
  correctedParams?: Record<string, any>;
  alternativeTool?: string;
  maxRetries: number;
  backoffMs: number;
}

export interface TriageSession {
  id: string;
  startedAt: number;
  errors: ErrorEvidence[];
  currentPhase: TriagePhase;
  blockedForward: boolean;
  diagnosis: TriageResult | null;
}

const activeSessions = new Map<string, TriageSession>();

const ERROR_PATTERNS: { pattern: RegExp; layer: ErrorLayer; severity: TriageSeverity; hint: string }[] = [
  { pattern: /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed/i, layer: "external", severity: "medium", hint: "Network connectivity issue — external service unreachable" },
  { pattern: /rate.?limit|429|too many requests/i, layer: "external", severity: "low", hint: "Rate limited by external API — implement exponential backoff" },
  { pattern: /unauthorized|401|403|forbidden|invalid.*key/i, layer: "api", severity: "high", hint: "Authentication/authorization failure — check API keys and permissions" },
  { pattern: /syntax.?error|unexpected.?token|cannot.?parse/i, layer: "build", severity: "high", hint: "Code syntax error — check recent changes for typos" },
  { pattern: /null|undefined.*not.*object|cannot read prop/i, layer: "api", severity: "medium", hint: "Null reference — data not loaded or missing expected field" },
  { pattern: /duplicate.*key|unique.*constraint|violates/i, layer: "database", severity: "medium", hint: "Database constraint violation — record already exists or referential integrity issue" },
  { pattern: /out of memory|heap|allocation/i, layer: "api", severity: "critical", hint: "Memory exhaustion — check for unbounded data loading or memory leaks" },
  { pattern: /timeout|timed.?out|deadline/i, layer: "external", severity: "medium", hint: "Operation timed out — increase timeout or reduce payload size" },
  { pattern: /CORS|cross.?origin|blocked by/i, layer: "frontend", severity: "medium", hint: "CORS policy blocking request — check server CORS configuration" },
  { pattern: /no results? found/i, layer: "external", severity: "low", hint: "Search returned no results — try broader or different search terms" },
  { pattern: /not found|404|no such|does not exist/i, layer: "api", severity: "low", hint: "Resource not found — verify ID/path and check if resource was created" },
  { pattern: /permission|access denied|not allowed/i, layer: "api", severity: "high", hint: "Permission denied — check tenant isolation and role-based access" },
  { pattern: /quota|limit exceeded|billing/i, layer: "external", severity: "high", hint: "Quota or billing limit exceeded — check provider dashboard" },
  { pattern: /model.*not.*found|invalid.*model|unsupported.*model/i, layer: "external", severity: "medium", hint: "Model not available — check model ID and provider status" },
  { pattern: /content.*filter|safety|blocked.*content/i, layer: "external", severity: "low", hint: "Content safety filter triggered — rephrase the request" },
];

export function classifyError(errorMsg: string): { layer: ErrorLayer; severity: TriageSeverity; hint: string } {
  for (const ep of ERROR_PATTERNS) {
    if (ep.pattern.test(errorMsg)) {
      return { layer: ep.layer, severity: ep.severity, hint: ep.hint };
    }
  }
  return { layer: "unknown", severity: "medium", hint: "Unclassified error — requires manual investigation" };
}

export function shouldStopTheLine(errors: ErrorEvidence[]): boolean {
  const hasCritical = errors.some(e => {
    const { severity } = classifyError(e.errorMessage);
    return severity === "critical";
  });
  if (hasCritical) return true;

  const nonLowErrors = errors.filter(e => {
    const { severity } = classifyError(e.errorMessage);
    return severity !== "low";
  });
  if (nonLowErrors.length >= 3) return true;

  if (errors.length >= 6) return true;

  const recentErrors = errors.filter(e => Date.now() - e.timestamp < 30_000);
  if (recentErrors.length >= 2) {
    const tools = new Set(recentErrors.map(e => e.toolName));
    if (tools.size === 1) return true;
  }

  return false;
}

export function startTriageSession(toolName: string, errorMsg: string, params: Record<string, any>): TriageSession {
  const sessionId = `triage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const evidence: ErrorEvidence = {
    toolName,
    errorMessage: errorMsg,
    params: sanitizeParams(params),
    timestamp: Date.now(),
    layer: classifyError(errorMsg).layer,
  };

  const session: TriageSession = {
    id: sessionId,
    startedAt: Date.now(),
    errors: [evidence],
    currentPhase: "reproduce",
    blockedForward: false,
    diagnosis: null,
  };

  activeSessions.set(sessionId, session);

  if (activeSessions.size > 50) {
    const oldest = [...activeSessions.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt);
    for (let i = 0; i < oldest.length - 50; i++) {
      activeSessions.delete(oldest[i][0]);
    }
  }

  return session;
}

export function addErrorToSession(sessionId: string, toolName: string, errorMsg: string, params: Record<string, any>): TriageSession | null {
  const session = activeSessions.get(sessionId);
  if (!session) return null;

  session.errors.push({
    toolName,
    errorMessage: errorMsg,
    params: sanitizeParams(params),
    timestamp: Date.now(),
    layer: classifyError(errorMsg).layer,
  });

  if (shouldStopTheLine(session.errors)) {
    session.blockedForward = true;
  }

  return session;
}

export function triageErrors(errors: ErrorEvidence[]): TriageResult {
  if (errors.length === 0) {
    return emptyTriageResult();
  }

  const latest = errors[errors.length - 1];
  const classification = classifyError(latest.errorMessage);

  const layerCounts = new Map<ErrorLayer, number>();
  for (const e of errors) {
    const l = classifyError(e.errorMessage).layer;
    layerCounts.set(l, (layerCounts.get(l) || 0) + 1);
  }
  const primaryLayer = [...layerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";

  const uniqueErrors = new Set(errors.map(e => e.errorMessage.slice(0, 80)));
  const isRepeating = errors.length > 1 && uniqueErrors.size === 1;
  const isSameTool = new Set(errors.map(e => e.toolName)).size === 1;

  let rootCause = classification.hint;
  let suggestedFix = "";
  let retryStrategy: RetryStrategy | null = null;

  if (isRepeating && isSameTool) {
    rootCause = `Repeating failure on ${latest.toolName}: ${classification.hint}`;
    suggestedFix = `The same error occurred ${errors.length} times on the same tool. Do NOT retry the same approach. Either use corrected parameters or switch to an alternative tool.`;
    retryStrategy = {
      action: errors.length >= 3 ? "use_alternative" : "retry_corrected",
      maxRetries: 0,
      backoffMs: 0,
    };
  } else if (classification.layer === "external") {
    suggestedFix = `External service issue. ${classification.hint}. Wait and retry with exponential backoff.`;
    retryStrategy = {
      action: "retry_same",
      maxRetries: 2,
      backoffMs: 2000,
    };
  } else if (classification.layer === "database") {
    suggestedFix = `Database issue. ${classification.hint}. Check query parameters and schema.`;
    retryStrategy = {
      action: "retry_corrected",
      maxRetries: 1,
      backoffMs: 500,
    };
  } else if (classification.severity === "critical") {
    suggestedFix = `Critical failure — stop and escalate. ${classification.hint}`;
    retryStrategy = {
      action: "escalate",
      maxRetries: 0,
      backoffMs: 0,
    };
  } else {
    suggestedFix = classification.hint;
    retryStrategy = {
      action: "retry_corrected",
      maxRetries: 1,
      backoffMs: 1000,
    };
  }

  const shouldBlock = shouldStopTheLine(errors);

  return {
    phase: errors.length === 1 ? "reproduce" : errors.length <= 3 ? "localize" : "reduce",
    layer: primaryLayer as ErrorLayer,
    severity: classification.severity,
    rootCause,
    evidence: errors,
    diagnosis: buildDiagnosisSummary(errors, classification),
    suggestedFix,
    shouldBlock,
    retryStrategy,
    guard: shouldBlock ? `STOP-THE-LINE: ${errors.length} errors detected. Do not add features or proceed. Diagnose and fix the root cause first.` : null,
  };
}

export function buildTriageHint(result: TriageResult): string {
  const parts: string[] = [];

  parts.push(`\n--- ERROR TRIAGE (${result.phase.toUpperCase()}) ---`);
  parts.push(`Layer: ${result.layer} | Severity: ${result.severity}`);
  parts.push(`Root Cause: ${result.rootCause}`);
  parts.push(`Diagnosis: ${result.diagnosis}`);
  parts.push(`Fix: ${result.suggestedFix}`);

  if (result.shouldBlock) {
    parts.push(`\nSTOP-THE-LINE ACTIVATED: Do NOT proceed with new work until this is resolved.`);
    parts.push(`Evidence: ${result.evidence.length} errors in ${result.evidence.map(e => e.toolName).join(", ")}`);
  }

  if (result.retryStrategy) {
    const rs = result.retryStrategy;
    if (rs.action === "escalate") {
      parts.push(`ACTION: Escalate to user — this cannot be auto-resolved.`);
    } else if (rs.action === "use_alternative") {
      parts.push(`ACTION: Switch to an alternative tool. Do not retry the failed tool.`);
    } else if (rs.action === "retry_corrected") {
      parts.push(`ACTION: Retry with corrected parameters. Max retries: ${rs.maxRetries}.`);
    } else {
      parts.push(`ACTION: Retry with backoff (${rs.backoffMs}ms). Max retries: ${rs.maxRetries}.`);
    }
  }

  parts.push(`--- END TRIAGE ---`);
  return parts.join("\n");
}

function buildDiagnosisSummary(errors: ErrorEvidence[], classification: ReturnType<typeof classifyError>): string {
  const tools = [...new Set(errors.map(e => e.toolName))];
  const layers = [...new Set(errors.map(e => classifyError(e.errorMessage).layer))];
  const timeSpanMs = errors.length > 1 ? errors[errors.length - 1].timestamp - errors[0].timestamp : 0;

  let summary = `${errors.length} error(s) across ${tools.length} tool(s) in ${layers.join("/")} layer(s)`;
  if (timeSpanMs > 0) {
    summary += ` over ${Math.round(timeSpanMs / 1000)}s`;
  }
  summary += `. Primary classification: ${classification.hint}`;

  return summary;
}

function sanitizeParams(params: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith("_")) continue;
    if (typeof v === "string" && v.length > 200) {
      clean[k] = v.slice(0, 200) + "...";
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

function emptyTriageResult(): TriageResult {
  return {
    phase: "reproduce",
    layer: "unknown",
    severity: "low",
    rootCause: "No errors to triage",
    evidence: [],
    diagnosis: "No errors found",
    suggestedFix: "No action needed",
    shouldBlock: false,
    retryStrategy: null,
    guard: null,
  };
}

export function getActiveSession(sessionId: string): TriageSession | null {
  return activeSessions.get(sessionId) || null;
}

export function closeTriageSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

export function getTriageStats(): { activeSessions: number; totalErrors: number } {
  let totalErrors = 0;
  for (const s of activeSessions.values()) {
    totalErrors += s.errors.length;
  }
  return { activeSessions: activeSessions.size, totalErrors };
}
