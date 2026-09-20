/**
 * Durable, tenant-scoped storage for report-only recovery evidence.
 *
 * This module deliberately exposes no replay, resume, or execution method.
 * A recovery cursor is human/operator inspection guidance only.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { agentRecoveryManifests, agentRuns, conversations } from "@shared/schema";
import {
  buildRecoveryCheckpoint,
  type RecoveryCheckpoint,
  type RecoveryScope,
} from "./lib/recovery-manifest-core";

const MAX_LIST_LIMIT = 100;

export interface RecordRecoveryCheckpointInput {
  tenantId: number;
  scope: RecoveryScope;
  eventType: string;
  eventIndex: number;
  state: unknown;
  payload?: unknown;
}

export type StoredRecoveryCheckpoint = typeof agentRecoveryManifests.$inferSelect;

function captureEnabled(): boolean {
  return process.env.RECOVERY_MANIFEST_ENABLED !== "0";
}

function safeFailureCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{1,48}$/.test(code) ? ` code=${code}` : "";
}

async function verifyScopeOwnership(tenantId: number, scope: RecoveryScope): Promise<void> {
  if (scope.runId) {
    const [run] = await db.select({ id: agentRuns.id }).from(agentRuns).where(and(
      eq(agentRuns.id, scope.runId),
      eq(agentRuns.tenantId, tenantId),
    )).limit(1);
    if (!run) throw new Error(`Recovery manifest run ${scope.runId} was not found for tenant ${tenantId}`);
  }
  if (scope.conversationId) {
    const [conversation] = await db.select({ id: conversations.id }).from(conversations).where(and(
      eq(conversations.id, scope.conversationId),
      eq(conversations.tenantId, tenantId),
    )).limit(1);
    if (!conversation) throw new Error(`Recovery manifest conversation ${scope.conversationId} was not found for tenant ${tenantId}`);
  }
}

/**
 * Claim the next sequence position for a run-attached trace boundary. This
 * shares the lifecycle allocator so trace and run events cannot collide when
 * viewed as a single run timeline.
 */
export async function claimRunRecoveryEventSequence(tenantId: number, runId: number): Promise<number | null> {
  const [run] = await db.update(agentRuns).set({
    recoveryEventSequence: sql`${agentRuns.recoveryEventSequence} + 1`,
  }).where(and(
    eq(agentRuns.id, runId),
    eq(agentRuns.tenantId, tenantId),
  )).returning({ recoveryEventSequence: agentRuns.recoveryEventSequence });
  return run?.recoveryEventSequence ?? null;
}

/**
 * Append one checkpoint or return the existing one if the same semantic
 * boundary was recorded already. The unique key makes retries safe without
 * allowing callers to mutate past evidence.
 */
export async function recordRecoveryCheckpoint(input: RecordRecoveryCheckpointInput): Promise<{
  recorded: boolean;
  checkpoint: RecoveryCheckpoint;
  record: StoredRecoveryCheckpoint | null;
}> {
  const checkpoint = buildRecoveryCheckpoint(input);
  if (!captureEnabled()) {
    console.info(`[recovery-manifest] capture disabled for ${checkpoint.eventType}`);
    return { recorded: false, checkpoint, record: null };
  }
  await verifyScopeOwnership(input.tenantId, checkpoint.scope);

  const [inserted] = await db.insert(agentRecoveryManifests).values({
    tenantId: input.tenantId,
    runId: checkpoint.scope.runId ?? null,
    conversationId: checkpoint.scope.conversationId ?? null,
    traceId: checkpoint.scope.traceId ?? null,
    schemaVersion: checkpoint.schemaVersion,
    eventType: checkpoint.eventType,
    eventIndex: checkpoint.eventIndex,
    stateHash: checkpoint.stateHash,
    payload: checkpoint.payload,
    nextCursor: checkpoint.nextCursor,
    idempotencyKey: checkpoint.idempotencyKey,
  }).onConflictDoNothing({
    target: [agentRecoveryManifests.tenantId, agentRecoveryManifests.idempotencyKey],
  }).returning();

  if (inserted) {
    console.info(`[recovery-manifest] recorded ${checkpoint.eventType} for tenant ${input.tenantId}`);
    return { recorded: true, checkpoint, record: inserted };
  }

  const [existing] = await db.select().from(agentRecoveryManifests).where(and(
    eq(agentRecoveryManifests.tenantId, input.tenantId),
    eq(agentRecoveryManifests.idempotencyKey, checkpoint.idempotencyKey),
  )).limit(1);
  if (!existing) {
    throw new Error("Recovery manifest idempotency conflict did not return a tenant-scoped record");
  }
  return { recorded: false, checkpoint, record: existing };
}

/**
 * Capture is recovery observability, never an execution or authorization gate.
 * Callers await this wrapper at a durable boundary so ordering is retained, but
 * a database incident cannot cause a duplicate side effect by failing the
 * already-persisted agent lifecycle transition.
 */
export async function recordRecoveryCheckpointSafely(
  input: RecordRecoveryCheckpointInput,
): Promise<StoredRecoveryCheckpoint | null> {
  try {
    return (await recordRecoveryCheckpoint(input)).record;
  } catch (error: unknown) {
    // Do not echo database/provider error text: it can include credentials or
    // raw statement values. The durable agent state is already committed; this
    // observability write remains deliberately non-blocking.
    console.warn(`[recovery-manifest] failed to record ${input.eventType} for tenant ${input.tenantId}; evidence was not recorded.${safeFailureCode(error)}`);
    return null;
  }
}

export async function listRecoveryCheckpoints(input: {
  tenantId: number;
  runId?: number;
  conversationId?: number;
  traceId?: string;
  limit?: number;
}): Promise<StoredRecoveryCheckpoint[]> {
  const filters = [eq(agentRecoveryManifests.tenantId, input.tenantId)];
  if (input.runId !== undefined) filters.push(eq(agentRecoveryManifests.runId, input.runId));
  if (input.conversationId !== undefined) filters.push(eq(agentRecoveryManifests.conversationId, input.conversationId));
  if (input.traceId !== undefined) filters.push(eq(agentRecoveryManifests.traceId, input.traceId));
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(input.limit ?? 50)));

  return db.select().from(agentRecoveryManifests)
    .where(and(...filters))
    .orderBy(desc(agentRecoveryManifests.createdAt), desc(agentRecoveryManifests.id))
    .limit(limit);
}

export async function getRecoveryCheckpoint(tenantId: number, id: number): Promise<StoredRecoveryCheckpoint | undefined> {
  const [record] = await db.select().from(agentRecoveryManifests).where(and(
    eq(agentRecoveryManifests.tenantId, tenantId),
    eq(agentRecoveryManifests.id, id),
  )).limit(1);
  return record;
}

/** Deterministic timeline order for an already tenant-scoped inspection record. */
export async function listRecoveryTimeline(input: {
  tenantId: number;
  runId?: number;
  conversationId?: number;
  traceId?: string;
  limit?: number;
}): Promise<StoredRecoveryCheckpoint[]> {
  const filters = [eq(agentRecoveryManifests.tenantId, input.tenantId)];
  if (input.runId !== undefined) filters.push(eq(agentRecoveryManifests.runId, input.runId));
  if (input.conversationId !== undefined) filters.push(eq(agentRecoveryManifests.conversationId, input.conversationId));
  if (input.traceId !== undefined) filters.push(eq(agentRecoveryManifests.traceId, input.traceId));
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(input.limit ?? 50)));

  return db.select().from(agentRecoveryManifests)
    .where(and(...filters))
    .orderBy(asc(agentRecoveryManifests.eventIndex), asc(agentRecoveryManifests.id))
    .limit(limit);
}