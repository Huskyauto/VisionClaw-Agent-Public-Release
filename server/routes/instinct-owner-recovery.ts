import { and, desc, eq, isNull } from "drizzle-orm";
import type { Express, Request, Response, RequestHandler } from "express";
import {
  apiV1ConversationRuns, conversations, instinctOutbox, instinctWebSubmissions,
  instinctWebThreads, messages,
} from "@shared/schema";
import { db } from "../db";
import { ADMIN_TENANT_ID } from "../auth";
import { ownerTenantId } from "../agentic/autonomous-budget";
import { acknowledgeInstinctFailureAsOwner } from "../lib/instinct-recovery";

const HISTORY_LIMIT = 40;
const OUTBOX_LIMIT = 40;
const MAX_HISTORY_CONTENT = 8_000;
const MAX_SUBMISSION_TEXT = 16_000;
const MAX_OUTBOX_TEXT = 4_000;

export interface InstinctOwnerRecoverySnapshot {
  thread: { state?: string; conversationId: number | null; updatedAt?: string | null } | null;
  run: { status: string; reason: string | null; failedAt: string | null } | null;
  latestFailure: { text: string; requestId: string; createdAt: string | null } | null;
  history: Array<{ id: number; role: string; content: string; createdAt: string }>;
  outbox: Array<{ id: number; message: string; createdAt: string }>;
}

export interface InstinctOwnerRecoveryPorts {
  authMiddleware: RequestHandler;
  getTenantFromRequestAsync(req: Request): Promise<number | null>;
  requirePlatformAdmin(req: Request, res: Response): boolean;
  isPlatformAdmin(req: Request): boolean;
  loadSnapshot(tenantId: number): Promise<InstinctOwnerRecoverySnapshot>;
  acknowledge(
    ownerContext: { tenantId: number; isAdmin: boolean },
    conversationId: number,
    failedAt: string,
  ): Promise<"resumed" | "duplicate" | "blocked">;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function loadCurrentInstinctSnapshot(tenantId: number): Promise<InstinctOwnerRecoverySnapshot> {
  const empty: InstinctOwnerRecoverySnapshot = {
    thread: null, run: null, latestFailure: null, history: [], outbox: [],
  };
  if (tenantId !== ownerTenantId()) return empty;

  const [thread] = await db.select({
    state: instinctWebThreads.state,
    conversationId: instinctWebThreads.conversationId,
    updatedAt: instinctWebThreads.updatedAt,
  }).from(instinctWebThreads).where(eq(instinctWebThreads.tenantId, tenantId)).limit(1);
  if (!thread) return empty;
  const savedThread = {
    state: thread.state,
    conversationId: thread.conversationId,
    updatedAt: iso(thread.updatedAt),
  };
  if (thread.state !== "ready" || !thread.conversationId) {
    return { ...empty, thread: savedThread };
  }

  // Revalidate the saved binding against this tenant before exposing any
  // history, receipts, or outbox rows. The client cannot choose a conversation.
  const [conversation] = await db.select({ id: conversations.id })
    .from(conversations)
    .where(and(
      eq(conversations.id, thread.conversationId),
      eq(conversations.tenantId, tenantId),
      isNull(conversations.deletedAt),
    )).limit(1);
  if (!conversation) return { ...empty, thread: savedThread };

  const [run, failedSubmission, recentHistory, recentOutbox] = await Promise.all([
    db.select({
      status: apiV1ConversationRuns.status,
      reason: apiV1ConversationRuns.failureReason,
      failedAt: apiV1ConversationRuns.failedAt,
    }).from(apiV1ConversationRuns).where(and(
      eq(apiV1ConversationRuns.tenantId, tenantId),
      eq(apiV1ConversationRuns.conversationId, thread.conversationId),
    )).limit(1),
    db.select({
      message: instinctWebSubmissions.message,
      requestId: instinctWebSubmissions.requestId,
      createdAt: instinctWebSubmissions.createdAt,
    }).from(instinctWebSubmissions).where(and(
      eq(instinctWebSubmissions.tenantId, tenantId),
      eq(instinctWebSubmissions.conversationId, thread.conversationId),
      eq(instinctWebSubmissions.state, "failed"),
    )).orderBy(desc(instinctWebSubmissions.id)).limit(1),
    db.select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    }).from(messages).where(and(
      eq(messages.tenantId, tenantId),
      eq(messages.conversationId, thread.conversationId),
    )).orderBy(desc(messages.id)).limit(HISTORY_LIMIT),
    db.select({
      id: instinctOutbox.id,
      message: instinctOutbox.message,
      createdAt: instinctOutbox.createdAt,
    }).from(instinctOutbox).where(and(
      eq(instinctOutbox.tenantId, tenantId),
      eq(instinctOutbox.conversationId, thread.conversationId),
    )).orderBy(desc(instinctOutbox.id)).limit(OUTBOX_LIMIT),
  ]);

  return {
    thread: savedThread,
    run: run[0] ? {
      status: run[0].status,
      reason: run[0].reason,
      failedAt: iso(run[0].failedAt),
    } : null,
    latestFailure: failedSubmission[0] ? {
      text: failedSubmission[0].message.slice(0, MAX_SUBMISSION_TEXT),
      requestId: failedSubmission[0].requestId,
      createdAt: iso(failedSubmission[0].createdAt),
    } : null,
    history: recentHistory.reverse().map(row => ({
      id: row.id,
      role: row.role,
      content: row.content.slice(0, MAX_HISTORY_CONTENT),
      createdAt: iso(row.createdAt) || "",
    })),
    outbox: recentOutbox.reverse().map(row => ({
      id: row.id,
      message: row.message.slice(0, MAX_OUTBOX_TEXT),
      createdAt: iso(row.createdAt) || "",
    })),
  };
}

function validFailedAt(value: unknown): value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

export function registerInstinctOwnerRecoveryRoutes(
  app: Express,
  supplied: Omit<InstinctOwnerRecoveryPorts, "loadSnapshot" | "acknowledge"> &
    Partial<Pick<InstinctOwnerRecoveryPorts, "loadSnapshot" | "acknowledge">>,
) {
  const ports: InstinctOwnerRecoveryPorts = {
    ...supplied,
    loadSnapshot: supplied.loadSnapshot ?? loadCurrentInstinctSnapshot,
    acknowledge: supplied.acknowledge ?? acknowledgeInstinctFailureAsOwner,
  };

  const resolveOwnerContext = async (req: Request, res: Response) => {
    const tenantId = await ports.getTenantFromRequestAsync(req);
    if (!tenantId) {
      res.status(401).json({ error: "Authentication required" });
      return null;
    }
    if (!ports.requirePlatformAdmin(req, res)) return null;
    if (tenantId !== ADMIN_TENANT_ID || !ports.isPlatformAdmin(req)) {
      if (!res.headersSent) res.status(403).json({ error: "Platform admin access required" });
      return null;
    }
    return { tenantId, isAdmin: true as const };
  };

  app.get("/api/admin/instinct-recovery", ports.authMiddleware, async (req, res) => {
    const ownerContext = await resolveOwnerContext(req, res);
    if (!ownerContext) return;
    try {
      const snapshot = await ports.loadSnapshot(ownerContext.tenantId);
      return res.json(snapshot);
    } catch (error) {
      console.error("[instinct-owner-recovery] snapshot read failed", error);
      return res.status(500).json({ error: "Failed to load Instinct recovery data. Please try again." });
    }
  });

  app.post("/api/admin/instinct-recovery/acknowledge", ports.authMiddleware, async (req, res) => {
    const ownerContext = await resolveOwnerContext(req, res);
    if (!ownerContext) return;
    const { acknowledge, conversationId, failedAt } = req.body || {};
    if (acknowledge !== "yes" || !Number.isSafeInteger(conversationId) || conversationId <= 0 ||
        !validFailedAt(failedAt)) {
      return res.status(400).json({
        error: "Explicit acknowledgement, a positive conversationId, and an exact failedAt timestamp are required.",
      });
    }
    try {
      const result = await ports.acknowledge(ownerContext, conversationId, failedAt);
      if (result === "blocked") {
        return res.status(409).json({ error: "The saved failure changed or is not safe to acknowledge." });
      }
      return res.json({ result });
    } catch (error) {
      console.error("[instinct-owner-recovery] acknowledgement failed", error);
      return res.status(500).json({ error: "Failed to acknowledge the saved Instinct failure. Please refresh and review status." });
    }
  });
}