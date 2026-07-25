// Felix Autonomous Loop (R74.13w, 2026-04-28)
//
// Wakes every 4h during Bob's waking hours (Pacific 7am-10pm). Reads the
// current state of the world (inbox, active projects with snapshots, recent
// conversations, pending proposals, skill candidates). Asks a cheap LLM to
// reason as Felix and DRAFT proposals into felix_proposals for Bob's review.
//
// HARD RAILS (cannot be disabled at runtime — only by code change):
//  - mode is HARD-CODED 'dry_run' for first 14 days (FELIX_LOOP_LIVE_AFTER).
//  - No paid tools called during the loop. No outbound messages. No file
//    writes outside felix_loop_runs / felix_proposals tables.
//  - Monthly cost cap: 500 cents ($5) — current loop terminates if exceeded.
//  - Wake-hours check: only fires when Pacific local hour is 7..22.
//  - Kill switch: set env FELIX_LOOP_DISABLED=true to halt all runs.
//  - Min interval: 4h between successful runs (module-level mutex).
//  - Bob must explicitly approve each proposal via approve_felix_proposal
//    before any side effect happens. The loop ITSELF only writes drafts.

import { db } from "./db";
import { sql } from "drizzle-orm";
import { runLlmTask } from "./llm-task";
import { logSilentCatch } from "./lib/silent-catch";
import {
  validatePostStateSpec,
  captureState,
  verifyDelta,
  hasVerifier,
  listVerifiableKinds,
  describeVerifier,
  type PostStateSpec,
} from "./felix-verify";

const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MONTHLY_CAP_CENTS = 500; // $5/month dry-run budget
const WAKE_HOUR_START = 7;
const WAKE_HOUR_END = 22;
const FELIX_LOOP_LIVE_AFTER = new Date("2026-05-12T00:00:00Z"); // 14 days from R74.13w ship
const MODEL = "gemini-2.5-flash"; // cheap structured-output workhorse

// R74.13z-quint+6 (OpenClaw nugget #4) — High-confidence triage gates.
// OpenClaw filters its proposals through 5 gates before ever sending them
// for review. We adapt those gates to VisionClaw's domain (Felix proposes
// inbox-clearing actions, not code patches), but the spirit is the same:
// only escalate proposals that are small-surface, evidence-backed, and
// traceable.
//
// MODE: observation-only. We compute gate results, attach them to the
// in-memory loop summary, and log per-run aggregates. We do NOT auto-reject
// proposals based on gate failures yet — Bob needs a few cycles of data to
// see whether the gates are calibrated for his actual proposal stream
// before they start blocking. To enable enforcement later, set the
// environment variable FELIX_TRIAGE_ENFORCE=true.
const FELIX_TRIAGE_ENFORCE = process.env.FELIX_TRIAGE_ENFORCE === "true";

interface GateResult { passed: boolean; reason?: string }
interface TriageReport {
  smallSurface: GateResult;
  reproducible: GateResult;
  traceable: GateResult;
  notBroadRefactor: GateResult;
  dependencyVerified: GateResult;
  failedCount: number;
  rejectedBy: string[];
}

// Kinds known to be inherently broad — we mark notBroadRefactor=false so
// observation logs flag them. Bob can decide whether to actually block
// them once enforcement turns on.
const BROAD_KINDS = new Set([
  "refactor_module",
  "rename_symbol_global",
  "rewrite_subsystem",
  "migrate_database",
]);

const EVIDENCE_RX = /(\blogs?:?\b|\btest\b|\berror\b|\bstack\b|\bfile:\s*\S+|\bline\s*\d+|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|^\s*\$\s*\w+|`[^`]{4,}`)/i;
const TRACE_RX = /(\b[\w./-]+\.(ts|tsx|js|jsx|md|sql|json):\d+|\bproposal[ _-]?#?\d+|\bid[=:]?\s*\d+)/i;
const DEP_MENTION_RX = /\b(npm|package|library|dependency|peer dep|node_modules|@[\w-]+\/[\w-]+)\b/i;

function evaluateTriageGates(p: any, kind: string, target: string | null, summary: string): TriageReport {
  const rationale = String(p.rationale || "");
  const targetArgs = (p.target_args && typeof p.target_args === "object") ? p.target_args : {};
  const argEntryCount = Object.keys(targetArgs).length;
  const haystack = `${summary}\n${rationale}`;

  // 1. smallSurface: a single target ID OR target_args that don't reference
  // a sprawling set of paths. We pragmatically flag "many string args that
  // look like paths" as broad surface.
  const pathLikeArgs = Object.values(targetArgs).filter(v =>
    typeof v === "string" && /[\\/](\w+[\\/]){2,}/.test(v)
  ).length;
  let smallSurface: GateResult;
  if (target && argEntryCount <= 6 && pathLikeArgs <= 3) {
    smallSurface = { passed: true };
  } else if (!target && argEntryCount > 8) {
    smallSurface = { passed: false, reason: `no target + ${argEntryCount} arg keys` };
  } else if (pathLikeArgs > 3) {
    smallSurface = { passed: false, reason: `${pathLikeArgs} path-like arg values` };
  } else {
    smallSurface = { passed: true };
  }

  // 2. reproducible: rationale contains evidence keywords (logs, test,
  // error, stack, command, code-fenced snippets, or IP/file refs).
  const reproducible: GateResult = EVIDENCE_RX.test(haystack)
    ? { passed: true }
    : { passed: false, reason: "no evidence keywords (logs|test|error|stack|`...`)" };

  // 3. traceable: contains a file:line reference, proposal id, or row id.
  // A specific target string also counts as traceable.
  const traceable: GateResult = (target && target.length > 2) || TRACE_RX.test(haystack)
    ? { passed: true }
    : { passed: false, reason: "no file:line / proposal#N / id reference" };

  // 4. notBroadRefactor: kind isn't in BROAD_KINDS and rationale doesn't
  // contain refactor-mass keywords.
  let notBroadRefactor: GateResult;
  if (BROAD_KINDS.has(kind)) {
    notBroadRefactor = { passed: false, reason: `kind '${kind}' is in BROAD_KINDS` };
  } else if (/\b(refactor everything|rewrite (the )?(entire|whole|all)|sweep across|global rename)\b/i.test(haystack)) {
    notBroadRefactor = { passed: false, reason: "rationale mentions cross-cutting refactor" };
  } else {
    notBroadRefactor = { passed: true };
  }

  // 5. dependencyVerified: only required if the proposal mentions a
  // dependency. Otherwise it's auto-pass (gate is N/A).
  let dependencyVerified: GateResult;
  if (DEP_MENTION_RX.test(haystack)) {
    // If a dep is mentioned, we expect the rationale to also include a
    // version/check (e.g. "v1.2.3", "verified compat", "package.json:") to
    // signal the LLM actually checked it.
    if (/(\bv?\d+\.\d+(\.\d+)?\b|\bverified\b|\bcompat\b|package\.json)/i.test(haystack)) {
      dependencyVerified = { passed: true };
    } else {
      dependencyVerified = { passed: false, reason: "mentions dep but no version / verify check" };
    }
  } else {
    dependencyVerified = { passed: true };
  }

  const gates: Array<[string, GateResult]> = [
    ["smallSurface", smallSurface],
    ["reproducible", reproducible],
    ["traceable", traceable],
    ["notBroadRefactor", notBroadRefactor],
    ["dependencyVerified", dependencyVerified],
  ];
  const rejectedBy = gates.filter(([, g]) => !g.passed).map(([n]) => n);
  return {
    smallSurface,
    reproducible,
    traceable,
    notBroadRefactor,
    dependencyVerified,
    failedCount: rejectedBy.length,
    rejectedBy,
  };
}

let _isRunning = false;
let _lastRun = 0;

interface LoopResult {
  skipped?: boolean;
  reason?: string;
  runId?: number;
  proposalsDrafted?: number;
  mode?: string;
  error?: string;
  contextSummary?: string;
}

const PROPOSAL_SCHEMA = {
  type: "object",
  required: ["read_of_world", "proposals"],
  properties: {
    read_of_world: {
      type: "string",
      description: "1-3 sentence summary of where things stand right now",
    },
    proposals: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        required: ["kind", "summary", "rationale"],
        properties: {
          kind: {
            type: "string",
            enum: [
              "send_message_to_bob",
              "delegate_to_specialist",
              "promote_skill_candidate",
              "draft_proactive_action",
              "research_topic",
              "review_project",
              "nothing",
            ],
          },
          summary: { type: "string", description: "1-line description for Bob's review queue" },
          rationale: { type: "string", description: "Why this is worth doing now (1-2 sentences)" },
          target: { type: "string", description: "Tool / persona / project / customer name. Optional." },
          target_args: { type: "object", description: "Structured args. Optional." },
          estimated_cost_cents: { type: "number", description: "Rough cost if executed. 0 if free." },
          // R74.13x verification rail. Required for verifiable kinds
          // (everything except review_project + nothing). The shape
          // is enforced by validatePostStateSpec at draft time and
          // again at execution time. See server/felix-verify.ts.
          expected_post_state: {
            type: "object",
            description:
              "Machine-verifiable post-condition: 'after this proposal executes, the world will look like X'. The executor captures pre-state, runs the action (live mode only), captures post-state, and verifies actual delta vs expected_count_delta. Required for verifiable kinds.",
            properties: {
              filter: {
                type: "object",
                description:
                  "column->value map identifying the row(s) the action will produce. Columns must be in the per-kind whitelist.",
              },
              content_substring: {
                type: "object",
                description:
                  "Optional substring match on a content column (e.g. {column: 'title', substring: 'invoice'}).",
                properties: {
                  column: { type: "string" },
                  substring: { type: "string" },
                },
              },
              expected_count_delta: {
                type: "number",
                description:
                  "Expected change in row count after execution. Usually 1. Bounded [0, 100].",
              },
            },
            required: ["expected_count_delta"],
          },
        },
      },
    },
  },
};

const FELIX_LOOP_SYSTEM_PROMPT = `You are Felix, [Your Product]'s CEO operating in scheduled-loop mode (a quiet review the system runs every 4 hours).

Your job RIGHT NOW: read the current state of the world, then DRAFT 0-5 proposals for Bob to review. You are NOT taking action — only proposing. Bob approves each proposal before anything happens.

Decide carefully:
- "send_message_to_bob": something Bob should know about (a customer waiting, a deadline, a critical issue). Be sparing — Bob hates noise. Only flag what he genuinely needs to see.
- "delegate_to_specialist": work that someone (Forge, Scribe, Apollo, etc.) should pick up.
- "promote_skill_candidate": a recurring pattern worth crystallizing into a reusable skill.
- "draft_proactive_action": preventive work (e.g. "renew domain", "back up project X to Drive").
- "research_topic": a topic worth a Radar / Neptune scan.
- "review_project": a project that's stalled or has unanswered open questions.
- "nothing": if there is genuinely nothing worth proposing, say so. The empty list is a valid honest answer.

Bias toward fewer, higher-quality proposals. Bob would rather see 1 great proposal than 5 weak ones. If nothing's worth raising, return [] and explain why in read_of_world.

DO NOT propose:
- Reviewing projects that already appear in pendingProposals (the duplicate dedup will reject them anyway).
- Reviewing the same project repeatedly across runs unless something materially changed in its snapshot.
- Generic "check on X" actions without a concrete reason.
- Anything for projects that look like test data (already filtered upstream — but if any slip through, ignore them).

VERIFICATION RAIL (R74.13x — REQUIRED for every kind EXCEPT review_project and nothing):

Each proposal must include an "expected_post_state" — a small machine-verifiable spec that says "after I execute, the world will contain this row." The executor captures pre-state, fires the action, captures post-state, and confirms the delta matched. Mismatch → automatic retry → if still wrong, yields to Bob with verification_failed.

The verifier table per kind, with allowed filter columns:
- send_message_to_bob → notifications. filter: {category, type}. content_substring: {column: 'title' | 'message'}
- delegate_to_specialist → delegation_scratchpad. filter: {agent_name, chain_key}. content_substring: {column: 'value'}
- promote_skill_candidate → agent_knowledge. filter: {category, source}. content_substring: {column: 'title' | 'content'}
- draft_proactive_action → proactive_actions. filter: {persona_id, outcome}. content_substring: {column: 'trigger_condition' | 'action_taken'}
- research_topic → research_sessions. filter: {status, program_id}. content_substring: {column: 'summary'}

Examples:

For "send_message_to_bob" about a stalled customer:
{
  "filter": {"category": "customer_followup"},
  "content_substring": {"column": "title", "substring": "Acme Corp follow-up"},
  "expected_count_delta": 1
}

For "promote_skill_candidate" graduating a candidate:
{
  "filter": {"category": "skill"},
  "content_substring": {"column": "title", "substring": "PDF report generator"},
  "expected_count_delta": 1
}

For "draft_proactive_action" scheduling a renewal:
{
  "filter": {"outcome": "pending"},
  "content_substring": {"column": "trigger_condition", "substring": "domain renewal"},
  "expected_count_delta": 1
}

Use expected_count_delta: 1 for typical actions. Use 0 only for idempotent ops where the row already exists. Never use expected_count_delta > 5.

If you can't write a precise post_state for your proposed kind, drop the proposal — vague proposals are worse than no proposal.

Output JSON conforming to the schema. No commentary outside the JSON.`;

async function getMonthSpendCents(tenantId: number, txOrDb: any = db): Promise<number> {
  // R74.13z-tris (architect Area C #2): FAIL CLOSED on query error.
  // Previous version returned 0 on any error, which means a transient DB issue
  // would silently disable the entire monthly $5 cap. Bob's hardest budget rule
  // — never silently lose this.
  const r: any = await txOrDb.execute(sql`
    SELECT COALESCE(SUM(cost_cents), 0)::int AS total
    FROM felix_loop_runs
    WHERE tenant_id = ${tenantId}
      AND started_at >= date_trunc('month', NOW())
  `);
  const total = r.rows?.[0]?.total;
  if (typeof total !== "number") {
    throw new Error(`getMonthSpendCents: unexpected query result for tenant ${tenantId}`);
  }
  return total;
}

async function gatherContext(tenantId: number): Promise<{ summary: string; payload: any }> {
  // Inbox (R74.13x: was querying nonexistent agent_inbox; real table is inbox_messages)
  const inboxR: any = await db
    .execute(sql`SELECT COUNT(*)::int AS n FROM inbox_messages WHERE tenant_id = ${tenantId} AND is_read = false AND direction = 'inbound'`)
    .catch(() => ({ rows: [{ n: 0 }] }));
  const inboxUnread = inboxR.rows?.[0]?.n ?? 0;

  // Active projects with state snapshots — only those touched in the last
  // 30 days so we don't keep re-proposing reviews for stale stress-test
  // projects every 4 hours.
  const projR: any = await db.execute(sql`
    SELECT id, name, COALESCE(LEFT(current_state, 600), '') AS snapshot, updated_at
    FROM projects
    WHERE tenant_id = ${tenantId}
      AND status = 'active'
      AND updated_at >= NOW() - INTERVAL '30 days'
      AND name NOT ILIKE '%stress test%'
      AND name NOT ILIKE '%sample project%'
    ORDER BY updated_at DESC
    LIMIT 5
  `);
  const projects = (projR.rows || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    snapshot: p.snapshot || "(no snapshot yet)",
    updated_at: p.updated_at,
  }));

  // Recent conversations (last 24h, count + persona breakdown)
  const convsR: any = await db.execute(sql`
    SELECT persona_id, COUNT(*)::int AS n
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.tenant_id = ${tenantId}
      AND m.created_at >= NOW() - INTERVAL '24 hours'
      AND m.role = 'user'
    GROUP BY persona_id
    ORDER BY n DESC
    LIMIT 10
  `).catch(() => ({ rows: [] }));
  const recentByPersona = convsR.rows || [];

  // Pending proposals from prior runs
  const propR: any = await db
    .execute(sql`SELECT COUNT(*)::int AS n FROM felix_proposals WHERE tenant_id = ${tenantId} AND status = 'pending'`)
    .catch(() => ({ rows: [{ n: 0 }] }));
  const pendingProposals = propR.rows?.[0]?.n ?? 0;

  // Skill candidates awaiting review
  const skillR: any = await db
    .execute(sql`SELECT COUNT(*)::int AS n FROM agent_knowledge WHERE category = 'skill_candidate' AND tenant_id = ${tenantId}`)
    .catch(() => ({ rows: [{ n: 0 }] }));
  const skillCandidates = skillR.rows?.[0]?.n ?? 0;

  // Last 5 memory lessons
  const memR: any = await db
    .execute(sql`SELECT fact FROM memory_entries WHERE tenant_id = ${tenantId} AND source = 'auto_memorize' ORDER BY created_at DESC LIMIT 5`)
    .catch(() => ({ rows: [] }));
  const recentLessons = (memR.rows || []).map((r: any) => r.fact);

  // Last loop run summary
  const lastR: any = await db
    .execute(sql`SELECT id, started_at, intent_summary, proposals_drafted FROM felix_loop_runs WHERE tenant_id = ${tenantId} ORDER BY id DESC LIMIT 1`)
    .catch(() => ({ rows: [] }));
  const lastRun = lastR.rows?.[0] || null;

  const summary = `inbox=${inboxUnread} active_projects=${projects.length} recent_user_msgs_24h=${recentByPersona.reduce((a: number, b: any) => a + b.n, 0)} pending_proposals=${pendingProposals} skill_candidates=${skillCandidates}`;

  const payload = {
    now: new Date().toISOString(),
    inboxUnread,
    activeProjects: projects,
    recentByPersona,
    pendingProposals,
    skillCandidates,
    recentLessons,
    lastRun,
  };

  return { summary, payload };
}

function estimateCostCents(usage: any): number {
  // gemini-2.5-flash pricing (rough): input ~$0.075/1M, output ~$0.30/1M
  // Convert to cents per token: input = 0.0000075 cents/tok, output = 0.00003 cents/tok
  const inTok = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
  const outTok = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
  const cents = inTok * 0.0000075 + outTok * 0.00003;
  return Math.max(1, Math.ceil(cents)); // at least 1 cent so the cap actually engages eventually
}

export async function runFelixLoop(opts: { tenantId?: number; force?: boolean } = {}): Promise<LoopResult> {
  const tenantId = opts.tenantId ?? 1;

  // 1. Kill switch
  if (process.env.FELIX_LOOP_DISABLED === "true") {
    return { skipped: true, reason: "kill_switch" };
  }

  // 2. Wake-hours check (Bob's tenant 1 is Pacific). Force bypasses.
  if (!opts.force) {
    const hourStr = new Date().toLocaleString("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "America/Los_Angeles",
    });
    const hour = parseInt(hourStr, 10);
    if (hour < WAKE_HOUR_START || hour > WAKE_HOUR_END) {
      return { skipped: true, reason: `outside wake hours (Pacific hour ${hour})` };
    }
  }

  // 2.5. DB-backed minimum interval check (4h between runs, force bypasses).
  // Was previously only enforced via the module-level _isRunning mutex, which
  // does NOT survive process restarts or multi-instance deployments. A DB
  // query against MAX(started_at) is the durable enforcement. Failing the
  // query is fail-OPEN (we proceed to the cap-check txn rather than skip)
  // because the cap-check txn is the actual budget guarantee — interval is
  // a quality/throttle rail, not a money rail.
  if (!opts.force) {
    try {
      const lastRunResult: any = await db.execute(sql`
        SELECT MAX(started_at) AS last_run_at FROM felix_loop_runs WHERE tenant_id = ${tenantId}
      `);
      const lastRunAt = lastRunResult.rows?.[0]?.last_run_at;
      if (lastRunAt) {
        const sinceMs = Date.now() - new Date(lastRunAt).getTime();
        if (sinceMs < MIN_INTERVAL_MS) {
          const minutesRemaining = Math.ceil((MIN_INTERVAL_MS - sinceMs) / 60000);
          return { skipped: true, reason: `min_interval_not_elapsed (${minutesRemaining} min remaining)` };
        }
      }
    } catch (intervalErr: any) {
      console.warn(`[felix-loop] interval check failed (proceeding):`, intervalErr?.message);
    }
  }

  // 3. Cost cap check + run-row insert — atomic per tenant.
  // R74.13z-tris (architect Area C #1): wrap spend-check + run insert in a
  // single transaction with a per-tenant advisory lock. Without this, two
  // concurrent triggers (heartbeat + manual run_now, or two heartbeats from
  // multi-instance deployment) could both pass the pre-check and collectively
  // overshoot Bob's $5/month cap. Pattern matches server/orchestrator-ledger.ts:441
  // (existing precedent in this codebase). On query failure inside the txn we
  // fail closed (skipped:cap_check_error) — never silently default to "no spend".
  const mode = new Date() >= FELIX_LOOP_LIVE_AFTER ? "live" : "dry_run";
  const lockKey = 0x66656c69 /* 'feli' */ * 100000 + tenantId; // stable per-tenant int4
  let runId: number;
  try {
    const txnResult = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`);
      const spend = await getMonthSpendCents(tenantId, tx);
      if (spend >= MONTHLY_CAP_CENTS) {
        return { skipped: true as const, spend };
      }
      const runIns: any = await tx.execute(sql`
        INSERT INTO felix_loop_runs (tenant_id, mode, started_at)
        VALUES (${tenantId}, ${mode}, NOW())
        RETURNING id
      `);
      const id = runIns.rows?.[0]?.id as number;
      if (typeof id !== "number") {
        throw new Error("felix_loop_runs INSERT returned no id");
      }
      return { skipped: false as const, id };
    });
    if (txnResult.skipped) {
      return { skipped: true, reason: `monthly cap reached (${txnResult.spend}/${MONTHLY_CAP_CENTS} cents)` };
    }
    runId = txnResult.id;
  } catch (capErr: any) {
    console.error("[felix-loop] cap-check transaction failed (failing closed):", capErr?.message || capErr);
    return { skipped: true, reason: `cap_check_error: ${String(capErr?.message || capErr).slice(0, 200)}` };
  }

  try {
    const ctx = await gatherContext(tenantId);

    const userPrompt = `STATE OF THE WORLD (tenant ${tenantId}):\n\n${JSON.stringify(ctx.payload, null, 2)}\n\nDraft 0-5 proposals. Be honest if nothing is worth raising right now.`;

    const r = await runLlmTask({
      prompt: userPrompt,
      schema: PROPOSAL_SCHEMA,
      model: MODEL,
      temperature: 0.3,
      maxTokens: 6000,
      timeoutMs: 60000,
      tenantId,
    });

    if (!r.success || !r.json) {
      throw new Error(`LLM call failed: ${r.error || "no JSON"}`);
    }

    const proposals = Array.isArray(r.json.proposals) ? r.json.proposals.slice(0, 5) : [];
    const intentSummary: string = String(r.json.read_of_world || "").slice(0, 1000);

    let drafted = 0;
    let dedupedSkipped = 0;
    // R74.13z-quint+6 (OpenClaw nugget #4) — per-run gate aggregates.
    const triageStats = {
      evaluated: 0,
      gateFailures: { smallSurface: 0, reproducible: 0, traceable: 0, notBroadRefactor: 0, dependencyVerified: 0 } as Record<string, number>,
      enforcementBlocked: 0,
    };
    for (const p of proposals) {
      if (p.kind === "nothing") continue;
      const kind = String(p.kind).slice(0, 100);
      const target = p.target ? String(p.target).slice(0, 200) : null;
      const summary = String(p.summary || "").slice(0, 500);

      // R74.13z-quint+6 (OpenClaw nugget #4) — Evaluate triage gates BEFORE
      // dedup. We want to capture stats even on dups so we know what the
      // LLM is sending, not just what we'd ingest. Enforcement (when
      // FELIX_TRIAGE_ENFORCE=true) auto-rejects proposals that fail 3+
      // gates with reason 'low-confidence-triage'. Observation-only mode
      // logs but does not block.
      const triage = evaluateTriageGates(p, kind, target, summary);
      triageStats.evaluated++;
      for (const failed of triage.rejectedBy) {
        triageStats.gateFailures[failed] = (triageStats.gateFailures[failed] || 0) + 1;
      }
      if (FELIX_TRIAGE_ENFORCE && triage.failedCount >= 3) {
        triageStats.enforcementBlocked++;
        try {
          await db.execute(sql`
            INSERT INTO felix_proposals (loop_run_id, tenant_id, kind, summary, rationale, target, target_args, estimated_cost_cents, status, rejection_reason)
            VALUES (
              ${runId}, ${tenantId}, ${kind}, ${summary},
              ${String(p.rationale || "").slice(0, 2000)},
              ${target},
              ${JSON.stringify(p.target_args || {})}::jsonb,
              ${Math.max(0, Math.floor(Number(p.estimated_cost_cents) || 0))},
              'rejected',
              ${`low-confidence-triage: failed ${triage.rejectedBy.join(",")}`}
            )
          `);
        } catch (insertErr: any) {
          // Unique-index conflict means a previous rejection of the same
          // proposal already exists — that's fine, we wanted it rejected.
          if (!(String(insertErr.message || "").includes("uniq_felix_proposals_active") || insertErr.code === "23505")) {
            console.warn(`[felix-loop] failed to record auto-rejected proposal: ${insertErr.message}`);
          }
        }
        continue;
      }
      if (triage.failedCount > 0) {
        // Observation-mode log: which gates would block this if enforcement
        // were on. Stays at debug level so it doesn't drown the console.
        console.log(`[felix-loop] triage(observation) kind=${kind} failed=${triage.failedCount} rejectedBy=${triage.rejectedBy.join(",")}`);
      }

      // Dedup: skip if an identical proposal (same kind + target) is already
      // pending or approved, OR if Bob already rejected this exact summary
      // (so Felix doesn't keep re-proposing things Bob said no to).
      try {
        const dupR: any = await db.execute(sql`
          SELECT id, status FROM felix_proposals
          WHERE tenant_id = ${tenantId}
            AND kind = ${kind}
            AND COALESCE(target, '') = COALESCE(${target}, '')
            AND (
              status IN ('pending', 'approved')
              OR (status = 'rejected' AND summary = ${summary})
            )
          LIMIT 1
        `);
        if (dupR.rows && dupR.rows.length > 0) {
          dedupedSkipped++;
          continue;
        }
      } catch (_e) {
        logSilentCatch("server/felix-loop.ts", _e);
      }

      // R74.13x: validate expected_post_state at draft time. If a kind
      // has a verifier and the LLM produced an invalid spec, we coerce
      // expected_post_state to null and downgrade to a 'needs_manual_spec'
      // marker in execution_result. This is preferable to silently dropping
      // the proposal — Bob still sees it, but knows the verification rail
      // can't run until he provides a spec.
      let expectedPostState: any = null;
      let specWarning: string | null = null;
      if (hasVerifier(kind)) {
        const candidate = p.expected_post_state;
        if (candidate && typeof candidate === "object") {
          const enriched = { ...candidate, kind };
          const v = validatePostStateSpec(kind, enriched);
          if (v.ok) {
            expectedPostState = enriched;
          } else {
            specWarning = `Invalid expected_post_state from LLM: ${v.errors.join("; ")}`;
            console.warn(`[felix-loop] proposal kind=${kind}: ${specWarning}`);
          }
        } else {
          specWarning = `Kind '${kind}' requires expected_post_state; LLM produced none`;
          console.warn(`[felix-loop] proposal kind=${kind}: ${specWarning}`);
        }
      }

      try {
        const insertResult: any = await db.execute(sql`
          INSERT INTO felix_proposals (loop_run_id, tenant_id, kind, summary, rationale, target, target_args, estimated_cost_cents, status, expected_post_state, execution_result)
          VALUES (
            ${runId},
            ${tenantId},
            ${kind},
            ${summary},
            ${String(p.rationale || "").slice(0, 2000)},
            ${target},
            ${JSON.stringify(p.target_args || {})}::jsonb,
            ${Math.max(0, Math.floor(Number(p.estimated_cost_cents) || 0))},
            'pending',
            ${expectedPostState ? JSON.stringify(expectedPostState) : null}::jsonb,
            ${specWarning}
          )
          RETURNING id
        `);
        const newProposalId = insertResult.rows?.[0]?.id;
        // R74.13z-quint Nugget 1: stamp args_embedding so future surprise
        // scorers can kNN this row. Fire-and-forget; embedding failures
        // don't block proposal creation.
        if (newProposalId) {
          import("./surprise-scorer")
            .then(m => m.stampArgsEmbedding(newProposalId, { kind, target, target_args: p.target_args || {}, summary }))
            .catch(_e => logSilentCatch("server/felix-loop.ts:stampArgsEmbedding", _e));
        }
        drafted++;
      } catch (e: any) {
        // Unique-index violation = a concurrent run inserted the same proposal first.
        // That's success (dedup worked) — count it as deduped, not as an error.
        if (String(e.message || "").includes("uniq_felix_proposals_active") || e.code === "23505") {
          dedupedSkipped++;
        } else {
          console.error("[felix-loop] proposal insert failed:", e.message);
        }
      }
    }
    if (dedupedSkipped > 0) console.log(`[felix-loop] skipped ${dedupedSkipped} duplicate proposal(s)`);
    // R74.13z-quint+6 (OpenClaw nugget #4) — per-run triage telemetry.
    // Always log so we can observe the gate distribution over time and
    // tune thresholds before turning enforcement on. With FELIX_TRIAGE_ENFORCE=true,
    // also log how many were auto-rejected.
    if (triageStats.evaluated > 0) {
      const failParts = Object.entries(triageStats.gateFailures)
        .filter(([, n]) => n > 0)
        .map(([name, n]) => `${name}=${n}`)
        .join(",");
      console.log(`[felix-loop] triage(${FELIX_TRIAGE_ENFORCE ? "enforce" : "observation"}) evaluated=${triageStats.evaluated}${failParts ? ` failures{${failParts}}` : ""}${FELIX_TRIAGE_ENFORCE ? ` blocked=${triageStats.enforcementBlocked}` : ""}`);
    }

    const usage = (r as any).usage || {};
    const costCents = estimateCostCents(usage);

    await db.execute(sql`
      UPDATE felix_loop_runs
      SET ended_at = NOW(),
          context_summary = ${ctx.summary},
          intent_summary = ${intentSummary},
          proposals_drafted = ${drafted},
          tokens_used = ${(usage.prompt_tokens || 0) + (usage.completion_tokens || 0)},
          cost_cents = ${costCents}
      WHERE id = ${runId}
    `);

    return { runId, proposalsDrafted: drafted, mode, contextSummary: ctx.summary };
  } catch (e: any) {
    await db
      .execute(sql`UPDATE felix_loop_runs SET ended_at = NOW(), error = ${e.message?.slice(0, 1000) || "unknown"} WHERE id = ${runId}`)
      .catch((updateErr: any) => {
        // The recovery write itself failed. Don't mask the original error
        // (returned below) — but log so the recovery failure is visible.
        console.warn(`[felix-loop] failed to record error for run ${runId}: ${updateErr?.message ?? updateErr}`);
      });
    return { runId, error: e.message };
  }
}

export async function maybeRunFelixLoop(): Promise<LoopResult | null> {
  if (_isRunning) return null;
  const now = Date.now();
  if (now - _lastRun < MIN_INTERVAL_MS) return null;
  _isRunning = true;
  // Set short backoff before success so a crash loop doesn't hammer
  const SHORT_BACKOFF_MS = 10 * 60 * 1000;
  _lastRun = now - (MIN_INTERVAL_MS - SHORT_BACKOFF_MS);
  try {
    const r = await runFelixLoop({ tenantId: 1 });
    if (!r.skipped) _lastRun = Date.now();
    return r;
  } catch (e: any) {
    console.error("[felix-loop] tick crashed:", e.message);
    return { error: e.message };
  } finally {
    _isRunning = false;
  }
}

// Status helpers used by the chat-callable tools
export async function getFelixLoopStatus(tenantId: number = 1) {
  const monthSpend = await getMonthSpendCents(tenantId);
  const lastR: any = await db
    .execute(sql`SELECT id, mode, started_at, ended_at, proposals_drafted, cost_cents, error FROM felix_loop_runs WHERE tenant_id = ${tenantId} ORDER BY id DESC LIMIT 1`)
    .catch(() => ({ rows: [] }));
  const pendR: any = await db
    .execute(sql`SELECT COUNT(*)::int AS n FROM felix_proposals WHERE tenant_id = ${tenantId} AND status = 'pending'`)
    .catch(() => ({ rows: [{ n: 0 }] }));
  return {
    mode_currently: new Date() >= FELIX_LOOP_LIVE_AFTER ? "live" : "dry_run",
    live_after: FELIX_LOOP_LIVE_AFTER.toISOString(),
    kill_switch_active: process.env.FELIX_LOOP_DISABLED === "true",
    wake_hours_pacific: `${WAKE_HOUR_START}-${WAKE_HOUR_END}`,
    min_interval_hours: MIN_INTERVAL_MS / 3600000,
    monthly_cap_cents: MONTHLY_CAP_CENTS,
    month_spend_cents: monthSpend,
    pending_proposals: pendR.rows?.[0]?.n ?? 0,
    last_run: lastR.rows?.[0] || null,
  };
}

export async function listFelixLoopRuns(tenantId: number = 1, limit: number = 10) {
  const r: any = await db.execute(sql`
    SELECT id, mode, started_at, ended_at, context_summary, intent_summary, proposals_drafted, tokens_used, cost_cents, error
    FROM felix_loop_runs
    WHERE tenant_id = ${tenantId}
    ORDER BY id DESC
    LIMIT ${Math.min(limit, 50)}
  `);
  return { count: r.rows?.length || 0, runs: r.rows || [] };
}

export async function listFelixProposals(opts: { tenantId?: number; status?: string; limit?: number }) {
  const tenantId = opts.tenantId ?? 1;
  const status = opts.status || "pending";
  const limit = Math.min(opts.limit || 20, 100);
  const r: any = await db.execute(sql`
    SELECT id, loop_run_id, kind, summary, rationale, target, target_args, estimated_cost_cents, status, reviewed_by, reviewed_at, rejection_reason, executed_at, execution_result, expected_post_state, created_at
    FROM felix_proposals
    WHERE tenant_id = ${tenantId} AND status = ${status}
    ORDER BY id DESC
    LIMIT ${limit}
  `);
  return { count: r.rows?.length || 0, proposals: r.rows || [] };
}

// R74.13x: SWD-inspired execution rail. Wraps the eventual side-effect
// in a verify-around: capture pre-state, fire (live mode only), capture
// post-state, verify the delta matches the proposal's expected_post_state.
//
// Fail-loud (one-strike) on verification mismatch: the executor logs the
// mismatch and the proposal flips to 'verification_failed'. No automatic
// re-fire of the side effect — that would risk duplicate writes. Bob has
// to manually re-approve after fixing whatever drifted. (The original
// two-strike framing was traded for fail-loud after architect review:
// safer than retrying when retry could double-write.)
//
// Race-safe: uses an atomic claim (UPDATE WHERE status='approved'
// RETURNING) so two concurrent execute calls cannot both pass the
// approval check. The losing caller gets a clear "currently being
// executed" error.
//
// In dry-run mode (current, until 2026-05-12), the executor captures
// pre-state and validates the spec but does NOT fire any side effect.
// This proves the verification rail works end-to-end before live mode.
// In dry-run we report the HONEST verification result (match=false when
// expected_delta>0 since no side effect fired) with dry_run=true so Bob
// sees the truth — we never lie about the verification outcome.
export async function executeFelixProposal(id: number, tenantId: number = 1, executedBy: string = "bob") {
  // 1. ATOMIC CLAIM: flip status approved→executing in a single SQL statement.
  // Two concurrent execute calls can't both win — only one row update succeeds.
  // The losing caller gets a precise diagnostic (already executing / not approved / not yours).
  const claim: any = await db.execute(sql`
    UPDATE felix_proposals
    SET status = 'executing'
    WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'approved'
    RETURNING id, kind, summary, target, target_args, expected_post_state
  `);
  if (!claim.rows?.length) {
    const lookup: any = await db.execute(sql`SELECT status, executed_at FROM felix_proposals WHERE id=${id} AND tenant_id=${tenantId}`);
    const cur = lookup.rows?.[0];
    if (!cur) return { error: "Proposal not found or not yours" };
    if (cur.status === "executing") return { error: "Proposal is currently being executed by another worker — wait for it to finish" };
    if (cur.executed_at) return { error: `Already executed at ${cur.executed_at} (status: ${cur.status})` };
    return { error: `Proposal must be 'approved' (current: ${cur.status})` };
  }
  const p = claim.rows[0];

  const kind: string = p.kind;
  const isLiveMode = new Date() >= FELIX_LOOP_LIVE_AFTER;
  const verifierAvailable = hasVerifier(kind);

  // 2. Validate the spec (re-validate at execution time even if it passed at draft time)
  let spec: PostStateSpec | null = null;
  let specValid = false;
  let specErrors: string[] = [];
  if (verifierAvailable) {
    if (!p.expected_post_state) {
      specErrors = [`Kind '${kind}' has a verifier but proposal has no expected_post_state — cannot execute safely`];
    } else {
      const candidate = { ...p.expected_post_state, kind };
      const v = validatePostStateSpec(kind, candidate);
      if (v.ok) {
        spec = candidate as PostStateSpec;
        specValid = true;
      } else {
        specErrors = v.errors;
      }
    }
  }

  if (verifierAvailable && !specValid) {
    const result = `Spec validation failed: ${specErrors.join("; ")}`;
    await db.execute(sql`
      UPDATE felix_proposals
      SET status = 'verification_failed',
          executed_at = NOW(),
          execution_result = ${result}
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    return { error: result, status: "verification_failed" };
  }

  // 3. Capture pre-state (only if we have a spec)
  let pre = null;
  if (spec) {
    try {
      pre = await captureState(spec, tenantId);
    } catch (e: any) {
      const result = `pre-state capture failed: ${e.message}`;
      await db.execute(sql`
        UPDATE felix_proposals
        SET status = 'verification_failed',
            executed_at = NOW(),
            execution_result = ${result}
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `);
      return { error: result, status: "verification_failed" };
    }
  }

  // 4. Fire the action — DRY-RUN STUB until live mode
  let actionResult: { ok: boolean; detail: string };
  if (!isLiveMode) {
    actionResult = {
      ok: true,
      detail: `dry-run: pre-state captured (${pre ? `${pre.table} count=${pre.count}` : "n/a — kind has no verifier"}); no side effect fired; rail proven`,
    };
  } else {
    // Live-mode dispatch will land here on May 12. Today this branch
    // is unreachable (FELIX_LOOP_LIVE_AFTER guard). The dispatcher
    // will route by kind to the appropriate action handler.
    actionResult = {
      ok: false,
      detail: `live-mode dispatch not yet implemented for kind '${kind}' — will be added with the live-mode flip`,
    };
  }

  // 5. Capture post-state + verify (if we have a spec).
  // R74.13x architect-fix: report HONEST verification. In dry-run no side
  // effect fired, so actual_delta will be 0 — match will be false whenever
  // expected_delta>0. We don't lie. The dry_run flag in the result tells
  // Bob this is expected; the rail-shape signal is in spec_valid +
  // pre_state_captured + action.ok.
  let verification = null;
  if (spec && pre) {
    try {
      const post = await captureState(spec, tenantId);
      verification = verifyDelta(pre, post, spec.expected_count_delta);
      if (!isLiveMode) {
        verification = {
          ...verification,
          dry_run: true,
          detail: `${verification.detail} [DRY-RUN: side effect not fired; in live mode this would be the real verification result]`,
        };
      }
    } catch (e: any) {
      verification = {
        match: false,
        detail: `post-state capture failed: ${e.message}`,
        expected_delta: spec.expected_count_delta,
        actual_delta: 0,
        pre_count: pre.count,
        post_count: 0,
      };
    }
  }

  // 6. Final status. In dry-run, "executed" means the RAIL is sound
  // (spec valid + pre-state captured + action handler returned ok).
  // We do NOT require verification.match in dry-run because we know
  // the side effect didn't fire. In live mode, verification.match
  // becomes a hard gate.
  const railSound = actionResult.ok && (verifierAvailable ? specValid && !!pre : true);
  const liveVerified = !verification || verification.match;
  const overallOk = isLiveMode ? railSound && liveVerified : railSound;
  const finalStatus = overallOk ? "executed" : "verification_failed";
  const resultBlob = JSON.stringify({
    mode: isLiveMode ? "live" : "dry_run",
    executed_by: executedBy,
    action: actionResult,
    verifier_available: verifierAvailable,
    spec_used: spec || null,
    pre_state: pre,
    verification,
  }).slice(0, 4000);

  await db.execute(sql`
    UPDATE felix_proposals
    SET status = ${finalStatus},
        executed_at = NOW(),
        execution_result = ${resultBlob}
    WHERE id = ${id} AND tenant_id = ${tenantId}
  `);

  // R74.13z-quint Nugget 1: score this step's surprise vs. historical
  // neighbors of the same kind. Fire-and-forget — surprise scoring failures
  // must never block the proposal lifecycle. Red bands write a notification.
  let surprise: { score: number | null; band: string; neighbors: number } | null = null;
  try {
    const { scoreProposalSurprise } = await import("./surprise-scorer");
    const r = await scoreProposalSurprise(id, tenantId);
    surprise = { score: r.score, band: r.band, neighbors: r.neighborsUsed };
  } catch (e) {
    logSilentCatch("server/felix-loop.ts:scoreSurprise", e);
  }

  return {
    id,
    status: finalStatus,
    mode: isLiveMode ? "live" : "dry_run",
    verifier_available: verifierAvailable,
    spec_valid: specValid || !verifierAvailable,
    pre_state_captured: !!pre,
    verification,
    action: actionResult,
    surprise,
  };
}

// Lightweight read-only sanity check: validates a pending proposal's
// expected_post_state spec without executing anything. Useful for Bob
// to see "is this proposal safe to approve?" before approving.
export async function verifyFelixProposalSpec(id: number, tenantId: number = 1) {
  const r: any = await db.execute(sql`
    SELECT id, kind, summary, expected_post_state, status
    FROM felix_proposals
    WHERE id = ${id} AND tenant_id = ${tenantId}
  `);
  const p = r.rows?.[0];
  if (!p) return { error: "Proposal not found or not yours" };

  const kind: string = p.kind;
  const verifierAvailable = hasVerifier(kind);
  if (!verifierAvailable) {
    return {
      id,
      kind,
      verifier_available: false,
      note: `Kind '${kind}' has no verifier registered. Verifiable kinds: ${listVerifiableKinds().join(", ")}.`,
    };
  }
  if (!p.expected_post_state) {
    return {
      id,
      kind,
      verifier_available: true,
      verifier: describeVerifier(kind),
      spec_valid: false,
      errors: [`No expected_post_state on this proposal. Re-draft or attach a spec before approving.`],
    };
  }
  const candidate = { ...p.expected_post_state, kind };
  const v = validatePostStateSpec(kind, candidate);
  return {
    id,
    kind,
    verifier_available: true,
    verifier: describeVerifier(kind),
    spec_valid: v.ok,
    errors: v.errors,
    spec: p.expected_post_state,
  };
}

export async function approveFelixProposal(id: number, tenantId: number = 1, reviewedBy: string = "bob") {
  const r: any = await db.execute(sql`
    UPDATE felix_proposals
    SET status = 'approved', reviewed_by = ${reviewedBy}, reviewed_at = NOW()
    WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'pending'
    RETURNING id, kind, summary
  `);
  if (!r.rows?.length) return { error: "Proposal not found, not yours, or not pending" };
  return { approved: true, proposal: r.rows[0], note: "Approved — execution is a separate explicit step (not auto-fired)." };
}

export async function rejectFelixProposal(id: number, reason: string, tenantId: number = 1, reviewedBy: string = "bob") {
  const r: any = await db.execute(sql`
    UPDATE felix_proposals
    SET status = 'rejected', reviewed_by = ${reviewedBy}, reviewed_at = NOW(), rejection_reason = ${String(reason || "").slice(0, 1000)}
    WHERE id = ${id} AND tenant_id = ${tenantId} AND status = 'pending'
    RETURNING id, kind, summary
  `);
  if (!r.rows?.length) return { error: "Proposal not found, not yours, or not pending" };
  return { rejected: true, proposal: r.rows[0] };
}
