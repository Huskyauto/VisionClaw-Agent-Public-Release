import { createHash } from "node:crypto";

type PilotContext = {
  tenantId?: number; personaId?: number; conversationId?: number; invokedVia?: string;
};
const receiptKey = Symbol("guarded-business-pilot");
const receipts = new WeakMap<object, { tenantId: number; personaId: number; conversationId: number; invokedVia: string; digest: string }>();
const digest = (args: Record<string, unknown>) => createHash("sha256")
  .update(JSON.stringify(Object.fromEntries(Object.entries(args).filter(([key]) => !key.startsWith("_"))))).digest("hex");
const denied = () => new Error("Business pilots require an interactive owner conversation with Felix or Forge through the guarded executor");
function enabled() {
  if (process.env.BUSINESS_PILOT_AGENT_ACCESS === "off") throw new Error("Agent pilot access is disabled by the operator");
}

/** Host-only call site: executeGuardedTool. Model-visible fields cannot mint receipts. */
export function authorizePilotInvocation(args: Record<string, unknown>, ctx: PilotContext): void {
  enabled();
  const owner = Number(process.env.ADMIN_TENANT_ID || 1);
  if (!Number.isSafeInteger(owner) || owner < 1 || ctx.tenantId !== owner ||
      ![2, 3].includes(ctx.personaId ?? 0) || !Number.isSafeInteger(ctx.conversationId) ||
      ctx.conversationId! < 1 || !["main_chat", "chat_engine"].includes(ctx.invokedVia ?? "")) throw denied();
  const token = Object.freeze({});
  receipts.set(token, { tenantId: owner, personaId: ctx.personaId!, conversationId: ctx.conversationId!, invokedVia: ctx.invokedVia!, digest: digest(args) });
  Object.defineProperty(args, receiptKey, { value: token, enumerable: false });
}

export function requirePilotInvocation(args: Record<string, unknown>, ctx: PilotContext): void {
  enabled();
  const token = (args as any)[receiptKey];
  const receipt = token && receipts.get(token);
  if (!receipt || receipt.tenantId !== ctx.tenantId || receipt.personaId !== ctx.personaId ||
      receipt.conversationId !== ctx.conversationId || receipt.invokedVia !== ctx.invokedVia ||
      !["main_chat", "chat_engine"].includes(ctx.invokedVia ?? "") || receipt.digest !== digest(args)) throw denied();
}
