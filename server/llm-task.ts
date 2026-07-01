import { getAvailableModels, LEGACY_MODEL_ALIASES } from "./providers";
import { logSilentCatch } from "./lib/silent-catch";
import { resilientChatCompletion, detectRefusal } from "./lib/resilient-llm";
import { getModelHarnessSuffix } from "./agentic/harness-injection";

interface LlmTaskInput {
  prompt: string;
  input?: any;
  schema?: Record<string, any>;
  model?: string;
  thinking?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  images?: string[];
  // R64.C — explicit cost-attribution tenant. Pass ADMIN_TENANT_ID for
  // system-wide background tasks; pass the actual tenant for per-tenant work.
  // Omitting it triggers a stack-traced warning in providers.ts.
  tenantId?: number;
  // Cost-exempt "flagship" lane: routes this task's Anthropic call past the
  // metered-Anthropic daily breaker (same exemption the jury has). ONLY for
  // bounded, owner-blessed high-value Opus uses — the once-weekly BWB recap.
  //
  // GUARD: keep the set of callers that pass costExempt:true tiny and grep-able
  // (currently only scripts/build-bwb-weekly.ts). Every new costExempt caller
  // widens the breaker bypass, so it must be a bounded, owner-blessed Opus use —
  // review it the same way you'd review a new TOOL_POLICIES exemption.
  costExempt?: boolean;
  // Require tool-calling support from the served client. Defaults to TRUE to
  // preserve every existing caller. Pass FALSE for pure structured-JSON tasks
  // (this runner already forces response_format:json_object, so most tasks do
  // NOT actually need tools) — that lets an Anthropic model route through the
  // flat-rate Claude Runner bridge (~$0) instead of a metered key. The recap
  // sets this so it PREFERS the runner and only spends metered $ on fallback.
  requiresTools?: boolean;
}

interface LlmTaskResult {
  success: boolean;
  json?: any;
  model?: string;
  validationErrors?: string[];
  error?: string;
  durationMs?: number;
  failedOver?: boolean;
  repaired?: boolean;
  refused?: boolean;
}

const THINKING_PRESETS: Record<string, string> = {
  off: "",
  low: "Think briefly before answering.",
  medium: "Think carefully and consider multiple angles before answering.",
  high: "Think deeply and exhaustively. Consider edge cases, alternatives, and implications before answering.",
};

// Bounded prompt-repair attempts (in addition to the first try). Each repair
// re-asks the model about FORMAT ONLY (invalid JSON / schema mismatch). It NEVER
// tries to override a content refusal — defeating a safety guard is a hard
// invariant of this platform. A model that refuses for safety stays refused;
// repair only nudges a model that tried-but-malformed its output.
const MAX_PROMPT_REPAIRS = 2;

export async function runLlmTask(input: LlmTaskInput): Promise<LlmTaskResult> {
  const start = Date.now();
  const timeout = input.timeoutMs || 30000;
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeout);

  try {
    const requestedId = input.model || "gemini-2.5-flash";
    const modelId = LEGACY_MODEL_ALIASES[requestedId] || requestedId;
    const available = await getAvailableModels();
    const modelExists = available.some(m => m.id === modelId);
    if (!modelExists) {
      return { success: false, error: `Model "${requestedId}" is not available. Available: ${available.slice(0, 5).map(m => m.id).join(", ")}` };
    }

    let systemContent = `You are a JSON-only assistant. Output ONLY valid JSON — no markdown fences, no commentary, no explanation.`;

    if (input.thinking && THINKING_PRESETS[input.thinking]) {
      systemContent += `\n\n${THINKING_PRESETS[input.thinking]}`;
    }

    if (input.schema) {
      systemContent += `\n\nYour output MUST conform to this JSON Schema:\n${JSON.stringify(input.schema, null, 2)}`;
    }

    // Per-model harness adaptation (Self-Harness, arXiv:2606.09498): append any
    // validated, model-specific addenda learned from THIS model's failure traces.
    // Cached + fail-open — adaptation must never block or break a task.
    try {
      const harnessSuffix = await getModelHarnessSuffix(modelId);
      if (harnessSuffix) systemContent += `\n\n${harnessSuffix}`;
    } catch (_silentErr) { logSilentCatch("server/llm-task.ts", _silentErr); }

    let userText = input.prompt;
    if (input.input !== undefined) {
      userText += `\n\nInput:\n${JSON.stringify(input.input, null, 2)}`;
    }

    let userContent: any = userText;
    if (input.images?.length) {
      const parts: any[] = [{ type: "text", text: userText }];
      for (const imgUrl of input.images) {
        parts.push({ type: "image_url", image_url: { url: imgUrl } });
      }
      userContent = parts;
    }

    const baseMessages: any[] = [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ];

    let repairNote: string | null = null;
    let failedOver = false;
    let repaired = false;
    let lastFailure: LlmTaskResult | null = null;
    // Models that produced UNUSABLE output (bad JSON / schema miss). Each repair
    // both re-asks about FORMAT *and* asks the resilient layer to pick a
    // DIFFERENT model — failover on unusable output, not just on route errors.
    const unusableModels = new Set<string>();

    // Param-adaptation + model-failover happen inside resilientChatCompletion;
    // this loop adds bounded prompt-repair on top, re-running the whole resilient
    // stack with a corrective note when the output is unusable.
    for (let repair = 0; repair <= MAX_PROMPT_REPAIRS; repair++) {
      if (abortController.signal.aborted) break;

      const messages = repairNote
        ? [...baseMessages, { role: "user", content: repairNote }]
        : baseMessages;
      const baseParams: any = {
        messages,
        max_completion_tokens: input.maxTokens || 16384,
        response_format: { type: "json_object" },
        temperature: input.temperature ?? 0.1,
      };

      const rc = await resilientChatCompletion({
        requestedModel: modelId,
        tenantId: input.tenantId,
        baseParams,
        signal: abortController.signal,
        requiresTools: input.requiresTools ?? true,
        costExemptLane: input.costExempt,
        label: "llm-task",
        excludeModels: unusableModels.size ? [...unusableModels] : undefined,
      });
      if (rc.failoverUsed) failedOver = true;
      const actualModelId = rc.usedModel;
      const durationMs = Date.now() - start;
      // Structured observability: one record per attempt carrying the resilient
      // trace (every param-strip + failover step) plus whether this attempt was
      // itself a prompt-repair re-ask.
      console.log(JSON.stringify({
        evt: "llm_task_attempt", scope: "llm-task", attempt: repair + 1,
        requested: modelId, used: actualModelId, failoverUsed: rc.failoverUsed,
        promptRepair: repair > 0, steps: rc.steps,
      }));

      // HARD INVARIANT: a safety refusal stays refused. If the model declined
      // for safety, return immediately — never run the format-repair loop, which
      // would amount to re-asking past the refusal.
      const refusal = detectRefusal(rc.response);
      if (refusal) {
        return {
          success: false,
          error: `Model refused the request: ${refusal}`,
          model: actualModelId,
          durationMs,
          refused: true,
          failedOver: failedOver || undefined,
        };
      }

      const raw = rc.response.choices?.[0]?.message?.content?.trim() || "";

      let parsed: any;
      try {
        let jsonStr = raw;
        const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (fenceMatch) jsonStr = fenceMatch[1].trim();
        parsed = JSON.parse(jsonStr);
      } catch {
        lastFailure = {
          success: false,
          error: `Model returned invalid JSON: ${raw.slice(0, 200)}`,
          model: actualModelId,
          durationMs,
          failedOver: failedOver || undefined,
          repaired: repaired || undefined,
        };
        unusableModels.add(actualModelId);
        if (repair < MAX_PROMPT_REPAIRS) {
          failedOver = true;
          console.log(JSON.stringify({ evt: "llm_failover", scope: "llm-task", phase: "output", from: actualModelId, reason: "invalid_json", attempt: repair + 1 }));
        }
        repairNote = `Your previous response was not valid JSON. Output ONLY a single valid JSON object — no markdown fences, no prose, no explanation.${input.schema ? " It MUST conform to the JSON Schema given in the system message." : ""}`;
        repaired = true;
        continue;
      }

      if (input.schema) {
        const errors = validateAgainstSchema(parsed, input.schema);
        if (errors.length > 0) {
          lastFailure = {
            success: false,
            json: parsed,
            model: actualModelId,
            validationErrors: errors,
            error: `schema validation failed: ${errors.slice(0, 3).join("; ")}`,
            durationMs,
            failedOver: failedOver || undefined,
            repaired: repaired || undefined,
          };
          unusableModels.add(actualModelId);
          if (repair < MAX_PROMPT_REPAIRS) {
            failedOver = true;
            console.log(JSON.stringify({ evt: "llm_failover", scope: "llm-task", phase: "output", from: actualModelId, reason: "schema_mismatch", attempt: repair + 1 }));
          }
          repairNote = `Your previous JSON did not match the required schema. Return ONLY corrected JSON fixing these problems: ${errors.slice(0, 5).join("; ")}`;
          repaired = true;
          continue;
        }
      }

      return {
        success: true,
        json: parsed,
        model: actualModelId,
        durationMs,
        failedOver: failedOver || undefined,
        repaired: repaired || undefined,
      };
    }

    return (
      lastFailure ?? {
        success: false,
        error: "LLM task produced no usable output after repair attempts",
        durationMs: Date.now() - start,
      }
    );
  } catch (err: any) {
    return {
      success: false,
      error: sanitizeLlmError(err),
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// R98.26.4 — Strip provider URLs, API keys, IPs, and absolute file paths from
// LLM error messages before they escape this module. Inbound `err.message`
// commonly contains things like:
//   "Connect Timeout Error (attempted addresses: 142.250.190.74:443, ...)"
//   "401 Unauthorized https://api.openai.com/v1/chat/completions"
//   "Bearer sk-proj-AbCd1234..."
// All of which leak architecture / credentials to whoever sees the surfaced
// error (UI, logs aggregated to chat, golden-path replay reports, etc.).
function sanitizeLlmError(err: any): string {
  // Surface common nested-error shapes too — provider SDKs often pack the
  // useful diagnostic into err.error.message or err.response.data.
  const raw = (
    err?.message ||
    err?.error?.message ||
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.error?.details ||
    err?.toString?.() ||
    "LLM task failed"
  ).toString();
  return raw
    // Strip URLs WITH scheme.
    .replace(/https?:\/\/[^\s)"']+/g, "<url>")
    // Strip scheme-less host paths like "api.openai.com/v1/chat/completions".
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)"']*)?/gi, (m: string) => {
      // Don't redact bare "wellness-program" or product names — only host-shaped tokens
      // (must contain at least one dot AND a TLD-ish segment AND either look
      // like a known provider host or carry a path).
      return /\//.test(m) || /(api|openai|anthropic|google|firecrawl|elevenlabs|stripe|drive|googleapis|x\.ai|deepseek|openrouter|replit|grok|gemini|claude)/i.test(m)
        ? "<host>"
        : m;
    })
    // Strip API-key-shaped tokens — broader coverage (OpenAI, Anthropic,
    // GitHub PAT classic+fine-grained, Slack xox*, Google AIza, AWS AKIA,
    // Stripe sk_/rk_ live+test, generic Bearer).
    .replace(/\b(sk-[a-zA-Z0-9_-]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|whsec_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16}|sk_(?:live|test)_[A-Za-z0-9]{20,}|rk_(?:live|test)_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/g, "<redacted-key>")
    // IPv4 + optional port.
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/g, "<ip>")
    // IPv6 (loose: 2+ colon-separated hex groups).
    .replace(/\b(?:[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}\b/gi, "<ip>")
    // Absolute filesystem paths — Linux home, /var, /workspace, /Users (macOS), Windows.
    .replace(/(\/(?:home|Users|var|workspace|tmp|opt|etc)\/[^\s)"']+)/g, "<path>")
    .replace(/\b[A-Z]:\\[^\s)"']+/g, "<path>")
    // Length-cap so a multi-KB stack doesn't get echoed to chat.
    .slice(0, 500);
}

// R98.25 — text-mode sibling of runLlmTask. Original is hard-coded to JSON
// (response_format: json_object) and returns {json}. Callers like build_html_app
// need RAW HTML output and were silently failing — runLlmTask returned a JSON
// object, build_html_app read .output/.text (always undefined), reported
// "LLM returned empty output". This text-mode helper has no JSON system prompt,
// no response_format constraint, and returns {success, text, model}.
interface LlmTextTaskInput {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  tenantId?: number;
}
interface LlmTextTaskResult {
  success: boolean;
  text?: string;
  model?: string;
  error?: string;
  durationMs?: number;
  failedOver?: boolean;
  repaired?: boolean;
  refused?: boolean;
}
export async function runLlmTextTask(input: LlmTextTaskInput): Promise<LlmTextTaskResult> {
  const start = Date.now();
  const timeout = input.timeoutMs || 30000;
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeout);
  try {
    const requestedId = input.model || "gemini-2.5-flash";
    const modelId = LEGACY_MODEL_ALIASES[requestedId] || requestedId;
    const available = await getAvailableModels();
    const modelExists = available.some(m => m.id === modelId);
    if (!modelExists) {
      return { success: false, error: `Model "${requestedId}" is not available. Available: ${available.slice(0, 5).map(m => m.id).join(", ")}` };
    }

    const baseMessages: any[] = [
      ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
      { role: "user", content: input.prompt },
    ];

    // One empty-output repair on top of the resilient stack. Like runLlmTask,
    // the repair only re-asks for output — it never overrides a content refusal.
    let repairNote: string | null = null;
    let failedOver = false;
    let repaired = false;
    const TEXT_MAX_REPAIRS = 1;
    // Models that returned EMPTY output — excluded on the repair so the empty
    // re-ask lands on a DIFFERENT model (failover on unusable output).
    const unusableModels = new Set<string>();
    for (let repair = 0; repair <= TEXT_MAX_REPAIRS; repair++) {
      if (abortController.signal.aborted) break;
      const messages = repairNote
        ? [...baseMessages, { role: "user", content: repairNote }]
        : baseMessages;
      const baseParams: any = {
        messages,
        max_completion_tokens: input.maxTokens || 16384,
        temperature: input.temperature ?? 0.4,
      };
      const rc = await resilientChatCompletion({
        requestedModel: modelId,
        tenantId: input.tenantId,
        baseParams,
        signal: abortController.signal,
        requiresTools: true,
        label: "llm-text-task",
        excludeModels: unusableModels.size ? [...unusableModels] : undefined,
      });
      if (rc.failoverUsed) failedOver = true;
      console.log(JSON.stringify({
        evt: "llm_task_attempt", scope: "llm-text-task", attempt: repair + 1,
        requested: modelId, used: rc.usedModel, failoverUsed: rc.failoverUsed,
        promptRepair: repair > 0, steps: rc.steps,
      }));

      // HARD INVARIANT: a safety refusal stays refused — never re-ask past it.
      const refusal = detectRefusal(rc.response);
      if (refusal) {
        return {
          success: false,
          error: `Model refused the request: ${refusal}`,
          model: rc.usedModel,
          durationMs: Date.now() - start,
          refused: true,
          failedOver: failedOver || undefined,
        };
      }

      const text = rc.response.choices?.[0]?.message?.content?.toString() ?? "";
      if (!text.trim()) {
        unusableModels.add(rc.usedModel);
        if (repair < TEXT_MAX_REPAIRS) {
          failedOver = true;
          console.log(JSON.stringify({ evt: "llm_failover", scope: "llm-text-task", phase: "output", from: rc.usedModel, reason: "empty_output", attempt: repair + 1 }));
        }
        repairNote = "Your previous response was empty. Produce the requested output now.";
        repaired = true;
        continue;
      }
      return {
        success: true,
        text,
        model: rc.usedModel,
        durationMs: Date.now() - start,
        failedOver: failedOver || undefined,
        repaired: repaired || undefined,
      };
    }
    return { success: false, error: "Model returned empty output after repair", durationMs: Date.now() - start, failedOver: failedOver || undefined };
  } catch (err: any) {
    return { success: false, error: sanitizeLlmError(err), durationMs: Date.now() - start };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function validateAgainstSchema(data: any, schema: Record<string, any>): string[] {
  const errors: string[] = [];

  if (schema.type === "object" && typeof data !== "object") {
    errors.push(`Expected object, got ${typeof data}`);
    return errors;
  }

  if (schema.type === "array" && !Array.isArray(data)) {
    errors.push(`Expected array, got ${typeof data}`);
    return errors;
  }

  if (schema.required && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (data[field] === undefined) {
        errors.push(`Missing required field: "${field}"`);
      }
    }
  }

  if (schema.properties && typeof data === "object" && data !== null) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (data[key] !== undefined && (propSchema as any).type) {
        const expected = (propSchema as any).type;
        const actual = Array.isArray(data[key]) ? "array" : typeof data[key];
        if (expected !== actual && !(expected === "integer" && typeof data[key] === "number")) {
          errors.push(`Field "${key}": expected ${expected}, got ${actual}`);
        }
      }
    }

    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) {
          errors.push(`Unexpected field: "${key}"`);
        }
      }
    }
  }

  return errors;
}
