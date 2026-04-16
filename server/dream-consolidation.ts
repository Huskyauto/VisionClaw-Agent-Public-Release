import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { generateEmbedding, storeEmbeddingVec, cosineSimilarity } from "./embeddings";
import { executeWithFailover } from "./model-failover";
import { getAvailableModels, getModelForTierAsync, type ModelInfo } from "./providers";
import type { InsertMemoryEntry, MemoryEntry } from "@shared/schema";

export interface DreamConsolidationResult {
  reviewed: number;
  merged: number;
  archived: number;
  promoted: number;
  created: number;
  errors: number;
  summary: string;
  durationMs: number;
}

interface DreamAction {
  type: "merge" | "archive" | "promote" | "create_summary";
  ids?: number[];
  id?: number;
  fact?: string;
  category?: string;
  reason?: string;
}

interface DbRow {
  id: number;
  title?: string;
  updated_at?: string;
  role?: string;
  content?: string;
}

const DREAM_PROMPT = `You are the DreamTask Memory Consolidation Engine. Your job is to review and reorganize memory entries like a brain consolidating memories during sleep.

REVIEW THESE MEMORIES AND RETURN A JSON OBJECT with an "actions" array. Each action is one of:

1. **merge** — Two or more memories say the same thing differently. Combine into one.
   { "type": "merge", "ids": [id1, id2, ...], "fact": "merged fact text", "category": "best category", "reason": "why merged" }

2. **archive** — Memory is outdated, superseded, or no longer relevant.
   { "type": "archive", "id": memoryId, "reason": "why archiving" }

3. **promote** — Memory from "conversation" source is important enough to be permanent knowledge.
   { "type": "promote", "id": memoryId, "category": "appropriate category", "reason": "why promoting" }

4. **create_summary** — Multiple related memories should have a connecting summary.
   { "type": "create_summary", "ids": [related ids], "fact": "summary connecting these memories", "category": "meta", "reason": "why this summary helps" }

RULES:
- Be conservative. Only merge when memories are clearly redundant (>80% overlap in meaning).
- Never archive memories that have been accessed frequently (accessCount > 5) unless truly outdated.
- Promote memories that contain reusable preferences, patterns, or decisions.
- Create summaries only when 3+ memories form a coherent topic cluster.
- Return at most 10 actions per run to avoid over-consolidation.
- Only use memory IDs from the provided list. Do not invent or guess IDs.
- If memories are already clean and well-organized, return { "actions": [] }.

Return ONLY valid JSON. No markdown fences, no explanation outside the JSON.`;

function extractRows(result: unknown): DbRow[] {
  const raw = result as { rows?: DbRow[] };
  return Array.isArray(raw.rows) ? raw.rows : Array.isArray(result) ? (result as DbRow[]) : [];
}

async function getRecentSessionSummaries(tenantId: number, sessionCount: number): Promise<string> {
  try {
    const convResult = await db.execute(sql`
      SELECT id, title, updated_at FROM conversations 
      WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT ${sessionCount}
    `);
    const convs = extractRows(convResult);
    if (convs.length === 0) return "No recent sessions found.";

    const summaries: string[] = [];
    for (const conv of convs) {
      const msgResult = await db.execute(sql`
        SELECT role, content FROM messages 
        WHERE conversation_id = ${conv.id}
        ORDER BY created_at DESC
        LIMIT 6
      `);
      const msgs = extractRows(msgResult);
      if (msgs.length === 0) continue;

      const topicHints = msgs
        .filter((m) => m.role === "user" && m.content)
        .map((m) => (m.content || "").slice(0, 150))
        .slice(0, 2);

      summaries.push(`Session "${conv.title || "Untitled"}" (${conv.updated_at}): Topics — ${topicHints.join("; ") || "no user messages"}`);
    }
    return summaries.join("\n") || "No session content available.";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[dream] Failed to get session summaries:", msg);
    return "Could not retrieve recent sessions.";
  }
}

function findDuplicateCandidates(
  memories: Array<{ id: number; fact: string; embedding: number[] | null | unknown }>
): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = [];
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i];
      const b = memories[j];
      if (a.embedding && b.embedding) {
        try {
          const embA = typeof a.embedding === "string" ? JSON.parse(a.embedding) : a.embedding;
          const embB = typeof b.embedding === "string" ? JSON.parse(b.embedding) : b.embedding;
          if (Array.isArray(embA) && Array.isArray(embB) && embA.length === embB.length) {
            const sim = cosineSimilarity(embA as number[], embB as number[]);
            if (sim > 0.85) {
              pairs.push([a.id, b.id, Math.round(sim * 1000) / 1000]);
            }
          }
        } catch {
          /* skip malformed embeddings */
        }
      }
    }
  }
  return pairs.sort((a, b) => b[2] - a[2]).slice(0, 20);
}

async function archiveMemoryByTenant(memoryId: number, tenantId: number): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE memory_entries SET status = 'archived'
    WHERE id = ${memoryId} AND tenant_id = ${tenantId} AND status = 'active'
    RETURNING id
  `);
  const rows = extractRows(result);
  return rows.length > 0;
}

async function promoteMemoryByTenant(memoryId: number, tenantId: number, category?: string): Promise<boolean> {
  const result = category
    ? await db.execute(sql`
        UPDATE memory_entries SET source = 'promoted', category = ${category}, expires_at = NULL
        WHERE id = ${memoryId} AND tenant_id = ${tenantId} AND status = 'active'
        RETURNING id
      `)
    : await db.execute(sql`
        UPDATE memory_entries SET source = 'promoted', expires_at = NULL
        WHERE id = ${memoryId} AND tenant_id = ${tenantId} AND status = 'active'
        RETURNING id
      `);
  const rows = extractRows(result);
  return rows.length > 0;
}

async function loadAllActiveMemories(tenantId: number): Promise<MemoryEntry[]> {
  const PAGE_SIZE = 200;
  const allActive: MemoryEntry[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const page = await storage.getMemoryEntries(undefined, PAGE_SIZE, offset, tenantId);
    const active = page.data.filter((m: MemoryEntry) => m.status === "active");
    allActive.push(...active);
    offset += PAGE_SIZE;
    hasMore = page.hasMore;
  }
  return allActive;
}

const CHUNK_SIZE = 50;
const MAX_ACTIONS_PER_CHUNK = 10;

interface LlmClient {
  chat: { completions: { create: (params: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }> } };
}

async function consolidateChunk(
  chunk: MemoryEntry[],
  duplicatePairsForChunk: Array<[number, number, number]>,
  sessionSummaries: string,
  totalActive: number,
  totalMemories: number,
  tenantId: number,
  model: string,
  availableModels: ModelInfo[],
): Promise<DreamAction[]> {
  const memoryList = chunk.map((m: MemoryEntry) =>
    `[ID:${m.id}] [${m.category}] ${m.fact} (source: ${m.source}, accessed: ${m.accessCount}x, created: ${m.createdAt})`
  ).join("\n");

  const duplicateHint = duplicatePairsForChunk.length > 0
    ? `\n\nHIGH-SIMILARITY PAIRS (embedding cosine > 0.85):\n${duplicatePairsForChunk.map(([a, b, s]) => `  IDs ${a} & ${b}: similarity ${s}`).join("\n")}`
    : "";

  const userPrompt = `TENANT ${tenantId} — reviewing batch of ${chunk.length} out of ${totalActive} active memories (${totalMemories} total).

RECENT SESSIONS:
${sessionSummaries}

ACTIVE MEMORIES IN THIS BATCH:
${memoryList}${duplicateHint}

Analyze these memories and return consolidation actions as JSON.`;

  const { result: resp } = await executeWithFailover(
    model,
    availableModels,
    async (client: LlmClient, actualModelId: string) => {
      return client.chat.completions.create({
        model: actualModelId,
        messages: [
          { role: "system", content: DREAM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 4096,
        temperature: 0.3,
      });
    },
    tenantId,
  );

  const output = resp.choices[0]?.message?.content || "";
  if (!output) return [];

  let jsonStr = output;
  const fenceMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  let parsed: { actions: DreamAction[] };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const actionMatch = jsonStr.match(/\{[\s\S]*"actions"[\s\S]*\}/);
    if (actionMatch) {
      parsed = JSON.parse(actionMatch[0]);
    } else {
      return [];
    }
  }

  if (!Array.isArray(parsed.actions)) return [];
  return parsed.actions.slice(0, MAX_ACTIONS_PER_CHUNK);
}

export async function runDreamConsolidation(tenantId: number = 1, sessionCount: number = 5): Promise<DreamConsolidationResult> {
  const start = Date.now();
  const result: DreamConsolidationResult = {
    reviewed: 0, merged: 0, archived: 0, promoted: 0, created: 0, errors: 0,
    summary: "", durationMs: 0,
  };

  try {
    console.log(`[dream] Starting consolidation for tenant ${tenantId}...`);

    const activeMemories = await loadAllActiveMemories(tenantId);
    result.reviewed = activeMemories.length;

    const validIds = new Set(activeMemories.map((m: MemoryEntry) => m.id));

    if (activeMemories.length < 3) {
      result.summary = `Too few active memories (${activeMemories.length}) to consolidate.`;
      result.durationMs = Date.now() - start;
      console.log(`[dream] ${result.summary}`);
      return result;
    }

    const sessionSummaries = await getRecentSessionSummaries(tenantId, sessionCount);

    const embeddedMemories = activeMemories.map((m: MemoryEntry) => ({
      id: m.id, fact: m.fact, embedding: m.embedding,
    }));
    const duplicatePairs = findDuplicateCandidates(embeddedMemories);

    const model = await getModelForTierAsync("fast", tenantId);
    const availableModels = await getAvailableModels();

    const chunks: MemoryEntry[][] = [];
    for (let i = 0; i < activeMemories.length; i += CHUNK_SIZE) {
      chunks.push(activeMemories.slice(i, i + CHUNK_SIZE));
    }
    console.log(`[dream] Processing ${activeMemories.length} memories in ${chunks.length} chunk(s)...`);

    const allActions: DreamAction[] = [];
    for (const chunk of chunks) {
      const chunkIds = new Set(chunk.map(m => m.id));
      const relevantPairs = duplicatePairs.filter(([a, b]) => chunkIds.has(a) && chunkIds.has(b));
      try {
        const chunkActions = await consolidateChunk(
          chunk, relevantPairs, sessionSummaries,
          activeMemories.length, activeMemories.length,
          tenantId, model, availableModels,
        );
        allActions.push(...chunkActions);
      } catch (chunkErr: unknown) {
        const msg = chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
        console.error(`[dream] Chunk failed:`, msg);
        result.errors++;
      }
    }

    const MAX_ACTIONS_PER_RUN = 30;
    const cappedActions = allActions.slice(0, MAX_ACTIONS_PER_RUN);
    if (allActions.length > MAX_ACTIONS_PER_RUN) {
      console.log(`[dream] Capping actions from ${allActions.length} to ${MAX_ACTIONS_PER_RUN} for safety`);
    }
    console.log(`[dream] Processing ${cappedActions.length} total consolidation actions...`);

    for (const action of cappedActions) {
      try {
        switch (action.type) {
          case "merge": {
            if (!Array.isArray(action.ids) || action.ids.length < 2 || !action.fact) break;
            const invalidMergeIds = action.ids.filter(id => !validIds.has(id));
            if (invalidMergeIds.length > 0) {
              console.warn(`[dream] Merge rejected: IDs [${invalidMergeIds.join(",")}] not in valid set for tenant ${tenantId}`);
              result.errors++;
              break;
            }
            const mergedId = await db.transaction(async (tx) => {
              for (const id of action.ids) {
                await tx.execute(sql`
                  UPDATE memory_entries SET status = 'archived'
                  WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'active'
                `);
              }
              const insertResult = await tx.execute(sql`
                INSERT INTO memory_entries (fact, category, source, status, persona_id, tenant_id)
                VALUES (${action.fact}, ${action.category || "general"}, 'dream_consolidation', 'active', NULL, ${tenantId})
                RETURNING id
              `);
              const rows = extractRows(insertResult);
              return rows[0]?.id as number;
            });
            if (mergedId) {
              const emb = await generateEmbedding(action.fact!);
              if (emb) {
                await storage.updateMemoryEmbedding(mergedId, emb);
                try { await storeEmbeddingVec("memory_entries", mergedId, emb); } catch { /* pgvector optional */ }
              }
              result.merged++;
              console.log(`[dream] Merged IDs [${action.ids.join(",")}] → ID ${mergedId}: ${action.reason || ""}`);
            }
            break;
          }
          case "archive": {
            if (typeof action.id !== "number") break;
            if (!validIds.has(action.id)) {
              console.warn(`[dream] Archive rejected: ID ${action.id} not in valid set for tenant ${tenantId}`);
              result.errors++;
              break;
            }
            const archived = await archiveMemoryByTenant(action.id, tenantId);
            if (archived) {
              result.archived++;
              console.log(`[dream] Archived ID ${action.id}: ${action.reason || ""}`);
            } else {
              console.warn(`[dream] Archive failed: ID ${action.id} not found or already archived`);
            }
            break;
          }
          case "promote": {
            if (typeof action.id !== "number") break;
            if (!validIds.has(action.id)) {
              console.warn(`[dream] Promote rejected: ID ${action.id} not in valid set for tenant ${tenantId}`);
              result.errors++;
              break;
            }
            const promoted = await promoteMemoryByTenant(action.id, tenantId, action.category);
            if (promoted) {
              result.promoted++;
              console.log(`[dream] Promoted ID ${action.id}: ${action.reason || ""}`);
            } else {
              console.warn(`[dream] Promote failed: ID ${action.id} not found or not active`);
            }
            break;
          }
          case "create_summary": {
            if (!action.fact) break;
            if (Array.isArray(action.ids) && action.ids.length > 0) {
              const invalidSummaryIds = action.ids.filter(id => !validIds.has(id));
              if (invalidSummaryIds.length > 0) {
                console.warn(`[dream] Summary references invalid IDs [${invalidSummaryIds.join(",")}] for tenant ${tenantId}, creating anyway`);
              }
            }
            const summaryData: InsertMemoryEntry = {
              fact: action.fact,
              category: action.category || "meta",
              source: "dream_consolidation",
              status: "active",
              personaId: null,
              tenantId,
            };
            const summaryEntry = await storage.createMemoryEntry(summaryData);
            const summaryEmb = await generateEmbedding(summaryEntry.fact);
            if (summaryEmb) {
              await storage.updateMemoryEmbedding(summaryEntry.id, summaryEmb);
              try { await storeEmbeddingVec("memory_entries", summaryEntry.id, summaryEmb); } catch { /* pgvector optional */ }
            }
            result.created++;
            console.log(`[dream] Created summary ID ${summaryEntry.id}: ${action.reason || ""}`);
            break;
          }
          default:
            console.warn(`[dream] Unknown action type: ${String((action as DreamAction).type)}`);
        }
      } catch (actionErr: unknown) {
        result.errors++;
        const msg = actionErr instanceof Error ? actionErr.message : String(actionErr);
        console.error(`[dream] Action failed (${action.type}):`, msg);
      }
    }

    const parts: string[] = [];
    if (result.merged > 0) parts.push(`${result.merged} merged`);
    if (result.archived > 0) parts.push(`${result.archived} archived`);
    if (result.promoted > 0) parts.push(`${result.promoted} promoted`);
    if (result.created > 0) parts.push(`${result.created} summaries created`);
    if (result.errors > 0) parts.push(`${result.errors} errors`);
    result.summary = parts.length > 0
      ? `Reviewed ${result.reviewed} memories: ${parts.join(", ")}.`
      : `Reviewed ${result.reviewed} memories: no changes needed.`;

  } catch (err: unknown) {
    result.errors++;
    const msg = err instanceof Error ? err.message : String(err);
    result.summary = `Dream consolidation failed: ${msg}`;
    console.error(`[dream] Fatal error:`, msg);
  }

  result.durationMs = Date.now() - start;
  console.log(`[dream] Complete (${result.durationMs}ms): ${result.summary}`);
  return result;
}
