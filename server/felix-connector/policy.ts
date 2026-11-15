import { z } from "zod";
import { sanitizeAgentOutput } from "../safety-layer";
import { stripThinkTags } from "../lib/strip-think-tags";

export const FELIX_TOOLS = [
  "felix_get_thread", "felix_list_messages", "felix_check_outbox",
  "felix_ack_outbox", "felix_send_message", "felix_get_turn",
] as const;
export type FelixTool = typeof FELIX_TOOLS[number];
export const FELIX_SCOPES = ["felix:read", "felix:write"];
export function connectorEnabled() { return process.env.FELIX_MCP_ENABLED !== "0"; }
export function connectorScopes(scopes: string[]) {
  if (!Array.isArray(scopes) || scopes.some(s => !FELIX_SCOPES.includes(s))) throw new Error("invalid_scope");
  return scopes.length ? [...new Set(scopes)] : [...FELIX_SCOPES];
}
export function validConnectorRedirect(raw: string, development: boolean) {
  try {
    const u = new URL(raw);
    if (u.username || u.password || u.hash) return false;
    if (u.protocol === "https:" && !u.port && ["claude.ai", "claude.com"].includes(u.hostname)) return true;
    return development && u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch { return false; }
}
export const sendSchema = z.object({
  message: z.string().min(1).max(16000).refine(s => s.trim().length > 0, "message must not be blank"),
  idempotency_key: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "UUID v4 required"),
}).strict();
export function validateConnectorSend(input: unknown) {
  const parsed = sendSchema.parse(input);
  if (sanitizeAgentOutput(parsed.message).redacted) throw new Error("credential_content_rejected");
  return parsed;
}
export function wrapFelixText(content: string) {
  return { author: "felix" as const, untrusted: true as const, content: sanitizeAgentOutput(stripThinkTags(content)).content };
}
