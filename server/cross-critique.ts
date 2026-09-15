// Cross-AI critique panel ("Donahoe Trident") — fires three different model
// lineages (OpenAI / Anthropic / Google) in parallel against the same target,
// then ranks the merged counter-arguments by "rebuttal survival score" so the
// hardest-to-dismiss findings surface first.
//
// Stored in `agent_knowledge` with category='cross_critique'. Zero schema changes.

import { db } from "./db";
import { sql } from "drizzle-orm";
import { runLlmTask } from "./llm-task";
import { applyCaps } from "./redactor";
import { composeRebuttalSurvival, type RebuttalSignals } from "./lib/deterministic-picker";

import { logSilentCatch } from "./lib/silent-catch";
import { redactPiiForStorage, redactObjectForStorage } from "./storage-helpers/pii-redaction-guard";
const PANEL: Array<{ id: string; lens: string; model: string }> = [
  { id: "claude", lens: "ux",        model: "claude-sonnet-4-5" },
  { id: "openai", lens: "technical", model: "gpt-5.6-sol" },
  { id: "gemini", lens: "strategic", model: "gemini-3-pro-preview" },
];

const LENS_PROMPTS: Record<string, string> = {
  technical: "You are a senior engineer reviewing for correctness, security, performance, and operational risk. Identify the strongest counter-arguments — concrete bugs, design flaws, or attack vectors — that would survive a smart rebuttal.",
  strategic: "You are a strategic advisor reviewing for product-market fit, competitive positioning, business risk, and second-order consequences. Identify the strongest counter-arguments that would survive a smart rebuttal.",
  ux:        "You are a UX/adoption critic reviewing from the end-user's perspective: clarity, friction, trust, accessibility, and onboarding. Identify the strongest counter-arguments that would survive a smart rebuttal.",
};

// Deterministic-picker discipline: the model commits to categorical booleans
// about HOW the finding survives a rebuttal (RebuttalSignals) and code composes
// the deciding 1-10 number via composeRebuttalSurvival — both live in the pure,
// unit-testable ./lib/deterministic-picker module (no LLM-emitted raw scores).
interface Finding {
  finding: string;             // the counter-argument
  severity: "low" | "medium" | "high" | "critical";
  rebuttalSurvival: number;    // 1-10, DERIVED in code from RebuttalSignals (not model-emitted)
  signals: RebuttalSignals;    // the categorical commits the score is composed from (audit trail)
  evidence?: string;
  lens: string;
  source: string;              // which panelist
}

interface CritiqueResult {
  success: boolean;
  critiqueId?: number;
  panelistsRan: number;
  panelistsFailed: string[];
  findings: Finding[];
  topThree: Finding[];
  consensus: string[];         // findings flagged by 2+ panelists (high signal)
  durationMs: number;
  error?: string;
}

const SCHEMA = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["finding", "severity", "attacksCoreAssumption", "hasConcreteEvidence", "easilyMitigated", "dependsOnRareCondition"],
        properties: {
          finding: { type: "string" },
          severity: { type: "string" },
          attacksCoreAssumption: { type: "boolean" },
          hasConcreteEvidence: { type: "boolean" },
          easilyMitigated: { type: "boolean" },
          dependsOnRareCondition: { type: "boolean" },
          evidence: { type: "string" },
        },
      },
    },
  },
};

async function runOnePanelist(
  panelist: { id: string; lens: string; model: string },
  target: string,
  context?: string,
  tenantId?: number,
): Promise<{ id: string; ok: boolean; findings: Finding[]; error?: string }> {
  const prompt = `${LENS_PROMPTS[panelist.lens]}

For each counter-argument, do NOT score it 1-10. Instead answer four yes/no questions about how it holds up under a smart rebuttal:
- "attacksCoreAssumption": does it target a load-bearing premise (vs a peripheral detail)?
- "hasConcreteEvidence": is it backed by a specific mechanism, example, or citation (vs a vague worry)?
- "easilyMitigated": would a cheap, obvious fix neutralize it?
- "dependsOnRareCondition": does it only bite under an unlikely edge case?
Return 3-7 findings, strongest first.

Target under review:
${target}
${context ? `\nAdditional context:\n${context}` : ""}

Return ONLY JSON: {"findings":[{"finding":"...","severity":"low|medium|high|critical","attacksCoreAssumption":true|false,"hasConcreteEvidence":true|false,"easilyMitigated":true|false,"dependsOnRareCondition":true|false,"evidence":"..."}]}`;

  const r = await runLlmTask({
    prompt,
    schema: SCHEMA,
    model: panelist.model,
    temperature: 0.4,
    maxTokens: 2000,
    timeoutMs: 45000,
    tenantId,
  });

  if (!r.success || !r.json?.findings || !Array.isArray(r.json.findings)) {
    return { id: panelist.id, ok: false, findings: [], error: r.error || "no findings array returned" };
  }

  const findings: Finding[] = (r.json.findings as any[]).slice(0, 8).map((f) => {
    const signals: RebuttalSignals = {
      attacksCoreAssumption: Boolean(f.attacksCoreAssumption),
      hasConcreteEvidence: Boolean(f.hasConcreteEvidence),
      easilyMitigated: Boolean(f.easilyMitigated),
      dependsOnRareCondition: Boolean(f.dependsOnRareCondition),
    };
    return {
      finding: String(f.finding || "").slice(0, 600),
      severity: ["low", "medium", "high", "critical"].includes(f.severity) ? f.severity : "medium",
      rebuttalSurvival: composeRebuttalSurvival(signals),
      signals,
      evidence: f.evidence ? String(f.evidence).slice(0, 400) : undefined,
      lens: panelist.lens,
      source: panelist.id,
    };
  });

  return { id: panelist.id, ok: true, findings };
}

// Crude semantic dedup: case-insensitive Jaccard on token sets.
function jaccard(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function findConsensus(findings: Finding[]): string[] {
  const consensus: string[] = [];
  const used = new Set<number>();
  for (let i = 0; i < findings.length; i++) {
    if (used.has(i)) continue;
    const matches = [findings[i]];
    for (let j = i + 1; j < findings.length; j++) {
      if (used.has(j)) continue;
      if (findings[i].source !== findings[j].source && jaccard(findings[i].finding, findings[j].finding) > 0.35) {
        matches.push(findings[j]);
        used.add(j);
      }
    }
    if (matches.length >= 2) {
      consensus.push(`[${matches.map((m) => m.source).join("+")}] ${matches[0].finding}`);
      used.add(i);
    }
  }
  return consensus;
}

export async function crossCritique(input: {
  target: string;
  context?: string;
  personaId?: number;
  tenantId?: number;
  panelists?: Array<"claude" | "openai" | "gemini">;
}): Promise<CritiqueResult> {
  const t0 = Date.now();
  if (!input.target || input.target.length < 10) {
    return { success: false, panelistsRan: 0, panelistsFailed: [], findings: [], topThree: [], consensus: [], durationMs: 0, error: "target text too short (min 10 chars)" };
  }
  if (!input.tenantId) {
    return { success: false, panelistsRan: 0, panelistsFailed: [], findings: [], topThree: [], consensus: [], durationMs: 0, error: "tenantId required for cross-critique (no silent tenant 1 fallback)" };
  }

  const target = applyCaps(input.target, { maxChars: 12000 });
  const context = input.context ? applyCaps(input.context, { maxChars: 4000 }) : undefined;
  const selected = input.panelists?.length
    ? PANEL.filter((p) => input.panelists!.includes(p.id as any))
    : PANEL;

  const settled = await Promise.allSettled(selected.map((p) => runOnePanelist(p, target, context, input.tenantId)));
  const results = settled.map((s, i): { id: string; ok: boolean; findings: Finding[]; error?: string } => {
    if (s.status === "fulfilled") return s.value;
    return { id: selected[i].id, ok: false, findings: [], error: `panelist threw: ${(s.reason?.message || String(s.reason)).slice(0, 200)}` };
  });
  const findings = results.flatMap((r) => r.findings);
  const failed = results.filter((r) => !r.ok).map((r) => `${r.id}:${r.error}`);

  // Rank: severity weight × rebuttal survival
  const sevW: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  findings.sort((a, b) => (sevW[b.severity] * b.rebuttalSurvival) - (sevW[a.severity] * a.rebuttalSurvival));

  const consensus = findConsensus(findings);
  const topThree = findings.slice(0, 3);

  // Persist for audit / future reference
  let critiqueId: number | undefined;
  try {
    const payload = {
      target: target.slice(0, 1000),
      panelists: selected.map((p) => ({ id: p.id, model: p.model, lens: p.lens })),
      findings,
      consensus,
      topThree,
      durationMs: Date.now() - t0,
      createdAt: new Date().toISOString(),
    };
    // Durable-store boundary: redact secrets/SSN/CC before persistence
    // (post-edit-code-review HIGH, 2026-07-08). Object-level redaction keeps
    // the persisted blob valid JSON.
    const safeTitle = redactPiiForStorage(`critique: ${target.slice(0, 80)}`).redacted;
    const safePayload = redactObjectForStorage(payload).redacted;
    const ins: any = await db.execute(sql`
      INSERT INTO agent_knowledge (title, content, category, priority, persona_id, tenant_id, source, created_at, updated_at)
      VALUES (
        ${safeTitle},
        ${JSON.stringify(safePayload)},
        'cross_critique',
        ${topThree[0]?.severity === "critical" ? 9 : topThree[0]?.severity === "high" ? 7 : 5},
        ${input.personaId ?? null},
        ${input.tenantId},
        'cross_critique',
        NOW(), NOW()
      ) RETURNING id
    `);
    critiqueId = ins.rows?.[0]?.id;
  } catch (e: any) {
    console.error("[cross-critique] persist failed:", e.message);
  }

  return {
    success: results.some((r) => r.ok),
    critiqueId,
    panelistsRan: results.filter((r) => r.ok).length,
    panelistsFailed: failed,
    findings,
    topThree,
    consensus,
    durationMs: Date.now() - t0,
  };
}

export async function listCritiques(opts: { limit?: number; tenantId: number }): Promise<any[]> {
  if (!opts?.tenantId) {
    console.warn("[cross-critique] listCritiques called without tenantId — refusing to leak cross-tenant data");
    return [];
  }
  const limit = Math.min(50, opts.limit || 10);
  const rows: any = await db.execute(sql`
    SELECT id, title, content, priority, created_at
    FROM agent_knowledge
    WHERE category = 'cross_critique'
      AND tenant_id = ${opts.tenantId}
    ORDER BY id DESC
    LIMIT ${limit}
  `).catch(() => ({ rows: [] }));

  return (rows.rows || []).map((r: any) => {
    let payload: any = {}; try { payload = JSON.parse(r.content); } catch (_silentErr) { logSilentCatch("server/cross-critique.ts", _silentErr); }
    return {
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      panelists: payload.panelists?.map((p: any) => p.id) || [],
      topFinding: payload.topThree?.[0]?.finding,
      consensusCount: payload.consensus?.length || 0,
      findingCount: payload.findings?.length || 0,
    };
  });
}
