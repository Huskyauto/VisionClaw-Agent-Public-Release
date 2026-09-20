import { executeTool } from "../tools";

/**
 * Narrow dispatch seam for the owner-authenticated Built With Bob web-chat
 * shortcut. The tool name is intentionally fixed here; caller-controlled
 * names can never cross this boundary.
 */
export async function executeBwbWeeklyBuildFromOwnerWebChat(
  params: Record<string, unknown>,
): Promise<any> {
  return executeTool("bwb_weekly_build", params);
}