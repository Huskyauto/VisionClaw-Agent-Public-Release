import { executeTool } from "../tools";
import { ADMIN_TENANT_ID } from "../tenant-constants";

/**
 * Narrow dispatch seam for the owner-authenticated Built With Bob web-chat
 * shortcut. The tool name is intentionally fixed here; caller-controlled
 * names can never cross this boundary.
 */
export async function executeBwbWeeklyBuildFromOwnerWebChat(
  params: Record<string, unknown>,
): Promise<any> {
  return executeTool("bwb_weekly_build", params, {
    tenantId: ADMIN_TENANT_ID, actor: "persona", personaId: 2,
    personaName: "Felix", invokedVia: "main_chat",
    metadata: { _launchKey: params._launchKey },
  });
}