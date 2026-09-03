// ─────────────────────────────────────────────────────────────────────────────
// Outcome-driven learning promotion (Grok 4.5 review item #2, 2026-07-25).
//
// Closes the loop between deliverable GRADES and durable SKILL updates:
//   1. recordGradeOutcome — fail-open ledger write at grade time (pass AND
//      fail; exemplars only capture wins, this captures everything).
//   2. scanOutcomePromotions — deterministic $0 aggregation: per (tenant,
//      format) over a window, when failures recur past thresholds, emit a
//      GENERATED eval-seed file + manifest entry for the nightly skill
//      optimizer. Generated entries live in data/skill-optimization/generated/
//      — the hand-authored registry.json is NEVER mutated.
//
// Safety posture: this module only ever writes a ledger row and generated
// JSON files. Any resulting DB skill update still flows through the nightly
// optimizer's existing strict-improvement + 3-LLM-jury gate untouched.
// Quality loop ⇒ fail OPEN throughout (a ledger/scan failure never blocks a
// grade or a production).
// ─────────────────────────────────────────────────────────────────────────────
import fs from "fs";
import path from "path";
import { db } from "../db";
import { sql } from "drizzle-orm";

function rows(res: unknown): any[] {
  return ((res as any)?.rows || res || []) as any[];
}

export const GENERATED_DIR = path.join("data", "skill-optimization", "generated");
export const GENERATED_MANIFEST = path.join(GENERATED_DIR, "manifest.json");

// Promotion thresholds — deliberately conservative: at least 8 graded
// deliverables of a format in the window AND >=35% failing before a format
// earns an optimizer seat (each nightly entry costs a paid optimizer+jury run).
export const PROMOTION_WINDOW_DAYS = 30;
export const PROMOTION_MIN_EVENTS = 8;
export const PROMOTION_MIN_FAIL_RATE = 0.35;

export interface GradeOutcomeInput {
  tenantId: number;
  format: string;
  score: number;
  passed: boolean;
  critique?: string;
  requestExcerpt?: string;
}

/** Fail-open ledger write. Never throws to the caller. */
export async function recordGradeOutcome(input: GradeOutcomeInput): Promise<void> {
  try {
    if (!Number.isInteger(input.tenantId) || input.tenantId <= 0) return;
    const format = String(input.format || "").trim().slice(0, 60);
    if (!format || format === "unsupported") return;
    const score = Number(input.score);
    if (!Number.isFinite(score)) return;
    await db.execute(sql`
      INSERT INTO deliverable_grade_events (tenant_id, format, score, passed, critique, request_excerpt)
      VALUES (${input.tenantId}, ${format}, ${Math.round(Math.max(0, Math.min(100, score)))}, ${!!input.passed},
              ${input.critique ? String(input.critique).slice(0, 2000) : null},
              ${input.requestExcerpt ? String(input.requestExcerpt).slice(0, 500) : null})
    `);
  } catch (e) {
    console.warn("[outcome-promotion] recordGradeOutcome failed (fail-open):", (e as any)?.message ?? e);
  }
}

export interface FormatOutcomeStats {
  tenantId: number;
  format: string;
  total: number;
  failed: number;
}

export interface PromotionDecision {
  promote: boolean;
  reason: string;
  failRate: number;
}

/** Pure decision (exported for query-free tests). Unreadable stats ⇒ no promotion (quality fails open = do nothing). */
export function decidePromotion(stats: Pick<FormatOutcomeStats, "total" | "failed">): PromotionDecision {
  const total = Number(stats?.total);
  const failed = Number(stats?.failed);
  if (!Number.isFinite(total) || !Number.isFinite(failed) || total <= 0 || failed < 0 || failed > total) {
    return { promote: false, reason: "stats unreadable — skipping (quality loop fails open)", failRate: 0 };
  }
  const failRate = failed / total;
  if (total < PROMOTION_MIN_EVENTS) return { promote: false, reason: `only ${total} events (< ${PROMOTION_MIN_EVENTS})`, failRate };
  if (failRate < PROMOTION_MIN_FAIL_RATE) return { promote: false, reason: `fail rate ${(failRate * 100).toFixed(0)}% below ${PROMOTION_MIN_FAIL_RATE * 100}%`, failRate };
  return { promote: true, reason: `${failed}/${total} failed (${(failRate * 100).toFixed(0)}%) over window`, failRate };
}

/** Pure: build eval cases from failing critiques + request excerpts (deterministic, $0). */
export function buildEvalCases(failures: Array<{ critique?: string | null; request_excerpt?: string | null }>, format: string): Array<{ input: string; rubric: string }> {
  const cases: Array<{ input: string; rubric: string }> = [];
  const seen = new Set<string>();
  for (const f of failures) {
    const critique = String(f.critique || "").trim();
    const request = String(f.request_excerpt || "").trim();
    if (!critique && !request) continue;
    const input = request || `Produce a ${format} deliverable meeting the standard quality bar.`;
    const key = (input + "|" + critique).slice(0, 300);
    if (seen.has(key)) continue;
    seen.add(key);
    cases.push({
      input,
      rubric: critique
        ? `Must NOT repeat this previously-observed failure: ${critique.slice(0, 500)}. Penalize any recurrence of that failure mode.`
        : `Meets the ${format} quality bar; penalize the failure modes recorded for this format.`,
    });
    if (cases.length >= 8) break;
  }
  return cases;
}

/**
 * Pure: deterministic seed-skill document for a promoted format ($0, no LLM).
 * Generated entries carry NO skillId/skillName (no DB write path), so the
 * eval file itself must provide the seed doc the optimizer iterates on —
 * without one, processEntry() errors "no seed skill" and the loop is inert.
 * Built from the recurring failure critiques so the optimizer starts from
 * the observed failure modes, not a blank page.
 */
export function buildSeedSkill(format: string, cases: Array<{ rubric: string }>): string {
  const fmt = String(format || "deliverable").trim() || "deliverable";
  const lines = [
    `# ${fmt} production skill (outcome-promoted seed)`,
    "",
    `When producing a ${fmt} deliverable:`,
    "- Meet the standard quality bar for this format before declaring done.",
    "- Re-check the output against every known failure mode below and fix any recurrence before delivery.",
    "",
    "Known recurring failure modes (from graded deliverables):",
  ];
  const seen = new Set<string>();
  for (const c of cases) {
    const rubric = String(c?.rubric || "").trim();
    if (!rubric || seen.has(rubric)) continue;
    seen.add(rubric);
    lines.push(`- ${rubric.slice(0, 300)}`);
    if (seen.size >= 8) break;
  }
  return lines.join("\n");
}

export interface PromotionScanResult {
  scanned: number;
  promoted: Array<{ tenantId: number; format: string; evalFile: string; reason: string }>;
}

/**
 * Deterministic promotion scan (run from the nightly optimizer, $0): writes
 * generated eval files + manifest. Fail-open — any error returns what was
 * completed so far and never throws.
 */
export async function scanOutcomePromotions(): Promise<PromotionScanResult> {
  const result: PromotionScanResult = { scanned: 0, promoted: [] };
  try {
    const statsRes = await db.execute(sql`
      SELECT tenant_id, format, count(*)::int AS total, count(*) FILTER (WHERE NOT passed)::int AS failed
      FROM deliverable_grade_events
      WHERE created_at > CURRENT_TIMESTAMP - make_interval(days => ${PROMOTION_WINDOW_DAYS})
      GROUP BY tenant_id, format
    `);
    const stats = rows(statsRes);
    result.scanned = stats.length;
    const manifest: any[] = [];
    for (const s of stats) {
      const decision = decidePromotion({ total: s.total, failed: s.failed });
      if (!decision.promote) continue;
      const failRes = await db.execute(sql`
        SELECT critique, request_excerpt FROM deliverable_grade_events
        WHERE tenant_id = ${Number(s.tenant_id)} AND format = ${String(s.format)}
          AND NOT passed
          AND created_at > CURRENT_TIMESTAMP - make_interval(days => ${PROMOTION_WINDOW_DAYS})
        ORDER BY created_at DESC LIMIT 20
      `);
      const cases = buildEvalCases(rows(failRes), String(s.format));
      if (cases.length < 3) continue; // too thin to optimize against
      fs.mkdirSync(GENERATED_DIR, { recursive: true });
      const safeFormat = String(s.format).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
      const evalFile = path.join(GENERATED_DIR, `outcome-t${Number(s.tenant_id)}-${safeFormat}.json`);
      fs.writeFileSync(evalFile, JSON.stringify({
        label: `Outcome-promoted: ${s.format} (tenant ${s.tenant_id})`,
        generatedBy: "outcome-promotion",
        generatedAt: new Date().toISOString(),
        window: { days: PROMOTION_WINDOW_DAYS, total: s.total, failed: s.failed },
        // seedSkill makes the generated entry RUNNABLE by the nightly
        // optimizer (file-seed lane) while staying DB-write-free.
        seedSkill: buildSeedSkill(String(s.format), cases),
        cases,
      }, null, 2));
      manifest.push({
        label: `Outcome: ${s.format} (t${s.tenant_id})`,
        evalFile,
        enabled: true,
        // File-seed only — NO skillId/skillName. The optimizer produces a
        // best_skill.md artifact for review; it cannot write the skills DB
        // from a generated entry, keeping auto-generated inputs jury-distant.
      });
      result.promoted.push({ tenantId: Number(s.tenant_id), format: String(s.format), evalFile, reason: decision.reason });
    }
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
    fs.writeFileSync(GENERATED_MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), skills: manifest }, null, 2));
  } catch (e) {
    console.warn("[outcome-promotion] scan failed (fail-open):", (e as any)?.message ?? e);
  }
  return result;
}
