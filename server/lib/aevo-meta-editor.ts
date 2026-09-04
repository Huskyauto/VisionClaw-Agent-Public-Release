import { readFileSync, realpathSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { db } from "../db";
import { procedureEdits, procedureEvolutionRuns } from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { atomicWriteFileSync } from "./atomic-write";
import { compactFailureNotes, formatCompactionDigest } from "./evidence-compactor";

export const EDITABLE_SURFACES = ["output_skill"] as const;
export type EditableSurface = (typeof EDITABLE_SURFACES)[number];

// R114 — every entry case-insensitive (`/i`) so a single capitalization tweak
// cannot smuggle a forbidden surface past the validator.
export const EDIT_FORBIDDEN_PATTERNS: RegExp[] = [
  /safety_profile/i,
  /\bintentGate\b/i,
  /restrictedCategories/i,
  /destructiveToolPolicy/i,
  /refusalCopy/i,
  /\bAHB\s*regression\b/i,
  /\.agents\/skills\//i,
  /TOOL_POLICIES/i,
  /\bdoctrine\s*#/i,
  /persona_souls?/i,
];

export const EDIT_SIZE_BOUNDS = { minRatio: 0.5, maxRatio: 2.0 };
export const MIN_EVIDENCE_COUNT = 3;
export const MAX_EVIDENCE_WINDOW_DAYS = 90;
export const MIN_EVIDENCE_WINDOW_DAYS = 1;

const SKILLS_DIR = realpathSync(join(process.cwd(), "data", "output-skills"));
const REGISTRY_PATH = join(SKILLS_DIR, "_registry.json");

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export interface ValidationResult {
  ok: boolean;
  reasons: string[];
}

// R115.2 +sec — Unicode-normalize + strip zero-width/format/control chars
// BEFORE running the forbidden-pattern regex, so an attacker cannot smuggle a
// banned token past the validator with confusables, NFKC-decomposable forms,
// or zero-width insertions (e.g. "safety\u200B_profile", "ｓafety_profile",
// "TOOL_POLI\u00ADCIES"). The catalog regex on its own is plain-text only; the
// normalization step is what gives the catalog its actual coverage. Applied
// ONLY to the regex-match pass — the persisted afterContent is the original
// string, so legitimate non-ASCII content in playbook prose is unaffected.
function normalizeForPatternCheck(s: string): string {
  // Strip zero-width + bidi/format controls + soft hyphen + variation selectors
  // (the categories that are invisible-or-near-invisible and would never appear
  // in legitimate playbook tokens). \p{Cf} = format chars, \p{Cc} = control.
  const stripped = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u00AD\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu, "")
                    .replace(/[\p{Cf}\p{Cc}]/gu, "");
  // NFKC folds compatibility forms (fullwidth, superscript, etc.) to their
  // canonical ASCII equivalents — closes confusable bypasses like ｓafety,
  // ＴＯＯＬ_ＰＯＬＩＣＩＥＳ, etc.
  return stripped.normalize("NFKC");
}

export function validateProposedContent(
  before: string,
  after: string,
  opts?: { allowFrontmatterNameChange?: boolean }
): ValidationResult {
  const reasons: string[] = [];
  if (typeof after !== "string" || after.length === 0) {
    return { ok: false, reasons: ["after content empty"] };
  }
  const afterLen = after.length;
  const beforeLen = before.length || 1;
  const ratio = afterLen / beforeLen;
  if (ratio < EDIT_SIZE_BOUNDS.minRatio) {
    reasons.push(`after-content too small (ratio ${ratio.toFixed(2)} < ${EDIT_SIZE_BOUNDS.minRatio})`);
  }
  if (ratio > EDIT_SIZE_BOUNDS.maxRatio) {
    reasons.push(`after-content too large (ratio ${ratio.toFixed(2)} > ${EDIT_SIZE_BOUNDS.maxRatio})`);
  }
  // R114 +sec (architect LOW closed) — forbidden patterns are HARDCODE-rejected
  // whenever they appear in `after`, regardless of whether they already exist
  // in `before`. The earlier "introduced-only" check left a bypass surface: an
  // attacker could edit safely AROUND an existing safety_profile literal in a
  // playbook. Now: any forbidden surface in the proposed afterContent fails the
  // validator fail-CLOSED. If a legitimate playbook genuinely needs one of
  // these strings, the only path is hand-edit + a fresh CAS-pinned proposal
  // from the new baseline.
  // R115.2 +sec — pattern check runs against the NFKC-normalized + zero-width-
  // stripped view of `after`, so confusables / fullwidth / zero-width tricks
  // (architect MEDIUM, R115 post-edit pass) cannot smuggle a banned token.
  const afterNormalized = normalizeForPatternCheck(after);
  for (const pat of EDIT_FORBIDDEN_PATTERNS) {
    if (pat.test(after) || pat.test(afterNormalized)) {
      reasons.push(`forbidden pattern present in afterContent: ${pat}`);
    }
  }
  if (!opts?.allowFrontmatterNameChange) {
    const beforeName = extractFrontmatterField(before, "name");
    const afterName = extractFrontmatterField(after, "name");
    if (beforeName && afterName && beforeName !== afterName) {
      reasons.push(`frontmatter "name" changed (${beforeName} -> ${afterName})`);
    }
    if (beforeName && !afterName) {
      reasons.push(`frontmatter "name" removed`);
    }
  }
  if (before.startsWith("---\n") && !after.startsWith("---\n")) {
    reasons.push("frontmatter delimiter stripped");
  }
  return { ok: reasons.length === 0, reasons };
}

function extractFrontmatterField(md: string, field: string): string | null {
  if (!md.startsWith("---\n")) return null;
  const end = md.indexOf("\n---", 4);
  if (end < 0) return null;
  const fm = md.slice(4, end);
  const re = new RegExp(`^${field}:\\s*"?([^"\\n]+?)"?\\s*$`, "m");
  const m = fm.match(re);
  return m ? m[1].trim() : null;
}

export interface OutputSkillFileRef {
  topic: string;
  file: string;
  absolutePath: string;
  content: string;
  sha256: string;
}

export function loadOutputSkillFile(topic: string): OutputSkillFileRef {
  const VALID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  if (!VALID.test(topic)) throw new Error("invalid output-skill topic");
  const reg = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as {
    skills: { topic: string; file: string }[];
  };
  const meta = reg.skills.find((s) => s.topic === topic);
  if (!meta) throw new Error(`unknown output-skill topic: ${topic}`);
  const abs = realpathSync(join(SKILLS_DIR, meta.file));
  if (!abs.startsWith(SKILLS_DIR + "/") && abs !== SKILLS_DIR) {
    throw new Error("output-skill file outside jail");
  }
  const content = readFileSync(abs, "utf8");
  return { topic, file: meta.file, absolutePath: abs, content, sha256: sha256(content) };
}

export function updateRegistryEntry(topic: string, newSha: string, newBytes: number) {
  const raw = readFileSync(REGISTRY_PATH, "utf8");
  const reg = JSON.parse(raw);
  const idx = reg.skills.findIndex((s: any) => s.topic === topic);
  if (idx < 0) throw new Error(`registry entry not found: ${topic}`);
  reg.skills[idx].sha256 = newSha;
  reg.skills[idx].bytes = newBytes;
  reg.skills[idx].last_reviewed = new Date().toISOString().slice(0, 10);
  atomicWriteFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2) + "\n");
}

export interface EvidenceBundle {
  windowDays: number;
  lookupCount: number;
  deliveryFailureCount: number;
  nearMissCount: number;
  // R118 — 4th evidence dimension: per-message thumbs feedback bound to this
  // output-skill via topic_hint. negativeFeedbackCount is the count of -1
  // ratings; userFeedbackComments are top-K diversified -1 comments. Positive
  // ratings are NOT used as evidence (we don't lower the bar on a skill that's
  // already working). Folded into summaryText for the proposer prompt.
  negativeFeedbackCount: number;
  userFeedbackComments: string[];
  recentFailureNotes: string[];
  summaryText: string;
  compaction?: {
    totalCount: number;
    droppedCount: number;
    ratio: number;
    droppedByErrorClass: Record<string, number>;
  };
}

export async function gatherEvidence(opts: {
  tenantId: number;
  targetKind: EditableSurface;
  targetId: string;
  windowDays: number;
}): Promise<EvidenceBundle> {
  const { tenantId, targetId, windowDays } = opts;
  const since = new Date(Date.now() - windowDays * 86400_000);

  // R118 — column-name fix surfaced by architect review. agent_trace_spans
  // columns are `tool_name` / `metadata` (see `server/lib/agent-trace.ts`
  // persistSpanOpen INSERT); the previous `name = 'lookup_output_skill'` +
  // `input::jsonb ->> 'topic'` query referenced columns that don't exist and
  // silently failed-OPEN to zero, masking the AEvo evidence dimension. Fix
  // uses the real columns. Topic looked up from metadata (lookup_output_skill
  // call site should set `metadata: { topic }` when opening the span).
  let lookupCount = 0;
  try {
    const r: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM agent_trace_spans
      WHERE tenant_id = ${tenantId}
        AND kind = 'tool'
        AND tool_name = 'lookup_output_skill'
        AND started_at >= ${since}
        AND (metadata::jsonb ->> 'topic') = ${targetId}
    `);
    lookupCount = (r.rows ?? r)[0]?.n ?? 0;
  } catch {
    lookupCount = 0;
  }

  let deliveryFailureCount = 0;
  let recentFailureNotes: string[] = [];
  let compaction: EvidenceBundle["compaction"];
  try {
    // R115.3 — pull a wider window (100) then Top-K compact down to 10 with
    // diversity scoring. Replaces the previous "20 most recent, take 5"
    // arbitrary-recency selection, which let duplicate floods crowd out
    // rare diverse signals.
    const r: any = await db.execute(sql`
      SELECT failures::text AS f
      FROM delivery_verifications
      WHERE tenant_id = ${tenantId}
        AND status = 'failed'
        AND created_at >= ${since}
        AND failures::text ILIKE ${"%" + targetId + "%"}
      ORDER BY created_at DESC
      LIMIT 100
    `);
    const rows = r.rows ?? r;
    deliveryFailureCount = rows.length;
    const allNotes = rows.map((x: any) => String(x.f).slice(0, 280));
    // R115.3 — fail-OPEN to legacy slice() on compactor error (defensive
    // optimization, not a security gate).
    try {
      const compacted = compactFailureNotes(allNotes, { k: 10, duplicateThreshold: 0.7 });
      recentFailureNotes = compacted.topK;
      compaction = {
        totalCount: compacted.totalCount,
        droppedCount: compacted.droppedCount,
        ratio: compacted.ratio,
        droppedByErrorClass: compacted.droppedByErrorClass,
      };
    } catch {
      recentFailureNotes = allNotes.slice(0, 5);
    }
  } catch {
    deliveryFailureCount = 0;
  }

  // R118 — same column-name fix. agent_trace_spans has no `output` column;
  // grade_deliverable persists its near-miss verdict into `summary` (set on
  // span close via persistSpanClose) and/or `metadata`. Match against both
  // so we don't miss either shape.
  let nearMissCount = 0;
  try {
    const r: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM agent_trace_spans
      WHERE tenant_id = ${tenantId}
        AND kind = 'tool'
        AND tool_name = 'grade_deliverable'
        AND started_at >= ${since}
        AND (summary ILIKE '%nearMissDimension%' OR metadata::text ILIKE '%nearMissDimension%')
    `);
    nearMissCount = (r.rows ?? r)[0]?.n ?? 0;
  } catch {
    nearMissCount = 0;
  }

  // R118 — 4th evidence dimension: thumbs-down feedback tied to this skill via
  // topic_hint (stamped server-side by upsertMessageFeedback). Comments are
  // compacted with the same Top-K + diversity sparsifier so a single duplicate
  // complaint can't flood the proposer prompt. Fails OPEN to zero.
  let negativeFeedbackCount = 0;
  let userFeedbackComments: string[] = [];
  try {
    const r: any = await db.execute(sql`
      SELECT comment
      FROM message_feedback
      WHERE tenant_id = ${tenantId}
        AND rating = -1
        AND topic_hint = ${targetId}
        AND created_at >= ${since}
      ORDER BY created_at DESC
      LIMIT 100
    `);
    const rows = (r.rows ?? r) as Array<{ comment: string | null }>;
    negativeFeedbackCount = rows.length;
    const rawComments = rows.map((x) => (x.comment || "").trim()).filter((c) => c.length > 0).map((c) => c.slice(0, 280));
    if (rawComments.length > 0) {
      try {
        const compacted = compactFailureNotes(rawComments, { k: 8, duplicateThreshold: 0.7 });
        userFeedbackComments = compacted.topK;
      } catch {
        userFeedbackComments = rawComments.slice(0, 5);
      }
    }
  } catch {
    negativeFeedbackCount = 0;
    userFeedbackComments = [];
  }

  const digestLine = compaction
    ? formatCompactionDigest({
        topK: recentFailureNotes,
        totalCount: compaction.totalCount,
        droppedCount: compaction.droppedCount,
        topKByErrorClass: {},
        droppedByErrorClass: compaction.droppedByErrorClass,
        ratio: compaction.ratio,
      })
    : "";

  const summaryText = [
    `Window: ${windowDays} day(s)`,
    `Skill lookups: ${lookupCount}`,
    `Delivery failures referencing skill: ${deliveryFailureCount}`,
    `Near-miss grades in window: ${nearMissCount}`,
    `User thumbs-down on this skill: ${negativeFeedbackCount}`,
    recentFailureNotes.length
      ? `Top failure notes (Top-K + diversity sparsified):\n- ${recentFailureNotes.join("\n- ")}`
      : "Recent failure notes: (none)",
    userFeedbackComments.length
      ? `User feedback comments (Top-K + diversity sparsified):\n- ${userFeedbackComments.join("\n- ")}`
      : "User feedback comments: (none)",
    digestLine,
  ].filter(Boolean).join("\n");

  return { windowDays, lookupCount, deliveryFailureCount, nearMissCount, negativeFeedbackCount, userFeedbackComments, recentFailureNotes, summaryText, compaction };
}

export type LlmCallback = (prompt: string, system: string) => Promise<string>;

export const defaultLlmCallback: LlmCallback = async (prompt, system) => {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropic = new Anthropic();
  const result: any = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  const txt = (result.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  return txt.trim();
};

const META_SYSTEM_PROMPT = `You are AEvo, a meta-editor for output-skill playbooks in the VisionClaw platform.

Your ONLY job: propose a MINIMAL, surgical edit to one markdown playbook based on observed usage evidence.

HARD RULES:
1. Output the COMPLETE revised markdown — frontmatter + body — and nothing else. No prose explanation, no fences, no preamble.
2. The frontmatter "name" field MUST be unchanged.
3. Do NOT introduce any of these strings: safety_profile, intentGate, restrictedCategories, destructiveToolPolicy, refusalCopy, AHB regression, .agents/skills/, TOOL_POLICIES, doctrine #, persona_soul.
4. Total length must be within 50%-200% of the original.
5. Prefer adding "Quality Checks" items, sharpening "Output Structure", or adding "Common Mistakes" sections over removing content.
6. If evidence does NOT clearly suggest an improvement, output the ORIGINAL content verbatim — that's a valid no-op result the system will detect and discard.`;

function buildMetaPrompt(currentContent: string, evidence: EvidenceBundle, targetId: string): string {
  return [
    `Output-skill topic: ${targetId}`,
    "",
    `Evidence:`,
    evidence.summaryText,
    "",
    "Current playbook:",
    "```markdown",
    currentContent,
    "```",
    "",
    "Output the complete revised markdown now. No preamble, no fences in your output, just the markdown.",
  ].join("\n");
}

export interface ProposeResult {
  ok: boolean;
  editId?: number;
  reason?: string;
  validation?: ValidationResult;
  evidence?: EvidenceBundle;
}

export async function proposeProcedureEdit(opts: {
  tenantId: number;
  targetKind: EditableSurface;
  targetId: string;
  evidenceWindowDays?: number;
  llm?: LlmCallback;
  proposedBy?: string;
}): Promise<ProposeResult> {
  const { tenantId, targetKind, targetId } = opts;
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return { ok: false, reason: "invalid tenantId" };
  }
  if (!(EDITABLE_SURFACES as readonly string[]).includes(targetKind)) {
    return { ok: false, reason: `targetKind not in allowlist: ${targetKind}` };
  }
  const windowDays = Math.min(
    MAX_EVIDENCE_WINDOW_DAYS,
    Math.max(MIN_EVIDENCE_WINDOW_DAYS, opts.evidenceWindowDays ?? 30)
  );

  let current: OutputSkillFileRef;
  try {
    current = loadOutputSkillFile(targetId);
  } catch (e: any) {
    return { ok: false, reason: `load failed: ${e?.message || "unknown"}` };
  }

  const evidence = await gatherEvidence({ tenantId, targetKind, targetId, windowDays });
  const totalEvidence = evidence.lookupCount + evidence.deliveryFailureCount + evidence.nearMissCount;
  if (totalEvidence < MIN_EVIDENCE_COUNT) {
    return {
      ok: false,
      reason: `insufficient_evidence (have ${totalEvidence}, need ≥${MIN_EVIDENCE_COUNT})`,
      evidence,
    };
  }

  const runRow = await db
    .insert(procedureEvolutionRuns)
    .values({
      tenantId,
      targetKind,
      targetId,
      status: "running",
      evidenceWindowDays: windowDays,
      iterations: 1,
      summary: { evidence: evidence.summaryText } as any,
    })
    .returning({ id: procedureEvolutionRuns.id });
  const runId = runRow[0]?.id;

  const llm = opts.llm ?? defaultLlmCallback;
  let after = "";
  try {
    after = await llm(buildMetaPrompt(current.content, evidence, targetId), META_SYSTEM_PROMPT);
  } catch (e: any) {
    await db
      .update(procedureEvolutionRuns)
      .set({ status: "failed", finishedAt: new Date(), errorMessage: String(e?.message || e).slice(0, 1000) })
      .where(eq(procedureEvolutionRuns.id, runId));
    return { ok: false, reason: `llm error: ${e?.message || "unknown"}` };
  }

  after = after.replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim() + "\n";

  if (after.trim() === current.content.trim()) {
    await db
      .update(procedureEvolutionRuns)
      .set({ status: "done", finishedAt: new Date(), summary: { ...((runRow[0] as any) ?? {}), noop: true } as any })
      .where(eq(procedureEvolutionRuns.id, runId));
    return { ok: false, reason: "noop_proposal" };
  }

  const validation = validateProposedContent(current.content, after);
  if (!validation.ok) {
    await db
      .update(procedureEvolutionRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: `validation_failed: ${validation.reasons.join("; ")}`.slice(0, 1000),
      })
      .where(eq(procedureEvolutionRuns.id, runId));
    return { ok: false, reason: "validation_failed", validation };
  }

  const afterSha = sha256(after);
  const diffSummary = `${current.content.length}→${after.length} chars (${(
    after.length / current.content.length
  ).toFixed(2)}x); evidence: ${evidence.lookupCount} lookups, ${evidence.deliveryFailureCount} delivery-failures, ${evidence.nearMissCount} near-misses`;

  const inserted = await db
    .insert(procedureEdits)
    .values({
      tenantId,
      targetKind,
      targetId,
      beforeContent: current.content,
      afterContent: after,
      diffSummary,
      evidenceSummary: { ...evidence } as any,
      evidenceWindowDays: windowDays,
      status: "proposed",
      proposedByRunId: runId ? String(runId) : null,
      contentSha256Before: current.sha256,
      contentSha256After: afterSha,
    })
    .returning({ id: procedureEdits.id });

  await db
    .update(procedureEvolutionRuns)
    .set({ status: "done", finishedAt: new Date() })
    .where(eq(procedureEvolutionRuns.id, runId));

  return { ok: true, editId: inserted[0]?.id, validation, evidence };
}

export async function listProcedureEdits(opts: {
  tenantId: number;
  status?: string;
  targetId?: string;
  limit?: number;
}) {
  const { tenantId } = opts;
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const conds = [eq(procedureEdits.tenantId, tenantId)];
  if (opts.status) conds.push(eq(procedureEdits.status, opts.status));
  if (opts.targetId) conds.push(eq(procedureEdits.targetId, opts.targetId));
  return db
    .select({
      id: procedureEdits.id,
      targetKind: procedureEdits.targetKind,
      targetId: procedureEdits.targetId,
      status: procedureEdits.status,
      diffSummary: procedureEdits.diffSummary,
      proposedAt: procedureEdits.proposedAt,
      reviewedAt: procedureEdits.reviewedAt,
      reviewedBy: procedureEdits.reviewedBy,
      appliedAt: procedureEdits.appliedAt,
      rolledBackAt: procedureEdits.rolledBackAt,
    })
    .from(procedureEdits)
    .where(and(...conds))
    .orderBy(desc(procedureEdits.proposedAt))
    .limit(limit);
}

export async function getProcedureEdit(editId: number, tenantId: number) {
  const rows = await db
    .select()
    .from(procedureEdits)
    .where(and(eq(procedureEdits.id, editId), eq(procedureEdits.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function reviewProcedureEdit(opts: {
  editId: number;
  tenantId: number;
  decision: "approved" | "rejected";
  reviewedBy: string;
  note?: string;
}) {
  const edit = await getProcedureEdit(opts.editId, opts.tenantId);
  if (!edit) return { ok: false, reason: "not_found" };
  if (edit.status !== "proposed") {
    return { ok: false, reason: `cannot review from status=${edit.status}` };
  }
  // R114 +sec v2 (architect MEDIUM-3 closed) — review CAS predicate. Without
  // `AND status='proposed'`, two concurrent reviewers could each "succeed"
  // and overwrite each other's decision, weakening HITL decision integrity.
  // Now: only the first reviewer flips the row; the second sees rowCount=0
  // and returns a structured conflict.
  const upd: any = await db
    .update(procedureEdits)
    .set({
      status: opts.decision,
      reviewedAt: new Date(),
      reviewedBy: opts.reviewedBy.slice(0, 200),
      reviewNote: (opts.note ?? "").slice(0, 2000),
    })
    .where(and(eq(procedureEdits.id, opts.editId), eq(procedureEdits.tenantId, opts.tenantId), eq(procedureEdits.status, "proposed")));
  const rowCount = upd?.rowCount ?? upd?.rows?.length ?? 0;
  if (rowCount === 0) {
    return { ok: false, reason: "concurrent_review_detected: another reviewer decided this edit first" };
  }
  return { ok: true };
}

export async function applyProcedureEdit(opts: { editId: number; tenantId: number }) {
  const edit = await getProcedureEdit(opts.editId, opts.tenantId);
  if (!edit) return { ok: false, reason: "not_found" };
  if (edit.status !== "approved") {
    return { ok: false, reason: `cannot apply from status=${edit.status} (must be approved)` };
  }
  if (!(EDITABLE_SURFACES as readonly string[]).includes(edit.targetKind as any)) {
    return { ok: false, reason: `targetKind not in allowlist: ${edit.targetKind}` };
  }
  const revalidate = validateProposedContent(edit.beforeContent, edit.afterContent);
  if (!revalidate.ok) {
    return { ok: false, reason: `revalidation_failed: ${revalidate.reasons.join("; ")}` };
  }

  let current: OutputSkillFileRef;
  try {
    current = loadOutputSkillFile(edit.targetId);
  } catch (e: any) {
    return { ok: false, reason: `load failed: ${e?.message || "unknown"}` };
  }
  if (current.sha256 !== edit.contentSha256Before) {
    return {
      ok: false,
      reason: `cas_mismatch: file changed since proposal (current sha=${current.sha256.slice(0, 12)}, expected=${edit.contentSha256Before.slice(0, 12)})`,
    };
  }

  // R114 +sec v8c (architect Pass 3 HIGH closed) — platform-admin tenant gate
  // at the MUTATOR boundary. data/output-skills/*.md is a SHARED/GLOBAL surface
  // (every tenant reads the same playbooks), so allowing a non-admin tenant to
  // apply an edit would let any tenant rewrite Bob's playbooks for everyone.
  // The route gate (requirePlatformAdmin) covers UI; this gate covers the tool
  // path (server/tools.ts apply_procedure_edit) + any future internal caller.
  // Defense-in-depth — single chokepoint, both paths covered.
  const { ADMIN_TENANT_ID: APPLY_ADMIN_TID } = await import("../auth");
  if (opts.tenantId !== APPLY_ADMIN_TID) {
    return { ok: false, reason: "platform_admin_required: apply mutates global data/output-skills/* — admin tenant only" };
  }

  // R114 +sec v2 (architect MEDIUM-2 fully closed) — CLAIM-THEN-WRITE pattern.
  // The earlier v1 ordering wrote the file BEFORE the guarded UPDATE, so the
  // loser of a race still performed side effects before learning it lost. Now:
  // (1) atomically flip status='approved' → 'applied' via WHERE-clause CAS
  // (only one approver wins); (2) loser aborts with NO file/registry writes;
  // (3) winner performs the file write and registry update; (4) if the write
  // step throws AFTER the DB has been claimed, best-effort revert status back
  // to 'approved' so a future apply can retry — surface a deterministic
  // recovery signal either way.
  const claim: any = await db
    .update(procedureEdits)
    .set({ status: "applied", appliedAt: new Date() })
    .where(and(eq(procedureEdits.id, opts.editId), eq(procedureEdits.tenantId, opts.tenantId), eq(procedureEdits.status, "approved")));
  const claimedRows = claim?.rowCount ?? claim?.rows?.length ?? 0;
  if (claimedRows === 0) {
    return { ok: false, reason: "concurrent_apply_detected: another approver applied this edit first" };
  }
  // R114 +sec v3 (architect MEDIUM-4 closed) — STAGED compensating action.
  // The earlier ordering wrapped atomicWriteFileSync + updateRegistryEntry in
  // a single try, so a registry-update failure AFTER a successful file write
  // would leave the file changed but the DB reverted (state divergence).
  // Now: file write is its own stage; registry update is its own stage; if
  // registry fails, we restore the file from beforeContent (compensation),
  // THEN revert DB. State is always one of: (a) fully applied, (b) fully
  // reverted to approved+original-file, never the divergent middle.
  // R114 +sec v4 (architect MEDIUM-4 FULLY closed) — authoritative compensation.
  // Compensation is no longer best-effort: we only revert the DB claim if the
  // file + registry have been provably restored to pre-apply state. If
  // compensation itself fails, we KEEP the DB in 'applied' state and surface a
  // structured `requires_manual_reconcile` so an operator can fix the divergence
  // via the queue UI instead of the system silently transitioning into a
  // divergent state that the next apply attempt would block on (cas_mismatch).
  let fileWritten = false;
  try {
    atomicWriteFileSync(current.absolutePath, edit.afterContent);
    fileWritten = true;
    const newBytes = Buffer.byteLength(edit.afterContent, "utf8");
    updateRegistryEntry(edit.targetId, edit.contentSha256After, newBytes);
  } catch (e: any) {
    const origErr = e?.message || "unknown";
    if (!fileWritten) {
      // File never changed — attempt clean revert. Authoritative: throw OR
      // rowCount=0 (no-op) both surface requires_manual_reconcile so we never
      // misreport "reverted" when the DB row didn't actually move.
      try {
        const rev: any = await db
          .update(procedureEdits)
          .set({ status: "approved", appliedAt: null })
          .where(and(eq(procedureEdits.id, opts.editId), eq(procedureEdits.tenantId, opts.tenantId), eq(procedureEdits.status, "applied")));
        const revCount = rev?.rowCount ?? rev?.rows?.length ?? 0;
        if (revCount === 0) {
          return {
            ok: false,
            reason: `requires_manual_reconcile: write_failed_pre_filewrite=${origErr}; db_revert_noop (row changed status between claim and revert); file unchanged but DB status unknown`,
          };
        }
      } catch (revertErr: any) {
        return {
          ok: false,
          reason: `requires_manual_reconcile: write_failed_pre_filewrite=${origErr}; db_revert_failed=${revertErr?.message || "unknown"}; file unchanged but DB still 'applied'`,
        };
      }
      return { ok: false, reason: `write_failed_pre_filewrite: ${origErr} (file unchanged, status reverted)` };
    }
    // File WAS written — must restore both file AND registry before reverting DB.
    let compensationOk = true;
    let compensationErr = "";
    try {
      atomicWriteFileSync(current.absolutePath, edit.beforeContent);
      const beforeBytes = Buffer.byteLength(edit.beforeContent, "utf8");
      updateRegistryEntry(edit.targetId, edit.contentSha256Before, beforeBytes);
    } catch (ce: any) {
      compensationOk = false;
      compensationErr = ce?.message || "unknown";
    }
    if (!compensationOk) {
      // Authoritative: keep DB claimed so the divergence is visible in the
      // queue. Operator inspects + reconciles manually.
      return {
        ok: false,
        reason: `requires_manual_reconcile: write_failed=${origErr}; compensation_failed=${compensationErr}; DB status retained as 'applied' to preserve audit trail — operator must inspect file at ${current.absolutePath} and the queue entry`,
      };
    }
    // Compensation succeeded → safe to revert DB (rowCount-verified).
    try {
      const rev: any = await db
        .update(procedureEdits)
        .set({ status: "approved", appliedAt: null })
        .where(and(eq(procedureEdits.id, opts.editId), eq(procedureEdits.tenantId, opts.tenantId), eq(procedureEdits.status, "applied")));
      const revCount = rev?.rowCount ?? rev?.rows?.length ?? 0;
      if (revCount === 0) {
        return {
          ok: false,
          reason: `requires_manual_reconcile: write_failed=${origErr}; file_compensated_ok; db_revert_noop (row changed status between claim and revert) — DB status unknown despite file being restored`,
        };
      }
    } catch (revertErr: any) {
      return {
        ok: false,
        reason: `requires_manual_reconcile: write_failed=${origErr}; file_compensated_ok; db_revert_failed=${revertErr?.message || "unknown"} — DB status still 'applied' despite file being restored`,
      };
    }
    return { ok: false, reason: `write_failed_after_db_claim: ${origErr} (file + status fully compensated to pre-apply state)` };
  }
  return { ok: true };
}

export async function rollbackProcedureEdit(opts: {
  editId: number;
  tenantId: number;
  reason: string;
}) {
  const edit = await getProcedureEdit(opts.editId, opts.tenantId);
  if (!edit) return { ok: false, reason: "not_found" };
  if (edit.status !== "applied") {
    return { ok: false, reason: `cannot rollback from status=${edit.status} (must be applied)` };
  }
  let current: OutputSkillFileRef;
  try {
    current = loadOutputSkillFile(edit.targetId);
  } catch (e: any) {
    return { ok: false, reason: `load failed: ${e?.message || "unknown"}` };
  }
  // R114 +sec v7 (architect MEDIUM-rollback-CAS closed) — rollback CAS guard.
  // applyProcedureEdit checks current.sha256 === contentSha256Before so we
  // never apply onto a file that has drifted. Rollback needs the symmetric
  // guard: current.sha256 MUST match contentSha256After, otherwise restoring
  // beforeContent would silently clobber a newer applied edit OR a manual
  // hand-edit on the same skill file. Fail CLOSED with structured cas_mismatch
  // — operator must inspect the file before proceeding.
  if (current.sha256 !== edit.contentSha256After) {
    return {
      ok: false,
      reason: `cas_mismatch: file diverged from this edit's after-state (current sha=${current.sha256.slice(0, 12)}, expected=${edit.contentSha256After.slice(0, 12)}) — a newer edit or manual change is present; refusing to clobber`,
    };
  }
  // R114 +sec v8c (architect Pass 3 HIGH closed) — platform-admin gate at the
  // mutator boundary. Same reasoning as applyProcedureEdit: shared/global
  // surface, must not be reachable by non-admin tenants through tool or future
  // internal caller paths.
  const { ADMIN_TENANT_ID: RB_ADMIN_TID } = await import("../auth");
  if (opts.tenantId !== RB_ADMIN_TID) {
    return { ok: false, reason: "platform_admin_required: rollback mutates global data/output-skills/* — admin tenant only" };
  }
  // R114 +sec v2 (architect MEDIUM-2 fully closed) — claim-then-write rollback.
  // Same ordering as apply: flip DB status FIRST so the loser aborts before
  // touching the file; only the winner writes the restoration. On write
  // failure, best-effort revert status to 'applied' so a future rollback
  // can retry.
  const claim: any = await db
    .update(procedureEdits)
    .set({
      status: "rolled_back",
      rolledBackAt: new Date(),
      reviewNote: ((edit.reviewNote || "") + ` | rollback_reason: ${opts.reason}`).slice(0, 2000),
    })
    .where(and(eq(procedureEdits.id, opts.editId), eq(procedureEdits.tenantId, opts.tenantId), eq(procedureEdits.status, "applied")));
  const claimedRows = claim?.rowCount ?? claim?.rows?.length ?? 0;
  if (claimedRows === 0) {
    return { ok: false, reason: "concurrent_rollback_detected: another approver rolled back this edit first" };
  }
  // R114 +sec v4 (architect MEDIUM-4 FULLY closed) — authoritative compensation
  // for rollback mirrors the apply path. If file restore fails, do NOT revert
  // DB — surface requires_manual_reconcile and keep DB in 'rolled_back' so
  // the divergence is visible in the queue.
  let fileRestored = false;
  try {
    atomicWriteFileSync(current.absolutePath, edit.beforeContent);
    fileRestored = true;
    const beforeBytes = Buffer.byteLength(edit.beforeContent, "utf8");
    updateRegistryEntry(edit.targetId, edit.contentSha256Before, beforeBytes);
  } catch (e: any) {
    const origErr = e?.message || "unknown";
    if (!fileRestored) {
      try {
        const rev: any = await db
          .update(procedureEdits)
          .set({ status: "applied", rolledBackAt: null })
          .where(and(eq(procedureEdits.id, opts.editId), eq(procedureEdits.tenantId, opts.tenantId), eq(procedureEdits.status, "rolled_back")));
        const revCount = rev?.rowCount ?? rev?.rows?.length ?? 0;
        if (revCount === 0) {
          return {
            ok: false,
            reason: `requires_manual_reconcile: write_failed_pre_filewrite=${origErr}; db_revert_noop (row changed status between claim and revert); file unchanged but DB status unknown`,
          };
        }
      } catch (revertErr: any) {
        return {
          ok: false,
          reason: `requires_manual_reconcile: write_failed_pre_filewrite=${origErr}; db_revert_failed=${revertErr?.message || "unknown"}; file unchanged but DB still 'rolled_back'`,
        };
      }
      return { ok: false, reason: `write_failed_pre_filewrite: ${origErr} (file unchanged, status reverted)` };
    }
    let compensationOk = true;
    let compensationErr = "";
    try {
      atomicWriteFileSync(current.absolutePath, edit.afterContent);
      const afterBytes = Buffer.byteLength(edit.afterContent, "utf8");
      updateRegistryEntry(edit.targetId, edit.contentSha256After, afterBytes);
    } catch (ce: any) {
      compensationOk = false;
      compensationErr = ce?.message || "unknown";
    }
    if (!compensationOk) {
      return {
        ok: false,
        reason: `requires_manual_reconcile: write_failed=${origErr}; compensation_failed=${compensationErr}; DB status retained as 'rolled_back' — operator must inspect file at ${current.absolutePath} and the queue entry`,
      };
    }
    try {
      const rev: any = await db
        .update(procedureEdits)
        .set({ status: "applied", rolledBackAt: null })
        .where(and(eq(procedureEdits.id, opts.editId), eq(procedureEdits.tenantId, opts.tenantId), eq(procedureEdits.status, "rolled_back")));
      const revCount = rev?.rowCount ?? rev?.rows?.length ?? 0;
      if (revCount === 0) {
        return {
          ok: false,
          reason: `requires_manual_reconcile: write_failed=${origErr}; file_compensated_ok; db_revert_noop (row changed status between claim and revert)`,
        };
      }
    } catch (revertErr: any) {
      return {
        ok: false,
        reason: `requires_manual_reconcile: write_failed=${origErr}; file_compensated_ok; db_revert_failed=${revertErr?.message || "unknown"}`,
      };
    }
    return { ok: false, reason: `write_failed_after_db_claim: ${origErr} (file + status fully compensated to applied state)` };
  }
  return { ok: true };
}
