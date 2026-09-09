/**
 * Measurement-only oversight shadow for the Built With Bob weekly recap.
 *
 * This module has no authority over the recap. It may append sanitized lifecycle
 * observations, but it cannot change a build, decision, approval, or publish.
 * Every write is bounded and fail-open.
 */
import { db } from "../db";
import { eventLog } from "@shared/schema";
import { sql } from "drizzle-orm";
import { logSilentCatch } from "./silent-catch";

const WRITE_TIMEOUT_MS = 1_000;
const JOB_ID_RE = /^vj_[a-z0-9_]{8,80}$/;

export type BwbShadowEvent =
  | "run_started"
  | "phase_changed"
  | "build_completed"
  | "build_failed"
  | "approval_requested"
  | "approval_decided";

export type BwbShadowStage =
  | "starting"
  | "discovering"
  | "transcribing"
  | "fetching_photos"
  | "writing_story"
  | "rendering"
  | "retrying"
  | "completed"
  | "failed"
  | "awaiting_approval"
  | "decision"
  | "other";

export interface BwbShadowInput {
  jobId: string;
  event: BwbShadowEvent;
  phase?: string;
  metadata?: Record<string, unknown>;
  at?: Date;
}

export interface BwbShadowObservation {
  schemaVersion: 1;
  mode: "shadow";
  eventKey: string;
  jobId: string;
  event: BwbShadowEvent;
  stage: BwbShadowStage;
  observedAt: string;
  attempt?: number;
  attempts?: number;
  totalChapters?: number;
  approvalId?: number;
  approved?: boolean;
  reviewLatencyMs?: number;
  failureCategory?: "transient" | "deterministic" | "delivery" | "other";
}

export interface BwbShadowAuthority {
  videoJobId?: string | null;
  videoStatus?: string | null;
  videoCreatedAt?: Date | string | null;
  videoCompletedAt?: Date | string | null;
  approval?: {
    id?: number | null;
    jobId?: string | null;
    kind?: string | null;
    status?: string | null;
    requestedAt?: Date | string | null;
    decidedAt?: Date | string | null;
  } | null;
}

const SHADOW_EVENTS = new Set<BwbShadowEvent>([
  "run_started",
  "phase_changed",
  "build_completed",
  "build_failed",
  "approval_requested",
  "approval_decided",
]);
const SHADOW_STAGES = new Set<BwbShadowStage>([
  "starting",
  "discovering",
  "transcribing",
  "fetching_photos",
  "writing_story",
  "rendering",
  "retrying",
  "completed",
  "failed",
  "awaiting_approval",
  "decision",
  "other",
]);
const EVENT_STAGE: Record<BwbShadowEvent, BwbShadowStage | null> = {
  run_started: "starting",
  phase_changed: null,
  build_completed: "completed",
  build_failed: "failed",
  approval_requested: "awaiting_approval",
  approval_decided: "decision",
};

export function isBwbOversightShadowEnabled(value = process.env.BWB_OVERSIGHT_SHADOW): boolean {
  return value !== "off";
}

function boundedInt(value: unknown, min: number, max: number): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function classifyPhase(phase: unknown, event: BwbShadowEvent): BwbShadowStage {
  if (event === "run_started") return "starting";
  if (event === "build_completed") return "completed";
  if (event === "build_failed") return "failed";
  if (event === "approval_requested") return "awaiting_approval";
  if (event === "approval_decided") return "decision";
  const text = String(phase ?? "").toLowerCase();
  if (text.includes("retry")) return "retrying";
  if (text.includes("discover")) return "discovering";
  if (text.includes("transcrib")) return "transcribing";
  if (text.includes("photo")) return "fetching_photos";
  if (text.includes("story") || text.includes("writing")) return "writing_story";
  if (text.includes("render") || text.includes("chapter") || text.includes("scene")) return "rendering";
  return "other";
}

function failureCategory(value: unknown): BwbShadowObservation["failureCategory"] {
  return value === "transient" || value === "deterministic" || value === "delivery"
    ? value
    : "other";
}

/** Build the complete allowlisted payload. Unrecognized metadata is discarded. */
export function buildBwbShadowObservation(input: BwbShadowInput): BwbShadowObservation {
  if (!SHADOW_EVENTS.has(input.event)) {
    throw new Error("Unsupported BWB shadow event");
  }
  const observedAt = (input.at ?? new Date()).toISOString();
  const stage = classifyPhase(input.phase, input.event);
  const metadata = input.metadata ?? {};
  const result: BwbShadowObservation = {
    schemaVersion: 1,
    mode: "shadow",
    eventKey: `${input.jobId}:${input.event}:${stage}:${observedAt}`,
    jobId: input.jobId,
    event: input.event,
    stage,
    observedAt,
  };

  const attempt = boundedInt(metadata.attempt, 1, 20);
  const attempts = boundedInt(metadata.attempts, 0, 20);
  const totalChapters = boundedInt(metadata.totalChapters, 0, 100);
  const approvalId = boundedInt(metadata.approvalId, 1, Number.MAX_SAFE_INTEGER);
  const reviewLatencyMs = boundedInt(metadata.reviewLatencyMs, 0, 30 * 24 * 60 * 60 * 1_000);
  if (attempt !== undefined) result.attempt = attempt;
  if (attempts !== undefined) result.attempts = attempts;
  if (totalChapters !== undefined) result.totalChapters = totalChapters;
  if (approvalId !== undefined) result.approvalId = approvalId;
  if (typeof metadata.approved === "boolean") result.approved = metadata.approved;
  if (reviewLatencyMs !== undefined) result.reviewLatencyMs = reviewLatencyMs;
  if (input.event === "build_failed") result.failureCategory = failureCategory(metadata.failureCategory);
  return result;
}

/** Strictly validate durable rows before they contribute to an evidence verdict. */
export function parseBwbShadowObservation(value: unknown): BwbShadowObservation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.schemaVersion !== 1 ||
    row.mode !== "shadow" ||
    typeof row.jobId !== "string" ||
    !JOB_ID_RE.test(row.jobId) ||
    typeof row.eventKey !== "string" ||
    row.eventKey !== `${row.jobId}:${row.event}:${row.stage}:${row.observedAt}` ||
    typeof row.event !== "string" ||
    !SHADOW_EVENTS.has(row.event as BwbShadowEvent) ||
    typeof row.stage !== "string" ||
    !SHADOW_STAGES.has(row.stage as BwbShadowStage) ||
    typeof row.observedAt !== "string" ||
    !Number.isFinite(Date.parse(row.observedAt))
  ) {
    return null;
  }
  const expectedStage = EVENT_STAGE[row.event as BwbShadowEvent];
  if (expectedStage !== null && row.stage !== expectedStage) return null;
  const optionalIntegers = ["attempt", "attempts", "totalChapters", "approvalId", "reviewLatencyMs"];
  if (optionalIntegers.some((key) =>
    row[key] !== undefined && (!Number.isSafeInteger(row[key]) || Number(row[key]) < 0))) {
    return null;
  }
  if (row.approved !== undefined && typeof row.approved !== "boolean") return null;
  if (
    row.failureCategory !== undefined &&
    !["transient", "deterministic", "delivery", "other"].includes(String(row.failureCategory))
  ) {
    return null;
  }
  return row as unknown as BwbShadowObservation;
}

/** Require independent durable records before a shadow row may affect conclusions. */
export function isBwbShadowObservationAuthoritative(
  observation: BwbShadowObservation,
  authority: BwbShadowAuthority,
): boolean {
  if (authority.videoJobId !== observation.jobId) return false;
  const observedMs = new Date(observation.observedAt).getTime();
  const createdMs = new Date(authority.videoCreatedAt ?? "").getTime();
  const completedMs = new Date(authority.videoCompletedAt ?? "").getTime();
  if (!Number.isFinite(createdMs) || observedMs < createdMs - 120_000) return false;
  if (
    observation.event !== "approval_requested" &&
    observation.event !== "approval_decided" &&
    Number.isFinite(completedMs) &&
    observedMs > completedMs + 120_000
  ) {
    return false;
  }
  if (observation.event === "run_started" && Math.abs(observedMs - createdMs) > 120_000) return false;
  if (
    observation.event === "build_completed" &&
    (authority.videoStatus !== "done" || !Number.isFinite(completedMs) || Math.abs(observedMs - completedMs) > 120_000)
  ) {
    return false;
  }
  if (
    observation.event === "build_failed" &&
    (authority.videoStatus !== "failed" || !Number.isFinite(completedMs) || Math.abs(observedMs - completedMs) > 120_000)
  ) {
    return false;
  }
  if (observation.event !== "approval_requested" && observation.event !== "approval_decided") {
    return true;
  }
  const approval = authority.approval;
  if (
    !approval ||
    approval.id !== observation.approvalId ||
    approval.jobId !== observation.jobId ||
    approval.kind !== "bwb-weekly" ||
    !["pending", "approved", "rejected", "expired"].includes(String(approval.status))
  ) {
    return false;
  }
  if (observation.event === "approval_decided") {
    const decidedMs = new Date(approval.decidedAt ?? "").getTime();
    return (
      ["approved", "rejected"].includes(String(approval.status)) &&
      Number.isFinite(new Date(approval.requestedAt ?? "").getTime()) &&
      Number.isFinite(decidedMs) &&
      Math.abs(observedMs - decidedMs) <= 120_000
    );
  }
  const requestedMs = new Date(approval.requestedAt ?? "").getTime();
  return Number.isFinite(requestedMs) && Math.abs(observedMs - requestedMs) <= 120_000;
}

export function missingBwbShadowEvents(
  events: Array<Pick<BwbShadowObservation, "event">>,
  videoStatus?: string | null,
  approvalStatus?: string | null,
): BwbShadowEvent[] {
  const observed = new Set(events.map((event) => event.event));
  const required: BwbShadowEvent[] = ["run_started"];
  if (videoStatus === "done") required.push("build_completed");
  if (videoStatus === "failed") required.push("build_failed");
  if (approvalStatus) required.push("approval_requested");
  if (approvalStatus === "approved" || approvalStatus === "rejected") {
    required.push("approval_decided");
  }
  return required.filter((event) => !observed.has(event));
}

export function isBwbShadowRunEvidenceReady(input: {
  events: Array<Pick<BwbShadowObservation, "event">>;
  videoStatus?: string | null;
  completedAt?: Date | string | null;
  approvalStatus?: string | null;
}): boolean {
  const terminal = input.videoStatus === "done" || input.videoStatus === "failed";
  const completedAt = new Date(input.completedAt ?? "").getTime();
  const decided = input.approvalStatus === "approved" || input.approvalStatus === "rejected";
  return (
    terminal &&
    Number.isFinite(completedAt) &&
    decided &&
    missingBwbShadowEvents(input.events, input.videoStatus, input.approvalStatus).length === 0
  );
}

/**
 * Append one shadow event. Invalid scope, disabled mode, DB errors, and timeouts
 * are all safe no-ops; the recap's primary operation has already happened.
 */
export async function recordBwbOversightShadow(args: {
  tenantId?: number;
  jobId?: string;
  event: BwbShadowEvent;
  phase?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    if (!isBwbOversightShadowEnabled()) return;
    const tenantId = Number(args.tenantId ?? process.env.BWB_TENANT_ID);
    const jobId = String(args.jobId ?? process.env.BWB_JOB_ID ?? "");
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || !JOB_ID_RE.test(jobId)) return;

    const data = buildBwbShadowObservation({
      jobId,
      event: args.event,
      phase: args.phase,
      metadata: args.metadata,
    });
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '900ms'`);
        await tx.insert(eventLog).values({
          tenantId,
          eventType: "bwb_oversight_shadow",
          source: "bwb-weekly",
          status: "shadow",
          data,
        });
        return "recorded" as const;
      }),
      new Promise<"unknown_after_timeout">((resolve) => {
        timer = setTimeout(() => resolve("unknown_after_timeout"), WRITE_TIMEOUT_MS);
        timer.unref?.();
      }),
    ]);
    if (timer) clearTimeout(timer);
    console.log(`[bwb-oversight-shadow] ${outcome} event=${args.event} job=${jobId} stage=${data.stage}`);
  } catch (error) {
    logSilentCatch("server/lib/bwb-oversight-shadow.ts:recordBwbOversightShadow", error);
  }
}