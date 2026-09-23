import {
  askTypeSafeJev,
  type JevRequest,
  type JevResponse,
} from "../typesafe-jev";
import { scanOutbound } from "./outbound-redaction";

const SKIP_THRESHOLD = 0.02;
const MAX_TURN_CHARS = 4_000;

export type SessionFactPrefilterMode = "off" | "shadow" | "enforce";
export type SessionFactPrefilterAskFn = (request: JevRequest) => Promise<JevResponse>;

export interface SessionFactPrefilterResult {
  status: "disabled" | "validated" | "blocked" | "unavailable";
  mode: SessionFactPrefilterMode;
  shouldRunExtractor: boolean;
  wouldSkip: boolean;
  durableFactProbability?: number;
  model?: string;
  usage?: JevResponse["usage"];
}

export interface SessionFactPrefilterInput {
  tenantId: number;
  userTurn: string;
  assistantTurn: string;
  _askFn?: SessionFactPrefilterAskFn;
}

export function getSessionFactPrefilterMode(): SessionFactPrefilterMode {
  const value = process.env.TYPESAFE_FACT_PREFILTER_MODE;
  return value === "shadow" || value === "enforce" ? value : "off";
}

export function isSessionFactPrefilterTenantAllowed(tenantId: number): boolean {
  if (!Number.isInteger(tenantId) || tenantId <= 0) return false;
  const allowlist = String(process.env.TYPESAFE_FACT_PREFILTER_TENANTS || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return allowlist.includes(tenantId);
}

function redactCommonPii(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED:email]")
    .replace(/\bhttps?:\/\/[^\s<>()]+/gi, "[REDACTED:url]")
    .replace(/(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g, "[REDACTED:phone]");
}

function prepareTurn(value: string): string | null {
  const raw = String(value || "").trim();
  if (!raw || raw.length > MAX_TURN_CHARS) return null;
  const scan = scanOutbound(raw, {
    strict: true,
    surface: "typesafe-fact-prefilter",
    includeWeakPatterns: true,
  });
  if (scan.verdict === "block") return null;
  return redactCommonPii(scan.redactedPayload);
}

export async function classifySessionFactNeed(
  input: SessionFactPrefilterInput,
): Promise<SessionFactPrefilterResult> {
  const mode = getSessionFactPrefilterMode();
  const fallback = (
    status: SessionFactPrefilterResult["status"],
  ): SessionFactPrefilterResult => ({
    status,
    mode,
    shouldRunExtractor: true,
    wouldSkip: false,
  });

  if (mode === "off") return fallback("disabled");
  if (!isSessionFactPrefilterTenantAllowed(input.tenantId)) return fallback("disabled");
  if (input._askFn && process.env.NODE_ENV !== "test") return fallback("unavailable");

  try {
    const userTurn = prepareTurn(input.userTurn);
    const assistantTurn = prepareTurn(input.assistantTurn);
    if (userTurn === null || assistantTurn === null) {
      console.warn("[typesafe-fact-prefilter] classification withheld by outbound sensitive-data gate");
      return fallback("blocked");
    }

    const request: JevRequest = {
      state: {
        user_turn: userTurn,
        assistant_turn: assistantTurn,
        scope: "Classify only whether this single turn establishes a durable conversation fact. Do not infer unstated facts.",
      },
      questions: {
        has_durable_fact: {
          type: "noul",
          instructions: "Does this turn establish any specific durable fact that will materially constrain or inform a later turn in this same conversation?",
          criteria: {
            true: "A concrete entity, preference, constraint, decision, schedule, blocker, or task-state update is explicitly established",
            false: "Only filler, thanks, generic discussion, speculation, transient prose, or no reusable fact is established",
          },
        },
      },
    };

    const result = await (input._askFn || askTypeSafeJev)(request);
    const answer = result.answers.has_durable_fact;
    if (answer?.type !== "noul" || answer.noul === undefined) {
      throw new Error("TypeSafe fact prefilter returned an incomplete signal");
    }
    const wouldSkip = answer.noul <= SKIP_THRESHOLD;
    const shouldRunExtractor = mode !== "enforce" || !wouldSkip;
    console.log(
      `[typesafe-fact-prefilter] mode=${mode} model=${result.model} ` +
      `durable_fact=${answer.noul.toFixed(3)} would_skip=${wouldSkip} extractor=${shouldRunExtractor}`,
    );
    return {
      status: "validated",
      mode,
      shouldRunExtractor,
      wouldSkip,
      durableFactProbability: answer.noul,
      model: result.model,
      usage: result.usage,
    };
  } catch (error) {
    const cause = error instanceof Error ? error.name : "unknown";
    console.warn(`[typesafe-fact-prefilter] unavailable cause=${cause}`);
    return fallback("unavailable");
  }
}