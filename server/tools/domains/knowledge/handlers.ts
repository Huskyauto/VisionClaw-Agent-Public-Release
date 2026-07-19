/**
 * Tools-layer-split S8 — knowledge-domain migrated handlers.
 *
 * Selection per plan.md smallest-safe-batch precedent (S3): the 7 PURE
 * knowledge tools migrate — `search_knowledge`, `knowledge_navigate`,
 * `create_knowledge`, `store_triple`, `query_triples`, `expire_triple`,
 * `doc_search`. Their trust needs fit the existing ToolContext exactly
 * (tenantId). Mixed-category knowledge-adjacent tools (recall_capabilities,
 * query_communities/causal, chunk_code, get_daily_notes, ingest_paper,
 * academic_search, fetch_wikipedia, outlook_*) stay in the legacy switch
 * for later slices.
 *
 * The module-scope helpers `storeTriple`, `queryTriples`, `expireTriple`,
 * `searchKnowledge`, and `createKnowledge` moved here with their handlers —
 * the legacy switch arms were their ONLY call sites (census-verified;
 * helper-census.md "Memory"/"Knowledge" groups). The `doc-collections`
 * static import (10 functions, all exclusively owned by the doc_search arm)
 * became a call-time dynamic import here. Handler bodies are MECHANICAL
 * moves of the legacy switch arms (standing rules: no renames, no behavior
 * change). App-module imports are DYNAMIC (call-time), mirroring the legacy
 * arms and preserving the package acyclic static import graph.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import {
  searchKnowledgeDefinition,
  knowledgeNavigateDefinition,
  createKnowledgeDefinition,
  storeTripleDefinition,
  queryTriplesDefinition,
  expireTripleDefinition,
  docSearchDefinition,
} from "./definitions";

// ---------------------------------------------------------------------------
// Module-scope helpers moved from server/tools.ts (legacy switch was the only
// caller). Bodies verbatim except: storage/db/embeddings/silent-catch imports
// are call-time dynamic (package acyclicity).
// ---------------------------------------------------------------------------

async function storeTriple(params: Record<string, any>, tenantId: number) {
  const { storage } = await import("../../../storage");
  const { db } = await import("../../../db");
  const { sql } = await import("drizzle-orm");
  if (!params.subject || !params.predicate || !params.object) {
    return { error: "subject, predicate, and object are required" };
  }
  const persona = await storage.getActivePersona();
  const validFrom = params.valid_from ? new Date(params.valid_from) : new Date();
  const validUntil = params.valid_until ? new Date(params.valid_until) : null;
  if (isNaN(validFrom.getTime())) return { error: "Invalid valid_from date" };
  if (validUntil && isNaN(validUntil.getTime())) return { error: "Invalid valid_until date" };
  const confidence = typeof params.confidence === "number" ? Math.max(0, Math.min(1, params.confidence)) : 1.0;

  const existing = await db.execute(sql`
    SELECT id FROM knowledge_triples
    WHERE subject = ${params.subject}
      AND predicate = ${params.predicate}
      AND object = ${params.object}
      AND tenant_id = ${tenantId}
      AND valid_until IS NULL
    LIMIT 1
  `);
  const existingRows = (existing as any).rows || existing;
  if (existingRows.length > 0) {
    return { skipped: true, id: existingRows[0].id, message: "Identical active triple already exists" };
  }

  const contradictions = await db.execute(sql`
    SELECT id, subject, predicate, object, valid_from
    FROM knowledge_triples
    WHERE subject = ${params.subject}
      AND predicate = ${params.predicate}
      AND tenant_id = ${tenantId}
      AND valid_until IS NULL
    ORDER BY valid_from DESC
  `);
  const contradictionRows = (contradictions as any).rows || contradictions;
  const superseded: number[] = [];
  for (const row of contradictionRows) {
    await db.execute(sql`
      UPDATE knowledge_triples SET valid_until = ${validFrom}, updated_at = NOW()
      WHERE id = ${row.id}
    `);
    superseded.push(row.id);
  }

  const result = await db.execute(sql`
    INSERT INTO knowledge_triples (subject, predicate, object, confidence, source, valid_from, valid_until, wing, room, tenant_id, persona_id)
    VALUES (${params.subject}, ${params.predicate}, ${params.object}, ${confidence}, ${params.source || "agent"},
            ${validFrom}, ${validUntil}, ${params.wing || null}, ${params.room || null},
            ${tenantId}, ${persona?.id || null})
    RETURNING id
  `);
  const newId = ((result as any).rows || result)[0]?.id;
  return {
    created: true,
    id: newId,
    triple: `(${params.subject}, ${params.predicate}, ${params.object})`,
    confidence,
    valid_from: validFrom.toISOString(),
    valid_until: validUntil?.toISOString() || null,
    superseded: superseded.length > 0 ? superseded : undefined,
  };
}

async function queryTriples(params: Record<string, any>, tenantId: number) {
  const { db } = await import("../../../db");
  const { sql } = await import("drizzle-orm");

  const asOf = params.as_of ? new Date(params.as_of) : new Date();
  const includeExpired = params.include_expired === true;

  let query = sql`
    SELECT id, subject, predicate, object, confidence, source, valid_from, valid_until, wing, room, created_at
    FROM knowledge_triples
    WHERE tenant_id = ${tenantId}
  `;

  if (params.subject) query = sql`${query} AND subject ILIKE ${'%' + params.subject + '%'}`;
  if (params.predicate) query = sql`${query} AND predicate ILIKE ${'%' + params.predicate + '%'}`;
  if (params.object) query = sql`${query} AND object ILIKE ${'%' + params.object + '%'}`;
  if (params.wing) query = sql`${query} AND wing = ${params.wing}`;
  if (params.room) query = sql`${query} AND room = ${params.room}`;

  if (!includeExpired) {
    query = sql`${query} AND valid_from <= ${asOf} AND (valid_until IS NULL OR valid_until > ${asOf})`;
  }

  query = sql`${query} ORDER BY valid_from DESC LIMIT 50`;

  const result = await db.execute(query);
  const rows = (result as any).rows || result;
  return {
    count: rows.length,
    as_of: asOf.toISOString(),
    include_expired: includeExpired,
    triples: rows.map((r: any) => ({
      id: r.id,
      subject: r.subject,
      predicate: r.predicate,
      object: r.object,
      confidence: r.confidence,
      valid_from: r.valid_from,
      valid_until: r.valid_until,
      wing: r.wing,
      room: r.room,
      current: !r.valid_until || new Date(r.valid_until) > asOf,
    })),
  };
}

async function expireTriple(id: number, tenantId: number, validUntil?: string) {
  const { db } = await import("../../../db");
  const { sql } = await import("drizzle-orm");
  const until = validUntil ? new Date(validUntil) : new Date();
  if (isNaN(until.getTime())) return { error: "Invalid valid_until date" };
  const result = await db.execute(sql`
    UPDATE knowledge_triples SET valid_until = ${until}, updated_at = NOW()
    WHERE id = ${id} AND tenant_id = ${tenantId} AND valid_until IS NULL
    RETURNING id, subject, predicate, object
  `);
  const rows = (result as any).rows || result;
  if (rows.length === 0) {
    return { error: "Triple not found, already expired, or access denied" };
  }
  return { expired: true, id, triple: `(${rows[0].subject}, ${rows[0].predicate}, ${rows[0].object})`, valid_until: until.toISOString() };
}

// R74.13c — L1 fix. tenantId is required (was defaulting to admin).
async function searchKnowledge(query: string, tenantId: number) {
  const { storage } = await import("../../../storage");
  const persona = await storage.getActivePersona();
  try {
    const { vectorSearchKnowledge } = await import("../../../embeddings");
    const results = await vectorSearchKnowledge(query, { personaId: persona?.id, tenantId, topK: 25 });
    if (results.length > 0) {
      return { count: results.length, searchType: "semantic", results: results.map((k) => ({ id: k.id, title: k.title, category: k.category, content: k.content.slice(0, 500), similarity: k.similarity })) };
    }
  } catch (_silentErr) { const { logSilentCatch } = await import("../../../lib/silent-catch"); logSilentCatch("server/tools.ts", _silentErr); }
  const knResult = await storage.getKnowledge(persona?.id, 100, 0, tenantId);
  const q = query.toLowerCase();
  const matches = knResult.data
    .filter((k) => k.title.toLowerCase().includes(q) || k.content.toLowerCase().includes(q) || k.category.toLowerCase().includes(q))
    .slice(0, 10);
  return { count: matches.length, searchType: "keyword", results: matches.map((k) => ({ id: k.id, title: k.title, category: k.category, content: k.content.slice(0, 500), priority: k.priority })) };
}

// R74.13c — L1 fix. tenantId is required (was defaulting to admin).
async function createKnowledge(title: string, content: string, category: string, priority: number | undefined, tenantId: number) {
  const { storage } = await import("../../../storage");
  const persona = await storage.getActivePersona();
  const entry = await storage.createKnowledge({ title, content, category, priority: priority ?? 3, personaId: persona?.id ?? null, tenantId });
  return { created: true, id: entry.id, title: entry.title };
}

// ---------------------------------------------------------------------------
// Handlers — mechanical moves of the legacy switch arms. Tenant gates mirror
// the original `params._tenantId` fail-closed checks via ctx.tenantId.
// ---------------------------------------------------------------------------

export async function searchKnowledgeHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R64.C — fail-closed: knowledge is per-tenant; never fall through to admin.
  if (!ctx.tenantId) return { error: "Tenant context required for search_knowledge" };
  return searchKnowledge(params.query || "", ctx.tenantId);
}

export async function knowledgeNavigateHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R105 — PageIndex nugget: WALK a long doc by its heading tree.
  if (!ctx.tenantId) return { error: "Tenant context required for knowledge_navigate" };
  const mode = params.mode;
  const { listHeadingTrees, readHeadingSection } = await import("../../../doc-heading-tree");
  if (mode === "list") {
    return listHeadingTrees({
      tenantId: ctx.tenantId,
      query: params.query,
      collection: params.collection,
      docPath: params.doc_path,
      limit: params.limit,
    });
  }
  if (mode === "read") {
    if (!params.collection_id || !params.doc_path || !Array.isArray(params.heading_path) || params.heading_path.length === 0) {
      return { error: "read mode requires collection_id, doc_path, and a non-empty heading_path[]" };
    }
    return readHeadingSection({
      tenantId: ctx.tenantId,
      collectionId: params.collection_id,
      docPath: params.doc_path,
      headingPath: params.heading_path.map(String),
    });
  }
  return { error: `knowledge_navigate: unknown mode '${mode}' (expected 'list' or 'read')` };
}

export async function createKnowledgeHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  // R64.C — fail-closed: knowledge is per-tenant; never fall through to admin.
  if (!ctx.tenantId) return { error: "Tenant context required for create_knowledge" };
  const category = params.category || "reference";
  // Front-stop the reserved-category denylist here for a clear tool-facing
  // error; storage.createKnowledge enforces the same guard as the authoritative
  // backstop for ALL writers (post-edit-code-review HIGH, 2026-07-09).
  // Call-time dynamic import preserves the tools-package acyclic static
  // import graph (registry-invariants acyclicity test).
  const { isReservedKnowledgeCategory } = await import("../../../lib/reserved-knowledge-categories");
  if (isReservedKnowledgeCategory(category)) {
    return { error: `create_knowledge: category '${category}' is reserved and cannot be written through this tool.` };
  }
  return createKnowledge(params.title, params.content, category, params.priority, ctx.tenantId);
}

export async function storeTripleHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for store_triple" };
  return storeTriple(params, ctx.tenantId);
}

export async function queryTriplesHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for query_triples" };
  return queryTriples(params, ctx.tenantId);
}

export async function expireTripleHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for expire_triple" };
  return expireTriple(params.id, ctx.tenantId, params.valid_until);
}

export async function docSearchHandler(
  params: Record<string, any>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.tenantId) return { error: "Tenant context required for doc_search" };
  const tenantId = ctx.tenantId;
  const {
    createCollection, listCollections, deleteCollection,
    addDocument, removeDocument, addContext, generateCollectionEmbeddings,
    searchDocuments, getDocument, getCollectionStatus,
  } = await import("../../../doc-collections");
  try {
    switch (params.action) {
      case "search": {
        if (!params.query) return { error: "query is required for search" };
        return await searchDocuments(params.query, tenantId, {
          collection: params.collection, mode: params.mode || "keyword", topK: params.topK, minScore: params.minScore,
        });
      }
      case "get": {
        if (!params.docPath) return { error: "docPath is required" };
        return await getDocument(params.docPath, tenantId, params.collection);
      }
      case "add_doc": {
        if (!params.collectionId || !params.docPath || !params.content) return { error: "collectionId, docPath, and content are required" };
        return await addDocument(params.collectionId, params.docPath, params.content, params.context || "", tenantId, {
          autoContextualize: params.auto_contextualize === true,
        });
      }
      case "remove_doc": {
        if (!params.collectionId || !params.docPath) return { error: "collectionId and docPath are required" };
        return await removeDocument(params.collectionId, params.docPath, tenantId);
      }
      case "create_collection": {
        if (!params.name) return { error: "name is required" };
        return await createCollection(params.name, params.description || "", tenantId);
      }
      case "delete_collection": {
        if (!params.collectionId) return { error: "collectionId is required" };
        return await deleteCollection(params.collectionId, tenantId);
      }
      case "list_collections":
        return await listCollections(tenantId);
      case "add_context": {
        if (!params.collectionId || !params.context) return { error: "collectionId and context are required" };
        return await addContext(params.collectionId, params.context, tenantId);
      }
      case "embed": {
        if (!params.collectionId) return { error: "collectionId is required" };
        return await generateCollectionEmbeddings(params.collectionId, tenantId);
      }
      case "status":
        return await getCollectionStatus(tenantId);
      default:
        return { error: `Unknown doc_search action: ${params.action}. Use: search, get, add_doc, remove_doc, create_collection, delete_collection, list_collections, add_context, embed, status` };
    }
  } catch (err: any) {
    return { error: err.message };
  }
}

/** Registered by ./index.ts at import time. */
export const knowledgeDomainTools: RegisteredTool[] = [
  defineTool(searchKnowledgeDefinition, searchKnowledgeHandler),
  defineTool(knowledgeNavigateDefinition, knowledgeNavigateHandler),
  defineTool(createKnowledgeDefinition, createKnowledgeHandler),
  defineTool(storeTripleDefinition, storeTripleHandler),
  defineTool(queryTriplesDefinition, queryTriplesHandler),
  defineTool(expireTripleDefinition, expireTripleHandler),
  defineTool(docSearchDefinition, docSearchHandler),
];
