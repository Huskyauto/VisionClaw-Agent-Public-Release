import { AsyncLocalStorage } from "node:async_hooks";

/** Host-only input. Never deserialize this object from tool/model/API arguments. */
export interface ToolAuthority {
  tenantId: number;
  actor: "persona" | "external" | "system";
  invokedVia: string;
  personaId?: number;
  personaName?: string;
  conversationId?: number;
  projectId?: number;
  allowedPaths?: string[];
  rateLimitChecked?: boolean;
  approvalGranted?: boolean;
  skipTracking?: boolean;
  /** Required for non-persona service work; a server-owned operational purpose. */
  internalPurpose?: string;
  /** Host-owned compatibility hints, never the original model argument object. */
  metadata?: Readonly<Record<string, unknown>>;
}

const authority = new AsyncLocalStorage<Readonly<ToolAuthority>>();
/** Resolve only a legacy HOST persona name. Neither task data nor a service
 * name is an identity lookup channel; ambiguity fails closed. */
export async function resolveToolPersonaId(
  ctx: Pick<ToolAuthority, "actor" | "personaId" | "personaName">,
  lookup: () => Promise<readonly { id: number; name: string }[]>,
): Promise<number | undefined> {
  if (ctx.personaId !== undefined) {
    if (!Number.isSafeInteger(ctx.personaId) || ctx.personaId <= 0)
      throw new Error("Invalid trusted persona identity");
    return ctx.personaId;
  }
  if (ctx.actor !== "persona" || !ctx.personaName) return undefined;
  const matches = (await lookup()).filter(p => p.name === ctx.personaName);
  return matches.length === 1 && Number.isSafeInteger(matches[0].id) && matches[0].id > 0
    ? matches[0].id : undefined;
}

export function currentToolAuthority(): Readonly<ToolAuthority> | undefined {
  return authority.getStore();
}

function validate(ctx: ToolAuthority): void {
  if (!ctx || !Number.isSafeInteger(ctx.tenantId) || ctx.tenantId <= 0)
    throw new Error("Trusted tool authority requires a valid tenant");
  if (!["persona", "external", "system"].includes(ctx.actor))
    throw new Error("Trusted tool authority requires an explicit actor");
  if (typeof ctx.invokedVia !== "string" || !ctx.invokedVia.trim())
    throw new Error("Trusted tool authority requires a channel");
  for (const id of [ctx.personaId, ctx.conversationId, ctx.projectId]) {
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0))
      throw new Error("Trusted tool authority has an invalid identity");
  }
  if (ctx.allowedPaths !== undefined && (!Array.isArray(ctx.allowedPaths) ||
      ctx.allowedPaths.length > 128 || ctx.allowedPaths.some(p => typeof p !== "string" || p.length > 4096)))
    throw new Error("Trusted tool authority has invalid allowed paths");
  if (ctx.actor === "system" && (typeof ctx.internalPurpose !== "string" ||
      !ctx.internalPurpose.trim() || ctx.internalPurpose.length > 180))
    throw new Error("System authority requires an explicit internal purpose");
  if (ctx.actor !== "persona" && ["main_chat", "chat_engine", "auto-route"].includes(ctx.invokedVia))
    throw new Error("Only a persona actor may claim an owner-interactive channel");
}

export function snapshotToolAuthority(ctx: ToolAuthority): Readonly<ToolAuthority> {
  if (!ctx) throw new Error("Missing tool authority");
  const copy = { ...ctx };
  validate(copy);
  const snapshot = Object.freeze({
    ...copy, metadata: Object.freeze({ ...copy.metadata }),
    allowedPaths: copy.allowedPaths ? Object.freeze([...copy.allowedPaths]) as unknown as string[] : undefined,
  });
  validate(snapshot);
  return snapshot;
}

export function withToolAuthority<T>(ctx: ToolAuthority, fn: () => T): T {
  const snapshot = snapshotToolAuthority(ctx);
  return authority.run(snapshot, fn);
}

export function prepareToolInvocation(
  raw: Record<string, any> | null,
  ctx: ToolAuthority,
): Record<string | symbol, any> {
  validate(ctx);
  const data = Object.fromEntries(Object.entries(raw ?? {}).filter(([key]) =>
    !key.startsWith("_") && key !== "tenantId"));
  const result: Record<string | symbol, any> = {
    ...data, ...ctx.metadata,
    _tenantId: ctx.tenantId, _personaId: ctx.personaId,
    _conversationId: ctx.conversationId, _projectId: ctx.projectId,
    _allowedPaths: ctx.allowedPaths ? [...ctx.allowedPaths] : undefined,
    _invokedVia: ctx.invokedVia, _invokedByModel: ctx.actor !== "system",
    _rateLimitChecked: ctx.rateLimitChecked === true,
    _skipTracking: ctx.skipTracking === true,
    _selfHeal: ctx.invokedVia === "self_heal",
  };
  // Preserve opaque, non-JSON server receipts, never enumerable model symbols.
  for (const key of Object.getOwnPropertySymbols(raw ?? {})) {
    const descriptor = Object.getOwnPropertyDescriptor(raw!, key);
    if (descriptor && !descriptor.enumerable) Object.defineProperty(result, key, descriptor);
  }
  return result;
}
