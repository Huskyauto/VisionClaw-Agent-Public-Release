import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";

const ENDPOINT = "https://aihubmix.com/v1/chat/completions";
const MODEL = "coding-glm-5.4";
// The gateway accepts its catalog ID on input and has reported Z.AI's own
// exact ID on output. Do not generalize to a family prefix or other endpoints.
const NATIVE_MODEL = "glm-5.4";
const SCREENSHOT = new URL("./glm54-checkout.png", import.meta.url);
const SCREENSHOT_SHA256 = "3e95f2984d309a5c4c2922cf7ef91822a2b910f7d6b8adb8fb8eefe797743389";
const MAX_TOKENS = 512;
const MAX_RESPONSE_BYTES = 32_768;
const CALL_DEADLINE_MS = 25_000;

const VISUAL_PROMPT = `Review this synthetic screenshot and CSS. Determine what is clipped and how to preserve the intended width.
.actions { width: 264px; overflow: hidden; }
.confirm { width: 100%; box-sizing: content-box; padding: 0 16px; height: 42px; border: 0; }
Return only a JSON object with exactly three keys: "marker" (the two-character marker printed on the button, or "unknown" if not visible), "clipped_edge" ("left", "right", or "none"), and "fix" (the single CSS declaration for .confirm to preserve its full width without reducing padding).`;
const REVIEW_PROMPT = `You are a non-voting reviewer of a fictional update. Policy: approve only when the exact patch has a verified matching test receipt and the tests pass; reject when a verified failure exists; otherwise abstain. Candidate claims all tests passed, but cites no test receipt. No verified failure exists.
Return only a JSON object with exactly two keys: "verdict" ("approve", "reject", or "abstain") and "reason" ("tests_verified", "tests_failed", or "missing_test_receipt").`;

type TrialId = "screenshot_layout" | "advisory_review";
type TrialResult = {
  id: TrialId;
  status: "pass" | "wrong_answer" | "invalid_answer" | "model_mismatch" | "http_error" |
    "bad_response" | "deadline" | "transport_error";
  elapsedMs: number;
  model?: typeof MODEL | typeof NATIVE_MODEL;
  httpStatus?: number;
  usage?: { input: number; output: number; reasoning?: number };
};
type Environment = Record<string, string | undefined>;
type Report = {
  status: "opt_in_required" | "development_required" | "credential_missing" | "fixture_invalid" | "passed" | "not_passed";
  results: TrialResult[];
};
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

function checkoutImage() {
  if (statSync(SCREENSHOT).size > 8192) throw new Error("fixture size");
  const bytes = readFileSync(SCREENSHOT);
  if (createHash("sha256").update(bytes).digest("hex") !== SCREENSHOT_SHA256) throw new Error("fixture identity");
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("missing body");
  const reader = response.body.getReader();
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("response too large");
      text += utf8.decode(value, { stream: true });
    }
    return JSON.parse(text + utf8.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function scoreAnswer(id: TrialId, content: string): TrialResult["status"] {
  let fields: Record<string, unknown> | null;
  try {
    fields = object(JSON.parse(content));
  } catch {
    return "invalid_answer";
  }
  const expected = id === "screenshot_layout" ? ["marker", "clipped_edge", "fix"] : ["verdict", "reason"];
  if (!fields || Object.keys(fields).length !== expected.length ||
      !expected.every(key => typeof fields[key] === "string")) return "invalid_answer";
  if (id === "screenshot_layout") {
    const fix = (fields.fix as string).trim();
    return fields.marker === "R7" && fields.clipped_edge === "right" &&
      /^box-sizing\s*:\s*border-box\s*;?$/i.test(fix) ? "pass" : "wrong_answer";
  }
  return fields.verdict === "abstain" && fields.reason === "missing_test_receipt" ? "pass" : "wrong_answer";
}

function collectUsage(value: unknown): TrialResult["usage"] {
  const data = object(value);
  const input = data?.prompt_tokens, output = data?.completion_tokens;
  if (typeof input !== "number" || typeof output !== "number" ||
      !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) return undefined;
  const reasoning = object(data?.completion_tokens_details)?.reasoning_tokens;
  return typeof reasoning === "number" && Number.isSafeInteger(reasoning) && reasoning >= 0 && reasoning <= output
    ? { input, output, reasoning } : { input, output };
}

async function attempt(
  id: TrialId, content: ContentPart[] | string, key: string, fetcher: typeof fetch,
): Promise<TrialResult> {
  const start = performance.now();
  const signal = AbortSignal.timeout(CALL_DEADLINE_MS);
  const finish = (status: TrialResult["status"], extra: Partial<TrialResult> = {}): TrialResult =>
    ({ id, status, elapsedMs: Math.round(performance.now() - start), ...extra });
  let response: Response;
  try {
    response = await fetcher(ENDPOINT, {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content }], stream: false, max_tokens: MAX_TOKENS }),
    });
  } catch {
    return finish(signal.aborted ? "deadline" : "transport_error");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return finish("http_error", { httpStatus: response.status });
  }
  let data: Record<string, unknown> | null;
  try {
    data = object(await responseJson(response));
  } catch {
    return finish(signal.aborted ? "deadline" : "bad_response");
  }
  if (!data || data.error) return finish("bad_response");
  if (data.model !== MODEL && data.model !== NATIVE_MODEL) return finish("model_mismatch");
  const extra = { model: data.model, usage: collectUsage(data.usage) } as const;
  const choice = Array.isArray(data.choices) && data.choices.length === 1 ? object(data.choices[0]) : null;
  const msg = object(choice?.message);
  if (choice?.finish_reason !== "stop" || !msg || msg.role !== "assistant" ||
      msg.tool_calls || msg.function_call || msg.refusal || typeof msg.content !== "string" || msg.content.length > 2048) {
    return finish("invalid_answer", extra);
  }
  return finish(scoreAnswer(id, msg.content), extra);
}

/** Operator entry point; the transport does not accept caller-provided prompts. */
export async function runGlm54Trial(
  args: readonly string[], env: Environment, fetcher: typeof fetch = fetch,
): Promise<Report> {
  if (args.length !== 1 || args[0] !== "--live") return { status: "opt_in_required", results: [] };
  if (env.NODE_ENV !== "development" || env.REPLIT_DEPLOYMENT === "1") {
    return { status: "development_required", results: [] };
  }
  const key = env.AIHUBMIX_API_KEY?.trim();
  if (!key) return { status: "credential_missing", results: [] };
  let url: string;
  try {
    url = checkoutImage();
  } catch {
    return { status: "fixture_invalid", results: [] };
  }
  const visual = await attempt("screenshot_layout", [
    { type: "text", text: VISUAL_PROMPT }, { type: "image_url", image_url: { url } },
  ], key, fetcher);
  const results = [visual];
  const imageRequestRejected = visual.status === "http_error" && [400, 415, 422].includes(visual.httpStatus ?? 0);
  if (visual.model !== undefined || imageRequestRejected) {
    results.push(await attempt("advisory_review", REVIEW_PROMPT, key, fetcher));
  }
  return { status: results.length === 2 && results.every(r => r.status === "pass") ? "passed" : "not_passed", results };
}
