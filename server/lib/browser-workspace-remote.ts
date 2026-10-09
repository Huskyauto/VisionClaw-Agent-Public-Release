import type { CamofoxParams, CamofoxResult } from "../camofox-tool";
import { WorkspaceError, type WorkspaceTarget } from "./browser-workspace";

type Remote = (params: CamofoxParams) => Promise<CamofoxResult>;
export function workspaceTabs(result: CamofoxResult) {
  if (!result.ok || !Array.isArray(result.tabs) || result.tabs.length > 512)
    throw new WorkspaceError("Browser tabs could not be verified. Human control is unchanged.", 502);
  return result.tabs.map((tab: any) => {
    const tabId = tab?.tabId ?? tab?.id ?? tab?.targetId;
    if (typeof tabId !== "string" || !/^[\w-]{1,160}$/.test(tabId))
      throw new WorkspaceError("Browser returned an invalid tab list. Refresh before acting.", 502);
    return { tabId, title: String(tab.title || "Browser tab").slice(0, 240),
      url: String(tab.url || "").slice(0, 2048) };
  });
}

export async function verifyWorkspaceHandback(tenantId: number, target: WorkspaceTarget,
  remote: Remote): Promise<void | "expired"> {
  const scope = { _tenantId: tenantId, _personaId: target.personaId, userIdSuffix: target.userIdSuffix };
  const page = await remote({ ...scope, action: "snapshot", tabId: target.tabId });
  if (page.ok && typeof page.snapshot === "string") return;
  if (page.ok || page.statusCode !== 404)
    throw new WorkspaceError("The browser could not be verified. Human control remains active.", 502);
  // Not an outage fallback: exact typed absence plus a fresh, strict empty list.
  const tabs = workspaceTabs(await remote({ ...scope, action: "list_tabs" }));
  if (tabs.length) throw new WorkspaceError("That tab closed or expired. Select a current tab and refresh before returning control.");
  return "expired";
}