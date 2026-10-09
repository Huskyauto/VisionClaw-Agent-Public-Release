import { sql, type SQL } from "drizzle-orm";

type QueryResult = { rows?: unknown[] } | unknown[];
export type AggregateQuery = (statement: SQL) => Promise<QueryResult>;

function firstRow(result: QueryResult): Record<string, unknown> {
  const rows = Array.isArray(result) ? result : result.rows;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") {
    throw new Error("Knowledge quality query did not return one aggregate row");
  }
  return rows[0] as Record<string, unknown>;
}

function count(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value) || value < 0 || row[key] == null) {
    throw new Error(`Invalid knowledge quality aggregate: ${key}`);
  }
  return value;
}

/**
 * A bounded, read-only structural baseline, NOT a recall or answer-quality test.
 * No titles, content, URLs, embeddings, or source labels leave the database.
 */
export async function checkKnowledgeQuality(tenantId: number, execute: AggregateQuery) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error("A positive tenant ID is required for the knowledge quality check");
  }

  const knowledge = firstRow(await execute(sql`
    SELECT count(*)::int AS recent,
           count(*) FILTER (WHERE source IN (
             'autoresearch', 'release_log', 'agent_skill', 'output_skill',
             'loop_contract', 'platform_briefing', 'knowledge_compile'
           ))::int AS vector_cohort,
           count(*) FILTER (WHERE embedding_vec IS NULL AND source IN (
             'autoresearch', 'release_log', 'agent_skill', 'output_skill',
             'loop_contract', 'platform_briefing', 'knowledge_compile'
           ))::int AS vector_missing,
           count(*) FILTER (WHERE access_count > 0)::int AS accessed
      FROM agent_knowledge
     WHERE tenant_id = ${tenantId}
       AND created_at >= NOW() - INTERVAL '30 days'
       AND archived_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
  `));
  const memory = firstRow(await execute(sql`
    SELECT count(*)::int AS recent,
           count(*) FILTER (WHERE embedding_vec IS NULL)::int AS vector_missing,
           count(*) FILTER (WHERE access_count > 0)::int AS accessed
      FROM memory_entries
     WHERE tenant_id = ${tenantId}
       AND created_at >= NOW() - INTERVAL '30 days'
       AND status = 'active'
       AND deleted_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
  `));
  const evidence = firstRow(await execute(sql`
    SELECT count(*)::int AS recent,
           count(*) FILTER (WHERE NULLIF(BTRIM(source_url), '') IS NOT NULL
                              AND NULLIF(BTRIM(source_title), '') IS NOT NULL)::int AS source_linked,
           count(*) FILTER (WHERE NULLIF(BTRIM(source_url), '') IS NOT NULL
                              AND NULLIF(BTRIM(source_title), '') IS NOT NULL
                              AND NULLIF(BTRIM(passage_hash), '') IS NOT NULL)::int AS passage_anchored
      FROM research_evidence
     WHERE tenant_id = ${tenantId}
       AND created_at >= NOW() - INTERVAL '30 days'
       AND status = 'active'
  `));

  const knowledgeRecent = count(knowledge, "recent");
  const vectorCohort = count(knowledge, "vector_cohort");
  const vectorMissing = count(knowledge, "vector_missing");
  const memoryRecent = count(memory, "recent");
  const memoryMissing = count(memory, "vector_missing");
  const evidenceRecent = count(evidence, "recent");
  const sourceLinked = count(evidence, "source_linked");
  const passageAnchored = count(evidence, "passage_anchored");
  if (vectorCohort > knowledgeRecent || vectorMissing > vectorCohort ||
      memoryMissing > memoryRecent || sourceLinked > evidenceRecent ||
      passageAnchored > sourceLinked) {
    throw new Error("Inconsistent knowledge quality aggregates");
  }
  return {
    windowDays: 30,
    tenantId,
    knowledge: {
      recentActive: knowledgeRecent,
      vectorCohort,
      vectorMissingInCohort: vectorMissing,
      vectorCoverageInCohort: vectorCohort === 0 ? null : (vectorCohort - vectorMissing) / vectorCohort,
      previouslyAccessed: count(knowledge, "accessed"),
    },
    memory: {
      recentActive: memoryRecent,
      vectorMissing: memoryMissing,
      previouslyAccessed: count(memory, "accessed"),
    },
    evidence: {
      recentActive: evidenceRecent,
      sourceLinked,
      passageAnchored,
      sourceLinkCoverage: evidenceRecent === 0 ? null : sourceLinked / evidenceRecent,
    },
    limitations: [
      "The vector cohort uses the same seven source tags as the existing knowledge lint; this does not verify each writer's embedding contract.",
      "Missing vectors do not prove an entry is unfindable: keyword search may still find it.",
      "Access counts are observed use, not relevance. A source URL and title do not prove a citation is correct.",
      "This baseline does not measure recall, answer accuracy, or cross-store links; those require labeled real questions.",
    ],
  };
}