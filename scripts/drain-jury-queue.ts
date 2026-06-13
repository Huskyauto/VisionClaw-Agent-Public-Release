/**
 * Jury FIX-queue drainer — closes the jury → implement → repo-surgeon loop.
 *
 * `jury_triage` (and the CI self-healer) write FIX verdicts to
 * `data/jury-decisions/queue.json` when JURY_AUTOAPPLY=1, but NOTHING consumed
 * them — the queue was write-only, so a jury-approved FIX never reached an
 * implementer. This drainer reads the queue and routes each unprocessed FIX
 * entry through `captureIncident()` — the SAME seam the CI self-healer uses — so
 * it inherits every existing guard rather than re-implementing (or weakening)
 * any of them:
 *
 *   · mapJuryDecision: ONLY a unanimous (3/3) FIX with no escalation flag and
 *     adequate fix-concordance routes to repo_surgeon; a 2/3 split / shouldEscalate
 *     / low concordance escalates to the owner instead of auto-fixing.
 *   · sensitive-path FIX verdicts are already kept OUT of the queue at write time;
 *     we also skip any entry tagged sensitive here as belt-and-braces.
 *   · dispatchIncidentRemedy gates the actual code-apply behind REPAIR_AUTOFIX_ENABLED
 *     (fails CLOSED — records "autofix_disabled" if the flag is off).
 *   · repo-surgeon runs typecheck/test, lands or rolls back, enforces the
 *     2-failed-attempt stop, and escalates every non-landed terminal outcome.
 *
 * This script NEVER applies code itself — it only feeds the existing pipeline.
 * Idempotent: each handled entry is stamped `_drained` and skipped next run; a
 * transient capture failure is left un-stamped so it retries.
 *
 * Usage: npx tsx scripts/drain-jury-queue.ts [--once]
 *   JURY_AUTOAPPLY=1            jury-triage / CI-healer actually write the queue
 *   REPAIR_AUTOFIX_ENABLED=1    repo-surgeon actually applies (else recorded only)
 *   JURY_DRAIN_POLL_SECONDS     loop interval (default 300)
 *   JURY_DRAIN_TENANT_ID        tenant for captured incidents (default 1)
 */
import { sql } from "drizzle-orm";
import { claimAutonomousBudget } from "../server/agentic/autonomous-budget";
import {
  getQueueSecret,
  verifyQueueEntry,
  effectiveSecurityCoreAllowed,
  entryFingerprint,
} from "../server/agentic/jury-queue-integrity";
// Shared, lock-coordinated queue IO (MEDIUM closed 2026-06-10): every reader and
// writer of queue.json goes through this so overlapping read-modify-writes are
// serialized (no last-writer-wins append loss). QUEUE_PATH is re-exported here.
import { QUEUE_PATH, readQueueRaw, mutateQueue } from "../server/agentic/jury-queue-store";
const POLL_SECONDS = Math.max(30, parseInt(process.env.JURY_DRAIN_POLL_SECONDS || "300", 10) || 300);
// Fallback tenant for LEGACY queue entries written before per-entry tenantId
// stamping. New entries carry their own tenantId (the tenant whose jury voted);
// this only catches pre-existing rows so they don't get dropped.
const DEFAULT_TENANT_ID = Math.max(1, parseInt(process.env.JURY_DRAIN_TENANT_ID || "1", 10) || 1);
// Coarse per-entry spend reservation (routing one FIX drives the jury, ~jury cost).
const EST_USD = Math.max(0.01, parseFloat(process.env.JURY_DRAIN_EST_USD || "1") || 1);
// THUNDERING-HERD GUARDS (learned the hard way: a write-only queue accreted 200+
// historical FIX verdicts; the first drain routed them ALL at once — a burst of
// repo-surgeon LLM calls + owner escalations). Two bounds keep the loop civilised:
//   · per-run cap: route at most N entries per poll, leave the rest UN-stamped so
//     the next tick picks them up (a 200-deep backlog drains gradually, not at once).
//   · recency window: entries older than maxAgeDays are backfill-SKIPPED (stamped
//     drained, NEVER routed) — stale fix proposals against long-since-changed code
//     would only fail repo-surgeon's typecheck gate and waste a jury-cost call.
const MAX_PER_RUN = Math.max(1, parseInt(process.env.JURY_DRAIN_MAX_PER_RUN || "5", 10) || 5);
const MAX_AGE_DAYS = Math.max(0, parseInt(process.env.JURY_DRAIN_MAX_AGE_DAYS || "30", 10) || 0);

export interface JuryQueueEntry {
  triagedAt?: string;
  /** the tenant whose jury produced this verdict — set by the producer; legacy
   *  entries omit it and fall back to DEFAULT_TENANT_ID at drain time. */
  tenantId?: number;
  source?: string;
  issueSlug?: string;
  verdict?: string;
  majority?: number;
  concordance?: number;
  fixConcordance?: number;
  shouldEscalate?: boolean;
  fixProposal?: string;
  fixProposalUntrusted?: boolean;
  votes?: Array<{ model: string; verdict: string; rationale?: string }>;
  /** Audit-sourced autopilot fields — set ONLY by scripts/tenant-isolation-audit.ts.
   *  securityCoreAllowed (honored only WITH auditSourced) lets repo-surgeon skip
   *  the HITL pause for a non-hard app-source surface, gated again by env
   *  SECURITY_CORE_AUTOFIX. candidateFiles pins the finding's target file. */
  auditSourced?: boolean;
  securityCoreAllowed?: boolean;
  candidateFiles?: string[];
  /** HMAC integrity stamp set by the producer (jury-queue-integrity.signQueueEntry)
   *  when JURY_QUEUE_HMAC_SECRET is configured. Absent on legacy/unsigned entries. */
  _sig?: string;
  _drained?: boolean;
  _drainedAt?: string;
  _outcome?: string;
}

/** Sensitive entries must never auto-route to the implementer (defense in depth —
 *  jury-triage already keeps them out of the queue, this is belt-and-braces). */
export function isSensitive(e: JuryQueueEntry): boolean {
  return /sensitive-path-block/i.test(e.source || "") || /sensitive-path-block/i.test(e.issueSlug || "");
}

/** Pure routing decision for a single entry — unit-testable without IO.
 *  `maxAgeDays > 0` backfill-skips stale entries (route:false, reason "stale") so a
 *  historical pile is cleared without ever firing repo-surgeon on outdated context. */
export function decideEntry(
  e: JuryQueueEntry,
  opts?: { now?: number; maxAgeDays?: number },
): { route: boolean; reason: string } {
  if (e._drained) return { route: false, reason: "already-drained" };
  if (e.verdict !== "FIX") return { route: false, reason: `non-FIX:${e.verdict || "none"}` };
  if (isSensitive(e)) return { route: false, reason: "sensitive-path" };
  if (!e.fixProposal || !e.fixProposal.trim()) return { route: false, reason: "empty-proposal" };
  const maxAgeDays = opts?.maxAgeDays ?? 0;
  if (maxAgeDays > 0 && e.triagedAt) {
    const ageMs = (opts?.now ?? Date.now()) - Date.parse(e.triagedAt);
    if (Number.isFinite(ageMs) && ageMs > maxAgeDays * 86_400_000) {
      return { route: false, reason: "stale" };
    }
  }
  return { route: true, reason: "fix" };
}

/** Resolve the tenant an entry routes + bills under.
 *
 *  FAIL-CLOSED (HIGH, fable-5 whole-app review 2026-06-10): `tenantId` steers the
 *  per-tenant budget claim AND the captureIncident tenant scope, and it lives in
 *  the app-writable `queue.json`. A stamped `tenantId` is therefore honored ONLY
 *  when the entry's HMAC signature verifies (`tenantId` is inside the signed
 *  canonical set — see jury-queue-integrity.ts). Without a verified signature
 *  (no `JURY_QUEUE_HMAC_SECRET` configured, or an unsigned/forged entry) we refuse
 *  to route under a caller-chosen tenant and fall back to the global admin tenant.
 *  This is strictly safer: a forged cross-tenant entry can only ever cost the owner
 *  (the fallback tenant), never bill or write an incident into a victim tenant.
 *  Trade-off: in the default (no-secret) config every entry routes to the fallback
 *  tenant — which is correct today (autonomous loops are owner-tenant-only); genuine
 *  per-tenant routing requires enabling the queue HMAC secret. */
export function resolveEntryTenant(
  e: JuryQueueEntry,
  sigValid: boolean,
): { tenant: number; source: "signed" | "fallback-unverified" | "fallback-legacy" } {
  const t = Number(e.tenantId);
  const hasTenant = Number.isFinite(t) && t > 0;
  if (hasTenant && sigValid) return { tenant: t, source: "signed" };
  if (hasTenant && !sigValid) return { tenant: DEFAULT_TENANT_ID, source: "fallback-unverified" };
  return { tenant: DEFAULT_TENANT_ID, source: "fallback-legacy" };
}

// ── Replay-proof processed-entry ledger (HIGH-1 residual closure) ─────────────
// The DB (`jury_drain_ledger`) is the authoritative, out-of-tree store the
// app-writable queue.json cannot forge. `entry_key` is the secret-independent
// content fingerprint (jury-queue-integrity.entryFingerprint). The claim is
// intentionally GLOBAL (not tenant-scoped): replay protection is content-based —
// an entry processed under ANY tenant must never be replayable under another.
// `db` is passed in (lazy-imported in drainOnce) so importing this module for the
// pure-helper unit tests never opens a pg pool (node:test would hang otherwise).
//
// CLAIM-FIRST (MEDIUM closed 2026-06-10, Bob-approved): the old code did a
// check-then-act — read `ledgerHas`, then (much later, after a slow
// captureIncident) `ledgerRecord`. Two overlapping drainers could BOTH pass the
// existence check and BOTH route the same entry before either recorded it (a
// classic TOCTOU). `ledgerClaim` collapses check+record into ONE atomic write:
// `INSERT … ON CONFLICT DO NOTHING RETURNING id` — only one caller can win the
// unique-key insert; the loser gets no row back and is REPLAY BLOCKED. The row's
// mere existence IS the claim, so it must be inserted BEFORE the spend/route and
// RELEASED (deleted) if the route never completes, else a transient failure would
// be permanently mistaken for "already processed". A bounded STALE-CLAIM RECLAIM
// (see below) recovers the rare case where that release itself fails, WITHOUT
// reopening the replay window (completed rows are never reclaimable).

// STALE-CLAIM RECLAIM (MEDIUM closed 2026-06-10, architect follow-up): a pure
// "never reclaim" policy had an entry-LOSS hole — if `ledgerRelease` fails (a
// transient DELETE error, or a crash) on a route that did NOT complete, the
// orphaned `outcome='claimed'` row makes every later poll mistake the entry for a
// replay and stamp it `skipped:replay-ledger` FOREVER. We reclaim ONLY a STALE,
// still-`claimed` (never-completed) orphan. This does NOT reopen the replay window:
// a COMPLETED row has `outcome != 'claimed'` and is NEVER reclaimable, so a
// legitimately-processed fix can never be re-routed. CLAIM_STALE_SECONDS sits far
// above the worst-case per-entry route time so a live drainer is never stolen, and
// the conditional `UPDATE … RETURNING` is atomic so two racing reclaimers can't
// both win.

/** A claim that goes stale after this many seconds is treated as an orphan (owner
 *  crashed or its release failed) and may be reclaimed. Far above worst-case route time. */
const CLAIM_STALE_SECONDS = 30 * 60; // 30 min

export type ClaimResult = "won" | "replay" | "held";

const rowsOf = (res: any): any[] => {
  const r = (res as any)?.rows ?? res;
  return Array.isArray(r) ? r : [];
};

/** Atomically claim an entry for processing.
 *  - `"won"`    → THIS caller owns it (fresh insert OR reclaimed stale orphan) → route.
 *  - `"replay"` → a COMPLETED row exists (or nothing reclaimable) → genuinely processed → block.
 *  - `"held"`   → a fresh (not-yet-stale) claim is held by a peer → defer & retry
 *                 (it becomes reclaimable once stale, so the entry is never lost). */
export async function ledgerClaim(
  db: any,
  args: { entryKey: string; tenantId: number; issueSlug?: string },
): Promise<ClaimResult> {
  // 1) Fresh claim — wins iff no row yet exists for this fingerprint.
  const ins: any = await db.execute(
    sql`INSERT INTO jury_drain_ledger (tenant_id, entry_key, issue_slug, outcome)
        VALUES (${args.tenantId}, ${args.entryKey}, ${args.issueSlug ?? null}, ${"claimed"})
        ON CONFLICT (entry_key) DO NOTHING
        RETURNING id`,
  );
  if (rowsOf(ins).length > 0) return "won";

  // 2) Conflict — reclaim ONLY a STALE, still-'claimed' orphan (never a completed row).
  const reclaimed: any = await db.execute(
    sql`UPDATE jury_drain_ledger
        SET drained_at = now(), tenant_id = ${args.tenantId}, issue_slug = ${args.issueSlug ?? null}
        WHERE entry_key = ${args.entryKey}
          AND outcome = ${"claimed"}
          AND drained_at < now() - make_interval(secs => ${CLAIM_STALE_SECONDS})
        RETURNING id`,
  );
  if (rowsOf(reclaimed).length > 0) return "won";

  // 3) Distinguish a genuinely-processed entry (replay → block) from a fresh claim
  //    a peer currently holds (held → defer, becomes reclaimable once stale).
  const existing: any = await db.execute(
    sql`SELECT outcome FROM jury_drain_ledger WHERE entry_key = ${args.entryKey} LIMIT 1`,
  );
  const row = rowsOf(existing)[0];
  // No row at all is AMBIGUOUS, not proof-of-completion: a peer can have won the
  // claim (so our INSERT saw a conflict) and then `ledgerRelease`d it (DELETE) in
  // the window before this SELECT. Returning "replay" here would permanently
  // skip-stamp a legitimately-retryable entry → lost entry. Fail SAFE to "held":
  // defer and retry next poll, where our own INSERT will win cleanly.
  if (!row) return "held";
  // A still-'claimed' row = a peer's fresh (not-yet-stale) claim → defer (becomes
  // reclaimable once stale). Any other (terminal) outcome = genuinely processed → block.
  return row.outcome === "claimed" ? "held" : "replay";
}

/** Release a claim the route did NOT complete (budget refused / capture threw) so
 *  the entry retries next poll. Idempotent. */
export async function ledgerRelease(db: any, entryKey: string): Promise<void> {
  await db.execute(sql`DELETE FROM jury_drain_ledger WHERE entry_key = ${entryKey}`);
}

/** Mark a won claim as permanently processed (records the route outcome). The row
 *  already exists from `ledgerClaim`; this only annotates it. */
export async function ledgerComplete(db: any, entryKey: string, outcome: string): Promise<void> {
  await db.execute(
    sql`UPDATE jury_drain_ledger SET outcome = ${outcome}, drained_at = now() WHERE entry_key = ${entryKey}`,
  );
}

export async function drainOnce(): Promise<{ processed: number; routed: number; skipped: number; total: number }> {
  // Lock-free snapshot — the slow capture loop runs against this; the final
  // write-back re-reads UNDER the lock and merges (see end of drainOnce) so any
  // producer append landing during the drain is preserved, not clobbered.
  const entries = readQueueRaw<JuryQueueEntry>();
  let processed = 0;
  let routed = 0;
  let skipped = 0;

  if (entries.length === 0) {
    console.log("[jury-drain] queue empty — nothing to do");
    return { processed, routed, skipped, total: 0 };
  }

  const { captureIncident } = await import("../server/agentic/repair-incident");
  // Lazy DB import so importing this module for the pure-helper unit tests never
  // opens a pg pool at load time (node:test would hang on an open pool).
  const { db } = await import("../server/db");
  let dirty = false;

  // HIGH-1 (fable-5 review of R125+52.9): queue.json is app-writable, so the
  // drainer must not treat its fields as authorization on trust alone.
  //   · When JURY_QUEUE_HMAC_SECRET is configured, EVERY routed entry must carry
  //     a valid `_sig` — unsigned/tampered entries are skipped (fail closed).
  //     When it is NOT configured this gate is inert (backward compatible).
  //   · The securityCoreAllowed HITL-skip privilege is FAIL-CLOSED regardless:
  //     it is forwarded ONLY against a verified signature (see
  //     effectiveSecurityCoreAllowed), so absent a configured secret + valid sig
  //     the privilege is stripped and the fix falls back to owner HITL.
  const queueSecret = getQueueSecret();
  if (queueSecret) {
    console.log("[jury-drain] queue HMAC integrity ENFORCED (JURY_QUEUE_HMAC_SECRET set) — unsigned/tampered entries will be skipped");
  }

  for (const e of entries) {
    // Per-run cap: once we've routed MAX_PER_RUN this tick, stop routing and leave
    // the remaining routable entries UN-stamped so the next poll continues the drain.
    if (routed >= MAX_PER_RUN) {
      console.log(`[jury-drain] per-run cap (${MAX_PER_RUN}) reached — ${entries.length - (processed + skipped)} routable entr(ies) deferred to next poll`);
      break;
    }
    const decision = decideEntry(e, { maxAgeDays: MAX_AGE_DAYS });
    if (!decision.route) {
      // Stamp non-routable entries (except transient) so we don't re-evaluate
      // them every poll. ACCEPT/REJECT auto-apply is handled at jury-triage time;
      // ESCALATE already reached the owner; sensitive/empty are deliberate skips.
      if (!e._drained) {
        e._drained = true;
        e._drainedAt = new Date().toISOString();
        e._outcome = `skipped:${decision.reason}`;
        dirty = true;
      }
      skipped++;
      continue;
    }

    // HIGH-1 forgery gate (opt-in): when a queue secret is configured, only
    // producer-signed entries may route. An unsigned/tampered entry is stamped
    // skipped (fail closed) so it never reaches the implementer and never re-runs.
    const sigValid = queueSecret ? verifyQueueEntry(e, queueSecret) : false;
    if (queueSecret && !sigValid) {
      if (!e._drained) {
        e._drained = true;
        e._drainedAt = new Date().toISOString();
        e._outcome = "skipped:unsigned-or-tampered";
        dirty = true;
      }
      console.warn(`[jury-drain] DROPPED unsigned/tampered entry "${(e.issueSlug || e.source || "").slice(0, 60)}" — HMAC integrity enforced but signature ${e._sig ? "invalid" : "absent"}`);
      skipped++;
      continue;
    }

    // Per-entry tenant: route + bill each FIX under the tenant whose jury voted,
    // not one global tenant. FAIL-CLOSED — a stamped tenantId is honored ONLY
    // when the signature verifies (see resolveEntryTenant); a forged/unsigned
    // tenantId is refused and falls back to the global admin tenant.
    const { tenant: entryTenant, source: tenantSource } = resolveEntryTenant(e, sigValid);
    if (tenantSource === "fallback-unverified") {
      console.warn(`[jury-drain] entry "${(e.issueSlug || "").slice(0, 60)}" carries an UNVERIFIED tenantId (${e.tenantId}) — refusing to route under it, using fallback tenant ${entryTenant}`);
    } else if (tenantSource === "fallback-legacy") {
      console.warn(`[jury-drain] legacy entry "${(e.issueSlug || "").slice(0, 60)}" has no tenantId — using fallback tenant ${entryTenant}`);
    }

    // HIGH-1 RESIDUAL closure (fable-5 review of R125+52.9): the `_drained`
    // bookkeeping in the app-writable queue.json is UNSIGNED, so a file-write
    // primitive can flip a processed entry's `_drained` back to false and REPLAY a
    // legitimately-signed past fix (re-spending + re-routing it). The DB
    // processed-ledger is the authoritative, out-of-tree replay guard, keyed on the
    // entry's secret-independent content fingerprint.
    //
    // CLAIM-FIRST (MEDIUM closed 2026-06-10): atomically CLAIM the entry here —
    // ONE INSERT that both checks (ON CONFLICT) and records (the new row). This
    // replaces the old read-then-(much-later)-record, eliminating the multi-drainer
    // TOCTOU where two runs both passed an existence check and both routed. The
    // claim sits BEFORE the budget reservation so a replay never even spends.
    // FAIL-CLOSED: a claim ERROR defers the entry (leave `_drained` unset → retry
    // next poll) rather than risk a double-route. The claim is tri-state: "won" →
    // route; "replay" (a COMPLETED row exists) → stamp + skip; "held" (a fresh peer
    // claim) → defer WITHOUT stamping so it retries (and reclaims once stale). From
    // here on, any path that does NOT complete the route MUST `ledgerRelease`.
    const entryKey = entryFingerprint(e);
    let claimResult: ClaimResult;
    try {
      claimResult = await ledgerClaim(db, { entryKey, tenantId: entryTenant, issueSlug: e.issueSlug });
    } catch (err) {
      console.error(
        `[jury-drain] replay-ledger claim failed for "${(e.issueSlug || "").slice(0, 60)}": ${(err as Error).message} — deferring (fail-closed)`,
      );
      continue;
    }
    if (claimResult === "replay") {
      // A COMPLETED ledger row exists → genuinely processed → block (stamp so we
      // don't re-evaluate). This is the replay guard doing its job.
      if (!e._drained) {
        e._drained = true;
        e._drainedAt = new Date().toISOString();
        e._outcome = "skipped:replay-ledger";
        dirty = true;
      }
      console.warn(
        `[jury-drain] REPLAY BLOCKED: entry "${(e.issueSlug || "").slice(0, 60)}" fingerprint already processed — refusing to re-route (queue _drained was cleared or a duplicate entry)`,
      );
      skipped++;
      continue;
    }
    if (claimResult === "held") {
      // A fresh (not-yet-stale) claim is held by another run/drainer. Do NOT stamp —
      // leave the entry un-drained so it retries; once the held claim goes stale it
      // becomes reclaimable, so a stuck/crashed peer can never lose this entry.
      console.warn(
        `[jury-drain] claim HELD by a concurrent run for "${(e.issueSlug || "").slice(0, 60)}" — deferring (will reclaim if it goes stale)`,
      );
      skipped++;
      continue;
    }

    // Autonomous-spend governor (atomic claim-before-spend): routing drives the
    // jury (paid), so RESERVE this tenant's estimate BEFORE the spend. A claim
    // that would breach the tenant's cap is refused — RELEASE the ledger claim and
    // leave the entry UN-stamped so it retries when budget frees, and continue so
    // OTHER tenants' entries still drain (one tenant's cap never blocks the queue).
    // The budget claim itself can throw (DB hiccup). If it does, the won ledger
    // claim above is orphaned — RELEASE it before deferring so the entry retries
    // cleanly next poll instead of waiting out the stale-reclaim TTL.
    let claim: Awaited<ReturnType<typeof claimAutonomousBudget>>;
    try {
      claim = await claimAutonomousBudget({ tenantId: entryTenant, estimatedUsd: EST_USD, label: "jury-drain" });
    } catch (err) {
      await ledgerRelease(db, entryKey).catch((rerr) =>
        console.error(`[jury-drain] ledger release (budget-threw) failed for "${(e.issueSlug || "").slice(0, 60)}": ${(rerr as Error).message}`),
      );
      console.error(
        `[jury-drain] budget claim threw for "${(e.issueSlug || "").slice(0, 60)}": ${(err as Error).message} — released claim, deferring`,
      );
      continue;
    }
    if (!claim.ok) {
      await ledgerRelease(db, entryKey).catch((err) =>
        console.error(`[jury-drain] ledger release (budget-deferred) failed for "${(e.issueSlug || "").slice(0, 60)}": ${(err as Error).message}`),
      );
      console.warn(
        `[jury-drain] budget gate for tenant ${entryTenant}: ${claim.reason} (spent $${claim.spentUsd.toFixed(2)} / cap $${claim.capUsd.toFixed(2)}) — released claim, deferring this entry`,
      );
      continue;
    }

    try {
      // Feed the exact shape mapJuryDecision reads. aggregatorAnswer carries the
      // NL fix proposal so the unanimous-FIX path has context for repo-surgeon.
      const precomputedJury = {
        verdict: e.verdict,
        majority: Number(e.majority) || 0,
        concordance: e.concordance,
        fixConcordance: e.fixConcordance,
        shouldEscalate: e.shouldEscalate === true,
        fixProposal: e.fixProposal,
        aggregatorAnswer: e.fixProposal,
        votes: e.votes || [],
      };

      const cap: any = await captureIncident({
        tenantId: entryTenant,
        source: "jury_queue",
        title: `Jury FIX: ${(e.issueSlug || e.source || "proposal").slice(0, 160)}`,
        signature: `jury:${e.issueSlug || e.triagedAt || "entry"}`,
        error: (e.fixProposal || "jury-approved fix proposal").slice(0, 4000),
        logs: e.fixProposal || "",
        stage: "jury",
        precomputedJury,
        candidateFiles:
          Array.isArray(e.candidateFiles) && e.candidateFiles.length ? e.candidateFiles : undefined,
        // securityCoreAllowed (the HITL-skip privilege) is FAIL-CLOSED: honored
        // ONLY for a genuinely audit-sourced entry whose HMAC signature verifies
        // (effectiveSecurityCoreAllowed). No configured secret OR no/bad `_sig`
        // ⇒ privilege stripped ⇒ the fix falls back to owner HITL.
        securityCoreAllowed: effectiveSecurityCoreAllowed(e, sigValid),
        metadata: {
          issueSlug: e.issueSlug,
          triagedAt: e.triagedAt,
          source: e.source,
          fixProposalUntrusted: e.fixProposalUntrusted === true,
          auditSourced: e.auditSourced === true,
        },
      });

      const routedTo = cap?.result?.routedTo || cap?.routedTo || "captured";
      e._drained = true;
      e._drainedAt = new Date().toISOString();
      e._outcome = `captured:${routedTo}`;
      dirty = true;
      // Finalize the claim to a TERMINAL (non-'claimed') outcome. This is NOT just
      // observability: a row left at outcome='claimed' becomes reclaimable once it
      // goes stale, so a successfully-routed entry whose finalize silently failed
      // could be re-routed by stale-reclaim after a replay-cleared _drained flip.
      // Retry with bounded backoff so the terminal outcome is reached reliably; if
      // ALL attempts fail, log CRITICAL (the entry is still _drained in the queue,
      // so normal flow won't re-route it — only the narrow tamper+stale window
      // remains, and it now demands operator attention).
      let finalized = false;
      for (let attempt = 1; attempt <= 3 && !finalized; attempt++) {
        try {
          await ledgerComplete(db, entryKey, e._outcome);
          finalized = true;
        } catch (err) {
          console.error(
            `[jury-drain] finalize attempt ${attempt}/3 failed for "${(e.issueSlug || "").slice(0, 60)}": ${(err as Error).message}`,
          );
          if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * attempt));
        }
      }
      if (!finalized) {
        console.error(
          `[jury-drain] CRITICAL: routed entry "${(e.issueSlug || "").slice(0, 60)}" left at ledger outcome='claimed' after 3 finalize attempts — stale-reclaim could re-route it after ${CLAIM_STALE_SECONDS}s; manual ledgerComplete needed.`,
        );
      }
      processed++;
      routed++;
      console.log(`[jury-drain] routed FIX (${e.majority}/3) "${(e.issueSlug || "").slice(0, 60)}" → ${e._outcome}`);
    } catch (err) {
      // Route did NOT complete — RELEASE the claim and leave _drained UNSET so the
      // transient failure retries next poll (without the release, the claim row
      // would permanently mask the entry as "already processed").
      await ledgerRelease(db, entryKey).catch((rerr) =>
        console.error(`[jury-drain] ledger release (capture-failed) failed for "${(e.issueSlug || "").slice(0, 60)}": ${(rerr as Error).message}`),
      );
      console.error(`[jury-drain] capture failed for "${e.issueSlug}": ${(err as Error).message}`);
    }
  }

  if (dirty) {
    // Persist our `_drained` stamps by RE-READING under the lock and merging, so a
    // producer append that landed during the (slow) capture loop above is NOT
    // clobbered by our stale in-memory snapshot. Match by content fingerprint
    // (stable across `_drained` bookkeeping). Appends absent from our stamp map
    // are left untouched and survive.
    const stamps = new Map<string, JuryQueueEntry>();
    for (const e of entries) {
      if (e._drained) stamps.set(entryFingerprint(e), e);
    }
    mutateQueue((current: JuryQueueEntry[]) => {
      for (const c of current) {
        if (c._drained) continue;
        const s = stamps.get(entryFingerprint(c));
        if (s) {
          c._drained = s._drained;
          c._drainedAt = s._drainedAt;
          c._outcome = s._outcome;
        }
      }
    });
  }
  console.log(`[jury-drain] done: processed=${processed} routed=${routed} skipped=${skipped} total=${entries.length}`);
  return { processed, routed, skipped, total: entries.length };
}

async function main() {
  const oneshot = process.argv.includes("--once");
  console.log(
    `[jury-drain] start (queue=${QUEUE_PATH}, oneshot=${oneshot}, autofix=${process.env.REPAIR_AUTOFIX_ENABLED === "1" ? "ON" : "OFF"})`,
  );
  if (process.env.JURY_AUTOAPPLY !== "1") {
    console.warn(
      "[jury-drain] JURY_AUTOAPPLY!=1 — jury-triage/CI-healer are NOT writing the queue; the drainer will idle until it's enabled.",
    );
  }

  if (oneshot) {
    await drainOnce();
    process.exit(0);
  }

  for (;;) {
    try {
      await drainOnce();
    } catch (e) {
      console.error(`[jury-drain] tick failed: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  }
}

// Only run when invoked directly (so tests can import the pure helpers safely).
if (process.argv[1] && /drain-jury-queue/.test(process.argv[1])) {
  main().catch((e) => {
    console.error("[jury-drain] fatal:", e);
    process.exit(1);
  });
}
