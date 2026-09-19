// R113 — Passive skill pattern detector (ARIS nugget #3, meta-optimize equivalent).
//
// Scans the agent_trace_spans table for tool-call sequences that repeat
// frequently across distinct traces, and queues them as `proposed_skills`
// rows with status='pending' for human review at /admin/proposed-skills.
//
// Why passive: the existing propose_skill flow is purely agent-self-aware —
// an agent has to NOTICE a reusable pattern and call the tool. In practice
// most reusable sequences slip past because the agent is mid-task. This
// detector watches the trace ledger that already records every tool call
// and surfaces patterns the agents themselves never proposed.
//
// Design constraints:
//   - Zero new tables: reuses agent_trace_spans (R101) + proposed_skills (R98.21).
//   - Tenant-scoped: never crosses tenants in queries or proposals.
//   - Idempotent: re-running within the dedup window does NOT create duplicates;
//     existing pending proposals for the same sequence-hash are skipped.
//   - Fail-soft: any DB error logs + returns counters; never throws.
//   - Read-mostly: at most ONE INSERT per detected pattern per run.

import { sql } from "drizzle-orm";
import { db } from "../db";
import { proposedSkills } from "@shared/schema";
import { createHash } from "node:crypto";

export interface PatternDetectorOptions {
  tenantId: number;
  windowDays?: number;      // how far back to scan (default 7)
  sequenceLength?: number;  // N-step sequence (default 3, range 2-5)
  minRepetitions?: number;  // min distinct traces using the sequence (default 3)
  maxProposals?: number;    // safety cap per run (default 10)
  dryRun?: boolean;         // log only, don't insert
}

export interface DetectedPattern {
  sequenceHash: string;
  toolNames: string[];
  repetitions: number;
  distinctTraces: number;
  topPersona: string | null;
  examples: string[];       // up to 3 trace_ids for audit
}

export interface DetectorResult {
  scannedSpans: number;
  scannedTraces: number;
  patternsFound: number;
  proposalsCreated: number;
  proposalsSkipped: number;
  patterns: DetectedPattern[];
}

const SOURCE_PREFIX = "passive-pattern-detection";

function hashSequence(tools: string[]): string {
  return createHash("sha256").update(tools.join("→")).digest("hex").slice(0, 16);
}

function clampInt(n: number | undefined, lo: number, hi: number, def: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : def;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Run one detection pass for a tenant. Returns counters + the pattern list.
 * Safe to call from a cron, an admin endpoint, or a CLI script.
 */
export async function detectAndQueueSkillProposals(
  opts: PatternDetectorOptions,
): Promise<DetectorResult> {
  const tenantId = opts.tenantId;
  if (typeof tenantId !== "number" || tenantId <= 0) {
    throw new Error("detectAndQueueSkillProposals requires a positive tenantId");
  }
  const windowDays = clampInt(opts.windowDays, 1, 90, 7);
  const sequenceLength = clampInt(opts.sequenceLength, 2, 5, 3);
  const minRepetitions = clampInt(opts.minRepetitions, 2, 50, 3);
  const maxProposals = clampInt(opts.maxProposals, 1, 100, 10);
  const dryRun = !!opts.dryRun;

  const result: DetectorResult = {
    scannedSpans: 0,
    scannedTraces: 0,
    patternsFound: 0,
    proposalsCreated: 0,
    proposalsSkipped: 0,
    patterns: [],
  };

  // Pull all tool spans in the window, grouped by trace.
  let rows: any[];
  try {
    const r: any = await db.execute(sql`
      SELECT trace_id, span_id, tool_name, agent_name, started_at
        FROM agent_trace_spans
       WHERE tenant_id = ${tenantId}
         AND kind = 'tool'
         AND tool_name IS NOT NULL
         AND started_at > NOW() - (${windowDays}::int * INTERVAL '1 day')
       ORDER BY trace_id, started_at ASC, id ASC
    `);
    rows = (r.rows || r) as any[];
  } catch (e: any) {
    console.warn(`[skill-pattern-detector] scan failed: ${e?.message?.slice(0, 200)}`);
    return result;
  }
  result.scannedSpans = rows.length;
  if (rows.length < sequenceLength) return result;

  // Group spans by trace_id (already sorted in SQL).
  const byTrace = new Map<string, { tools: string[]; agents: string[] }>();
  for (const row of rows) {
    const t = row.trace_id as string;
    const tool = row.tool_name as string;
    const agent = (row.agent_name as string | null) ?? "";
    let entry = byTrace.get(t);
    if (!entry) { entry = { tools: [], agents: [] }; byTrace.set(t, entry); }
    entry.tools.push(tool);
    if (agent) entry.agents.push(agent);
  }
  result.scannedTraces = byTrace.size;

  // Slide a window of `sequenceLength` across each trace; count repetitions.
  // A single trace contributes AT MOST ONCE per unique sequence to avoid
  // a single long trace dominating the count via internal loops.
  const seqCount = new Map<string, {
    tools: string[];
    distinctTraces: Set<string>;
    totalOccurrences: number;
    examples: string[];
    agents: Map<string, number>;
  }>();
  for (const [traceId, entry] of byTrace) {
    if (entry.tools.length < sequenceLength) continue;
    const seenInThisTrace = new Set<string>();
    for (let i = 0; i + sequenceLength <= entry.tools.length; i++) {
      const slice = entry.tools.slice(i, i + sequenceLength);
      // Skip degenerate sequences (same tool repeated) — those are loops, not skills.
      if (new Set(slice).size === 1) continue;
      const h = hashSequence(slice);
      let bucket = seqCount.get(h);
      if (!bucket) {
        bucket = {
          tools: slice,
          distinctTraces: new Set<string>(),
          totalOccurrences: 0,
          examples: [],
          agents: new Map<string, number>(),
        };
        seqCount.set(h, bucket);
      }
      bucket.totalOccurrences++;
      if (!seenInThisTrace.has(h)) {
        seenInThisTrace.add(h);
        bucket.distinctTraces.add(traceId);
        if (bucket.examples.length < 3) bucket.examples.push(traceId);
        for (const a of entry.agents) {
          bucket.agents.set(a, (bucket.agents.get(a) ?? 0) + 1);
        }
      }
    }
  }

  // Filter to patterns that meet the threshold, sort by distinct-trace count desc.
  const ranked: { hash: string; pattern: DetectedPattern }[] = [];
  for (const [h, bucket] of seqCount) {
    const distinct = bucket.distinctTraces.size;
    if (distinct < minRepetitions) continue;
    let topPersona: string | null = null;
    let topCount = 0;
    for (const [a, c] of bucket.agents) {
      if (c > topCount) { topPersona = a; topCount = c; }
    }
    ranked.push({
      hash: h,
      pattern: {
        sequenceHash: h,
        toolNames: bucket.tools,
        repetitions: bucket.totalOccurrences,
        distinctTraces: distinct,
        topPersona,
        examples: bucket.examples,
      },
    });
  }
  ranked.sort((a, b) => b.pattern.distinctTraces - a.pattern.distinctTraces);
  result.patternsFound = ranked.length;
  result.patterns = ranked.slice(0, maxProposals).map((r) => r.pattern);

  if (dryRun) return result;

  // For each pattern, check for an existing pending proposal with the same
  // sequence hash; if none, INSERT a new one.
  for (const { pattern } of ranked.slice(0, maxProposals)) {
    const tag = `${SOURCE_PREFIX}:${pattern.sequenceHash}`;
    try {
      // Dedup: any prior proposal for this sequence hash (pending/accepted/rejected)
      // suppresses a new one. The source_context column is plain text — we match
      // on the hex prefix which can't collide with another tenant's data because
      // the row itself is tenant-scoped.
      const dup = await db.execute(sql`
        SELECT id FROM proposed_skills
         WHERE tenant_id = ${tenantId}
           AND source_context LIKE ${tag + "%"}
           AND status IN ('pending','accepted','rejected')
         LIMIT 1
      `);
      const dupRows = ((dup as any).rows || dup) as any[];
      if (dupRows.length > 0) {
        result.proposalsSkipped++;
        continue;
      }

      const name = `Auto: ${pattern.toolNames.join(" → ")}`.slice(0, 80);
      const description = `Repeated tool sequence detected ${pattern.distinctTraces}× across distinct traces (${pattern.repetitions} total occurrences) in the last ${windowDays}d. Top persona: ${pattern.topPersona ?? "unknown"}.`.slice(0, 300);
      const body = [
        `# Passively detected skill candidate`,
        ``,
        `**Sequence:** ${pattern.toolNames.join(" → ")}`,
        `**Distinct traces:** ${pattern.distinctTraces}`,
        `**Total occurrences:** ${pattern.repetitions}`,
        `**Top persona:** ${pattern.topPersona ?? "unknown"}`,
        `**Sample trace IDs:** ${pattern.examples.join(", ")}`,
        ``,
        `This skill was proposed by the R113 passive pattern detector — no agent`,
        `explicitly emitted it. Before accepting, the reviewer should:`,
        ``,
        `1. Open one of the sample traces via \`query_trace\` and verify the`,
        `   sequence actually represents a coherent workflow (not just three`,
        `   unrelated tools that happen to fire near each other).`,
        `2. Decide whether this should be a new skill, a doctrine bullet in an`,
        `   existing persona's tools_doc, or a new composite tool.`,
        `3. If accepted, replace this stub body with the real skill prompt.`,
        ``,
        `## Sequence`,
        ...pattern.toolNames.map((t, i) => `${i + 1}. \`${t}\``),
      ].join("\n");
      const truncatedBody = body.length > 20000
        ? body.slice(0, 19980) + "\n\n… (truncated)"
        : body;
      const confidence = Math.min(95, 40 + pattern.distinctTraces * 10);

      await db.insert(proposedSkills).values({
        tenantId,
        name,
        description,
        body: truncatedBody,
        category: "passive-detection",
        sourceContext: `${tag} | distinct_traces=${pattern.distinctTraces} | occurrences=${pattern.repetitions} | window_days=${windowDays}`,
        proposingPersona: pattern.topPersona ?? "system",
        confidence,
      });
      result.proposalsCreated++;
    } catch (e: any) {
      console.warn(`[skill-pattern-detector] insert failed for ${pattern.sequenceHash}: ${e?.message?.slice(0, 200)}`);
    }
  }

  return result;
}
