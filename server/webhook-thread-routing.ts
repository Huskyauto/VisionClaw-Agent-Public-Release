import { createHash } from "node:crypto";

export interface WebhookThreadScope {
  tenantId: number;
  triggerId: number;
  personaId: number | null;
  /** Server-owned configured name/scope snapshot, not a payload field. */
  configuration?: string;
}
export interface WebhookThreadIdentity {
  key: string;
  mode: "github-thread" | "trigger";
}

/** Payload fields select context ONLY, never tenant, persona, tools or authority. */
export function webhookThreadIdentity(scope: WebhookThreadScope, payload: unknown): WebhookThreadIdentity {
  for (const id of [scope.tenantId, scope.triggerId, ...(scope.personaId === null ? [] : [scope.personaId])]) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid webhook routing scope");
  }
  let thread = "generic";
  let mode: WebhookThreadIdentity["mode"] = "trigger";
  const body = payload as any;
  if (body && typeof body === "object" && !Array.isArray(body)
    && body.repository && (body.issue != null || body.pull_request != null)) {
    const repo = body.repository.full_name;
    const numbers = [body.issue, body.pull_request].filter((v) => v != null).map((v) => v.number);
    if (typeof repo !== "string" || repo.length > 140
      || !/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i.test(repo)
      || [".", ".."].includes(repo.split("/")[1])
      || numbers.some((n) => !Number.isSafeInteger(n) || n <= 0)
      || numbers.some((n) => n !== numbers[0])) {
      throw new Error("Invalid webhook thread identity");
    }
    // GitHub issues and PRs share one repository number namespace.
    thread = `github:${repo.toLowerCase()}#${numbers[0]}`;
    mode = "github-thread";
  }
  return {
    mode,
    key: createHash("sha256").update(JSON.stringify([
      "webhook-thread-v1", scope.tenantId, scope.triggerId, scope.personaId, scope.configuration ?? "", thread,
    ])).digest("hex"),
  };
}

export const MAX_WEBHOOK_THREAD_BINDINGS = 128;
export interface WebhookConversationStore {
  read(id: number): Promise<{ tenantId: number; personaId: number | null; deletedAt?: unknown } | undefined>;
  create(): Promise<number>;
  save(bindings: Record<string, number>): Promise<void>;
}

/** Caller holds the trigger row lock and commits creation + binding atomically. */
export async function resolveBoundWebhookConversation(
  scope: WebhookThreadScope, key: string, stored: unknown, store: WebhookConversationStore,
): Promise<number> {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)
    || !/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid webhook routing state");
  const entries = Object.entries(stored);
  if (entries.length > MAX_WEBHOOK_THREAD_BINDINGS || entries.some(([k, v]) =>
    !/^[a-f0-9]{64}$/.test(k) || !Number.isSafeInteger(v) || v <= 0)) {
    throw new Error("Invalid webhook routing state");
  }
  const bindings = Object.fromEntries(entries) as Record<string, number>;
  const id = bindings[key];
  if (id !== undefined) {
    const conversation = await store.read(id);
    if (!conversation || conversation.deletedAt || conversation.tenantId !== scope.tenantId
      || conversation.personaId !== scope.personaId) {
      // A deletion or manual reassignment is not permission to revive/replace it.
      throw new Error("Webhook thread conversation unavailable; review the trigger");
    }
    return id;
  }
  if (entries.length >= MAX_WEBHOOK_THREAD_BINDINGS) {
    throw new Error("Webhook thread capacity reached; use a separate configured trigger");
  }
  const created = await store.create();
  if (!Number.isSafeInteger(created) || created <= 0) throw new Error("Invalid webhook conversation");
  await store.save({ ...bindings, [key]: created });
  return created;
}
