import { getClientForModel, getAvailableModels } from "./providers";

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
    const modelId = input.model || "gemini-2.5-flash";
    const available = await getAvailableModels();
    const modelExists = available.some(m => m.id === modelId);
    if (!modelExists) {
      return { success: false, error: `Model "${modelId}" is not available. Available: ${available.slice(0, 5).map(m => m.id).join(", ")}` };
    }

    const { client, actualModelId } = await getClientForModel(modelId, undefined, { requiresTools: true });

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
          success: true,
          json: parsed,
          model: actualModelId,
          validationErrors: errors,
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
      error: err.message || "LLM task failed",
      durationMs: Date.now() - start,
    };
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
