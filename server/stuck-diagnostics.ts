import { storage } from "./storage";
import { isOffHours } from "./db";

import { logSilentCatch } from "./lib/silent-catch";
const CIRCULAR_LOOP_THRESHOLD = 3;
const PARAM_SIMILARITY_THRESHOLD = 0.8;
const STALLED_DELEGATION_MS = 3 * 60 * 1000;
const HUNG_BROWSER_SESSION_MS = 5 * 60 * 1000;
const HUNG_HTTP_REQUEST_MS = 2 * 60 * 1000;
const CHIEF_OF_STAFF_PERSONA_ID = 6;

export interface StuckPattern {
  type: "circular_tool_loop" | "hung_process" | "stalled_delegation";
  detectedAt: number;
  description: string;
  durationMs: number;
  probableCause: string;
  remediation: string;
  metadata: Record<string, any>;
}

export interface DiagnosticReport {
  timestamp: number;
  patterns: StuckPattern[];
  activeTasks: { taskId: number; taskName: string; personaName: string | null; runningMs: number }[];
  stalledDelegations: { delegationId: string; conversationId: number; lastEventAge: string; agentName: string }[];
  hungProcesses: { type: string; idleSeconds: number; tenantId: number }[];
  toolLoopWarnings: { conversationId: number; toolName: string; repeatCount: number }[];
  trackedHttpRequests: number;
}

interface ToolCallEntry {
  toolName: string;
  argsKey: string;
  round: number;
  timestamp: number;
}

const turnToolCalls = new Map<number, ToolCallEntry[]>();
const TOOL_CALL_HISTORY_SIZE = 30;
const TOOL_CALL_TTL_MS = 10 * 60 * 1000;

const detectedPatterns: StuckPattern[] = [];
const MAX_PATTERNS = 50;
const recentReportKeys = new Map<string, number>();
const REPORT_DEDUP_MS = 5 * 60 * 1000;

interface ActiveDelegation {
  taskName: string;
  personaName: string | null;
  conversationId: number;
  tenantId: number;
  startedAt: number;
  depth: number;
}

const activeDelegations = new Map<string, ActiveDelegation>();

export function trackDelegation(conversationId: number, taskName: string, personaName: string | null, tenantId: number, depth: number): string {
  const id = `deleg_${conversationId}_${Date.now()}`;
  activeDelegations.set(id, { taskName, personaName, conversationId, tenantId, startedAt: Date.now(), depth });
  return id;
}

export function untrackDelegation(id: string): void {
  activeDelegations.delete(id);
}

export function getActiveDelegationCount(): number {
  return activeDelegations.size;
}

interface TrackedHttpRequest {
  id: string;
  url: string;
  startedAt: number;
  tenantId?: number;
  toolName?: string;
  abortController?: AbortController;
  timeoutMs: number;
}

const activeHttpRequests = new Map<string, TrackedHttpRequest>();
let httpReqCounter = 0;

export function trackHttpRequest(url: string, tenantId?: number, toolName?: string, abortController?: AbortController, timeoutMs?: number): string {
  const id = `http_${++httpReqCounter}_${Date.now()}`;
  activeHttpRequests.set(id, { id, url, startedAt: Date.now(), tenantId, toolName, abortController, timeoutMs: timeoutMs || HUNG_HTTP_REQUEST_MS });
  return id;
}

export function untrackHttpRequest(id: string): void {
  activeHttpRequests.delete(id);
}

export function getTrackedHttpRequests(): TrackedHttpRequest[] {
  return Array.from(activeHttpRequests.values());
}

export function recordToolCallForStuckDetection(
  conversationId: number,
  toolName: string,
  args: Record<string, any>,
  round: number
): StuckPattern | null {
  const entries = turnToolCalls.get(conversationId) || [];
  const argsKey = normalizeArgs(args);
  entries.push({ toolName, argsKey, round, timestamp: Date.now() });
  if (entries.length > TOOL_CALL_HISTORY_SIZE) entries.shift();
  turnToolCalls.set(conversationId, entries);

  const sameToolSameTurn = entries.filter(
    (e) => e.toolName === toolName && e.round === round
  );

  if (sameToolSameTurn.length >= CIRCULAR_LOOP_THRESHOLD) {
    const similarCount = sameToolSameTurn.filter(
      (e) => computeSimilarity(e.argsKey, argsKey) >= PARAM_SIMILARITY_THRESHOLD
    ).length;

    if (similarCount >= CIRCULAR_LOOP_THRESHOLD) {
      const pattern: StuckPattern = {
        type: "circular_tool_loop",
        detectedAt: Date.now(),
        description: `Tool "${toolName}" called ${similarCount} times in turn (round ${round}) with >80% similar params in conversation ${conversationId}`,
        durationMs: Date.now() - sameToolSameTurn[0].timestamp,
        probableCause: `Agent stuck in loop calling "${toolName}" repeatedly with near-identical arguments in a single turn`,
        remediation: "Injected system message forcing agent to try a different approach; pattern logged to operations channel",
        metadata: { conversationId, toolName, repeatCount: similarCount, round },
      };
      addPattern(pattern);
      return pattern;
    }
  }

  return null;
}

export async function detectStalledDelegations(): Promise<StuckPattern[]> {
  const patterns: StuckPattern[] = [];
  try {
    const now = Date.now();
    if (activeDelegations.size === 0) return patterns;

    const SYNTHETIC_EVENT_TYPES = new Set(["warning", "failed"]);
    let getLastRealEventTimeAfter: ((convId: number, afterTs: number) => number | null) | null = null;
    try {
      const { getRecentEvents } = await import("./delegation-events");
      getLastRealEventTimeAfter = (convId: number, afterTs: number) => {
        const events = getRecentEvents(convId).filter(
          e => e.timestamp >= afterTs && !SYNTHETIC_EVENT_TYPES.has(e.type)
        );
        if (events.length === 0) return null;
        return Math.max(...events.map(e => e.timestamp));
      };
    } catch (_silentErr) { logSilentCatch("server/stuck-diagnostics.ts", _silentErr); }

    for (const [delegId, deleg] of activeDelegations) {
      const elapsed = now - deleg.startedAt;
      let eventAge = elapsed;

      if (getLastRealEventTimeAfter) {
        const lastTs = getLastRealEventTimeAfter(deleg.conversationId, deleg.startedAt);
        if (lastTs) {
          eventAge = now - lastTs;
        }
      }

      if (eventAge > STALLED_DELEGATION_MS) {
        const pattern: StuckPattern = {
          type: "stalled_delegation",
          detectedAt: now,
          description: `Delegation "${deleg.taskName}" (persona: ${deleg.personaName || "unknown"}, conv: ${deleg.conversationId}) — no events for ${Math.round(eventAge / 60000)}min (total age: ${Math.round(elapsed / 60000)}min)`,
          durationMs: elapsed,
          probableCause: "Delegation task stalled — no new delegation events emitted for 3+ minutes despite task still being active",
          remediation: eventAge > STALLED_DELEGATION_MS * 2
            ? "Removing stalled delegation from tracking and logging diagnostic"
            : "Warning emitted; will remove tracking if stall persists next cycle",
          metadata: { delegationId: delegId, taskName: deleg.taskName, personaName: deleg.personaName, conversationId: deleg.conversationId, elapsedMs: elapsed, eventAgeMs: eventAge },
        };
        patterns.push(pattern);
        addPattern(pattern);

        try {
          const { emitDelegationEvent } = await import("./delegation-events");
          emitDelegationEvent({
            conversationId: deleg.conversationId,
            tenantId: deleg.tenantId,
            type: "warning",
            agentName: deleg.personaName || "unknown",
            depth: deleg.depth,
            message: `Stalled: "${deleg.taskName}" — no events for ${Math.round(eventAge / 60000)}min`,
            metadata: { delegationId: delegId, eventAgeMs: eventAge, elapsedMs: elapsed },
          });
        } catch (_silentErr) { logSilentCatch("server/stuck-diagnostics.ts", _silentErr); }

        if (eventAge > STALLED_DELEGATION_MS * 2) {
          activeDelegations.delete(delegId);
          console.log(`[stuck-diagnostics] Removed stalled delegation tracking "${deleg.taskName}" (conv: ${deleg.conversationId}) after ${Math.round(eventAge / 60000)}min of event inactivity`);

          try {
            const { emitDelegationEvent } = await import("./delegation-events");
            emitDelegationEvent({
              conversationId: deleg.conversationId,
              tenantId: deleg.tenantId,
              type: "failed",
              agentName: deleg.personaName || "unknown",
              depth: deleg.depth,
              message: `Removed from tracking: "${deleg.taskName}" after ${Math.round(eventAge / 60000)}min stall. Underlying process may still run.`,
              metadata: { delegationId: delegId, reason: "stall_timeout" },
            });
          } catch (_silentErr) { logSilentCatch("server/stuck-diagnostics.ts", _silentErr); }

          await storage.createHeartbeatLog({
            taskId: 0,
            taskName: `stalled_delegation:${deleg.taskName}`,
            status: "error",
            input: JSON.stringify({ conversationId: deleg.conversationId, personaName: deleg.personaName }),
            output: `Stalled delegation removed from tracking after ${Math.round(eventAge / 60000)} minutes of event inactivity. The underlying process may still be running.`,
            model: null,
            personaId: null,
            personaName: deleg.personaName,
            delegatedTasks: null,
            durationMs: elapsed,
          }).catch(() => {});
        }
      }
    }
  } catch (err: any) {
    console.error("[stuck-diagnostics] Stalled delegation check failed:", err.message);
  }
  return patterns;
}

export async function detectHungProcesses(): Promise<StuckPattern[]> {
  const patterns: StuckPattern[] = [];
  const now = Date.now();

  try {
    const { getActiveSessions } = await import("./browser-tool");
    const sessions = getActiveSessions();
    const allIdle = sessions.length > 0 && sessions.every(s => s.idleSeconds > 300);

    for (const session of sessions) {
      const idleMs = now - session.lastActivity;
      if (idleMs > HUNG_BROWSER_SESSION_MS) {
        const pattern: StuckPattern = {
          type: "hung_process",
          detectedAt: now,
          description: `Browser session (tenant ${session.tenantId}, profile "${session.profile}") idle for ${Math.round(idleMs / 60000)}min`,
          durationMs: idleMs,
          probableCause: "Browser session was opened but never closed — possible zombie process or abandoned navigation",
          remediation: allIdle
            ? "All browser sessions are idle — watchdog will disconnect all sessions"
            : "Individual session flagged as idle; other sessions still active — skipping disconnect to avoid disruption",
          metadata: {
            processType: "browser_session",
            tenantId: session.tenantId,
            profile: session.profile,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
            actionCount: session.actionCount,
            idleSeconds: session.idleSeconds,
          },
        };
        patterns.push(pattern);
        addPattern(pattern);
      }
    }
  } catch (err: any) {
    console.error("[stuck-diagnostics] Hung browser check failed:", err.message);
  }

  try {
    const hungRequests: TrackedHttpRequest[] = [];
    for (const [id, req] of activeHttpRequests) {
      const elapsed = now - req.startedAt;
      const deadline = req.timeoutMs * 1.5;
      if (elapsed > deadline) {
        hungRequests.push(req);
      }
    }

    for (const req of hungRequests) {
      let remediationAction = "Aborting hung HTTP request";
      if (req.abortController) {
        try {
          req.abortController.abort();
          remediationAction = "HTTP request aborted via AbortController";
        } catch {
          remediationAction = "Abort attempted but failed";
        }
      }
      activeHttpRequests.delete(req.id);

      const elapsed = now - req.startedAt;
      const pattern: StuckPattern = {
        type: "hung_process",
        detectedAt: now,
        description: `HTTP request to "${req.url?.slice(0, 80)}" (tool: ${req.toolName || "unknown"}) running for ${Math.round(elapsed / 60000)}min`,
        durationMs: elapsed,
        probableCause: "HTTP request exceeded timeout without response — target may be unresponsive or connection stalled",
        remediation: remediationAction,
        metadata: {
          processType: "http_request",
          url: req.url?.slice(0, 200),
          toolName: req.toolName,
          tenantId: req.tenantId || 0,
          requestId: req.id,
        },
      };
      patterns.push(pattern);
      addPattern(pattern);
    }
  } catch (err: any) {
    console.error("[stuck-diagnostics] Hung HTTP check failed:", err.message);
  }

  return patterns;
}

export async function runFullDiagnostics(): Promise<DiagnosticReport> {
  const now = Date.now();
  const patterns: StuckPattern[] = [];

  const [stalledPatterns, hungPatterns] = await Promise.all([
    detectStalledDelegations(),
    detectHungProcesses(),
  ]);
  patterns.push(...stalledPatterns, ...hungPatterns);

  const activeTasks: DiagnosticReport["activeTasks"] = [];
  try {
    const { activeTaskTracker } = await import("./heartbeat");
    for (const [taskId, info] of activeTaskTracker) {
      activeTasks.push({
        taskId,
        taskName: info.taskName,
        personaName: info.personaName || null,
        runningMs: now - info.startedAt,
      });
    }
  } catch (_silentErr) { logSilentCatch("server/stuck-diagnostics.ts", _silentErr); }

  const stalledDelegations: DiagnosticReport["stalledDelegations"] = stalledPatterns.map((p) => ({
    delegationId: p.metadata.delegationId || "",
    conversationId: p.metadata.conversationId || 0,
    lastEventAge: `${Math.round((p.metadata.eventAgeMs || 0) / 60000)}min`,
    agentName: p.metadata.personaName || "unknown",
  }));

  const hungProcesses: DiagnosticReport["hungProcesses"] = hungPatterns.map((p) => ({
    type: p.metadata.processType || "unknown",
    idleSeconds: p.metadata.idleSeconds || Math.round(p.durationMs / 1000),
    tenantId: p.metadata.tenantId || 0,
  }));

  const toolLoopWarnings: DiagnosticReport["toolLoopWarnings"] = [];
  for (const [convId, entries] of turnToolCalls) {
    const toolCounts = new Map<string, number>();
    const recent = entries.filter((e) => now - e.timestamp < 120_000);
    for (const e of recent) {
      toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1);
    }
    for (const [toolName, count] of toolCounts) {
      if (count >= 2) {
        toolLoopWarnings.push({ conversationId: convId, toolName, repeatCount: count });
      }
    }
  }

  return {
    timestamp: now,
    patterns,
    activeTasks,
    stalledDelegations,
    hungProcesses,
    toolLoopWarnings,
    trackedHttpRequests: activeHttpRequests.size,
  };
}

export function getRecentPatterns(since?: number): StuckPattern[] {
  if (since) return detectedPatterns.filter((p) => p.detectedAt > since);
  return [...detectedPatterns];
}

export async function inspectDiagnostics(): Promise<DiagnosticReport> {
  const now = Date.now();
  const patterns = [...detectedPatterns];

  const activeTasks: DiagnosticReport["activeTasks"] = [];
  try {
    const { activeTaskTracker } = await import("./heartbeat");
    for (const [taskId, info] of activeTaskTracker) {
      activeTasks.push({
        taskId,
        taskName: info.taskName,
        personaName: info.personaName || null,
        runningMs: now - info.startedAt,
      });
    }
  } catch (_silentErr) { logSilentCatch("server/stuck-diagnostics.ts", _silentErr); }

  const SYNTHETIC_TYPES = new Set(["warning", "failed"]);
  let inspectLastRealEvent: ((convId: number, afterTs: number) => number | null) | null = null;
  try {
    const { getRecentEvents } = await import("./delegation-events");
    inspectLastRealEvent = (convId: number, afterTs: number) => {
      const events = getRecentEvents(convId).filter(
        e => e.timestamp >= afterTs && !SYNTHETIC_TYPES.has(e.type)
      );
      if (events.length === 0) return null;
      return Math.max(...events.map(e => e.timestamp));
    };
  } catch (_silentErr) { logSilentCatch("server/stuck-diagnostics.ts", _silentErr); }

  const stalledDelegations: DiagnosticReport["stalledDelegations"] = [];
  for (const [delegId, deleg] of activeDelegations) {
    const elapsed = now - deleg.startedAt;
    let eventAge = elapsed;
    if (inspectLastRealEvent) {
      const lastTs = inspectLastRealEvent(deleg.conversationId, deleg.startedAt);
      if (lastTs) eventAge = now - lastTs;
    }
    if (eventAge > STALLED_DELEGATION_MS) {
      stalledDelegations.push({
        delegationId: delegId,
        conversationId: deleg.conversationId,
        lastEventAge: `${Math.round(eventAge / 60000)}min`,
        agentName: deleg.personaName || "unknown",
      });
    }
  }

  const hungProcesses: DiagnosticReport["hungProcesses"] = [];
  try {
    const { getActiveSessions } = await import("./browser-tool");
    for (const session of getActiveSessions()) {
      const idleMs = now - session.lastActivity;
      if (idleMs > HUNG_BROWSER_SESSION_MS) {
        hungProcesses.push({ type: "browser_session", idleSeconds: Math.round(idleMs / 1000), tenantId: session.tenantId });
      }
    }
  } catch (_silentErr) { logSilentCatch("server/stuck-diagnostics.ts", _silentErr); }
  for (const [, req] of activeHttpRequests) {
    const elapsed = now - req.startedAt;
    if (elapsed > req.timeoutMs * 1.5) {
      hungProcesses.push({ type: "http_request", idleSeconds: Math.round(elapsed / 1000), tenantId: req.tenantId || 0 });
    }
  }

  const toolLoopWarnings: DiagnosticReport["toolLoopWarnings"] = [];
  for (const [convId, entries] of turnToolCalls) {
    const toolCounts = new Map<string, number>();
    const recent = entries.filter((e) => now - e.timestamp < 120_000);
    for (const e of recent) {
      toolCounts.set(e.toolName, (toolCounts.get(e.toolName) || 0) + 1);
    }
    for (const [toolName, count] of toolCounts) {
      if (count >= 2) {
        toolLoopWarnings.push({ conversationId: convId, toolName, repeatCount: count });
      }
    }
  }

  return {
    timestamp: now,
    patterns,
    activeTasks,
    stalledDelegations,
    hungProcesses,
    toolLoopWarnings,
    trackedHttpRequests: activeHttpRequests.size,
  };
}

export async function postDiagnosticReport(patterns: StuckPattern[]): Promise<void> {
  if (patterns.length === 0) return;

  const now = Date.now();
  for (const [key, ts] of recentReportKeys) {
    if (now - ts > REPORT_DEDUP_MS) recentReportKeys.delete(key);
  }

  const dedupedPatterns = patterns.filter((p) => {
    const key = `${p.type}:${p.metadata.conversationId || ""}:${p.metadata.toolName || ""}:${p.metadata.delegationId || ""}`;
    if (recentReportKeys.has(key)) return false;
    recentReportKeys.set(key, now);
    return true;
  });

  if (dedupedPatterns.length === 0) return;

  const lines = dedupedPatterns.map((p) => {
    const { tenantId, ...safeMetadata } = p.metadata as any;
    return `**${p.type}** — ${p.description}\n  Cause: ${p.probableCause}\n  Action: ${p.remediation}`;
  });

  try {
    const { postMessage } = await import("./agent-channels");
    await postMessage({
      tenantId: 1,
      channelName: "operations",
      fromPersonaId: CHIEF_OF_STAFF_PERSONA_ID,
      content: `🔍 **Stuck Detection Report** (${dedupedPatterns.length} pattern${dedupedPatterns.length > 1 ? "s" : ""} found)\n\n${lines.join("\n\n")}\n\n_Detected at ${new Date().toLocaleTimeString()}_`,
      messageType: "system",
    });
  } catch (_silentErr) { logSilentCatch("server/stuck-diagnostics.ts", _silentErr); }

  for (const p of dedupedPatterns) {
    try {
      await storage.createHeartbeatLog({
        taskId: 0,
        taskName: `stuck_detection:${p.type}`,
        status: "warning",
        input: JSON.stringify(p.metadata).slice(0, 500),
        output: `${p.description} | Cause: ${p.probableCause} | Action: ${p.remediation}`,
        model: null,
        personaId: CHIEF_OF_STAFF_PERSONA_ID,
        personaName: "Chief of Staff",
        delegatedTasks: null,
        durationMs: p.durationMs,
      }).catch(() => {});
    } catch (_silentErr) { logSilentCatch("server/stuck-diagnostics.ts", _silentErr); }
  }
}

const errorHistory = new Map<number, { error: string; count: number; firstSeen: number; lastSeen: number }[]>();
const delegationCosts = new Map<string, { totalCost: number; startedAt: number; budgetLimit: number }>();

export function recordErrorForRetryStormDetection(
  conversationId: number,
  errorMessage: string,
): StuckPattern | null {
  const entries = errorHistory.get(conversationId) || [];
  const errorSig = errorMessage.slice(0, 100).toLowerCase().replace(/[0-9]+/g, "N");
  
  const existing = entries.find(e => e.error === errorSig);
  if (existing) {
    if (Date.now() - existing.lastSeen > 120_000) {
      existing.count = 1;
      existing.firstSeen = Date.now();
    } else {
      existing.count++;
    }
    existing.lastSeen = Date.now();
  } else {
    entries.push({ error: errorSig, count: 1, firstSeen: Date.now(), lastSeen: Date.now() });
  }
  if (entries.length > 20) entries.shift();
  errorHistory.set(conversationId, entries);

  const STORM_THRESHOLD = 5;
  const STORM_WINDOW_MS = 90_000;
  
  const storms = entries.filter(e => 
    e.count >= STORM_THRESHOLD && 
    (e.lastSeen - e.firstSeen) < STORM_WINDOW_MS
  );

  if (storms.length > 0) {
    const worst = storms.reduce((a, b) => a.count > b.count ? a : b);
    const pattern: StuckPattern = {
      type: "circular_tool_loop",
      detectedAt: Date.now(),
      description: `Retry storm detected: same error "${worst.error.slice(0, 60)}" occurred ${worst.count} times in ${Math.round((worst.lastSeen - worst.firstSeen) / 1000)}s (conv: ${conversationId})`,
      durationMs: worst.lastSeen - worst.firstSeen,
      probableCause: "Agent retrying a failing operation without changing approach — likely a persistent error that won't self-resolve",
      remediation: "Inject corrective system message and consider halting the delegation chain",
      metadata: { conversationId, errorSignature: worst.error, retryCount: worst.count },
    };
    addPattern(pattern);
    return pattern;
  }

  return null;
}

export function trackDelegationCost(delegationId: string, costUsd: number): StuckPattern | null {
  const entry = delegationCosts.get(delegationId);
  if (!entry) return null;

  entry.totalCost += costUsd;

  if (entry.totalCost > entry.budgetLimit) {
    const pattern: StuckPattern = {
      type: "hung_process",
      detectedAt: Date.now(),
      description: `Cost drift: delegation "${delegationId}" spent $${entry.totalCost.toFixed(4)} exceeding budget of $${entry.budgetLimit.toFixed(4)}`,
      durationMs: Date.now() - entry.startedAt,
      probableCause: "Delegation chain consuming more API credits than budgeted — may indicate runaway tool calls or excessive model usage",
      remediation: "Alert owner, consider throttling or halting the delegation",
      metadata: { delegationId, totalCost: entry.totalCost, budgetLimit: entry.budgetLimit },
    };
    addPattern(pattern);
    return pattern;
  }
  return null;
}

export function startCostTracking(delegationId: string, budgetLimit: number = 0.50): void {
  delegationCosts.set(delegationId, { totalCost: 0, startedAt: Date.now(), budgetLimit });
}

export function stopCostTracking(delegationId: string): { totalCost: number } | null {
  const entry = delegationCosts.get(delegationId);
  delegationCosts.delete(delegationId);
  return entry ? { totalCost: entry.totalCost } : null;
}

export function cleanupStaleToolCallHistory(): void {
  const cutoff = Date.now() - TOOL_CALL_TTL_MS;
  for (const [convId, entries] of turnToolCalls) {
    const filtered = entries.filter((e) => e.timestamp > cutoff);
    if (filtered.length === 0) turnToolCalls.delete(convId);
    else turnToolCalls.set(convId, filtered);
  }

  for (const [id, req] of activeHttpRequests) {
    if (Date.now() - req.startedAt > TOOL_CALL_TTL_MS) {
      activeHttpRequests.delete(id);
    }
  }

  for (const [id, deleg] of activeDelegations) {
    if (Date.now() - deleg.startedAt > TOOL_CALL_TTL_MS) {
      activeDelegations.delete(id);
    }
  }
}

setInterval(cleanupStaleToolCallHistory, 120_000);

async function periodicStalledDelegationCheck() {
  if (activeDelegations.size === 0) return;
  try {
    const patterns = await detectStalledDelegations();
    if (patterns.length > 0) {
      await postDiagnosticReport(patterns);
    }
  } catch (_silentErr) { logSilentCatch("server/stuck-diagnostics.ts", _silentErr); }
}
let delegationSkipCount = 0;
setInterval(() => {
  if (isOffHours()) {
    delegationSkipCount++;
    if (delegationSkipCount % 3 !== 0) return;
  } else {
    delegationSkipCount = 0;
  }
  periodicStalledDelegationCheck();
}, 120_000);

async function periodicHungRequestCheck() {
  const now = Date.now();
  const foundPatterns: StuckPattern[] = [];
  for (const [id, req] of activeHttpRequests) {
    const elapsed = now - req.startedAt;
    const deadline = req.timeoutMs * 1.5;
    if (elapsed > deadline) {
      let remediationAction = "Timed-out request wrapper removed from tracking";
      if (req.abortController) {
        try {
          req.abortController.abort();
          remediationAction = "Timed-out request wrapper aborted via AbortController (underlying tool work may still continue if not signal-aware)";
        } catch {
          remediationAction = "Abort attempted but failed; request removed from tracking";
        }
      }
      activeHttpRequests.delete(id);
      console.log(`[stuck-diagnostics] Hung HTTP request cleaned: ${req.toolName || req.url} after ${Math.round(elapsed / 1000)}s (deadline: ${Math.round(deadline / 1000)}s)`);

      const pattern: StuckPattern = {
        type: "hung_process",
        detectedAt: now,
        description: `HTTP request "${req.url?.slice(0, 80)}" (tool: ${req.toolName || "unknown"}) exceeded timeout by ${Math.round((elapsed - req.timeoutMs) / 1000)}s`,
        durationMs: elapsed,
        probableCause: "HTTP/tool request exceeded its timeout without cleanup — wrapper race resolved but underlying work may be orphaned",
        remediation: remediationAction,
        metadata: {
          processType: "http_request",
          url: req.url?.slice(0, 200),
          toolName: req.toolName,
          tenantId: req.tenantId || 0,
          timeoutMs: req.timeoutMs,
        },
      };
      foundPatterns.push(pattern);
      addPattern(pattern);
    }
  }
  if (foundPatterns.length > 0) {
    postDiagnosticReport(foundPatterns).catch(() => {});
  }
}
setInterval(() => {
  if (isOffHours() && activeHttpRequests.size === 0) return;
  periodicHungRequestCheck();
}, 120_000);

function normalizeArgs(args: Record<string, any>): string {
  const cleaned = { ...args };
  delete cleaned._tenantId;
  delete cleaned._conversationId;
  delete cleaned._depth;
  delete cleaned._currentDepth;
  delete cleaned._sourceSessionKey;
  delete cleaned._sourcePersonaName;
  delete cleaned._personaId;
  delete cleaned.returnBase64;
  const keys = Object.keys(cleaned).sort();
  return keys.map((k) => `${k}:${JSON.stringify(cleaned[k])}`).join("|");
}

function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0;
  const tokensA = new Set(a.split("|"));
  const tokensB = new Set(b.split("|"));
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function addPattern(pattern: StuckPattern): void {
  detectedPatterns.push(pattern);
  if (detectedPatterns.length > MAX_PATTERNS) {
    detectedPatterns.splice(0, detectedPatterns.length - MAX_PATTERNS);
  }
}
