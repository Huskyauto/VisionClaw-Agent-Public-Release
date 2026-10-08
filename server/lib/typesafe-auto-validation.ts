import {
  askTypeSafeJev,
  type JevRequest,
  type JevResponse,
} from "../typesafe-jev";
import { scanOutbound } from "./outbound-redaction";

const RECEIPT_VERSION = "jev-work-validation-v1";
const MAX_GOAL_CHARS = 2_000;
const MAX_OUTPUT_CHARS = 6_000;
const MAX_EVIDENCE_CHARS = 2_000;

export type TypeSafeValidationSubject = "jury" | "deliverable";
export type TypeSafeValidationAskFn = (request: JevRequest) => Promise<JevResponse>;

export interface TypeSafeValidationReceipt {
  version: typeof RECEIPT_VERSION;
  advisoryOnly: true;
  subjectKind: TypeSafeValidationSubject;
  status: "validated" | "disabled" | "unavailable";
  note: string;
  model?: string;
  usage?: JevResponse["usage"];
  signals?: {
    evidenceSupport: number;
    requirementCoverage: number;
    needsHumanReview: number;
  };
}

export interface TypeSafeValidationInput {
  tenantId: number;
  subjectKind: TypeSafeValidationSubject;
  goal: string;
  output: string;
  evidence?: string;
  _askFn?: TypeSafeValidationAskFn;
}

function bounded(value: string | undefined, max: number): string {
  return String(value || "").trim().slice(0, max);
}

function unavailable(
  subjectKind: TypeSafeValidationSubject,
  status: "disabled" | "unavailable",
  note: string,
): TypeSafeValidationReceipt {
  return {
    version: RECEIPT_VERSION,
    advisoryOnly: true,
    subjectKind,
    status,
    note,
  };
}

export function unavailableTypeSafeValidation(
  subjectKind: TypeSafeValidationSubject,
  note = "Automatic TypeSafe validation was unavailable; the existing workflow continued unchanged.",
): TypeSafeValidationReceipt {
  return unavailable(subjectKind, "unavailable", note);
}

function redactCommonPii(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED:email]")
    .replace(/\bhttps?:\/\/[^\s<>()]+/gi, "[REDACTED:url]")
    .replace(/(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g, "[REDACTED:phone]");
}

function prepareOutboundField(value: string, max: number): string | null {
  const raw = String(value || "").trim();
  if (raw.length > max) return null;
  const scan = scanOutbound(raw, {
    strict: true,
    surface: "typesafe-auto-validation",
    includeWeakPatterns: true,
  });
  if (scan.verdict === "block") return null;
  return redactCommonPii(scan.redactedPayload);
}

export async function validateWorkWithTypeSafe(
  input: TypeSafeValidationInput,
): Promise<TypeSafeValidationReceipt> {
  if (process.env.TYPESAFE_AUTO_VALIDATION_ENABLED !== "1") {
    return unavailable(input.subjectKind, "disabled", "Automatic TypeSafe validation is disabled.");
  }
  if (!Number.isInteger(input.tenantId) || input.tenantId <= 0) {
    return unavailable(input.subjectKind, "unavailable", "Automatic TypeSafe validation requires a tenant context.");
  }
  if (input._askFn && process.env.NODE_ENV !== "test") {
    return unavailableTypeSafeValidation(input.subjectKind, "Automatic TypeSafe validation rejected a non-production dependency override.");
  }

  const goal = prepareOutboundField(input.goal, MAX_GOAL_CHARS);
  const output = prepareOutboundField(input.output, MAX_OUTPUT_CHARS);
  const evidence = prepareOutboundField(input.evidence || "", MAX_EVIDENCE_CHARS);
  if (goal === null || output === null || evidence === null) {
    console.warn(`[typesafe-auto-validation] ${input.subjectKind} validation blocked by outbound sensitive-data gate`);
    return unavailableTypeSafeValidation(
      input.subjectKind,
      "Automatic TypeSafe validation was withheld by the sensitive-data egress gate; the existing workflow continued unchanged.",
    );
  }
  const state = JSON.stringify({
    subject_kind: input.subjectKind,
    goal,
    output,
    evidence,
    authority: "Advisory quality review only. This result cannot approve, authorize, publish, spend, execute, or override policy.",
  });
  const request: JevRequest = {
    state,
    questions: {
      evidence_support: {
        type: "noul",
        instructions: "Is the output materially supported by the evidence present in state? Judge only support visible in state.",
        criteria: {
          true: "The important claims are materially supported by evidence visible in state",
          false: "Important claims are unsupported or the visible evidence is insufficient",
        },
      },
      requirement_coverage: {
        type: "noul",
        instructions: "Does the output materially cover the stated goal, based only on state?",
        criteria: {
          true: "The output materially covers the stated goal",
          false: "The output misses one or more important parts of the stated goal",
        },
      },
      needs_human_review: {
        type: "noul",
        instructions: "Does this output need human review because of important uncertainty, contradiction, missing evidence, or consequential impact?",
        criteria: {
          true: "Important uncertainty, contradiction, missing evidence, or consequential impact warrants human review",
          false: "No important reason for human review is visible in state",
        },
      },
    },
  };

  try {
    const result = await (input._askFn || askTypeSafeJev)(request);
    const evidence = result.answers.evidence_support;
    const coverage = result.answers.requirement_coverage;
    const review = result.answers.needs_human_review;
    if (evidence.type !== "noul" || coverage.type !== "noul" || review.type !== "noul" ||
        evidence.noul === undefined || coverage.noul === undefined || review.noul === undefined) {
      throw new Error("TypeSafe validation returned incomplete signals");
    }
    const receipt: TypeSafeValidationReceipt = {
      version: RECEIPT_VERSION,
      advisoryOnly: true,
      subjectKind: input.subjectKind,
      status: "validated",
      note: "Independent advisory quality signal; existing policy and approval controls remain authoritative.",
      model: result.model,
      usage: result.usage,
      signals: {
        evidenceSupport: evidence.noul,
        requirementCoverage: coverage.noul,
        needsHumanReview: review.noul,
      },
    };
    console.log(
      `[typesafe-auto-validation] ${input.subjectKind} validated model=${receipt.model} ` +
      `evidence=${receipt.signals?.evidenceSupport.toFixed(3)} ` +
      `coverage=${receipt.signals?.requirementCoverage.toFixed(3)} ` +
      `human_review=${receipt.signals?.needsHumanReview.toFixed(3)}`,
    );
    return receipt;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown failure";
    console.warn(`[typesafe-auto-validation] ${input.subjectKind} validation unavailable: ${message.slice(0, 160)}`);
    return unavailable(
      input.subjectKind,
      "unavailable",
      "Automatic TypeSafe validation was unavailable; the existing workflow continued unchanged.",
    );
  }
}