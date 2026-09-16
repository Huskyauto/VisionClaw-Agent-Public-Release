/** Bounded, advisory-only TypeSafe Jev client. Deliberately has no retries. */
export const TYPESAFE_JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const TYPESAFE_JEV_MODEL = "jev-latest";
const MAX_QUESTIONS = 3;
const MAX_STATE_CHARS = 12_000;
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
};
export type JevQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;
export type JevRequest = { state: string; questions: Record<string, JevQuestion> };
export type JevAnswer = {
  type: "choice" | "score" | "noul";
  choice?: string;
  score?: number;
  noul?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
};
export type JevResponse = {
  answers: Record<string, JevAnswer>;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
};

export function getTypeSafeJevStatus() {
  const configured = Boolean(process.env.TYPESAFE_API_KEY);
  const enabled = process.env.TYPESAFE_JEV_ENABLED === "1";
  return { configured, enabled, ready: configured && enabled };
}

function requireText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label} must be non-empty and at most ${max} characters`);
  }
  return value;
}

function validateRequest(input: unknown): JevRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Jev request");
  const raw = input as Record<string, unknown>;
  const state = requireText(raw.state, "Jev state", MAX_STATE_CHARS);
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
      questions[name] = { type: "noul", instructions };
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
      if (typeof answer.choice !== "string" || !(answer.choice in question.criteria)) {
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
      answers[name] = {
        type: "choice",
        choice: answer.choice,
        probabilities,
        confidence: probability(answer.confidence, `${name} confidence`),
      };
    } else if (question.type === "score") {
      assertExactKeys(answer, ["type", "score", "legend", "confidence"], name);
      if (typeof answer.score !== "number" || !Number.isFinite(answer.score) ||
          answer.score < 0 || answer.score > question.criteria.length - 1) {
        throw new Error(`TypeSafe Jev returned an invalid score for ${name}`);
      }
      if (answer.legend !== undefined) {
        if (!answer.legend || typeof answer.legend !== "object" || Array.isArray(answer.legend)) {
          throw new Error(`TypeSafe Jev returned an invalid legend for ${name}`);
        }
        const expectedLegend = Object.fromEntries(question.criteria.map((criterion, index) => [String(index), criterion]));
        if (JSON.stringify(answer.legend) !== JSON.stringify(expectedLegend)) {
          throw new Error(`TypeSafe Jev returned an invalid legend for ${name}`);
        }
      }
      answers[name] = {
        type: "score",
        score: answer.score,
        confidence: probability(answer.confidence, `${name} confidence`),
      };
    } else {
      assertExactKeys(answer, ["type", "noul"], name);
      answers[name] = { type: "noul", noul: probability(answer.noul, `${name} probability`) };
    }
  }
  const usage = raw.usage;
  const safeUsage = usage && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)
    ? { input_tokens: Number(usage.input_tokens), output_tokens: Number(usage.output_tokens) }
    : undefined;
  return {
    answers,
    model: typeof raw.model === "string" ? raw.model.slice(0, 100) : undefined,
    usage: safeUsage,
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