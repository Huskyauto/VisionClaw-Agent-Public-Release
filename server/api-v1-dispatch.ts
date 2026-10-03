import crypto from "node:crypto";
import { DEFAULT_CHAT_MODEL_ID } from "./chat-model-default";
import { processMessage, type ChatEngineResult } from "./chat-engine";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { claimApiV1Turn, finishApiV1Turn, registerApiV1Conversation } from "./spark-line";
import { withInstinctReadDraft } from "./lib/instinct-read-draft";
import { getFelixExpertFailureReason } from "./felix-expert-route";

export function invokeApiV1Process(
  process: typeof processMessage, tenantId: number, conversationId: number, message: string,
  instinctReadDraft?: true,
) {
  const run = () => process(conversationId, message, { tenantId, source: "api-v1" });
  return instinctReadDraft ? withInstinctReadDraft(run) : run();
}

export interface ApiV1Dispatch {
  conversationId: number;
  agentName: string | null;
  personaId: number | null;
  statusUrl: string;
  createdAt: string;
  requestId: string;
  model: string;
  turn: Promise<ChatEngineResult>;
}

/** Shared API-v1 dispatch implementation. `beforeLaunch` persists adapter state
 * after the run claim but before any model/tool work is scheduled. */
export async function dispatchApiV1Task(
  tenantId: number,
  input: { task: string; agent?: string; personaId?: number; title?: string; model?: string; async?: boolean },
  options: {
    process?: typeof processMessage;
    requestId?: string;
    beforeLaunch?: (dispatch: Omit<ApiV1Dispatch, "turn">) => Promise<void>;
    instinctReadDraft?: true;
  } = {},
): Promise<ApiV1Dispatch> {
  let personaId: number | null = input.personaId ?? null;
  let agentName: string | null = null;
  if (personaId !== null) {
    const persona = await storage.getPersona(personaId);
    if (!persona) throw Object.assign(new Error("Persona not found"), { status: 404 });
    agentName = persona.name;
  } else if (input.agent) {
    const result: any = await db.execute(sql`
      SELECT id, name FROM personas WHERE is_active = true AND LOWER(name) = LOWER(${input.agent}) LIMIT 1
    `);
    const persona = (result.rows || result)[0];
    if (!persona) throw Object.assign(new Error("Agent not found"), { status: 404 });
    personaId = Number(persona.id);
    agentName = String(persona.name);
  } else {
    const persona = await storage.getActivePersona();
    personaId = persona?.id ?? null;
    agentName = persona?.name ?? null;
  }

  const settings = await storage.getSettings();
  const model = input.model || settings?.defaultModel || DEFAULT_CHAT_MODEL_ID;
  const conversation = await storage.createConversation({
    title: input.title || `API: ${input.task.slice(0, 60)}${input.task.length > 60 ? "…" : ""}`,
    model,
    thinking: true, thinkingLevel: "auto", personaId, tenantId,
  });
  await registerApiV1Conversation(tenantId, conversation.id);
  if (!(await claimApiV1Turn(tenantId, conversation.id)))
    throw Object.assign(new Error("Conversation already has an active turn"), { status: 409 });

  const metadata = {
    conversationId: conversation.id,
    agentName, personaId,
    statusUrl: `/api/v1/conversations/${conversation.id}`,
    createdAt: new Date().toISOString(),
    requestId: options.requestId || `req_${Date.now().toString(36)}${crypto.randomBytes(5).toString("hex")}`,
    model,
  };
  await options.beforeLaunch?.(metadata);
  const process = options.process || processMessage;
  let resolveTurn!: (result: ChatEngineResult) => void;
  let rejectTurn!: (error: unknown) => void;
  const turn = new Promise<ChatEngineResult>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });
  queueMicrotask(() => {
    void invokeApiV1Process(process, tenantId, conversation.id, input.task, options.instinctReadDraft)
      .then(async result => {
        if (!(await finishApiV1Turn(tenantId, conversation.id, "complete")))
          throw new Error("API turn did not complete with a persisted reply");
        resolveTurn(result);
      })
      .catch(async err => {
        await finishApiV1Turn(
          tenantId, conversation.id, "failed", getFelixExpertFailureReason(err),
        ).catch(() => false);
        rejectTurn(err);
      });
  });
  return { ...metadata, model, turn };
}

/** Queue an already-claimed API-v1 follow-up without blocking the HTTP form POST. */
export function launchApiV1FollowUp(
  tenantId: number, conversationId: number, message: string,
  options: { process?: typeof processMessage; onSettled?: (state: "complete" | "failed") => Promise<void>; instinctReadDraft?: true } = {},
) {
  const process = options.process || processMessage;
  queueMicrotask(() => {
    void invokeApiV1Process(process, tenantId, conversationId, message, options.instinctReadDraft)
      .then(async () => {
        if (!(await finishApiV1Turn(tenantId, conversationId, "complete")))
          throw new Error("API turn did not complete with a persisted reply");
        await options.onSettled?.("complete");
      })
      .catch(async err => {
        await finishApiV1Turn(
          tenantId, conversationId, "failed", getFelixExpertFailureReason(err),
        ).catch(() => false);
        await options.onSettled?.("failed").catch(() => {});
        console.error("[api-v1] asynchronous turn failed", conversationId, err?.code || "processing-error");
      });
  });
}