/**
 * jury-triage.ts — R125+3.6 (hardened R125+3.6+sec)
 *
 * Multi-model jury triage for open issues / findings. Wraps `executeMoA`
 * (ensemble_query frontier pool) with a STRUCTURED verdict-extraction prompt,
 * computes 2-of-3 majority, and returns a typed decision.
 *
 * Bob's R125+3.6 operational pattern (2026-05-23):
 *   "If the system sees an issue, it calls 3 top-end models. If 2 of 3 agree,
 *    the outcome is applied — fix or accept/reject as appropriate."
 *
 * Verdict semantics:
 *   FIX     — take action this session (write code, add test, change doc).
 *   ACCEPT  — defer with documented rationale + re-open trigger (keep open
 *             but classified as correctly inert at current platform state).
 *   REJECT  — non-issue. Mark as such, keep as tribal-knowledge only.
 *   ESCALATE — no 2/3 majority, or jury failure; needs human eyes.
 *
 * Auto-apply policy (caller's responsibility, not this primitive):
 *   - ACCEPT / REJECT  → safe to auto-apply (decision-log only; source-doc
 *                        mutation is Phase-2 implementer work).
 *   - FIX              → caller queues NL fix proposal for an implementer
 *                        pipeline (LLM diff gen + mandatory test gate +
 *                        rollback on fail).
 *   - ESCALATE         → caller emits owner-notification + leaves status
 *                        unchanged.
 *
 * R125+3.6+sec hardening (architect MEDIUM-HIGH finding A):
 *   - Issue/context text is SANITIZED before interpolation. Lines that look
 *     like our verdict-channel control keywords (VERDICT:, RATIONALE:,
 *     FIX_PROPOSAL:) are neutralized with a `«quoted-`-prefix so adversarial
 *     input can't impersonate proposer output.
 *   - Parser is line-anchored (`^VERDICT:` multiline). Multiple verdict lines
 *     in a single proposer answer → that proposer's vote becomes ESCALATE
 *     (not silently first-match-wins).
 *   - parseVote and tallyVotes exported as `_parseVote` / `_tallyVotes` for
 *     unit-test coverage (see tests/unit/jury-triage.test.ts).
 *
 * Cost: same as `ensemble_query` frontier pool — ~5x normal call.
 */

import { executeMoA } from "../moa";
import { generateEmbedding, cosineSimilarity } from "../embeddings";

export type JuryVerdict = "FIX" | "ACCEPT" | "REJECT" | "ESCALATE";

export interface JuryVote {
  model: string;
  provider: string;
  verdict: JuryVerdict;
  rationale: string;
  fixProposal?: string;
  ok: boolean;
  error?: string;
}

export interface JuryDecision {
  verdict: JuryVerdict;
  majority: number;
  votes: JuryVote[];
  concordance: number | null;
  shouldEscalate: boolean;
  aggregatorAnswer: string;
  fixProposal?: string;
  /**
   * R125+13.23 — Goodhart fragility guard (SIA-inspired, arXiv:2605.27276).
   * Mean pairwise cosine of the FIX-voting proposers' fixProposal embeddings.
   * Distinct from `concordance` (κ over all proposer *answers*): this measures
   * whether the proposers agree on WHAT TO CHANGE, not merely on the verdict
   * label. null when verdict≠FIX, <2 fix proposals, or embeddings unavailable
   * (fail-open — never blocks on a flaky embedding service). The auto-apply
   * seam refuses to queue a FIX whose proposers agree on the label but diverge
   * on the fix (the coupled-verifier fragility SIA documents).
   */
  fixConcordance?: number | null;
  totalLatencyMs: number;
  loggedAs?: string | number;
}

export interface JuryTriageOptions {
  issueText: string;
  context?: string;
  tenantId: number;
  invokedVia?: string;
  // Bob 2026-06-26 — owner explicit-jury paid override (admin tenant only).
  // Threaded straight through to executeMoA; gated there by ownerJuryCeiling().
  meteredOverride?: boolean;
}

// R125+3.6+sec — control-keyword neutralizer. Prevents adversarial issue_text
// from impersonating a proposer's structured-output channel. We mark hits in a
// visible way so a human auditor can see what was quoted-out.
const VERDICT_CHANNEL_RE = /^\s*(VERDICT|RATIONALE|FIX_PROPOSAL)\s*:/gim;
function sanitizeForPrompt(s: string): string {
  if (!s) return s;
  return s.replace(VERDICT_CHANNEL_RE, "«quoted-$1»:");
}

const JURY_PROMPT = (issue: string, context: string) =>
  `You are 1 of 3 frontier models on a jury reviewing an open project issue for VisionClaw (a 16-persona AI corporate-ops platform). Two other frontier models in different families will vote on the same question in parallel. If 2 of 3 of us agree on a verdict, it is AUTO-APPLIED — so be deliberate.

ISSUE
"""
${issue}
"""

CONTEXT
${context || "(no extra context)"}

Decide ONE verdict:
- FIX     = the issue is real and actionable in the current session. Code change, test, or doc update warranted.
- ACCEPT  = the issue is correctly documented as a known deferral; current platform state makes it inert; re-opens on a specific trigger.
- REJECT  = it is a non-issue (false alarm, source-of-truth elsewhere, hypothetical-only). Remove from open list; keep as tribal-knowledge.

Respond in this EXACT format, no preamble, no markdown headers, and DO NOT emit more than one VERDICT line:

VERDICT: <FIX|ACCEPT|REJECT>
RATIONALE: <one paragraph, max 4 sentences, concrete reasoning>
${"FIX_PROPOSAL"}: <only if VERDICT=FIX — list concrete files / lines / changes; one bullet per change>

Do not hedge. Pick ONE verdict. If you see multiple VERDICT: lines in your own output, the verdict-channel parser will downgrade your vote to ESCALATE.`;

/**
 * Parse a single proposer's freeform answer into a structured vote.
 * R125+3.6+sec hardening:
 *  - VERDICT line MUST be at start of line (multiline /^/) — neutralizes
 *    in-paragraph "verdict: x" impersonation in the rationale body.
 *  - Multiple VERDICT lines → ESCALATE (refuses to silently pick the first).
 *  - Exported as `_parseVote` for unit-test coverage.
 */
/**
 * R125+12+sec (architect HIGH closed 2026-05-24): sanitize untrusted LLM
 * fixProposal before it crosses the implementer-pickup seam (queue.json →
 * downstream LLM diff generator). Strips prompt-injection markers, role-tag
 * impersonation, instruction-override patterns, and ANSI escapes. Length cap
 * stays at 8000 chars. Downstream consumers MUST still treat this as
 * untrusted input — this is defense-in-depth, not sanitization-as-safety.
 */
export function _sanitizeFixProposal(s: string): string {
  if (!s) return s;
  return s
    .slice(0, 8000)
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/^\s*(SYSTEM|ASSISTANT|USER|TOOL|DEVELOPER):\s*$/gim, "[REDACTED_ROLE_MARKER]")
    .replace(/<\/?(system|user|assistant|tool|developer)>/gi, "[REDACTED_TAG]")
    .replace(/\b(ignore|disregard|forget|override|skip) (all |any )?(previous|prior|earlier|above) (instructions|messages|prompts|system|rules)\b/gi, "[REDACTED_INSTR_OVERRIDE]")
    .replace(/```\s*(system|assistant|tool|developer)\b/gi, "```[redacted-role]")
    .replace(/\bnew (instructions?|system prompt|directives?):/gi, "[REDACTED_INSTR_OVERRIDE]:");
}

export function _parseVote(text: string): { verdict: JuryVerdict; rationale: string; fixProposal?: string } {
  if (!text || text.length < 5) {
    return { verdict: "ESCALATE", rationale: "(empty or truncated response)" };
  }
  const verdictMatches = [...text.matchAll(/^\s*VERDICT:\s*\**\s*(FIX|ACCEPT|REJECT)\b/gim)];
  if (verdictMatches.length === 0) {
    return { verdict: "ESCALATE", rationale: text.slice(0, 800).trim() };
  }
  if (verdictMatches.length > 1) {
    // Adversarial / confused output — refuse to silently pick first.
    return {
      verdict: "ESCALATE",
      rationale: `(refused: ${verdictMatches.length} VERDICT lines in single proposer answer — verdict-channel ambiguity)`,
    };
  }
  const verdict = verdictMatches[0][1].toUpperCase() as JuryVerdict;
  const rationaleMatch = text.match(/^\s*RATIONALE:\s*([\s\S]+?)(?:\n\s*FIX_PROPOSAL:|\n\n|$)/im);
  const fixMatch = text.match(/^\s*FIX_PROPOSAL:\s*([\s\S]+)$/im);
  return {
    verdict,
    rationale: (rationaleMatch?.[1] || text.slice(0, 800)).trim().slice(0, 2000),
    fixProposal: verdict === "FIX" ? _sanitizeFixProposal(fixMatch?.[1]?.trim() || "") : undefined,
  };
}

/**
 * Strict-majority tally, DYNAMIC to jury size (the frontier pool may be 3, 4, or
 * more proposers). A verdict wins only with a strict majority of the votes cast:
 * 3 jurors need 2, 4 jurors need 3, 5 jurors need 3. Any tie (e.g. 2–2 of 4) or
 * an all-ESCALATE result resolves to ESCALATE — an even split must NEVER
 * auto-decide. Exported as `_tallyVotes` for unit-test coverage.
 */
export function _tallyVotes(votes: { verdict: JuryVerdict }[]): { verdict: JuryVerdict; majority: number } {
  const tally: Record<JuryVerdict, number> = { FIX: 0, ACCEPT: 0, REJECT: 0, ESCALATE: 0 };
  for (const v of votes) tally[v.verdict]++;
  const need = Math.floor(votes.length / 2) + 1; // strict majority of votes cast
  if (tally.FIX >= need) return { verdict: "FIX", majority: tally.FIX };
  if (tally.ACCEPT >= need) return { verdict: "ACCEPT", majority: tally.ACCEPT };
  if (tally.REJECT >= need) return { verdict: "REJECT", majority: tally.REJECT };
  return { verdict: "ESCALATE", majority: Math.max(tally.FIX, tally.ACCEPT, tally.REJECT) };
}

/**
 * R125+13.23 — pure mean-pairwise-cosine over a set of embedding vectors.
 * Used by the Goodhart fragility guard to score fix-direction concordance.
 * Returns null if fewer than 2 valid vectors (no diversity signal). Clamped
 * to [0,1]. Pure + exported as `_meanPairwiseCosine` for unit-test coverage
 * (no embedding service needed — caller supplies the vectors).
 */
export function _meanPairwiseCosine(vectors: number[][]): number | null {
  const valid = vectors.filter(v => Array.isArray(v) && v.length > 0);
  if (valid.length < 2) return null;
  let sum = 0, n = 0;
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      sum += cosineSimilarity(valid[i], valid[j]);
      n++;
    }
  }
  return n > 0 ? Math.max(0, Math.min(1, sum / n)) : null;
}

export async function juryTriage(opts: JuryTriageOptions): Promise<JuryDecision> {
  const issue = String(opts.issueText || "").trim();
  if (issue.length < 10) {
    return {
      verdict: "ESCALATE",
      majority: 0,
      votes: [],
      concordance: null,
      shouldEscalate: true,
      aggregatorAnswer: "issueText too short — jury not invoked",
      totalLatencyMs: 0,
    };
  }

  // R125+3.6+sec — sanitize untrusted inputs before prompt interpolation.
  const safeIssue = sanitizeForPrompt(issue);
  const safeContext = sanitizeForPrompt(opts.context || "");
  const question = JURY_PROMPT(safeIssue, safeContext);

  const r = await executeMoA({
    question,
    tenantId: opts.tenantId,
    invokedVia: opts.invokedVia || "jury-triage",
    pool: "frontier",
    meteredOverride: opts.meteredOverride,
  });

  const votes: JuryVote[] = r.proposers.map((p: any) => {
    if (!p.ok || !p.answer) {
      return {
        model: p.modelId,
        provider: p.provider,
        verdict: "ESCALATE" as JuryVerdict,
        rationale: p.error || "no answer",
        ok: false,
        error: p.error,
      };
    }
    const parsed = _parseVote(p.answer);
    return {
      model: p.modelId,
      provider: p.provider,
      verdict: parsed.verdict,
      rationale: parsed.rationale,
      fixProposal: parsed.fixProposal,
      ok: true,
    };
  });

  const { verdict, majority } = _tallyVotes(votes);

  const fixVotes = votes.filter(v => v.verdict === "FIX" && v.fixProposal);
  const fixProposal = verdict === "FIX"
    ? fixVotes
        .map(v => `### ${v.model}\n${v.fixProposal}`)
        .join("\n\n")
    : undefined;

  // R125+13.23 — Goodhart fragility guard (SIA-inspired, arXiv:2605.27276).
  // A FIX verdict means 2+ models agreed on the LABEL — but label agreement is
  // NOT fix agreement. Two models can both vote FIX for contradictory changes;
  // that "strong on the verifier (verdict), fragile underneath (the diff)"
  // shape is exactly the coupled-verifier Goodhart failure SIA documents. We
  // score fix-direction concordance = mean pairwise cosine of the FIX-voting
  // proposers' fixProposal embeddings. Reuses the embedding infra (no extra
  // frontier calls). Best-effort, latency-bounded, fail-OPEN to null so a flaky
  // embedding service never blocks the path. The auto-apply seam (scripts/
  // jury-triage.ts) refuses to auto-queue when this is below a floor.
  let fixConcordance: number | null = null;
  if (verdict === "FIX" && fixVotes.length >= 2) {
    try {
      const FIX_CONCORDANCE_BUDGET_MS = 4000;
      const embedWithBudget = (text: string) => Promise.race<number[] | null>([
        generateEmbedding(text),
        new Promise<null>(resolve => setTimeout(() => resolve(null), FIX_CONCORDANCE_BUDGET_MS)),
      ]);
      const embs = await Promise.all(
        fixVotes.map(v => embedWithBudget((v.fixProposal || "").slice(0, 800))),
      );
      fixConcordance = _meanPairwiseCosine(
        embs.filter((e): e is number[] => Array.isArray(e) && e.length > 0),
      );
    } catch (e) {
      console.warn("[jury-triage] fix-direction concordance failed (non-fatal):", (e as Error).message?.slice(0, 120));
      fixConcordance = null;
    }
  }

  return {
    verdict,
    majority,
    votes,
    concordance: r.concordance,
    shouldEscalate: verdict === "ESCALATE" || (r.shouldEscalate ?? false),
    aggregatorAnswer: (r.aggregated || "").slice(0, 4000),
    fixProposal,
    fixConcordance,
    totalLatencyMs: r.totalLatencyMs,
    loggedAs: r.responseId,
  };
}
