import { db } from "./db";
import { sql } from "drizzle-orm";
import { generateEmbedding, cosineSimilarity, keywordSimilarity } from "./embeddings";

const TARGET_CHUNK_TOKENS = 300;
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
  tenantId: number
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

  let inserted = 0;
  for (const chunk of chunks) {
    const tokenCount = estimateTokens(chunk.content);
    await db.execute(sql`
      INSERT INTO doc_chunks (collection_id, doc_path, doc_title, chunk_index, content, context, token_count, tenant_id)
      VALUES (${collectionId}, ${docPath}, ${title}, ${chunk.index}, ${chunk.content}, ${contextStr || ""}, ${tokenCount}, ${tenantId})
    `);
    inserted++;
  }

  return { success: true, docPath, title, chunks: inserted, totalTokens: chunks.reduce((s, c) => s + estimateTokens(c.content), 0) };
}

export async function removeDocument(collectionId: number, docPath: string, tenantId: number): Promise<any> {
  const result = await db.execute(sql`
    DELETE FROM doc_chunks WHERE doc_path = ${docPath} AND collection_id = ${collectionId} AND tenant_id = ${tenantId}
  `);
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

  if (!chunks.length) return { results: [], total: 0, query, mode };

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

  return {
    results: filtered.slice(0, topK),
    total: filtered.length,
    query,
    mode,
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
