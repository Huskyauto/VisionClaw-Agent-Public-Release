import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { prepareOffboardingErasure } from "../server/memory/forgetting-store";
import {
  canonicalMemoryValue,
  canonicalMemoryValues,
  memoryValueDigest,
} from "../server/memory/tombstones";

async function main(): Promise<void> {
  const sessionChecks = await Promise.all(Array.from({ length: 40 }, () =>
    pool.query(`SELECT current_setting('app.memory_tombstone_hmac_key', true) <> '' AS ready`)));
  assert.equal(sessionChecks.every((result) => result.rows[0]?.ready === true), true,
    "every pooled connection must be initialized before first checkout");
  const fact = `\u00a0forgetting-db-proof-${randomUUID()}\twith\u00a0NBSP `;
  const canonicalFact = canonicalMemoryValue([fact]);
  const digest = memoryValueDigest(1, "memory_entries", canonicalFact);
  let blocked = false;
  let sqlDigestMatched = false;
  let sqlCanonicalMatched = false;
  let tombstoneVisible = false;

  try {
    await db.transaction(async (tx) => {
      const canonicalCheck = await tx.execute(sql`SELECT
        public.memory_ascii_canonical(${fact}) AS canonical`);
      const canonicalRows = (canonicalCheck as any).rows ?? canonicalCheck;
      sqlCanonicalMatched = canonicalRows[0]?.canonical === canonicalFact;
      const digestCheck = await tx.execute(sql`SELECT encode(hmac(
        ${`1\u001f${canonicalFact}`},
        current_setting('app.memory_tombstone_hmac_key'),
        'sha256'), 'hex') = ${digest} AS matched`);
      const digestRows = (digestCheck as any).rows ?? digestCheck;
      sqlDigestMatched = digestRows[0]?.matched === true;
      await tx.execute(sql`INSERT INTO memory_entries
        (tenant_id, fact, category, source, status)
        VALUES (1, ${fact}, 'test', 'forgetting-db-proof', 'active')`);
      await tx.execute(sql`INSERT INTO memory_tombstones
        (tenant_id, source, source_id, value_digest, request_key)
        VALUES (1, 'memory_entries', ${`proof-${randomUUID()}`}, ${digest},
          ${`proof-${randomUUID()}`})`);
      const visible = await tx.execute(sql`SELECT 1 FROM memory_tombstones
        WHERE tenant_id = 1 AND value_digest = ${digest}`);
      tombstoneVisible = ((visible as any).rows ?? visible).length === 1;
      await tx.execute(sql`INSERT INTO memory_entries
        (tenant_id, fact, category, source, status)
        VALUES (1, ${fact}, 'test', 'forgetting-db-proof', 'active')`);
    });
  } catch (error) {
    const message = error instanceof Error
      ? `${error.message} ${String((error as Error & { cause?: unknown }).cause ?? "")}`
      : String(error);
    blocked = message.includes("erased content cannot be restored");
  }

  let relationshipBlocked = false;
  let relationshipInserted = false;
  let graphRelationshipBlocked = false;
  let graphRelationshipInserted = false;
  let offboardingProved = false;
  const sourceFact = `relationship-source-${randomUUID()}`;
  const targetFact = `relationship-target-${randomUUID()}`;
  try {
    await db.transaction(async (tx) => {
      const sourceResult = await tx.execute(sql`INSERT INTO memory_entries
        (tenant_id, fact, category, source, status)
        VALUES (1, ${sourceFact}, 'test', 'forgetting-db-proof', 'active')
        RETURNING id`);
      const targetResult = await tx.execute(sql`INSERT INTO memory_entries
        (tenant_id, fact, category, source, status)
        VALUES (1, ${targetFact}, 'test', 'forgetting-db-proof', 'active')
        RETURNING id`);
      const sourceId = Number(((sourceResult as any).rows ?? sourceResult)[0]?.id);
      const targetId = Number(((targetResult as any).rows ?? targetResult)[0]?.id);
      const linkType = "related";
      await tx.execute(sql`INSERT INTO memory_links
        (source_memory_id, target_memory_id, link_type)
        VALUES (${sourceId}, ${targetId}, ${linkType})`);
      relationshipInserted = true;
      const parts = [String(sourceId), String(targetId), linkType];
      for (const [index, value] of canonicalMemoryValues(parts).entries()) {
        const relationshipDigest = memoryValueDigest(1, "memory_links", value);
        await tx.execute(sql`INSERT INTO memory_tombstones
          (tenant_id, source, source_id, value_digest, request_key)
          VALUES (1, 'memory_links', ${`relationship-${randomUUID()}-${index}`},
            ${relationshipDigest}, ${`relationship-${randomUUID()}`})`);
      }
      await tx.execute(sql`DELETE FROM memory_links
        WHERE source_memory_id = ${sourceId} AND target_memory_id = ${targetId}
          AND link_type = ${linkType}`);
      await tx.execute(sql`INSERT INTO memory_links
        (source_memory_id, target_memory_id, link_type)
        VALUES (${sourceId}, ${targetId}, ${linkType})`);
    });
  } catch (error) {
    const message = error instanceof Error
      ? `${error.message} ${String((error as Error & { cause?: unknown }).cause ?? "")}`
      : String(error);
    relationshipBlocked = message.includes("erased content cannot be restored");
  }

  try {
    await db.transaction(async (tx) => {
      const suffix = randomUUID();
      const tenantResult = await tx.execute(sql`INSERT INTO tenants (email, name)
        VALUES (${`forgetting-proof-${suffix}@example.invalid`}, 'Forgetting proof')
        RETURNING id`);
      const tenantId = Number(((tenantResult as any).rows ?? tenantResult)[0].id);
      const conversationResult = await tx.execute(sql`INSERT INTO conversations (tenant_id)
        VALUES (${tenantId}) RETURNING id`);
      const conversationId = Number(
        ((conversationResult as any).rows ?? conversationResult)[0].id);
      const memories = await tx.execute(sql`INSERT INTO memory_entries
        (tenant_id, fact, category, source) VALUES
        (${tenantId}, ${`source-${suffix}`}, 'test', 'forgetting-db-proof'),
        (${tenantId}, ${`target-${suffix}`}, 'test', 'forgetting-db-proof')
        RETURNING id`);
      const memoryRows = (memories as any).rows ?? memories;
      await tx.execute(sql`INSERT INTO conversation_facts
        (tenant_id, conversation_id, fact_text)
        VALUES (${tenantId}, ${conversationId}, ${`fact-${suffix}`})`);
      await tx.execute(sql`INSERT INTO compaction_archives
        (tenant_id, conversation_id, content)
        VALUES (${tenantId}, ${conversationId}, ${`archive-${suffix}`})`);
      await tx.execute(sql`INSERT INTO graph_memory (tenant_id, path, content)
        VALUES (${tenantId}, ${`/proof/${suffix}`}, ${`graph-${suffix}`})`);
      await tx.execute(sql`INSERT INTO knowledge_triples
        (tenant_id, subject, predicate, object, norm_key)
        VALUES (${tenantId}, 'proof', 'has', ${suffix}, ${`proof:${suffix}`})`);
      await tx.execute(sql`INSERT INTO knowledge_nudges (tenant_id, fact)
        VALUES (${tenantId}, ${`nudge-${suffix}`})`);
      await tx.execute(sql`INSERT INTO graph_memory_links
        (tenant_id, source_path, target_path, link_type)
        VALUES (${tenantId}, ${`/proof/${suffix}`}, ${`/proof/${suffix}/target`}, 'reference')`);
      await tx.execute(sql`INSERT INTO memory_links
        (source_memory_id, target_memory_id, link_type)
        VALUES (${Number(memoryRows[0].id)}, ${Number(memoryRows[1].id)}, 'related')`);
      const erasure = await prepareOffboardingErasure(
        tx as any, tenantId, `offboarding-proof-${suffix}`);
      assert.ok(erasure.erasedCount >= 8, "offboarding must erase every durable store");
      const remaining = await tx.execute(sql`SELECT
        (SELECT count(*) FROM conversation_facts WHERE tenant_id = ${tenantId}) +
        (SELECT count(*) FROM compaction_archives WHERE tenant_id = ${tenantId}) +
        (SELECT count(*) FROM graph_memory WHERE tenant_id = ${tenantId}) +
        (SELECT count(*) FROM knowledge_triples WHERE tenant_id = ${tenantId}) +
        (SELECT count(*) FROM knowledge_nudges WHERE tenant_id = ${tenantId}) +
        (SELECT count(*) FROM graph_memory_links WHERE tenant_id = ${tenantId}) +
        (SELECT count(*) FROM memory_entries WHERE tenant_id = ${tenantId}) AS count`);
      assert.equal(Number(((remaining as any).rows ?? remaining)[0].count), 0);
      offboardingProved = true;
      throw new Error("rollback-offboarding-proof");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "rollback-offboarding-proof") throw error;
  }

  const graphSourcePath = `/proof/${randomUUID()}/source`;
  const graphTargetPath = `/proof/${randomUUID()}/target`;
  try {
    await db.transaction(async (tx) => {
      const linkType = "proof-reference";
      await tx.execute(sql`INSERT INTO graph_memory_links
        (source_path, target_path, link_type, tenant_id)
        VALUES (${graphSourcePath}, ${graphTargetPath}, ${linkType}, 1)`);
      graphRelationshipInserted = true;
      const parts = [graphSourcePath, graphTargetPath, linkType];
      for (const [index, value] of canonicalMemoryValues(parts).entries()) {
        const relationshipDigest = memoryValueDigest(1, "graph_memory_links", value);
        await tx.execute(sql`INSERT INTO memory_tombstones
          (tenant_id, source, source_id, value_digest, request_key)
          VALUES (1, 'graph_memory_links', ${`graph-relationship-${randomUUID()}-${index}`},
            ${relationshipDigest}, ${`graph-relationship-${randomUUID()}`})`);
      }
      await tx.execute(sql`DELETE FROM graph_memory_links
        WHERE tenant_id = 1 AND source_path = ${graphSourcePath}
          AND target_path = ${graphTargetPath} AND link_type = ${linkType}`);
      await tx.execute(sql`INSERT INTO graph_memory_links
        (source_path, target_path, link_type, tenant_id)
        VALUES (${graphSourcePath}, ${graphTargetPath}, ${linkType}, 1)`);
    });
  } catch (error) {
    const message = error instanceof Error
      ? `${error.message} ${String((error as Error & { cause?: unknown }).cause ?? "")}`
      : String(error);
    graphRelationshipBlocked = message.includes("erased content cannot be restored");
  }

  assert.equal(sqlDigestMatched, true, "PostgreSQL and Node tombstone digests must match");
  assert.equal(sqlCanonicalMatched, true, "PostgreSQL and Node canonicalization must match");
  assert.equal(tombstoneVisible, true, "proof tombstone must be visible before the second write");
  assert.equal(blocked, true, "database trigger must block erased content in the same transaction");
  assert.equal(relationshipInserted, true, "relationship proof must insert its original edge");
  assert.equal(relationshipBlocked, true, "database trigger must block relationship reinsertion");
  assert.equal(graphRelationshipInserted, true, "graph relationship proof must insert its original edge");
  assert.equal(graphRelationshipBlocked, true, "database trigger must block graph relationship reinsertion");
  assert.equal(offboardingProved, true, "offboarding must erase all durable memory stores");

  const residue = await db.execute(sql`SELECT COUNT(*)::int AS count
    FROM memory_entries WHERE tenant_id = 1 AND fact = ${fact}`);
  const rows = (residue as any).rows ?? residue;
  assert.equal(Number(rows[0]?.count ?? -1), 0, "proof transaction must roll back without residue");
  const relationshipResidue = await db.execute(sql`SELECT COUNT(*)::int AS count
    FROM memory_entries
    WHERE tenant_id = 1 AND fact IN (${sourceFact}, ${targetFact})`);
  const relationshipRows = (relationshipResidue as any).rows ?? relationshipResidue;
  assert.equal(Number(relationshipRows[0]?.count ?? -1), 0,
    "relationship proof transaction must roll back without residue");
  const graphRelationshipResidue = await db.execute(sql`SELECT COUNT(*)::int AS count
    FROM graph_memory_links
    WHERE tenant_id = 1 AND source_path = ${graphSourcePath}
      AND target_path = ${graphTargetPath}`);
  const graphRelationshipRows = (graphRelationshipResidue as any).rows ?? graphRelationshipResidue;
  assert.equal(Number(graphRelationshipRows[0]?.count ?? -1), 0,
    "graph relationship proof transaction must roll back without residue");
  console.log("memory forgetting DB proof: PASS");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });