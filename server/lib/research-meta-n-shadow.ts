import { sql } from "drizzle-orm";
import { db } from "../db";
import { getClientForModel } from "../providers";
import {
  runResearchMetaNShadowStep,
  type ResearchMetaNShadowRecord,
  type ResearchMetaNTrace,
} from "./research-meta-n";

export type { ResearchMetaNShadowRecord } from "./research-meta-n";

interface MetaNSessionState {
  sessionId: number;
  tenantId: number;
  model: string;
  metaNStrategyLayers: ResearchMetaNShadowRecord[];
  previousResults: Array<{
    experimentId: number;
    hypothesis: string;
    approach: string;
    status: string;
    score: number;
    metric_value: string | null;
    result: string | null;
  }>;
}

function resultRows(result: unknown): unknown[] {
  const candidate = result && typeof result === "object" && "rows" in result
    ? (result as { rows?: unknown }).rows
    : result;
  return Array.isArray(candidate) ? candidate : [];
}

const stats = {
  attempted: 0,
  generated: 0,
  blocked: 0,
  degraded: 0,
};

export function getResearchMetaNStats() {
  return { ...stats };
}

function serializeResearchMetaNRecord(record: ResearchMetaNShadowRecord): string {
  return `[RESEARCH_META_N_SHADOW]${JSON.stringify(record)}`;
}

async function appendMetaNRecord(
  tenantId: number,
  experimentId: number,
  record: ResearchMetaNShadowRecord,
): Promise<void> {
  const serialized = serializeResearchMetaNRecord(record);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
    await tx.execute(sql`SET LOCAL lock_timeout = '1500ms'`);
    return tx.execute(sql`
      UPDATE research_experiments SET verification_details =
        CASE
          WHEN verification_details IS NULL OR verification_details = '' THEN ${serialized}
          ELSE verification_details || E'\n' || ${serialized}
        END
      WHERE id = ${experimentId} AND tenant_id = ${tenantId}
      RETURNING id
    `);
  });
  const rows = resultRows(result);
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("tenant-scoped experiment row was not updated");
  }
}

export async function persistResearchMetaNShadow(input: {
  session: MetaNSessionState;
  experimentId: number;
}): Promise<void> {
  const { session, experimentId } = input;
  const traces: ResearchMetaNTrace[] = session.previousResults.map((result) => ({
    experimentId: result.experimentId,
    hypothesis: result.hypothesis,
    approach: result.approach,
    result: result.result || "",
    status: result.status,
    score: result.score,
  }));

  const record = await runResearchMetaNShadowStep({
    modeValue: process.env.RESEARCH_META_N_MODE,
    tenantId: session.tenantId,
    sessionId: session.sessionId,
    experimentId,
    traces,
    existingLayers: session.metaNStrategyLayers,
  }, {
    claimBudget: async (claim) => {
      const { claimAutonomousBudget } = await import("../agentic/autonomous-budget");
      return claimAutonomousBudget(claim);
    },
    generateStrategy: async (prompt) => {
      const { client, actualModelId } = await getClientForModel(
        session.model,
        session.tenantId,
      );
      const result = await client.chat.completions.create({
          model: actualModelId,
          messages: [
            {
              role: "system",
              content: "Execute the fixed research meta-operation exactly. Return strict JSON only.",
            },
            { role: "user", content: prompt },
          ],
          max_completion_tokens: 700,
        }, {
          timeout: 15_000,
          maxRetries: 0,
        });
      return {
        content: result.choices[0]?.message?.content || "",
        model: actualModelId,
        tokens: result.usage?.total_tokens || 0,
      };
    },
    persistRecord: async ({ tenantId, experimentId: targetExperimentId, record: persisted }) => {
      await appendMetaNRecord(tenantId, targetExperimentId, persisted);
    },
    log: (message, error) => console.warn(message, error),
  });

  if (!record) return;
  stats.attempted++;
  if (record.status === "generated") stats.generated++;
  else if (record.status === "blocked") stats.blocked++;
  else stats.degraded++;
  session.metaNStrategyLayers.push(record);
  console.log(
    `[research:meta-n] session #${session.sessionId} exp #${experimentId} ` +
    `depth=${record.depth} status=${record.status} apply=false`,
  );
}