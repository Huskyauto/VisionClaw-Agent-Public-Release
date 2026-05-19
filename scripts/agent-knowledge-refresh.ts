/**
 * Agent Knowledge Refresh — runs on a recurring workflow so every active persona
 * stays current with the platform's tool inventory + recent capability releases.
 *
 * What it does (idempotent, safe to re-run any time):
 *   1) Runs syncPersonaDocs() — regenerates tools_doc + agents_doc for all 16
 *      active personas from the live TOOL_REGISTRY, custom_tools, skills, and
 *      PLATFORM_TOOLS_CONTRACT (which now includes the R98.21 hyperagent block).
 *   2) Upserts a small set of cross-persona briefing entries into agent_knowledge
 *      (personaId NULL = visible to every persona via search_knowledge), keyed by
 *      a stable title so re-runs UPDATE rather than duplicate.
 *
 * Run manually:  npx tsx scripts/agent-knowledge-refresh.ts
 * Run as workflow: see .replit "[[workflows.workflow]] name = 'Agent Knowledge Refresh'"
 *
 * Exit codes: 0 success, 1 sync failure, 2 knowledge-upsert failure,
 *             3+ wiring-audit failure (propagated from verify-agent-wiring.ts:
 *             1=dead tools, 2=drift, 3=both, 5=audit errored).
 */
import { syncPersonaDocs, getSyncStatus } from "../server/persona-sync";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const ADMIN_TENANT_ID = 1;

interface Brief {
  title: string;
  category: string;
  priority: number;
  content: string;
}

const BRIEFS: Brief[] = [
  {
    title: "platform_briefing:R98.21:plan_deliverable_estimate_block",
    category: "platform_briefing",
    priority: 1,
    content: `R98.21 — plan_deliverable now returns an upfront cost+duration estimate.

WHAT: every plan response includes an "estimate" block:
  { durationMinLow, durationMinMedian, durationMinHigh,
    costUsdLow,    costUsdMedian,    costUsdHigh,
    estimateLine: "~3-7 minutes, ~$0.04-$0.18" }

WHEN TO SHOW IT: present the estimateLine to the user BEFORE you start working.
This is honest scoping — the user gets to confirm before paid tools spend.

SOURCE OF TRUTH: server/deliverable-contracts.ts DELIVERABLE_PIPELINES. The
estimate is computed live from the same pipeline definitions Felix executes,
so the quoted band cannot drift from the actual deliverable.

CALL SITE: tool name "plan_deliverable" (registered in TOOL_REGISTRY).`,
  },
  {
    title: "platform_briefing:R98.21:propose_skill",
    category: "platform_briefing",
    priority: 1,
    content: `R98.21 — propose_skill: self-improvement emission for reusable patterns.

WHAT: agents emit a candidate skill when they recognize a reusable playbook.
Lands in proposed_skills (status=pending). Bob reviews at /admin/proposed-skills,
accepts → promoted into the global \`skills\` catalog (back-link via
promotedSkillId) and surfaces in every persona's tools_doc on the next sync.

WHEN: after a non-trivial task that worked unusually well, OR when you notice
the same pattern handled the same way 3+ times, OR when a chain you ran could
be templatized for future personas.

NOT WHEN: throwaway one-offs, or anything tenant-specific. The skills catalog
is global by platform design (no tenant_id column).

ARGS (exact, must match handler):
  propose_skill({
    name: string,            // required, ≤80 chars
    description: string,     // required, ≤300 chars (one-line summary)
    body: string,            // required, ≤20000 chars (the actual playbook)
    category?: string,       // optional, ≤60 chars (default "general")
    source_context?: string, // optional, ≤500 chars
    confidence?: number      // optional, 0..100 INTEGER (default 70) — NOT 0..1
  })

REVIEW UI: /admin/proposed-skills — accept/reject is one click each.

PERSONAS WITH IT IN PRIMARY FOCUS: VisionClaw (1), Felix (2), Forge (3),
Agent Blueprint (5). All other active personas can call it via the global
ALL AVAILABLE TOOLS surface.`,
  },
  {
    title: "platform_briefing:R98.21:run_ab_eval",
    category: "platform_briefing",
    priority: 1,
    content: `R98.21 — run_ab_eval: cross-run A/B with configurable rubric.

WHAT: fans out (configs × runs_per_config) parallel runs on the same prompt,
scores each output 0..100 with a Gemini judge against the rubric, returns
ranked results (avg score per config + per-sample breakdown), and persists
to ab_runs (tenant-scoped).

WHEN: choosing between 2-4 model/system-prompt configurations on content
where "feel" matters and a single sample misleads — brand-voice copy,
headline variants, narration style, image-prompt phrasing, refusal copy.

NOT WHEN: deterministic correctness questions (use verify_math_chain or a
direct call). NOT WHEN: only one config — that's just a normal call.
NOT WHEN: rubric is "is this correct" — judges are calibrated for quality,
not ground truth.

ARGS (exact, must match handler):
  run_ab_eval({
    name: string,                                     // required, ≤120 chars
    prompt: string,                                   // required, ≤8000 chars
    rubric: string,                                   // required, ≤4000 chars (free-text rubric — NOT an id)
    configs: [{ label, model, systemPrompt? }, ...],  // required, 2-4 items; each needs model
    runs_per_config?: number,                         // optional, 1..5, default 1
    judge_model?: string                              // optional, default "gemini-2.5-flash"
  })

DB: ab_runs table (tenant-scoped). UPDATE statements include
\`AND tenant_id = $tid\` — fixed per architect review.

RESULTS UI: /admin/ab-runs/{ab_run_id}

PERSONAS WITH IT IN PRIMARY FOCUS: Felix (2), Forge (3), Agent Blueprint (5),
Minerva (15).`,
  },
  {
    title: "platform_briefing:R98.21:landing_recipe_gallery",
    category: "platform_briefing",
    priority: 2,
    content: `R98.21 — Landing-page recipe gallery.

WHAT: five canonical "one-click" deliverable prompts now live on the public
landing page, each labeled with live cost+duration bands pulled from
DELIVERABLE_PIPELINES (the same source plan_deliverable uses).

PUBLIC ENDPOINT: GET /api/public/recipes (no auth) — returns the gallery
JSON if you need to surface recipe metadata in chat.

OPERATING RULE: if a user references "the recipe gallery" or one of the
labeled recipes (e.g. "the 5-minute branded short", "the research brief
recipe"), DO NOT improvise the pipeline. Pull the exact recipe definition
by id from DELIVERABLE_PIPELINES and run it as designed — that is the only
way the upfront estimate the user saw on the landing page matches what they
actually receive.`,
  },
  {
    title: "platform_briefing:knowledge_refresh:how_to_keep_current",
    category: "platform_briefing",
    priority: 3,
    content: `META — how persona knowledge stays current.

The platform runs scripts/agent-knowledge-refresh.ts on a recurring workflow
("Agent Knowledge Refresh"). Each run:

  1) Calls syncPersonaDocs() — regenerates tools_doc + agents_doc for all 16
     active personas from the LIVE TOOL_REGISTRY + custom_tools + enabled
     skills + PLATFORM_TOOLS_CONTRACT. This is the canonical channel for
     teaching every persona about a newly-registered tool.

  2) Upserts platform_briefing entries into agent_knowledge (this row is one
     of them) keyed by stable title — re-runs UPDATE rather than duplicate.
     personaId is NULL on these entries so search_knowledge surfaces them
     for every persona regardless of who is calling.

HOW TO ADD A NEW BRIEFING: edit the BRIEFS array in the script and re-run.
This is the canonical workflow whenever a tool/feature ships that every
persona needs to know about.`,
  },
];

async function upsertBriefs(): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (const b of BRIEFS) {
    const existing = await db.execute(sql`
      SELECT id FROM agent_knowledge
       WHERE tenant_id = ${ADMIN_TENANT_ID}
         AND persona_id IS NULL
         AND title = ${b.title}
       LIMIT 1
    `);
    const rows = (existing as any).rows || existing;
    if (rows.length > 0) {
      const id = rows[0].id;
      await db.execute(sql`
        UPDATE agent_knowledge
           SET content = ${b.content},
               category = ${b.category},
               priority = ${b.priority},
               source = 'platform_briefing',
               updated_at = NOW()
         WHERE id = ${id} AND tenant_id = ${ADMIN_TENANT_ID}
      `);
      updated++;
    } else {
      await db.execute(sql`
        INSERT INTO agent_knowledge (title, content, category, priority, persona_id, tenant_id, source, created_at, updated_at)
        VALUES (${b.title}, ${b.content}, ${b.category}, ${b.priority}, NULL, ${ADMIN_TENANT_ID}, 'platform_briefing', NOW(), NOW())
      `);
      inserted++;
    }
  }
  return { inserted, updated };
}

async function main() {
  console.log("[agent-knowledge-refresh] Starting...");
  const t0 = Date.now();

  let syncResult;
  try {
    syncResult = await syncPersonaDocs();
  } catch (e: any) {
    console.error("[agent-knowledge-refresh] syncPersonaDocs FAILED:", e.message);
    process.exit(1);
  }
  console.log(`[agent-knowledge-refresh] persona-sync: ${syncResult.synced} personas, ${syncResult.toolCount} tools, ${syncResult.customToolCount} custom, ${syncResult.skillCount} skills`);

  let upsertResult;
  try {
    upsertResult = await upsertBriefs();
  } catch (e: any) {
    console.error("[agent-knowledge-refresh] upsertBriefs FAILED:", e.message);
    process.exit(2);
  }
  console.log(`[agent-knowledge-refresh] briefings: inserted=${upsertResult.inserted}, updated=${upsertResult.updated} (of ${BRIEFS.length} total)`);

  const status = await getSyncStatus();
  const minToolsDoc = Math.min(...status.personas.map(p => p.toolsDocLength));
  const maxToolsDoc = Math.max(...status.personas.map(p => p.toolsDocLength));
  console.log(`[agent-knowledge-refresh] tools_doc length range across ${status.personas.length} personas: ${minToolsDoc}..${maxToolsDoc} chars`);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[agent-knowledge-refresh] sync OK in ${elapsed}s`);

  // ────────────────────────────────────────────────────────────────────
  // After sync, run the wiring audit. This proves every registered tool
  // is known by at least one persona AND that trustedPersonasOnly tools
  // never leaked into consumer-facing personas. The audit is intentionally
  // chained here so a refresh that lands but leaves dead tools surfaces
  // loudly in the workflow logs (and exits non-zero on findings).
  // ────────────────────────────────────────────────────────────────────
  console.log(`[agent-knowledge-refresh] running wiring audit…`);
  const { spawnSync } = await import("child_process");
  const audit = spawnSync("npx", ["tsx", "scripts/verify-agent-wiring.ts"], { stdio: "inherit" });
  if (audit.status !== 0) {
    console.error(`[agent-knowledge-refresh] wiring audit FAILED with exit code ${audit.status} — see above for findings.`);
    process.exit(audit.status ?? 3);
  }
  console.log(`[agent-knowledge-refresh] all checks GREEN.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[agent-knowledge-refresh] threw:", err);
  process.exit(1);
});
