import { dbCheckpointStore, type CheckpointStore } from "./agentic/pipeline-checkpoint";
import type { TurnContextManifest } from "./chat-context-provenance";

const jobKey = (conversationId: number) => `chat-context-provenance:${conversationId}`;

/** Assembly evidence, not a claim that a remote model received or obeyed it. */
export async function persistTurnContextManifest(
  tenantId: number,
  manifest: TurnContextManifest,
  store: CheckpointStore = dbCheckpointStore(),
): Promise<void> {
  await store.upsert({
    tenantId, jobKey: jobKey(manifest.conversationId), stage: "context_manifest",
    unitKey: `message:${manifest.userMessageId}`, status: "completed",
    artifact: { ...manifest, evidenceKind: "prepared_model_context" },
  });
}

/** Called only after sessionsHistory has verified conversation ownership. */
export async function readTurnContextManifests(
  tenantId: number,
  conversationId: number,
  userMessageIds: number[],
): Promise<Map<number, TurnContextManifest>> {
  if (!userMessageIds.length) return new Map();
  const { db } = await import("./db");
  const { sql } = await import("drizzle-orm");
  const ids = userMessageIds.slice(-20);
  const units = ids.map((id) => `message:${id}`);
  const result = await db.execute(sql`
    SELECT artifact FROM pipeline_stage_artifacts
     WHERE tenant_id = ${tenantId}
       AND job_key = ${jobKey(conversationId)}
       AND stage = 'context_manifest'
       AND unit_key IN (${sql.join(units.map((unit) => sql`${unit}`), sql`, `)})
       AND status = 'completed'
     LIMIT 20
  `);
  const manifests = new Map<number, TurnContextManifest>();
  for (const row of result.rows) {
    const artifact = row.artifact as TurnContextManifest;
    if (artifact?.version === 1 && artifact.conversationId === conversationId &&
        ids.includes(artifact.userMessageId) && Array.isArray(artifact.blocks)) {
      manifests.set(artifact.userMessageId, artifact);
    }
  }
  return manifests;
}