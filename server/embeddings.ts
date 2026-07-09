import OpenAI from "openai";
import { createMeteredOpenAIClient } from "./providers";
import { storage } from "./storage";
import { db } from "./db";
import { sql } from "drizzle-orm";

import { logSilentCatch } from "./lib/silent-catch";
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
      // Round 35 — was `new OpenAI(...)` (raw); now routed through the
      // metered factory so embeddings.create lands in the cost ledger.
      // R94 — embeddings are called from per-tenant indexing paths; tenant
      // context is supplied via the call signature, but the cached client is
      // process-wide. Cost is recorded per-call inside the patched create()
      // via the providers tenant resolver, which already handles missing
      // tenantId by warning + falling back to ADMIN_TENANT_ID.
      cachedOpenaiClient = createMeteredOpenAIClient({
        apiKey: key.apiKey,
        baseURL: "https://api.openai.com/v1",
        providerLabel: "openai-embeddings",
      });
      lastKeyCheck = now;
      return cachedOpenaiClient;
    }
  } catch (_silentErr) { logSilentCatch("server/embeddings.ts", _silentErr); }
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
  // R125+13.16+sec — architect HIGH-2: validate runtime shape before
  // interpolating into sql.raw(). Defends against a poisoned provider
  // response (or future caller) reaching the interpolation site with a
  // non-numeric string. Throws loud rather than silently constructing
  // malformed/injection-vector literal.
  if (!Array.isArray(embedding) || !embedding.every((n) => Number.isFinite(n))) {
    throw new Error(`vecLiteral: invalid embedding shape (expected number[], got ${typeof embedding} len=${(embedding as any)?.length ?? "n/a"})`);
  }
  return `[${embedding.join(",")}]`;
}

export async function vectorSearchMemory(
  query: string,
  opts: { personaId?: number; tenantId: number; topK?: number; threshold?: number; wing?: string; room?: string },
): Promise<{ id: number; fact: string; category: string; wing?: string; room?: string; similarity: number }[]> {
  // R54.D: tenantId required — silent default-to-admin would leak cross-tenant memories
  if (!opts.tenantId) {
    console.warn("[vectorSearchMemory] called without tenantId — refusing to search (R54.D)");
    return [];
  }
  if (!_pgvectorReady) return keywordSearchMemory(query, opts);
  const { personaId, tenantId, topK = 10, threshold = 0.3, wing, room } = opts;
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

  // Hybrid retrieval (inspired by OpenSwarm):
  //   score = 0.55 * similarity + 0.20 * importance + 0.15 * recency + 0.10 * frequency
  // - similarity:  cosine similarity (already 0..1)
  // - importance:  pinned/high-priority memories get a boost (0 or 1)
  // - recency:     exponential decay over 14 days from last_accessed
  // - frequency:   log-normalized access_count, capped at 50 hits
  // We over-fetch by 4x then re-rank, so a frequently-used memory of slightly
  // lower vector similarity can still beat a never-touched random hit.
  const overFetch = topK * 4;
  const rows = await db.execute(sql`
    WITH scored AS (
      SELECT id, fact, category, wing, room, status, access_count, last_accessed, created_at,
             1 - (embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}) AS similarity
      FROM memory_entries
      WHERE status = 'active'
        AND tenant_id = ${tenantId}
        AND embedding_vec IS NOT NULL
        ${personaFilter}
        ${wingFilter}
        ${roomFilter}
      ORDER BY embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}
      LIMIT ${overFetch}
    )
    SELECT *,
           (0.55 * similarity)
         + (0.20 * CASE WHEN COALESCE(access_count, 0) >= 5 THEN 1.0 ELSE 0.0 END)
         + (0.15 * COALESCE(EXP(-1 * EXTRACT(EPOCH FROM (NOW() - COALESCE(last_accessed, created_at, NOW() - INTERVAL '14 days'))) / (14 * 86400)), 0.0))
         + (0.10 * LEAST(LN(COALESCE(access_count, 0) + 1) / LN(51), 1.0))
           AS hybrid_score
    FROM scored
    ORDER BY hybrid_score DESC
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

// -----------------------------------------------------------------------------
// HYBRID RETRIEVAL — vector + BM25 fused with reciprocal-rank fusion (RRF).
//
// Pure cosine similarity misses exact-token matches that don't co-locate in
// embedding space ("STOOQ_API_KEY", "R54.D", part numbers, dosing strings).
// Postgres FTS via the new tsv column (R61 migration) catches those. We run
// both queries in parallel, then merge with RRF (k=60, the de-facto default
// from the BM25/dense-retrieval literature) to produce a single ranked list.
//
// RRF score for an item present at rank r in list i: sum_i 1/(k + r_i).
// Items missing from a list contribute 0 from that list. This is robust to
// score-scale differences between the two retrievers (cosine ∈[0,1] vs
// ts_rank_cd unbounded), which is why it beats naive weighted sum.
// -----------------------------------------------------------------------------
const RRF_K = 60;

// R98.27 — Cohere Rerank cross-encoder pass on top of RRF.
// Anthropic Contextual Retrieval (Sep 2024) reports top-20 retrieval failure
// drops from -49% (RRF only) to -67% when a rerank step is added. We oversample
// the RRF output, send it to Cohere Rerank v3.5, then return the rerank-ordered
// top K. Skipped silently when COHERE_API_KEY is unset (current behavior — RRF
// fusion ranking is preserved). Fails OPEN: any rerank error returns the
// pre-rerank ordering unchanged.
const COHERE_RERANK_TIMEOUT_MS = 6000;

export async function cohereRerank<T extends { id: number; title: string; content: string }>(
  query: string,
  candidates: T[],
  topN: number,
): Promise<T[] | null> {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey || candidates.length === 0) return null;
  const model = process.env.COHERE_RERANK_MODEL || "rerank-v3.5";
  const documents = candidates.map((c) => `${c.title}\n${c.content}`.slice(0, 4000));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), COHERE_RERANK_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.cohere.com/v2/rerank", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, query, documents, top_n: Math.min(topN, candidates.length) }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[hybrid] cohere rerank HTTP ${res.status} — falling back to RRF order`);
      return null;
    }
    const json: any = await res.json();
    const results: Array<{ index: number; relevance_score: number }> = Array.isArray(json?.results) ? json.results : [];
    if (results.length === 0) return null;
    const valid = results.filter((r) => r.index >= 0 && r.index < candidates.length);
    // If every returned index was invalid, treat as failure and fall back
    // to RRF order rather than collapsing the result set to [].
    if (valid.length === 0) return null;
    // R98.27.2 — first-seen dedup across the entire reordered array.
    // Cohere can return duplicate indices in malformed responses; we want
    // each candidate at most once, with valid-rerank ordering up front and
    // RRF tail filling out to topN.
    const seen = new Set<number>();
    const reordered: T[] = [];
    for (const r of valid) {
      if (reordered.length >= topN) break;
      const c = candidates[r.index];
      if (!seen.has(c.id)) {
        reordered.push(c);
        seen.add(c.id);
      }
    }
    // Partial-valid backfill: pad from the original RRF order so callers
    // never receive fewer results than expected when good local candidates
    // exist.
    if (reordered.length < topN) {
      for (const c of candidates) {
        if (reordered.length >= topN) break;
        if (!seen.has(c.id)) {
          reordered.push(c);
          seen.add(c.id);
        }
      }
    }
    return reordered.slice(0, topN);
  } catch (e: any) {
    if (e?.name !== "AbortError") {
      console.warn(`[hybrid] cohere rerank failed: ${e?.message || e}`);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// R115.6 — Reranker post-processing (lost-in-the-middle + diversity dedup)
// extracted to `./lib/rerank-postprocess` so the test suite can import the
// pure helpers without pulling in the DB pool. Re-exported here for back-compat
// with existing callers in doc-collections.ts.
import { lostInTheMiddleReorder, diversityDedup } from "./lib/rerank-postprocess";
export { lostInTheMiddleReorder, diversityDedup };

function rrfMerge<T extends { id: number }>(lists: T[][]): Map<number, number> {
  const scores = new Map<number, number>();
  for (const list of lists) {
    list.forEach((item, idx) => {
      const prev = scores.get(item.id) ?? 0;
      scores.set(item.id, prev + 1 / (RRF_K + idx + 1));
    });
  }
  return scores;
}

// R125+3.8 — BM25/FTS tier for memory_entries (mirrors bm25SearchKnowledge).
// Closes the abmind "three-tier search" gap by giving searchMemory a literal-
// token retriever that vector cosine misses (SKUs, error codes, person names,
// version strings). Backed by memory_entries.tsv (GENERATED ALWAYS, STORED) +
// memory_entries_tsv_gin_idx — both added via psql ALTER 2026-05-23 (R125+3.8).
async function bm25SearchMemory(
  query: string,
  opts: { personaId?: number; tenantId: number; topK?: number; wing?: string; room?: string },
): Promise<{ id: number; fact: string; category: string; wing?: string; room?: string; rank: number }[]> {
  const { personaId, tenantId, topK = 10, wing, room } = opts;
  const personaFilter = personaId != null ? sql`AND persona_id = ${personaId}` : sql``;
  const wingFilter = wing ? sql`AND wing = ${wing}` : sql``;
  const roomFilter = room ? sql`AND room = ${room}` : sql``;
  const rows = await db.execute(sql`
    WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS tsq)
    SELECT m.id, m.fact, m.category, m.wing, m.room,
           ts_rank_cd(m.tsv, q.tsq) AS rank
    FROM memory_entries m, q
    WHERE m.tsv @@ q.tsq
      AND m.status = 'active'
      AND m.deleted_at IS NULL
      AND m.tenant_id = ${tenantId}
      ${personaFilter}
      ${wingFilter}
      ${roomFilter}
    ORDER BY rank DESC
    LIMIT ${topK}
  `);
  return (rows.rows as any[]).map((r) => ({
    id: r.id,
    fact: r.fact,
    category: r.category,
    wing: r.wing || undefined,
    room: r.room || undefined,
    rank: Number(r.rank) || 0,
  }));
}

// R125+3.8 — Hybrid memory search: vector + BM25 fused with RRF (k=60).
// Pure vector misses literal-token matches ("STOOQ_API_KEY", "R54.D", part
// numbers, dosing strings) when they don't co-locate in embedding space.
// FTS catches those. Mirrors the proven pattern from vectorSearchKnowledge.
// Falls back to existing vectorSearchMemory behavior if BM25 throws (which
// it shouldn't — the tsv column is GENERATED ALWAYS so it's never null on
// a row with a fact). If BOTH come back empty, falls back to keywordSearchMemory.
export async function hybridSearchMemory(
  query: string,
  opts: { personaId?: number; tenantId: number; topK?: number; threshold?: number; wing?: string; room?: string },
): Promise<{ id: number; fact: string; category: string; wing?: string; room?: string; similarity: number; retrieval?: "vector" | "bm25" | "hybrid" }[]> {
  if (!opts.tenantId) {
    console.warn("[hybridSearchMemory] called without tenantId — refusing to search (R54.D)");
    return [];
  }
  const { topK = 10 } = opts;
  const oversample = Math.max(topK * 3, 15);

  const [bm25Results, vectorResults] = await Promise.all([
    bm25SearchMemory(query, { ...opts, topK: oversample }).catch((e) => {
      console.warn(`[hybridSearchMemory] bm25 failed: ${e.message}`);
      return [] as Awaited<ReturnType<typeof bm25SearchMemory>>;
    }),
    vectorSearchMemory(query, { ...opts, topK: oversample }).catch((e) => {
      console.warn(`[hybridSearchMemory] vector failed: ${e.message}`);
      return [] as Awaited<ReturnType<typeof vectorSearchMemory>>;
    }),
  ]);

  if (bm25Results.length === 0 && vectorResults.length === 0) {
    return keywordSearchMemory(query, opts);
  }

  // Build the catalog of unique candidates, tagging retrieval source.
  type Cand = { id: number; fact: string; category: string; wing?: string; room?: string; similarity: number; inVec: boolean; inBm: boolean };
  const catalog = new Map<number, Cand>();
  for (const r of vectorResults) {
    catalog.set(r.id, { id: r.id, fact: r.fact, category: r.category, wing: r.wing, room: r.room, similarity: r.similarity, inVec: true, inBm: false });
  }
  for (const r of bm25Results) {
    const prev = catalog.get(r.id);
    if (prev) prev.inBm = true;
    else catalog.set(r.id, { id: r.id, fact: r.fact, category: r.category, wing: r.wing, room: r.room, similarity: 0, inVec: false, inBm: true });
  }

  const fused = rrfMerge<{ id: number }>([vectorResults, bm25Results]);
  const ranked = Array.from(catalog.values())
    .map((row) => ({ ...row, score: fused.get(row.id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return ranked.map((r) => ({
    id: r.id,
    fact: r.fact,
    category: r.category,
    wing: r.wing,
    room: r.room,
    similarity: r.similarity,
    retrieval: r.inVec && r.inBm ? "hybrid" : r.inVec ? "vector" : "bm25",
  }));
}

async function bm25SearchKnowledge(
  query: string,
  opts: { personaId?: number; tenantId: number; topK?: number; includeGlobal?: boolean },
): Promise<{ id: number; title: string; content: string; category: string; priority: number; rank: number }[]> {
  const { personaId, tenantId, topK = 10, includeGlobal = false } = opts;
  const personaFilter = personaId != null
    ? (includeGlobal
        ? sql`AND (persona_id = ${personaId} OR persona_id IS NULL)`
        : sql`AND persona_id = ${personaId}`)
    : sql``;
  // websearch_to_tsquery is the most forgiving tsquery builder — handles
  // free-form user input, quoted phrases, AND/OR, without throwing on stray
  // punctuation (which plainto_tsquery does fine but websearch_to_tsquery is
  // even more forgiving). Available in PG 11+.
  const rows = await db.execute(sql`
    WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS tsq)
    SELECT k.id, k.title, k.content, k.category, k.priority,
           ts_rank_cd(k.tsv, q.tsq) AS rank
    FROM agent_knowledge k, q
    WHERE k.tsv @@ q.tsq
      AND (k.expires_at IS NULL OR k.expires_at > NOW())
      AND k.tenant_id = ${tenantId}
      ${personaFilter}
    ORDER BY rank DESC
    LIMIT ${topK}
  `);
  return (rows.rows as any[]).map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    category: r.category,
    priority: r.priority ?? 3,
    rank: Number(r.rank) || 0,
  }));
}

export async function vectorSearchKnowledge(
  query: string,
  opts: { personaId?: number; tenantId: number; topK?: number; threshold?: number; includeGlobal?: boolean },
): Promise<{ id: number; title: string; content: string; category: string; similarity: number; priority?: number; retrieval?: "vector" | "bm25" | "hybrid" }[]> {
  // R54.D: tenantId required — silent default-to-admin would leak admin knowledge to all tenants
  if (!opts.tenantId) {
    console.warn("[vectorSearchKnowledge] called without tenantId — refusing to search (R54.D)");
    return [];
  }
  const { personaId, tenantId, topK = 10, threshold = 0.3, includeGlobal = false } = opts;
  const oversample = Math.max(topK * 3, 15);

  // Run BM25 + vector in parallel. BM25 always works (no API call); vector
  // can fail if pgvector is down or the OpenAI key is missing — in which
  // case we still ship the BM25 results.
  const personaFilter = personaId != null
    ? (includeGlobal
        ? sql`AND (persona_id = ${personaId} OR persona_id IS NULL)`
        : sql`AND persona_id = ${personaId}`)
    : sql``;

  const [bm25Results, vectorResults] = await Promise.all([
    bm25SearchKnowledge(query, { personaId, tenantId, topK: oversample, includeGlobal }).catch((e) => {
      console.warn(`[hybrid] bm25 failed: ${e.message}`);
      return [] as Awaited<ReturnType<typeof bm25SearchKnowledge>>;
    }),
    (async () => {
      if (!_pgvectorReady) return [];
      const queryEmbedding = await generateEmbedding(query);
      if (!queryEmbedding) return [];
      const vec = vecLiteral(queryEmbedding);
      const rows = await db.execute(sql`
        SELECT id, title, content, category, priority,
               1 - (embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}) AS similarity
        FROM agent_knowledge
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND tenant_id = ${tenantId}
          AND embedding_vec IS NOT NULL
          ${personaFilter}
        ORDER BY embedding_vec <=> ${sql.raw(`'${vec}'::vector`)}
        LIMIT ${oversample}
      `);
      return (rows.rows as any[])
        .filter((r) => Number(r.similarity) >= threshold)
        .map((r) => ({
          id: r.id as number,
          title: r.title as string,
          content: r.content as string,
          category: r.category as string,
          priority: (r.priority ?? 3) as number,
          similarity: Number(r.similarity),
        }));
    })().catch((e) => {
      console.warn(`[hybrid] vector failed: ${e.message}`);
      return [] as { id: number; title: string; content: string; category: string; priority: number; similarity: number }[];
    }),
  ]);

  // If both retrievers struck out, fall back to the JS keyword tier so callers
  // still get *something* back (preserves prior behavior).
  if (bm25Results.length === 0 && vectorResults.length === 0) {
    return keywordSearchKnowledge(query, opts);
  }

  // Build the catalog of unique candidates and compute RRF.
  const catalog = new Map<number, { id: number; title: string; content: string; category: string; priority: number; inVec: boolean; inBm: boolean }>();
  for (const r of vectorResults) {
    catalog.set(r.id, { id: r.id, title: r.title, content: r.content, category: r.category, priority: r.priority, inVec: true, inBm: false });
  }
  for (const r of bm25Results) {
    const prev = catalog.get(r.id);
    if (prev) prev.inBm = true;
    else catalog.set(r.id, { id: r.id, title: r.title, content: r.content, category: r.category, priority: r.priority, inVec: false, inBm: true });
  }

  const fused = rrfMerge<{ id: number }>([vectorResults, bm25Results]);
  const fusedSorted = Array.from(catalog.values())
    .map((row) => ({ ...row, score: fused.get(row.id) ?? 0 }))
    .sort((a, b) => b.score - a.score);

  // R98.27 — optional cross-encoder rerank. Oversample the RRF output to
  // 3*topK then let Cohere reorder the top window. If rerank is disabled
  // or fails, we fall back to the pre-rerank RRF ordering.
  const rerankWindow = fusedSorted.slice(0, Math.max(topK * 3, 15));
  const reranked = await cohereRerank(query, rerankWindow, topK);
  // R115.6 — diversity dedup (trigram Jaccard ≥0.82) then lost-in-the-middle
  // reorder so strongest chunks land at positions 0 and N-1.
  const deduped = diversityDedup(reranked ?? fusedSorted, (r: any) => `${r.title}\n${r.content}`);
  const ranked = lostInTheMiddleReorder(deduped).slice(0, topK);

  return ranked.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    category: r.category,
    priority: r.priority,
    // Map RRF score back into the [0,1]-ish "similarity" slot callers expect.
    // RRF max for K=60 with item at rank 1 in both lists is 2/61 ≈ 0.0328 —
    // normalize so consumers' relative ordering / display still works.
    similarity: Math.round(Math.min(1, r.score * 30) * 1000) / 1000,
    retrieval: r.inVec && r.inBm ? "hybrid" : r.inVec ? "vector" : "bm25",
  }));
}

async function keywordSearchMemory(
  query: string,
  opts: { personaId?: number; tenantId?: number; topK?: number; threshold?: number } = {},
): Promise<{ id: number; fact: string; category: string; similarity: number }[]> {
  // R54.F: was `tenantId = 1` — same admin-default backdoor as vectorSearchMemory had.
  // pgvector down or embedding fail would silently leak admin tenant to all callers.
  if (!opts.tenantId) {
    console.warn("[keywordSearchMemory] called without tenantId — refusing fallback search (R54.F)");
    return [];
  }
  const { personaId, tenantId, topK = 10 } = opts;
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
  // R54.F: was `tenantId = 1` — same admin-default backdoor as vectorSearchKnowledge had.
  if (!opts.tenantId) {
    console.warn("[keywordSearchKnowledge] called without tenantId — refusing fallback search (R54.F)");
    return [];
  }
  const { personaId, tenantId, topK = 10 } = opts;
  const knowledge = await storage.getKnowledge(personaId, 500, 0, tenantId);
  return knowledge.data
    .map((k) => ({ id: k.id, title: k.title, content: k.content, category: k.category, similarity: keywordSimilarity(query, `${k.title} ${k.content}`) }))
    .filter((k) => k.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

// R79.3 loaded-gun guard: TypeScript narrows `table` to two literals at
// compile time but the runtime sees a plain string sunk into sql.raw().
// Callers from `any`-typed contexts (tool handlers, JSON router payloads)
// could bypass the type narrowing — runtime allowlist closes that gap.
const ALLOWED_EMBEDDING_TABLES: ReadonlySet<string> = new Set([
  "memory_entries",
  "agent_knowledge",
]);

export async function storeEmbeddingVec(table: "memory_entries" | "agent_knowledge", id: number, embedding: number[]): Promise<void> {
  if (!_pgvectorReady) return;
  if (!ALLOWED_EMBEDDING_TABLES.has(table)) {
    throw new Error(`storeEmbeddingVec: table "${table}" not in allowlist (R79.3 SQL-injection guard)`);
  }
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
    } catch (_silentErr) { logSilentCatch("server/embeddings.ts", _silentErr); }
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
    } catch (_silentErr) { logSilentCatch("server/embeddings.ts", _silentErr); }
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
    } catch (_silentErr) { logSilentCatch("server/embeddings.ts", _silentErr); }
  }

  return { memories, knowledge };
}
