#!/usr/bin/env tsx
/**
 * scripts/jury-triage.ts — R125+3.6
 *
 * CLI runner for the jury-triage primitive. Walks a source of open issues,
 * fires the 3-model jury at each, auto-applies the verdict per Bob's policy:
 *   - ACCEPT  → log to decisions journal; gap stays in known-gaps as deferred.
 *   - REJECT  → log to decisions journal; gap removed from open list (caller's
 *               responsibility to apply the doc edit — script writes a queue
 *               entry instead of silently mutating the source doc).
 *   - FIX     → log + write fix proposal to data/jury-decisions/queue.json so
 *               an implementer (next chat turn, scheduled subagent, or Bob)
 *               picks it up. Auto-execution of NL fix proposals into code
 *               diffs is the implementer's job, not the jury's.
 *   - ESCALATE → log + emit owner-notification.
 *
 * Usage:
 *   npx tsx scripts/jury-triage.ts --source=gaps           # all open gaps
 *   npx tsx scripts/jury-triage.ts --source=gaps --limit=1 # one-shot demo
 *   npx tsx scripts/jury-triage.ts --issue="text of one finding"
 *   npx tsx scripts/jury-triage.ts --issue-file=path/to/finding.md
 *
 * Exit codes:
 *   0  all issues triaged
 *   1  jury invocation failure (executeMoA threw)
 *   2  invalid arguments
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { juryTriage, type JuryDecision } from "../server/lib/jury-triage";
import { ADMIN_TENANT_ID } from "../server/tenant-constants";
import { signQueueEntry } from "../server/agentic/jury-queue-integrity";
import { appendQueueEntries as appendQueueEntriesLocked } from "../server/agentic/jury-queue-store";

const GAPS_DOC = "docs/architecture-notes.md";
const DECISIONS_DIR = "data/jury-decisions";
const QUEUE_PATH = join(DECISIONS_DIR, "queue.json");

type QueueEntry = {
  triagedAt: string;
  source: string;
  issueSlug: string;
  verdict: string;
  majority: number;
  concordance: number | null;
  /**
   * R125+13.23 — Goodhart fragility guard. Fix-direction concordance (mean
   * pairwise cosine of the FIX-voting proposers' fixProposal embeddings). A
   * FIX that reaches the queue has already cleared the divergence floor; this
   * is recorded so the implementer can weight how robustly the fix was agreed.
   */
  fixConcordance?: number | null;
  shouldEscalate: boolean;
  fixProposal?: string;
  /**
   * R125+12+sec (architect HIGH closed 2026-05-24): explicit marker that
   * `fixProposal` is freeform LLM output and downstream implementers MUST
   * treat it as untrusted input (no eval, no shell expansion, no direct
   * concatenation into a follow-up LLM system prompt without re-sanitizing).
   */
  fixProposalUntrusted?: true;
  votes: { model: string; verdict: string; rationale: string }[];
};

function parseArgs(argv: string[]): { source?: string; issue?: string; issueFile?: string; limit?: number; dryRun: boolean } {
  const out: any = { dryRun: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--source=")) out.source = a.slice("--source=".length);
    else if (a.startsWith("--issue=")) out.issue = a.slice("--issue=".length);
    else if (a.startsWith("--issue-file=")) out.issueFile = a.slice("--issue-file=".length);
    else if (a.startsWith("--limit=")) out.limit = parseInt(a.slice("--limit=".length), 10);
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function extractGaps(): { slug: string; text: string }[] {
  const md = readFileSync(GAPS_DOC, "utf8");
  const sec = md.match(/## Known defense-in-depth gaps \(open\)\n([\s\S]+?)\n---/);
  if (!sec) return [];
  const body = sec[1];
  const gaps: { slug: string; text: string }[] = [];
  // Each gap is a top-level bullet starting with `- **<title>**`
  const re = /^- \*\*([^*]+)\*\*([\s\S]*?)(?=^- \*\*|\Z)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const title = m[1].trim();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const full = `- **${title}**${m[2]}`.trim();
    // Skip already-CLOSED gaps (they're documented historically)
    if (/\(CLOSED [0-9]{4}-/.test(title)) continue;
    gaps.push({ slug, text: full });
  }
  return gaps;
}

function ensureDirs() {
  if (!existsSync(DECISIONS_DIR)) mkdirSync(DECISIONS_DIR, { recursive: true });
}

/**
 * R125+12+sec (architect HIGH closed 2026-05-24): on ESCALATE (jury did not
 * reach 2/3 majority OR all-ESCALATE), email the owner so they can step in.
 * Previously the script only wrote the decision markdown — invariant says
 * "ESCALATE → ... emit owner-notification", this closes that gap.
 */
async function notifyOwnerOnEscalate(slug: string, decision: JuryDecision, source: string, mdPath: string) {
  const ownerEmail = process.env.OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL || process.env.SITE_OWNER_EMAIL;
  if (!ownerEmail) {
    console.warn(`[jury-triage] ESCALATE on '${slug}' but no OWNER_*_EMAIL env set — decision logged at ${mdPath} for manual review`);
    return;
  }
  try {
    const { getOrCreateTenantInbox, sendEmail } = await import("../server/email");
    const inboxResult = await getOrCreateTenantInbox(ADMIN_TENANT_ID);
    const inboxId = typeof inboxResult === "string" ? inboxResult : (inboxResult as any).inboxId || (inboxResult as any).email;
    await sendEmail({
      inboxId,
      to: ownerEmail,
      subject: `JURY ESCALATE: ${slug} (κ=${decision.concordance?.toFixed(3) ?? "n/a"})`,
      text: `Jury did not reach 2/3 majority on '${slug}' — needs human review.

Source: ${source}
Verdict: ${decision.verdict}
Majority: ${decision.majority}/3
Concordance κ: ${decision.concordance?.toFixed(3) ?? "n/a"}
Escalate flag: ${decision.shouldEscalate ? "YES" : "no"}

Votes:
${decision.votes.map(v => `  · ${v.model}: ${v.verdict} — ${v.rationale.slice(0, 200).replace(/\n/g, " ")}`).join("\n")}

Full decision: ${mdPath}

— Jury Triage CLI`,
    });
    console.log(`[jury-triage] ESCALATE notification sent to ${ownerEmail}`);
  } catch (e) {
    console.warn(`[jury-triage] ESCALATE notification failed (decision still logged at ${mdPath}): ${(e as Error).message}`);
  }
}

function writeDecisionMd(slug: string, source: string, issueText: string, decision: JuryDecision) {
  const today = new Date().toISOString().slice(0, 10);
  const path = join(DECISIONS_DIR, `${today}-${slug}.md`);
  const lines: string[] = [];
  lines.push(`# Jury Decision — ${slug}`);
  lines.push(``);
  lines.push(`- **When**: ${new Date().toISOString()}`);
  lines.push(`- **Source**: ${source}`);
  lines.push(`- **Verdict**: **${decision.verdict}** (majority ${decision.majority}/3)`);
  lines.push(`- **Concordance κ**: ${decision.concordance?.toFixed(3) ?? "n/a"}`);
  lines.push(`- **Fix-direction κ**: ${decision.fixConcordance != null ? decision.fixConcordance.toFixed(3) : "n/a"}`);
  lines.push(`- **Escalate**: ${decision.shouldEscalate ? "YES" : "no"}`);
  lines.push(`- **Latency**: ${decision.totalLatencyMs}ms`);
  lines.push(``);
  lines.push(`## Issue`);
  lines.push(``);
  lines.push("```");
  lines.push(issueText);
  lines.push("```");
  lines.push(``);
  lines.push(`## Votes`);
  lines.push(``);
  for (const v of decision.votes) {
    lines.push(`### ${v.model} (${v.provider}) — ${v.verdict}`);
    lines.push(``);
    lines.push(v.rationale);
    lines.push(``);
    if (v.fixProposal) {
      lines.push(`**Fix proposal:**`);
      lines.push(``);
      lines.push(v.fixProposal);
      lines.push(``);
    }
  }
  if (decision.fixProposal) {
    lines.push(`## Combined fix proposal (FIX-voting proposers)`);
    lines.push(``);
    lines.push(decision.fixProposal);
    lines.push(``);
  }
  lines.push(`## Aggregator synthesis`);
  lines.push(``);
  lines.push(decision.aggregatorAnswer);
  lines.push(``);
  writeFileSync(path, lines.join("\n"));
  return path;
}

async function triageOne(slug: string, source: string, issueText: string, dryRun: boolean): Promise<JuryDecision> {
  console.log(`\n=== Triage: ${slug} ===`);
  console.log(`Source: ${source}`);
  console.log(`Issue length: ${issueText.length} chars`);
  const t0 = Date.now();
  const decision = await juryTriage({
    issueText,
    tenantId: ADMIN_TENANT_ID,
    invokedVia: "cli-jury-triage",
  });
  const dt = Date.now() - t0;
  console.log(`Verdict: ${decision.verdict}  (majority ${decision.majority}/3, κ=${decision.concordance?.toFixed(3) ?? "n/a"}, ${dt}ms)`);
  for (const v of decision.votes) {
    console.log(`  · ${v.model}: ${v.verdict}  — ${v.rationale.slice(0, 140).replace(/\n/g, " ")}`);
  }
  if (dryRun) {
    console.log(`[dry-run] would have written decision to ${DECISIONS_DIR}/`);
    return decision;
  }
  ensureDirs();
  const mdPath = writeDecisionMd(slug, source, issueText, decision);
  console.log(`Wrote: ${mdPath}`);
  // R125+3.6+sec.1 — auto-apply seam (queue.json) is GATED behind JURY_AUTOAPPLY=1.
  // Default OFF protects forks / public-mirror users: the jury still votes and the
  // human-readable decision markdown is still written for review, but the
  // implementer-pickup seam stays dark unless explicitly opted-in. See
  // README "Autonomous pipelines disclaimer" + replit.md R125+3.6+sec.1 entry.
  // R125+13.3+sec (architect HIGH closed 2026-05-24): only FIX verdicts go
  // to the implementer queue. ACCEPT/REJECT are decisions that need no code
  // change (accept = ship, reject = block) and were polluting the queue,
  // which the implementer was treating as "fix me" tasks. ESCALATE goes
  // through notifyOwnerOnEscalate below (no queue write). Per replit.md
  // jury-decides-and-ships rule.
  // R125+13.7 (architect MEDIUM M4 closed 2026-05-24): sensitive-path denylist.
  // Even with JURY_AUTOAPPLY=1, a FIX proposal that mentions auth/payment/
  // safety/schema/token files must NOT auto-queue — those surfaces require
  // human review regardless of jury concordance. Route to owner-notification
  // and log a denylist-block entry instead of queueing for the implementer.
  // Mitigates: an attacker who can poison an LLM-generated fix proposal
  // (e.g. via inbox-ingest classification, capability-gap text) cannot get
  // the implementer to auto-write a diff against PIN/CSRF/Stripe/tenant
  // isolation code. Pattern matches paths *anywhere* in the proposal text.
  const SENSITIVE_PATH_PATTERNS = [
    /\bserver\/auth(\.ts|\b)/i,
    /\bserver\/replit_integrations\/auth\b/i,
    /\bserver\/middleware\/admin/i,
    /\bserver\/safety\//i,
    /\bserver\/safety-guard/i,
    /\bserver\/external-content-security/i,
    /\bserver\/routes\/stripe[\w-]*\.ts/i,
    /\bserver\/coinbase-commerce/i,
    /\bserver\/webhookHandlers/i,
    /\bserver\/routes\/gmail-direct/i,
    /\bserver\/lib\/gmail-direct-token/i,
    /\bshared\/schema\.ts/i,
    /\bshared\/models\/auth/i,
    /\bdrizzle(\/|\.config)/i,
    /\.env(\.|$)/i,
    /\bcreateCsrfMiddleware/i,
    /\bSESSION_SECRET|HITL_TOKEN_SECRET|ADMIN_PIN\b/i,
  ];
  const fixProposalText = decision.fixProposal || "";
  const denylistHits = SENSITIVE_PATH_PATTERNS
    .map(re => fixProposalText.match(re)?.[0])
    .filter((m): m is string => !!m);
  const blockedBySensitivePath = decision.verdict === "FIX" && denylistHits.length > 0;
  // R125+13.23 — Goodhart fragility guard (SIA-inspired, arXiv:2605.27276).
  // Even at a clean 2/3 FIX majority + JURY_AUTOAPPLY=1 + sensitive-path clear,
  // refuse to auto-queue when the FIX-voting proposers AGREE ON THE LABEL but
  // DISAGREE ON THE FIX (fix-direction concordance below a floor). That label-
  // strong / fix-divergent shape is precisely the coupled-verifier fragility
  // SIA documents: the verdict looks robust, the underlying change is not.
  // Route to owner-notification so a human picks the right fix.
  // Fail-OPEN: null concordance (single fix proposal, or embeddings down) does
  // NOT block — we never let a flaky embedding service stall auto-apply. Floor
  // is conservative (0.45) and env-tunable via JURY_FIX_CONCORDANCE_MIN so only
  // clearly-divergent fix sets are held back, minimizing false-positive ESCALATE.
  const FIX_CONCORDANCE_MIN = (() => {
    const raw = process.env.JURY_FIX_CONCORDANCE_MIN;
    const n = raw != null ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.45;
  })();
  const fixConcordance = decision.fixConcordance;
  const blockedByFixDivergence =
    decision.verdict === "FIX" &&
    !blockedBySensitivePath &&
    fixConcordance != null &&
    fixConcordance < FIX_CONCORDANCE_MIN;
  if (blockedBySensitivePath) {
    console.log(`[denylist] FIX verdict touches sensitive paths (${denylistHits.join(", ")}) — refusing to queue, routing to owner-notification instead.`);
    await notifyOwnerOnEscalate(slug, { ...decision, verdict: "ESCALATE", shouldEscalate: true } as JuryDecision, `${source}+sensitive-path-block`, mdPath);
  } else if (blockedByFixDivergence) {
    console.log(`[goodhart-guard] FIX verdict has divergent fix proposals (fix-direction κ=${fixConcordance!.toFixed(3)} < floor ${FIX_CONCORDANCE_MIN}) — proposers agree on the label but not the fix; refusing to auto-queue, routing to owner-notification instead.`);
    await notifyOwnerOnEscalate(slug, { ...decision, verdict: "ESCALATE", shouldEscalate: true } as JuryDecision, `${source}+fix-direction-divergence`, mdPath);
  } else if (decision.verdict === "FIX" && process.env.JURY_AUTOAPPLY === "1") {
    // HIGH-1 (fable-5): stamp the entry with an HMAC `_sig` (no-op when no
    // JURY_QUEUE_HMAC_SECRET is set) so the drainer's opt-in forgery gate
    // recognizes this as producer-authored.
    // MEDIUM closed 2026-06-10: append via the shared lock-coordinated store so a
    // concurrent producer/drainer write never clobbers this entry (the old
    // load→push→save was atomic per-write but not serialized across writers).
    appendQueueEntriesLocked([signQueueEntry({
      triagedAt: new Date().toISOString(),
      tenantId: ADMIN_TENANT_ID,
      source,
      issueSlug: slug,
      verdict: decision.verdict,
      majority: decision.majority,
      concordance: decision.concordance,
      fixConcordance: decision.fixConcordance ?? null,
      shouldEscalate: decision.shouldEscalate,
      fixProposal: decision.fixProposal,
      ...(decision.fixProposal ? { fixProposalUntrusted: true as const } : {}),
      votes: decision.votes.map(v => ({ model: v.model, verdict: v.verdict, rationale: v.rationale })),
    })]);
    console.log(`Queued FIX verdict for implementer pickup (JURY_AUTOAPPLY=1, fix-direction κ=${fixConcordance != null ? fixConcordance.toFixed(3) : "n/a"}).`);
  } else if (decision.verdict === "FIX") {
    console.log(`[gated] FIX verdict NOT queued — set JURY_AUTOAPPLY=1 to enable implementer-pickup seam. Decision log at ${mdPath} is still available for human review.`);
  } else {
    console.log(`Verdict ${decision.verdict} — no queue write (queue is FIX-only; ACCEPT/REJECT auto-decide, ESCALATE routes to owner-notification below).`);
  }
  // R125+12+sec (architect HIGH closed 2026-05-24): explicit ESCALATE → owner-notification dispatch.
  // R125+13.7 (M4 fix): skip the duplicate notification if the sensitive-path
  // denylist above already fired one for this decision.
  if (!blockedBySensitivePath && !blockedByFixDivergence && (decision.verdict === "ESCALATE" || decision.shouldEscalate)) {
    await notifyOwnerOnEscalate(slug, decision, source, mdPath);
  }
  return decision;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.source && !args.issue && !args.issueFile) {
    console.error("usage: jury-triage --source=gaps | --issue=TEXT | --issue-file=PATH [--limit=N] [--dry-run]");
    process.exit(2);
  }

  if (args.issue || args.issueFile) {
    let issueText: string;
    if (args.issue) {
      issueText = args.issue;
    } else {
      // R125+3.7+sec — path-traversal guard (architect LOW finding closure;
      // closure-pass v2 fixed the ESM `require is not defined` regression by
      // using the top-of-file `node:path` import instead). Operator-only CLI,
      // but reject paths outside the repo root + reject `..` segments so an
      // attacker-suggested path can't exfiltrate /etc/passwd (or a private
      // key, .env, etc.) into a frontier-model prompt.
      const repoRoot = process.cwd();
      const resolved = resolve(repoRoot, args.issueFile!);
      if (!resolved.startsWith(repoRoot + sep) && resolved !== repoRoot) {
        console.error(`[jury-triage] --issue-file refused: path '${args.issueFile}' resolves outside repo root '${repoRoot}'`);
        process.exit(2);
      }
      if (args.issueFile!.split(/[\\/]/).includes("..")) {
        console.error(`[jury-triage] --issue-file refused: path contains '..' segment`);
        process.exit(2);
      }
      issueText = readFileSync(resolved, "utf8");
    }
    const slug = (args.issueFile ? args.issueFile.split("/").pop()?.replace(/\.[^.]+$/, "") : "adhoc") || "adhoc";
    await triageOne(slug, args.issue ? "cli-adhoc" : `file:${args.issueFile}`, issueText, args.dryRun);
    process.exit(0);
  }

  if (args.source === "gaps") {
    const gaps = extractGaps();
    const target = args.limit ? gaps.slice(0, args.limit) : gaps;
    console.log(`Triaging ${target.length} open gap(s) from ${GAPS_DOC}`);
    const summary: { slug: string; verdict: string; majority: number }[] = [];
    for (const g of target) {
      try {
        const d = await triageOne(g.slug, `${GAPS_DOC}#${g.slug}`, g.text, args.dryRun);
        summary.push({ slug: g.slug, verdict: d.verdict, majority: d.majority });
      } catch (e) {
        console.error(`[jury-triage] failed on ${g.slug}:`, (e as Error).message);
        summary.push({ slug: g.slug, verdict: "ERROR", majority: 0 });
      }
    }
    console.log(`\n=== SUMMARY (${summary.length} issues) ===`);
    for (const s of summary) console.log(`  ${s.verdict.padEnd(9)} ${s.majority}/3  ${s.slug}`);
    process.exit(0);
  }

  console.error(`unknown --source=${args.source}`);
  process.exit(2);
}

main().catch(e => {
  console.error("[jury-triage] fatal:", (e as Error).stack || (e as Error).message);
  process.exit(1);
});
