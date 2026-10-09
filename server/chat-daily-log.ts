import { storage } from "./storage";
import { logSilentCatch } from "./lib/silent-catch";

export async function updateDailyLog(conversationTitle: string, personaId: number | null | undefined, source: string | undefined, tenantId: number) {
  if (typeof tenantId !== "number" || !Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error("updateDailyLog: positive tenantId is required");
  }
  try {
    const today = new Date().toISOString().split("T")[0];
    const existing = await storage.getDailyNote(today, personaId ?? undefined, tenantId);
    const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    const sourceLabel = source ? ` [${source}]` : "";
    const entry = `- ${time}: Conversation "${conversationTitle}"${sourceLabel}`;
    const content = existing?.content ? `${existing.content}\n${entry}` : `# ${today}\n\n## Activity Log\n${entry}`;
    await storage.upsertDailyNote({ date: today, content, personaId: personaId ?? null, tenantId } as any);
  } catch (_silentErr) { logSilentCatch("server/chat-engine.ts", _silentErr); }
}