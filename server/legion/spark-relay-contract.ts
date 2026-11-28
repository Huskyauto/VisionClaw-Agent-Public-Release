import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { LEGION_MODEL, LOCAL_GUARDRAIL_PROMPT } from "./model-policy";

export const SPARK_RELAY = Object.freeze({
  protocol: "spark-legion-relay-v1", model: LEGION_MODEL, maxBytes: 65_536,
  maxTokens: 2048, deadlineMs: 210_000, claimMs: 80_000, minStartMs: 130_000,
  workerFreshMs: 150_000, maxWaiting: 4, maxPerHour: 8,
  tasks: ["compile-runbook", "extract-runbook-rule", "relay-probe"] as readonly string[],
  guardrail: LOCAL_GUARDRAIL_PROMPT,
});
export const RELAY_JOB_KIND = "legion_spark_relay";
export const RELAY_WORKER_KIND = "legion_spark_worker";
export const DIRECT_RESERVATION_KIND = "legion_lenovo_reservation";
export type RelayStatus = "queued" | "claimed" | "running" | "complete" |
  "failed_before_send" | "uncertain" | "cancelled" | "released";
export type RelayOutcome = "complete" | "failed_before_send" | "uncertain";
export interface RelayBinding {
  protocol: string; workerId: string; requestId: string; digest: string; claimToken: string;
}
export const relayHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const relayStatus = (status: string) => status.replace(/^relay_/, "") as RelayStatus;
export const relayTerminal = (status: RelayStatus) =>
  ["complete", "failed_before_send", "uncertain", "cancelled", "released"].includes(status);
const object = (value: any) => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, max: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;

/** Only server-owned bounded text requests enter the relay, never chat tool args. */
export function makeRelayRequest(body: Record<string, any>) {
  if (body.model !== LEGION_MODEL || body.stream !== false || body.temperature !== 0 ||
      !integer(body.max_tokens, SPARK_RELAY.maxTokens) || body.max_tokens < 1 ||
      body.tools || body.tool_choice || !Array.isArray(body.messages) || body.messages.length < 2 ||
      body.messages.length > 6 || body.messages[0]?.role !== "system" ||
      body.messages[0]?.content !== LOCAL_GUARDRAIL_PROMPT ||
      body.messages.some((m: any) => !object(m) || Object.keys(m).some(k => !["role", "content"].includes(k)) ||
        !["system", "user"].includes(m.role) || typeof m.content !== "string") ||
      body.messages.reduce((n: number, m: any) => n + m.content.length, 0) > 16_000) {
    throw Error("Spark relay request contract refused");
  }
  const native: Record<string, any> = { model: LEGION_MODEL, stream: false, think: false,
    messages: body.messages, options: { temperature: 0, num_predict: body.max_tokens } };
  if (body.response_format) {
    if (body.response_format.type === "json_object") native.format = "json";
    else if (body.response_format.type === "json_schema" && object(body.response_format.json_schema?.schema))
      native.format = body.response_format.json_schema.schema;
    else throw Error("Spark relay response format refused");
  }
  const requestJson = JSON.stringify(native);
  if (Buffer.byteLength(requestJson) > SPARK_RELAY.maxBytes) throw Error("Spark relay request too large");
  return { requestJson, digest: relayHash(requestJson) };
}

/** Shape and model identity are worker-reported transport evidence, not hardware attestation. */
export function validateRelayCompletion(requestJson: string, responseJson: string) {
  if (typeof responseJson !== "string" || Buffer.byteLength(responseJson) > SPARK_RELAY.maxBytes)
    throw Error("Spark relay response size refused");
  let response: any, request: any;
  try { response = JSON.parse(responseJson); request = JSON.parse(requestJson); }
  catch { throw Error("Spark relay response JSON refused"); }
  if (!object(response) || response.model !== LEGION_MODEL || request.model !== LEGION_MODEL ||
      response.done !== true || response.done_reason !== "stop" || response.error ||
      !object(response.message) || response.message.role !== "assistant" ||
      typeof response.message.content !== "string" || !response.message.content.trim() ||
      response.message.content.length > 12_000 || response.message.tool_calls?.length ||
      response.message.function_call || response.message.refusal || response.message.thinking ||
      /<\/?think>|<\|(?:tool|function)/i.test(response.message.content) ||
      !integer(response.prompt_eval_count, 1_000_000) ||
      !integer(response.eval_count, request.options?.num_predict ?? 0)) {
    throw Error("Spark relay completion contract refused");
  }
  if (request.format) {
    try {
      const parsed = JSON.parse(response.message.content);
      if (request.format === "json") {
        if (!object(parsed)) throw Error("Object required");
      } else z.fromJSONSchema(request.format).parse(parsed);
    } catch { throw Error("Spark relay completion format contract refused"); }
  }
  return { model: LEGION_MODEL, system_fingerprint: "fp_ollama",
    usage: { prompt_tokens: response.prompt_eval_count, completion_tokens: response.eval_count },
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: response.message.content } }] };
}
