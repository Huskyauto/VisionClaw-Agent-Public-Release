import { getClientForModel, getAvailableModels, LEGACY_MODEL_ALIASES } from "./providers";

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
}

interface LlmTaskResult {
  success: boolean;
  json?: any;
  model?: string;
  validationErrors?: string[];
  error?: string;
  durationMs?: number;
}

const THINKING_PRESETS: Record<string, string> = {
  off: "",
  low: "Think briefly before answering.",
  medium: "Think carefully and consider multiple angles before answering.",
  high: "Think deeply and exhaustively. Consider edge cases, alternatives, and implications before answering.",
};

export async function runLlmTask(input: LlmTaskInput): Promise<LlmTaskResult> {
  const start = Date.now();
  const timeout = input.timeoutMs || 30000;

  try {
    const requestedId = input.model || "gemini-2.5-flash";
    const modelId = LEGACY_MODEL_ALIASES[requestedId] || requestedId;
    const available = await getAvailableModels();
    const modelExists = available.some(m => m.id === modelId);
    if (!modelExists) {
      return { success: false, error: `Model "${requestedId}" is not available. Available: ${available.slice(0, 5).map(m => m.id).join(", ")}` };
    }

    const { client, actualModelId } = await getClientForModel(modelId, input.tenantId, { requiresTools: true });

    let systemContent = `You are a JSON-only assistant. Output ONLY valid JSON — no markdown fences, no commentary, no explanation.`;

    if (input.thinking && THINKING_PRESETS[input.thinking]) {
      systemContent += `\n\n${THINKING_PRESETS[input.thinking]}`;
    }

    if (input.schema) {
      systemContent += `\n\nYour output MUST conform to this JSON Schema:\n${JSON.stringify(input.schema, null, 2)}`;
    }

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

    const isReasoningModel = /^(o[1-9]|o4)/.test(actualModelId) || actualModelId.includes("reasoning");
    const createParams: any = {
      model: actualModelId,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
      max_completion_tokens: input.maxTokens || 16384,
      response_format: { type: "json_object" },
    };
    if (!isReasoningModel) {
      createParams.temperature = input.temperature ?? 0.1;
    }

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), timeout);
    let response: any;
    try {
      response = await client.chat.completions.create(createParams, { signal: abortController.signal });
    } catch (apiErr: any) {
      if (apiErr.message?.includes("temperature") && createParams.temperature !== undefined) {
        console.log(`[llm-task] Model ${actualModelId} rejected temperature=${createParams.temperature}, retrying with default`);
        delete createParams.temperature;
        response = await client.chat.completions.create(createParams, { signal: abortController.signal });
      } else {
        throw apiErr;
      }
    } finally {
      clearTimeout(timeoutHandle);
    }

    const durationMs = Date.now() - start;
    const raw = response.choices?.[0]?.message?.content?.trim() || "";

    let parsed: any;
    try {
      let jsonStr = raw;
      const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      return {
        success: false,
        error: `Model returned invalid JSON: ${raw.slice(0, 200)}`,
        model: actualModelId,
        durationMs,
      };
    }

    if (input.schema) {
      const errors = validateAgainstSchema(parsed, input.schema);
      if (errors.length > 0) {
        return {
          success: false,
          json: parsed,
          model: actualModelId,
          validationErrors: errors,
          error: `schema validation failed: ${errors.slice(0, 3).join("; ")}`,
          durationMs,
        };
      }
    }

    return {
      success: true,
      json: parsed,
      model: actualModelId,
      durationMs,
    };
  } catch (err: any) {
    return {
      success: false,
      error: sanitizeLlmError(err),
      durationMs: Date.now() - start,
    };
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
}
export async function runLlmTextTask(input: LlmTextTaskInput): Promise<LlmTextTaskResult> {
  const start = Date.now();
  const timeout = input.timeoutMs || 30000;
  try {
    const requestedId = input.model || "gemini-2.5-flash";
    const modelId = LEGACY_MODEL_ALIASES[requestedId] || requestedId;
    const available = await getAvailableModels();
    const modelExists = available.some(m => m.id === modelId);
    if (!modelExists) {
      return { success: false, error: `Model "${requestedId}" is not available. Available: ${available.slice(0, 5).map(m => m.id).join(", ")}` };
    }
    const { client, actualModelId } = await getClientForModel(modelId, input.tenantId, { requiresTools: true });
    const isReasoningModel = /^(o[1-9]|o4)/.test(actualModelId) || actualModelId.includes("reasoning");
    const createParams: any = {
      model: actualModelId,
      messages: [
        ...(input.systemPrompt ? [{ role: "system", content: input.systemPrompt }] : []),
        { role: "user", content: input.prompt },
      ],
      max_completion_tokens: input.maxTokens || 16384,
    };
    if (!isReasoningModel) createParams.temperature = input.temperature ?? 0.4;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), timeout);
    let response: any;
    try {
      response = await client.chat.completions.create(createParams, { signal: abortController.signal });
    } catch (apiErr: any) {
      if (apiErr.message?.includes("temperature") && createParams.temperature !== undefined) {
        delete createParams.temperature;
        response = await client.chat.completions.create(createParams, { signal: abortController.signal });
      } else { throw apiErr; }
    } finally { clearTimeout(timeoutHandle); }
    const durationMs = Date.now() - start;
    const text = response.choices?.[0]?.message?.content?.toString() ?? "";
    return { success: true, text, model: actualModelId, durationMs };
  } catch (err: any) {
    return { success: false, error: sanitizeLlmError(err), durationMs: Date.now() - start };
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
