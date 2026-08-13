/**
 * Durable knowledge triples — ADMIN-TENANT PILOT (Bob 2026-08-10).
 *
 * The autoresearch engine already extracts an in-memory evidence graph of
 * (subject | predicate | object) triples during every session and throws it
 * away at session end. This module persists those triples for the ADMIN
 * tenant only, and re-seeds future sessions whose objective shares key terms
 * — a cheap cross-session knowledge graph built entirely from extraction the
 * platform already pays for.
 *
 * Posture (mirrors falsified-routes/episode-playbooks):
 * - ADVISORY + fail-open: a persistence or load failure never blocks a session.
 * - Writer-side ADMIN gate: only tenantId === ADMIN_TENANT_ID rows are ever
 *   written (pilot scope). Reads are tenant-scoped as usual.
 * - Sanitize at write AND at render (triples carry text derived from untrusted
 *   web/tool output).
 *
 * Pilot exit criteria (see .agents/memory/graph-engineering-synthesis-verdict.md):
 * expand beyond admin only if durable triples demonstrably answer relational
 * questions the embedding store misses.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";
import { ADMIN_TENANT_ID } from "./tenant-constants";
import { sanitizeUntrustedRouteText } from "./falsified-routes";
import { logSilentCatch } from "./lib/silent-catch";

const MAX_SUBJECT_LEN = 200;
const MAX_PREDICATE_LEN = 100;
const MAX_OBJECT_LEN = 200;
const MAX_TRIPLES_PER_SESSION = 100;
const MAX_AGE_DAYS = 90;
const MAX_SEED_TRIPLES = 50;
const RECENT_SCAN_LIMIT = 400;
const MAX_ROWS_PER_TENANT = 5000;

/**
 * Strict field sanitizer for durable prompt-adjacent content (review fix):
 * sanitizeUntrustedRouteText (control chars, backticks, role-prefix defang)
 * PLUS a conservative charset allowlist — anything outside it becomes a space.
 * Downstream sinks add their own layer (evidence-graph's groundingSummary
 * re-sanitizes to a 60-char conservative fragment before any prompt), but the
 * store itself should never hold exotic delimiters or markup either.
 */
export function sanitizeTripleField(raw: unknown, maxLen: number): string {
  const s = sanitizeUntrustedRouteText(raw, maxLen * 2);
  return s
    .replace(/[^a-zA-Z0-9 ,.\-_/%$()+#:'&]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

// Idempotent bootstrap (same pattern as falsified-routes: dev created via
// direct SQL because drizzle-kit push needs a TTY; prod gets it on first use).
let _tableEnsured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!_tableEnsured) {
    _tableEnsured = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS research_evidence_triples (
          id serial PRIMARY KEY,
          tenant_id integer NOT NULL,
          subject text NOT NULL,
          predicate text NOT NULL,
          object text NOT NULL,
          norm_key text NOT NULL,
          seen_count integer NOT NULL DEFAULT 1,
          hit_count integer NOT NULL DEFAULT 0,
          last_hit_at timestamp,
          source_session_id integer,
          created_at timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ret_tenant ON research_evidence_triples(tenant_id)`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_ret_tenant_norm ON research_evidence_triples(tenant_id, norm_key)`);
    })().catch((err) => {
      _tableEnsured = null; // retry on next call rather than caching the failure
      throw err;
    });
  }
  return _tableEnsured;
}

export interface DurableTriple {
  subject: string;
  predicate: string;
  object: string;
  seenCount: number;
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Persist a finished session's evidence triples. Fire-and-forget; ADMIN-ONLY
 * writer gate (pilot) — silently skips every other tenant.
 */
export function persistSessionTriples(params: {
  tenantId: number;
  sessionId: number;
  triples: Array<{ subject: string; predicate: string; object: string }>;
}): void {
  const { tenantId, sessionId, triples } = params;
  if (tenantId !== ADMIN_TENANT_ID) return; // pilot: admin tenant only
  if (!Array.isArray(triples) || triples.length === 0) return;

  (async () => {
    try {
      await ensureTable();
      const clean = triples
        .slice(0, MAX_TRIPLES_PER_SESSION)
        .map((t) => ({
          subject: sanitizeTripleField(t.subject, MAX_SUBJECT_LEN),
          predicate: sanitizeTripleField(t.predicate, MAX_PREDICATE_LEN),
          object: sanitizeTripleField(t.object, MAX_OBJECT_LEN),
        }))
        .filter((t) => t.subject && t.predicate && t.object);
      if (clean.length === 0) return;

      // Dedup within the batch on normalized identity.
      const byKey = new Map<string, typeof clean[number]>();
      for (const t of clean) {
        byKey.set(`${normalizeKey(t.subject)}|${normalizeKey(t.predicate)}|${normalizeKey(t.object)}`, t);
      }

      // Atomic UPSERT dedup (review fix: no check-then-insert race). A
      // reinforcement refreshes created_at ("last confirmed") so recurring
      // facts never age out of the read window.
      let written = 0;
      for (const [key, t] of byKey.entries()) {
        await db.execute(sql`
          INSERT INTO research_evidence_triples (tenant_id, subject, predicate, object, norm_key, source_session_id)
          VALUES (${tenantId}, ${t.subject}, ${t.predicate}, ${t.object}, ${key}, ${sessionId})
          ON CONFLICT (tenant_id, norm_key) DO UPDATE
            SET seen_count = research_evidence_triples.seen_count + 1,
                created_at = now(),
                source_session_id = ${sessionId}
        `);
        written++;
      }

      // Retention (review fix: bounded growth): drop aged-out rows, then cap
      // rows per tenant keeping the most recently confirmed.
      const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86400_000);
      await db.execute(sql`DELETE FROM research_evidence_triples WHERE tenant_id = ${tenantId} AND created_at < ${cutoff}`);
      await db.execute(sql`
        DELETE FROM research_evidence_triples WHERE tenant_id = ${tenantId} AND id NOT IN (
          SELECT id FROM research_evidence_triples WHERE tenant_id = ${tenantId}
          ORDER BY created_at DESC LIMIT ${MAX_ROWS_PER_TENANT}
        )
      `);
      console.log(`[knowledge-graph] session #${sessionId} upserted ${written} triples (admin pilot)`);
    } catch (err) {
      logSilentCatch("server/knowledge-graph.ts", err);
    }
  })();
}

/**
 * Load durable triples relevant to an objective (tenant-scoped; in practice
 * only admin rows exist during the pilot). Term match is done in JS over a
 * bounded recent window — proportionate for pilot volumes. Fail-open to [].
 */
export async function loadDurableTriples(
  objective: string,
  tenantId: number,
): Promise<DurableTriple[]> {
  if (!objective || objective.trim().length < 8) return [];
  try {
    await ensureTable();
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86400_000);
    const r: any = await db.execute(sql`
      SELECT id, subject, predicate, object, seen_count
      FROM research_evidence_triples
      WHERE tenant_id = ${tenantId} AND created_at > ${cutoff}
      ORDER BY seen_count DESC, created_at DESC
      LIMIT ${RECENT_SCAN_LIMIT}
    `);
    const rows = ((r.rows ?? r) as any[]);
    if (rows.length === 0) return [];

    const terms = Array.from(new Set(
      normalizeKey(objective).split(/[^a-z0-9]+/).filter((w) => w.length >= 4),
    ));
    if (terms.length === 0) return [];

    const matched = rows.filter((row) => {
      const hay = `${normalizeKey(String(row.subject))} ${normalizeKey(String(row.object))}`;
      return terms.some((term) => hay.includes(term));
    }).slice(0, MAX_SEED_TRIPLES);
    if (matched.length === 0) return [];

    const ids = matched.map((row) => Number(row.id));
    db.execute(sql`
      UPDATE research_evidence_triples SET hit_count = hit_count + 1, last_hit_at = now()
      WHERE tenant_id = ${tenantId} AND id = ANY(${`{${ids.join(",")}}`}::int[])
    `).catch((err) => logSilentCatch("server/knowledge-graph.ts", err));

    return matched.map((row) => ({
      subject: String(row.subject),
      predicate: String(row.predicate),
      object: String(row.object),
      seenCount: Number(row.seen_count) || 1,
    }));
  } catch (err) {
    logSilentCatch("server/knowledge-graph.ts", err);
    return [];
  }
}

/**
 * Render durable triples as `subject | predicate | object` lines suitable for
 * evidence-graph addTriplesFromText() seeding. Re-sanitizes at render time
 * (defense in depth) and strips the '|' separator from fields so a hostile
 * stored field can't fabricate extra triple boundaries.
 */
export function formatTriplesForSeeding(triples: DurableTriple[]): string {
  return triples
    .map((t) =>
      [
        sanitizeTripleField(t.subject, MAX_SUBJECT_LEN).replace(/\|/g, "/"),
        sanitizeTripleField(t.predicate, MAX_PREDICATE_LEN).replace(/\|/g, "/"),
        sanitizeTripleField(t.object, MAX_OBJECT_LEN).replace(/\|/g, "/"),
      ].join(" | "),
    )
    .join("\n");
}
