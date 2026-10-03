import { AsyncLocalStorage } from "node:async_hooks";

// Entered only by the trusted Instinct web dispatch, never by model arguments.
// All other Felix/API/web conversations retain their normal tool permissions.
const readDraftContext = new AsyncLocalStorage<boolean>();
// Bob's standing permission covers private coordination, not external outreach
// or business writes. The reply handler still enforces owner/Felix/content/rate
// gates; neither other bot outboxes nor approval/admin tools are included.
const ALLOWED_CHANNEL_TOOLS = new Set(["owner_business_overview", "instinct_send_message"]);

export function withInstinctReadDraft<T>(fn: () => T): T {
  return readDraftContext.run(true, fn);
}

export function isInstinctReadDraft(): boolean {
  return readDraftContext.getStore() === true;
}

export function instinctToolBlocked(name: string): boolean {
  return isInstinctReadDraft() && !ALLOWED_CHANNEL_TOOLS.has(name);
}