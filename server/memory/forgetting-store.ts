/**
 * PostgreSQL/Drizzle implementation of the unified-memory lifecycle store.
 *
 * This file intentionally uses a switch for every source.  Source names are
 * application data and must never become SQL identifiers, even after type
 * checking.  Rows returned by this adapter contain only lifecycle metadata
 * and opaque source ids; memory values are never selected.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, withTenantTx } from "../db";
import type {
  ForgettingAction,
  ForgettingAuditRecord,
  ForgettingDeleteRequest,
  ForgettingStore as ForgettingStoreContract,
  ForgettingTransaction,
  ExplicitEraseItem,
  ActiveRetentionPolicy,
} from "./forgetting-coordinator";
import {
  defaultMemoryRetentionPolicy,
  MEMORY_LIFECYCLE_SOURCES,
  type MemoryLifecycleCandidate,
  type MemoryLifecycleCandidatePage,
  type MemoryForgettingCursorMap,
  type MemoryLifecycleSource,
  type MemoryRetentionPolicy,
} from "./forgetting-policy";
import { canonicalMemoryValues, memoryValueDigest } from "./tombstones";

type QueryExecutor = { execute(query: unknown): Promise<unknown> };
type Row = Record<string, unknown>;

const MAX_LIMIT = 500;
const CLAIM_LEASE_MINUTES = 5;
const IDENTIFIER_MAX = 512;
const VALUE_FREE_CODE = /^[A-Za-z0-9_.:-]{1,160}$/;
const POLICY_RULE_KEYS = new Set(["archiveAfterDays", "purgeArchivedAfterDays", "minimumAccessCountToRetain"]);
const POLICY_SOURCE_KEYS: ReadonlySet<string> = new Set(MEMORY_LIFECYCLE_SOURCES);
const MAX_DERIVATION_DEPTH = 32;
const MAX_DERIVED_DESCENDANTS = 500;

export interface MemoryDerivationRecord {
  tenantId: number;
  parentSource: string;
  parentId: string | number;
  childSource: string;
  childId: string | number;
  relationship: string;
  /**
   * This must be explicitly true only when the child cannot stand
   * independently of the parent. The helper deliberately defaults false;
   * provenance callers must make that judgment from their actual write path.
   */
  solelyDerived?: boolean;
}

/**
 * Record one provenance edge in the caller's transaction. Keeping this as a
 * transaction helper (rather than a fire-and-forget audit write) means a
 * durable child can never commit without its edge. Source ids remain opaque
 * and polymorphic; no memory value is selected or logged.
 */
export async function recordMemoryDerivation(
  tx: QueryExecutor,
  input: MemoryDerivationRecord,
): Promise<void> {
  positiveTenant(input.tenantId);
  code(input.parentSource, "parentSource");
  code(input.childSource, "childSource");
  const parentId = opaque(String(input.parentId), "parentId");
  const childId = opaque(String(input.childId), "childId");
  code(input.relationship, "relationship");
  const solelyDerived = input.solelyDerived === true;
  await tx.execute(sql`INSERT INTO memory_derivations
    (tenant_id, parent_source, parent_id, child_source, child_id,
     relationship, solely_derived)
    VALUES (${input.tenantId}, ${input.parentSource}, ${parentId},
      ${input.childSource}, ${childId}, ${input.relationship}, ${solelyDerived})
    ON CONFLICT (tenant_id, parent_source, parent_id, child_source, child_id, relationship)
    DO UPDATE SET solely_derived =
      memory_derivations.solely_derived OR EXCLUDED.solely_derived`);
}

const DELETABLE_MEMORY_SOURCES: readonly MemoryLifecycleSource[] = [
  "memory_entries",
  "conversation_facts",
  "agent_knowledge",
  "compaction_archives",
  "graph_memory",
  "knowledge_triples",
  "knowledge_nudges",
  "messages",
  "graph_memory_links",
  "memory_links",
] as const;

function rows(result: unknown): Row[] {
  const resultObject = result as { rows?: unknown };
  const value = resultObject?.rows ?? result;
  return Array.isArray(value) ? value as Row[] : [];
}

function positiveTenant(tenantId: number): void {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error("forgetting store: invalid tenantId");
  }
}

function boundedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("forgetting store: invalid limit");
  return Math.min(limit, MAX_LIMIT);
}

function cursorMap(value: unknown): MemoryForgettingCursorMap {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("forgetting store: scheduler cursor state is malformed");
  }
  const result: MemoryForgettingCursorMap = {};
  for (const [source, raw] of Object.entries(value)) {
    if (!(MEMORY_LIFECYCLE_SOURCES as readonly string[]).includes(source)
      || !Number.isSafeInteger(Number(raw)) || Number(raw) < 0) {
      throw new Error("forgetting store: scheduler cursor state is malformed");
    }
    result[source as MemoryLifecycleSource] = Number(raw);
  }
  return result;
}

function opaque(value: string, name: string): string {
  if (!value || value.length > IDENTIFIER_MAX) throw new Error(`forgetting store: invalid ${name}`);
  return value;
}

function code(value: string, name: string): string {
  if (!VALUE_FREE_CODE.test(value)) throw new Error(`forgetting store: invalid ${name}`);
  return value;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse only the versioned policy document accepted by the runtime. */
function strictRetentionPolicy(row: Row): ActiveRetentionPolicy {
  const version = Number(row.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("forgetting store: active retention policy has invalid version");
  }
  if (!plainObject(row.rules)) {
    throw new Error("forgetting store: active retention policy rules must be an object");
  }
  if (row.mode !== "report_only" && row.mode !== "mutate") {
    throw new Error("forgetting store: active retention policy has invalid mode");
  }
  const rules = row.rules;
  if (Object.keys(rules).some((key) => key !== "sources" && key !== "version")) {
    throw new Error("forgetting store: active retention policy has unknown rule fields");
  }
  if ("version" in rules && (Number(rules.version) !== version || !Number.isInteger(Number(rules.version)))) {
    throw new Error("forgetting store: active retention policy version mismatch");
  }
  if (!plainObject(rules.sources)) {
    throw new Error("forgetting store: active retention policy sources must be an object");
  }
  const sources: MemoryRetentionPolicy["sources"] = {};
  for (const [source, rawRule] of Object.entries(rules.sources)) {
    if (!POLICY_SOURCE_KEYS.has(source as MemoryLifecycleSource)) {
      throw new Error(`forgetting store: active retention policy has unsupported source ${source}`);
    }
    if (!plainObject(rawRule) || Object.keys(rawRule).length !== POLICY_RULE_KEYS.size ||
      Object.keys(rawRule).some((key) => !POLICY_RULE_KEYS.has(key))) {
      throw new Error(`forgetting store: active retention policy rule for ${source} is malformed`);
    }
    const archiveAfterDays = rawRule.archiveAfterDays;
    const purgeArchivedAfterDays = rawRule.purgeArchivedAfterDays;
    const minimumAccessCountToRetain = rawRule.minimumAccessCountToRetain;
    for (const [name, value] of [
      ["archiveAfterDays", archiveAfterDays],
      ["purgeArchivedAfterDays", purgeArchivedAfterDays],
    ] as const) {
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        throw new Error(`forgetting store: active retention policy ${name} is invalid`);
      }
    }
    if (typeof minimumAccessCountToRetain !== "number" ||
      !Number.isInteger(minimumAccessCountToRetain) || minimumAccessCountToRetain < 0) {
      throw new Error("forgetting store: active retention policy access threshold is invalid");
    }
    sources[source as MemoryLifecycleSource] = {
      archiveAfterDays: archiveAfterDays as number | null,
      purgeArchivedAfterDays: purgeArchivedAfterDays as number | null,
      minimumAccessCountToRetain,
    };
  }
  return { version, sources, mode: row.mode as "report_only" | "mutate" };
}

function requestEnvelope(
  reason: string | undefined,
  requestedItems: readonly ExplicitEraseItem[],
  policyVersion: number,
  error?: string | null,
): string {
  return JSON.stringify({
    version: 2,
    policyVersion,
    reason: reason ?? null,
    requestedItems: requestedItems.map((item) => ({
      source: item.source,
      sourceId: String(item.sourceId),
    })),
    error: error ?? null,
  });
}

function canonicalRequestedItems(items: ReadonlyArray<{ source: string; sourceId: string | number }>): string {
  return JSON.stringify(items.map((item) => ({
    source: item.source,
    sourceId: String(item.sourceId),
  })));
}

function parseRequestEnvelope(value: unknown): {
  reason: string | null;
  requestedItems: Array<{ source: string; sourceId: string }>;
  policyVersion: number | null;
  error: string | null;
} | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.requestedItems) ||
      (parsed.reason !== null && typeof parsed.reason !== "string") ||
      (parsed.version === 2 && (!Number.isInteger(parsed.policyVersion)
        || Number(parsed.policyVersion) < 1)) ||
      (parsed.error !== null && typeof parsed.error !== "string")) return null;
    return {
      reason: parsed.reason as string | null,
      requestedItems: parsed.requestedItems as Array<{ source: string; sourceId: string }>,
      policyVersion: parsed.version === 2 ? Number(parsed.policyVersion) : null,
      error: parsed.error as string | null,
    };
  } catch {
    return null;
  }
}

function candidate(source: MemoryLifecycleSource, row: Row): MemoryLifecycleCandidate {
  return {
    source,
    id: row.id as string | number,
    tenantId: Number(row.tenant_id),
    status: row.status == null ? null : String(row.status),
    createdAt: row.created_at as string | Date,
    lastAccessedAt: row.last_accessed_at as string | Date | null,
    expiresAt: row.expires_at as string | Date | null,
    archivedAt: row.archived_at as string | Date | null,
    accessCount: Number(row.access_count ?? 0),
  };
}

async function selectCandidateRows(
  tx: QueryExecutor,
  tenantId: number,
  source: MemoryLifecycleSource,
  limit: number,
  cursor?: number,
): Promise<MemoryLifecycleCandidate[]> {
  // Global skills have no tenant_id and must not be accidentally treated as
  // belonging to the requesting tenant.  Protected evidence is still listed
  // (without values) so report mode can explain why it was retained.
  if (source === "skills") return [];
  const seek = cursor === undefined ? sql`` : sql` AND id > ${cursor}`;
  const linkSeek = cursor === undefined ? sql`` : sql` AND ml.id > ${cursor}`;

  let result: unknown;
  switch (source) {
    case "memory_entries":
      result = await tx.execute(sql`SELECT id, tenant_id, status, created_at,
        last_accessed AS last_accessed_at, expires_at, archived_at, access_count
        FROM memory_entries WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "conversation_facts":
      result = await tx.execute(sql`SELECT id, tenant_id, status, created_at,
        last_referenced_at AS last_accessed_at, expires_at, archived_at, ref_count AS access_count
        FROM conversation_facts WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "agent_knowledge":
      result = await tx.execute(sql`SELECT id, tenant_id,
        CASE WHEN expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP
          THEN 'expired' ELSE 'active' END AS status,
        created_at, last_accessed AS last_accessed_at, expires_at, archived_at, access_count
        FROM agent_knowledge WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "compaction_archives":
      result = await tx.execute(sql`SELECT id, tenant_id, 'archived' AS status,
        archived_at AS created_at, archived_at AS last_accessed_at, archived_at,
        NULL::timestamp AS expires_at, 0 AS access_count
        FROM compaction_archives WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "graph_memory":
      result = await tx.execute(sql`SELECT id, tenant_id, 'active' AS status,
        COALESCE(created_at, updated_at, CURRENT_TIMESTAMP) AS created_at,
        updated_at AS last_accessed_at, NULL::timestamp AS expires_at,
        0 AS access_count
        FROM graph_memory WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "knowledge_triples":
      result = await tx.execute(sql`SELECT id, tenant_id,
        CASE WHEN valid_until IS NOT NULL AND valid_until <= CURRENT_TIMESTAMP
          THEN 'expired' ELSE 'active' END AS status,
        created_at, updated_at AS last_accessed_at,
        valid_until AS expires_at, 0 AS access_count
        FROM knowledge_triples WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "knowledge_nudges":
      result = await tx.execute(sql`SELECT id, tenant_id, 'active' AS status,
        created_at, created_at AS last_accessed_at, NULL::timestamptz AS expires_at,
        0 AS access_count
        FROM knowledge_nudges WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "messages":
      result = await tx.execute(sql`SELECT id, tenant_id, 'active' AS status,
        created_at, created_at AS last_accessed_at, NULL::timestamp AS expires_at,
        0 AS access_count
        FROM messages WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "graph_memory_links":
      result = await tx.execute(sql`SELECT id, tenant_id, 'active' AS status,
        COALESCE(created_at, CURRENT_TIMESTAMP) AS created_at,
        created_at AS last_accessed_at, NULL::timestamp AS expires_at,
        0 AS access_count
        FROM graph_memory_links WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "memory_links":
      result = await tx.execute(sql`SELECT ml.id, me.tenant_id, 'active' AS status,
        COALESCE(ml.created_at, CURRENT_TIMESTAMP) AS created_at,
        ml.created_at AS last_accessed_at, NULL::timestamp AS expires_at,
        0 AS access_count
        FROM memory_links ml
        JOIN memory_entries me ON me.id = ml.source_memory_id
        JOIN memory_entries target_me ON target_me.id = ml.target_memory_id
        WHERE me.tenant_id = ${tenantId} AND target_me.tenant_id = ${tenantId}${linkSeek}
        ORDER BY ml.id ASC LIMIT ${limit}`);
      break;
    case "mind_tickets":
      result = await tx.execute(sql`SELECT id, tenant_id, status, created_at,
        updated_at AS last_accessed_at, NULL::timestamp AS expires_at,
        0 AS access_count FROM mind_tickets WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "procedure_edits":
      result = await tx.execute(sql`SELECT id, tenant_id, status, proposed_at AS created_at,
        proposed_at AS last_accessed_at, NULL::timestamp AS expires_at,
        0 AS access_count FROM procedure_edits WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "agent_runs":
      result = await tx.execute(sql`SELECT id, tenant_id, status, created_at,
        updated_at AS last_accessed_at, NULL::timestamp AS expires_at,
        0 AS access_count FROM agent_runs WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "agent_trace_spans":
      result = await tx.execute(sql`SELECT id, tenant_id, status, started_at AS created_at,
        started_at AS last_accessed_at, NULL::timestamp AS expires_at,
        0 AS access_count FROM agent_trace_spans WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "mind_events":
      result = await tx.execute(sql`SELECT id, tenant_id,
        CASE WHEN handled THEN 'handled' ELSE 'pending' END AS status,
        created_at, created_at AS last_accessed_at, NULL::timestamp AS expires_at,
        0 AS access_count FROM mind_events WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    case "conversations":
      result = await tx.execute(sql`SELECT id, tenant_id,
        CASE WHEN deleted_at IS NULL THEN 'active' ELSE 'deleted' END AS status,
        created_at, updated_at AS last_accessed_at, deleted_at AS expires_at,
        0 AS access_count FROM conversations WHERE tenant_id = ${tenantId}${seek}
        ORDER BY id ASC LIMIT ${limit}`);
      break;
    default:
      return [];
  }
  return rows(result).map((row) => candidate(source, row));
}

function validateSource(source: MemoryLifecycleSource): void {
  if (!(MEMORY_LIFECYCLE_SOURCES as readonly string[]).includes(source)) {
    throw new Error(`forgetting store: unsupported source ${source}`);
  }
}

async function sourceExists(tx: QueryExecutor, request: ForgettingDeleteRequest): Promise<boolean> {
  const { tenantId, source, sourceId } = request;
  switch (source) {
    case "memory_entries":
      return rows(await tx.execute(sql`SELECT id FROM memory_entries
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1`)).length > 0;
    case "conversation_facts":
      return rows(await tx.execute(sql`SELECT id FROM conversation_facts
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1`)).length > 0;
    case "agent_knowledge":
      return rows(await tx.execute(sql`SELECT id FROM agent_knowledge
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1`)).length > 0;
    case "compaction_archives":
      return rows(await tx.execute(sql`SELECT id FROM compaction_archives
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1`)).length > 0;
    case "graph_memory":
      return rows(await tx.execute(sql`SELECT id FROM graph_memory
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1`)).length > 0;
    case "knowledge_triples":
      return rows(await tx.execute(sql`SELECT id FROM knowledge_triples
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1`)).length > 0;
    case "knowledge_nudges":
      return rows(await tx.execute(sql`SELECT id FROM knowledge_nudges
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1`)).length > 0;
    case "messages":
      return rows(await tx.execute(sql`SELECT id FROM messages
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1`)).length > 0;
    case "graph_memory_links":
      return rows(await tx.execute(sql`SELECT id FROM graph_memory_links
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} LIMIT 1`)).length > 0;
    case "memory_links":
      return rows(await tx.execute(sql`SELECT ml.id FROM memory_links ml
        JOIN memory_entries source_me ON source_me.id = ml.source_memory_id
        JOIN memory_entries target_me ON target_me.id = ml.target_memory_id
        WHERE ml.id = ${sourceId}
          AND source_me.tenant_id = ${tenantId}
          AND target_me.tenant_id = ${tenantId} LIMIT 1`)).length > 0;
    case "skills":
    case "mind_tickets":
    case "procedure_edits":
    case "agent_runs":
    case "agent_trace_spans":
    case "mind_events":
    case "conversations":
      return false;
    default:
      return false;
  }
}

async function sourceCanonicalValues(
  tx: QueryExecutor,
  request: ForgettingDeleteRequest,
): Promise<string[] | null> {
  const { tenantId, source, sourceId } = request;
  let result: unknown;
  switch (source) {
    case "memory_entries":
      result = await tx.execute(sql`SELECT fact AS a FROM memory_entries
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} FOR UPDATE`);
      break;
    case "conversation_facts":
      result = await tx.execute(sql`SELECT fact_text AS a FROM conversation_facts
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} FOR UPDATE`);
      break;
    case "agent_knowledge":
      result = await tx.execute(sql`SELECT title AS a, content AS b FROM agent_knowledge
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} FOR UPDATE`);
      break;
    case "compaction_archives":
      result = await tx.execute(sql`SELECT content AS a, summary AS b FROM compaction_archives
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} FOR UPDATE`);
      break;
    case "graph_memory":
      result = await tx.execute(sql`SELECT path AS a, content AS b FROM graph_memory
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} FOR UPDATE`);
      break;
    case "knowledge_triples":
      result = await tx.execute(sql`SELECT subject AS a, predicate AS b, object AS c
        FROM knowledge_triples WHERE id = ${sourceId} AND tenant_id = ${tenantId} FOR UPDATE`);
      break;
    case "knowledge_nudges":
      result = await tx.execute(sql`SELECT fact AS a FROM knowledge_nudges
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} FOR UPDATE`);
      break;
    case "messages":
      result = await tx.execute(sql`SELECT content AS a FROM messages
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} FOR UPDATE`);
      break;
    case "graph_memory_links":
      result = await tx.execute(sql`SELECT source_path AS a, target_path AS b, link_type AS c
        FROM graph_memory_links WHERE id = ${sourceId} AND tenant_id = ${tenantId} FOR UPDATE`);
      break;
    case "memory_links":
      result = await tx.execute(sql`SELECT ml.source_memory_id AS a, ml.target_memory_id AS b,
          ml.link_type AS c
        FROM memory_links ml
        JOIN memory_entries sm ON sm.id = ml.source_memory_id
        JOIN memory_entries tm ON tm.id = ml.target_memory_id
        WHERE ml.id = ${sourceId} AND sm.tenant_id = ${tenantId}
          AND tm.tenant_id = ${tenantId} FOR UPDATE OF ml`);
      break;
    default:
      return null;
  }
  const row = rows(result)[0];
  if (!row) return null;
  const parts: unknown[] = (() => {
    switch (source) {
      case "memory_entries":
      case "conversation_facts":
      case "knowledge_nudges":
      case "messages":
        return [row.a];
      case "agent_knowledge":
      case "compaction_archives":
      case "graph_memory":
        return [row.a, row.b];
      case "knowledge_triples":
      case "graph_memory_links":
      case "memory_links":
        return [row.a, row.b, row.c];
      default:
        return [];
    }
  })();
  return canonicalMemoryValues(parts);
}

async function deleteSource(tx: QueryExecutor, request: ForgettingDeleteRequest): Promise<number> {
  const { tenantId, source, sourceId } = request;
  if (!(await sourceExists(tx, request))) return 0;

  switch (source) {
    case "memory_entries":
      // memory_links has no tenant_id.  Both endpoints are checked so a
      // malformed cross-tenant edge can never be deleted by this operation.
      await tx.execute(sql`DELETE FROM memory_links ml
        WHERE (ml.source_memory_id = ${sourceId} OR ml.target_memory_id = ${sourceId})
          AND EXISTS (SELECT 1 FROM memory_entries me
            WHERE me.id = ml.source_memory_id AND me.tenant_id = ${tenantId})
          AND EXISTS (SELECT 1 FROM memory_entries me
            WHERE me.id = ml.target_memory_id AND me.tenant_id = ${tenantId})`);
      return rows(await tx.execute(sql`DELETE FROM memory_entries
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} RETURNING id`)).length;
    case "graph_memory": {
      // Keep the graph path inside PostgreSQL: it is memory content, not an
      // adapter value, and must never be returned to application code.
      await tx.execute(sql`DELETE FROM graph_memory_links gml
        USING graph_memory gm
        WHERE gm.id = ${sourceId} AND gm.tenant_id = ${tenantId}
          AND gml.tenant_id = ${tenantId}
          AND (gml.source_path = gm.path OR gml.target_path = gm.path)`);
      return rows(await tx.execute(sql`DELETE FROM graph_memory
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} RETURNING id`)).length;
    }
    case "memory_links":
      return rows(await tx.execute(sql`DELETE FROM memory_links ml
        USING memory_entries source_me, memory_entries target_me
        WHERE ml.id = ${sourceId}
          AND source_me.id = ml.source_memory_id
          AND target_me.id = ml.target_memory_id
          AND source_me.tenant_id = ${tenantId}
          AND target_me.tenant_id = ${tenantId}
        RETURNING ml.id`)).length;
    case "conversation_facts":
      return rows(await tx.execute(sql`DELETE FROM conversation_facts
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} RETURNING id`)).length;
    case "agent_knowledge":
      return rows(await tx.execute(sql`DELETE FROM agent_knowledge
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} RETURNING id`)).length;
    case "compaction_archives":
      return rows(await tx.execute(sql`DELETE FROM compaction_archives
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} RETURNING id`)).length;
    case "knowledge_triples":
      return rows(await tx.execute(sql`DELETE FROM knowledge_triples
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} RETURNING id`)).length;
    case "knowledge_nudges":
      return rows(await tx.execute(sql`DELETE FROM knowledge_nudges
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} RETURNING id`)).length;
    case "messages":
      return rows(await tx.execute(sql`DELETE FROM messages
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} RETURNING id`)).length;
    case "graph_memory_links":
      return rows(await tx.execute(sql`DELETE FROM graph_memory_links
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} RETURNING id`)).length;
    default:
      throw new Error(`forgetting store: deletion is not supported for ${source}`);
  }
}

function isDeletableMemorySource(source: string): source is MemoryLifecycleSource {
  return (DELETABLE_MEMORY_SOURCES as readonly string[]).includes(source);
}

async function insertContentTombstone(
  tx: QueryExecutor,
  tombstone: ForgettingDeleteRequest,
  tombstoneKey: string,
  reasonCode = "explicit_erasure",
): Promise<boolean> {
  const values = await sourceCanonicalValues(tx, tombstone);
  if (values === null) throw new Error("forgetting store: source row not found");
  const digests = values.map((value, index) => ({
    index,
    valueDigest: memoryValueDigest(
      tombstone.tenantId,
      tombstone.source,
      value,
      tombstoneKey,
    ),
  })).sort((a, b) => a.valueDigest.localeCompare(b.valueDigest));
  for (const { index, valueDigest } of digests) {
    const digestSourceId = index === 0 ? tombstone.sourceId : `${tombstone.sourceId}:${index}`;
    // This is deliberately the same transaction-scoped lock used by the
    // PostgreSQL write trigger.  Taking it before the tombstone INSERT closes
    // the race where a concurrent write could pass its trigger check while an
    // erasure is being committed.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${valueDigest}, 0::bigint))`);
    const inserted = rows(await tx.execute(sql`INSERT INTO memory_tombstones
      (tenant_id, source, source_id, value_digest, request_key, reason_code)
      VALUES (${tombstone.tenantId}, ${tombstone.source}, ${digestSourceId},
        ${valueDigest}, ${tombstone.requestKey}, ${reasonCode})
      ON CONFLICT (tenant_id, source, source_id) DO UPDATE
        SET value_digest = EXCLUDED.value_digest,
            request_key = EXCLUDED.request_key,
            reason_code = EXCLUDED.reason_code
      WHERE memory_tombstones.request_key = EXCLUDED.request_key
      RETURNING id`));
    if (inserted.length !== 1) throw new Error("forgetting store: tombstone identity conflict");
  }
  return true;
}

/**
 * Erase provenance descendants in post-order.  The derivation table is
 * tenant-scoped but its ids are polymorphic, so every discovered child still
 * has to prove that its source row belongs to this tenant before it is
 * touched.  Protected evidence is never deleted (and is not a valid root),
 * while malformed/unsupported edges are inert.
 */
async function eraseSolelyDerivedDescendants(
  tx: QueryExecutor,
  root: ForgettingDeleteRequest,
  tombstoneKey: string,
): Promise<void> {
  const visited = new Set<string>();
  const active = new Set<string>();
  let discovered = 0;

  const walk = async (source: string, sourceId: string, depth: number): Promise<void> => {
    if (depth > MAX_DERIVATION_DEPTH) {
      throw new Error("forgetting store: memory derivation depth limit exceeded");
    }
    const identity = `${source}:${sourceId}`;
    if (active.has(identity)) throw new Error("forgetting store: memory derivation cycle detected");
    if (visited.has(identity)) return;
    visited.add(identity);
    active.add(identity);
    try {
      const children = rows(await tx.execute(sql`SELECT child_source, child_id
        FROM memory_derivations
        WHERE tenant_id = ${root.tenantId}
          AND parent_source = ${source}
          AND parent_id = ${sourceId}
          AND solely_derived = true
        ORDER BY id ASC
        LIMIT ${MAX_DERIVED_DESCENDANTS}`));
      for (const child of children) {
        const childSource = String(child.child_source ?? "");
        const childId = String(child.child_id ?? "");
        if (!isDeletableMemorySource(childSource) || !opaque(childId, "childId")) continue;
        if (++discovered > MAX_DERIVED_DESCENDANTS) {
          throw new Error("forgetting store: memory derivation descendant limit exceeded");
        }
        const childIdentity = `${childSource}:${childId}`;
        if (active.has(childIdentity)) {
          throw new Error("forgetting store: memory derivation cycle detected");
        }
        if (visited.has(childIdentity)) continue;
        // sourceExists includes tenant predicates for every supported source;
        // this is the second check against a crafted cross-tenant edge.
        if (!(await sourceExists(tx, {
          tenantId: root.tenantId,
          source: childSource,
          sourceId: childId,
          requestKey: root.requestKey,
        }))) continue;

        await walk(childSource, childId, depth + 1);
        const childRequest: ForgettingDeleteRequest = {
          tenantId: root.tenantId,
          source: childSource,
          sourceId: childId,
          requestKey: root.requestKey,
        };
        const childActionKey =
          `${root.tenantId}:${root.requestKey}:${childSource}:${childId}:1:erase:derived`;
        const claimTokenHash = createHash("sha256").update(randomUUID()).digest("hex");
        const claimed = rows(await tx.execute(sql`INSERT INTO memory_lifecycle_action_claims
          (tenant_id, action_key, source, source_id, policy_version, action,
           status, attempt_count, lease_expires_at, claim_token_hash)
          VALUES (${root.tenantId}, ${childActionKey}, ${childSource}, ${childId},
            1, 'erase', 'running', 1, CURRENT_TIMESTAMP + INTERVAL '5 minutes',
            ${claimTokenHash})
          ON CONFLICT DO NOTHING RETURNING id`));
        if (claimed.length !== 1) {
          throw new Error("forgetting store: derived child action already claimed");
        }
        await insertContentTombstone(tx, childRequest, tombstoneKey);
        await tx.execute(sql`INSERT INTO memory_lifecycle_audits
          (tenant_id, action_key, source, source_id, policy_version, action,
           mode, outcome, reason_code, request_key)
          VALUES (${root.tenantId}, ${childActionKey}, ${childSource}, ${childId},
            1, 'erase', 'explicit', 'recorded', 'solely_derived_descendant',
            ${root.requestKey})`);
        const deleted = await deleteSource(tx, childRequest);
        if (deleted !== 1) throw new Error("forgetting store: derived child disappeared");
        const completed = rows(await tx.execute(sql`UPDATE memory_lifecycle_action_claims
          SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
              lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${root.tenantId} AND action_key = ${childActionKey}
            AND claim_token_hash = ${claimTokenHash} AND status = 'running'
          RETURNING id`));
        if (completed.length !== 1) {
          throw new Error("forgetting store: derived child claim lost");
        }
        await tx.execute(sql`DELETE FROM memory_derivations
          WHERE tenant_id = ${root.tenantId}
            AND ((parent_source = ${childSource} AND parent_id = ${childId})
              OR (child_source = ${childSource} AND child_id = ${childId}))`);
      }
    } finally {
      active.delete(identity);
    }
  };

  // Seed the path with the requested parent so a child -> parent edge is
  // detected as a cycle rather than revisited.
  const rootIdentity = `${root.source}:${root.sourceId}`;
  visited.add(rootIdentity);
  active.add(rootIdentity);
  try {
    await walkChildrenOnly(tx, root, walk);
  } finally {
    active.delete(rootIdentity);
  }
}

async function walkChildrenOnly(
  tx: QueryExecutor,
  root: ForgettingDeleteRequest,
  walk: (source: string, sourceId: string, depth: number) => Promise<void>,
): Promise<void> {
  const children = rows(await tx.execute(sql`SELECT child_source, child_id
    FROM memory_derivations
    WHERE tenant_id = ${root.tenantId}
      AND parent_source = ${root.source}
      AND parent_id = ${root.sourceId}
      AND solely_derived = true
    ORDER BY id ASC
    LIMIT ${MAX_DERIVED_DESCENDANTS}`));
  for (const child of children) {
    const childSource = String(child.child_source ?? "");
    const childId = String(child.child_id ?? "");
    if (!isDeletableMemorySource(childSource) || !opaque(childId, "childId")) continue;
    await walk(childSource, childId, 1);
  }
}

async function sourceIdsForOffboarding(
  tx: QueryExecutor,
  tenantId: number,
  source: MemoryLifecycleSource,
): Promise<string[]> {
  let result: unknown;
  switch (source) {
    case "memory_entries":
      result = await tx.execute(sql`SELECT id FROM memory_entries
        WHERE tenant_id = ${tenantId} ORDER BY id ASC`);
      break;
    case "conversation_facts":
      result = await tx.execute(sql`SELECT id FROM conversation_facts
        WHERE tenant_id = ${tenantId} ORDER BY id ASC`);
      break;
    case "agent_knowledge":
      result = await tx.execute(sql`SELECT id FROM agent_knowledge
        WHERE tenant_id = ${tenantId} ORDER BY id ASC`);
      break;
    case "compaction_archives":
      result = await tx.execute(sql`SELECT id FROM compaction_archives
        WHERE tenant_id = ${tenantId} ORDER BY id ASC`);
      break;
    case "graph_memory":
      result = await tx.execute(sql`SELECT id FROM graph_memory
        WHERE tenant_id = ${tenantId} ORDER BY id ASC`);
      break;
    case "knowledge_triples":
      result = await tx.execute(sql`SELECT id FROM knowledge_triples
        WHERE tenant_id = ${tenantId} ORDER BY id ASC`);
      break;
    case "knowledge_nudges":
      result = await tx.execute(sql`SELECT id FROM knowledge_nudges
        WHERE tenant_id = ${tenantId} ORDER BY id ASC`);
      break;
    case "messages":
      result = await tx.execute(sql`SELECT id FROM messages
        WHERE tenant_id = ${tenantId} ORDER BY id ASC`);
      break;
    case "graph_memory_links":
      result = await tx.execute(sql`SELECT id FROM graph_memory_links
        WHERE tenant_id = ${tenantId} ORDER BY id ASC`);
      break;
    case "memory_links":
      result = await tx.execute(sql`SELECT ml.id FROM memory_links ml
        JOIN memory_entries sm ON sm.id = ml.source_memory_id
        JOIN memory_entries tm ON tm.id = ml.target_memory_id
        WHERE sm.tenant_id = ${tenantId} AND tm.tenant_id = ${tenantId}
        ORDER BY ml.id ASC`);
      break;
    default:
      return [];
  }
  return rows(result).map((row) => String(row.id));
}

/**
 * Record an account-offboarding erasure while the caller's tenant deletion
 * transaction is still open.  It deliberately returns only counts; values
 * are hashed and never written to lifecycle evidence.
 */
export async function prepareOffboardingErasure(
  tx: QueryExecutor,
  tenantId: number,
  requestKey: string,
  tombstoneKey = process.env.MEMORY_TOMBSTONE_HMAC_KEY ?? "",
): Promise<{ itemCount: number; erasedCount: number }> {
  positiveTenant(tenantId);
  opaque(requestKey, "requestKey");
  if (!tombstoneKey) throw new Error("forgetting store: tombstone key unavailable");
  await tx.execute(sql`INSERT INTO memory_erasure_requests
    (tenant_id, request_key, mode, status, reason_code, started_at, updated_at)
    VALUES (${tenantId}, ${requestKey}, 'offboarding', 'running',
      'account_offboarding', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
  const requests: ForgettingDeleteRequest[] = [];
  for (const source of DELETABLE_MEMORY_SOURCES) {
    const sourceIds = await sourceIdsForOffboarding(tx, tenantId, source);
    for (const sourceId of sourceIds) {
      const request: ForgettingDeleteRequest = { tenantId, source, sourceId, requestKey };
      requests.push(request);
      await insertContentTombstone(tx, request, tombstoneKey, "account_offboarding");
      await tx.execute(sql`INSERT INTO memory_lifecycle_audits
        (tenant_id, action_key, source, source_id, policy_version, action,
         mode, outcome, reason_code, request_key)
        VALUES (${tenantId}, ${requestKey} || ':offboarding:' || ${source} || ':' || ${sourceId},
          ${source}, ${sourceId}, 1, 'erase', 'explicit', 'recorded',
          'account_offboarding', ${requestKey})`);
    }
  }
  // Delete explicit relationships first, then ordinary rows, and roots last.
  // This preserves every canonical relationship value until its tombstone is
  // written and prevents FK cascades from silently skipping evidence.
  const deleteRank = (source: MemoryLifecycleSource): number =>
    source === "memory_links" || source === "graph_memory_links" ? 0
      : source === "memory_entries" || source === "graph_memory" ? 2 : 1;
  requests.sort((a, b) => deleteRank(a.source) - deleteRank(b.source));
  let erasedCount = 0;
  for (const request of requests) {
    const deleted = await deleteSource(tx, request);
    if (deleted !== 1) throw new Error("forgetting store: offboarding target disappeared");
    erasedCount++;
  }
  const itemCount = requests.length;
  await tx.execute(sql`UPDATE memory_erasure_requests
    SET status = 'completed', item_count = ${itemCount}, erased_count = ${erasedCount},
        completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ${tenantId} AND request_key = ${requestKey}`);
  return { itemCount, erasedCount };
}

/**
 * Write the platform-global offboarding receipt in the caller's deletion
 * transaction. It intentionally has no tenant FK/tenant_id: the tenant row
 * is deleted immediately afterward and the receipt must survive its cascades.
 * Only an HMAC fingerprint crosses this boundary; the plain tenant id never
 * enters the receipt table.
 */
export async function recordAccountErasureReceipt(
  tx: QueryExecutor,
  input: {
    tenantId: number;
    requestKey: string;
    itemCount: number;
    erasedCount: number;
    status: string;
    hmacKey?: string;
  },
): Promise<void> {
  positiveTenant(input.tenantId);
  opaque(input.requestKey, "requestKey");
  code(input.status, "status");
  if (!Number.isInteger(input.itemCount) || input.itemCount < 0
    || !Number.isInteger(input.erasedCount) || input.erasedCount < 0) {
    throw new Error("forgetting store: invalid account erasure receipt counts");
  }
  const hmacKey = input.hmacKey
    ?? process.env.ACCOUNT_ERASURE_RECEIPT_HMAC_KEY
    ?? process.env.MEMORY_TOMBSTONE_HMAC_KEY
    ?? "";
  if (!hmacKey) throw new Error("forgetting store: account receipt HMAC key unavailable");
  const tenantFingerprint = createHmac("sha256", hmacKey)
    .update(String(input.tenantId), "utf8")
    .digest("hex");
  const inserted = rows(await tx.execute(sql`INSERT INTO account_erasure_receipts
    (tenant_fingerprint, request_key, item_count, erased_count, status)
    VALUES (${tenantFingerprint}, ${input.requestKey}, ${input.itemCount},
      ${input.erasedCount}, ${input.status})
    ON CONFLICT (request_key) DO UPDATE SET
      tenant_fingerprint = EXCLUDED.tenant_fingerprint,
      item_count = EXCLUDED.item_count,
      erased_count = EXCLUDED.erased_count,
      status = EXCLUDED.status,
      recorded_at = CURRENT_TIMESTAMP
    WHERE account_erasure_receipts.tenant_fingerprint = EXCLUDED.tenant_fingerprint
    RETURNING request_key`));
  if (inserted.length !== 1) {
    throw new Error("forgetting store: account erasure receipt request key conflict");
  }
}

async function archive(
  tx: QueryExecutor,
  input: { tenantId: number; source: MemoryLifecycleSource; sourceId: string },
): Promise<void> {
  const { tenantId, source, sourceId } = input;
  switch (source) {
    case "memory_entries":
      if (!rows(await tx.execute(sql`UPDATE memory_entries
        SET status = 'archived', archived_at = CURRENT_TIMESTAMP
        WHERE id = ${sourceId} AND tenant_id = ${tenantId} AND status = 'active'
        RETURNING id`)).length) throw new Error("forgetting store: memory entry is not active or not found");
      return;
    case "conversation_facts":
      if (!rows(await tx.execute(sql`UPDATE conversation_facts
        SET status = 'expired', archived_at = CURRENT_TIMESTAMP
        WHERE id = ${sourceId} AND tenant_id = ${tenantId}
          AND status IN ('active', 'promoted') RETURNING id`)).length) {
        throw new Error("forgetting store: conversation fact is not active or not found");
      }
      return;
    case "agent_knowledge":
      if (!rows(await tx.execute(sql`UPDATE agent_knowledge
        SET expires_at = CURRENT_TIMESTAMP, archived_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP WHERE id = ${sourceId} AND tenant_id = ${tenantId}
        RETURNING id`)).length) throw new Error("forgetting store: knowledge row not found");
      return;
    default:
      // Do not silently reinterpret archive as delete or expiry for a source
      // whose lifecycle semantics are not explicitly defined.
      throw new Error(`forgetting store: archive is not supported for ${source}`);
  }
}

export class ForgettingStore implements ForgettingStoreContract {
  private readonly database: typeof db;
  private readonly tombstoneKey: string;

  constructor(database: typeof db = db, tombstoneKey = process.env.MEMORY_TOMBSTONE_HMAC_KEY ?? "") {
    this.database = database;
    this.tombstoneKey = tombstoneKey;
  }

  async loadActivePolicy(tenantId: number): Promise<ActiveRetentionPolicy | null> {
    positiveTenant(tenantId);
    return withTenantTx(tenantId, async (tx: QueryExecutor) => {
        const active = rows(await tx.execute(sql`SELECT version, mode, rules
        FROM memory_retention_policies
        WHERE tenant_id = ${tenantId} AND status = 'active'
          AND (effective_at IS NULL OR effective_at <= CURRENT_TIMESTAMP)
        ORDER BY version DESC, id DESC LIMIT 1`))[0];
      // No configured policy is distinct from a configured-but-corrupt policy.
      // The latter must throw and therefore fail closed.
      return active ? strictRetentionPolicy(active) : null;
    });
  }

  async beginErasureRequest(input: {
    tenantId: number;
    requestKey: string;
    mode: "explicit" | "compliance" | "offboarding";
    reason?: string;
    requestedItems: readonly ExplicitEraseItem[];
    actorId: number;
  }): Promise<{
    execute: boolean;
    status: string;
    erasedCount: number;
    policyVersion: number;
    error?: string | null;
  }> {
    positiveTenant(input.tenantId);
    opaque(input.requestKey, "requestKey");
    if (!Number.isInteger(input.actorId) || input.actorId <= 0) {
      throw new Error("forgetting store: invalid actor id");
    }
    const policyVersion = (await this.loadActivePolicy(input.tenantId))?.version
      ?? defaultMemoryRetentionPolicy.version;
    const envelope = requestEnvelope(input.reason, input.requestedItems, policyVersion);
    return this.database.transaction(async (tx: QueryExecutor) => {
      const inserted = rows(await tx.execute(sql`INSERT INTO memory_erasure_requests
        (tenant_id, request_key, mode, status, reason_code, requested_by_user_id, item_count, started_at)
        VALUES (${input.tenantId}, ${input.requestKey}, ${input.mode}, 'running',
          ${envelope}, ${input.actorId}, ${input.requestedItems.length}, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, request_key) DO NOTHING RETURNING id`)).length > 0;
      const existing = rows(await tx.execute(sql`SELECT status, erased_count, reason_code,
          mode, requested_by_user_id
        FROM memory_erasure_requests
        WHERE tenant_id = ${input.tenantId} AND request_key = ${input.requestKey}
        FOR UPDATE`))[0];
      if (!existing) throw new Error("forgetting store: erasure request disappeared");
      const stored = parseRequestEnvelope(existing.reason_code);
      if (!stored || canonicalRequestedItems(stored.requestedItems) !== canonicalRequestedItems(input.requestedItems) ||
        stored.reason !== (input.reason ?? null) || String(existing.mode) !== input.mode ||
        Number(existing.requested_by_user_id) !== input.actorId) {
        throw new Error("forgetting store: erasure request identity mismatch");
      }
      const status = String(existing.status);
      if (!inserted && status === "pending") {
        await tx.execute(sql`UPDATE memory_erasure_requests
          SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${input.tenantId} AND request_key = ${input.requestKey}`);
      }
      return {
        execute: inserted || status === "pending",
        status,
        erasedCount: Number(existing.erased_count ?? 0),
        policyVersion: stored.policyVersion ?? defaultMemoryRetentionPolicy.version,
        error: stored.error,
      };
    });
  }

  async completeErasureRequest(input: {
    tenantId: number;
    requestKey: string;
    status: "completed" | "failed";
    erasedCount: number;
    error?: string | null;
  }): Promise<void> {
    positiveTenant(input.tenantId);
    opaque(input.requestKey, "requestKey");
    if (!Number.isInteger(input.erasedCount) || input.erasedCount < 0) {
      throw new Error("forgetting store: invalid erased count");
    }
    await this.database.transaction(async (tx: QueryExecutor) => {
      const current = rows(await tx.execute(sql`SELECT reason_code
        FROM memory_erasure_requests
        WHERE tenant_id = ${input.tenantId} AND request_key = ${input.requestKey}
        FOR UPDATE`))[0];
      if (!current) throw new Error("forgetting store: erasure request not found");
      const envelope = parseRequestEnvelope(current.reason_code);
      if (!envelope) throw new Error("forgetting store: erasure request metadata malformed");
      const updatedEnvelope = JSON.stringify({
        version: 2,
        policyVersion: envelope.policyVersion
          ?? defaultMemoryRetentionPolicy.version,
        reason: envelope.reason,
        requestedItems: envelope.requestedItems,
        error: input.error ?? null,
      });
      await tx.execute(sql`UPDATE memory_erasure_requests
        SET status = ${input.status}, erased_count = ${input.erasedCount},
            reason_code = ${updatedEnvelope}, completed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${input.tenantId} AND request_key = ${input.requestKey}`);
    });
  }

  async listStaleErasureRequests(input: {
    limit: number;
    staleMs: number;
  }): Promise<Array<{
    tenantId: number;
    requestKey: string;
    policyVersion: number;
    reason?: string;
    requestedItems: ExplicitEraseItem[];
  }>> {
    const limit = boundedLimit(input.limit);
    if (!Number.isFinite(input.staleMs) || input.staleMs < 1) {
      throw new Error("forgetting store: invalid erasure stale interval");
    }
    const staleSeconds = Math.ceil(input.staleMs / 1000);
    const result = await this.database.execute(sql`SELECT tenant_id, request_key,
        reason_code, updated_at
      FROM memory_erasure_requests
      WHERE status = 'running'
        AND updated_at <= CURRENT_TIMESTAMP - (${staleSeconds} * INTERVAL '1 second')
      ORDER BY updated_at ASC, id ASC
      LIMIT ${limit}`);
    const stale: Array<{
      tenantId: number;
      requestKey: string;
      policyVersion: number;
      reason?: string;
      requestedItems: ExplicitEraseItem[];
    }> = [];
    for (const row of rows(result)) {
      const tenantId = Number(row.tenant_id);
      positiveTenant(tenantId);
      const requestKey = opaque(String(row.request_key), "requestKey");
      const envelope = parseRequestEnvelope(row.reason_code);
      if (!envelope) continue;
      const requestedItems: ExplicitEraseItem[] = [];
      for (const item of envelope.requestedItems) {
        if (!plainObject(item) || typeof item.source !== "string" ||
          !POLICY_SOURCE_KEYS.has(item.source) ||
          typeof item.sourceId !== "string" || !item.sourceId) {
          throw new Error("forgetting store: stale erasure request metadata malformed");
        }
        requestedItems.push({ source: item.source as MemoryLifecycleSource, sourceId: item.sourceId });
      }
      stale.push({
        tenantId,
        requestKey,
        policyVersion: envelope.policyVersion
          ?? defaultMemoryRetentionPolicy.version,
        reason: envelope.reason ?? undefined,
        requestedItems,
      });
    }
    return stale;
  }

  async getErasureProgress(input: {
    tenantId: number;
    requestKey: string;
    policyVersion: number;
    requestedItems: readonly ExplicitEraseItem[];
  }): Promise<{ completedClaims: Set<string>; tombstones: Set<string> }> {
    positiveTenant(input.tenantId);
    opaque(input.requestKey, "requestKey");
    if (!Number.isInteger(input.policyVersion) || input.policyVersion < 1) {
      throw new Error("forgetting store: invalid policyVersion");
    }
    return withTenantTx(input.tenantId, async (tx: QueryExecutor) => {
      const completedClaims = new Set<string>();
      const tombstones = new Set<string>();
      for (const item of input.requestedItems) {
        validateSource(item.source);
        const sourceId = opaque(String(item.sourceId), "sourceId");
        const key = `${item.source}:${sourceId}`;
        const actionKey = `${input.tenantId}:${input.requestKey}:${item.source}:${sourceId}:${input.policyVersion}:erase`;
        const claim = rows(await tx.execute(sql`SELECT id
          FROM memory_lifecycle_action_claims
          WHERE tenant_id = ${input.tenantId} AND action_key = ${actionKey}
            AND source = ${item.source} AND source_id = ${sourceId}
            AND policy_version = ${input.policyVersion} AND action = 'erase'
            AND status = 'completed' LIMIT 1`));
        if (claim.length) completedClaims.add(key);
        const tombstone = rows(await tx.execute(sql`SELECT id
          FROM memory_tombstones
          WHERE tenant_id = ${input.tenantId} AND source = ${item.source}
            AND source_id = ${sourceId} LIMIT 1`));
        if (tombstone.length) tombstones.add(key);
      }
      return { completedClaims, tombstones };
    });
  }

  async listCandidates(input: {
    tenantId: number;
    sources: readonly MemoryLifecycleSource[];
    limit: number;
    cursors?: MemoryForgettingCursorMap;
  }): Promise<MemoryLifecycleCandidatePage> {
    positiveTenant(input.tenantId);
    const limit = boundedLimit(input.limit);
    const sources = [...new Set(input.sources)];
    for (const source of sources) validateSource(source);
    // One read transaction makes each bounded source slice internally
    // consistent while preserving the adapter's tenant boundary.
    return withTenantTx(input.tenantId, async (tx: QueryExecutor) => {
      const all: MemoryLifecycleCandidate[] = [];
      const nextCursors: MemoryForgettingCursorMap = { ...(input.cursors ?? {}) };
      // A tiny batch must not over-read one row from every source and then
      // advance cursors for rows that the coordinator never received.
      const readSources = sources.slice(0, Math.min(limit, sources.length));
      const perSourceLimit = Math.max(1, Math.floor(limit / Math.max(1, readSources.length)));
      for (const source of readSources) {
        const cursor = input.cursors?.[source];
        if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0)) {
          throw new Error("forgetting store: invalid source cursor");
        }
        let sourceRows = await selectCandidateRows(tx, input.tenantId, source, perSourceLimit, cursor);
        // An empty seek page means this source was exhausted.  Only then do
        // we wrap, making a retained prefix unable to starve later rows.
        if (cursor !== undefined && sourceRows.length === 0) {
          sourceRows = await selectCandidateRows(tx, input.tenantId, source, perSourceLimit);
        }
        if (sourceRows.length > 0) {
          const ids = sourceRows.map((row) => Number(row.id));
          const maxId = Math.max(...ids);
          if (Number.isSafeInteger(maxId) && maxId >= 0) nextCursors[source] = maxId;
        }
        all.push(...sourceRows);
      }
      const page = all.slice(0, limit) as MemoryLifecycleCandidatePage;
      page.nextCursors = nextCursors;
      return page;
    });
  }

  async claimSchedulerTenant(input: { leaseMs: number }): Promise<{
    tenantId: number;
    leaseToken: string;
    sourceCursors: MemoryForgettingCursorMap;
    sourceOffset: number;
  } | null> {
    if (!Number.isFinite(input.leaseMs) || input.leaseMs < 1) {
      throw new Error("forgetting store: invalid scheduler lease");
    }
    const leaseToken = randomUUID();
    const leaseSeconds = Math.ceil(input.leaseMs / 1000);
    return this.database.transaction(async (tx: QueryExecutor) => {
      // Locking the tenant row makes selection and lease installation one
      // atomic operation.  SKIP LOCKED lets another worker rotate to a
      // different tenant rather than running the same tenant concurrently.
      const selected = rows(await tx.execute(sql`SELECT t.id,
          COALESCE(s.source_cursors, '{}'::jsonb) AS source_cursors,
          COALESCE(s.next_source_offset, 0) AS source_offset
        FROM tenants t
        LEFT JOIN memory_forgetting_scheduler_state s ON s.tenant_id = t.id
        WHERE t.is_active = true
          AND COALESCE(t.account_status, 'active') NOT IN ('deleted')
          AND (s.lease_expires_at IS NULL OR s.lease_expires_at <= CURRENT_TIMESTAMP)
        ORDER BY s.last_scanned_at ASC NULLS FIRST, t.id ASC
        LIMIT 1
        FOR UPDATE OF t SKIP LOCKED`))[0];
      if (!selected) return null;
      const tenantId = Number(selected.id);
      positiveTenant(tenantId);
      const sourceCursors = cursorMap(
        typeof selected.source_cursors === "string"
          ? JSON.parse(selected.source_cursors)
          : selected.source_cursors,
      );
      const updated = rows(await tx.execute(sql`INSERT INTO memory_forgetting_scheduler_state
          (tenant_id, source_cursors, next_source_offset, lease_token,
           lease_expires_at, updated_at)
        VALUES (${tenantId}, ${JSON.stringify(sourceCursors)}::jsonb,
          ${Number(selected.source_offset) || 0}, ${leaseToken},
          CURRENT_TIMESTAMP + (${leaseSeconds} * INTERVAL '1 second'), CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id) DO UPDATE SET
          lease_token = EXCLUDED.lease_token,
          lease_expires_at = EXCLUDED.lease_expires_at,
          updated_at = CURRENT_TIMESTAMP
        RETURNING tenant_id`));
      if (updated.length !== 1) return null;
      return {
        tenantId,
        leaseToken,
        sourceCursors,
        sourceOffset: Number(selected.source_offset) || 0,
      };
    });
  }

  async completeSchedulerTenant(input: {
    tenantId: number;
    leaseToken: string;
    sourceCursors: MemoryForgettingCursorMap;
    sourceOffset: number;
  }): Promise<boolean> {
    positiveTenant(input.tenantId);
    opaque(input.leaseToken, "leaseToken");
    const sourceCursors = cursorMap(input.sourceCursors);
    if (!Number.isInteger(input.sourceOffset) || input.sourceOffset < 0) {
      throw new Error("forgetting store: invalid source offset");
    }
    const result = await this.database.execute(sql`UPDATE memory_forgetting_scheduler_state
      SET source_cursors = ${JSON.stringify(sourceCursors)}::jsonb,
          next_source_offset = ${input.sourceOffset},
          last_scanned_at = CURRENT_TIMESTAMP,
          lease_token = NULL, lease_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${input.tenantId}
        AND lease_token = ${input.leaseToken}
        AND lease_expires_at > CURRENT_TIMESTAMP
      RETURNING tenant_id`);
    return rows(result).length === 1;
  }

  async claimAction(action: ForgettingAction): Promise<boolean> {
    positiveTenant(action.tenantId);
    validateSource(action.source);
    opaque(action.sourceId, "sourceId");
    opaque(action.actionKey, "actionKey");
    if (!Number.isInteger(action.policyVersion) || action.policyVersion < 1) {
      throw new Error("forgetting store: invalid policyVersion");
    }
    code(action.action, "action");
    if (!action.claimToken) throw new Error("forgetting store: claimToken required");
    const claimTokenHash = createHash("sha256").update(action.claimToken).digest("hex");
    if (!["archive", "purge", "erase"].includes(action.action)) {
      throw new Error("forgetting store: unsupported action");
    }
    return this.database.transaction(async (tx: QueryExecutor) => {
      // DO NOTHING makes the first claimant win without turning a concurrent
      // duplicate into a failed transaction (the unique key is tenant scoped).
      const inserted = rows(await tx.execute(sql`INSERT INTO memory_lifecycle_action_claims
        (tenant_id, action_key, source, source_id, policy_version, action, status,
         attempt_count, lease_expires_at, claim_token_hash)
        VALUES (${action.tenantId}, ${action.actionKey}, ${action.source}, ${action.sourceId},
          ${action.policyVersion}, ${action.action}, 'running', 1,
          CURRENT_TIMESTAMP + (${CLAIM_LEASE_MINUTES} * INTERVAL '1 minute'), ${claimTokenHash})
        ON CONFLICT DO NOTHING RETURNING id`));
      if (inserted.length) return true;
      const existing = rows(await tx.execute(sql`SELECT source, source_id, policy_version, action,
          status, lease_expires_at
        FROM memory_lifecycle_action_claims
        WHERE tenant_id = ${action.tenantId} AND action_key = ${action.actionKey}
        FOR UPDATE`))[0];
      if (!existing) {
        // The other unique identity is (tenant, source, source_id, policy,
        // action).  Refuse an alternate action key rather than claiming it.
        throw new Error("forgetting store: action identity already claimed");
      }
      if (existing) {
        if (
          String(existing.source) !== action.source
          || String(existing.source_id) !== action.sourceId
          || Number(existing.policy_version) !== action.policyVersion
          || String(existing.action) !== action.action
        ) throw new Error("forgetting store: action key identity mismatch");
        if (String(existing.status) === "completed") return false;
        const leaseActive = existing.lease_expires_at
          && new Date(String(existing.lease_expires_at)).getTime() > Date.now();
        if (String(existing.status) === "running" && leaseActive) return false;
        await tx.execute(sql`UPDATE memory_lifecycle_action_claims
          SET status = 'running', attempt_count = attempt_count + 1,
              lease_expires_at = CURRENT_TIMESTAMP + (${CLAIM_LEASE_MINUTES} * INTERVAL '1 minute'),
              claim_token_hash = ${claimTokenHash}, failure_code = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${action.tenantId} AND action_key = ${action.actionKey}`);
        return true;
      }
      return false;
    });
  }

  /**
   * Completion support is exposed for callers that extend the coordinator
   * contract.  The current coordinator interface has no completion callback,
   * so its claims remain retryable after the mutation transaction.
   */
  async markActionCompleted(action: ForgettingAction): Promise<boolean> {
    positiveTenant(action.tenantId);
    validateSource(action.source);
    opaque(action.actionKey, "actionKey");
    opaque(action.sourceId, "sourceId");
    if (!["archive", "purge", "erase"].includes(action.action)) {
      throw new Error("forgetting store: unsupported action");
    }
    if (!action.claimToken) throw new Error("forgetting store: claimToken required");
    const claimTokenHash = createHash("sha256").update(action.claimToken).digest("hex");
    const result = await this.database.execute(sql`UPDATE memory_lifecycle_action_claims
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
          lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${action.tenantId} AND action_key = ${action.actionKey}
        AND source = ${action.source} AND source_id = ${action.sourceId}
        AND policy_version = ${action.policyVersion} AND action = ${action.action}
        AND claim_token_hash = ${claimTokenHash}
        AND status <> 'completed' RETURNING id`);
    return rows(result).length > 0;
  }

  async markActionFailed(action: ForgettingAction, failureCode: string): Promise<boolean> {
    positiveTenant(action.tenantId);
    validateSource(action.source);
    code(failureCode, "failureCode");
    if (!action.claimToken) throw new Error("forgetting store: claimToken required");
    const claimTokenHash = createHash("sha256").update(action.claimToken).digest("hex");
    const result = await this.database.execute(sql`UPDATE memory_lifecycle_action_claims
      SET status = 'failed', failure_code = ${failureCode}, lease_expires_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${action.tenantId} AND action_key = ${action.actionKey}
        AND claim_token_hash = ${claimTokenHash}
        AND status = 'running' AND lease_expires_at > CURRENT_TIMESTAMP
        RETURNING id`);
    return rows(result).length > 0;
  }

  async archiveCandidate(input: {
    tenantId: number;
    source: MemoryLifecycleSource;
    sourceId: string;
    actionKey: string;
  }): Promise<void> {
    positiveTenant(input.tenantId);
    validateSource(input.source);
    opaque(input.sourceId, "sourceId");
    await withTenantTx(input.tenantId, async (tx: QueryExecutor) => archive(tx, input));
  }

  async isArchived(input: {
    tenantId: number;
    source: MemoryLifecycleSource;
    sourceId: string;
  }): Promise<boolean> {
    positiveTenant(input.tenantId);
    validateSource(input.source);
    opaque(input.sourceId, "sourceId");
    return withTenantTx(input.tenantId, async (tx: QueryExecutor) => {
      switch (input.source) {
        case "memory_entries":
          return rows(await tx.execute(sql`SELECT id FROM memory_entries WHERE id = ${input.sourceId}
            AND tenant_id = ${input.tenantId} AND status IN ('archived','expired','superseded','phantom') LIMIT 1`)).length > 0;
        case "conversation_facts":
          return rows(await tx.execute(sql`SELECT id FROM conversation_facts WHERE id = ${input.sourceId}
            AND tenant_id = ${input.tenantId} AND status = 'expired' LIMIT 1`)).length > 0;
        case "agent_knowledge":
          return rows(await tx.execute(sql`SELECT id FROM agent_knowledge WHERE id = ${input.sourceId}
            AND tenant_id = ${input.tenantId} AND expires_at IS NOT NULL
            AND expires_at <= CURRENT_TIMESTAMP LIMIT 1`)).length > 0;
        case "compaction_archives":
          return rows(await tx.execute(sql`SELECT id FROM compaction_archives WHERE id = ${input.sourceId}
            AND tenant_id = ${input.tenantId} LIMIT 1`)).length > 0;
        default:
          return false;
      }
    });
  }

  async withTransaction<T>(fn: (tx: ForgettingTransaction) => Promise<T>): Promise<T> {
    // The coordinator's transaction callback carries tenant_id on every
    // operation.  Use one Drizzle transaction; methods enforce tenant scope
    // themselves and do not rely on ambient context.
    return this.database.transaction(async (tx: QueryExecutor) => {
        const transaction: ForgettingTransaction = {
          assertClaim: async (action) => {
            if (!action.claimToken) throw new Error("forgetting store: claimToken required");
            const hash = createHash("sha256").update(action.claimToken).digest("hex");
            const active = rows(await tx.execute(sql`SELECT id
              FROM memory_lifecycle_action_claims
              WHERE tenant_id = ${action.tenantId} AND action_key = ${action.actionKey}
                AND claim_token_hash = ${hash} AND status = 'running'
                AND lease_expires_at > CURRENT_TIMESTAMP
              FOR UPDATE`));
            if (active.length !== 1) throw new Error("forgetting store: stale or invalid claim");
          },
          completeAction: async (action) => {
            if (!action.claimToken) throw new Error("forgetting store: claimToken required");
            const hash = createHash("sha256").update(action.claimToken).digest("hex");
            const completed = rows(await tx.execute(sql`UPDATE memory_lifecycle_action_claims
              SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
                  lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
              WHERE tenant_id = ${action.tenantId} AND action_key = ${action.actionKey}
                AND claim_token_hash = ${hash} AND status = 'running'
              RETURNING id`));
            if (completed.length !== 1) throw new Error("forgetting store: claim completion failed");
          },
          archiveCandidate: async (input) => archive(tx, input),
          createTombstone: async (tombstone) => {
            positiveTenant(tombstone.tenantId);
            validateSource(tombstone.source);
            opaque(tombstone.sourceId, "sourceId");
            if (!this.tombstoneKey) throw new Error("forgetting store: tombstone key unavailable");
            opaque(tombstone.requestKey, "requestKey");
            await insertContentTombstone(tx, {
              tenantId: tombstone.tenantId,
              source: tombstone.source,
              sourceId: tombstone.sourceId,
              requestKey: tombstone.requestKey,
            }, this.tombstoneKey);
            return true;
          },
          recordAudit: async (audit: ForgettingAuditRecord) => {
            positiveTenant(audit.tenantId);
            validateSource(audit.source);
            opaque(audit.sourceId, "sourceId");
            opaque(audit.actionKey, "actionKey");
            code(audit.action, "action");
            code(audit.reasonCode, "reasonCode");
            const claim = rows(await tx.execute(sql`SELECT source, source_id, action
              FROM memory_lifecycle_action_claims
              WHERE tenant_id = ${audit.tenantId} AND action_key = ${audit.actionKey}
                AND source = ${audit.source} AND source_id = ${audit.sourceId}
                AND policy_version = ${audit.policyVersion}
                AND action = ${audit.action} LIMIT 1`));
            if (!claim.length) throw new Error("forgetting store: audit claim tenant verification failed");
            await tx.execute(sql`INSERT INTO memory_lifecycle_audits
              (tenant_id, action_key, source, source_id, policy_version, action, mode,
               outcome, reason_code, request_key)
              VALUES (${audit.tenantId}, ${audit.actionKey}, ${audit.source}, ${audit.sourceId},
                ${audit.policyVersion}, ${audit.action},
                ${audit.requestKey ? "explicit" : "mutate"}, 'recorded',
                ${audit.reasonCode}, ${audit.requestKey ?? null})`);
          },
          deleteCandidate: async (request) => {
            positiveTenant(request.tenantId);
            validateSource(request.source);
            opaque(request.sourceId, "sourceId");
            opaque(request.requestKey, "requestKey");
            if (!this.tombstoneKey) throw new Error("forgetting store: tombstone key unavailable");
            // The coordinator has already tombstoned/audited the root.  This
            // adapter-owned walk adds the same evidence for every solely
            // derived child, in post-order, before deleting the root.
            await eraseSolelyDerivedDescendants(tx, request, this.tombstoneKey);
            await tx.execute(sql`DELETE FROM memory_derivations
              WHERE tenant_id = ${request.tenantId}
                AND ((parent_source = ${request.source} AND parent_id = ${request.sourceId})
                  OR (child_source = ${request.source} AND child_id = ${request.sourceId}))`);
            return deleteSource(tx, request);
          },
        };
      return fn(transaction);
    });
  }
}

export const createForgettingStore = (
  database: typeof db = db,
  tombstoneKey = process.env.MEMORY_TOMBSTONE_HMAC_KEY ?? "",
): ForgettingStore => new ForgettingStore(database, tombstoneKey);