// =============================================================================
// WIRING INVARIANTS — boot-time + periodic checks that catch the *class* of
// silent-failure bug R40 hit (schedule→program misbinding ate 2 wks of compute).
// =============================================================================
// Runs at boot (post-seed) and on a slow heartbeat. Every failure is logged with
// a clear remediation hint; severe drift fires a high-salience attention event so
// Felix wakes the owner.
//
// The principle: any binding that's resolved by ID at runtime but authored by
// name in code/seed is a candidate. ID-based bindings are fragile because new
// rows shift positions; name-based bindings drift only on rename.

import { db } from "./db";
import { sql } from "drizzle-orm";
import { ADMIN_TENANT_ID } from "./tenant-utils";
import * as fs from "fs/promises";
import * as path from "path";
import {
  CODE_PROPOSAL_TARGETS,
  PROGRAM_PERSONA_MAP,
  NIGHTLY_PROGRAM_NAMES,
} from "./research-engine";

import { logSilentCatch } from "./lib/silent-catch";
export interface WiringFinding {
  severity: "critical" | "warning" | "info";
  area: "schedule_binding" | "program_persona_map" | "code_proposal_targets" | "outcome_canary" | "dormant_tools" | "subsystem_freshness" | "memory_growth" | "tool_drift";
  message: string;
  remediation: string;
}

export interface WiringReport {
  ok: boolean;
  findings: WiringFinding[];
  durationMs: number;
}

// -----------------------------------------------------------------------------
// CHECK 1: Schedule→Program canonical-binding parity.
// The 5 daily "Research: *" schedules have a hand-curated mapping to the 5
// nightly programs. R40 root cause: seed used position-based IDs; new business
// programs inserted earlier in the file shifted IDs and the schedules ended up
// pointing at the wrong programs (ids 2-6 instead of 8-12). This check mirrors
// the canonical map maintained in seed.ts (kept in sync manually — both are
// short and rarely change).
// -----------------------------------------------------------------------------
const CANONICAL_SCHEDULE_TO_PROGRAM: Record<string, string> = {
  "Research: AI Models & Providers":  "Nightly AI Model & Provider Intelligence",
  "Research: AI Tools & Techniques":  "Nightly AI Tools & Techniques Scanner",
  "Research: Competitive Analysis":   "Nightly Competitive Platform Analysis",
  "Research: Agent Architecture":     "Nightly Agent Architecture Research",
  "Research: Security & Safety":      "Nightly Security & Safety Intelligence",
};

async function checkScheduleBindings(): Promise<WiringFinding[]> {
  const findings: WiringFinding[] = [];
  const result = await db.execute(sql`
    SELECT s.id AS schedule_id, s.name AS schedule_name, s.program_id,
           p.name AS program_name
    FROM research_schedules s
    LEFT JOIN research_programs p ON p.id = s.program_id
    WHERE s.name LIKE 'Research:%'
  `);
  const rows = (result as any).rows || result;

  for (const row of rows) {
    if (!row.program_name) {
      findings.push({
        severity: "critical",
        area: "schedule_binding",
        message: `Schedule #${row.schedule_id} ("${row.schedule_name}") references program_id=${row.program_id} that doesn't exist.`,
        remediation: `Re-seed the program or repoint the schedule via psql.`,
      });
      continue;
    }
    const expectedProgram = CANONICAL_SCHEDULE_TO_PROGRAM[row.schedule_name as string];
    if (!expectedProgram) {
      // Unknown "Research: *" schedule — informational only; could be user-added.
      findings.push({
        severity: "info",
        area: "schedule_binding",
        message: `Schedule #${row.schedule_id} ("${row.schedule_name}") is not in the canonical map — currently bound to "${row.program_name}".`,
        remediation: `If this is a new permanent schedule, add it to CANONICAL_SCHEDULE_TO_PROGRAM in server/wiring-invariants.ts and SCHEDULE_TO_PROGRAM_NAME in server/seed.ts.`,
      });
      continue;
    }
    if (expectedProgram !== row.program_name) {
      findings.push({
        severity: "critical",
        area: "schedule_binding",
        message: `Schedule #${row.schedule_id} ("${row.schedule_name}") points at "${row.program_name}" but should point at "${expectedProgram}". This is the R40 misbinding pattern.`,
        remediation: `Run the self-heal in seed.ts (auto on next boot) or: UPDATE research_schedules SET program_id=(SELECT id FROM research_programs WHERE name=${"'" + expectedProgram.replace(/'/g, "''") + "'"}) WHERE id=${row.schedule_id};`,
      });
    }
  }
  return findings;
}

// -----------------------------------------------------------------------------
// CHECK 2: PROGRAM_PERSONA_MAP integrity.
// Every key in the in-code map must exist as a research_programs row by name,
// and every persona slug must resolve to a real persona. Drift here means new
// programs can't generate proposals (R40 root pattern).
// -----------------------------------------------------------------------------
async function checkPersonaMap(): Promise<WiringFinding[]> {
  const findings: WiringFinding[] = [];

  const programResult = await db.execute(sql`SELECT name FROM research_programs`);
  const programNames = new Set(((programResult as any).rows || programResult).map((r: any) => r.name));

  const personaResult = await db.execute(sql`SELECT name FROM personas`);
  const personaSlugs = new Set(((personaResult as any).rows || personaResult).map((r: any) => (r.name as string).toLowerCase()));

  for (const [programName, mapping] of Object.entries(PROGRAM_PERSONA_MAP)) {
    if (!programNames.has(programName)) {
      findings.push({
        severity: "warning",
        area: "program_persona_map",
        message: `PROGRAM_PERSONA_MAP key "${programName}" has no matching research_programs row.`,
        remediation: `Either seed the program or remove the dead key from server/research-engine.ts.`,
      });
    }
    if (!personaSlugs.has(mapping.personaSlug.toLowerCase())) {
      findings.push({
        severity: "warning",
        area: "program_persona_map",
        message: `PROGRAM_PERSONA_MAP for "${programName}" routes to persona "${mapping.personaSlug}" but no persona with that name exists.`,
        remediation: `Create the persona or update the slug in PROGRAM_PERSONA_MAP.`,
      });
    }
  }
  return findings;
}

// -----------------------------------------------------------------------------
// CHECK 3: CODE_PROPOSAL_TARGETS file existence.
// Every target file must exist on disk, otherwise generateCodeProposal will
// silently produce no useful context for the model.
// -----------------------------------------------------------------------------
async function checkProposalTargets(): Promise<WiringFinding[]> {
  const findings: WiringFinding[] = [];
  const programResult = await db.execute(sql`SELECT name FROM research_programs`);
  const programNames = new Set(((programResult as any).rows || programResult).map((r: any) => r.name));

  for (const [programName, files] of Object.entries(CODE_PROPOSAL_TARGETS)) {
    if (!programNames.has(programName)) {
      findings.push({
        severity: "warning",
        area: "code_proposal_targets",
        message: `CODE_PROPOSAL_TARGETS key "${programName}" has no matching research_programs row.`,
        remediation: `Either seed the program or remove the dead key from server/research-engine.ts.`,
      });
    }
    for (const f of files) {
      try {
        await fs.access(path.join(process.cwd(), f));
      } catch {
        findings.push({
          severity: "warning",
          area: "code_proposal_targets",
          message: `CODE_PROPOSAL_TARGETS for "${programName}" references missing file "${f}".`,
          remediation: `Update the path in server/research-engine.ts (file may have been moved/renamed).`,
        });
      }
    }
  }
  return findings;
}

// -----------------------------------------------------------------------------
// CHECK 4: OUTCOME CANARY — the specific R40 silent-failure detector.
// If a nightly research program has an enabled schedule that's fired in the
// last 7 days but produced 0 code_proposals AND 0 keep experiments, something
// upstream is broken (the bug we just fixed). Surface as a critical finding.
// -----------------------------------------------------------------------------
async function checkOutcomeCanary(): Promise<WiringFinding[]> {
  const findings: WiringFinding[] = [];
  const nightlyNames = Array.from(NIGHTLY_PROGRAM_NAMES);
  const namesList = sql.join(nightlyNames.map((n) => sql`${n}`), sql`, `);
  const result = await db.execute(sql`
    SELECT
      p.id, p.name,
      (SELECT count(*) FROM research_experiments e
        WHERE e.program_id = p.id AND e.created_at > NOW() - INTERVAL '7 days') AS recent_experiments,
      (SELECT count(*) FROM code_proposals cp
        JOIN research_sessions rs ON rs.id = cp.source_session_id
        WHERE rs.program_id = p.id AND cp.created_at > NOW() - INTERVAL '7 days') AS recent_proposals,
      (SELECT max(s.last_run_at) FROM research_schedules s
        WHERE s.program_id = p.id AND s.is_enabled = true) AS last_schedule_run
    FROM research_programs p
    WHERE p.name IN (${namesList})
      AND p.is_active = true
  `);
  const rows = (result as any).rows || result;

  for (const row of rows) {
    const lastRun = row.last_schedule_run ? new Date(row.last_schedule_run) : null;
    const ageHours = lastRun ? (Date.now() - lastRun.getTime()) / 3600000 : Infinity;

    // Only alert if the schedule is actively firing (ran in last 36h, matching
    // the nightly cadence) but the program is producing nothing. A wider 7d
    // window would false-positive after rebindings (schedule.last_run_at
    // reflects pre-rebind runs against the WRONG program_id, while experiment
    // count is against the new correct program_id). A never-fired schedule is
    // a separate problem surfaced by the schedule-binding check.
    if (ageHours <= 36 && Number(row.recent_experiments) === 0) {
      findings.push({
        severity: "critical",
        area: "outcome_canary",
        message: `Program "${row.name}" has a schedule that ran within 36h but produced 0 experiments. The schedule may be firing into a broken pipeline.`,
        remediation: `Check the schedule's last execution log; verify session creation in research-engine.ts; check provider/auth issues.`,
      });
    } else if (ageHours <= 36 && Number(row.recent_experiments) > 0 && Number(row.recent_proposals) === 0) {
      // Soft canary: experiments running but no proposals — could be normal (no
      // high-score findings) but worth knowing. Mark as warning, not critical.
      findings.push({
        severity: "info",
        area: "outcome_canary",
        message: `Program "${row.name}" produced ${row.recent_experiments} experiments in 7d but 0 code proposals. May be normal (no findings ≥ score threshold) or may indicate a generateCodeProposal regression.`,
        remediation: `Spot-check experiment metric_value distribution; consider triggering /api/admin/replay-research-proposals if backlog is high.`,
      });
    }
  }
  return findings;
}

// -----------------------------------------------------------------------------
// CHECK 5: Dormant tool detector (R44 — Bob's standing concern Apr 19, 2026).
// Cross-references the in-process tool registry against the tool_performance
// table (written by the tool-performance-tracker hook). Catches the exact
// failure mode Bob worries about: tool was scaffolded + registered but never
// actually wired into a callable path, so it sits dormant indefinitely.
// Emits "info" findings (dormancy is suggestive, not damning — many tools are
// legitimately rare). If tool_performance is completely empty despite a
// populated registry, that's itself a wiring failure (the tracker hook isn't
// landing writes) and gets a "warning".
// -----------------------------------------------------------------------------
async function checkDormantTools(): Promise<WiringFinding[]> {
  const findings: WiringFinding[] = [];
  const { getAllRegisteredTools } = await import("./tool-registry");
  const registered = getAllRegisteredTools();
  if (registered.length === 0) return [];

  const totalsResult = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM tool_performance
    WHERE last_success_at > NOW() - INTERVAL '14 days'
  `);
  const trackedCount = ((totalsResult as any).rows || totalsResult)[0]?.n || 0;

  if (trackedCount === 0) {
    // R63.11 — Differentiate "never written" (real wiring bug) vs "written but stale".
    // R63.12 — Also differentiate "wiring bug" vs "no chat traffic". executeGuardedTool
    // only fires from the chat/routes/self-heal/glasses paths — background autoresearch
    // hits LLMs directly via providers.ts (which writes agent_cost_ledger, NOT
    // tool_performance). With near-zero chat messages there is NOTHING to track and
    // emptiness is expected. We previously cried wolf in this state.
    const everResult = await db.execute(sql`SELECT count(*)::int AS n FROM tool_performance`);
    const everCount = ((everResult as any).rows || everResult)[0]?.n || 0;
    const chatResult = await db.execute(sql`SELECT count(*)::int AS n FROM messages WHERE created_at > NOW() - INTERVAL '14 days'`);
    const chatMsgs14d = ((chatResult as any).rows || chatResult)[0]?.n || 0;

    // R63.17 — threshold bumped from 5→25 chat messages and severity wording
    // softened. Architect rightly flagged that chat-message count is only a
    // proxy: many chats are conversational and never invoke tools. We no longer
    // claim certainty ("is failing") at the lower threshold, only at the
    // higher one where the absence of any tool tracking becomes implausible.
    if (everCount === 0 && chatMsgs14d < 25) {
      findings.push({
        severity: "info",
        area: "dormant_tools",
        message: `tool_performance has 0 rows; only ${chatMsgs14d} chat message(s) in 14d (below the 25-msg confidence threshold). With low/conversational chat traffic, tool tracking may legitimately be empty. Background autoresearch writes to agent_cost_ledger via providers.ts instead.`,
        remediation: `Normal during low chat-traffic periods. Re-check after a session that includes a tool call.`,
      });
    } else if (everCount === 0) {
      findings.push({
        severity: "critical",
        area: "dormant_tools",
        message: `tool_performance has 0 rows total despite ${chatMsgs14d} chat messages in 14d and ${registered.length} registered tools. trackToolExecution() in executeGuardedTool may be failing silently — at this chat volume some tool invocation is implausibly absent. Verify before assuming healthy.`,
        remediation: `Verify trackToolExecution() inside executeGuardedTool (server/guarded-tool-executor.ts) is firing. Every chat tool path flows through there. If still empty after a chat-driven tool call, check db.execute INSERT errors in [skill-evo] warnings. To eliminate doubt, invoke executeGuardedTool('check_system_status', {}, {tenantId:1, invokedVia:'system'}) and confirm a row appears.`,
      });
    } else {
      findings.push({
        severity: "info",
        area: "dormant_tools",
        message: `tool_performance has ${everCount} historical rows but 0 successful invocations in 14d. System may be idle or tools may be rarely used.`,
        remediation: `Normal during low-traffic periods. Confirm by triggering a tool call and rechecking.`,
      });
    }
    return findings;
  }

  const usedResult = await db.execute(sql`
    SELECT DISTINCT tool_name
    FROM tool_performance
    WHERE last_success_at > NOW() - INTERVAL '14 days'
  `);
  const usedTools = new Set<string>(
    ((usedResult as any).rows || usedResult).map((r: any) => r.tool_name as string)
  );

  const dormant = registered.filter((t) => !usedTools.has(t));
  if (dormant.length > 0) {
    // R98.25 — Suppress the routine "248 of 296 dormant" INFO line when the
    // owner has explicitly disabled auto-deprecation. The INFO is meant to
    // surface "wired but never called" for action; if the operator policy is
    // "keep all tools visible regardless of usage", emitting it on every boot
    // is just noise. Critical (everCount==0) and warning paths above still
    // emit. When the scheduler is re-armed, the line returns automatically.
    const autoDeprecateEnabled = String(process.env.ENABLE_DORMANT_AUTO_DEPRECATION || "").toLowerCase() === "true";
    if (autoDeprecateEnabled) {
      const sample = dormant.slice(0, 8).join(", ");
      const more = dormant.length > 8 ? ` (+${dormant.length - 8} more)` : "";
      findings.push({
        severity: "info",
        area: "dormant_tools",
        message: `${dormant.length} of ${registered.length} registered tools have 0 successful invocations in 14d: ${sample}${more}`,
        remediation: `Review whether these tools are forgotten/scaffolded-but-not-wired (the R44 failure mode), or legitimately rare. If obsolete, remove the registerTool() call. If scaffolded-but-not-wired, find the missing call site.`,
      });
    }
  }
  return findings;
}

// -----------------------------------------------------------------------------
// CHECK 6: Subsystem-table freshness (R47 — extends R44 from tools to subsystems).
// Cross-cuts the "scaffolded but forgotten" failure mode at the table level: a
// subsystem table exists in the schema and the subsystem's code is registered,
// but nothing has ever written to it. Caught 4 dormant subsystems on first run
// (knowledge_nudges, graph_memory, governance_actions, tool_performance) — three
// of which were silently scaffolded for weeks.
//
// Rules:
//   - 0 rows ever        → "warning" (subsystem is wired in code but inert)
//   - last write >30d    → "info" (long-stale; subsystem may have decayed)
//   - last write 7-30d   → no finding (legitimately slow subsystems exist)
//   - fresh              → no finding
//
// Add new entries here when you ship a subsystem; if you ship code that writes
// to a table and that table never gets written to, this check surfaces it.
// -----------------------------------------------------------------------------
interface SubsystemTableSpec {
  table: string;
  timestampColumn: string; // column name to use for "last write"
  hint: string;            // remediation hint specific to this subsystem
}
const SUBSYSTEM_TABLES: SubsystemTableSpec[] = [
  { table: "knowledge_nudges",   timestampColumn: "created_at",       hint: "knowledge-nudge-detector hook listens for `message:received` (never emitted). R47.A added a direct call in chat-engine.ts; if still empty after chat traffic, check processNudge() score threshold." },
  { table: "tool_performance",   timestampColumn: "last_success_at",  hint: "Written by trackToolExecution() inside executeGuardedTool (server/guarded-tool-executor.ts ~line 72) after every tool completion across ALL invocation paths (chat, routes, self-heal, glasses-gateway, voice). If empty after tool traffic, check that call site." },
  // R63.11 — Removed graph_memory and governance_actions from the strict freshness
  // check. Both are legitimately user-triggered (graph_memory: agent tool action,
  // governance_actions: rule conditions). 0 rows = "feature unused", not "wiring bug".
  // The memory_growth check still surfaces graph_memory dormancy as informational.
];

async function checkSubsystemFreshness(): Promise<WiringFinding[]> {
  const findings: WiringFinding[] = [];
  for (const spec of SUBSYSTEM_TABLES) {
    try {
      // Defensive: skip if table doesn't exist (caller may have removed it).
      const existsResult = await db.execute(sql.raw(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${spec.table}' LIMIT 1`
      ));
      if (((existsResult as any).rows || existsResult).length === 0) continue;

      const result = await db.execute(sql.raw(
        `SELECT COUNT(*)::int AS rows, MAX(${spec.timestampColumn}) AS last_write FROM ${spec.table}`
      ));
      const row = ((result as any).rows || result)[0];
      const rows = Number(row?.rows || 0);
      const lastWrite = row?.last_write ? new Date(row.last_write) : null;

      if (rows === 0) {
        findings.push({
          severity: "warning",
          area: "subsystem_freshness",
          message: `Subsystem table "${spec.table}" has 0 rows — wired in code but never written. Likely the R44/R45.C/R47.A pattern: hook listening for an event nobody emits.`,
          remediation: spec.hint,
        });
      } else if (lastWrite) {
        const ageDays = (Date.now() - lastWrite.getTime()) / 86400000;
        if (ageDays > 30) {
          findings.push({
            severity: "info",
            area: "subsystem_freshness",
            message: `Subsystem table "${spec.table}" last written ${Math.floor(ageDays)}d ago (${rows} rows total). May have decayed.`,
            remediation: spec.hint,
          });
        }
      }
    } catch (e: any) {
      // Surface schema mismatches (wrong column name etc.) as info findings so
      // the check doesn't silently misreport.
      findings.push({
        severity: "info",
        area: "subsystem_freshness",
        message: `Subsystem-freshness probe failed for "${spec.table}": ${e.message}`,
        remediation: `Update SUBSYSTEM_TABLES entry in server/wiring-invariants.ts — likely the timestamp column was renamed.`,
      });
    }
  }
  return findings;
}

// -----------------------------------------------------------------------------
// CHECK 8: Tool drift detector (Evidently-inspired).
// `tool_performance` only stores cumulative success/fail counts, not bucketed
// time-series, so true rolling-window comparison isn't free here. Approximation:
// flag tools that (a) failed within the last 7d, (b) have a meaningful sample
// (≥20 invocations cumulative), and (c) carry a fail rate ≥25%. That catches
// the "used to work, breaking now" failure mode without a snapshot table.
// Tools that have ALWAYS been flaky show up too — that's fine, they need
// attention either way.
// -----------------------------------------------------------------------------
async function checkToolDrift(): Promise<WiringFinding[]> {
  const findings: WiringFinding[] = [];
  const result = await db.execute(sql`
    SELECT tool_name,
           SUM(success_count)::int AS s,
           SUM(fail_count)::int AS f,
           MAX(last_failure_at) AS lf,
           MAX(last_failure_reason) AS reason
    FROM tool_performance
    WHERE last_failure_at > NOW() - INTERVAL '7 days'
    GROUP BY tool_name
    HAVING SUM(success_count) + SUM(fail_count) >= 20
       AND SUM(fail_count)::float / NULLIF(SUM(success_count) + SUM(fail_count), 0) >= 0.25
    ORDER BY SUM(fail_count) DESC
    LIMIT 25
  `);
  const rows = (result as any).rows || result;

  for (const row of rows) {
    const total = Number(row.s) + Number(row.f);
    const failPct = ((Number(row.f) / total) * 100).toFixed(0);
    const reason = (row.reason || "").toString().slice(0, 120);
    findings.push({
      severity: "warning",
      area: "tool_drift",
      message: `Tool "${row.tool_name}" fail rate ${failPct}% (${row.f}/${total}) with at least one failure in last 7d. Last reason: ${reason || "<none recorded>"}`,
      remediation: `Inspect recent invocations in tool_performance and the handler in server/tools.ts. If the failure mode is a transient external dependency, consider retry/backoff in executeGuardedTool. If it's a code bug, treat as a regression.`,
    });
  }
  return findings;
}

// -----------------------------------------------------------------------------
// PUBLIC ENTRYPOINT
// -----------------------------------------------------------------------------
export async function checkWiringInvariants(opts?: {
  emitAttentionEvent?: boolean;
}): Promise<WiringReport> {
  const t0 = Date.now();
  const findings: WiringFinding[] = [];

  // Run all 6 checks; never let one bad check block the others.
  for (const [name, fn] of [
    ["schedule_bindings", checkScheduleBindings],
    ["persona_map", checkPersonaMap],
    ["proposal_targets", checkProposalTargets],
    ["outcome_canary", checkOutcomeCanary],
    ["dormant_tools", checkDormantTools],
    ["subsystem_freshness", checkSubsystemFreshness],
    ["memory_growth", checkMemoryGrowth],
    ["tool_drift", checkToolDrift],
  ] as const) {
    try {
      findings.push(...(await fn()));
    } catch (e: any) {
      findings.push({
        severity: "warning",
        area: "schedule_binding",
        message: `Wiring check "${name}" failed to run: ${e.message}`,
        remediation: `Check server logs for stack trace; the checker itself may have a bug.`,
      });
    }
  }

  const critical = findings.filter((f) => f.severity === "critical");
  const ok = critical.length === 0;

  if (findings.length > 0) {
    console.log(`[wiring-invariants] ${critical.length} critical, ${findings.filter(f => f.severity === "warning").length} warning, ${findings.filter(f => f.severity === "info").length} info findings:`);
    for (const f of findings) {
      console.log(`[wiring-invariants]   [${f.severity.toUpperCase()}] ${f.area}: ${f.message}`);
    }
  } else {
    console.log(`[wiring-invariants] ✓ all bindings consistent`);
  }

  // Emit attention-bus event on critical drift so Felix wakes the owner.
  if (opts?.emitAttentionEvent && critical.length > 0) {
    try {
      const { emitEvent } = await import("./event-bus");
      await emitEvent({
        type: "wiring.drift.detected",
        source: "wiring-invariants",
        tenantId: ADMIN_TENANT_ID,
        data: {
          criticalCount: critical.length,
          findings: critical.map((f) => ({ area: f.area, message: f.message, remediation: f.remediation })),
        },
      });
    } catch (e: any) {
      console.warn(`[wiring-invariants] could not emit attention event: ${e.message}`);
    }
  }

  return { ok, findings, durationMs: Date.now() - t0 };
}

// -----------------------------------------------------------------------------
// CHECK 7 (R53.E): Memory growth tripwire.
// Bob's mandate: "we don't lose context over hours, days, months." The
// counterpart concern is silent unbounded growth: agent_knowledge,
// memory_entries, knowledge_triples, graph_memory have no TTL/archive policy.
// Embedding searches degrade as tables get fat. This check warns when any
// memory store crosses thresholds tuned for current load (~1k = warn, ~10k =
// critical) and gives a clear remediation path. Pure observability — no
// auto-archive yet (that's R54-class work and needs CEO sign-off on retention).
// -----------------------------------------------------------------------------
const MEMORY_TABLES: Array<{ name: string; warnAt: number; critAt: number; hint: string }> = [
  { name: "agent_knowledge",   warnAt: 5000,  critAt: 50000, hint: "Vector-searchable KB. Consider cold-archive for last_accessed > 90 days." },
  { name: "memory_entries",    warnAt: 2000,  critAt: 20000, hint: "Fact store with hot/warm/cold tiers — already self-tiers, but DB not archived." },
  { name: "knowledge_triples", warnAt: 5000,  critAt: 50000, hint: "SPO triples with valid_from/valid_until — purge expired triples (where valid_until < now())." },
  { name: "graph_memory",      warnAt: 2000,  critAt: 10000, hint: "Versioned hierarchical store — older versions can be archived per path." },
  { name: "messages",          warnAt: 50000, critAt: 500000, hint: "Chat history. Pre-compaction archive lives in compaction_archives; raw messages compactable." },
  { name: "compaction_archives", warnAt: 5000, critAt: 50000, hint: "Compaction outputs — deduplicate by latest-per-conversation if growth is excessive." },
];

async function checkMemoryGrowth(): Promise<WiringFinding[]> {
  const findings: WiringFinding[] = [];
  for (const tbl of MEMORY_TABLES) {
    try {
      const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt, pg_total_relation_size('${tbl.name}') AS bytes FROM ${tbl.name}`));
      const row = ((r as any).rows || r)[0];
      const cnt = Number(row?.cnt || 0);
      const bytes = Number(row?.bytes || 0);
      const sizeMb = (bytes / (1024 * 1024)).toFixed(1);
      if (cnt >= tbl.critAt) {
        findings.push({
          severity: "critical",
          area: "memory_growth",
          message: `${tbl.name} has ${cnt.toLocaleString()} rows (${sizeMb} MB) — past CRITICAL threshold ${tbl.critAt.toLocaleString()}.`,
          remediation: tbl.hint,
        });
      } else if (cnt >= tbl.warnAt) {
        findings.push({
          severity: "warning",
          area: "memory_growth",
          message: `${tbl.name} has ${cnt.toLocaleString()} rows (${sizeMb} MB) — past warn threshold ${tbl.warnAt.toLocaleString()}.`,
          remediation: tbl.hint,
        });
      }
    } catch (e) { logSilentCatch("server/wiring-invariants.ts", e); }
  }
  // Also detect the inverse problem: a memory store that's been wired to be
  // ALWAYS-AVAILABLE as a tool but has 0 rows (R51's graph_memory bootstrap
  // problem). Flags the gap so we know to seed it.
  try {
    const r = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM graph_memory`);
    const cnt = Number(((r as any).rows || r)[0]?.cnt || 0);
    if (cnt === 0) {
      findings.push({
        severity: "warning",
        area: "memory_growth",
        message: `graph_memory is exposed as an always-on tool but the table is empty across all tenants.`,
        remediation: `Seed foundational paths via psql so agents have a structure to extend.`,
      });
    }
  } catch (_silentErr) { logSilentCatch("server/wiring-invariants.ts", _silentErr); }
  return findings;
}
