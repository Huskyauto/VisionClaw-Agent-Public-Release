// Tool Forge Pass (Phase 2) — turns unmet tenant demand (capability_gaps) into
// a HITL module PROPOSAL. Contract: data/feature-contracts/tool-forge-eviction/spec.md.
//
// Flow: select the highest-demand un-proposed gap (missCount >= threshold) →
// claim autonomous budget (fail CLOSED → clean SKIPPED exit 0) → goal contract →
// one LLM draft of a domain-shaped module (definitions + handler skeleton) →
// write proposal files under data/tool-forge/proposals/gap-<id>/ (NEVER live
// code) → queue an approval. Bob merges via a session; nothing auto-lands.
//
// Run: npx tsx scripts/tool-forge-pass.ts
// Env: TOOL_FORGE_MISS_THRESHOLD (3), TOOL_FORGE_MAX_PER_RUN (1), DRY_RUN=1.
// Exit: 0 = clean/skipped, 1 = hard error (stderr names the failing stage).

import fs from "node:fs";
import path from "node:path";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { selectForgeGaps, type ForgeGap } from "../server/lib/tool-forge";
import { claimAutonomousBudget } from "../server/agentic/autonomous-budget";
import { buildGoalContract } from "../server/agentic/goal-contract";
import { runLlmTask } from "../server/llm-task";
import { createApproval } from "../server/agentic/approvals";

const ADMIN_TENANT_ID = 1;
const REQUESTED_BY = "tool-forge";
const PROPOSALS_DIR = "data/tool-forge/proposals";
const EST_USD_PER_PROPOSAL = 0.5;

const REGISTRATION_CHECKLIST = `## New-tool-registration checklist (MUST ride the merge — no minted tool bypasses the safety layer)
- [ ] TOOL_POLICIES classification in server/safety/destructive-tool-policy.ts (destructive tools NEVER default to safe)
- [ ] server/tool-registry.ts registerTool() entry (categories, speed class)
- [ ] Persona allowlists: which personas may call it (per-persona allowed_tools)
- [ ] Domain module under server/tools/domains/<domain>/ + dispatcher import line
- [ ] Smoke-test manifest: run scripts/tool-smoke-test.ts --generate after registration
- [ ] AHB regression: add fixtures if the tool is consumer-facing or destructive
- [ ] replit.md aggregate tool-count bump + persona-sync (push-persona-sync)`;

function envInt(name: string, dflt: number): number {
  const v = parseInt(process.env[name] || "", 10);
  return Number.isFinite(v) && v >= 0 ? v : dflt;
}

async function main() {
  const missThreshold = envInt("TOOL_FORGE_MISS_THRESHOLD", 3);
  const maxPerRun = envInt("TOOL_FORGE_MAX_PER_RUN", 1);
  const dryRun = process.env.DRY_RUN === "1";

  // 1. Load eligible gaps.
  const gapsRes: any = await db.execute(sql`
    SELECT id, tenant_id, gap_description, status, miss_count, priority
    FROM capability_gaps
    WHERE status IN ('detected','researching','researched') AND miss_count >= ${missThreshold}
    ORDER BY miss_count DESC
    LIMIT 50
  `);
  const gaps: ForgeGap[] = (((gapsRes as any).rows || gapsRes) as any[]).map((r) => ({
    id: Number(r.id),
    tenantId: Number(r.tenant_id),
    gapDescription: String(r.gap_description || ""),
    status: String(r.status),
    missCount: Number(r.miss_count) || 0,
    priority: String(r.priority || "medium"),
  }));

  // 2. Dedupe: proposal dir on disk OR any prior approval for the gap.
  const already = new Set<number>();
  if (fs.existsSync(PROPOSALS_DIR)) {
    for (const d of fs.readdirSync(PROPOSALS_DIR)) {
      const m = /^gap-(\d+)$/.exec(d);
      if (m) already.add(parseInt(m[1], 10));
    }
  }
  const priorRes: any = await db.execute(sql`
    SELECT (context->>'gapId')::int AS gap_id FROM agent_approvals
    WHERE requested_by = ${REQUESTED_BY} AND tenant_id = ${ADMIN_TENANT_ID} AND context ? 'gapId'
  `);
  for (const r of ((priorRes as any).rows || priorRes) as any[]) {
    if (r.gap_id != null) already.add(Number(r.gap_id));
  }

  const selected = selectForgeGaps({ gaps, missThreshold, alreadyProposedGapIds: already, maxPerRun });
  if (selected.length === 0) {
    console.log(`[tool-forge] no eligible un-proposed gaps (threshold=${missThreshold}, eligible=${gaps.length}, alreadyProposed=${already.size}) — nothing to do`);
    process.exit(0);
    return;
  }
  if (dryRun) {
    console.log(`[tool-forge] DRY_RUN — would propose: ${selected.map((g) => `gap-${g.id} (missCount=${g.missCount}): ${g.gapDescription.slice(0, 100)}`).join(" | ")}`);
    process.exit(0);
    return;
  }

  // 3. Budget claim — fail CLOSED to a clean skip.
  const budget = await claimAutonomousBudget({
    tenantId: ADMIN_TENANT_ID,
    estimatedUsd: EST_USD_PER_PROPOSAL * selected.length,
    label: REQUESTED_BY,
  });
  if (!budget.ok) {
    console.log(`[tool-forge] SKIPPED — budget claim denied (${budget.reason}); will retry next scheduled run`);
    process.exit(0);
    return;
  }

  for (const gap of selected) {
    // 4. Goal contract (fail-open to default contract internally).
    const contract = await buildGoalContract(
      `Design a new platform tool that closes this repeatedly-missed capability gap (missed ${gap.missCount}x): ${gap.gapDescription}`,
      { tenantId: ADMIN_TENANT_ID },
    );

    // 5. One LLM draft in the domain-module shape.
    const draft = await runLlmTask({
      tenantId: ADMIN_TENANT_ID,
      model: "gemini-2.5-flash",
      timeoutMs: 90_000,
      temperature: 0.2,
      maxTokens: 4000,
      schema: {
        type: "object",
        required: ["toolName", "domain", "summary", "definitionsTs", "handlersTs", "risks"],
        properties: {
          toolName: { type: "string", description: "snake_case tool name" },
          domain: { type: "string", description: "kebab-case domain folder name" },
          summary: { type: "string" },
          definitionsTs: { type: "string", description: "TypeScript source for definitions.ts" },
          handlersTs: { type: "string", description: "TypeScript source for handlers.ts skeleton" },
          risks: { type: "string", description: "destructive-potential assessment + suggested TOOL_POLICIES class" },
        },
      },
      prompt:
        `Draft a NEW tool module for a multi-tenant agentic platform, in the platform's domain-module shape.\n\n` +
        `CAPABILITY GAP (tenant demand, missed ${gap.missCount} times): ${gap.gapDescription}\n` +
        (gap.priority ? `Priority: ${gap.priority}\n` : "") +
        `\nGOAL CONTRACT (definition of done for the eventual tool):\n${JSON.stringify({ endState: contract.endState, verificationMethod: contract.verificationMethod, invariants: contract.invariants }, null, 2)}\n\n` +
        `SHAPE REQUIREMENTS:\n` +
        `- definitions.ts exports \`const <name>Definition: ToolDefinition\` with { name, description, parameters (JSON-schema properties + required) }.\n` +
        `- handlers.ts exports an async handler \`(params, ctx)\` that reads tenantId ONLY from ctx (never params), validates inputs, and returns { success, ... }. Every DB query MUST filter by tenant_id.\n` +
        `- The handler body may contain TODO stubs for external integrations, but the tenant-isolation and input-validation scaffolding must be complete and real.\n` +
        `- In "risks", state whether the tool mutates prod state / moves money / sends comms / deletes data, and the TOOL_POLICIES class it needs (safe | requiresApproval | trustedPersonasOnly + maxValue caps).\n`,
    });
    if (!draft.success || !draft.json) {
      console.error(`[tool-forge] draft FAILED for gap-${gap.id}: ${draft.error || "no JSON"} — leaving gap un-proposed for retry`);
      continue;
    }
    const j: any = draft.json;

    // 6. Write proposal files (data/ only — never live code).
    const dir = path.join(PROPOSALS_DIR, `gap-${gap.id}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "definitions.ts.txt"), String(j.definitionsTs || ""));
    fs.writeFileSync(path.join(dir, "handlers.ts.txt"), String(j.handlersTs || ""));
    fs.writeFileSync(
      path.join(dir, "PROPOSAL.md"),
      `# Tool proposal: ${j.toolName || "unnamed"} (gap ${gap.id})\n\n` +
        `**Demand:** missed ${gap.missCount}x (tenant ${gap.tenantId}, priority ${gap.priority})\n\n` +
        `**Gap:** ${gap.gapDescription}\n\n` +
        `**Summary:** ${j.summary || ""}\n\n` +
        `**Proposed domain:** server/tools/domains/${j.domain || "TBD"}/\n\n` +
        `**Risk assessment (draft — re-verify):** ${j.risks || ""}\n\n` +
        `**Goal contract:**\n\`\`\`json\n${JSON.stringify(contract, null, 2)}\n\`\`\`\n\n` +
        `${REGISTRATION_CHECKLIST}\n\n` +
        `_Generated ${new Date().toISOString()} by scripts/tool-forge-pass.ts. Draft files: definitions.ts.txt, handlers.ts.txt (NOT live code — a session integrates them after approval)._\n`,
    );

    // 7. Queue the approval.
    await createApproval({
      tenantId: ADMIN_TENANT_ID,
      requestedBy: REQUESTED_BY,
      question: `Build proposed tool "${j.toolName || "unnamed"}" for capability gap #${gap.id} (missed ${gap.missCount}x: "${gap.gapDescription.slice(0, 160)}")? Draft module + risk assessment + registration checklist at ${dir}/PROPOSAL.md. Approving green-lights integration in a future session — nothing lands automatically.`,
      context: { gapId: gap.id, toolName: j.toolName, proposalDir: dir, missCount: gap.missCount, gapTenantId: gap.tenantId, source: REQUESTED_BY },
      ttlHours: 24 * 7,
    });
    console.log(`[tool-forge] proposed "${j.toolName}" for gap-${gap.id} → ${dir}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`[tool-forge] FAILED: ${e?.message || e}`);
  process.exit(1);
});
