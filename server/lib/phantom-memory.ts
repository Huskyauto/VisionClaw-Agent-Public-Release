// R98.24 — MNEMA Nugget 1: phantom-stage memory and skills.
//
// MNEMA (Smith, Gentic Lab, EUMAS 2026) introduced a "phantom" lifecycle stage
// for memory units: a retired witness *intercepts retrievals* and emits a
// structured refusal pointing readers at its successor and prior-claim validity
// window. This addresses the silent-knowledge-loss class of bugs where an agent
// confidently cites a fact that was true 90 days ago but isn't now.
//
// We adapt the idea WITHOUT MNEMA's full witness-lattice machinery (no signed
// journals, no Ed25519 identities, no nine-step commitment protocol — those are
// over-engineering for our scale and adversarial posture). Just: superseded
// facts/skills get status='phantom' instead of being deleted, retain a
// succeeded_by_id pointer, and a valid_until timestamp.
//
// Two operations:
//   1) supersedeMemoryEntry(oldId, newId, validUntil) — flip oldId to phantom.
//   2) describePhantom(row) — turn a phantom row into a refusal string an
//      agent can quote verbatim ("This fact was true until X. See entry Y.").
//
// Retrieval call sites can opt-in to including phantoms by passing
// includePhantoms=true; today only the explicit memory-graph diagnostic uses
// that. The default vector retrieval still filters status='active' so normal
// chat is unaffected.

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface PhantomDescriptor {
  id: number;
  fact: string;
  validUntil: Date | null;
  succeededById: number | null;
  successorFact?: string | null;
}

/**
 * Mark a memory entry as phantom (superseded). The row is NOT deleted — it's
 * still retrievable for audit and so retrieval can emit a refusal pointing at
 * the successor.
 *
 * @param oldId       memory_entries.id of the now-stale fact
 * @param newId       memory_entries.id of the replacement fact (or null if
 *                    the fact is just stale, not replaced)
 * @param validUntil  when the old fact stopped being true (default = now)
 * @param tenantId    required — silent default-to-admin would let one tenant
 *                    retire another tenant's facts
 */
export async function supersedeMemoryEntry(
  oldId: number,
  newId: number | null,
  tenantId: number,
  validUntil: Date = new Date(),
): Promise<{ ok: boolean; error?: string }> {
  if (!tenantId) return { ok: false, error: "tenantId required" };
  if (!Number.isInteger(oldId) || oldId <= 0) return { ok: false, error: "oldId must be positive integer" };
  if (newId !== null && (!Number.isInteger(newId) || newId <= 0)) {
    return { ok: false, error: "newId must be positive integer or null" };
  }
  try {
    // Architect R98.24 review: validate newId belongs to the SAME tenant before
    // linking — otherwise a tenant-scoped retrieval could chase a successor
    // pointer into another tenant's data. Successor must also be active (we
    // don't want to point at another phantom — that's a chain we don't model).
    if (newId !== null) {
      const successor = await db.execute(sql`
        SELECT id FROM memory_entries
        WHERE id = ${newId} AND tenant_id = ${tenantId} AND status = 'active'
        LIMIT 1
      `);
      const sRows = (successor as any).rows || successor;
      if (!sRows || sRows.length === 0) {
        return { ok: false, error: "successor newId not found, wrong tenant, or not active" };
      }
    }
    const result = await db.execute(sql`
      UPDATE memory_entries
      SET status = 'phantom',
          succeeded_by_id = ${newId},
          valid_until = ${validUntil.toISOString()}::timestamp
      WHERE id = ${oldId}
        AND tenant_id = ${tenantId}
        AND status = 'active'
      RETURNING id
    `);
    const rows = (result as any).rows || result;
    if (!rows || rows.length === 0) {
      return { ok: false, error: "no active memory entry found with that id+tenant" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message?.slice(0, 200) || "unknown" };
  }
}

/**
 * Same as supersedeMemoryEntry but for the global skills catalog (no tenant —
 * skills are platform-wide).
 */
export async function supersedeSkill(
  oldId: number,
  newId: number | null,
  validUntil: Date = new Date(),
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isInteger(oldId) || oldId <= 0) return { ok: false, error: "oldId must be positive integer" };
  if (newId !== null && (!Number.isInteger(newId) || newId <= 0)) {
    return { ok: false, error: "newId must be positive integer or null" };
  }
  try {
    const result = await db.execute(sql`
      UPDATE skills
      SET status = 'phantom',
          succeeded_by_id = ${newId},
          valid_until = ${validUntil.toISOString()}::timestamp
      WHERE id = ${oldId}
        AND status = 'active'
      RETURNING id
    `);
    const rows = (result as any).rows || result;
    if (!rows || rows.length === 0) {
      return { ok: false, error: "no active skill with that id" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message?.slice(0, 200) || "unknown" };
  }
}

/**
 * Look up a memory entry by id, return a phantom descriptor if it's retired.
 * Returns null if the entry is active or doesn't exist (callers handle those
 * paths separately — phantom lookup is the special case worth narrating).
 */
export async function lookupPhantomMemory(
  id: number,
  tenantId: number,
): Promise<PhantomDescriptor | null> {
  if (!tenantId || !Number.isInteger(id) || id <= 0) return null;
  try {
    const result = await db.execute(sql`
      SELECT m.id, m.fact, m.valid_until, m.succeeded_by_id,
             s.fact AS successor_fact
      FROM memory_entries m
      LEFT JOIN memory_entries s ON s.id = m.succeeded_by_id AND s.tenant_id = m.tenant_id
      WHERE m.id = ${id}
        AND m.tenant_id = ${tenantId}
        AND m.status = 'phantom'
      LIMIT 1
    `);
    const rows = (result as any).rows || result;
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      fact: r.fact,
      validUntil: r.valid_until ? new Date(r.valid_until) : null,
      succeededById: r.succeeded_by_id,
      successorFact: r.successor_fact || null,
    };
  } catch {
    return null;
  }
}

/**
 * Render a phantom descriptor as a structured refusal string the agent can
 * quote verbatim. Format is intentionally short and machine-parseable.
 */
export function describePhantom(p: PhantomDescriptor): string {
  const until = p.validUntil ? p.validUntil.toISOString().slice(0, 10) : "an earlier date";
  if (p.succeededById && p.successorFact) {
    return `[PHANTOM #${p.id}] This fact ("${p.fact.slice(0, 120)}") was true until ${until}. It has been superseded by entry #${p.succeededById}: "${p.successorFact.slice(0, 200)}".`;
  }
  if (p.succeededById) {
    return `[PHANTOM #${p.id}] This fact was true until ${until}. See successor entry #${p.succeededById}.`;
  }
  return `[PHANTOM #${p.id}] This fact ("${p.fact.slice(0, 120)}") was true until ${until} but has not been replaced. Treat as historical only.`;
}
