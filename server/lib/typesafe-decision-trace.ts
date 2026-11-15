import { createHash } from "node:crypto";
import { TYPESAFE_JEV_MODEL, type JevRequest, type JevResponse } from "../typesafe-jev";

/** Internal advisory audit record. Fingerprints are sensitive derived metadata,
 * not anonymization, authority receipts, or a substitute for retained evidence. */
export interface JevDecisionTrace {
  version: "jev-decision-trace-v1";
  tenantId: number;
  advisoryOnly: true;
  evaluatedAt: string;
  stateVersion: "jev-state-v1";
  stateDigest: string;
  outputDigest: string;
  questionDigest: string;
  policyDigest: string;
  questionVersion: string;
  requestedModel: string;
  servedModel: string;
  questions: JevRequest["questions"];
  answers: JevResponse["answers"];
  usage: JevResponse["usage"];
  latencyMs: number;
  policy: Record<string, string | number | boolean>;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildJevDecisionTrace(input: {
  tenantId: number;
  request: JevRequest;
  response: JevResponse;
  output: string;
  questionVersion: string;
  latencyMs: number;
  policy: JevDecisionTrace["policy"];
}): JevDecisionTrace {
  if (!Number.isSafeInteger(input.tenantId) || input.tenantId < 1) {
    throw new Error("Jev decision trace requires tenant context");
  }
  return {
    version: "jev-decision-trace-v1",
    tenantId: input.tenantId,
    advisoryOnly: true,
    evaluatedAt: new Date().toISOString(),
    stateVersion: "jev-state-v1",
    stateDigest: digest([input.tenantId, input.request.state]),
    outputDigest: digest([input.tenantId, input.output]),
    questionDigest: digest([input.questionVersion, input.request.questions]),
    policyDigest: digest(input.policy),
    questionVersion: input.questionVersion,
    requestedModel: TYPESAFE_JEV_MODEL,
    servedModel: input.response.model,
    questions: input.request.questions,
    answers: input.response.answers,
    usage: input.response.usage,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    policy: input.policy,
  };
}

/** Quality telemetry is fail-soft. A deadline means unconfirmed, not failed:
 * a late database completion must never be blindly retried. */
export async function persistJevDecisionTrace(
  tenantId: number, subject: "jury" | "deliverable", trace: JevDecisionTrace,
): Promise<{ status: "persisted" | "unconfirmed" | "not_attempted"; activityId?: number }> {
  if (!Number.isSafeInteger(tenantId) || tenantId < 1 || trace.tenantId !== tenantId) {
    console.warn("[typesafe-decision-trace] audit withheld: invalid tenant binding");
    return { status: "not_attempted" };
  }
  if (process.env.NODE_ENV === "test") return { status: "not_attempted" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = async () => {
    const [{ db }, { agentActivity }, { sql }] = await Promise.all([
      import("../db"), import("../../shared/schema"), import("drizzle-orm"),
    ]);
    const id = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = '1000ms'`);
      const [row] = await tx.insert(agentActivity).values({
        tenantId, personaName: "VisionClaw", activityType: "jev_decision",
        status: "completed", summary: `Advisory Jev ${subject} check; not approval`,
        metadata: { subject, trace }, completedAt: new Date(),
      }).returning({ id: agentActivity.id });
      if (!row?.id) throw new Error("Jev audit write unconfirmed");
      return row.id;
    });
    return { status: "persisted" as const, activityId: id };
  };
  try {
    return await Promise.race([
      write(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Jev audit deadline")), 1500);
      }),
    ]);
  } catch {
    console.warn("[typesafe-decision-trace] audit write unconfirmed; advisory result unchanged, no retry");
    return { status: "unconfirmed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
