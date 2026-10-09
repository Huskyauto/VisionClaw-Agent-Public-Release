import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { claimPrefilterObservation } from "../server/lib/session-fact-extractor";

process.env.TYPESAFE_FACT_PREFILTER_MODE = "shadow";
process.env.TYPESAFE_FACT_PREFILTER_TENANTS = "1";

test("concurrent duplicate invocations atomically claim one Jev call", async () => {
  const sourceMessageId = 2_000_000_000 + Math.floor(Math.random() * 100_000_000);
  const input = {
    tenantId: 1,
    conversationId: 1,
    personaId: null,
    userTurn: "Thanks.",
    assistantTurn: "You're welcome.",
    sourceMessageId,
    turnCount: 4,
  };
  try {
    const claims = await Promise.all(
      Array.from({ length: 12 }, () => claimPrefilterObservation(input)),
    );
    assert.equal(claims.filter(Boolean).length, 1);
    const rows = await db.execute(sql`
      SELECT tenant_id, source_message_id, status
      FROM typesafe_fact_prefilter_observations
      WHERE tenant_id = 1 AND source_message_id = ${sourceMessageId}
    `);
    const values = ((rows as any).rows || rows) as any[];
    assert.equal(values.length, 1);
    assert.equal(values[0].tenant_id, 1);
    assert.equal(values[0].status, "claimed");
  } finally {
    await db.execute(sql`
      DELETE FROM typesafe_fact_prefilter_observations
      WHERE tenant_id = 1 AND source_message_id = ${sourceMessageId}
    `);
  }
});

test("shadow cannot await Jev before the existing extractor persists facts", async () => {
  const source = await readFile(
    new URL("../server/lib/session-fact-extractor.ts", import.meta.url),
    "utf8",
  );
  const enforceAwait = source.indexOf("prefilter = await prefilterPromise;");
  const extractorStart = source.indexOf("res = await runLlmTask({");
  const factInsert = source.indexOf("INSERT INTO conversation_facts");
  const shadowAwait = source.lastIndexOf("prefilter = prefilter || await prefilterPromise;");
  assert.ok(enforceAwait > 0 && enforceAwait < extractorStart);
  assert.ok(extractorStart < factInsert);
  assert.ok(factInsert < shadowAwait);
});