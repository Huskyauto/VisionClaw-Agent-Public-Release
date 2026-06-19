import { db } from "./db";
import { sql } from "drizzle-orm";
import { generateEmbedding, cosineSimilarity, keywordSimilarity, cohereRerank, lostInTheMiddleReorder, diversityDedup } from "./embeddings";
import { runLlmTextTask } from "./llm-task";
import { saveHeadingTree } from "./doc-heading-tree";

const TARGET_CHUNK_TOKENS = 300;

// R98.27 — Anthropic Contextual Retrieval (Sep 2024).
// Per-chunk LLM-generated situating prefix that turns isolated chunks
// ("revenue grew 3%") into self-contained ones ("Q3 2024 revenue at Acme
// grew 3% YoY"). Reduces top-20 retrieval failure ~49% on Anthropic's
// benchmark. Stored in the existing doc_chunks.context column so the
// hybrid retriever (BM25 + vector + RRF) picks it up at query time.
//
// Cheap model only — gpt-5-mini at ~$0.0001/chunk. Document body is
// truncated to ~6k chars to keep latency bounded; full per-chunk
// retries on transient failures are NOT done (fail-open: missing
// context = original behavior, not worse).
const CHUNK_CONTEXT_DOC_BUDGET = 6000;
const CHUNK_CONTEXT_MAX_TOKENS = 80;
const CHUNK_CONTEXT_MODEL = "gpt-5-mini";

async function generateChunkContext(
  fullDoc: string,
  chunk: string,
  docTitle: string,
  tenantId: number,
): Promise<string> {
  const docSlice = fullDoc.length > CHUNK_CONTEXT_DOC_BUDGET
    ? fullDoc.slice(0, CHUNK_CONTEXT_DOC_BUDGET) + "\n…[truncated]…"
    : fullDoc;
  // R98.27.4 — XML-escape user-controlled values before interpolation so an
  // uploaded chunk containing `</chunk>...<system>do X</system>` cannot break
  // the delimiter and steer the contextualizer. Architect MEDIUM finding.
  const esc = (s: string): string => String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const prompt = `<document title="${esc(docTitle)}">\n${esc(docSlice)}\n</document>\n\n<chunk>\n${esc(chunk)}\n</chunk>\n\nGive a short succinct context (1–2 sentences) that situates the chunk within the overall document for the purposes of improving search retrieval. Answer with ONLY the context — no preamble, no quotes, no commentary.`;
  try {
    const r = await runLlmTextTask({
      prompt,
      model: CHUNK_CONTEXT_MODEL,
      temperature: 0.2,
      maxTokens: CHUNK_CONTEXT_MAX_TOKENS,
      timeoutMs: 15000,
      tenantId,
    });
    if (r.success && r.text) return r.text.trim().slice(0, 600);
    // success=false (model unavailable, rate limit, timeout): log once at warn
    // so operators see the failure without breaking ingest. Fail-open.
    if (r && !r.success) {
      console.warn(`[doc-collections] auto-contextualize failed: ${r.error || "unknown"}`);
    }
  } catch (e: any) {
    console.warn(`[doc-collections] auto-contextualize threw: ${e?.message || e}`);
  }
  return "";
}
const MAX_CHUNK_TOKENS = 500;
const CHUNK_OVERLAP_TOKENS = 50;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractTitle(content: string, path: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  const basename = path.split("/").pop() || path;
  return basename.replace(/\.(md|txt|markdown)$/i, "").replace(/[-_]/g, " ");
}

export function chunkDocument(content: string, docPath: string): Array<{ content: string; index: number }> {
  const chunks: Array<{ content: string; index: number }> = [];
  const lines = content.split("\n");
  let current: string[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  function flush() {
    if (current.length > 0) {
      chunks.push({ content: current.join("\n").trim(), index: chunkIndex++ });
      const overlapLines: string[] = [];
      let overlapTokens = 0;
      for (let i = current.length - 1; i >= 0 && overlapTokens < CHUNK_OVERLAP_TOKENS; i--) {
        overlapLines.unshift(current[i]);
        overlapTokens += estimateTokens(current[i]);
      }
      current = overlapLines;
      currentTokens = overlapTokens;
    }
  }

  for (const line of lines) {
    const lineTokens = estimateTokens(line);

    if (line.match(/^#{1,3}\s/) && currentTokens > 50) {
      flush();
    }

    if (currentTokens + lineTokens > MAX_CHUNK_TOKENS && currentTokens > 0) {
      flush();
    }

    current.push(line);
    currentTokens += lineTokens;

    if (currentTokens >= TARGET_CHUNK_TOKENS && line.trim() === "") {
      flush();
    }
  }

  if (current.length > 0) {
    const text = current.join("\n").trim();
    if (text) chunks.push({ content: text, index: chunkIndex });
  }

  return chunks;
}

export async function createCollection(name: string, description: string, tenantId: number): Promise<any> {
  const result = await db.execute(sql`
    INSERT INTO doc_collections (name, description, tenant_id)
    VALUES (${name}, ${description || ""}, ${tenantId})
    ON CONFLICT (name, tenant_id) DO UPDATE SET description = ${description || ""}
    RETURNING id, name, description
  `);
  const row = (result as any).rows?.[0];
  return row || { error: "Failed to create collection" };
}

export async function listCollections(tenantId: number): Promise<any> {
  const result = await db.execute(sql`
    SELECT c.id, c.name, c.description, c.created_at,
      (SELECT COUNT(*) FROM doc_chunks WHERE collection_id = c.id) as chunk_count,
      (SELECT COUNT(DISTINCT doc_path) FROM doc_chunks WHERE collection_id = c.id) as doc_count
    FROM doc_collections c
    WHERE c.tenant_id = ${tenantId}
    ORDER BY c.name
  `);
  return { collections: (result as any).rows || [] };
}

export async function deleteCollection(collectionId: number, tenantId: number): Promise<any> {
  await db.execute(sql`DELETE FROM doc_collections WHERE id = ${collectionId} AND tenant_id = ${tenantId}`);
  return { success: true, deleted: collectionId };
}

export async function addDocument(
  collectionId: number,
  docPath: string,
  content: string,
  contextStr: string,
  tenantId: number,
  options?: { autoContextualize?: boolean }
): Promise<any> {
  const collResult = await db.execute(sql`
    SELECT id FROM doc_collections WHERE id = ${collectionId} AND tenant_id = ${tenantId}
  `);
  if (!((collResult as any).rows?.length)) return { error: "Collection not found" };

  await db.execute(sql`
    DELETE FROM doc_chunks WHERE doc_path = ${docPath} AND collection_id = ${collectionId}
  `);

  const title = extractTitle(content, docPath);
  const chunks = chunkDocument(content, docPath);
  const auto = options?.autoContextualize === true;

  // R98.27 — when autoContextualize is on, generate per-chunk situating
  // prefixes in parallel (capped concurrency to stay friendly to provider
  // quotas). The caller-supplied contextStr is used as a fallback when
  // the LLM returns empty (fail-open) and as a per-document prefix.
  let perChunkContext: string[] = chunks.map(() => contextStr || "");
  let autoContextualized = 0;
  // R98.27 — cost guardrail. ~$0.0001/chunk × 500 chunks = $0.05/doc; beyond
  // that we degrade to caller-supplied contextStr so a runaway upload can't
  // burn LLM budget. Operators can raise via DOC_AUTOCONTEXT_MAX_CHUNKS.
  const AUTOCONTEXT_MAX_CHUNKS = Number(process.env.DOC_AUTOCONTEXT_MAX_CHUNKS) || 500;
  let autoSkippedReason: string | undefined;
  if (auto && chunks.length > AUTOCONTEXT_MAX_CHUNKS) {
    autoSkippedReason = `chunk count ${chunks.length} exceeds DOC_AUTOCONTEXT_MAX_CHUNKS=${AUTOCONTEXT_MAX_CHUNKS}`;
    console.warn(`[doc-collections] auto-contextualize skipped: ${autoSkippedReason}`);
  }
  if (auto && !autoSkippedReason) {
    const CONCURRENCY = 4;
    const results: string[] = new Array(chunks.length).fill("");
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);
      const out = await Promise.all(
        batch.map((c) => generateChunkContext(content, c.content, title, tenantId))
      );
      for (let j = 0; j < out.length; j++) results[i + j] = out[j];
    }
    for (let i = 0; i < chunks.length; i++) {
      const llmCtx = results[i];
      if (llmCtx) {
        autoContextualized++;
        perChunkContext[i] = contextStr ? `${contextStr}\n${llmCtx}` : llmCtx;
      }
    }
  }

  let inserted = 0;
  for (const chunk of chunks) {
    const tokenCount = estimateTokens(chunk.content);
    const ctx = perChunkContext[chunk.index] || contextStr || "";
    await db.execute(sql`
      INSERT INTO doc_chunks (collection_id, doc_path, doc_title, chunk_index, content, context, token_count, tenant_id)
      VALUES (${collectionId}, ${docPath}, ${title}, ${chunk.index}, ${chunk.content}, ${ctx}, ${tokenCount}, ${tenantId})
    `);
    inserted++;
  }

  // R105 — PageIndex nugget: build + persist a hierarchical heading tree
  // for this doc so personas can WALK it via `knowledge_navigate` instead of
  // relying purely on chunk-vector retrieval. Pure structural parsing — no
  // LLM cost. Skipped silently for short docs (< 3 headings). Fail-open: a
  // tree-build failure must NEVER block ingest.
  let headingTree: { stored: boolean; totalHeadings: number; totalLines: number } | undefined;
  try {
    headingTree = await saveHeadingTree({
      collectionId,
      docPath,
      docTitle: title,
      content,
      tenantId,
    });
  } catch (treeErr: any) {
    console.warn(`[doc-collections] heading-tree build failed (non-fatal): ${treeErr?.message || treeErr}`);
  }

  return {
    success: true,
    docPath,
    title,
    chunks: inserted,
    totalTokens: chunks.reduce((s, c) => s + estimateTokens(c.content), 0),
    autoContextualized: auto ? autoContextualized : undefined,
    autoSkipped: autoSkippedReason,
    headingTree: headingTree
      ? {
          stored: headingTree.stored,
          totalHeadings: headingTree.totalHeadings,
          totalLines: headingTree.totalLines,
        }
      : undefined,
  };
}

export async function removeDocument(collectionId: number, docPath: string, tenantId: number): Promise<any> {
  const result = await db.execute(sql`
    DELETE FROM doc_chunks WHERE doc_path = ${docPath} AND collection_id = ${collectionId} AND tenant_id = ${tenantId}
  `);
  // R105 — also drop the heading-tree row so navigate doesn't return stale TOCs
  // for a deleted doc. Tenant-scoped + collection+path scoped. Fail-open.
  try {
    await db.execute(sql`
      DELETE FROM doc_heading_trees
      WHERE doc_path = ${docPath} AND collection_id = ${collectionId} AND tenant_id = ${tenantId}
    `);
  } catch (treeErr: any) {
    console.warn(`[doc-collections] heading-tree cleanup failed (non-fatal): ${treeErr?.message || treeErr}`);
  }
  return { success: true, docPath, removed: (result as any).rowCount || 0 };
}

export async function addContext(collectionId: number, contextStr: string, tenantId: number): Promise<any> {
  await db.execute(sql`
    UPDATE doc_chunks SET context = ${contextStr}
    WHERE collection_id = ${collectionId} AND tenant_id = ${tenantId}
  `);
  return { success: true, collectionId, context: contextStr };
}

export async function generateCollectionEmbeddings(collectionId: number, tenantId: number): Promise<any> {
  const chunks = await db.execute(sql`
    SELECT id, content FROM doc_chunks
    WHERE collection_id = ${collectionId} AND tenant_id = ${tenantId} AND embedding IS NULL
    ORDER BY id
  `);
  const rows = (chunks as any).rows || [];
  if (!rows.length) return { success: true, embedded: 0, message: "All chunks already have embeddings" };

  let embedded = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const embedding = await generateEmbedding(row.content);
      if (embedding) {
        await db.execute(sql`UPDATE doc_chunks SET embedding = ${JSON.stringify(embedding)}::jsonb WHERE id = ${row.id}`);
        embedded++;
      } else {
        errors++;
      }
      await new Promise(r => setTimeout(r, 100));
    } catch {
      errors++;
    }
  }

  return { success: true, embedded, errors, total: rows.length };
}

// R115.6 — Result ordering contract: `results[0]` is always the most relevant
// chunk. For `mode: "hybrid" | "semantic"` the remaining items 1..N-1 are
// reordered via lost-in-the-middle (Liu et al. 2023): strongest chunks land
// at positions 0 and N-1, weakest in the middle, optimizing LLM head/tail
// attention bias when the array is concatenated into a context window.
// Callers that need strict best→worst relevance ranking (UI display of
// "top results", manual top-2 selection) MUST re-sort by `similarity` desc.
// Mode `"keyword"` returns BM25-ranked order unchanged.
export async function searchDocuments(
  query: string,
  tenantId: number,
  options: { collection?: string; mode?: "keyword" | "semantic" | "hybrid"; topK?: number; minScore?: number }
): Promise<any> {
  const { collection, mode = "keyword", topK = 10, minScore = 0.1 } = options;

  let whereClause = sql`dc.tenant_id = ${tenantId}`;
  if (collection) {
    whereClause = sql`dc.tenant_id = ${tenantId} AND c.name = ${collection}`;
  }

  const chunksResult = await db.execute(sql`
    SELECT dc.id, dc.doc_path, dc.doc_title, dc.chunk_index, dc.content, dc.context,
           dc.embedding, dc.token_count, c.name as collection_name
    FROM doc_chunks dc
    JOIN doc_collections c ON dc.collection_id = c.id
    WHERE ${whereClause}
    ORDER BY dc.doc_path, dc.chunk_index
  `);
  const chunks = (chunksResult as any).rows || [];

  if (!chunks.length) return { results: [], total: 0, query, mode, reranked: false };

  let queryEmbedding: number[] | null = null;
  if (mode === "semantic" || mode === "hybrid") {
    queryEmbedding = await generateEmbedding(query);
  }

  const scored = chunks.map((chunk: any) => {
    let score = 0;

    if (mode === "keyword") {
      score = keywordSimilarity(query, chunk.content);
      if (chunk.context) score += keywordSimilarity(query, chunk.context) * 0.3;
      if (chunk.doc_title) score += keywordSimilarity(query, chunk.doc_title) * 0.2;
    } else if (mode === "semantic" && queryEmbedding) {
      const chunkEmb = chunk.embedding as number[] | null;
      score = chunkEmb ? cosineSimilarity(queryEmbedding, chunkEmb) : 0;
    } else if (mode === "hybrid") {
      const kwScore = keywordSimilarity(query, chunk.content)
        + keywordSimilarity(query, chunk.context || "") * 0.3
        + keywordSimilarity(query, chunk.doc_title || "") * 0.2;

      let vecScore = 0;
      if (queryEmbedding) {
        const chunkEmb = chunk.embedding as number[] | null;
        vecScore = chunkEmb ? cosineSimilarity(queryEmbedding, chunkEmb) : 0;
      }

      score = kwScore * 0.4 + vecScore * 0.6;
    }

    return {
      docPath: chunk.doc_path,
      title: chunk.doc_title,
      collection: chunk.collection_name,
      chunkIndex: chunk.chunk_index,
      content: chunk.content,
      context: chunk.context || undefined,
      score: Math.round(score * 1000) / 1000,
      tokens: chunk.token_count,
    };
  });

  scored.sort((a: any, b: any) => b.score - a.score);
  const filtered = scored.filter((s: any) => s.score >= minScore);

  // R98.27 — Cohere Rerank cross-encoder pass on hybrid/semantic results.
  // Mirrors the wiring in vectorSearchKnowledge so doc_search benefits from
  // the same -49% → -67% top-K retrieval lift Anthropic measured. No-ops
  // (returns null) when COHERE_API_KEY is unset; we then keep the local
  // BM25+vector ordering. Keyword-only mode skips rerank — Cohere's strength
  // is semantic disambiguation, and adding a network round-trip to a pure
  // lexical lookup is a perf regression for no quality gain.
  let reranked: any[] | null = null;
  if ((mode === "hybrid" || mode === "semantic") && filtered.length > 0) {
    const rerankWindow = filtered.slice(0, Math.max(15, topK * 3)).map((s: any, i: number) => ({
      id: i,
      title: `${s.title || s.docPath} (${s.collection})`,
      content: `${s.context ? s.context + "\n" : ""}${s.content}`,
      __orig: s,
    }));
    const out = await cohereRerank(query, rerankWindow as any, topK);
    if (out) reranked = (out as any[]).map((r) => r.__orig);
  }

  // R115.6 — diversity dedup (trigram Jaccard ≥0.82) then lost-in-the-middle
  // reorder so strongest chunks land at positions 0 and N-1 of the returned
  // top-K window (LLMs attend best to head + tail in long contexts).
  const preSlice = reranked ?? filtered;
  const deduped = diversityDedup(preSlice, (s: any) => `${s.title || s.docPath || ""}\n${s.content || ""}`);
  const results = lostInTheMiddleReorder(deduped).slice(0, topK).map((r: any) => {
    const { __orig, ...clean } = r;
    return clean;
  });

  return {
    results,
    total: filtered.length,
    query,
    mode,
    reranked: reranked !== null,
  };
}

export async function getDocument(docPath: string, tenantId: number, collectionName?: string): Promise<any> {
  let chunks;
  if (collectionName) {
    chunks = await db.execute(sql`
      SELECT dc.doc_path, dc.doc_title, dc.chunk_index, dc.content, dc.context, c.name as collection_name
      FROM doc_chunks dc
      JOIN doc_collections c ON dc.collection_id = c.id
      WHERE dc.doc_path = ${docPath} AND dc.tenant_id = ${tenantId} AND c.name = ${collectionName}
      ORDER BY dc.chunk_index
    `);
  } else {
    chunks = await db.execute(sql`
      SELECT dc.doc_path, dc.doc_title, dc.chunk_index, dc.content, dc.context, c.name as collection_name
      FROM doc_chunks dc
      JOIN doc_collections c ON dc.collection_id = c.id
      WHERE dc.doc_path = ${docPath} AND dc.tenant_id = ${tenantId}
      ORDER BY dc.chunk_index
    `);
  }

  const rows = (chunks as any).rows || [];
  if (!rows.length) return { error: `Document not found: ${docPath}` };

  const fullContent = rows.map((r: any) => r.content).join("\n\n");
  return {
    docPath: rows[0].doc_path,
    title: rows[0].doc_title,
    collection: rows[0].collection_name,
    context: rows[0].context || undefined,
    chunks: rows.length,
    content: fullContent,
  };
}

export async function getCollectionStatus(tenantId: number): Promise<any> {
  const collections = await db.execute(sql`
    SELECT c.id, c.name, c.description,
      (SELECT COUNT(*) FROM doc_chunks WHERE collection_id = c.id) as chunk_count,
      (SELECT COUNT(DISTINCT doc_path) FROM doc_chunks WHERE collection_id = c.id) as doc_count,
      (SELECT COUNT(*) FROM doc_chunks WHERE collection_id = c.id AND embedding IS NOT NULL) as embedded_count,
      (SELECT SUM(token_count) FROM doc_chunks WHERE collection_id = c.id) as total_tokens
    FROM doc_collections c
    WHERE c.tenant_id = ${tenantId}
    ORDER BY c.name
  `);
  const rows = (collections as any).rows || [];
  return {
    collections: rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      documents: Number(r.doc_count),
      chunks: Number(r.chunk_count),
      embedded: Number(r.embedded_count),
      totalTokens: Number(r.total_tokens) || 0,
      embeddingCoverage: Number(r.chunk_count) > 0
        ? Math.round((Number(r.embedded_count) / Number(r.chunk_count)) * 100)
        : 0,
    })),
    totalDocuments: rows.reduce((s: number, r: any) => s + Number(r.doc_count), 0),
    totalChunks: rows.reduce((s: number, r: any) => s + Number(r.chunk_count), 0),
  };
}
