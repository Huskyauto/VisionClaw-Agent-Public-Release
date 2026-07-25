import { storage } from "./storage";
import { processMessage, type ChatEngineResult } from "./chat-engine";
import { getModelForTierAsync, MODEL_REGISTRY, isModelMultimodal } from "./providers";
import { ADMIN_TENANT_ID } from "./auth";
import { logSilentCatch } from "./lib/silent-catch";
// @ts-ignore - uuid types not bundled
import { v4 as uuid } from "uuid";

type TaskTier = "fast" | "balanced" | "powerful" | "reasoning";

const TASK_TIER_PATTERNS: Record<TaskTier, RegExp[]> = {
  reasoning: [
    /\b(debug|diagnose|root\s*cause|why\s+(?:does|is|did|won't)|trace\s+(?:the|this)|figure\s+out\s+why)\b/i,
    /\b(step[- ]by[- ]step\s+(?:analysis|plan|breakdown)|trade[- ]?offs?|pros?\s*(?:and|&|vs)\s*cons?)\b/i,
    /\b(architect|system\s*design|security\s*(?:audit|review)|migration\s+plan|performance\s+tuning)\b/i,
    /\b(evaluate\s+(?:whether|if|options)|compare\s+(?:and|the)\s+(?:choose|pick|recommend))\b/i,
    /\b(legal\s+(?:analysis|review|implications)|financial\s+(?:analysis|forecast|model))\b/i,
    /\b(strategy|strategic\s+(?:plan|analysis)|competitive\s+(?:analysis|assessment))\b/i,
  ],
  powerful: [
    /\b(research|deep\s*dive|investigate|analyze|comprehensive|thorough|detailed\s+(?:report|analysis))\b/i,
    /\b(write\s+(?:a\s+)?(?:blog|article|report|proposal|brief|case\s+study))\b/i,
    /\b(implement|build|create\s+(?:a\s+)?(?:system|feature|api|service|integration))\b/i,
    /\b(review\s+(?:code|contract|content|draft)|audit|assess)\b/i,
    /\b(market\s+(?:analysis|research|sizing)|competitor\s+(?:analysis|research))\b/i,
    /\b(P&L|balance\s+sheet|cash\s+flow|revenue\s+(?:analysis|forecast))\b/i,
    /\b(contract|NDA|terms\s+of\s+service|compliance|regulatory)\b/i,
    /\b(campaign|editorial\s+calendar|content\s+strategy)\b/i,
  ],
  balanced: [
    /\b(summarize|draft|outline|email|list|search\s+for|look\s+up|find|check)\b/i,
    /\b(update|edit|revise|modify|format|organize|schedule)\b/i,
    /\b(report\s+(?:on|the)|status|progress|metrics|pipeline)\b/i,
    /\b(social\s+(?:media|post)|tweet|linkedin|newsletter)\b/i,
  ],
  fast: [
    /\b(what\s+is|define|translate|convert|calculate|count|when\s+(?:is|was|did))\b/i,
    /\b(quick|simple|brief|short|basic|just)\b/i,
    /\b(lookup|fetch|get\s+the|check\s+(?:if|whether))\b/i,
  ],
};

const MULTIMODAL_PATTERNS = [
  /\b(browse|browser|browsing|navigate|visit\s+(?:the|a|this)\s+(?:site|page|url|website))\b/i,
  /\b(screenshot|screen\s*shot|screen\s*capture|visual|vision|see\s+the\s+(?:page|screen|image))\b/i,
  /\b(image|photo|picture|graphic|visual|infographic|thumbnail|banner|poster|flyer)\b/i,
  /\b(social\s+media\s+(?:post|image|graphic|content)|instagram|tiktok|facebook\s+(?:post|ad))\b/i,
  /\b(design|create\s+(?:a\s+)?(?:image|graphic|visual|banner|logo))\b/i,
  /\b(look\s+at|analyze\s+(?:this|the)\s+(?:image|photo|screenshot|page))\b/i,
  /\b(video|audio|listen|watch|transcribe|caption)\b/i,
];

function taskNeedsMultimodal(task: string): boolean {
  return MULTIMODAL_PATTERNS.some(p => p.test(task));
}

export function classifyTaskComplexity(task: string): { tier: TaskTier; thinkingLevel: string; needsMultimodal: boolean } {
  const needsMultimodal = taskNeedsMultimodal(task);
  if (!task || task.length < 5) return { tier: "balanced", thinkingLevel: "off", needsMultimodal };

  const wordCount = task.split(/\s+/).length;
  let scores: Record<TaskTier, number> = { fast: 0, balanced: 0, powerful: 0, reasoning: 0 };

  for (const [tier, patterns] of Object.entries(TASK_TIER_PATTERNS) as [TaskTier, RegExp[]][]) {
    for (const p of patterns) {
      if (p.test(task)) scores[tier] += 1;
    }
  }

  if (wordCount > 80) { scores.powerful += 1; scores.reasoning += 1; }
  else if (wordCount > 40) scores.powerful += 1;
  else if (wordCount < 10) scores.fast += 1;

  if (needsMultimodal && scores.fast > scores.balanced) {
    scores.balanced = scores.fast + 1;
  }

  const entries = Object.entries(scores) as [TaskTier, number][];
  entries.sort((a, b) => b[1] - a[1]);

  const [bestTier, bestScore] = entries[0];

  if (bestScore === 0) {
    const tier = wordCount > 30 ? "balanced" : (needsMultimodal ? "balanced" : "fast");
    return { tier, thinkingLevel: "off", needsMultimodal };
  }

  let thinkingLevel = "off";
  if (bestTier === "reasoning") {
    thinkingLevel = "high";
  } else if (bestTier === "powerful" && scores.reasoning > 0) {
    thinkingLevel = "medium";
  } else if (bestTier === "powerful" && wordCount > 50) {
    thinkingLevel = "low";
  }

  return { tier: bestTier, thinkingLevel, needsMultimodal };
}

function resolveSubagentTier(task: string, personaCostTier?: string): { tier: TaskTier; thinkingLevel: string; needsMultimodal: boolean } {
  const taskResult = classifyTaskComplexity(task);

  const tierRank: Record<string, number> = { fast: 0, balanced: 1, powerful: 2, reasoning: 3 };
  const personaTier = (personaCostTier || "balanced") as TaskTier;

  const taskRank = tierRank[taskResult.tier] || 1;
  const personaRank = tierRank[personaTier] || 1;

  const finalTier = taskRank >= personaRank ? taskResult.tier : personaTier;

  return { tier: finalTier as TaskTier, thinkingLevel: taskResult.thinkingLevel, needsMultimodal: taskResult.needsMultimodal };
}

export interface SubagentRun {
  id: string;
  tenantId: number;
  parentConversationId: number;
  parentSessionKey: string;
  childConversationId: number;
  childSessionKey: string;
  agentId: number | null;
  label: string;
  task: string;
  model?: string;
  thinkingLevel?: string;
  status: "running" | "completed" | "failed" | "timeout" | "cancelled";
  createdAt: number;
  finishedAt?: number;
  result?: string;
  error?: string;
  tokenUsage?: { input: number; output: number };
  depth: number;
  mode: "run" | "session";
  toolsUsed?: { name: string; input: any; output: any }[];
  verificationStatus?: "pending" | "verified" | "rejected";
  /**
   * Independent completion verdict (Agentic Loop spec — maker/checker split applied
   * to subagents). A SEPARATE cheap model grades the run's evidence against a goal
   * contract derived from the task, BEFORE the result is announced to the parent.
   * Absent ⇒ the evaluator was disabled or unavailable (degraded → parent verifies,
   * the prior behavior). Fail-open by construction: a judge blip never blocks a run.
   */
  completionVerdict?: {
    verdict: "done" | "incomplete" | "halt" | "completed_unverified";
    unmetCriteria: string[];
    reason: string;
    evaluatorModel?: string;
    degraded?: boolean;
    retries: number;
  };
}

const activeRuns = new Map<string, SubagentRun>();
const MAX_CONCURRENT = 8;
const MAX_CHILDREN_PER_PARENT = 3;
const DEFAULT_TIMEOUT_SECONDS = 180;
const MAX_SPAWN_DEPTH = 2;
const ARCHIVE_AFTER_MINUTES = 60;

// Independent completion verification (Agentic Loop spec — maker/checker split).
// A separate cheap judge grades a completed run's evidence against a goal contract
// before it is announced. ON by default (the judge is a cheap flash model + fully
// fail-open). Escape hatch: SUBAGENT_COMPLETION_EVAL_OFF=1 disables it entirely.
// SUBAGENT_SELF_RETRY_MAX (default 1, clamped 0..2) bounds the in-run coached retry
// the run does on an "incomplete" verdict before it dumps on the parent.
function completionEvalEnabled(): boolean {
  return process.env.SUBAGENT_COMPLETION_EVAL_OFF !== "1";
}
function selfRetryMax(): number {
  const raw = parseInt(process.env.SUBAGENT_SELF_RETRY_MAX ?? "1", 10);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0, Math.min(2, raw));
}

export function getSubagentRuns(parentConversationId?: number): SubagentRun[] {
  const runs = Array.from(activeRuns.values());
  if (parentConversationId !== undefined) {
    return runs.filter(r => r.parentConversationId === parentConversationId);
  }
  return runs;
}

export function getSubagentRun(id: string): SubagentRun | undefined {
  return activeRuns.get(id);
}

function countActiveByParent(parentId: number): number {
  return Array.from(activeRuns.values()).filter(
    r => r.parentConversationId === parentId && r.status === "running"
  ).length;
}

function countAllActive(): number {
  return Array.from(activeRuns.values()).filter(r => r.status === "running").length;
}

export async function spawnSubagent(params: {
  parentConversationId: number;
  task: string;
  label?: string;
  agentId?: number;
  model?: string;
  thinkingLevel?: string;
  runTimeoutSeconds?: number;
  mode?: "run" | "session";
  depth?: number;
  tenantId?: number;
}): Promise<{
  accepted: boolean;
  runId?: string;
  childSessionKey?: string;
  error?: string;
}> {
  // R68.2 — wrap moved INTO executeSubagentRun (correct lifecycle + tenant from parent conv).
  return _spawnSubagentImpl(params);
}

async function _spawnSubagentImpl(params: {
  parentConversationId: number;
  task: string;
  label?: string;
  agentId?: number;
  model?: string;
  thinkingLevel?: string;
  runTimeoutSeconds?: number;
  mode?: "run" | "session";
  depth?: number;
  tenantId?: number;
}): Promise<{
  accepted: boolean;
  runId?: string;
  childSessionKey?: string;
  error?: string;
}> {
  if (countAllActive() >= MAX_CONCURRENT) {
    return { accepted: false, error: `Concurrency limit reached (${MAX_CONCURRENT} active runs)` };
  }

  if (countActiveByParent(params.parentConversationId) >= MAX_CHILDREN_PER_PARENT) {
    return { accepted: false, error: `Max children per session reached (${MAX_CHILDREN_PER_PARENT})` };
  }

  const depth = params.depth || 1;
  if (depth > MAX_SPAWN_DEPTH) {
    return { accepted: false, error: `Max spawn depth exceeded (${MAX_SPAWN_DEPTH})` };
  }

  const parentConv = await storage.getConversation(params.parentConversationId, params.tenantId ?? ADMIN_TENANT_ID);
  if (!parentConv) {
    return { accepted: false, error: "Parent conversation not found" };
  }

  const runId = uuid().slice(0, 8);
  const label = params.label || `subagent-${runId}`;
  const agentId = params.agentId ?? parentConv.personaId ?? null;

  let persona: any = null;
  if (agentId) {
    try { persona = await storage.getPersona(agentId); } catch (_silentErr) { logSilentCatch("server/subagents.ts", _silentErr); }
  }

  const MODEL_ALIASES: Record<string, string> = {
    "gpt-4o-mini": "gpt-5-mini",
    "gpt-4o": "gpt-5.4",
    "gpt-4": "gpt-4.1",
    "gpt-4-turbo": "gpt-4.1",
    "claude-3-opus": "claude-opus-4-5",
    "claude-3-sonnet": "claude-sonnet-4-5",
    "claude-3-haiku": "gpt-5-mini",
    "gemini-pro": "gemini-3-flash-preview",
    "gemini-1.5-pro": "gemini-3-flash-preview",
  };
  let model = params.model || "";
  if (model && MODEL_ALIASES[model]) {
    console.log(`[subagent] Model alias: "${model}" → "${MODEL_ALIASES[model]}"`);
    model = MODEL_ALIASES[model];
  }
  let thinkingLevel = params.thinkingLevel || "";

  if (!model || model === "auto") {
    const taskAnalysis = resolveSubagentTier(params.task, persona?.costTier);
    try {
      model = await getModelForTierAsync(taskAnalysis.tier);
    } catch {
      model = parentConv.model || "gemini-2.5-flash";
    }

    if (taskAnalysis.needsMultimodal && !isModelMultimodal(model)) {
      const multimodalFallbacks = MODEL_REGISTRY.filter(
        m => m.tier === taskAnalysis.tier && m.capabilities?.includes("vision")
      );
      if (multimodalFallbacks.length > 0) {
        model = multimodalFallbacks[0].id;
      } else {
        model = "gemini-3.5-flash";
      }
      console.log(`[subagent] Multimodal override: task needs vision → ${model}`);
    }

    if (!thinkingLevel || thinkingLevel === "off") {
      thinkingLevel = taskAnalysis.thinkingLevel;
    }
    console.log(`[subagent] Auto-selected: task="${params.task.slice(0, 50)}..." → tier=${taskAnalysis.tier}, model=${model}, thinking=${thinkingLevel}, multimodal=${taskAnalysis.needsMultimodal}`);
  }

  if (!model) model = parentConv.model || "gemini-2.5-flash";

  const childConv = await storage.createConversation({
    title: `[Subagent] ${label}: ${params.task.slice(0, 60)}`,
    model,
    personaId: agentId,
    tenantId: parentConv.tenantId,
  });

  const childSessionKey = `agent:${agentId || "main"}:subagent:${runId}`;

  const run: SubagentRun = {
    id: runId,
    tenantId: parentConv.tenantId,
    parentConversationId: params.parentConversationId,
    parentSessionKey: `conv:${params.parentConversationId}`,
    childConversationId: childConv.id,
    childSessionKey,
    agentId,
    label,
    task: params.task,
    model,
    thinkingLevel: thinkingLevel || params.thinkingLevel,
    status: "running",
    createdAt: Date.now(),
    depth,
    mode: params.mode || "run",
  };

  activeRuns.set(runId, run);

  const timeoutMs = (params.runTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;

  executeSubagentRun(run, timeoutMs).catch(err => {
    console.error(`[subagent] Run ${runId} crashed:`, err.message);
  });

  return {
    accepted: true,
    runId,
    childSessionKey,
  };
}

async function executeSubagentRun(run: SubagentRun, timeoutMs: number): Promise<void> {
  // R68.2 — open the step-ledger run HERE so the run lifetime matches the actual work,
  // and the tenant comes from the parent conversation (not a hardcoded default).
  const { withRun } = await import("./step-ledger");
  return withRun(
    {
      tenantId: run.tenantId,
      personaId: run.agentId ?? undefined,
      task: `subagent:${run.label}: ${(run.task || "").slice(0, 80)}`,
    },
    () => _executeSubagentRunImpl(run, timeoutMs),
  );
}

async function _executeSubagentRunImpl(run: SubagentRun, timeoutMs: number): Promise<void> {
  console.log(`[subagent] Starting run ${run.id} (label: ${run.label}, depth: ${run.depth}, tools: enabled)`);

  const taskPrompt = buildSubagentTaskPrompt(run);

  const blockedTools = new Set<string>();
  if (run.depth >= 2) {
    blockedTools.add("sessions_spawn");
    blockedTools.add("subagents");
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
    }
  });

  try {
    const resultPromise = processMessage(run.childConversationId, taskPrompt, {
      source: `subagent:${run.id}`,
      enableTools: true,
      blockedTools,
      depth: run.depth,
    });

    const result = timeoutMs > 0
      ? await Promise.race([resultPromise, timeoutPromise])
      : await resultPromise;

    if (timeoutHandle) clearTimeout(timeoutHandle);

    if (run.status === "cancelled") {
      console.log(`[subagent] Run ${run.id} was cancelled during execution`);
      return;
    }

    if (result === null) {
      run.status = "timeout";
      run.error = `Run timed out after ${Math.round(timeoutMs / 1000)}s`;
      run.finishedAt = Date.now();
      console.log(`[subagent] Run ${run.id} timed out`);
    } else {
      const chatResult = result as ChatEngineResult;
      run.status = "completed";
      run.result = chatResult.response;
      run.toolsUsed = chatResult.toolsUsed;
      run.verificationStatus = "pending";
      run.finishedAt = Date.now();
      const toolCount = chatResult.toolsUsed?.length || 0;
      console.log(`[subagent] Run ${run.id} completed (${toolCount} tool calls)`);
    }
  } catch (err: any) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (run.status === "cancelled") return;
    run.status = "failed";
    run.error = err.message;
    run.finishedAt = Date.now();
    console.error(`[subagent] Run ${run.id} failed:`, err.message);
  }

  // Independent completion check + bounded in-run coached retry. Runs BEFORE
  // cleanup so the judge sees the full (untruncated) evidence and a retry can
  // replace run.result before cleanup truncates it. Only for completed runs;
  // fully fail-open (never flips a completed run to failed).
  if (run.status === "completed" && completionEvalEnabled()) {
    try {
      await verifyAndMaybeRetry(run, timeoutMs);
    } catch (e) {
      logSilentCatch("server/subagents.ts", e);
    }
  }

  cleanupSubagentResources(run);

  if (run.mode === "run") {
    await announceResult(run);
    scheduleArchive(run);
  }
}

/** Extract resolvable-looking URLs from a result blob for deliverable evidence. */
function extractDeliverableLinks(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s)\]"'<>]+/g) || [];
  return Array.from(new Set(matches)).slice(0, 10);
}

/**
 * Grade a completed run's evidence against a goal contract derived from its task,
 * using a SEPARATE cheap judge (maker/checker split). On an "incomplete" verdict
 * with retry budget left, the run re-attempts in its own child conversation with
 * the unmet criteria as coaching, then re-grades. Fail-open throughout: any error
 * leaves run.completionVerdict unset (verificationStatus stays "pending" → the
 * parent verifies, exactly the prior behavior).
 */
async function verifyAndMaybeRetry(run: SubagentRun, timeoutMs: number): Promise<void> {
  const { buildGoalContract } = await import("./agentic/goal-contract");
  const { evaluateCompletion } = await import("./agentic/completion-evaluator");

  const maxRetries = selfRetryMax();
  let retries = 0;

  while (true) {
    if (run.status === "cancelled") return;

    // Build evidence from the run's tool trace + final result.
    const tools = run.toolsUsed || [];
    const steps = tools.map((t, i) => {
      const out = t.output;
      const hasError = !!out && typeof out === "object" && "error" in out;
      const outStr = typeof out === "string" ? out : (() => { try { return JSON.stringify(out); } catch { return String(out); } })();
      return {
        taskId: i + 1,
        description: t.name,
        persona: run.label,
        status: (hasError ? "failed" : "completed") as "failed" | "completed",
        resultSnippet: hasError ? undefined : outStr.slice(0, 600),
        error: hasError ? outStr.slice(0, 240) : undefined,
      };
    });
    if (steps.length === 0 && run.result) {
      steps.push({ taskId: 1, description: "produce answer", persona: run.label, status: "completed", resultSnippet: run.result.slice(0, 600), error: undefined });
    }

    const contract = await buildGoalContract(run.task, { stepCount: Math.max(1, steps.length), tenantId: run.tenantId });

    // Sol #3 — risk-gate the evaluator's degraded fail-open. If ANY tool this
    // run actually invoked is classified sensitive/destructive by the
    // destructive-tool policy, a degraded (judge-unavailable) evaluation must
    // come back "completed_unverified", never a clean "done". Best-effort:
    // classification failure falls back to false (prior fail-open behavior).
    let consequentialActions = false;
    try {
      const { getEffectiveToolRisk } = await import("./safety/destructive-tool-policy");
      consequentialActions = tools.some(t => getEffectiveToolRisk(t.name) !== "safe");
    } catch (e) {
      logSilentCatch("server/subagents.ts", e);
    }

    const verdict = await evaluateCompletion(
      contract,
      {
        steps,
        summarySnippet: (run.result || "").slice(0, 2000),
        deliverableLinks: extractDeliverableLinks(run.result || ""),
        elapsedMs: (run.finishedAt || Date.now()) - run.createdAt,
        workerModels: run.model ? [run.model] : undefined,
        consequentialActions,
      },
      { tenantId: run.tenantId },
    );

    run.completionVerdict = {
      verdict: verdict.verdict,
      unmetCriteria: verdict.unmetCriteria || [],
      reason: verdict.reason || "",
      evaluatorModel: verdict.evaluatorModel,
      degraded: verdict.evaluatorDegraded === true,
      retries,
    };

    // The LLM judge was unavailable (verdict fell open to budget-only). Don't
    // over-claim "verified" — leave it to the parent, and don't retry (retrying
    // can't fix an absent judge).
    if (verdict.evaluatorDegraded) {
      run.verificationStatus = "pending";
      return;
    }

    if (verdict.verdict === "done") {
      run.verificationStatus = "verified";
      return;
    }

    // incomplete or halt → not independently verified.
    run.verificationStatus = "rejected";

    // Only "incomplete" is worth retrying. "halt" means a budget/safety ceiling
    // was hit — retrying would just burn more budget, so we hand it to the parent.
    if (verdict.verdict !== "incomplete" || retries >= maxRetries) return;

    retries++;
    const retried = await runCoachedRetry(run, verdict.unmetCriteria || [], timeoutMs);
    if (!retried) return; // retry timed out/failed → keep prior result + verdict
    // loop: re-grade the improved attempt
  }
}

/**
 * One bounded coached retry in the run's existing child conversation. The child
 * keeps its history, so it sees its prior work plus the evaluator's unmet criteria
 * and finishes the gaps. Returns true if a fresh result was produced. Bounded by
 * the same timeout the original attempt used; fully fail-open.
 */
async function runCoachedRetry(run: SubagentRun, unmet: string[], timeoutMs: number): Promise<boolean> {
  try {
    const coaching = [
      `[Self-verification — your previous result was judged INCOMPLETE]`,
      `An INDEPENDENT evaluator graded your output against this task's definition of done and it did not pass.`,
      unmet.length
        ? `Unmet criteria you MUST now satisfy:\n${unmet.map((u, i) => `${i + 1}. ${u}`).join("\n")}`
        : `The verification method for the task was not satisfied by your output.`,
      ``,
      `Finish the job: address ONLY these gaps and produce the COMPLETE deliverable for the original task. Do not restate prior work — complete it. Re-issue your final SUBAGENT REPORT when done.`,
      ``,
      `## Original Task`,
      run.task,
    ].join("\n");

    const blockedTools = new Set<string>();
    if (run.depth >= 2) {
      blockedTools.add("sessions_spawn");
      blockedTools.add("subagents");
    }

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<null>((resolve) => {
      if (timeoutMs > 0) timeoutHandle = setTimeout(() => resolve(null), Math.max(30_000, timeoutMs));
    });
    const resultPromise = processMessage(run.childConversationId, coaching, {
      source: `subagent:${run.id}:retry`,
      enableTools: true,
      blockedTools,
      depth: run.depth,
    });
    const result = timeoutMs > 0 ? await Promise.race([resultPromise, timeoutPromise]) : await resultPromise;
    if (timeoutHandle) clearTimeout(timeoutHandle);

    if (run.status === "cancelled" || result === null) return false;

    const chatResult = result as ChatEngineResult;
    run.result = chatResult.response;
    run.toolsUsed = [...(run.toolsUsed || []), ...(chatResult.toolsUsed || [])];
    run.finishedAt = Date.now();
    console.log(`[subagent] Run ${run.id} performed a coached retry after INCOMPLETE verdict (${chatResult.toolsUsed?.length || 0} tools)`);
    return true;
  } catch (e) {
    logSilentCatch("server/subagents.ts", e);
    return false;
  }
}

function cleanupSubagentResources(run: SubagentRun): void {
  try {
    if (run.toolsUsed) {
      for (const tool of run.toolsUsed) {
        if (tool.output && typeof tool.output === "string" && tool.output.length > 2000) {
          tool.output = tool.output.slice(0, 2000) + "...(truncated after run)";
        }
      }
    }

    if (run.result && run.result.length > 10000) {
      run.result = run.result.slice(0, 10000) + "\n...(truncated — full result announced to parent)";
    }

    const durationMs = (run.finishedAt || Date.now()) - (run as any).startedAt;
    const toolCount = run.toolsUsed?.length || 0;

    console.log(`[subagent-cleanup] ${run.id}: status=${run.status}, tools=${toolCount}, duration=${Math.round(durationMs / 1000)}s, result=${(run.result?.length || 0)} chars`);
  } catch (err) {
    console.log(`[subagent-cleanup] Non-fatal cleanup error for ${run.id}: ${(err as Error).message}`);
  }
}

function buildSubagentTaskPrompt(run: SubagentRun): string {
  const parts: string[] = [];
  parts.push(`[Sub-agent task — run: ${run.id}, label: ${run.label}, depth: ${run.depth}, model: ${run.model || "auto"}, thinking: ${run.thinkingLevel || "off"}]`);
  parts.push("");
  parts.push(`## Role`);
  parts.push(`You are a specialized sub-agent spawned to perform a focused task autonomously.`);
  parts.push(`Your persona configuration (soul, identity, tools, agents docs) defines your expertise — follow it.`);
  parts.push(`You have FULL access to all tools. Use them proactively — do not guess when you can look up.`);
  parts.push("");
  parts.push(`## SUPERVISOR MANDATE — You MUST Follow This`);
  parts.push(`An overseer is monitoring your run. Violations will flag your output for rejection.`);
  parts.push(`1. **STAY ON TASK** — Your ONLY job is the task described below. Do not explore tangents, follow curiosity, or do extra work not directly requested.`);
  parts.push(`2. **TOOL BUDGET** — You have a strict limit of 15 total tool calls. Plan your tool usage upfront before calling anything. Ask yourself: "Is this tool call absolutely necessary to complete the task?"  If the answer is no, skip it.`);
  parts.push(`3. **NO REDUNDANT CALLS** — Never call the same tool twice with similar inputs. Never search the same thing with slightly different wording. One good query beats three mediocre ones.`);
  parts.push(`4. **MINIMUM VIABLE TOOLS** — Use the FEWEST tool calls to get the job done well. A 3-tool-call completion is better than a 10-tool-call completion with the same result.`);
  parts.push(`5. **STOP WHEN DONE** — The moment you have enough information to complete the task, STOP using tools and write your answer. Do not polish, double-check with extra searches, or seek marginal improvements.`);
  parts.push(`6. **NO SCOPE CREEP** — If you discover something interesting but outside your task, mention it in your report but do NOT pursue it. Only the parent agent decides follow-ups.`);
  parts.push(`7. **FAIL FAST** — If a tool call fails or a source is unhelpful, immediately try ONE alternative. If that also fails, report the gap and move on. Do not retry indefinitely.`);
  parts.push("");
  parts.push(`## Operating Protocol`);
  parts.push(`1. **Plan first** — before any tool call, decide which 2-5 tools you actually need for this specific task.`);
  parts.push(`2. **Check memory** — search_memory and search_knowledge first. Don't research what's already stored.`);
  parts.push(`3. **Execute precisely** — call only the tools you planned. Skip anything that doesn't directly serve the task.`);
  parts.push(`4. **Verify briefly** — one verification check is enough. Don't over-verify.`);
  parts.push(`5. **Report** — structured summary for the parent agent.`);
  parts.push("");
  parts.push(`## Smart Research Protocol`);
  parts.push(`When researching, follow this efficient strategy:`);
  parts.push(`1. **web_search first** — AI-summarized answers with citations. Often sufficient on its own.`);
  parts.push(`2. **English sources only** — skip foreign-language sites. Search for English docs/blogs/press releases instead.`);
  parts.push(`3. **Max 2 search attempts** — if the first query doesn't work, try ONE alternative angle. Then stop.`);
  parts.push(`4. **deep_research for complex topics** — use it instead of 5+ manual searches.`);
  parts.push(`5. **Browse only if essential** — only when web_search missed specific data. Use smart_browse (1 action).`);
  parts.push(`6. **Synthesize, don't dump** — combine findings into a clear answer. No raw search paste.`);
  parts.push("");
  parts.push(`## Guidelines`);
  parts.push(`- Do NOT ask for clarification — use tools and best judgment.`);
  parts.push(`- Use create_memory to persist important findings for future reference.`);
  parts.push(`- Produce actionable, production-ready output — not rough sketches.`);
  parts.push(`- Follow your agentsDoc delegation rules. Do not do work outside your domain.`);
  parts.push("");
  parts.push(`## Report Format`);
  parts.push(`End your response with:`);
  parts.push("```");
  parts.push(`SUBAGENT REPORT — ${run.label}`);
  parts.push(`Status: [completed/partial/failed]`);
  parts.push(`Tools Used: [count] — [names]`);
  parts.push(`Key Findings: [bullet points]`);
  parts.push(`Actions Taken: [what was done]`);
  parts.push(`Task Adherence: [stayed on task / deviated — explain]`);
  parts.push("```");
  parts.push("");
  parts.push(`## Task`);
  parts.push(run.task);
  return parts.join("\n");
}

async function announceResult(run: SubagentRun): Promise<void> {
  try {
    const runtimeSecs = run.finishedAt
      ? Math.round((run.finishedAt - run.createdAt) / 1000)
      : 0;

    const statusLabel = run.status === "completed" ? "completed successfully"
      : run.status === "timeout" ? "timed out"
      : run.status === "failed" ? `failed: ${run.error}`
      : run.status;

    const parts: string[] = [];
    parts.push(`<!-- provenance:subagent_announce -->`);
    parts.push(`[Sub-agent report — ${run.label} (${run.id})]`);
    parts.push(`Status: ${statusLabel}`);
    parts.push(`Runtime: ${formatDuration(runtimeSecs)}`);
    parts.push(`Session: ${run.childSessionKey}`);
    parts.push(`Depth: ${run.depth}`);

    if (run.toolsUsed && run.toolsUsed.length > 0) {
      parts.push(`Tools used: ${run.toolsUsed.length}`);
      const toolSummary = run.toolsUsed.map(t => {
        const hasError = t.output && typeof t.output === "object" && "error" in t.output;
        return `  - ${t.name}${hasError ? " ⚠ error" : " ✓"}`;
      });
      parts.push(toolSummary.join("\n"));
    }
    parts.push("");

    if (run.result) {
      const trimmed = run.result.length > 4000
        ? run.result.slice(0, 4000) + "\n...(truncated)"
        : run.result;
      parts.push(`Result:\n${trimmed}`);
    } else if (run.error) {
      parts.push(`Error: ${run.error}`);
    } else {
      parts.push("(no output)");
    }

    parts.push("");
    const toolCount = run.toolsUsed?.length || 0;
    const efficiency = toolCount <= 5 ? "EFFICIENT ✓" : toolCount <= 10 ? "ACCEPTABLE" : toolCount <= 15 ? "HIGH USAGE ⚠" : "OVER BUDGET ❌";
    parts.push(`Efficiency Rating: ${efficiency} (${toolCount} tool calls)`);
    parts.push("");

    // Independent completion check (maker/checker split). A separate judge already
    // graded this run's evidence against a goal contract — surface the typed verdict
    // so the parent gets a machine-readable signal, not just prose to re-judge.
    if (run.completionVerdict) {
      const v = run.completionVerdict;
      const label = v.verdict === "done" ? "DONE ✓"
        : v.verdict === "incomplete" ? "INCOMPLETE ❌"
        : v.verdict === "completed_unverified" ? "COMPLETED — UNVERIFIED ⚠ (consequential actions, judge unavailable)"
        : "HALTED (budget) ⛔";
      parts.push(`## Independent Completion Check`);
      parts.push(`Verdict: ${label}${v.degraded ? " — evaluator DEGRADED (not independently verified)" : ""}`);
      if (v.retries > 0) parts.push(`Coached retries performed: ${v.retries}`);
      if (v.evaluatorModel) parts.push(`Judge model: ${v.evaluatorModel}`);
      if (v.reason) parts.push(`Reason: ${v.reason}`);
      if (v.unmetCriteria.length) {
        parts.push(`Unmet criteria:`);
        v.unmetCriteria.forEach((u, i) => parts.push(`  ${i + 1}. ${u}`));
      }
      parts.push("");
    }

    parts.push(`## Verification Required`);
    parts.push(`This sub-agent has completed its task. As the main agent, you must:`);
    parts.push(`1. Review the sub-agent's report and tool usage above.`);
    parts.push(`2. Check efficiency rating — if OVER BUDGET or HIGH USAGE, note this as a concern.`);
    parts.push(`3. Verify the results are correct, complete, and ON TASK (no scope creep).`);
    parts.push(`4. If the sub-agent created memories or knowledge, spot-check them with search_memory/search_knowledge.`);
    parts.push(`5. Summarize the verified results to the user in your own voice.`);
    parts.push(`6. Flag any issues, tool waste, or incomplete items that need follow-up.`);
    parts.push("");
    parts.push(`(Present verified findings naturally. Do not forward raw metadata or sub-agent formatting to the user.)`);

    const announceContent = parts.join("\n");

    // R125+12+sec (architect MEDIUM closed 2026-05-24): use the subagent run's
    // own tenantId instead of hardcoded 1. Non-admin tenant runs were failing
    // tenant-consistency checks downstream because announceResult was writing
    // the parent message under the admin tenant.
    await storage.createMessage({
      conversationId: run.parentConversationId,
      role: "user",
      content: announceContent,
      tenantId: run.tenantId ?? 1,
    });

    console.log(`[subagent] Announced result for ${run.id} to parent conv ${run.parentConversationId} (${run.toolsUsed?.length || 0} tools used, verification: pending)`);
  } catch (err: any) {
    console.error(`[subagent] Failed to announce result for ${run.id}:`, err.message);
  }
}

function scheduleArchive(run: SubagentRun): void {
  setTimeout(() => {
    activeRuns.delete(run.id);
    console.log(`[subagent] Archived run ${run.id}`);
  }, ARCHIVE_AFTER_MINUTES * 60 * 1000);
}

export function killSubagent(id: string): { success: boolean; error?: string } {
  const run = activeRuns.get(id);
  if (!run) return { success: false, error: `Run ${id} not found` };
  if (run.status !== "running") return { success: false, error: `Run ${id} is not running (status: ${run.status})` };

  run.status = "cancelled";
  run.finishedAt = Date.now();
  run.error = "Cancelled by operator";

  return { success: true };
}

export function killAllSubagents(parentConversationId?: number): { killed: number } {
  let killed = 0;
  for (const [id, run] of activeRuns) {
    if (run.status !== "running") continue;
    if (parentConversationId !== undefined && run.parentConversationId !== parentConversationId) continue;
    run.status = "cancelled";
    run.finishedAt = Date.now();
    run.error = "Cancelled by operator (kill all)";
    killed++;
  }
  return { killed };
}

export function getSubagentInfo(id: string): any {
  const run = activeRuns.get(id);
  if (!run) return null;

  const runtimeSecs = run.finishedAt
    ? Math.round((run.finishedAt - run.createdAt) / 1000)
    : Math.round((Date.now() - run.createdAt) / 1000);

  return {
    id: run.id,
    label: run.label,
    task: run.task,
    status: run.status,
    depth: run.depth,
    mode: run.mode,
    model: run.model,
    agentId: run.agentId,
    parentConversationId: run.parentConversationId,
    childConversationId: run.childConversationId,
    childSessionKey: run.childSessionKey,
    runtime: formatDuration(runtimeSecs),
    createdAt: new Date(run.createdAt).toISOString(),
    finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
    result: run.result?.slice(0, 2000),
    error: run.error,
    toolsUsed: run.toolsUsed?.map(t => t.name) || [],
    toolCount: run.toolsUsed?.length || 0,
    verificationStatus: run.verificationStatus || null,
  };
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m < 60) return `${m}m${s > 0 ? s + "s" : ""}`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}
