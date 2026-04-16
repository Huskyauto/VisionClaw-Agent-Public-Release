import OpenAI from "openai";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

let cachedOpenaiClient: OpenAI | null = null;
let lastKeyCheck = 0;

async function getOpenAIClient(): Promise<OpenAI | null> {
  const now = Date.now();
  if (cachedOpenaiClient && now - lastKeyCheck < 60_000) return cachedOpenaiClient;

  try {
    const key = await storage.getProviderKey("openai");
    if (key?.apiKey && key.enabled) {
      cachedOpenaiClient = new OpenAI({ apiKey: key.apiKey, baseURL: "https://api.openai.com/v1" });
      lastKeyCheck = now;
      return cachedOpenaiClient;
    }
  } catch {}
  cachedOpenaiClient = null;
  lastKeyCheck = now;
  return null;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had", "her",
  "was", "one", "our", "out", "has", "have", "been", "from", "this", "that",
  "with", "they", "will", "each", "make", "like", "just", "into", "over",
  "also", "some", "than", "them", "very", "when", "what", "your", "how",
  "about", "which", "their", "there", "would", "other", "more", "these",
  "then", "could", "does", "should",
]);

function buildBagOfWords(text: string): Map<string, number> {
  const tokens = tokenize(text).filter((t) => !STOP_WORDS.has(t));
  const bag = new Map<string, number>();
  for (const t of tokens) {
    bag.set(t, (bag.get(t) || 0) + 1);
  }
  return bag;
}

function bagCosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  for (const [word, count] of a) {
    normA += count * count;
    if (b.has(word)) dot += count * b.get(word)!;
  }
  for (const [, count] of b) normB += count * count;
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

const _embeddingCache = new Map<string, { embedding: number[]; ts: number }>();
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_SIZE = 50;

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const cleaned = text.slice(0, 8000).replace(/\n+/g, " ").trim();
    if (!cleaned) return null;

    const cacheKey = cleaned.slice(0, 200);
    const cached = _embeddingCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.embedding;
    }

    const client = await getOpenAIClient();
    if (!client) return null;

    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleaned,
    });

    const embedding = response.data[0]?.embedding ?? null;
    if (embedding) {
      if (_embeddingCache.size >= CACHE_MAX_SIZE) {
        const oldest = [..._embeddingCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) _embeddingCache.delete(oldest[0]);
      }
      _embeddingCache.set(cacheKey, { embedding, ts: Date.now() });
    }
    return embedding;
  } catch (err: any) {
    console.error("[embeddings] Failed to generate:", err.message);
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface EmbeddedItem {
  id: number;
  embedding: number[] | null;
}

export function keywordSimilarity(query: string, text: string): number {
  const qBag = buildBagOfWords(query);
  const tBag = buildBagOfWords(text);
  return bagCosineSimilarity(qBag, tBag);
}

export async function rankBySimilarity<T extends EmbeddedItem & { text?: string }>(
  query: string,
  items: T[],
  topK: number = 10,
): Promise<(T & { similarity: number })[]> {
  const queryEmbedding = await generateEmbedding(query);

  const scored = items.map((item) => {
    let similarity = 0;
    if (queryEmbedding && item.embedding) {
      similarity = cosineSimilarity(queryEmbedding, item.embedding);
    } else if (item.text) {
      similarity = keywordSimilarity(query, item.text);
    }
    return { ...item, similarity };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}

export async function generateAndStoreEmbeddings(
  items: { id: number; text: string }[],
  updateFn: (id: number, embedding: number[]) => Promise<void>,
): Promise<number> {
  let count = 0;
  for (const item of items) {
    const embedding = await generateEmbedding(item.text);
    if (embedding) {
      await updateFn(item.id, embedding);
      count++;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return count;
}

let _pgvectorReady = false;

export async function initPgVector(): Promise<void> {
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    await db.execute(sql`ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS embedding_vec vector(1536)`);
    await db.execute(sql`ALTER TABLE agent_knowledge ADD COLUMN IF NOT EXISTS embedding_vec vector(1536)`);
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_memory_embedding_vec ON memory_entries USING hnsw (embedding_vec vector_cosine_ops)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_knowledge_embedding_vec ON agent_knowledge USING hnsw (embedding_vec vector_cosine_ops)`));
    _pgvectorReady = true;
    console.log("[pgvector] Extension, columns, and HNSW indexes ready");

    const result = await backfillEmbeddingVecs();
    if (result.memories > 0 || result.knowledge > 0) {
      console.log(`[pgvector] Backfilled ${result.memories} memory + ${result.knowledge} knowledge embeddings`);
    }

    backfillMissingKnowledgeEmbeddings().catch(() => {});
  } catch (err: any) {
    console.warn("[pgvector] Setup failed (non-fatal, keyword search will be used):", err.message?.substring(0, 100));
    _pgvectorReady = false;
  }
}

function vecLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function vectorSearchMemory(
  query: string,
  opts: { personaId?: number; tenantId?: number; topK?: number; threshold?: number; wing?: string; room?: string } = {},
): Promise<{ id: number; fact: string; category: string; wing?: string; room?: string; similarity: number }[]> {
  if (!_pgvectorReady) return keywordSearchMemory(query, opts);
  const { personaId, tenantId = 1, topK = 10, threshold = 0.3, wing, room } = opts;
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    return keywordSearchMemory(query, opts);
  }

  const vec = vecLiteral(queryEmbedding);
  const personaFilter = personaId != null
    ? sql`AND persona_id = ${personaId}`
    : sql``;
  const wingFilter = wing ? sql`AND wing = ${wing}` : sql``;
  const roomFilter = room ? sql`AND room = ${room}` : sql``;

  const rows = await db.execute(sql`
    SELECT id, fact, category, wing, room, status, access_count,
           1 - (embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}) AS similarity
    FROM memory_entries
    WHERE status = 'active'
      AND tenant_id = ${tenantId}
      AND embedding_vec IS NOT NULL
      ${personaFilter}
      ${wingFilter}
      ${roomFilter}
    ORDER BY embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}
    LIMIT ${topK}
  `);

  return (rows.rows as any[])
    .filter((r: any) => r.similarity >= threshold)
    .map((r: any) => ({
      id: r.id,
      fact: r.fact,
      category: r.category,
      wing: r.wing || undefined,
      room: r.room || undefined,
      similarity: Math.round(r.similarity * 1000) / 1000,
    }));
}

export async function vectorSearchKnowledge(
  query: string,
  opts: { personaId?: number; tenantId?: number; topK?: number; threshold?: number } = {},
): Promise<{ id: number; title: string; content: string; category: string; similarity: number }[]> {
  if (!_pgvectorReady) return keywordSearchKnowledge(query, opts);
  const { personaId, tenantId = 1, topK = 10, threshold = 0.3 } = opts;
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    return keywordSearchKnowledge(query, opts);
  }

  const vec = vecLiteral(queryEmbedding);
  const personaFilter = personaId != null
    ? sql`AND persona_id = ${personaId}`
    : sql``;

  const rows = await db.execute(sql`
    SELECT id, title, content, category, priority,
           1 - (embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}) AS similarity
    FROM agent_knowledge
    WHERE (expires_at IS NULL OR expires_at > NOW())
      AND tenant_id = ${tenantId}
      AND embedding_vec IS NOT NULL
      ${personaFilter}
    ORDER BY embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}
    LIMIT ${topK}
  `);

  return (rows.rows as any[])
    .filter((r: any) => r.similarity >= threshold)
    .map((r: any) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      category: r.category,
      priority: r.priority ?? 3,
      similarity: Math.round(r.similarity * 1000) / 1000,
    }));
}

async function keywordSearchMemory(
  query: string,
  opts: { personaId?: number; tenantId?: number; topK?: number; threshold?: number } = {},
): Promise<{ id: number; fact: string; category: string; similarity: number }[]> {
  const { personaId, tenantId = 1, topK = 10 } = opts;
  const allMemories = await storage.getMemoryEntries(personaId, 500, 0, tenantId);
  const q = query.toLowerCase();
  return allMemories.data
    .filter((m) => m.status === "active")
    .map((m) => ({ id: m.id, fact: m.fact, category: m.category, similarity: keywordSimilarity(query, m.fact) }))
    .filter((m) => m.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

async function keywordSearchKnowledge(
  query: string,
  opts: { personaId?: number; tenantId?: number; topK?: number; threshold?: number } = {},
): Promise<{ id: number; title: string; content: string; category: string; similarity: number }[]> {
  const { personaId, tenantId = 1, topK = 10 } = opts;
  const knowledge = await storage.getKnowledge(personaId, 500, 0, tenantId);
  return knowledge.data
    .map((k) => ({ id: k.id, title: k.title, content: k.content, category: k.category, similarity: keywordSimilarity(query, `${k.title} ${k.content}`) }))
    .filter((k) => k.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

export async function storeEmbeddingVec(table: "memory_entries" | "agent_knowledge", id: number, embedding: number[]): Promise<void> {
  if (!_pgvectorReady) return;
  const vec = vecLiteral(embedding);
  await db.execute(sql`UPDATE ${sql.raw(table)} SET embedding_vec = ${sql.raw(`'${vec}'::vector`)}, embedding = ${JSON.stringify(embedding)}::jsonb WHERE id = ${id}`);
}

async function backfillMissingKnowledgeEmbeddings(): Promise<void> {
  const rows = await db.execute(sql`
    SELECT id, title, content FROM agent_knowledge
    WHERE embedding IS NULL AND source = 'autoresearch'
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 50
  `);
  const entries = (rows as any).rows || rows;
  if (!entries || entries.length === 0) return;
  console.log(`[pgvector] Backfilling ${entries.length} research findings with embeddings...`);
  let count = 0;
  for (const entry of entries) {
    try {
      const text = `${entry.title} ${entry.content}`.slice(0, 6000);
      const emb = await generateEmbedding(text);
      if (emb) {
        await storeEmbeddingVec("agent_knowledge", entry.id, emb);
        count++;
      }
      await new Promise(r => setTimeout(r, 200));
    } catch {}
  }
  if (count > 0) console.log(`[pgvector] Backfilled ${count} research finding embeddings`);
}

export async function backfillEmbeddingVecs(): Promise<{ memories: number; knowledge: number }> {
  let memories = 0;
  let knowledge = 0;

  const memRows = await db.execute(sql`
    SELECT id, embedding FROM memory_entries
    WHERE embedding IS NOT NULL AND embedding_vec IS NULL AND status = 'active'
    LIMIT 200
  `);
  for (const row of memRows.rows as any[]) {
    try {
      const emb = typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding;
      if (Array.isArray(emb) && emb.length === EMBEDDING_DIMENSIONS) {
        const vec = vecLiteral(emb);
        await db.execute(sql`UPDATE memory_entries SET embedding_vec = ${sql.raw(`'${vec}'::vector`)} WHERE id = ${row.id}`);
        memories++;
      }
    } catch {}
  }

  const knRows = await db.execute(sql`
    SELECT id, embedding FROM agent_knowledge
    WHERE embedding IS NOT NULL AND embedding_vec IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 200
  `);
  for (const row of knRows.rows as any[]) {
    try {
      const emb = typeof row.embedding === "string" ? JSON.parse(row.embedding) : row.embedding;
      if (Array.isArray(emb) && emb.length === EMBEDDING_DIMENSIONS) {
        const vec = vecLiteral(emb);
        await db.execute(sql`UPDATE agent_knowledge SET embedding_vec = ${sql.raw(`'${vec}'::vector`)} WHERE id = ${row.id}`);
        knowledge++;
      }
    } catch {}
  }

  return { memories, knowledge };
}
