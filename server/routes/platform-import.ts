import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { resolveImportedTenant, resolveImportedPersona } from "../lib/import-tenant-authority";

/** Full-system restore: authorized existing tenant destinations remain intact. */
export function registerPlatformImportRoute(app: Express, helpers: {
  requireAdmin: (req: Request, res: Response) => boolean;
  getTenantFromRequest: (req: Request) => number | null;
}) {
  app.post("/api/import", async (req, res) => {
    if (!helpers.requireAdmin(req, res)) return;
    const data = req.body;
    const sections = ["personas", "memoryEntries", "knowledge", "conversations", "messages", "heartbeatTasks"];
    if (!data || !data.version || sections.some(key => data[key] !== undefined && !Array.isArray(data[key]))) {
      return res.status(400).json({ error: "Invalid export file format" });
    }
    try {
      const owner = helpers.getTenantFromRequest(req);
      if (!owner) return res.status(401).json({ error: "Authentication required" });
      const tenants = await db.execute(sql`SELECT id FROM tenants`);
      const authorized = new Set<number>(((tenants as any).rows ?? tenants).map((row: any) => Number(row.id)));
      const existing = await db.execute(sql`SELECT id FROM personas`);
      const existingPersonas = new Set<number>(((existing as any).rows ?? existing).map((row: any) => Number(row.id)));
      const destination = (row: any) => resolveImportedTenant(row.tenantId, owner, authorized);
      const imported = { conversations: 0, messages: 0, personas: 0, memories: 0, knowledge: 0, tasks: 0 };
      const rejected = { ...imported };
      const personaIds = new Map<number, number>();
      const sourcePersonaIds = new Set<number>((data.personas ?? []).map((p: any) => p?.id)
        .filter((id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id > 0));
      const persona = (id: unknown) => resolveImportedPersona(id, sourcePersonaIds, personaIds, existingPersonas);
      const handledMessages = new Set<any>();
      const sourceConversations = new Set<number>();

      for (const p of data.personas ?? []) {
        try {
          const { id, isActive, createdAt, ...rest } = p;
          if (!Number.isSafeInteger(id) || id <= 0 || personaIds.has(id)) throw new Error("Invalid source persona identity");
          const created = await storage.createPersona(rest);
          if (Number.isSafeInteger(id)) personaIds.set(id, created.id);
          imported.personas++;
        } catch { rejected.personas++; console.warn("[platform-import] rejected a persona record"); }
      }
      for (const m of data.memoryEntries ?? []) {
        try {
          const target = destination(m);
          const { id, createdAt, ...rest } = m;
          await storage.createMemoryEntry({ ...rest, personaId: persona(rest.personaId), tenantId: target });
          imported.memories++;
        } catch { rejected.memories++; console.warn("[platform-import] rejected a memory record"); }
      }
      for (const k of data.knowledge ?? []) {
        try {
          const target = destination(k);
          const { id, createdAt, updatedAt, ...rest } = k;
          await storage.createKnowledge({ ...rest, personaId: persona(rest.personaId), tenantId: target });
          imported.knowledge++;
        } catch { rejected.knowledge++; console.warn("[platform-import] rejected a knowledge record"); }
      }
      for (const conv of data.conversations ?? []) {
        try {
          const target = destination(conv);
          const { id: oldId, createdAt, updatedAt, ...rest } = conv;
          if (!Number.isSafeInteger(oldId) || oldId <= 0 || sourceConversations.has(oldId)) throw new Error("Invalid source conversation identity");
          sourceConversations.add(oldId);
          const created = await storage.createConversation({ ...rest, personaId: persona(rest.personaId), tenantId: target });
          imported.conversations++;
          for (const msg of (data.messages ?? []).filter((m: any) => m?.conversationId === oldId && !handledMessages.has(m))) {
            handledMessages.add(msg);
            try {
              if (destination(msg) !== target) throw new Error("Message source tenant does not match its conversation");
              const { id, createdAt, ...msgRest } = msg;
              await storage.createMessage({ ...msgRest, conversationId: created.id, tenantId: target });
              imported.messages++;
            } catch { rejected.messages++; console.warn("[platform-import] rejected a message record"); }
          }
        } catch { rejected.conversations++; console.warn("[platform-import] rejected a conversation record"); }
      }
      // Orphans and children of rejected conversations are failures, not success.
      for (const message of data.messages ?? [])
        if (!handledMessages.has(message)) rejected.messages++;
      for (const task of data.heartbeatTasks ?? []) {
        try {
          const target = destination(task);
          const { id, createdAt, lastRunAt, nextRunAt, ...rest } = task;
          await storage.createHeartbeatTask({ ...rest, personaId: persona(rest.personaId), tenantId: target });
          imported.tasks++;
        } catch { rejected.tasks++; console.warn("[platform-import] rejected a task record"); }
      }
      res.json({ success: Object.values(rejected).every(count => count === 0), imported, rejected });
    } catch {
      // Do not expose SQL parameters or imported document values in errors.
      console.error("[platform-import] import could not complete");
      res.status(500).json({ error: "Import could not complete" });
    }
  });
}
