/** External JSON is task data, never an internal authority channel. New private
 * markers are rejected by default, not added to an ever-growing denylist. */
export function externalToolArguments(
  raw: Record<string, unknown>, tenantId: number,
): Record<string, any> {
  if (!Number.isSafeInteger(tenantId) || tenantId < 1) {
    throw new Error("Authenticated tenant context required");
  }
  const args = Object.fromEntries(Object.entries(raw).filter(([key]) =>
    !key.startsWith("_") && key !== "tenantId"));
  return {
    ...args, _tenantId: tenantId,
    _invokedVia: "mcp-server", _invokedByModel: true,
  };
}
