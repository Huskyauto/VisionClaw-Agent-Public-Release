import { sql } from "drizzle-orm";
import { SESSION_FACT_PREFILTER_VERSION, SESSION_FACT_SKIP_THRESHOLD } from "./typesafe-fact-prefilter";

export function parseFactPrefilterReportArgs(args: string[]): { tenantId: number; days: number } {
  if (args.some((value, i) => i % 2 === 0 && !["--tenant", "--days"].includes(value)) ||
      args.filter((value) => value === "--tenant").length !== 1 ||
      args.filter((value) => value === "--days").length > 1 || args.length % 2 !== 0) {
    throw new Error("Usage: --tenant <positive integer> [--days <1-30>]");
  }
  const tenantId = Number(args[args.indexOf("--tenant") + 1]);
  const dayIndex = args.indexOf("--days");
  const days = dayIndex < 0 ? 7 : Number(args[dayIndex + 1]);
  if (!Number.isSafeInteger(tenantId) || tenantId < 1) throw new Error("tenant must be a positive integer");
  if (!Number.isSafeInteger(days) || days < 1 || days > 30) throw new Error("days must be between 1 and 30");
  return { tenantId, days };
}

/** Aggregate-only, explicit-tenant query. No raw state, identities or traces leave
 * storage. v1 had ambiguous failure/empty outcomes, so it cannot support v2 claims. */
export function factPrefilterReportQuery(tenantId: number, days: number) {
  if (!Number.isSafeInteger(tenantId) || tenantId < 1) throw new Error("tenant must be a positive integer");
  if (!Number.isSafeInteger(days) || days < 1 || days > 30) throw new Error("days must be between 1 and 30");
  return sql`
    SELECT mode, model,
      count(*)::int AS observations,
      count(*) FILTER (WHERE status = 'validated')::int AS classified,
      count(*) FILTER (WHERE status IN ('blocked', 'unavailable'))::int AS unavailable,
      count(*) FILTER (WHERE extractor_ran IS NULL)::int AS pending_outcomes,
      count(*) FILTER (WHERE error_class IS NOT NULL)::int AS failed_outcomes,
      count(*) FILTER (WHERE status = 'validated' AND mode = 'enforce'
        AND durable_fact_probability <= ${SESSION_FACT_SKIP_THRESHOLD}
        AND extractor_ran = false AND error_class IS NULL AND decision_receipt IS NOT NULL)::int AS actual_skipped_calls,
      count(*) FILTER (WHERE status = 'validated' AND mode = 'shadow'
        AND durable_fact_probability <= ${SESSION_FACT_SKIP_THRESHOLD}
        AND extractor_ran = true AND error_class IS NULL AND facts_written = 0)::int AS shadow_empty_candidates,
      count(*) FILTER (WHERE status = 'validated' AND mode = 'shadow'
        AND durable_fact_probability <= ${SESSION_FACT_SKIP_THRESHOLD}
        AND extractor_ran = true AND error_class IS NULL AND facts_written > 0)::int AS shadow_missed_fact_candidates,
      coalesce(sum(input_tokens), 0)::bigint AS jev_input_tokens,
      coalesce(sum(output_tokens), 0)::bigint AS jev_output_tokens,
      count(*) FILTER (WHERE decision_receipt IS NOT NULL)::int AS traced_decisions,
      sum(CASE WHEN jsonb_typeof(decision_receipt->'latencyMs') = 'number'
        THEN (decision_receipt->>'latencyMs')::numeric END) AS jev_total_latency_ms,
      sum(CASE WHEN jsonb_typeof(decision_receipt->'downstream'->'durationMs') = 'number'
        THEN (decision_receipt->'downstream'->>'durationMs')::numeric END) AS extractor_total_latency_ms
    FROM typesafe_fact_prefilter_observations
    WHERE tenant_id = ${tenantId}
      AND version = ${SESSION_FACT_PREFILTER_VERSION}
      AND created_at >= now() - make_interval(days => ${days}::int)
    GROUP BY mode, model
    ORDER BY mode, model
    LIMIT 100
  `;
}
