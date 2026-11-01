import { randomUUID } from "node:crypto";
import { currentTenantId } from "./tenant-context";
import { mammouthModel } from "./mammouth-catalog";

type Selection = {
  explicitOwnerSelection?: boolean; platformAdminVerified?: boolean;
  forbidMeteredFallback?: boolean; allowMeteredFallback?: boolean; providerLane?: string;
};

export function mammouthReady(env: Record<string, string | undefined> = process.env): boolean {
  return env.MAMMOUTH_ENABLED !== "0" && !!env.MAMMOUTH_API_KEY?.trim();
}

export function assertMammouthAccess(
  tenantId: number | undefined, selection: Selection, env = process.env,
): void {
  if (tenantId !== 1 || currentTenantId() !== 1 ||
      selection.explicitOwnerSelection !== true || selection.platformAdminVerified !== true ||
      selection.forbidMeteredFallback === true || selection.allowMeteredFallback === false ||
      (selection.providerLane !== undefined && selection.providerLane !== "mammouth") ||
      !mammouthReady(env)) {
    throw new Error("Mammouth requires explicit verified owner selection and credit-metered access");
  }
}

const ALLOWED_PARAMS = new Set([
  "model", "messages", "tools", "tool_choice", "parallel_tool_calls", "temperature",
  "top_p", "stop", "seed", "frequency_penalty", "presence_penalty",
  "response_format", "reasoning", "reasoning_effort", "stream", "stream_options",
  "max_tokens", "max_completion_tokens", "n",
]);

function onlyKeys(value: any, keys: string[]): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every(key => keys.includes(key));
}
function functionName(value: any): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
function nativeFunction(value: any, call: boolean): boolean {
  return onlyKeys(value, call ? ["name", "arguments"] : ["name", "description", "parameters", "strict"]) &&
    functionName(value.name) && (call ? typeof value.arguments === "string" :
      (value.description === undefined || typeof value.description === "string") &&
      (value.strict === undefined || typeof value.strict === "boolean") &&
      (value.parameters === undefined || (value.parameters && typeof value.parameters === "object" &&
        !Array.isArray(value.parameters))));
}
function validateNestedWire(params: any): void {
  for (const message of params.messages) {
    if (!onlyKeys(message, ["role", "content", "name", "tool_call_id", "tool_calls"]) ||
        !["system", "developer", "user", "assistant", "tool"].includes(message.role) ||
        (message.name !== undefined && !functionName(message.name)) ||
        (message.tool_call_id !== undefined && typeof message.tool_call_id !== "string") ||
        (message.content == null && !(message.role === "assistant" && Array.isArray(message.tool_calls))) ||
        (Array.isArray(message.content) && message.content.some((part: any) =>
          !onlyKeys(part, ["type", "text"]) || part.type !== "text" || typeof part.text !== "string")) ||
        (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) ||
          message.tool_calls.length > 128 || message.tool_calls.some((call: any) =>
            !onlyKeys(call, ["id", "type", "function"]) || typeof call.id !== "string" ||
            call.type !== "function" || !nativeFunction(call.function, true))))) {
      throw new Error("Unsupported Mammouth message or nested media field");
    }
  }
  if (params.tools !== undefined && (!Array.isArray(params.tools) || params.tools.length > 128 ||
      params.tools.some((tool: any) => !onlyKeys(tool, ["type", "function"]) ||
        tool.type !== "function" || !nativeFunction(tool.function, false)))) {
    throw new Error("Mammouth accepts native function tools only");
  }
  if ((params.parallel_tool_calls !== undefined && typeof params.parallel_tool_calls !== "boolean") ||
      (params.tool_choice !== undefined &&
        !["none", "auto", "required"].includes(params.tool_choice) &&
        !(onlyKeys(params.tool_choice, ["type", "function"]) && params.tool_choice.type === "function" &&
          onlyKeys(params.tool_choice.function, ["name"]) && functionName(params.tool_choice.function.name)))) {
    throw new Error("Unsupported Mammouth tool choice");
  }
  const format = params.response_format;
  if (format !== undefined &&
      !(onlyKeys(format, ["type"]) && ["text", "json_object"].includes(format.type)) &&
      !(onlyKeys(format, ["type", "json_schema"]) && format.type === "json_schema" &&
        onlyKeys(format.json_schema, ["name", "description", "strict", "schema"]) &&
        functionName(format.json_schema.name) &&
        (format.json_schema.description === undefined || typeof format.json_schema.description === "string") &&
        (format.json_schema.strict === undefined || typeof format.json_schema.strict === "boolean") &&
        format.json_schema.schema && typeof format.json_schema.schema === "object" &&
        !Array.isArray(format.json_schema.schema))) {
    throw new Error("Unsupported Mammouth response format");
  }
}

/** Fixed endpoint, text/native tools only, one completion, bounded total output. */
export function mammouthRequest(id: string, params: any): { payload: any; maximumUsd: number } {
  const model = mammouthModel(id);
  if (!model || !params || typeof params !== "object" || Array.isArray(params) ||
      ![id, model.upstream].includes(params.model)) throw new Error("Mammouth model pin mismatch");
  if (Object.keys(params).some(key => !ALLOWED_PARAMS.has(key)) ||
      (params.n !== undefined && params.n !== 1)) throw new Error("Unsupported Mammouth request parameter");
  const efforts = new Set(["none", "minimal", "low", "medium", "high"]);
  if ((params.reasoning !== undefined && (!params.reasoning ||
        typeof params.reasoning !== "object" || Array.isArray(params.reasoning) ||
        Object.keys(params.reasoning).some(key => key !== "effort") ||
        !efforts.has(params.reasoning.effort))) ||
      (params.reasoning_effort !== undefined && !efforts.has(params.reasoning_effort))) {
    throw new Error("Mammouth accepts reasoning effort only, never a separate token budget");
  }
  if (model.upstream === "glm-5.3-flash" &&
      [params.reasoning?.effort, params.reasoning_effort].includes("none")) {
    throw new Error("Mammouth GLM Flash requires reasoning; it cannot be disabled");
  }
  if (!Array.isArray(params.messages) || !params.messages.length || params.messages.length > 256 ||
      params.messages.some((message: any) => !message || typeof message !== "object" ||
        (message.content != null && typeof message.content !== "string" &&
          (!Array.isArray(message.content) || message.content.some((part: any) =>
            part?.type !== "text" || typeof part?.text !== "string"))))) {
    throw new Error("Mammouth requires bounded text messages");
  }
  validateNestedWire(params);
  const maximum = params.max_completion_tokens ?? params.max_tokens ?? 1024;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 8192 ||
      (params.max_tokens !== undefined && params.max_completion_tokens !== undefined &&
        params.max_tokens !== params.max_completion_tokens) ||
      (params.stream !== undefined && typeof params.stream !== "boolean")) {
    throw new Error("Mammouth requires 1–8192 total output tokens");
  }
  // Clone only after strict key/schema validation: no caller object survives.
  const { max_completion_tokens: _discard, ...payload } = JSON.parse(JSON.stringify(params));
  payload.model = model.upstream;
  payload.max_tokens = maximum;
  if (payload.stream) payload.stream_options = { include_usage: true };
  const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (bytes > 128_000) throw new Error("Mammouth request body is too large");
  const maximumUsd = ((bytes * 4 + 4096) * model.inputPerMillion +
    maximum * model.outputPerMillion) / 1_000_000;
  if (maximumUsd > 0.25) throw new Error("Mammouth request exceeds the $0.25 admission bound");
  return { payload, maximumUsd };
}

export function mammouthUsageCost(id: string, usage: any): number | undefined {
  const model = mammouthModel(id);
  if (!model || !Number.isSafeInteger(usage?.prompt_tokens) || usage.prompt_tokens <= 0 ||
      !Number.isSafeInteger(usage?.completion_tokens) || usage.completion_tokens <= 0) return undefined;
  return (usage.prompt_tokens * model.inputPerMillion +
    usage.completion_tokens * model.outputPerMillion) / 1_000_000;
}

interface BudgetDeps {
  reserve: (args: { tenantId: number; attemptKey: string; maximumCostCents: number }) =>
    Promise<{ id: number; attemptKey: string }>;
  settle: (args: { tenantId: number; reservationId: number; attemptKey: string; actualCostCents: number }) => Promise<unknown>;
}

export async function runMammouthBudgeted(
  id: string, maximumUsd: number, invoke: () => Promise<any>, beforeDispatch: () => void,
  injected?: BudgetDeps,
): Promise<any> {
  if (!mammouthModel(id) || !Number.isFinite(maximumUsd) || maximumUsd <= 0 || maximumUsd > 0.25 ||
      currentTenantId() !== 1) throw new Error("Invalid Mammouth admission");
  const module = injected ? undefined : await import("../agentic/aggregate-ai-spend-budget");
  const authority: BudgetDeps = injected ?? {
    reserve: module!.reserveAggregateAiSpend, settle: module!.settleAggregateAiSpend,
  };
  const held = await authority.reserve({
    tenantId: 1, attemptKey: `mammouth:${randomUUID()}`, maximumCostCents: Math.ceil(maximumUsd * 100),
  });
  const finish = async (usage: any) => {
    const cost = mammouthUsageCost(id, usage);
    if (cost === undefined) {
      console.warn("[mammouth] Missing valid usage; budget reservation retained");
      throw new Error("Mammouth completion has missing or invalid usage; reservation retained, no retry");
    }
    try {
      await authority.settle({ tenantId: 1, reservationId: held.id,
        attemptKey: held.attemptKey, actualCostCents: Math.ceil(cost * 100) });
    } catch {
      console.warn("[mammouth] Settlement failed; budget reservation retained");
    }
  };
  beforeDispatch();
  const result = await invoke();
  if (!result?.[Symbol.asyncIterator]) { await finish(result?.usage); return result; }
  let consumed = false;
  return new Proxy(result, { get(target, property) {
    if (property === Symbol.asyncIterator) return async function* () {
      if (consumed) throw new Error("Mammouth stream cannot be consumed twice");
      consumed = true;
      let usage: any;
      for await (const chunk of target) { if (chunk.usage) usage = chunk.usage; yield chunk; }
      await finish(usage); // Never settle a disconnected/failed stream as completed.
    };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
