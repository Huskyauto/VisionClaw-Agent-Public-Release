import { db } from "./db";
import { conversations, messages, agentSettings, skills, personas, memoryEntries, dailyNotes, providerKeys, heartbeatTasks, heartbeatLogs, agentKnowledge, conversationTemplates, customTools, experiments, deliveryLogs, fileStorage, tenants } from "@shared/schema";

import type {
  Conversation, InsertConversation, Message, InsertMessage,
  AgentSettings, InsertSettings, Skill, InsertSkill,
  Persona, InsertPersona, MemoryEntry, InsertMemoryEntry,
  DailyNote, InsertDailyNote, ProviderKey, InsertProviderKey,
  HeartbeatTask, InsertHeartbeatTask, HeartbeatLog, InsertHeartbeatLog,
  AgentKnowledge, InsertKnowledge,
  ConversationTemplate, InsertConversationTemplate,
  Tenant,
} from "@shared/schema";
import { eq, desc, and, sql, inArray, lte, gt, lt, isNull, or, ne } from "drizzle-orm";
import { getNextCronRun } from "./cron-utils";
import { encryptApiKey, decryptApiKey } from "./crypto";

const ADMIN_TENANT_ID = 1;

const knowledgeSafeCols = {
  id: agentKnowledge.id,
  title: agentKnowledge.title,
  content: agentKnowledge.content,
  category: agentKnowledge.category,
  priority: agentKnowledge.priority,
  personaId: agentKnowledge.personaId,
  tenantId: agentKnowledge.tenantId,
  source: agentKnowledge.source,
  embedding: agentKnowledge.embedding,
  expiresAt: agentKnowledge.expiresAt,
  createdAt: agentKnowledge.createdAt,
  updatedAt: agentKnowledge.updatedAt,
};

const memoryEntrySafeCols = {
  id: memoryEntries.id,
  fact: memoryEntries.fact,
  category: memoryEntries.category,
  source: memoryEntries.source,
  status: memoryEntries.status,
  personaId: memoryEntries.personaId,
  tenantId: memoryEntries.tenantId,
  accessCount: memoryEntries.accessCount,
  categoryId: memoryEntries.categoryId,
  embedding: memoryEntries.embedding,
  expiresAt: memoryEntries.expiresAt,
  deletedAt: memoryEntries.deletedAt,
  createdAt: memoryEntries.createdAt,
  lastAccessed: memoryEntries.lastAccessed,
};

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
}

export interface IStorage {
  getConversations(limit?: number, offset?: number): Promise<PaginatedResult<Conversation>>;
  getConversation(id: number): Promise<Conversation | undefined>;
  createConversation(data: InsertConversation): Promise<Conversation>;
  updateConversation(id: number, data: Partial<InsertConversation>): Promise<Conversation | undefined>;
  deleteConversation(id: number): Promise<void>;
  getMessages(conversationId: number): Promise<Message[]>;
  createMessage(data: InsertMessage): Promise<Message>;
  getSettings(): Promise<AgentSettings | undefined>;
  upsertSettings(data: InsertSettings): Promise<AgentSettings>;
  getSkills(): Promise<Skill[]>;
  getEnabledSkillsWithPrompts(personaId?: number | null): Promise<Skill[]>;
  createSkill(data: InsertSkill): Promise<Skill>;
  updateSkill(id: number, data: Partial<InsertSkill>): Promise<Skill | undefined>;
  deleteSkill(id: number): Promise<void>;
  getPersonas(): Promise<Persona[]>;
  getPersona(id: number): Promise<Persona | undefined>;
  getActivePersona(): Promise<Persona | undefined>;
  createPersona(data: InsertPersona): Promise<Persona>;
  updatePersona(id: number, data: Partial<InsertPersona>): Promise<Persona | undefined>;
  deletePersona(id: number): Promise<void>;
  setActivePersona(id: number): Promise<void>;
  getMemoryEntries(personaId?: number, limit?: number, offset?: number, tenantId?: number): Promise<PaginatedResult<MemoryEntry>>;
  getAllMemoriesForBackup(): Promise<MemoryEntry[]>;
  createMemoryEntry(data: InsertMemoryEntry): Promise<MemoryEntry>;
  updateMemoryEntry(id: number, data: Partial<InsertMemoryEntry>): Promise<MemoryEntry | undefined>;
  deleteMemoryEntry(id: number): Promise<void>;
  touchMemoryEntries(ids: number[]): Promise<void>;
  getDailyNotes(personaId?: number): Promise<DailyNote[]>;
  getDailyNote(date: string, personaId?: number): Promise<DailyNote | undefined>;
  upsertDailyNote(data: InsertDailyNote): Promise<DailyNote>;
  getProviderKeys(): Promise<ProviderKey[]>;
  getProviderKey(provider: string): Promise<ProviderKey | undefined>;
  upsertProviderKey(data: InsertProviderKey): Promise<ProviderKey>;
  deleteProviderKey(provider: string): Promise<void>;
  getKnowledge(personaId?: number, limit?: number, offset?: number, tenantId?: number): Promise<PaginatedResult<AgentKnowledge>>;
  createKnowledge(data: InsertKnowledge): Promise<AgentKnowledge>;
  updateKnowledge(id: number, data: Partial<InsertKnowledge>): Promise<AgentKnowledge | undefined>;
  deleteKnowledge(id: number): Promise<void>;
  updateMemoryEmbedding(id: number, embedding: number[]): Promise<void>;
  updateKnowledgeEmbedding(id: number, embedding: number[]): Promise<void>;
  getMemoriesWithoutEmbeddings(limit?: number): Promise<MemoryEntry[]>;
  getKnowledgeWithoutEmbeddings(limit?: number): Promise<AgentKnowledge[]>;
  archiveExpiredMemories(): Promise<number>;
  archiveStaleMemories(olderThanDays: number): Promise<number>;
  pruneHeartbeatLogs(keepCount: number): Promise<number>;
  getMemoryStats(personaId?: number, tenantId?: number): Promise<{ active: number; archived: number; total: number; byCategory: Record<string, number>; knowledgeCount: number }>;
  getRecentDailyNotes(days: number, personaId?: number): Promise<DailyNote[]>;
  getHeartbeatTasks(personaId?: number, tenantId?: number): Promise<HeartbeatTask[]>;
  getHeartbeatTask(id: number): Promise<HeartbeatTask | undefined>;
  createHeartbeatTask(data: InsertHeartbeatTask & { tenantId?: number }): Promise<HeartbeatTask | any>;
  updateHeartbeatTask(id: number, data: Partial<InsertHeartbeatTask>, tenantId?: number): Promise<HeartbeatTask | undefined>;
  deleteHeartbeatTask(id: number, tenantId?: number): Promise<void>;
  getDueHeartbeatTasks(): Promise<HeartbeatTask[]>;
  fixStaleBackupSchedules(): Promise<number>;
  markHeartbeatTaskRun(id: number, nextRunAt: Date): Promise<void>;
  getHeartbeatLogs(limit?: number, personaId?: number): Promise<HeartbeatLog[]>;
  createHeartbeatLog(data: InsertHeartbeatLog): Promise<HeartbeatLog>;
  getHeartbeatTasksByPersona(personaId: number): Promise<HeartbeatTask[]>;
  searchConversations(query: string, tenantId?: number): Promise<Array<Conversation & { snippet?: string }>>;
  getAllDataForExport(): Promise<any>;
  getConversationTemplates(): Promise<ConversationTemplate[]>;
  createConversationTemplate(data: InsertConversationTemplate): Promise<ConversationTemplate>;
  updateConversationTemplate(id: number, data: Partial<InsertConversationTemplate>): Promise<ConversationTemplate | undefined>;
  deleteConversationTemplate(id: number): Promise<void>;
  getAnalytics(): Promise<any>;
  getContextSummary(): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  async getTenant(id: number): Promise<Tenant | undefined> {
    const [t] = await db.select().from(tenants).where(eq(tenants.id, id));
    return t;
  }

  async updateTenant(id: number, data: Partial<Tenant>): Promise<Tenant | undefined> {
    const [t] = await db.update(tenants).set(data).where(eq(tenants.id, id)).returning();
    return t;
  }

  async getTenantConversationCount(tenantId: number): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(conversations).where(eq(conversations.tenantId, tenantId));
    return result.count;
  }

  async incrementTenantTrialUsage(tenantId: number): Promise<void> {
    await db.update(tenants).set({
      trialConversationsUsed: sql`${tenants.trialConversationsUsed} + 1`
    }).where(eq(tenants.id, tenantId));
  }

  async getConversations(limit = 50, offset = 0, tenantId?: number): Promise<PaginatedResult<Conversation>> {
    const conditions = [isNull(conversations.deletedAt)];
    if (tenantId) conditions.push(eq(conversations.tenantId, tenantId));
    const filter = and(...conditions);
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(conversations).where(filter);
    const total = countResult.count;
    const data = await db.select().from(conversations).where(filter).orderBy(desc(conversations.updatedAt)).limit(limit).offset(offset);
    return { data, total, hasMore: offset + data.length < total };
  }
  async getConversation(id: number) {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conv;
  }
  async createConversation(data: InsertConversation & { tenantId?: number }) {
    const [conv] = await db.insert(conversations).values(data).returning();
    return conv;
  }
  async updateConversation(id: number, data: Partial<InsertConversation>) {
    const [conv] = await db.update(conversations).set({ ...data, updatedAt: new Date() }).where(eq(conversations.id, id)).returning();
    return conv;
  }
  async deleteConversation(id: number) {
    await db.execute(sql`UPDATE conversations SET deleted_at = NOW(), deleted_by = 'user' WHERE id = ${id}`);
  }
  async getMessages(conversationId: number) {
    return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
  }
  async createMessage(data: InsertMessage) {
    const conv = await db.select({ tenantId: conversations.tenantId }).from(conversations).where(eq(conversations.id, data.conversationId)).limit(1);
    const convTenantId = conv[0]?.tenantId;
    if (!convTenantId) {
      console.error(`[createMessage] No conversation found for id=${data.conversationId}`);
      throw new Error("Conversation not found");
    }
    if (data.tenantId && data.tenantId !== convTenantId) {
      console.error(`[createMessage] tenant_id mismatch: caller=${data.tenantId} conv=${convTenantId} convId=${data.conversationId}`);
      throw new Error("Tenant mismatch");
    }
    const [msg] = await db.insert(messages).values({ ...data, tenantId: convTenantId }).returning();
    return msg;
  }
  async getSettings() {
    const [s] = await db.select().from(agentSettings).limit(1);
    return s;
  }
  async upsertSettings(data: InsertSettings) {
    const existing = await this.getSettings();
    if (existing) {
      const [s] = await db.update(agentSettings).set(data).where(eq(agentSettings.id, existing.id)).returning();
      return s;
    }
    const [s] = await db.insert(agentSettings).values(data).returning();
    return s;
  }
  async getSkills() {
    return db.select().from(skills).orderBy(skills.category, skills.name);
  }
  async getEnabledSkillsWithPrompts(personaId?: number | null) {
    const baseCondition = and(eq(skills.enabled, true), sql`${skills.promptContent} IS NOT NULL`);
    if (personaId) {
      return db.select().from(skills).where(and(baseCondition, or(isNull(skills.personaId), eq(skills.personaId, personaId))));
    }
    return db.select().from(skills).where(baseCondition);
  }
  async createSkill(data: InsertSkill) {
    const [skill] = await db.insert(skills).values(data).returning();
    return skill;
  }
  async updateSkill(id: number, data: Partial<InsertSkill>) {
    const [skill] = await db.update(skills).set(data).where(eq(skills.id, id)).returning();
    return skill;
  }
  async deleteSkill(id: number) {
    await db.delete(skills).where(eq(skills.id, id));
  }

  // ─── Personas ─────────────────────────────────────────────
  async getPersonas() {
    return db.select().from(personas).orderBy(desc(personas.isActive), personas.name);
  }
  async getPersona(id: number) {
    const [p] = await db.select().from(personas).where(eq(personas.id, id));
    return p;
  }
  async getActivePersona() {
    const [p] = await db.select().from(personas).where(eq(personas.isActive, true)).limit(1);
    return p;
  }
  async createPersona(data: InsertPersona) {
    if (data.isActive) {
      await db.update(personas).set({ isActive: false });
    }
    const [p] = await db.insert(personas).values(data).returning();
    return p;
  }
  async updatePersona(id: number, data: Partial<InsertPersona>) {
    if (data.isActive) {
      await db.update(personas).set({ isActive: false });
    }
    const [p] = await db.update(personas).set(data).where(eq(personas.id, id)).returning();
    return p;
  }
  async deletePersona(id: number) {
    await db.update(conversations).set({ personaId: null }).where(eq(conversations.personaId, id));
    await db.update(memoryEntries).set({ status: "superseded" }).where(eq(memoryEntries.personaId, id));
    await db.delete(dailyNotes).where(eq(dailyNotes.personaId, id));
    await db.delete(personas).where(eq(personas.id, id));
  }
  async setActivePersona(id: number) {
    const persona = await this.getPersona(id);
    if (!persona) throw new Error("Persona not found");
    await db.update(personas).set({ isActive: false });
    await db.update(personas).set({ isActive: true }).where(eq(personas.id, id));
  }

  // ─── Memory ─────────────────────────────────────────────
  async getMemoryEntries(personaId?: number, limit = 100, offset = 0, tenantId?: number): Promise<PaginatedResult<MemoryEntry>> {
    const conditions = [eq(memoryEntries.status, "active")];
    if (personaId) conditions.push(eq(memoryEntries.personaId, personaId));
    if (tenantId) conditions.push(eq(memoryEntries.tenantId, tenantId));
    const where = and(...conditions);
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(memoryEntries).where(where);
    const total = countResult.count;
    const data = await db.select(memoryEntrySafeCols).from(memoryEntries).where(where).orderBy(desc(memoryEntries.lastAccessed)).limit(limit).offset(offset);
    return { data, total, hasMore: offset + data.length < total };
  }
  async getAllMemoriesForBackup(): Promise<MemoryEntry[]> {
    return db.select(memoryEntrySafeCols).from(memoryEntries).orderBy(desc(memoryEntries.lastAccessed)) as any;
  }
  async getMemoryEntry(id: number) {
    const [entry] = await db.select(memoryEntrySafeCols).from(memoryEntries).where(eq(memoryEntries.id, id));
    return entry;
  }
  async createMemoryEntry(data: InsertMemoryEntry) {
    const [entry] = await db.insert(memoryEntries).values(data).returning();
    return entry;
  }
  async updateMemoryEntry(id: number, data: Partial<InsertMemoryEntry>) {
    const [entry] = await db.update(memoryEntries).set(data).where(eq(memoryEntries.id, id)).returning();
    return entry;
  }
  async deleteMemoryEntry(id: number) {
    await db.update(memoryEntries).set({ status: "superseded" }).where(eq(memoryEntries.id, id));
  }
  async touchMemoryEntries(ids: number[]) {
    if (ids.length === 0) return;
    await db.update(memoryEntries)
      .set({ lastAccessed: new Date(), accessCount: sql`${memoryEntries.accessCount} + 1` })
      .where(inArray(memoryEntries.id, ids));
  }

  // ─── Daily Notes ─────────────────────────────────────────
  async getDailyNotes(personaId?: number) {
    if (personaId) {
      return db.select().from(dailyNotes).where(eq(dailyNotes.personaId, personaId)).orderBy(desc(dailyNotes.date)).limit(30);
    }
    return db.select().from(dailyNotes).orderBy(desc(dailyNotes.date)).limit(30);
  }
  async getDailyNote(date: string, personaId?: number) {
    if (personaId) {
      const [note] = await db.select().from(dailyNotes).where(and(eq(dailyNotes.date, date), eq(dailyNotes.personaId, personaId)));
      return note;
    }
    const [note] = await db.select().from(dailyNotes).where(eq(dailyNotes.date, date));
    return note;
  }
  async upsertDailyNote(data: InsertDailyNote) {
    const existing = await this.getDailyNote(data.date, data.personaId ?? undefined);
    if (existing) {
      const [note] = await db.update(dailyNotes).set({ content: data.content, updatedAt: new Date() }).where(eq(dailyNotes.id, existing.id)).returning();
      return note;
    }
    const [note] = await db.insert(dailyNotes).values(data).returning();
    return note;
  }

  async getProviderKeys() {
    const keys = await db.select().from(providerKeys).orderBy(providerKeys.provider);
    return keys.map(k => ({ ...k, apiKey: decryptApiKey(k.apiKey) }));
  }
  async getProviderKey(provider: string) {
    const [key] = await db.select().from(providerKeys).where(eq(providerKeys.provider, provider));
    if (!key) return key;
    return { ...key, apiKey: decryptApiKey(key.apiKey) };
  }
  async upsertProviderKey(data: InsertProviderKey) {
    const encrypted = { ...data, apiKey: encryptApiKey(data.apiKey) };
    const existing = await this.getProviderKey(data.provider);
    if (existing) {
      const [key] = await db.update(providerKeys).set(encrypted).where(eq(providerKeys.id, existing.id)).returning();
      return { ...key, apiKey: decryptApiKey(key.apiKey) };
    }
    const [key] = await db.insert(providerKeys).values(encrypted).returning();
    return { ...key, apiKey: decryptApiKey(key.apiKey) };
  }
  async deleteProviderKey(provider: string) {
    await db.delete(providerKeys).where(eq(providerKeys.provider, provider));
  }

  async getTenantProviderKeys(tenantId: number) {
    const result = await db.execute(sql`
      SELECT * FROM tenant_provider_keys WHERE tenant_id = ${tenantId} ORDER BY provider
    `);
    const rows = (result as any).rows || [];
    return rows.map((k: any) => ({ ...k, api_key: decryptApiKey(k.api_key) }));
  }

  async getTenantProviderKey(tenantId: number, provider: string) {
    try {
      const result = await db.execute(sql`
        SELECT * FROM tenant_provider_keys WHERE tenant_id = ${tenantId} AND provider = ${provider} AND enabled = true
      `);
      const row = (result as any).rows?.[0];
      if (!row) return null;
      return { ...row, api_key: decryptApiKey(row.api_key) };
    } catch {
      return null;
    }
  }

  async upsertTenantProviderKey(tenantId: number, provider: string, apiKey: string, label?: string) {
    const encrypted = encryptApiKey(apiKey);
    const result = await db.execute(sql`
      INSERT INTO tenant_provider_keys (tenant_id, provider, api_key, enabled, label, updated_at)
      VALUES (${tenantId}, ${provider}, ${encrypted}, true, ${label || null}, NOW())
      ON CONFLICT (tenant_id, provider) DO UPDATE SET
        api_key = ${encrypted}, enabled = true, label = ${label || null},
        consecutive_failures = 0, last_error = NULL, updated_at = NOW()
      RETURNING *
    `);
    const row = (result as any).rows?.[0];
    return row ? { ...row, api_key: decryptApiKey(row.api_key) } : null;
  }

  async deleteTenantProviderKey(tenantId: number, provider: string) {
    await db.execute(sql`
      DELETE FROM tenant_provider_keys WHERE tenant_id = ${tenantId} AND provider = ${provider}
    `);
  }

  async markTenantKeyHealth(tenantId: number, provider: string, success: boolean, error?: string) {
    if (success) {
      await db.execute(sql`
        UPDATE tenant_provider_keys SET last_verified_at = NOW(), consecutive_failures = 0, last_error = NULL
        WHERE tenant_id = ${tenantId} AND provider = ${provider}
      `);
    } else {
      await db.execute(sql`
        UPDATE tenant_provider_keys SET consecutive_failures = consecutive_failures + 1, last_error = ${error || 'Unknown error'}
        WHERE tenant_id = ${tenantId} AND provider = ${provider}
      `);
    }
  }

  // ─── Knowledge Base ─────────────────────────────────────
  async getKnowledge(personaId?: number, limit = 100, offset = 0, tenantId?: number): Promise<PaginatedResult<AgentKnowledge>> {
    const notExpired = or(isNull(agentKnowledge.expiresAt), gt(agentKnowledge.expiresAt, new Date()));
    const conditions = [notExpired];
    if (personaId !== undefined) {
      conditions.push(or(eq(agentKnowledge.personaId, personaId), isNull(agentKnowledge.personaId)));
    }
    if (tenantId) conditions.push(eq(agentKnowledge.tenantId, tenantId));
    const where = and(...conditions);
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(agentKnowledge).where(where);
    const total = countResult.count;
    const data = await db.select(knowledgeSafeCols).from(agentKnowledge).where(where).orderBy(desc(agentKnowledge.priority), desc(agentKnowledge.updatedAt)).limit(limit).offset(offset);
    return { data, total, hasMore: offset + data.length < total };
  }
  async createKnowledge(data: InsertKnowledge) {
    const [entry] = await db.insert(agentKnowledge).values(data).returning();
    return entry;
  }
  async updateKnowledge(id: number, data: Partial<InsertKnowledge>) {
    const [entry] = await db.update(agentKnowledge).set({ ...data, updatedAt: new Date() }).where(eq(agentKnowledge.id, id)).returning();
    return entry;
  }
  async deleteKnowledge(id: number) {
    await db.delete(agentKnowledge).where(eq(agentKnowledge.id, id));
  }

  // ─── Embeddings ─────────────────────────────────────────
  async updateMemoryEmbedding(id: number, embedding: number[]) {
    await db.update(memoryEntries).set({ embedding }).where(eq(memoryEntries.id, id));
    try {
      const { storeEmbeddingVec } = await import("./embeddings");
      await storeEmbeddingVec("memory_entries", id, embedding);
    } catch {}
  }
  async updateKnowledgeEmbedding(id: number, embedding: number[]) {
    await db.update(agentKnowledge).set({ embedding }).where(eq(agentKnowledge.id, id));
    try {
      const { storeEmbeddingVec } = await import("./embeddings");
      await storeEmbeddingVec("agent_knowledge", id, embedding);
    } catch {}
  }
  async getMemoriesWithoutEmbeddings(limit = 50) {
    return db.select(memoryEntrySafeCols).from(memoryEntries)
      .where(and(eq(memoryEntries.status, "active"), isNull(memoryEntries.embedding)))
      .limit(limit);
  }
  async getKnowledgeWithoutEmbeddings(limit = 50) {
    const notExpired = or(isNull(agentKnowledge.expiresAt), gt(agentKnowledge.expiresAt, new Date()));
    return db.select(knowledgeSafeCols).from(agentKnowledge)
      .where(and(notExpired!, isNull(agentKnowledge.embedding)))
      .limit(limit);
  }

  // ─── Memory Lifecycle ─────────────────────────────────
  async archiveExpiredMemories() {
    try {
      const result = await db.execute(sql`
        UPDATE memory_entries SET status = 'archived'
        WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= NOW()
        RETURNING id
      `);
      const rows = (result as any).rows || result;
      return Array.isArray(rows) ? rows.length : 0;
    } catch (e: any) {
      console.warn("[memory] archiveExpiredMemories fallback:", e.message);
      return 0;
    }
  }
  async archiveStaleMemories(olderThanDays: number) {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const accessCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    try {
      const result = await db.execute(sql`
        UPDATE memory_entries SET status = 'archived'
        WHERE status = 'active' AND created_at <= ${cutoff} AND last_accessed <= ${accessCutoff}
        RETURNING id
      `);
      const rows = (result as any).rows || result;
      return Array.isArray(rows) ? rows.length : 0;
    } catch (e: any) {
      console.warn("[memory] archiveStaleMemories fallback:", e.message);
      return 0;
    }
  }
  async pruneHeartbeatLogs(keepCount: number) {
    const allLogs = await db.select({ id: heartbeatLogs.id }).from(heartbeatLogs).orderBy(desc(heartbeatLogs.createdAt));
    if (allLogs.length <= keepCount) return 0;
    const toDelete = allLogs.slice(keepCount).map(l => l.id);
    if (toDelete.length === 0) return 0;
    await db.delete(heartbeatLogs).where(inArray(heartbeatLogs.id, toDelete));
    return toDelete.length;
  }
  async getMemoryStats(personaId?: number, tenantId?: number) {
    const conditions = [];
    if (personaId !== undefined) conditions.push(eq(memoryEntries.personaId, personaId));
    if (tenantId !== undefined) conditions.push(eq(memoryEntries.tenantId, tenantId));
    const allMem = conditions.length > 0
      ? await db.select(memoryEntrySafeCols).from(memoryEntries).where(and(...conditions))
      : await db.select(memoryEntrySafeCols).from(memoryEntries);
    const active = allMem.filter(m => m.status === "active").length;
    const archived = allMem.filter(m => m.status === "archived" || m.status === "superseded").length;
    const byCategory: Record<string, number> = {};
    for (const m of allMem.filter(m => m.status === "active")) {
      byCategory[m.category] = (byCategory[m.category] || 0) + 1;
    }
    const knowledgeConditions = [];
    if (personaId !== undefined) knowledgeConditions.push(eq(agentKnowledge.personaId, personaId));
    if (tenantId !== undefined) knowledgeConditions.push(eq(agentKnowledge.tenantId, tenantId));
    const knowledge = knowledgeConditions.length > 0
      ? await db.select(knowledgeSafeCols).from(agentKnowledge).where(and(...knowledgeConditions))
      : await db.select(knowledgeSafeCols).from(agentKnowledge);
    const knowledgeCount = knowledge.filter(k => !k.expiresAt || k.expiresAt > new Date()).length;
    return { active, archived, total: allMem.length, byCategory, knowledgeCount };
  }
  async getRecentDailyNotes(days: number, personaId?: number) {
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      dates.push(d.toISOString().split("T")[0]);
    }
    if (personaId !== undefined) {
      return db.select().from(dailyNotes)
        .where(and(inArray(dailyNotes.date, dates), eq(dailyNotes.personaId, personaId)))
        .orderBy(desc(dailyNotes.date));
    }
    return db.select().from(dailyNotes)
      .where(inArray(dailyNotes.date, dates))
      .orderBy(desc(dailyNotes.date));
  }

  // ─── Heartbeat ──────────────────────────────────────────
  async getHeartbeatTasks(personaId?: number, tenantId?: number) {
    const conditions = [];
    if (personaId !== undefined) conditions.push(eq(heartbeatTasks.personaId, personaId));
    if (tenantId !== undefined) conditions.push(sql`${heartbeatTasks.id} IN (SELECT id FROM heartbeat_tasks WHERE tenant_id = ${tenantId})`);
    if (conditions.length > 0) {
      return db.select().from(heartbeatTasks).where(conditions.length > 1 ? and(...conditions) : conditions[0]).orderBy(heartbeatTasks.name);
    }
    return db.select().from(heartbeatTasks).orderBy(heartbeatTasks.name);
  }
  async getHeartbeatTasksByPersona(personaId: number) {
    return db.select().from(heartbeatTasks).where(eq(heartbeatTasks.personaId, personaId)).orderBy(heartbeatTasks.name);
  }
  async getHeartbeatTask(id: number) {
    const [task] = await db.select().from(heartbeatTasks).where(eq(heartbeatTasks.id, id));
    return task;
  }
  async createHeartbeatTask(data: InsertHeartbeatTask & { tenantId?: number; nextRunAt?: Date }) {
    const nextRun = data.nextRunAt || getNextCronRun(data.cronExpression || "*/30 * * * *");
    const tenantId = (data as any).tenantId;
    if (!tenantId) throw new Error("tenantId is required for heartbeat task creation");
    const result = await db.execute(sql`
      INSERT INTO heartbeat_tasks (name, description, type, cron_expression, enabled, prompt_content, model, persona_id, created_by, parent_task_id, run_once, next_run_at, tenant_id)
      VALUES (${data.name}, ${data.description || null}, ${data.type || 'general'}, ${data.cronExpression || '*/30 * * * *'}, ${data.enabled !== false}, ${data.promptContent || null}, ${data.model || 'gemini-2.5-flash'}, ${data.personaId || null}, ${data.createdBy || 'user'}, ${data.parentTaskId || null}, ${data.runOnce || false}, ${nextRun}, ${tenantId})
      RETURNING *
    `);
    return (result as any).rows?.[0] || result;
  }
  async updateHeartbeatTask(id: number, data: Partial<InsertHeartbeatTask>, tenantId?: number) {
    const updates: any = { ...data };
    if (data.cronExpression) {
      updates.nextRunAt = getNextCronRun(data.cronExpression);
    }
    const conditions = [eq(heartbeatTasks.id, id)];
    if (tenantId !== undefined) conditions.push(sql`${heartbeatTasks.id} IN (SELECT id FROM heartbeat_tasks WHERE tenant_id = ${tenantId})`);
    const [task] = await db.update(heartbeatTasks).set(updates).where(conditions.length > 1 ? and(...conditions) : conditions[0]).returning();
    return task;
  }
  async deleteHeartbeatTask(id: number, tenantId?: number) {
    const conditions = [eq(heartbeatTasks.id, id)];
    if (tenantId !== undefined) conditions.push(sql`${heartbeatTasks.id} IN (SELECT id FROM heartbeat_tasks WHERE tenant_id = ${tenantId})`);
    await db.delete(heartbeatTasks).where(conditions.length > 1 ? and(...conditions) : conditions[0]);
  }
  async fixStaleBackupSchedules(): Promise<number> {
    const result = await db.execute(sql`
      UPDATE heartbeat_tasks
      SET next_run_at = CASE
        WHEN cron_expression = '0 3 * * *' THEN
          (CURRENT_DATE + INTERVAL '1 day' + INTERVAL '3 hours')
        WHEN cron_expression = '0 */12 * * *' THEN
          (date_trunc('hour', NOW()) + INTERVAL '12 hours')
        ELSE NOW() + INTERVAL '1 hour'
      END
      WHERE type IN ('cloud_backup', 'memory_backup')
        AND enabled = true
        AND next_run_at < NOW()
      RETURNING id
    `);
    return ((result as any).rows || []).length;
  }
  async getDueHeartbeatTasks() {
    const result = await db.execute(sql`
      SELECT * FROM heartbeat_tasks
      WHERE enabled = true AND next_run_at <= NOW()
        AND COALESCE(approval_status, 'approved') = 'approved'
    `);
    return (result as any).rows || [];
  }
  async markHeartbeatTaskRun(id: number, nextRunAt: Date) {
    await db.update(heartbeatTasks)
      .set({ lastRunAt: new Date(), nextRunAt })
      .where(eq(heartbeatTasks.id, id));
  }
  async getHeartbeatLogs(limit = 50, personaId?: number) {
    if (personaId !== undefined) {
      return db.select().from(heartbeatLogs).where(eq(heartbeatLogs.personaId, personaId)).orderBy(desc(heartbeatLogs.createdAt)).limit(limit);
    }
    return db.select().from(heartbeatLogs).orderBy(desc(heartbeatLogs.createdAt)).limit(limit);
  }
  async createHeartbeatLog(data: InsertHeartbeatLog) {
    const [log] = await db.insert(heartbeatLogs).values(data).returning();
    return log;
  }

  async getConversationTemplates() {
    return db.select().from(conversationTemplates).orderBy(conversationTemplates.category, conversationTemplates.name);
  }
  async createConversationTemplate(data: InsertConversationTemplate) {
    const [t] = await db.insert(conversationTemplates).values(data).returning();
    return t;
  }
  async updateConversationTemplate(id: number, data: Partial<InsertConversationTemplate>) {
    const [t] = await db.update(conversationTemplates).set(data).where(eq(conversationTemplates.id, id)).returning();
    return t;
  }
  async deleteConversationTemplate(id: number) {
    await db.delete(conversationTemplates).where(eq(conversationTemplates.id, id));
  }

  async getAnalytics() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [msgPerDayRows, modelRows, hourlyRows, totalConvResult, totalMsgResult, toolMsgs, userMsgs] = await Promise.all([
      db.execute(sql`
        SELECT to_char(created_at, 'YYYY-MM-DD') as day, role, count(*)::int as cnt
        FROM messages WHERE created_at > ${thirtyDaysAgo}
        GROUP BY day, role ORDER BY day
      `),
      db.execute(sql`
        SELECT COALESCE(model, 'unknown') as model, count(*)::int as cnt
        FROM conversations GROUP BY model ORDER BY cnt DESC
      `),
      db.execute(sql`
        SELECT EXTRACT(HOUR FROM created_at)::int as hour, count(*)::int as cnt
        FROM messages WHERE created_at > ${thirtyDaysAgo} AND role = 'user'
        GROUP BY hour ORDER BY hour
      `),
      db.select({ count: sql<number>`count(*)::int` }).from(conversations),
      db.select({ count: sql<number>`count(*)::int` }).from(messages).where(gt(messages.createdAt, thirtyDaysAgo)),
      db.select({ content: messages.content }).from(messages)
        .where(and(gt(messages.createdAt, thirtyDaysAgo), eq(messages.role, "assistant"), sql`${messages.content} LIKE '<!-- tools:%'`)),
      db.select({ content: messages.content }).from(messages)
        .where(and(gt(messages.createdAt, thirtyDaysAgo), eq(messages.role, "user"))),
    ]);

    const messagesPerDay: Record<string, { user: number; assistant: number }> = {};
    for (const row of msgPerDayRows.rows as any[]) {
      if (!messagesPerDay[row.day]) messagesPerDay[row.day] = { user: 0, assistant: 0 };
      messagesPerDay[row.day][row.role as "user" | "assistant"] = row.cnt;
    }

    const modelUsage: Record<string, number> = {};
    for (const row of modelRows.rows as any[]) {
      modelUsage[row.model] = row.cnt;
    }

    const hourlyActivity: Record<number, number> = {};
    for (const row of hourlyRows.rows as any[]) {
      hourlyActivity[row.hour] = row.cnt;
    }

    const toolUsage: Record<string, number> = {};
    for (const msg of toolMsgs) {
      const toolMatch = msg.content.match(/^<!-- tools:(\[[\s\S]*?\]) -->/);
      if (toolMatch) {
        try {
          const tools = JSON.parse(toolMatch[1]);
          for (const t of tools) {
            toolUsage[t.name] = (toolUsage[t.name] || 0) + 1;
          }
        } catch {}
      }
    }

    const wordFreq: Record<string, number> = {};
    const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "about", "like", "after", "between", "out", "this", "that", "these", "those", "it", "its", "i", "me", "my", "you", "your", "we", "our", "they", "them", "their", "he", "she", "him", "her", "and", "or", "but", "not", "no", "so", "if", "then", "than", "just", "also", "very", "what", "how", "when", "where", "why", "who", "which", "all", "each", "some", "any", "more", "most"]);
    for (const msg of userMsgs) {
      const words = msg.content.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
      for (const word of words) {
        if (word.length > 3 && !stopWords.has(word)) {
          wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
      }
    }
    const topTopics = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));

    return {
      messagesPerDay,
      modelUsage,
      hourlyActivity,
      toolUsage,
      topTopics,
      totalConversations: totalConvResult[0].count,
      totalMessages: totalMsgResult[0].count,
      periodDays: 30,
    };
  }

  async getContextSummary() {
    const now = new Date();
    const hour = now.getHours();
    let greeting: string;
    if (hour < 12) greeting = "Good morning";
    else if (hour < 17) greeting = "Good afternoon";
    else greeting = "Good evening";

    const recentConvs = await db.select().from(conversations).where(sql`deleted_at IS NULL`).orderBy(desc(conversations.updatedAt)).limit(3);
    const activePersona = await this.getActivePersona();
    const memoryConditions = [eq(memoryEntries.status, "active")];
    if (activePersona) {
      memoryConditions.push(sql`(${memoryEntries.personaId} IS NULL OR ${memoryEntries.personaId} = ${activePersona.id})`);
    }
    const recentMemories = await db.select({
      fact: memoryEntries.fact,
      category: memoryEntries.category,
      createdAt: memoryEntries.createdAt,
    }).from(memoryEntries)
      .where(and(...memoryConditions))
      .orderBy(desc(memoryEntries.createdAt))
      .limit(5);

    const today = now.toISOString().split("T")[0];
    const todayNote = await this.getDailyNote(today, activePersona?.id);

    return {
      greeting,
      timestamp: now.toISOString(),
      lastConversations: recentConvs.map(c => ({ title: c.title, updatedAt: c.updatedAt })),
      activePersona: activePersona ? { name: activePersona.name, role: activePersona.role } : null,
      recentMemories: recentMemories.map(m => ({ fact: m.fact, category: m.category })),
      todayNotes: todayNote?.content?.slice(0, 300) || null,
    };
  }

  async searchConversations(query: string, tenantId?: number): Promise<Array<Conversation & { snippet?: string }>> {
    const pattern = `%${query}%`;
    const SEARCH_LIMIT = 200;

    const notDeletedFilter = sql`${conversations.deletedAt} IS NULL`;

    const msgConditions: any[] = [sql`${messages.content} ILIKE ${pattern}`];
    if (tenantId) {
      msgConditions.push(sql`${messages.conversationId} IN (SELECT id FROM ${conversations} WHERE ${conversations.tenantId} = ${tenantId} AND ${conversations.deletedAt} IS NULL)`);
    }
    const matchingMessages = await db
      .select({ conversationId: messages.conversationId, content: messages.content })
      .from(messages)
      .where(and(...msgConditions))
      .orderBy(desc(messages.createdAt))
      .limit(SEARCH_LIMIT);

    const snippetMap = new Map<number, string>();
    for (const row of matchingMessages) {
      if (!snippetMap.has(row.conversationId)) {
        const lowerContent = row.content.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const idx = lowerContent.indexOf(lowerQuery);
        if (idx >= 0) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(row.content.length, idx + query.length + 40);
          const snippet = (start > 0 ? "..." : "") + row.content.slice(start, end) + (end < row.content.length ? "..." : "");
          snippetMap.set(row.conversationId, snippet);
        }
      }
    }
    const convIds = [...snippetMap.keys()];

    const titleConditions: any[] = [sql`${conversations.title} ILIKE ${pattern}`, notDeletedFilter];
    if (tenantId) titleConditions.push(eq(conversations.tenantId, tenantId));
    const titleMatches = await db
      .select()
      .from(conversations)
      .where(and(...titleConditions))
      .orderBy(desc(conversations.updatedAt))
      .limit(50);

    const contentConditions: any[] = convIds.length > 0 ? [inArray(conversations.id, convIds), notDeletedFilter] : [notDeletedFilter];
    if (tenantId) contentConditions.push(eq(conversations.tenantId, tenantId));
    const contentMatches = convIds.length > 0
      ? await db.select().from(conversations).where(and(...contentConditions)).orderBy(desc(conversations.updatedAt)).limit(50)
      : [];

    const seen = new Set<number>();
    const results: Array<Conversation & { snippet?: string }> = [];
    for (const c of [...titleMatches, ...contentMatches]) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        results.push({ ...c, snippet: snippetMap.get(c.id) });
      }
    }
    return results;
  }

  async getAllDataForExport() {
    const [
      allConversations, allMessages, allPersonas, allMemories,
      allKnowledge, allSettings, allSkills, allDailyNotes,
      allProviderKeys, allTasks, allLogs, allTemplates,
      allCustomTools, allExperiments, allDeliveryLogs, allFiles,
    ] = await Promise.all([
      db.select().from(conversations).orderBy(desc(conversations.updatedAt)),
      db.select().from(messages).orderBy(messages.createdAt),
      db.select().from(personas),
      db.select(memoryEntrySafeCols).from(memoryEntries),
      db.select(knowledgeSafeCols).from(agentKnowledge),
      db.select().from(agentSettings).limit(1),
      db.select().from(skills),
      db.select().from(dailyNotes),
      db.select().from(providerKeys),
      db.select().from(heartbeatTasks),
      db.select().from(heartbeatLogs).orderBy(desc(heartbeatLogs.createdAt)).limit(500),
      db.select().from(conversationTemplates),
      db.select().from(customTools),
      db.select().from(experiments),
      db.select().from(deliveryLogs).orderBy(desc(deliveryLogs.createdAt)).limit(200),
      db.select({ id: fileStorage.id, filename: fileStorage.filename, mimeType: fileStorage.mimeType, size: fileStorage.size, createdAt: fileStorage.createdAt }).from(fileStorage),
    ]);

    const settingsObj = allSettings[0] || null;
    const sanitizedSettings = settingsObj ? {
      ...settingsObj,
      accessPin: settingsObj.accessPin ? "REDACTED" : null,
      discordBotToken: settingsObj.discordBotToken ? "REDACTED" : null,
    } : null;

    return {
      exportedAt: new Date().toISOString(),
      version: "2.0",
      tableCounts: {
        conversations: allConversations.length,
        messages: allMessages.length,
        personas: allPersonas.length,
        memoryEntries: allMemories.length,
        knowledge: allKnowledge.length,
        skills: allSkills.length,
        dailyNotes: allDailyNotes.length,
        heartbeatTasks: allTasks.length,
        heartbeatLogs: allLogs.length,
        conversationTemplates: allTemplates.length,
        customTools: allCustomTools.length,
        experiments: allExperiments.length,
        deliveryLogs: allDeliveryLogs.length,
        files: allFiles.length,
      },
      conversations: allConversations,
      messages: allMessages,
      personas: allPersonas,
      memoryEntries: allMemories,
      knowledge: allKnowledge,
      settings: sanitizedSettings,
      skills: allSkills,
      dailyNotes: allDailyNotes,
      providerKeys: allProviderKeys.map(k => ({ ...k, apiKey: "REDACTED" })),
      heartbeatTasks: allTasks,
      heartbeatLogs: allLogs,
      conversationTemplates: allTemplates,
      customTools: allCustomTools,
      experiments: allExperiments,
      deliveryLogs: allDeliveryLogs,
      fileManifest: allFiles,
    };
  }
}

export const storage = new DatabaseStorage();
