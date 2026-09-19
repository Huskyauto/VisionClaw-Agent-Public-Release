/**
 * Knowledge lint — cross-store consistency sweep over the knowledge stack
 * (LLM Wiki borrow #2, 2026-07-30 — see .agents/memory/karpathy-llm-wiki-verdict.md).
 *
 * Supersession works WITHIN each store (store_triple expires S+P conflicts,
 * memory_entries has succeeded_by_id/valid_until) but nothing sweeps ACROSS
 * stores for drift. This script runs deterministic, READ-ONLY checks:
 *
 *   1. triples-duplicate-active   — >1 active triple for the same tenant+subject+predicate
 *                                   (supersession failed / raced).
 *   2. memory-superseded-no-link  — status='superseded' without succeeded_by_id
 *                                   (violates the supersession convention).
 *   3. memory-stale-active        — status='active' but valid_until already passed.
 *   4. knowledge-embedding-dead   — agent_knowledge rows with NULL embedding_vec
 *                                   (invisible to vectorSearchKnowledge), by source.
 *   5. concept-stale-vs-triple    — compiled_concept row whose key matches an
 *                                   active triple subject updated MORE RECENTLY
 *                                   than the concept (concept may lag the fact).
 *
 * Advisory only: no writes, no LLM calls, no auto-fixes. Consumed by
 * weekly-maintenance Pass 19 (YELLOW on findings, never RED).
 *
 * Run manually:  npx tsx scripts/knowledge-lint.ts --json
 * Exit codes: 0 clean, 1 findings present, 2 lint errored.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

interface LintFinding {
  check: string;
  count: number;
  sample: string[];
}

const SAMPLE_LIMIT = 10;

function rows(res: unknown): any[] {
  return ((res as any).rows || res) as any[];
}

async function run(): Promise<{ ok: boolean; findings: LintFinding[] }> {
  const findings: LintFinding[] = [];

  // 1. Duplicate ACTIVE triples for the same subject+predicate.
  const dupTriples = rows(await db.execute(sql`
    SELECT tenant_id, subject, predicate, count(*)::int AS n
      FROM knowledge_triples
     WHERE valid_until IS NULL OR valid_until > NOW()
     GROUP BY tenant_id, subject, predicate
    HAVING count(*) > 1
     ORDER BY n DESC
     LIMIT 200
  `));
  if (dupTriples.length) {
    findings.push({
      check: "triples-duplicate-active",
      count: dupTriples.length,
      sample: dupTriples.slice(0, SAMPLE_LIMIT).map((r) => `t${r.tenant_id} ${r.subject} · ${r.predicate} ×${r.n}`),
    });
  }

  // 2. Superseded memory entries missing the succession link.
  const orphanSuperseded = rows(await db.execute(sql`
    SELECT id, tenant_id FROM memory_entries
     WHERE status = 'superseded' AND succeeded_by_id IS NULL
     ORDER BY id DESC
     LIMIT 200
  `));
  if (orphanSuperseded.length) {
    findings.push({
      check: "memory-superseded-no-link",
      count: orphanSuperseded.length,
      sample: orphanSuperseded.slice(0, SAMPLE_LIMIT).map((r) => `memory_entries.id=${r.id} (t${r.tenant_id})`),
    });
  }

  // 3. Entries still 'active' whose validity window already closed.
  const staleActive = rows(await db.execute(sql`
    SELECT id, tenant_id, valid_until FROM memory_entries
     WHERE status = 'active' AND valid_until IS NOT NULL AND valid_until < NOW()
     ORDER BY valid_until ASC
     LIMIT 200
  `));
  if (staleActive.length) {
    findings.push({
      check: "memory-stale-active",
      count: staleActive.length,
      sample: staleActive.slice(0, SAMPLE_LIMIT).map((r) => `memory_entries.id=${r.id} valid_until=${r.valid_until}`),
    });
  }

  // 4. Retrieval-dead agent_knowledge rows (no vector → invisible to the vector
  //    half of hybrid search). Scoped to sources an embedding backfill actually
  //    covers (server/embeddings.ts: autoresearch; agent-knowledge-refresh: the
  //    rest) — other sources (e.g. step_ledger) are never embedded by design.
  const deadEmbeddings = rows(await db.execute(sql`
    SELECT source, count(*)::int AS n FROM agent_knowledge
     WHERE embedding_vec IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
       AND source IN ('autoresearch', 'release_log', 'agent_skill', 'output_skill', 'loop_contract', 'platform_briefing', 'knowledge_compile')
     GROUP BY source
     ORDER BY n DESC
  `));
  const deadTotal = deadEmbeddings.reduce((s, r) => s + r.n, 0);
  if (deadTotal > 0) {
    findings.push({
      check: "knowledge-embedding-dead",
      count: deadTotal,
      sample: deadEmbeddings.slice(0, SAMPLE_LIMIT).map((r) => `source=${r.source} ×${r.n}`),
    });
  }

  // 5. Compiled concepts lagging a more recently updated active triple with a
  //    matching subject (cheap cross-store staleness proxy: slugified subject
  //    equals the concept key).
  const staleConcepts = rows(await db.execute(sql`
    SELECT k.title, k.updated_at AS concept_at, t.subject, max(t.updated_at) AS triple_at
      FROM agent_knowledge k
      JOIN knowledge_triples t
        ON t.tenant_id = k.tenant_id
       AND regexp_replace(lower(t.subject), '[^a-z0-9]+', '-', 'g') =
           regexp_replace(replace(k.title, 'concept:', ''), '[^a-z0-9]+', '-', 'g')
     WHERE k.source = 'knowledge_compile'
       AND (t.valid_until IS NULL OR t.valid_until > NOW())
     GROUP BY k.title, k.updated_at, t.subject
    HAVING max(t.updated_at) > k.updated_at
     LIMIT 100
  `));
  if (staleConcepts.length) {
    findings.push({
      check: "concept-stale-vs-triple",
      count: staleConcepts.length,
      sample: staleConcepts.slice(0, SAMPLE_LIMIT).map((r) => `${r.title} lags triple subject "${r.subject}"`),
    });
  }

  return { ok: findings.length === 0, findings };
}

async function main() {
  const asJson = process.argv.includes("--json");
  try {
    const result = await run();
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.ok) console.log("[knowledge-lint] clean — no cross-store findings.");
      for (const f of result.findings) {
        console.log(`[knowledge-lint] ${f.check}: ${f.count}`);
        for (const s of f.sample) console.log(`  - ${s}`);
      }
    }
    process.exit(result.ok ? 0 : 1);
  } catch (e: any) {
    console.error(`[knowledge-lint] errored:`, e?.message ?? e);
    if (asJson) console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e), findings: [] }));
    process.exit(2);
  }
}

main();
