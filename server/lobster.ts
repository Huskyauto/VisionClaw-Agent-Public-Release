import fs from "fs";
import path from "path";
import { logSilentCatch } from "./lib/silent-catch";
// @ts-ignore - uuid types not bundled
import { v4 as uuid } from "uuid";
import { executeTool } from "./tools";
import { executeCommand } from "./exec-tool";
import { ADMIN_TENANT_ID } from "./auth";
import yaml from "js-yaml";

const STATE_DIR = path.join(process.cwd(), "data", "lobster-state");
const WORKFLOWS_DIR = path.join(process.cwd(), "data", "lobster-workflows");

export interface LobsterStep {
  id: string;
  command?: string;
  tool?: string;
  toolArgs?: Record<string, any>;
  stdin?: string;
  approval?: "required" | "optional";
  condition?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface LobsterWorkflow {
  name: string;
  args?: Record<string, { default?: string; required?: boolean; description?: string }>;
  steps: LobsterStep[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface StepResult {
  id: string;
  status: "ok" | "skipped" | "failed" | "approval_pending";
  stdout?: string;
  json?: any;
  error?: string;
  approved?: boolean;
  durationMs?: number;
}

export interface LobsterEnvelope {
  ok: boolean;
  status: "ok" | "needs_approval" | "cancelled" | "failed";
  output: StepResult[];
  requiresApproval?: {
    type: "approval_request";
    prompt: string;
    items: any[];
    resumeToken: string;
    stepId: string;
  };
  error?: string;
  pipelineName?: string;
  totalDurationMs?: number;
}

interface PausedState {
  workflow: LobsterWorkflow;
  completedSteps: StepResult[];
  pendingStepIndex: number;
  resolvedArgs: Record<string, string>;
  createdAt: number;
  approvalPrompt: string;
  approvalItems: any[];
  approvalStdinData?: string;
}

function ensureDirs() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  if (!fs.existsSync(WORKFLOWS_DIR)) fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
}

const TOKEN_RE = /^[a-f0-9]{8,16}$/;

function validateToken(token: string): boolean {
  return TOKEN_RE.test(token);
}

function safePath(dir: string, name: string, ext: string): string | null {
  const safeName = path.basename(name).replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safeName || safeName.startsWith(".")) return null;
  const full = path.join(dir, `${safeName}${ext}`);
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(dir))) return null;
  return resolved;
}

function savePausedState(token: string, state: PausedState): void {
  ensureDirs();
  if (!validateToken(token)) throw new Error("Invalid token format");
  const fp = safePath(STATE_DIR, token, ".json");
  if (!fp) throw new Error("Invalid token");
  fs.writeFileSync(fp, JSON.stringify(state, null, 2));
}

function loadPausedState(token: string): PausedState | null {
  if (!validateToken(token)) return null;
  const fp = safePath(STATE_DIR, token, ".json");
  if (!fp || !fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return null;
  }
}

function deletePausedState(token: string): void {
  if (!validateToken(token)) return;
  const fp = safePath(STATE_DIR, token, ".json");
  if (!fp) return;
  try { fs.unlinkSync(fp); } catch (_silentErr) { logSilentCatch("server/lobster.ts", _silentErr); }
}

function parseWorkflowFile(filePath: string): LobsterWorkflow {
  const safeName = path.basename(filePath).replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safeName) throw new Error("Invalid workflow file name");

  let resolvedPath = path.join(WORKFLOWS_DIR, safeName);
  if (!resolvedPath.endsWith(".lobster")) {
    resolvedPath += ".lobster";
  }

  const realResolved = path.resolve(resolvedPath);
  if (!realResolved.startsWith(path.resolve(WORKFLOWS_DIR))) {
    throw new Error("Workflow path traversal blocked");
  }

  if (!fs.existsSync(realResolved)) {
    throw new Error(`Workflow file not found: ${safeName}`);
  }

  const raw = fs.readFileSync(realResolved, "utf-8");
  let parsed: any;

  try {
    parsed = yaml.load(raw);
  } catch {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Could not parse workflow file as YAML or JSON: ${safeName}`);
    }
  }

  if (!parsed || !Array.isArray(parsed.steps)) {
    throw new Error("Workflow file must have a 'steps' array");
  }

  return {
    name: parsed.name || path.basename(resolvedPath, ".lobster"),
    args: parsed.args,
    steps: parsed.steps.map((s: any, i: number) => ({
      id: s.id || `step-${i}`,
      command: s.command,
      tool: s.tool,
      toolArgs: s.toolArgs || s.args_json,
      stdin: s.stdin,
      approval: s.approval,
      condition: s.condition || s.when,
      env: s.env,
      timeoutMs: s.timeoutMs || s.timeout,
    })),
    env: parsed.env,
    timeoutMs: parsed.timeoutMs,
  };
}

function parsePipeline(pipelineStr: string): LobsterWorkflow {
  const segments: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < pipelineStr.length; i++) {
    const ch = pipelineStr[i];
    if (ch === "'" && !inDoubleQuote) { inSingleQuote = !inSingleQuote; current += ch; continue; }
    if (ch === '"' && !inSingleQuote) { inDoubleQuote = !inDoubleQuote; current += ch; continue; }
    if (ch === "|" && !inSingleQuote && !inDoubleQuote) {
      segments.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) segments.push(current.trim());

  const steps: LobsterStep[] = segments.map((seg, i) => {
    const trimmed = seg.trim();

    if (trimmed.startsWith("approve")) {
      return {
        id: `step-${i}`,
        command: trimmed,
        approval: "required" as const,
      };
    }

    const toolMatch = trimmed.match(/^openclaw\.invoke\s+--tool\s+(\S+)/);
    if (toolMatch) {
      const argsJsonMatch = trimmed.match(/--args-json\s+'({[\s\S]*?})'/);
      let toolArgs: any = {};
      if (argsJsonMatch) {
        try { toolArgs = JSON.parse(argsJsonMatch[1]); } catch (_silentErr) { logSilentCatch("server/lobster.ts", _silentErr); }
      }
      return {
        id: `step-${i}`,
        tool: toolMatch[1],
        toolArgs,
        stdin: i > 0 ? `$step-${i - 1}.stdout` : undefined,
      };
    }

    return {
      id: `step-${i}`,
      command: trimmed,
      stdin: i > 0 ? `$step-${i - 1}.stdout` : undefined,
    };
  });

  return { name: "inline-pipeline", steps };
}

function resolveStdinRef(ref: string, completedSteps: StepResult[]): string | undefined {
  const match = ref.match(/^\$(\S+)\.(stdout|json)$/);
  if (!match) return ref;

  const stepId = match[1];
  const field = match[2];

  const step = completedSteps.find(s => s.id === stepId);
  if (!step) return undefined;

  if (field === "json" && step.json !== undefined) {
    return typeof step.json === "string" ? step.json : JSON.stringify(step.json);
  }
  return step.stdout;
}

function evaluateCondition(condition: string, completedSteps: StepResult[]): boolean {
  const approvedMatch = condition.match(/^\$(\S+)\.approved$/);
  if (approvedMatch) {
    const step = completedSteps.find(s => s.id === approvedMatch[1]);
    return step?.approved === true;
  }

  const statusMatch = condition.match(/^\$(\S+)\.status\s*===?\s*['"](\w+)['"]/);
  if (statusMatch) {
    const step = completedSteps.find(s => s.id === statusMatch[1]);
    return step?.status === statusMatch[2];
  }

  return true;
}

async function executeStep(
  step: LobsterStep,
  completedSteps: StepResult[],
  resolvedArgs: Record<string, string>,
  globalEnv: Record<string, string>,
  defaultTimeoutMs: number,
  maxStdoutBytes: number,
): Promise<StepResult> {
  const start = Date.now();

  if (step.condition) {
    if (!evaluateCondition(step.condition, completedSteps)) {
      return { id: step.id, status: "skipped", durationMs: Date.now() - start };
    }
  }

  let stdinData: string | undefined;
  if (step.stdin) {
    stdinData = resolveStdinRef(step.stdin, completedSteps);
  }

  if (step.tool) {
    try {
      const args = { ...step.toolArgs };
      if (stdinData) {
        try {
          const parsed = JSON.parse(stdinData);
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            Object.assign(args, parsed);
          } else {
            args._stdinData = parsed;
          }
        } catch {
          args._stdinRaw = stdinData;
        }
      }

      // R74.13c — lobster is an internal admin orchestration runtime; explicitly
      // inject ADMIN_TENANT_ID so tenant-scoped tools (update_memory, search_memory,
      // create_knowledge, list_conversations, etc.) get a real tenant context
      // instead of silently inheriting one via the prior =1 default footgun.
      // Workflow authors can override by passing _tenantId explicitly in toolArgs.
      if (args._tenantId === undefined) args._tenantId = ADMIN_TENANT_ID;

      const result = await executeTool(step.tool, args);

      if (result && typeof result === "object" && "error" in result && !("success" in result)) {
        return {
          id: step.id,
          status: "failed",
          error: String(result.error),
          stdout: JSON.stringify(result),
          durationMs: Date.now() - start,
        };
      }

      const stdout = JSON.stringify(result);
      return {
        id: step.id,
        status: "ok",
        stdout: stdout.slice(0, maxStdoutBytes),
        json: result,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        id: step.id,
        status: "failed",
        error: err.message,
        durationMs: Date.now() - start,
      };
    }
  }

  if (step.command) {
    if (step.approval === "required") {
      let preview: any[] = [];
      if (stdinData) {
        try {
          const parsed = JSON.parse(stdinData);
          preview = Array.isArray(parsed) ? parsed.slice(0, 10) : [parsed];
        } catch {
          preview = [{ text: stdinData.slice(0, 500) }];
        }
      }

      const promptMatch = step.command.match(/--prompt\s+['"]([^'"]+)['"]/);
      const prompt = promptMatch ? promptMatch[1] : "Approve this step?";

      return {
        id: step.id,
        status: "approval_pending",
        stdout: stdinData,
        json: preview,
        durationMs: Date.now() - start,
      };
    }

    try {
      const execResult = await executeCommand(step.command);

      if (execResult.error) {
        return {
          id: step.id,
          status: "failed",
          error: execResult.error,
          stdout: execResult.stdout,
          durationMs: Date.now() - start,
        };
      }

      let json: any;
      try { json = JSON.parse(execResult.stdout || ""); } catch (_silentErr) { logSilentCatch("server/lobster.ts", _silentErr); }

      return {
        id: step.id,
        status: "ok",
        stdout: (execResult.stdout || "").slice(0, maxStdoutBytes),
        json,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        id: step.id,
        status: "failed",
        error: err.message?.slice(0, 2000),
        durationMs: Date.now() - start,
      };
    }
  }

  return { id: step.id, status: "failed", error: "Step has no command or tool", durationMs: 0 };
}

export async function runLobster(params: {
  action: "run" | "resume" | "list" | "get";
  pipeline?: string;
  token?: string;
  approve?: boolean;
  argsJson?: string;
  cwd?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  workflowId?: string;
}): Promise<LobsterEnvelope> {
  const startTime = Date.now();

  if (params.action === "list") {
    return listWorkflows();
  }

  if (params.action === "get") {
    if (!params.workflowId) {
      return { ok: false, status: "failed", output: [], error: "workflowId required for get action" };
    }
    return getWorkflowDetails(params.workflowId);
  }

  if (params.action === "resume") {
    if (!params.token) {
      return { ok: false, status: "failed", output: [], error: "Resume token required" };
    }
    return resumeWorkflow(params.token, params.approve ?? true, startTime);
  }

  if (!params.pipeline) {
    return { ok: false, status: "failed", output: [], error: "Pipeline required for run action" };
  }

  let workflow: LobsterWorkflow;
  const pipelineName = params.pipeline.replace(/\.lobster$/, "");
  const isFile = /^[a-zA-Z0-9_-]+$/.test(pipelineName) && (
    fs.existsSync(path.join(WORKFLOWS_DIR, pipelineName + ".lobster")) ||
    fs.existsSync(path.join(WORKFLOWS_DIR, params.pipeline))
  );

  if (isFile) {
    try {
      workflow = parseWorkflowFile(params.pipeline);
    } catch (err: any) {
      return { ok: false, status: "failed", output: [], error: err.message };
    }
  } else {
    workflow = parsePipeline(params.pipeline);
  }

  let resolvedArgs: Record<string, string> = {};
  if (params.argsJson) {
    try {
      resolvedArgs = JSON.parse(params.argsJson);
    } catch {
      return { ok: false, status: "failed", output: [], error: "Invalid argsJson" };
    }
  }

  if (workflow.args) {
    for (const [key, spec] of Object.entries(workflow.args)) {
      if (resolvedArgs[key] === undefined && spec.default !== undefined) {
        resolvedArgs[key] = spec.default;
      }
      if (spec.required && resolvedArgs[key] === undefined) {
        return { ok: false, status: "failed", output: [], error: `Missing required arg: ${key}` };
      }
    }
  }

  const defaultTimeout = params.timeoutMs || workflow.timeoutMs || 20000;
  const maxStdoutBytes = params.maxStdoutBytes || 512000;
  const globalEnv = workflow.env || {};
  const completedSteps: StepResult[] = [];

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const result = await executeStep(step, completedSteps, resolvedArgs, globalEnv, defaultTimeout, maxStdoutBytes);

    if (result.status === "approval_pending") {
      const tokenId = uuid().replace(/-/g, "").slice(0, 12);
      const promptMatch = step.command?.match(/--prompt\s+['"]([^'"]+)['"]/);
      const prompt = promptMatch ? promptMatch[1] : "Approve this step?";

      const pausedState: PausedState = {
        workflow,
        completedSteps: [...completedSteps],
        pendingStepIndex: i,
        resolvedArgs,
        createdAt: Date.now(),
        approvalPrompt: prompt,
        approvalItems: result.json || [],
        approvalStdinData: result.stdout,
      };

      savePausedState(tokenId, pausedState);

      return {
        ok: true,
        status: "needs_approval",
        output: completedSteps,
        pipelineName: workflow.name,
        totalDurationMs: Date.now() - startTime,
        requiresApproval: {
          type: "approval_request",
          prompt,
          items: (result.json || []).slice(0, 10),
          resumeToken: tokenId,
          stepId: step.id,
        },
      };
    }

    completedSteps.push(result);

    if (result.status === "failed") {
      return {
        ok: false,
        status: "failed",
        output: completedSteps,
        error: `Step "${step.id}" failed: ${result.error}`,
        pipelineName: workflow.name,
        totalDurationMs: Date.now() - startTime,
      };
    }
  }

  return {
    ok: true,
    status: "ok",
    output: completedSteps,
    pipelineName: workflow.name,
    totalDurationMs: Date.now() - startTime,
  };
}

async function resumeWorkflow(
  token: string,
  approved: boolean,
  startTime: number,
): Promise<LobsterEnvelope> {
  const state = loadPausedState(token);
  if (!state) {
    return { ok: false, status: "failed", output: [], error: `Resume token not found or expired: ${token}` };
  }

  deletePausedState(token);

  if (!approved) {
    return {
      ok: true,
      status: "cancelled",
      output: state.completedSteps,
      pipelineName: state.workflow.name,
      totalDurationMs: Date.now() - startTime,
    };
  }

  const approvalStep = state.workflow.steps[state.pendingStepIndex];

  if (approvalStep.command && approvalStep.approval === "required") {
    const cleanCommand = approvalStep.command.replace(/\bapprove\b/, "").replace(/--prompt\s+['"][^'"]*['"]/g, "").replace(/--preview-from-stdin/g, "").replace(/--limit\s+\d+/g, "").trim();

    if (cleanCommand) {
      const cmdResult = await executeCommand(cleanCommand);
      state.completedSteps.push({
        id: approvalStep.id,
        status: cmdResult.error ? "failed" : "ok",
        approved: true,
        stdout: cmdResult.stdout,
        error: cmdResult.error,
        durationMs: 0,
      });
    } else {
      state.completedSteps.push({
        id: approvalStep.id,
        status: "ok",
        approved: true,
        stdout: state.approvalStdinData || JSON.stringify({ approved: true }),
        durationMs: 0,
      });
    }
  } else {
    state.completedSteps.push({
      id: approvalStep.id,
      status: "ok",
      approved: true,
      stdout: JSON.stringify({ approved: true }),
      durationMs: 0,
    });
  }

  const defaultTimeout = state.workflow.timeoutMs || 20000;
  const maxStdoutBytes = 512000;
  const globalEnv = state.workflow.env || {};

  for (let i = state.pendingStepIndex + 1; i < state.workflow.steps.length; i++) {
    const step = state.workflow.steps[i];
    const result = await executeStep(step, state.completedSteps, state.resolvedArgs, globalEnv, defaultTimeout, maxStdoutBytes);

    if (result.status === "approval_pending") {
      const newToken = uuid().replace(/-/g, "").slice(0, 12);
      const promptMatch = step.command?.match(/--prompt\s+['"]([^'"]+)['"]/);
      const prompt = promptMatch ? promptMatch[1] : "Approve this step?";

      const newState: PausedState = {
        workflow: state.workflow,
        completedSteps: [...state.completedSteps],
        pendingStepIndex: i,
        resolvedArgs: state.resolvedArgs,
        createdAt: Date.now(),
        approvalPrompt: prompt,
        approvalItems: result.json || [],
        approvalStdinData: result.stdout,
      };
      savePausedState(newToken, newState);

      return {
        ok: true,
        status: "needs_approval",
        output: state.completedSteps,
        pipelineName: state.workflow.name,
        totalDurationMs: Date.now() - startTime,
        requiresApproval: {
          type: "approval_request",
          prompt,
          items: (result.json || []).slice(0, 10),
          resumeToken: newToken,
          stepId: step.id,
        },
      };
    }

    state.completedSteps.push(result);

    if (result.status === "failed") {
      return {
        ok: false,
        status: "failed",
        output: state.completedSteps,
        error: `Step "${step.id}" failed: ${result.error}`,
        pipelineName: state.workflow.name,
        totalDurationMs: Date.now() - startTime,
      };
    }
  }

  return {
    ok: true,
    status: "ok",
    output: state.completedSteps,
    pipelineName: state.workflow.name,
    totalDurationMs: Date.now() - startTime,
  };
}

function listWorkflows(): LobsterEnvelope {
  ensureDirs();
  const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith(".lobster"));

  const workflows = files.map(f => {
    try {
      const wf = parseWorkflowFile(f);
      return {
        name: wf.name,
        file: f,
        stepCount: wf.steps.length,
        hasApprovals: wf.steps.some(s => s.approval === "required"),
        args: wf.args ? Object.keys(wf.args) : [],
      };
    } catch {
      return { name: f, file: f, stepCount: 0, hasApprovals: false, args: [], error: "parse error" };
    }
  });

  const stateFiles = fs.existsSync(STATE_DIR)
    ? fs.readdirSync(STATE_DIR).filter(f => f.endsWith(".json")).length
    : 0;

  return {
    ok: true,
    status: "ok",
    output: [{
      id: "list",
      status: "ok",
      json: { workflows, pendingApprovals: stateFiles },
      stdout: JSON.stringify({ workflows, pendingApprovals: stateFiles }),
    }],
  };
}

function getWorkflowDetails(workflowId: string): LobsterEnvelope {
  try {
    const wf = parseWorkflowFile(workflowId);
    return {
      ok: true,
      status: "ok",
      output: [{
        id: "get",
        status: "ok",
        json: wf,
        stdout: JSON.stringify(wf),
      }],
    };
  } catch (err: any) {
    return { ok: false, status: "failed", output: [], error: err.message };
  }
}

export function saveWorkflow(name: string, content: string): { ok: boolean; path: string; error?: string } {
  ensureDirs();
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeName) return { ok: false, path: "", error: "Invalid workflow name" };

  const filePath = path.join(WORKFLOWS_DIR, `${safeName}.lobster`);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(WORKFLOWS_DIR))) {
    return { ok: false, path: "", error: "Path traversal blocked" };
  }

  try {
    yaml.load(content);
  } catch {
    try {
      JSON.parse(content);
    } catch {
      return { ok: false, path: filePath, error: "Content must be valid YAML or JSON" };
    }
  }

  fs.writeFileSync(resolved, content);
  return { ok: true, path: resolved };
}

export function deleteWorkflow(name: string): { ok: boolean; error?: string } {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeName) return { ok: false, error: "Invalid workflow name" };

  const filePath = path.join(WORKFLOWS_DIR, `${safeName}.lobster`);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(WORKFLOWS_DIR))) {
    return { ok: false, error: "Path traversal blocked" };
  }

  if (!fs.existsSync(resolved)) {
    return { ok: false, error: `Workflow not found: ${safeName}` };
  }

  fs.unlinkSync(resolved);
  return { ok: true };
}
