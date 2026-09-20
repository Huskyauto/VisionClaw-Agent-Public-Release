/** Bounded, advisory-only TypeSafe Jev client. Deliberately has no retries. */
export const TYPESAFE_JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const TYPESAFE_JEV_MODEL = "jev-latest";
const MAX_QUESTIONS = 3;
const MAX_STATE_CHARS = 12_000;
const MAX_STATE_DEPTH = 8;
const MAX_STATE_NODES = 1_000;
const MAX_INSTRUCTIONS_CHARS = 500;
const MAX_CRITERIA = 20;
const MAX_REQUEST_BYTES = 24_000;
const MAX_RESPONSE_BYTES = 32_000;
const TIMEOUT_MS = 5_000;
const NAME_RX = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};
type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};
type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};
export type JevQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;
export type JevJsonValue = string | boolean | number | null | JevJsonValue[] | { [key: string]: JevJsonValue };
export type JevState = string | JevJsonValue[] | { [key: string]: JevJsonValue };
export type JevRequest = { state: JevState; questions: Record<string, JevQuestion> };
export type JevAnswer = {
  type: "choice" | "score" | "noul";
  choice?: string;
  score?: number;
  noul?: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence?: number;
};
export type JevResponse = {
  answers: Record<string, JevAnswer>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};

export function getTypeSafeJevStatus() {
  const configured = Boolean(process.env.TYPESAFE_API_KEY);
  const enabled = process.env.TYPESAFE_JEV_ENABLED === "1";
  const autoValidationEnabled = process.env.TYPESAFE_AUTO_VALIDATION_ENABLED === "1";
  return {
    configured,
    enabled,
    ready: configured && enabled,
    autoValidationEnabled,
    autoValidationReady: configured && enabled && autoValidationEnabled,
  };
}

function requireText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label} must be non-empty and at most ${max} characters`);
  }
  return value;
}

function validateStructuredState(value: unknown): Exclude<JevState, string> {
  let nodes = 0;
  const active = new WeakSet<object>();
  const visit = (current: unknown, depth: number, root = false): JevJsonValue => {
    nodes++;
    if (nodes > MAX_STATE_NODES || depth > MAX_STATE_DEPTH) {
      throw new Error("Jev structured state exceeds complexity limit");
    }
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new Error("Jev structured state must contain finite JSON values");
      return current;
    }
    if (typeof current === "string") {
      if (current.length > MAX_STATE_CHARS) throw new Error(`Jev state must be at most ${MAX_STATE_CHARS} characters`);
      return current;
    }
    if (Array.isArray(current)) {
      if (root && current.length === 0) throw new Error("Jev structured state must not be empty");
      if (current.length > MAX_STATE_NODES) throw new Error("Jev structured state exceeds complexity limit");
      if (active.has(current)) throw new Error("Jev structured state must not contain cycles");
      active.add(current);
      try {
        const ownKeys = Reflect.ownKeys(current);
        if (ownKeys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/.test(key)))) {
          throw new Error("Jev structured arrays must contain only indexed data properties");
        }
        const output: JevJsonValue[] = [];
        for (let index = 0; index < current.length; index++) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor) throw new Error("Jev structured state does not allow sparse arrays");
          if (!("value" in descriptor)) throw new Error("Jev structured state must use data properties");
          output.push(visit(descriptor.value, depth + 1));
        }
        return output;
      } finally {
        active.delete(current);
      }
    }
    if (typeof current === "object" &&
        (Object.getPrototypeOf(current) === Object.prototype || Object.getPrototypeOf(current) === null)) {
      if (active.has(current)) throw new Error("Jev structured state must not contain cycles");
      active.add(current);
      try {
        const keys = Reflect.ownKeys(current);
        if (keys.some((key) => typeof key !== "string")) {
          throw new Error("Jev structured state must use string keys");
        }
        if (root && keys.length === 0) throw new Error("Jev structured state must not be empty");
        const descriptors = Object.getOwnPropertyDescriptors(current);
        return Object.fromEntries(keys.map((key) => {
          const descriptor = descriptors[key as string];
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
            throw new Error("Jev structured state must use enumerable data properties");
          }
          if (!(key as string).trim()) throw new Error("Jev structured state keys must be non-empty");
          return [key as string, visit(descriptor.value, depth + 1)];
        }));
      } finally {
        active.delete(current);
      }
    }
    throw new Error("Jev structured state must contain only JSON values");
  };
  return visit(value, 0, true) as Exclude<JevState, string>;
}

function validateState(value: unknown): JevState {
  if (typeof value === "string") return requireText(value, "Jev state", MAX_STATE_CHARS);
  if (!Array.isArray(value) && (!value || typeof value !== "object")) {
    throw new Error("Jev state must be a non-empty string, object, or array");
  }
  const state = validateStructuredState(value);
  if (JSON.stringify(state).length > MAX_STATE_CHARS) {
    throw new Error(`Jev state must be at most ${MAX_STATE_CHARS} characters`);
  }
  return state;
}

function validateRequest(input: unknown): JevRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Jev request");
  const raw = input as Record<string, unknown>;
  const stateDescriptor = Object.getOwnPropertyDescriptor(raw, "state");
  if (!stateDescriptor || !stateDescriptor.enumerable || !("value" in stateDescriptor)) {
    throw new Error("Jev request state must be an enumerable data property");
  }
  const state = validateState(stateDescriptor.value);
  if (!raw.questions || typeof raw.questions !== "object" || Array.isArray(raw.questions)) {
    throw new Error("Jev questions must be a keyed object");
  }
  const entries = Object.entries(raw.questions as Record<string, unknown>);
  if (entries.length < 1 || entries.length > MAX_QUESTIONS) throw new Error("TypeSafe Jev requires 1-3 questions");
  const questions: Record<string, JevQuestion> = {};
  for (const [name, value] of entries) {
    if (!NAME_RX.test(name) || !value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid Jev question");
    }
    const item = value as Record<string, unknown>;
    const instructions = requireText(item.instructions, `Jev question ${name}`, MAX_INSTRUCTIONS_CHARS);
    if (item.type === "noul") {
      let criteria: NoulQuestion["criteria"];
      if (item.criteria !== undefined) {
        if (!item.criteria || typeof item.criteria !== "object" || Array.isArray(item.criteria)) {
          throw new Error(`Jev noul ${name} criteria must define true and false`);
        }
        const rawCriteria = item.criteria as Record<string, unknown>;
        assertExactKeys(rawCriteria, ["true", "false"], `${name} criteria`);
        criteria = {
          true: requireText(rawCriteria.true, `Jev noul ${name} true criterion`, MAX_INSTRUCTIONS_CHARS),
          false: requireText(rawCriteria.false, `Jev noul ${name} false criterion`, MAX_INSTRUCTIONS_CHARS),
        };
      }
      questions[name] = { type: "noul", instructions, ...(criteria ? { criteria } : {}) };
    } else if (item.type === "choice") {
      if (!item.criteria || typeof item.criteria !== "object" || Array.isArray(item.criteria)) {
        throw new Error(`Jev choice ${name} requires keyed criteria`);
      }
      const criteriaEntries = Object.entries(item.criteria as Record<string, unknown>);
      if (criteriaEntries.length < 2 || criteriaEntries.length > MAX_CRITERIA) {
        throw new Error(`Jev choice ${name} requires 2-${MAX_CRITERIA} criteria`);
      }
      const criteria: Record<string, string> = {};
      for (const [key, description] of criteriaEntries) {
        if (!NAME_RX.test(key)) throw new Error(`Invalid Jev choice key: ${key}`);
        criteria[key] = requireText(description, `Jev choice ${key}`, MAX_INSTRUCTIONS_CHARS);
      }
      questions[name] = { type: "choice", instructions, criteria };
    } else if (item.type === "score") {
      if (!Array.isArray(item.criteria) || item.criteria.length < 2 || item.criteria.length > MAX_CRITERIA) {
        throw new Error(`Jev score ${name} requires 2-${MAX_CRITERIA} criteria`);
      }
      questions[name] = {
        type: "score",
        instructions,
        criteria: item.criteria.map((criterion, index) =>
          requireText(criterion, `Jev score criterion ${index}`, MAX_INSTRUCTIONS_CHARS)),
      };
    } else {
      throw new Error(`Invalid Jev question type for ${name}`);
    }
  }
  const validated = { state, questions };
  if (new TextEncoder().encode(JSON.stringify(validated)).byteLength > MAX_REQUEST_BYTES) {
    throw new Error("Jev request exceeds size limit");
  }
  return validated;
}

function probability(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid Jev ${label}`);
  }
  return value;
}

function assertProbabilityDistribution(values: Record<string, number>, label: string): void {
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.001) {
    throw new Error(`TypeSafe Jev ${label} probabilities must sum to 1`);
  }
}

function assertExactKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new Error(`TypeSafe Jev returned unexpected fields for ${label}`);
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("TypeSafe Jev response exceeds size limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function validateResponse(body: unknown, request: JevRequest): JevResponse {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("TypeSafe Jev returned an invalid response");
  const raw = body as Record<string, any>;
  if (typeof raw.model !== "string" || !raw.model.trim() ||
      !raw.usage || typeof raw.usage !== "object" || Array.isArray(raw.usage)) {
    throw new Error("TypeSafe Jev response is missing model or usage");
  }
  assertExactKeys(raw.usage, ["input_tokens", "output_tokens"], "usage");
  const inputTokens = raw.usage.input_tokens;
  const outputTokens = raw.usage.output_tokens;
  if (!Number.isInteger(inputTokens) || inputTokens < 0 ||
      !Number.isInteger(outputTokens) || outputTokens < 0) {
    throw new Error("TypeSafe Jev returned invalid usage");
  }
  if (!raw.answers || typeof raw.answers !== "object" || Array.isArray(raw.answers)) {
    throw new Error("TypeSafe Jev returned an invalid response");
  }
  const expectedNames = Object.keys(request.questions).sort();
  const actualNames = Object.keys(raw.answers).sort();
  if (expectedNames.length !== actualNames.length || expectedNames.some((name, index) => name !== actualNames[index])) {
    throw new Error("TypeSafe Jev returned unexpected answer keys");
  }
  const answers: Record<string, JevAnswer> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    const answer = raw.answers[name];
    if (!answer || typeof answer !== "object" || answer.type !== question.type) {
      throw new Error(`TypeSafe Jev returned an invalid answer for ${name}`);
    }
    if (question.type === "choice") {
      assertExactKeys(answer, ["type", "choice", "probabilities", "confidence"], name);
      if (typeof answer.choice !== "string" || !Object.hasOwn(question.criteria, answer.choice)) {
        throw new Error(`TypeSafe Jev returned an invalid choice for ${name}`);
      }
      if (!answer.probabilities || typeof answer.probabilities !== "object" || Array.isArray(answer.probabilities)) {
        throw new Error(`TypeSafe Jev returned invalid probabilities for ${name}`);
      }
      const expectedProbabilityKeys = Object.keys(question.criteria).sort();
      const actualProbabilityKeys = Object.keys(answer.probabilities).sort();
      if (expectedProbabilityKeys.length !== actualProbabilityKeys.length ||
          expectedProbabilityKeys.some((key, index) => key !== actualProbabilityKeys[index])) {
        throw new Error(`TypeSafe Jev returned unexpected probability keys for ${name}`);
      }
      const probabilities: Record<string, number> = {};
      for (const key of Object.keys(question.criteria)) {
        probabilities[key] = probability(answer.probabilities?.[key], `${name} probability`);
      }
      assertProbabilityDistribution(probabilities, name);
      const maxProbability = Math.max(...Object.values(probabilities));
      if (probabilities[answer.choice] < maxProbability - 1e-12) {
        throw new Error(`TypeSafe Jev choice contradicts probabilities for ${name}`);
      }
      answers[name] = {
        type: "choice",
        choice: answer.choice,
        probabilities,
        confidence: probability(answer.confidence, `${name} confidence`),
      };
    } else if (question.type === "score") {
      assertExactKeys(answer, ["type", "score", "legend", "probabilities", "confidence"], name);
      if (!answer.legend || typeof answer.legend !== "object" || Array.isArray(answer.legend) ||
          !answer.probabilities || typeof answer.probabilities !== "object" || Array.isArray(answer.probabilities)) {
        throw new Error(`TypeSafe Jev returned an incomplete score for ${name}`);
      }
      if (typeof answer.score !== "number" || !Number.isFinite(answer.score) ||
          answer.score < 0 || answer.score > question.criteria.length - 1) {
        throw new Error(`TypeSafe Jev returned an invalid score for ${name}`);
      }
      const expectedLegend = Object.fromEntries(question.criteria.map((criterion, index) => [String(index), criterion]));
      if (JSON.stringify(answer.legend) !== JSON.stringify(expectedLegend)) {
        throw new Error(`TypeSafe Jev returned an invalid legend for ${name}`);
      }
      const expectedProbabilityKeys = question.criteria.map((_, index) => String(index));
      const actualProbabilityKeys = Object.keys(answer.probabilities);
      if (expectedProbabilityKeys.length !== actualProbabilityKeys.length ||
          expectedProbabilityKeys.some((key) => !Object.hasOwn(answer.probabilities, key))) {
        throw new Error(`TypeSafe Jev returned unexpected probability keys for ${name}`);
      }
      const probabilities = Object.fromEntries(expectedProbabilityKeys.map((key) => [
        key,
        probability(answer.probabilities[key], `${name} probability`),
      ]));
      assertProbabilityDistribution(probabilities, name);
      const weightedScore = expectedProbabilityKeys.reduce(
        (sum, key) => sum + Number(key) * probabilities[key],
        0,
      );
      if (Math.abs(answer.score - weightedScore) > 0.001) {
        throw new Error(`TypeSafe Jev score contradicts probabilities for ${name}`);
      }
      answers[name] = {
        type: "score",
        score: answer.score,
        legend: expectedLegend,
        probabilities,
        confidence: probability(answer.confidence, `${name} confidence`),
      };
    } else {
      assertExactKeys(answer, ["type", "noul"], name);
      answers[name] = { type: "noul", noul: probability(answer.noul, `${name} probability`) };
    }
  }
  return {
    answers,
    model: raw.model.slice(0, 100),
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

export async function askTypeSafeJev(
  input: unknown,
  fetchImpl: typeof fetch = fetch,
  callerSignal?: AbortSignal,
): Promise<JevResponse> {
  const status = getTypeSafeJevStatus();
  if (!status.configured) throw new Error("TypeSafe Jev is not configured");
  if (!status.enabled) throw new Error("TypeSafe Jev is disabled");
  const validated = validateRequest(input);
  const controller = new AbortController();
  let callerAborted = false;
  const abortFromCaller = () => {
    callerAborted = true;
    controller.abort();
  };
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(TYPESAFE_JEV_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: TYPESAFE_JEV_MODEL, ...validated }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`TypeSafe Jev provider returned ${response.status}`);
    const text = await readBoundedResponse(response);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("TypeSafe Jev returned malformed JSON");
    }
    return validateResponse(body, validated);
  } catch (error) {
    if ((error as any)?.name === "AbortError") {
      throw new Error(callerAborted ? "TypeSafe Jev request cancelled" : "TypeSafe Jev request timed out");
    }
    if (error instanceof Error && /^(TypeSafe Jev|Jev )/.test(error.message)) throw error;
    throw new Error("TypeSafe Jev request failed");
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}