import { db } from "./db";
import { conversations, messages, agentSettings, skills, personas, memoryEntries, conversationFacts, dailyNotes, providerKeys, heartbeatTasks, heartbeatLogs, agentKnowledge, conversationTemplates, customTools, experiments, deliveryLogs, fileStorage, tenants, tensions, architectureDecisions } from "@shared/schema";
import type { Tension, InsertTension, ArchitectureDecision, InsertArchitectureDecision } from "@shared/schema";

import type {
  Conversation, InsertConversation, Message, InsertMessage,
  AgentSettings, InsertSettings, Skill, InsertSkill,
  Persona, InsertPersona, MemoryEntry, InsertMemoryEntry, ConversationFact, InsertConversationFact,
  DailyNote, InsertDailyNote, ProviderKey, InsertProviderKey,
  HeartbeatTask, InsertHeartbeatTask, HeartbeatLog, InsertHeartbeatLog,
  AgentKnowledge, InsertKnowledge,
  ConversationTemplate, InsertConversationTemplate,
  Tenant,
} from "@shared/schema";
import { eq, desc, and, sql, inArray, lte, gt, lt, isNull, or, ne } from "drizzle-orm";
import { getNextCronRun } from "./cron-utils";
import { encryptApiKey, decryptApiKey } from "./crypto";
import { logSilentCatch } from "./lib/silent-catch";
// R74.13g — fail-closed tenant scoping. Replaces the truthy-check pattern
// `if (tenantId) conditions.push(...)` which silently treated 0/NaN/null as
// "no scoping" (same bug class Furrow flagged BLOCKING in agentic-engines.ts).
import { tenantScope, assertValidTenantId } from "./storage-helpers/tenant-scope";

const ADMIN_TENANT_ID = 1;

// Tracks unscoped storage callsites once per (function, callsite) so an
// unintentionally tenant-omitted call surfaces in logs without spamming.
// Helps catch the next "I forgot to pass tenantId" bug before it becomes a
// cross-tenant leak. Set STRICT_TENANT_SCOPE=true to throw instead of warn.
const _unscopedSeen = new Set<string>();
function _warnUnscoped(fn: string, id: number | string): void {
  const callerLine = (new Error().stack || "").split("\n").slice(3, 5).join(" | ").slice(0, 240);
  const key = `${fn}:${callerLine}`;
  if (_unscopedSeen.has(key)) return;
  _unscopedSeen.add(key);
  const msg = `[storage] ${fn}(${id}) called WITHOUT tenantId — defense-in-depth scope is bypassed. Caller: ${callerLine}`;
  if (process.env.STRICT_TENANT_SCOPE === "true") {
    throw new Error(msg);
  }
  console.warn(msg);
}

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

// R74.13k F4-followup — exported so server/routes/memory.ts can use the SAME
// projection in its batch /:id/links query (was returning full table columns,
// changing the response shape clients depended on). Curated subset is the
// canonical "safe to expose" memory-entry shape; keep this list authoritative.
export const memoryEntrySafeCols = {
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
  confidence: memoryEntries.confidence,
  confidenceSource: memoryEntries.confidenceSource,
  createdAt: memoryEntries.createdAt,
  lastAccessed: memoryEntries.lastAccessed,
  // R116 — agentmemory N2/N7. Ranker reads these on every retrieval path;
  // omitting them silently degraded Ebbinghaus decay + quality-score down-ranking
  // (architect post-R116 MEDIUM #1).
  lastReinforcedAt: memoryEntries.lastReinforcedAt,
  qualityScore: memoryEntries.qualityScore,
};

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
}

export interface IStorage {
  getConversations(limit?: number, offset?: number): Promise<PaginatedResult<Conversation>>;
  getConversation(id: number, tenantId?: number): Promise<Conversation | undefined>;
  createConversation(data: InsertConversation): Promise<Conversation>;
  updateConversation(id: number, data: Partial<InsertConversation>, tenantId?: number): Promise<Conversation | undefined>;
  deleteConversation(id: number, tenantId?: number): Promise<void>;
  getMessages(conversationId: number, tenantId?: number): Promise<Message[]>;
  createMessage(data: InsertMessage): Promise<Message>;
  getSettings(): Promise<AgentSettings | undefined>;
  upsertSettings(data: InsertSettings): Promise<AgentSettings>;
  getSkills(): Promise<Skill[]>;
  getEnabledSkillsWithPrompts(personaId?: number | null, disabledSkillNames?: string[] | null): Promise<Skill[]>;
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
  // R112.15 — L2 session memory
  getConversationFacts(conversationId: number, tenantId: number, limit?: number): Promise<ConversationFact[]>;
  createConversationFact(data: InsertConversationFact): Promise<ConversationFact>;
  touchConversationFacts(ids: number[], tenantId: number): Promise<void>;
  countConversationFacts(conversationId: number, tenantId: number): Promise<number>;
  evictOldestConversationFacts(conversationId: number, tenantId: number, keep?: number): Promise<void>;
  getAllMemoriesForBackup(): Promise<MemoryEntry[]>;
  createMemoryEntry(data: InsertMemoryEntry): Promise<MemoryEntry>;
  updateMemoryEntry(id: number, data: Partial<InsertMemoryEntry>): Promise<MemoryEntry | undefined>;
  deleteMemoryEntry(id: number): Promise<void>;
  touchMemoryEntries(ids: number[]): Promise<void>;
  getDailyNotes(personaId?: number): Promise<DailyNote[]>;
  getDailyNote(date: string, personaId?: number, tenantId?: number): Promise<DailyNote | undefined>;
  upsertDailyNote(data: InsertDailyNote): Promise<DailyNote>;
  getProviderKeys(): Promise<ProviderKey[]>;
  getProviderKey(provider: string): Promise<ProviderKey | undefined>;
  upsertProviderKey(data: InsertProviderKey): Promise<ProviderKey>;
  deleteProviderKey(provider: string): Promise<void>;
  getKnowledge(personaId?: number, limit?: number, offset?: number, tenantId?: number): Promise<PaginatedResult<AgentKnowledge>>;
  createKnowledge(data: InsertKnowledge): Promise<AgentKnowledge>;
  // R74.13d C3: tenantId is mandatory to prevent cross-tenant knowledge mutation/deletion.
  updateKnowledge(id: number, data: Partial<InsertKnowledge>, tenantId: number): Promise<AgentKnowledge | undefined>;
  deleteKnowledge(id: number, tenantId: number): Promise<void>;
  updateMemoryEmbedding(id: number, embedding: number[]): Promise<void>;
  updateKnowledgeEmbedding(id: number, embedding: number[]): Promise<void>;
  getMemoriesWithoutEmbeddings(limit?: number): Promise<MemoryEntry[]>;
  getKnowledgeWithoutEmbeddings(limit?: number): Promise<AgentKnowledge[]>;
  archiveExpiredMemories(): Promise<number>;
  archiveStaleMemories(olderThanDays: number): Promise<number>;
  pruneHeartbeatLogs(keepCount: number): Promise<number>;
  getMemoryStats(personaId?: number, tenantId?: number): Promise<{ active: number; archived: number; total: number; byCategory: Record<string, number>; knowledgeCount: number }>;
  // R74.13d C1 follow-up: tenantId scoping params for heartbeat reads.
  getRecentDailyNotes(days: number, personaId?: number, tenantId?: number): Promise<DailyNote[]>;
  getHeartbeatTasks(personaId?: number, tenantId?: number): Promise<HeartbeatTask[]>;
  getHeartbeatTask(id: number): Promise<HeartbeatTask | undefined>;
  createHeartbeatTask(data: InsertHeartbeatTask & { tenantId?: number }): Promise<HeartbeatTask | any>;
  updateHeartbeatTask(id: number, data: Partial<InsertHeartbeatTask>, tenantId?: number): Promise<HeartbeatTask | undefined>;
  deleteHeartbeatTask(id: number, tenantId?: number): Promise<void>;
  getDueHeartbeatTasks(): Promise<HeartbeatTask[]>;
  claimHeartbeatTasks(taskIds: number[], nextRunAtMap: Map<number, Date>): Promise<number[]>;
  fixStaleBackupSchedules(): Promise<number>;
  markHeartbeatTaskRun(id: number, nextRunAt: Date): Promise<void>;
  getHeartbeatLogs(limit?: number, personaId?: number, tenantId?: number): Promise<HeartbeatLog[]>;
  createHeartbeatLog(data: InsertHeartbeatLog): Promise<HeartbeatLog>;
  getHeartbeatTasksByPersona(personaId: number, tenantId?: number): Promise<HeartbeatTask[]>;
  searchConversations(query: string, tenantId?: number): Promise<Array<Conversation & { snippet?: string }>>;
  getAllDataForExport(): Promise<any>;
  getConversationTemplates(): Promise<ConversationTemplate[]>;
  createConversationTemplate(data: InsertConversationTemplate): Promise<ConversationTemplate>;
  updateConversationTemplate(id: number, data: Partial<InsertConversationTemplate>): Promise<ConversationTemplate | undefined>;
  deleteConversationTemplate(id: number): Promise<void>;
  getAnalytics(tenantId: number): Promise<any>;
  getContextSummary(tenantId: number): Promise<any>;
  // R74.13z-quint+2 — Tensions (predicted vs actual conflict records)
  createTension(data: InsertTension): Promise<Tension>;
  listTensions(tenantId: number, filters?: { status?: string; ownerPersonaId?: number; sourceKind?: string; limit?: number }): Promise<Tension[]>;
  getTension(id: number, tenantId: number): Promise<Tension | undefined>;
  updateTensionStatus(id: number, tenantId: number, status: string): Promise<Tension | undefined>;
  resolveTension(id: number, tenantId: number, resolution: string, resolutionEvidence?: any): Promise<Tension | undefined>;
  // R74.13z-quint+2 — Architecture Decision Records
  createAdr(data: InsertArchitectureDecision): Promise<ArchitectureDecision>;
  listAdrs(tenantId: number, filters?: { status?: string; tag?: string; limit?: number }): Promise<ArchitectureDecision[]>;
  getAdr(id: number, tenantId: number): Promise<ArchitectureDecision | undefined>;
  updateAdrStatus(id: number, tenantId: number, status: string): Promise<ArchitectureDecision | undefined>;
  supersedeAdr(oldId: number, newId: number, tenantId: number, reason: string): Promise<{ old: ArchitectureDecision; new: ArchitectureDecision } | undefined>;
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
    const tScope = tenantScope(conversations.tenantId, tenantId);
    if (tScope) conditions.push(tScope);
    const filter = and(...conditions);
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(conversations).where(filter);
    const total = countResult.count;
    const data = await db.select().from(conversations).where(filter).orderBy(desc(conversations.updatedAt)).limit(limit).offset(offset);
    return { data, total, hasMore: offset + data.length < total };
  }
  // R115.5+sec round 3 — tenantId is now REQUIRED for every conversation/message
  // read & mutation. The previous optional-with-warn posture left ~25 unscoped
  // call sites depending on depth-1 protection (caller re-checks conv.tenantId
  // after a fully-unscoped lookup). A regression upstream — caller forgets the
  // post-check — would silently leak across tenants. Flipping to required at
  // the type level turns every such regression into a tsc compile failure.
  async getConversation(id: number, tenantId: number) {
    const [conv] = await db.select().from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, tenantId)));
    return conv;
  }
  /**
   * R115.5+sec round 3 — explicit unscoped-by-design fetcher for orchestration
   * entrypoints (chat-engine.processMessage) that receive a conversationId
   * WITHOUT a pre-resolved tenantId and must derive tenantId from the row
   * itself. The dangerous name is deliberate: any caller that uses this is
   * accepting responsibility for validating tenantId downstream. Do NOT use
   * this in HTTP handlers — there `getConversation(id, tenantId)` is mandatory.
   */
  async getConversationUnscoped(id: number) {
    // R115.6 — structured audit log on every unscoped read so a future
    // regression (or malicious internal change) that adds a second call site
    // is immediately visible in production logs. Tenant scope is the highest-
    // risk surface in the platform; cheap belt-and-suspenders is worth it.
    console.warn(`[security] storage.getConversationUnscoped read id=${id} — caller MUST validate tenantId downstream`);
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conv;
  }
  async createConversation(data: InsertConversation & { tenantId?: number }) {
    const [conv] = await db.insert(conversations).values(data).returning();
    return conv;
  }
  async updateConversation(id: number, data: Partial<InsertConversation>, tenantId: number) {
    const [conv] = await db.update(conversations).set({ ...data, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.tenantId, tenantId))).returning();
    return conv;
  }
  async deleteConversation(id: number, tenantId: number) {
    await db.execute(sql`UPDATE conversations SET deleted_at = NOW(), deleted_by = 'user' WHERE id = ${id} AND tenant_id = ${tenantId}`);
  }
  async getMessages(conversationId: number, tenantId: number) {
    const msgs = await db.select().from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.tenantId, tenantId)))
      .orderBy(messages.createdAt);
    return await this.attachCitationMetadata(msgs);
  }
  async getMessagesPaginated(conversationId: number, limit: number, offset: number, tenantId: number): Promise<{ messages: Message[]; total: number }> {
    const where = and(eq(messages.conversationId, conversationId), eq(messages.tenantId, tenantId));
    const [countResult, msgs] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(messages).where(where),
      db.select().from(messages).where(where).orderBy(messages.createdAt).limit(limit).offset(offset),
    ]);
    return { messages: await this.attachCitationMetadata(msgs), total: countResult[0]?.count ?? 0 };
  }
  // R62 — citations live on a raw-SQL column not exposed via Drizzle schema.
  // Fold them into the Drizzle row dicts in one batched query.
  private async attachCitationMetadata(msgs: Message[]): Promise<Message[]> {
    if (!msgs.length) return msgs;
    try {
      // R79.3e — Drizzle's tagged template doesn't auto-encode JS arrays as
      // a postgres `int[]` literal — passing `${ids}` where ids=[1] binds the
      // parameter as the string "1", causing `malformed array literal: "1"`.
      // Filter to validated integers, then expand into a comma-separated IN
      // list so each id is bound as its own scalar parameter.
      const ids = msgs
        .map((m: any) => m.id)
        .filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0);
      if (!ids.length) return msgs;
      const idList = sql.join(ids.map(i => sql`${i}`), sql`, `);
      const result: any = await db.execute(sql`SELECT id, citations FROM messages WHERE id IN (${idList}) AND citations IS NOT NULL`);
      const rows: { id: number; citations: any }[] = result.rows ?? result;
      if (!rows?.length) return msgs;
      const map = new Map(rows.map(r => [r.id, r.citations]));
      return msgs.map((m: any) => map.has(m.id) ? { ...m, citations: map.get(m.id) } : m);
    } catch (err: any) {
      console.warn(`[storage] citation merge failed: ${err.message}`);
      return msgs;
    }
  }
  async createMessage(data: InsertMessage) {
    const conv = await db.select({ tenantId: conversations.tenantId }).from(conversations).where(eq(conversations.id, data.conversationId)).limit(1);
    const convTenantId = conv[0]?.tenantId;
    if (!convTenantId) {
      console.error(`[createMessage] No conversation found for id=${data.conversationId}`);
      throw new Error("Conversation not found");
    }
    // R116.2 — explicit undefined check + positive-int validation.
    // The previous `if (data.tenantId && ...)` allowed falsy values (0, "",
    // null, NaN) to bypass the mismatch detection entirely.
    if (data.tenantId !== undefined && data.tenantId !== null) {
      if (!Number.isInteger(data.tenantId) || (data.tenantId as number) <= 0) {
        console.error(`[createMessage] invalid tenantId: ${data.tenantId} convId=${data.conversationId}`);
        throw new Error("Invalid tenantId");
      }
      if (data.tenantId !== convTenantId) {
        console.error(`[createMessage] tenant_id mismatch: caller=${data.tenantId} conv=${convTenantId} convId=${data.conversationId}`);
        throw new Error("Tenant mismatch");
      }
    }
    const [msg] = await db.insert(messages).values({ ...data, tenantId: convTenantId }).returning();
    return msg;
  }
  // R62 — attach citation metadata to a message after it's created. Lives
  // outside createMessage because shared/schema.ts isn't aware of the
  // citations jsonb column (added by raw SQL migration; project policy keeps
  // schema.ts hands-off for additive changes).
  async attachCitations(messageId: number, citations: any[]) {
    if (!Array.isArray(citations) || citations.length === 0) return;
    try {
      await db.execute(sql`
        UPDATE messages SET citations = ${JSON.stringify(citations)}::jsonb WHERE id = ${messageId}
      `);
    } catch (e: any) {
      console.warn(`[storage.attachCitations] failed for msg ${messageId}: ${e.message}`);
    }
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
  async getEnabledSkillsWithPrompts(personaId?: number | null, disabledSkillNames?: string[] | null) {
    const baseCondition = and(eq(skills.enabled, true), sql`${skills.promptContent} IS NOT NULL`);
    let rows: Skill[];
    if (personaId) {
      rows = await db.select().from(skills).where(and(baseCondition, or(isNull(skills.personaId), eq(skills.personaId, personaId))));
    } else {
      rows = await db.select().from(skills).where(baseCondition);
    }
    if (disabledSkillNames && disabledSkillNames.length > 0) {
      const blocked = new Set(disabledSkillNames.map(n => n.toLowerCase()));
      rows = rows.filter(s => !blocked.has(String(s.name).toLowerCase()));
    }
    return rows;
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
    // Wrapped: if data.isActive, the clear-then-insert must be atomic so a
    // crash mid-operation can't leave zero active personas (UI breaks) or two
    // concurrent calls leave two active personas (downstream code picks the
    // first arbitrarily). Same logic as updatePersona/setActivePersona.
    return await db.transaction(async (tx) => {
      if (data.isActive) {
        await tx.update(personas).set({ isActive: false });
      }
      const [p] = await tx.insert(personas).values(data).returning();
      return p;
    });
  }
  async updatePersona(id: number, data: Partial<InsertPersona>) {
    return await db.transaction(async (tx) => {
      if (data.isActive) {
        await tx.update(personas).set({ isActive: false });
      }
      const [p] = await tx.update(personas).set(data).where(eq(personas.id, id)).returning();
      return p;
    });
  }
  async deletePersona(id: number) {
    await db.transaction(async (tx) => {
      await tx.update(conversations).set({ personaId: null }).where(eq(conversations.personaId, id));
      await tx.update(memoryEntries).set({ status: "superseded" }).where(eq(memoryEntries.personaId, id));
      await tx.delete(dailyNotes).where(eq(dailyNotes.personaId, id));
      await tx.delete(personas).where(eq(personas.id, id));
    });
  }
  async setActivePersona(id: number) {
    const persona = await this.getPersona(id);
    if (!persona) throw new Error("Persona not found");
    // Atomic clear-then-set so the active-persona invariant (exactly one row
    // with is_active=true) holds even under crash or concurrent calls.
    await db.transaction(async (tx) => {
      await tx.update(personas).set({ isActive: false });
      await tx.update(personas).set({ isActive: true }).where(eq(personas.id, id));
    });
  }

  // ─── Memory ─────────────────────────────────────────────
  async getMemoryEntries(personaId?: number, limit = 100, offset = 0, tenantId?: number): Promise<PaginatedResult<MemoryEntry>> {
    const conditions = [eq(memoryEntries.status, "active")];
    if (personaId) conditions.push(eq(memoryEntries.personaId, personaId));
    const tScope = tenantScope(memoryEntries.tenantId, tenantId);
    if (tScope) conditions.push(tScope);
    const where = and(...conditions);
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(memoryEntries).where(where);
    const total = countResult.count;
    const data = await db.select(memoryEntrySafeCols).from(memoryEntries).where(where).orderBy(desc(memoryEntries.lastAccessed)).limit(limit).offset(offset) as any;
    return { data, total, hasMore: offset + data.length < total };
  }
  async getAllMemoriesForBackup(): Promise<MemoryEntry[]> {
    return db.select(memoryEntrySafeCols).from(memoryEntries).orderBy(desc(memoryEntries.lastAccessed)) as any;
  }
  async getMemoryEntry(id: number, tenantId?: number) {
    if (tenantId === undefined) {
      _warnUnscoped("getMemoryEntry", id);
    }
    const conds = [eq(memoryEntries.id, id)];
    const tScope = tenantScope(memoryEntries.tenantId, tenantId);
    if (tScope) conds.push(tScope);
    const [entry] = await db.select(memoryEntrySafeCols).from(memoryEntries).where(and(...conds));
    return entry;
  }
  async createMemoryEntry(data: InsertMemoryEntry) {
    const [entry] = await db.insert(memoryEntries).values(data).returning();
    return entry;
  }
  async updateMemoryEntry(id: number, data: Partial<InsertMemoryEntry>, tenantId?: number) {
    const conds = [eq(memoryEntries.id, id)];
    const tScope = tenantScope(memoryEntries.tenantId, tenantId);
    if (tScope) conds.push(tScope);
    const [entry] = await db.update(memoryEntries).set(data).where(and(...conds)).returning();
    return entry;
  }
  async deleteMemoryEntry(id: number, tenantId?: number) {
    const conds = [eq(memoryEntries.id, id)];
    const tScope = tenantScope(memoryEntries.tenantId, tenantId);
    if (tScope) conds.push(tScope);
    await db.update(memoryEntries).set({ status: "superseded" }).where(and(...conds));
  }
  async touchMemoryEntries(ids: number[]) {
    if (ids.length === 0) return;
    await db.update(memoryEntries)
      .set({ lastAccessed: new Date(), accessCount: sql`${memoryEntries.accessCount} + 1` })
      .where(inArray(memoryEntries.id, ids));
  }

  // ─── R112.15 — L2 session memory (conversation_facts) ───────────────
  async getConversationFacts(conversationId: number, tenantId: number, limit = 50): Promise<ConversationFact[]> {
    return db.select().from(conversationFacts)
      .where(and(
        eq(conversationFacts.conversationId, conversationId),
        eq(conversationFacts.tenantId, tenantId),
        eq(conversationFacts.status, "active"),
      ))
      .orderBy(desc(conversationFacts.lastReferencedAt))
      .limit(limit);
  }
  async createConversationFact(data: InsertConversationFact): Promise<ConversationFact> {
    const [row] = await db.insert(conversationFacts).values(data).returning();
    return row;
  }
  /** R112.15 — tenantId optional but recommended; pass it to fail-closed per R64.C. */
  async touchConversationFacts(ids: number[], tenantId: number): Promise<void> {
    if (ids.length === 0) return;
    if (typeof tenantId !== "number") {
      throw new Error("touchConversationFacts: tenantId is required (fail-closed tenant scoping)");
    }
    const conds = [inArray(conversationFacts.id, ids), eq(conversationFacts.tenantId, tenantId)];
    await db.update(conversationFacts)
      .set({ lastReferencedAt: new Date(), refCount: sql`${conversationFacts.refCount} + 1` })
      .where(and(...conds));
  }
  async countConversationFacts(conversationId: number, tenantId: number): Promise<number> {
    const [r] = await db.select({ c: sql<number>`count(*)::int` }).from(conversationFacts)
      .where(and(
        eq(conversationFacts.conversationId, conversationId),
        eq(conversationFacts.tenantId, tenantId),
        eq(conversationFacts.status, "active"),
      ));
    return r?.c || 0;
  }
  /** LRU-evict oldest active facts when over the cap. */
  async evictOldestConversationFacts(conversationId: number, tenantId: number, keep = 50): Promise<void> {
    const overflow = await this.countConversationFacts(conversationId, tenantId) - keep;
    if (overflow <= 0) return;
    const victims = await db.select({ id: conversationFacts.id }).from(conversationFacts)
      .where(and(
        eq(conversationFacts.conversationId, conversationId),
        eq(conversationFacts.tenantId, tenantId),
        eq(conversationFacts.status, "active"),
      ))
      .orderBy(conversationFacts.lastReferencedAt)
      .limit(overflow);
    if (victims.length === 0) return;
    await db.update(conversationFacts)
      .set({ status: "expired" })
      .where(inArray(conversationFacts.id, victims.map(v => v.id)));
  }

  // ─── Daily Notes ─────────────────────────────────────────
  async getDailyNotes(personaId?: number, tenantId?: number) {
    const conditions = [];
    if (personaId) conditions.push(eq(dailyNotes.personaId, personaId));
    const tScope = tenantScope(dailyNotes.tenantId, tenantId);
    if (tScope) conditions.push(tScope);
    return db.select().from(dailyNotes)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(dailyNotes.date)).limit(30);
  }
  async getDailyNote(date: string, personaId?: number, tenantId?: number) {
    const conditions = [eq(dailyNotes.date, date)];
    if (personaId) conditions.push(eq(dailyNotes.personaId, personaId));
    const tScope = tenantScope(dailyNotes.tenantId, tenantId);
    if (tScope) conditions.push(tScope);
    const [note] = await db.select().from(dailyNotes).where(and(...conditions));
    return note;
  }
  async upsertDailyNote(data: InsertDailyNote) {
    const existing = await this.getDailyNote(data.date, data.personaId ?? undefined, data.tenantId ?? undefined);
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
    const tScope = tenantScope(agentKnowledge.tenantId, tenantId);
    if (tScope) conditions.push(tScope);
    const where = and(...conditions);
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(agentKnowledge).where(where);
    const total = countResult.count;
    const data = await db.select(knowledgeSafeCols).from(agentKnowledge).where(where).orderBy(desc(agentKnowledge.priority), desc(agentKnowledge.updatedAt)).limit(limit).offset(offset) as any;
    return { data, total, hasMore: offset + data.length < total };
  }
  async createKnowledge(data: InsertKnowledge) {
    const [entry] = await db.insert(agentKnowledge).values(data).returning();
    return entry;
  }
  // R74.13d C3: tenantId is required to prevent cross-tenant overwrite/delete by ID.
  // Routes already enforce ownership before calling, but this is defense-in-depth so
  // any future caller that forgets the ownership check still cannot escape its tenant.
  // Pass `tenantId: ADMIN_TENANT_ID` only from contexts that legitimately act as admin.
  async updateKnowledge(id: number, data: Partial<InsertKnowledge>, tenantId: number) {
    if (!tenantId) throw new Error("updateKnowledge requires tenantId");
    const [entry] = await db.update(agentKnowledge).set({ ...data, updatedAt: new Date() })
      .where(and(eq(agentKnowledge.id, id), eq(agentKnowledge.tenantId, tenantId))).returning();
    return entry;
  }
  async deleteKnowledge(id: number, tenantId: number) {
    if (!tenantId) throw new Error("deleteKnowledge requires tenantId");
    await db.delete(agentKnowledge).where(and(eq(agentKnowledge.id, id), eq(agentKnowledge.tenantId, tenantId)));
  }

  // ─── Embeddings ─────────────────────────────────────────
  async updateMemoryEmbedding(id: number, embedding: number[]) {
    await db.update(memoryEntries).set({ embedding }).where(eq(memoryEntries.id, id));
    try {
      const { storeEmbeddingVec } = await import("./embeddings");
      await storeEmbeddingVec("memory_entries", id, embedding);
    } catch (err) {
      // Loud — silent failure here would silently corrupt RAG: the row appears
      // to have an embedding (jsonb column updated above) but pgvector lookups
      // would skip it, so semantic recall regresses with no visible signal.
      console.warn(`[storage] storeEmbeddingVec failed for memory #${id}:`, (err as Error)?.message);
    }
  }
  async updateKnowledgeEmbedding(id: number, embedding: number[]) {
    await db.update(agentKnowledge).set({ embedding }).where(eq(agentKnowledge.id, id));
    try {
      const { storeEmbeddingVec } = await import("./embeddings");
      await storeEmbeddingVec("agent_knowledge", id, embedding);
    } catch (err) {
      console.warn(`[storage] storeEmbeddingVec failed for knowledge #${id}:`, (err as Error)?.message);
    }
  }
  async getMemoriesWithoutEmbeddings(limit = 50): Promise<any[]> {
    return db.select(memoryEntrySafeCols).from(memoryEntries)
      .where(and(eq(memoryEntries.status, "active"), isNull(memoryEntries.embedding)))
      .limit(limit) as any;
  }
  async getKnowledgeWithoutEmbeddings(limit = 50): Promise<any[]> {
    const notExpired = or(isNull(agentKnowledge.expiresAt), gt(agentKnowledge.expiresAt, new Date()));
    return db.select(knowledgeSafeCols).from(agentKnowledge)
      .where(and(notExpired!, isNull(agentKnowledge.embedding)))
      .limit(limit) as any;
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
  // R74.13d C1 follow-up: tenant scoping. The `daily_notes` table has tenant_id
  // (defaulted to 1 historically); the heartbeat path now MUST pass it so a
  // persona shared across tenants doesn't see another tenant's notes.
  async getRecentDailyNotes(days: number, personaId?: number, tenantId?: number) {
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      dates.push(d.toISOString().split("T")[0]);
    }
    const conds: any[] = [inArray(dailyNotes.date, dates)];
    if (personaId !== undefined) conds.push(eq(dailyNotes.personaId, personaId));
    if (tenantId !== undefined) conds.push(eq(dailyNotes.tenantId, tenantId));
    return db.select().from(dailyNotes)
      .where(conds.length > 1 ? and(...conds) : conds[0])
      .orderBy(desc(dailyNotes.date));
  }

  // ─── Heartbeat ──────────────────────────────────────────
  // R74.13d C1 follow-up: tenantId filter cleaned up to direct equality
  // (heartbeat_tasks has tenant_id column, no subselect needed).
  async getHeartbeatTasks(personaId?: number, tenantId?: number) {
    const conditions = [];
    if (personaId !== undefined) conditions.push(eq(heartbeatTasks.personaId, personaId));
    if (tenantId !== undefined) conditions.push(eq(heartbeatTasks.tenantId, tenantId));
    if (conditions.length > 0) {
      return db.select().from(heartbeatTasks).where(conditions.length > 1 ? and(...conditions) : conditions[0]).orderBy(heartbeatTasks.name);
    }
    return db.select().from(heartbeatTasks).orderBy(heartbeatTasks.name);
  }
  async getHeartbeatTasksByPersona(personaId: number, tenantId?: number) {
    // R74.13z-quint+7 SECURITY follow-up: scope by tenantId. Without it,
    // heartbeat task names/status from another tenant could be injected
    // into the LLM context whenever personas overlapped.
    const conditions = [eq(heartbeatTasks.personaId, personaId)];
    const tScope = tenantScope(heartbeatTasks.tenantId, tenantId);
    if (tScope) conditions.push(tScope);
    return db.select().from(heartbeatTasks).where(and(...conditions)).orderBy(heartbeatTasks.name);
  }
  async getHeartbeatTask(id: number) {
    const [task] = await db.select().from(heartbeatTasks).where(eq(heartbeatTasks.id, id));
    return task;
  }
  async createHeartbeatTask(data: InsertHeartbeatTask & { tenantId?: number; nextRunAt?: Date }) {
    const nextRun = data.nextRunAt || getNextCronRun(data.cronExpression || "*/30 * * * *");
    const tenantId = (data as any).tenantId;
    if (!tenantId) throw new Error("tenantId is required for heartbeat task creation");
    // R74.13h: explicitly default approval_status='pending' so user-created
    // tasks (e.g. POST /api/heartbeat/tasks) require admin approval before
    // running. Caller can override via (data as any).approvalStatus when
    // creating system/internal tasks that should be pre-approved.
    const approvalStatus = (data as any).approvalStatus || 'pending';
    const result = await db.execute(sql`
      INSERT INTO heartbeat_tasks (name, description, type, cron_expression, enabled, prompt_content, model, persona_id, created_by, parent_task_id, run_once, next_run_at, tenant_id, approval_status)
      VALUES (${data.name}, ${data.description || null}, ${data.type || 'general'}, ${data.cronExpression || '*/30 * * * *'}, ${data.enabled !== false}, ${data.promptContent || null}, ${data.model || 'gemini-2.5-flash'}, ${data.personaId || null}, ${data.createdBy || 'user'}, ${data.parentTaskId || null}, ${data.runOnce || false}, ${nextRun}, ${tenantId}, ${approvalStatus})
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
        AND approval_status = 'approved'
      ORDER BY next_run_at ASC
    `);
    return (result as any).rows || [];
  }
  async claimHeartbeatTasks(taskIds: number[], nextRunAtMap: Map<number, Date>): Promise<number[]> {
    if (taskIds.length === 0) return [];
    const now = new Date();
    const claimed: number[] = [];
    for (const id of taskIds) {
      const nextRun = nextRunAtMap.get(id) || new Date(now.getTime() + 10 * 60 * 1000);
      const result = await db.execute(sql`
        UPDATE heartbeat_tasks
        SET last_run_at = ${now}, next_run_at = ${nextRun}
        WHERE id = ${id}
          AND enabled = true
          AND next_run_at <= NOW()
        RETURNING id
      `);
      if (((result as any).rows || []).length > 0) {
        claimed.push(id);
      }
    }
    return claimed;
  }
  async markHeartbeatTaskRun(id: number, nextRunAt: Date) {
    await db.update(heartbeatTasks)
      .set({ lastRunAt: new Date(), nextRunAt })
      .where(eq(heartbeatTasks.id, id));
  }
  // R74.13d C1 follow-up: tenant scoping. heartbeat_logs has no tenant_id
  // column (would require a schema migration), so scope via task_id ↦
  // heartbeat_tasks.tenant_id when caller supplies tenantId.
  async getHeartbeatLogs(limit = 50, personaId?: number, tenantId?: number) {
    const conds: any[] = [];
    if (personaId !== undefined) conds.push(eq(heartbeatLogs.personaId, personaId));
    if (tenantId !== undefined) {
      conds.push(sql`${heartbeatLogs.taskId} IN (SELECT id FROM heartbeat_tasks WHERE tenant_id = ${tenantId})`);
    }
    if (conds.length === 0) {
      return db.select().from(heartbeatLogs).orderBy(desc(heartbeatLogs.createdAt)).limit(limit);
    }
    return db.select().from(heartbeatLogs)
      .where(conds.length > 1 ? and(...conds) : conds[0])
      .orderBy(desc(heartbeatLogs.createdAt))
      .limit(limit);
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

  async getAnalytics(tenantId: number) {
    // R74.13z-quint+7 SECURITY (Tier-1 #3): every read here is now scoped to
    // the calling tenant. Pre-fix, an authenticated low-privilege tenant
    // could fetch platform-wide analytics + the top user-message words across
    // all tenants (free PII aperture). `tenantId` is now a required argument;
    // call sites without one will fail to type-check.
    if (!tenantId || typeof tenantId !== "number") {
      throw new Error("getAnalytics: tenantId is required");
    }
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [msgPerDayRows, modelRows, hourlyRows, totalConvResult, totalMsgResult, toolMsgs, userMsgs] = await Promise.all([
      db.execute(sql`
        SELECT to_char(m.created_at, 'YYYY-MM-DD') as day, m.role, count(*)::int as cnt
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.created_at > ${thirtyDaysAgo} AND c.tenant_id = ${tenantId}
        GROUP BY day, m.role ORDER BY day
      `),
      db.execute(sql`
        SELECT COALESCE(model, 'unknown') as model, count(*)::int as cnt
        FROM conversations WHERE tenant_id = ${tenantId}
        GROUP BY model ORDER BY cnt DESC
      `),
      db.execute(sql`
        SELECT EXTRACT(HOUR FROM m.created_at)::int as hour, count(*)::int as cnt
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.created_at > ${thirtyDaysAgo} AND m.role = 'user' AND c.tenant_id = ${tenantId}
        GROUP BY hour ORDER BY hour
      `),
      db.select({ count: sql<number>`count(*)::int` }).from(conversations).where(eq(conversations.tenantId, tenantId)),
      db.execute(sql`
        SELECT count(*)::int as count FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.created_at > ${thirtyDaysAgo} AND c.tenant_id = ${tenantId}
      `),
      db.execute(sql`
        SELECT m.content FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.created_at > ${thirtyDaysAgo} AND m.role = 'assistant'
          AND m.content LIKE '<!-- tools:%' AND c.tenant_id = ${tenantId}
      `),
      db.execute(sql`
        SELECT m.content FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.created_at > ${thirtyDaysAgo} AND m.role = 'user' AND c.tenant_id = ${tenantId}
      `),
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
    for (const msg of toolMsgs.rows as any[]) {
      const toolMatch = String(msg.content || "").match(/^<!-- tools:(\[[\s\S]*?\]) -->/);
      if (toolMatch) {
        try {
          const tools = JSON.parse(toolMatch[1]);
          for (const t of tools) {
            toolUsage[t.name] = (toolUsage[t.name] || 0) + 1;
          }
        } catch (_silentErr) { logSilentCatch("server/storage.ts", _silentErr); }
      }
    }

    const wordFreq: Record<string, number> = {};
    const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall", "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "about", "like", "after", "between", "out", "this", "that", "these", "those", "it", "its", "i", "me", "my", "you", "your", "we", "our", "they", "them", "their", "he", "she", "him", "her", "and", "or", "but", "not", "no", "so", "if", "then", "than", "just", "also", "very", "what", "how", "when", "where", "why", "who", "which", "all", "each", "some", "any", "more", "most"]);
    for (const msg of userMsgs.rows as any[]) {
      const words = String(msg.content || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
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
      totalMessages: ((totalMsgResult as any).rows?.[0]?.count) || 0,
      periodDays: 30,
    };
  }

  async getContextSummary(tenantId: number) {
    // R74.13z-quint+7 SECURITY (Tier-1 #2): scope every read to the calling
    // tenant. Pre-fix, /api/context/summary returned the 3 most-recent
    // conversations and 5 most-recent memory facts platform-wide — any
    // authenticated tenant could harvest other tenants' titles + facts on
    // every load.
    if (!tenantId || typeof tenantId !== "number") {
      throw new Error("getContextSummary: tenantId is required");
    }
    const now = new Date();
    const hour = now.getHours();
    let greeting: string;
    if (hour < 12) greeting = "Good morning";
    else if (hour < 17) greeting = "Good afternoon";
    else greeting = "Good evening";

    const recentConvs = await db.select().from(conversations)
      .where(and(eq(conversations.tenantId, tenantId), sql`deleted_at IS NULL`))
      .orderBy(desc(conversations.updatedAt)).limit(3);
    const activePersona = await this.getActivePersona();
    const memoryConditions = [
      eq(memoryEntries.tenantId, tenantId),
      eq(memoryEntries.status, "active"),
    ];
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
    // R74.13z-quint+7 SECURITY follow-up: scope getDailyNote by tenantId.
    // getDailyNote only filters by tenantId when one is passed; without it
    // the same date+persona could return another tenant's note.
    const todayNote = await this.getDailyNote(today, activePersona?.id, tenantId);

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
    // R74.13g — validate once at function top so all 3 raw-SQL sites below
    // can use the (now provably-valid) integer without re-checking the
    // 0/NaN/negative fail-open shape.
    const validTid = assertValidTenantId(tenantId);

    const notDeletedFilter = sql`${conversations.deletedAt} IS NULL`;

    const msgConditions: any[] = [sql`${messages.content} ILIKE ${pattern}`];
    if (validTid !== undefined) {
      msgConditions.push(sql`${messages.conversationId} IN (SELECT id FROM ${conversations} WHERE ${conversations.tenantId} = ${validTid} AND ${conversations.deletedAt} IS NULL)`);
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
    if (validTid !== undefined) titleConditions.push(eq(conversations.tenantId, validTid));
    const titleMatches = await db
      .select()
      .from(conversations)
      .where(and(...titleConditions))
      .orderBy(desc(conversations.updatedAt))
      .limit(50);

    const contentConditions: any[] = convIds.length > 0 ? [inArray(conversations.id, convIds), notDeletedFilter] : [notDeletedFilter];
    if (validTid !== undefined) contentConditions.push(eq(conversations.tenantId, validTid));
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
  async createTension(data: InsertTension): Promise<Tension> {
    assertValidTenantId(data.tenantId);
    const [row] = await db.insert(tensions).values(data).returning();
    return row;
  }

  async listTensions(tenantId: number, filters?: { status?: string; ownerPersonaId?: number; sourceKind?: string; limit?: number }): Promise<Tension[]> {
    assertValidTenantId(tenantId);
    const conditions: any[] = [eq(tensions.tenantId, tenantId)];
    if (filters?.status) conditions.push(eq(tensions.status, filters.status));
    if (filters?.ownerPersonaId !== undefined && filters.ownerPersonaId !== null) conditions.push(eq(tensions.ownerPersonaId, filters.ownerPersonaId));
    if (filters?.sourceKind) conditions.push(eq(tensions.sourceKind, filters.sourceKind));
    return await db.select().from(tensions).where(and(...conditions)).orderBy(desc(tensions.createdAt)).limit(filters?.limit ?? 100);
  }

  async getTension(id: number, tenantId: number): Promise<Tension | undefined> {
    assertValidTenantId(tenantId);
    const [row] = await db.select().from(tensions).where(and(eq(tensions.id, id), eq(tensions.tenantId, tenantId)));
    return row;
  }

  async updateTensionStatus(id: number, tenantId: number, status: string): Promise<Tension | undefined> {
    assertValidTenantId(tenantId);
    const [row] = await db.update(tensions)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(tensions.id, id), eq(tensions.tenantId, tenantId)))
      .returning();
    return row;
  }

  async resolveTension(id: number, tenantId: number, resolution: string, resolutionEvidence?: any): Promise<Tension | undefined> {
    assertValidTenantId(tenantId);
    const [row] = await db.update(tensions)
      .set({
        status: "resolved",
        resolution,
        resolutionEvidence: resolutionEvidence ?? {},
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(tensions.id, id), eq(tensions.tenantId, tenantId)))
      .returning();
    return row;
  }

  async createAdr(data: InsertArchitectureDecision): Promise<ArchitectureDecision> {
    assertValidTenantId(data.tenantId);
    const [row] = await db.insert(architectureDecisions).values(data).returning();
    return row;
  }

  async listAdrs(tenantId: number, filters?: { status?: string; tag?: string; limit?: number }): Promise<ArchitectureDecision[]> {
    assertValidTenantId(tenantId);
    const conditions: any[] = [eq(architectureDecisions.tenantId, tenantId)];
    if (filters?.status) conditions.push(eq(architectureDecisions.status, filters.status));
    if (filters?.tag) conditions.push(sql`${filters.tag} = ANY(${architectureDecisions.tags})`);
    return await db.select().from(architectureDecisions).where(and(...conditions)).orderBy(desc(architectureDecisions.createdAt)).limit(filters?.limit ?? 100);
  }

  async getAdr(id: number, tenantId: number): Promise<ArchitectureDecision | undefined> {
    assertValidTenantId(tenantId);
    const [row] = await db.select().from(architectureDecisions).where(and(eq(architectureDecisions.id, id), eq(architectureDecisions.tenantId, tenantId)));
    return row;
  }

  async updateAdrStatus(id: number, tenantId: number, status: string): Promise<ArchitectureDecision | undefined> {
    assertValidTenantId(tenantId);
    const decidedAtUpdate: any = (status === "accepted") ? { decidedAt: new Date() } : {};
    const [row] = await db.update(architectureDecisions)
      .set({ status, updatedAt: new Date(), ...decidedAtUpdate })
      .where(and(eq(architectureDecisions.id, id), eq(architectureDecisions.tenantId, tenantId)))
      .returning();
    return row;
  }

  async supersedeAdr(oldId: number, newId: number, tenantId: number, reason: string): Promise<{ old: ArchitectureDecision; new: ArchitectureDecision } | undefined> {
    assertValidTenantId(tenantId);
    const [oldAdr] = await db.select().from(architectureDecisions).where(and(eq(architectureDecisions.id, oldId), eq(architectureDecisions.tenantId, tenantId)));
    const [newAdr] = await db.select().from(architectureDecisions).where(and(eq(architectureDecisions.id, newId), eq(architectureDecisions.tenantId, tenantId)));
    if (!oldAdr || !newAdr) return undefined;
    const [updatedOld] = await db.update(architectureDecisions)
      .set({ status: "superseded", supersededBy: newId, supersedeReason: reason, updatedAt: new Date() })
      .where(eq(architectureDecisions.id, oldId)).returning();
    const [updatedNew] = await db.update(architectureDecisions)
      .set({ supersedes: oldId, updatedAt: new Date() })
      .where(eq(architectureDecisions.id, newId)).returning();
    return { old: updatedOld, new: updatedNew };
  }
}

export const storage = new DatabaseStorage();
