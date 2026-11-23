import { sql, type SQL } from "drizzle-orm";
import type { WorkingContextRepository } from "./working-context";
import type { WorkingContextArtifact, WorkingContextScope, WorkingContextSource } from "./lib/agent-working-context";
import { visibleWorkingContextText } from "./lib/agent-working-context";

const LIVE = "agent_working_context_v1";
const DREAM = "agent_working_context_dream_v1";
const jobKey = (conversationId: number) => `agent-working-context:conversation:${conversationId}`;
// Same fallback as project-context.ts, but deterministic for multi-linked chats.
// Alias c is fixed by the queries below; every link is owner-checked.
const effectiveProject = sql`COALESCE(c.project_id, (
  SELECT pc.project_id FROM project_conversations pc
  JOIN projects linked_project ON linked_project.id = pc.project_id
    AND linked_project.tenant_id = c.tenant_id
  WHERE pc.conversation_id = c.id ORDER BY pc.project_id LIMIT 1))`;
const visibleContent = sql`CASE WHEN m.role = 'assistant'
  THEN regexp_replace(m.content, ${"^<!-- tools:[^\\n]* -->\\r?\\n"}, '')
  ELSE m.content END`;
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => {
  if (Array.isArray(value)) return value as Row[];
  return (value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)) ? value.rows as Row[] : [];
};
const scopeFrom = (row: Row): WorkingContextScope => ({
  tenantId: Number(row.tenant_id), conversationId: Number(row.id),
  personaId: row.persona_id == null ? null : Number(row.persona_id),
  projectId: row.project_id == null ? null : Number(row.project_id),
});

/** Existing artifact table, reserved namespace; values contain source pointers only. */
export function workingContextRepository(executor?: { execute(query: SQL): Promise<unknown> }): WorkingContextRepository {
  return {
    async resolveScope(tenantId, conversationId) {
      const db = executor || (await import("./db")).db;
      const result = await db.execute(sql`
        SELECT c.id, c.tenant_id, c.persona_id, p.id AS project_id,
          ${effectiveProject} AS bound_project_id
        FROM conversations c LEFT JOIN projects p
          ON p.id = ${effectiveProject} AND p.tenant_id = c.tenant_id
        WHERE c.id = ${conversationId} AND c.tenant_id = ${tenantId}
          AND c.deleted_at IS NULL LIMIT 1`);
      const row = rows(result)[0];
      // A dangling/cross-tenant project association never becomes personal context.
      if (!row) return null;
      if (row.bound_project_id != null && row.project_id == null) return null;
      return scopeFrom(row);
    },
    async loadArtifacts(scope) {
      const db = executor || (await import("./db")).db;
      const result = await db.execute(sql`
        WITH scoped_conversations AS (
          SELECT c.id FROM conversations c
          WHERE c.tenant_id = ${scope.tenantId} AND c.deleted_at IS NULL
            AND c.persona_id IS NOT DISTINCT FROM ${scope.personaId}::integer
            AND ${effectiveProject} IS NOT DISTINCT FROM ${scope.projectId}::integer
          ORDER BY (c.id = ${scope.conversationId}) DESC, c.updated_at DESC LIMIT 3
        )
        SELECT artifact FROM (SELECT a.artifact, a.stage, a.updated_at,
          ROW_NUMBER() OVER (PARTITION BY a.job_key, a.stage ORDER BY a.updated_at DESC) AS entry_rank
        FROM scoped_conversations c
        JOIN pipeline_stage_artifacts a
          ON a.tenant_id = ${scope.tenantId}
          AND a.job_key = 'agent-working-context:conversation:' || c.id::text
        WHERE a.stage IN (${LIVE}, ${DREAM}) AND a.status = 'completed') ranked
        WHERE (stage = ${DREAM} AND entry_rank = 1)
          OR (stage = ${LIVE} AND entry_rank <= 7)
        ORDER BY updated_at DESC LIMIT 24`).catch((error: unknown) => {
          const failure = error as { code?: string; cause?: { code?: string } };
          if (failure.code === "42P01" || failure.cause?.code === "42P01") return { rows: [] };
          throw error;
        });
      return rows(result).map(row => row.artifact as WorkingContextArtifact);
    },
    async loadSources(scope, ids) {
      if (!ids.length) return [];
      const safeIds = [...new Set(ids.filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 768);
      if (!safeIds.length) return [];
      const db = executor || (await import("./db")).db;
      const result = await db.execute(sql`
        SELECT m.id AS message_id, m.role, LEFT(${visibleContent}, 16000) AS content,
          encode(sha256(convert_to(m.content, 'UTF8')), 'hex') AS revision, m.created_at,
          c.id, c.tenant_id, c.persona_id, ${effectiveProject} AS project_id
        FROM messages m JOIN conversations c
          ON c.id = m.conversation_id AND c.tenant_id = m.tenant_id
        WHERE m.tenant_id = ${scope.tenantId} AND c.tenant_id = ${scope.tenantId}
          AND m.id IN (${sql.join(safeIds.map(id => sql`${id}`), sql`, `)})
          AND m.role IN ('user', 'assistant') AND c.deleted_at IS NULL
          AND c.persona_id IS NOT DISTINCT FROM ${scope.personaId}::integer
          AND ${effectiveProject} IS NOT DISTINCT FROM ${scope.projectId}::integer`);
      return rows(result).map(row => ({
        ...scopeFrom(row), id: Number(row.message_id), role: row.role as "user" | "assistant",
        content: visibleWorkingContextText(row.role as "user" | "assistant", String(row.content)),
        revision: String(row.revision),
        createdAt: new Date(String(row.created_at)).toISOString(),
      } satisfies WorkingContextSource));
    },
    async save(artifact, consolidated = false) {
      const db = executor || (await import("./db")).db;
      if (!executor) {
        const { ensurePipelineStageArtifactsTable } = await import("./agentic/pipeline-checkpoint-table");
        await ensurePipelineStageArtifactsTable();
      }
      const scope = artifact.scope;
      // Bind scope again inside the write; a relink racing extraction cannot
      // persist a candidate under an obsolete agent/project association.
      await db.execute(sql`
        INSERT INTO pipeline_stage_artifacts
          (tenant_id, job_key, stage, unit_key, status, artifact)
        SELECT ${scope.tenantId}, ${jobKey(scope.conversationId)}, ${consolidated ? DREAM : LIVE},
          ${consolidated ? "consolidated" : String(artifact.userMessageId)}, 'completed',
          ${JSON.stringify(artifact)}::jsonb
        FROM conversations c WHERE c.id = ${scope.conversationId}
          AND c.tenant_id = ${scope.tenantId} AND c.deleted_at IS NULL
          AND c.persona_id IS NOT DISTINCT FROM ${scope.personaId}::integer
          AND ${effectiveProject} IS NOT DISTINCT FROM ${scope.projectId}::integer
        ON CONFLICT (tenant_id, job_key, stage, unit_key) DO UPDATE
          SET artifact = EXCLUDED.artifact, updated_at = CURRENT_TIMESTAMP
          WHERE ${consolidated}
            AND (pipeline_stage_artifacts.artifact->>'userMessageId')::bigint
              < (EXCLUDED.artifact->>'userMessageId')::bigint`);
    },
    async recentConversations(tenantId) {
      const db = executor || (await import("./db")).db;
      const result = await db.execute(sql`
        SELECT c.id FROM conversations c JOIN pipeline_stage_artifacts a
          ON a.tenant_id = c.tenant_id
          AND a.job_key = 'agent-working-context:conversation:' || c.id::text
        WHERE c.tenant_id = ${tenantId} AND a.tenant_id = ${tenantId}
          AND c.deleted_at IS NULL AND a.stage = ${LIVE}
          AND a.updated_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
        GROUP BY c.id ORDER BY MAX(a.updated_at) DESC LIMIT 8`);
      return rows(result).map(row => Number(row.id));
    },
  };
}
