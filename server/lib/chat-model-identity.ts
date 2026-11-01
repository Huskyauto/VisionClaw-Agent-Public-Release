/** Resolve picker identities without turning unknown IDs into a default model. */
export async function resolveChatModelInfo<T extends { id: string; provider: string }>(
  requestedId: string,
  registry: readonly T[],
  loadAuthorizedOwnerCatalog?: () => Promise<readonly T[]>,
): Promise<T | undefined> {
  const fixed = registry.find(model => model.id === requestedId);
  if (fixed) return fixed;
  if (!requestedId.startsWith("cheaperinference/") || !loadAuthorizedOwnerCatalog) return undefined;
  const catalog = await loadAuthorizedOwnerCatalog();
  return catalog.find(model => model.id === requestedId && model.provider === "cheaperinference");
}
