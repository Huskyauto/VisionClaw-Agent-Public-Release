let isHeartbeatRunning: (() => boolean) | null = null;
let delegateTaskFromChat: ((...args: any[]) => Promise<any>) | null = null;

export async function getHeartbeatFns() {
  if (!delegateTaskFromChat) {
    const mod = await import("../../heartbeat");
    isHeartbeatRunning = mod.isHeartbeatRunning;
    delegateTaskFromChat = mod.delegateTaskFromChat;
  }
  return { isHeartbeatRunning: isHeartbeatRunning!, delegateTaskFromChat: delegateTaskFromChat! };
}

export function errorMessage(error: unknown, fallback = "Unknown error"): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
}

export function errorMessageSlice(error: unknown, end: number, fallback = "Unknown error"): string {
  return errorMessage(error, fallback).slice(0, end);
}

export const PROVIDERS_SUPPORTING_TOOLS = new Set(["replit", "openai", "anthropic", "google", "xai", "openrouter"]);