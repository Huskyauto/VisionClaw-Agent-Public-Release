import type { ToolDefinition } from "../types";

export async function getAllToolDefinitions(
  definitions: ToolDefinition[],
  tenantId?: number,
): Promise<ToolDefinition[]> {
  try {
    const { getCustomToolDefinitions } = await import("../../tool-learning");
    const customDefs = await getCustomToolDefinitions(tenantId);
    return [...definitions, ...customDefs];
  } catch {
    return definitions;
  }
}