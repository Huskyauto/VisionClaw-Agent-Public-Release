import { sql } from "drizzle-orm";
import type { db } from "../db";
import { temporalTripleKey } from "./temporal-triple-key";
import { planTripleValidity } from "./temporal-triple-interval";
import { assertMemoryValueNotTombstonedInTx } from "./tombstones";

type TripleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type TripleInput = {
  tenantId: number;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string;
  validFrom: Date;
  requestedValidUntil: Date | null;
  wing: string | null;
  room: string | null;
  personaId: number | null;
  sourceMessageId?: number | null;
};

type TripleRow = {
  id: number;
  object?: string;
  valid_from?: Date | string | null;
  valid_until?: Date | string | null;
};

function rows(result: unknown): TripleRow[] {
  const value = (result as { rows?: unknown })?.rows ?? result;
  if (!Array.isArray(value)) throw new Error("triple query did not return rows");
  return value as TripleRow[];
}

/**
 * Called inside the caller's transaction, after the tombstone precheck.
 * The DB tombstone trigger is the final write-time guard when installed.
 */
export async function persistTemporalTriple(tx: TripleTransaction, input: TripleInput) {
  const {
    tenantId, subject, predicate, object, confidence, source, validFrom,
    requestedValidUntil, wing, room, personaId, sourceMessageId,
  } = input;
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("Invalid triple tenant");
  if (![subject, predicate, object].every(v => typeof v === "string" && v.trim())) {
    throw new Error("Triple subject, predicate, and object must be nonempty strings");
  }
  if (Number.isNaN(validFrom.getTime()) ||
    (requestedValidUntil && Number.isNaN(requestedValidUntil.getTime()))) {
    throw new Error("Invalid triple validity date");
  }
  // Both conversation extraction and store_triple use this lock. The tenant
  // and subject/predicate pair must be locked before either reads active rows.
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(${tenantId}::integer, hashtext(${subject + "\u001f" + predicate}))
  `);
  await assertMemoryValueNotTombstonedInTx(tx, {
    tenantId, source: "knowledge_triples", parts: [subject, predicate, object],
  });
  const hasSourceMessage = Number.isSafeInteger(sourceMessageId) && Number(sourceMessageId) > 0;
  const sourceKey = hasSourceMessage
    ? temporalTripleKey(subject, predicate, object, sourceMessageId) : null;
  if (sourceKey) {
    const prior = rows(await tx.execute(sql`
      SELECT id, valid_until FROM knowledge_triples
      WHERE tenant_id = ${tenantId} AND norm_key = ${sourceKey}
      LIMIT 1
    `));
    if (prior.length > 0) {
      return {
        created: false, id: prior[0].id,
        validUntil: prior[0].valid_until ? new Date(prior[0].valid_until) : null,
        superseded: [] as number[],
      };
    }
  } else {
    // Tool calls without a durable source identity retain active-fact dedup.
    const activeExact = rows(await tx.execute(sql`
      SELECT id FROM knowledge_triples
      WHERE tenant_id = ${tenantId} AND subject = ${subject}
        AND predicate = ${predicate} AND object = ${object} AND valid_until IS NULL
      LIMIT 1
    `));
    if (activeExact.length > 0) {
      return { created: false, id: activeExact[0].id, validUntil: null, superseded: [] as number[] };
    }
  }

  const current = rows(await tx.execute(sql`
    SELECT id, object, valid_from FROM knowledge_triples
    WHERE tenant_id = ${tenantId} AND subject = ${subject}
      AND predicate = ${predicate} AND valid_until IS NULL
    ORDER BY valid_from DESC
  `));
  const activeStarts = current.map(r => {
    const start = r.valid_from instanceof Date
      ? r.valid_from : new Date(r.valid_from ?? 0);
    if (Number.isNaN(start.getTime())) throw new Error("Invalid stored triple date");
    return start;
  });
  for (let i = 0; i < current.length; i++) {
    if (activeStarts[i].getTime() === validFrom.getTime() &&
      current[i].object !== object) {
      throw new Error("A conflicting triple has the same valid_from date");
    }
  }
  const plan = planTripleValidity(validFrom, requestedValidUntil, activeStarts);
  const normKey = sourceKey ?? temporalTripleKey(subject, predicate, object);
  const inserted = rows(await tx.execute(sql`
    INSERT INTO knowledge_triples
      (subject, predicate, object, confidence, source, valid_from, valid_until,
       wing, room, tenant_id, persona_id, norm_key)
    VALUES (${subject}, ${predicate}, ${object}, ${confidence}, ${source},
            ${validFrom}, ${plan.validUntil}, ${wing}, ${room},
            ${tenantId}, ${personaId}, ${normKey})
    ON CONFLICT (tenant_id, norm_key) DO NOTHING
    RETURNING id
  `));
  if (inserted.length === 0) {
    // A retry of the same source already wrote this version. Crucially, do
    // not expire a more recent fact when that earlier version is replayed.
    const prior = rows(await tx.execute(sql`
      SELECT id, valid_until FROM knowledge_triples
      WHERE tenant_id = ${tenantId} AND norm_key = ${normKey}
      LIMIT 1
    `));
    if (prior.length === 0) throw new Error("Triple insert returned no row");
    return {
      created: false, id: prior[0].id,
      validUntil: prior[0].valid_until ? new Date(prior[0].valid_until) : null,
      superseded: [] as number[],
    };
  }

  const id = Number(inserted[0].id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Triple insert returned invalid id");
  const superseded: number[] = [];
  if (plan.supersedeCurrent) {
    for (let i = 0; i < current.length; i++) {
      const row = current[i];
      // Separate messages may assert the same fact on the same effective
      // date. Preserve each source without creating a zero-length interval.
      if (activeStarts[i].getTime() === validFrom.getTime()) continue;
      await tx.execute(sql`
        UPDATE knowledge_triples SET valid_until = ${validFrom}, updated_at = NOW()
        WHERE id = ${row.id} AND tenant_id = ${tenantId} AND valid_until IS NULL
      `);
      superseded.push(row.id);
    }
  }
  return { created: true, id, validUntil: plan.validUntil, superseded };
}