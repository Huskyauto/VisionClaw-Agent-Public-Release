/**
 * Model-round tool authorization helpers.
 *
 * The roster is supplied by the server from the exact tool definitions sent
 * with a model request. Copy it before any awaits so later mutation of a caller
 * owned array cannot change the authorization decision.
 */
export function snapshotAllowedToolNames(
  rosterWasSupplied: boolean,
  allowedToolNames: unknown,
): readonly string[] | undefined {
  if (!rosterWasSupplied) return undefined;
  if (!Array.isArray(allowedToolNames)
    || !allowedToolNames.every((name) => typeof name === "string" && name.length > 0)) {
    return Object.freeze([]);
  }
  return Object.freeze([...allowedToolNames]);
}

/** Read the roster from the exact request params about to be sent upstream. */
export function modelToolNamesFromRequestParams(params: unknown): string[] {
  if (!params || typeof params !== "object") return [];
  const definitions = (params as { tools?: unknown }).tools;
  if (!Array.isArray(definitions)) return [];
  return definitions
    .map((tool) => {
      if (!tool || typeof tool !== "object") return undefined;
      const definition = tool as { name?: unknown; function?: { name?: unknown } };
      return definition.function?.name ?? definition.name;
    })
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

/** Bind authorization to the precise params used by a completion request. */
export function requestWithModelToolRoster<T>(
  params: unknown,
  bindRoster: (toolNames: string[]) => void,
  request: () => T,
): T {
  bindRoster(modelToolNamesFromRequestParams(params));
  return request();
}

/** Calls without a model-round roster are explicit internal dispatches. */
export function isToolAllowedInModelRound(
  toolName: string,
  allowedToolNames: readonly string[] | undefined,
): boolean {
  return allowedToolNames === undefined || allowedToolNames.includes(toolName);
}

/**
 * Model-authored conversation scope is never authoritative. Preserve legacy
 * direct internal calls without a model roster; model calls receive both scope
 * spellings from the trusted context, including undefined when no scope exists.
 */
export function trustedConversationScope(
  conversationId: number | undefined,
  rosterWasSupplied: boolean,
): { conversationId?: number; _conversationId?: number } {
  return rosterWasSupplied ? { conversationId, _conversationId: conversationId } : {};
}