/**
 * R125+137.22 — open-loop miner: cue pre-filter, dedupe key, and LLM
 * extraction via an injected fake client (query-free: extractOpenLoops and
 * the pure helpers never touch the DB; mineCommitmentsFromTurn is NOT
 * exercised here to keep the pg pool closed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasCommitmentCue, commitmentDedupeKey, extractOpenLoops, mineCommitmentsFromTurn } from "../../server/commitments-extraction";

test("cue filter passes promise phrasing and rejects chit-chat", () => {
  assert.equal(hasCommitmentCue("I'll weigh in Monday morning"), true);
  assert.equal(hasCommitmentCue("remind me to send the invoice"), true);
  assert.equal(hasCommitmentCue("we're waiting on the vendor's quote"), true);
  assert.equal(hasCommitmentCue("nice weather today"), false);
  assert.equal(hasCommitmentCue(""), false);
});

test("dedupe key is normalization-stable", () => {
  const a = commitmentDedupeKey("User will  Weigh In\nMonday");
  const b = commitmentDedupeKey("user will weigh in monday");
  assert.equal(a, b);
  assert.equal(a.length, 32);
  assert.notEqual(a, commitmentDedupeKey("agent will send the draft"));
});

function fakeClient(payload: any) {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      },
    },
  };
}

test("extractOpenLoops maps fields, filters vague/short, caps at 3", async () => {
  const loops = await extractOpenLoops("msg", "resp", fakeClient({
    loops: [
      { description: "User will weigh in Monday morning", who: "user", dueAt: "2026-07-20T09:00:00Z", stated: "explicit", sensitivity: "sensitive" },
      { description: "short", who: "agent", dueAt: null, stated: "explicit" },
      { description: "Agent will deliver the draft PDF by Friday", who: "agent", dueAt: "bogus-date", stated: "implied" },
      { description: "Waiting on the vendor quote for the office move", who: "third_party", dueAt: null, stated: "explicit" },
      { description: "A fourth valid loop that should be capped by the max", who: "user", dueAt: null, stated: "explicit" },
    ],
  }));
  assert.equal(loops.length, 3);
  assert.equal(loops[0].sensitivity, "sensitive");
  assert.equal(loops[0].confidence, 0.9);
  assert.equal(loops[1].dueAt, null); // bogus date normalized to null
  assert.equal(loops[1].confidence, 0.6); // implied
  assert.equal(loops[2].who, "third_party");
});

function fakeDb() {
  const inserts: string[] = [];
  const seen = new Set<string>();
  return {
    inserts,
    db: {
      execute: async (q: any) => {
        // Drizzle sql`` object: bound params sit in queryChunks as raw
        // primitives (StringChunk objects hold the literal SQL text).
        const params: any[] = (q?.queryChunks ?? []).filter(
          (c: any) => typeof c !== "object" || c === null || c instanceof Date,
        );
        const rendered = JSON.stringify(params);
        inserts.push(rendered);
        // Emulate ON CONFLICT DO NOTHING on (tenant, dedupeKey): the dedupe
        // key is the 32-hex param.
        const key = params.find((p) => typeof p === "string" && /^[0-9a-f]{32}$/.test(p));
        const conflictKey = `${params[0]}:${key}`;
        if (key && seen.has(conflictKey)) return { rows: [] };
        if (key) seen.add(conflictKey);
        return { rows: [{ id: 1 }] };
      },
    },
  };
}

const oneLoopClient = () => fakeClient({
  loops: [{ description: "User will weigh in Monday morning", who: "user", dueAt: null, stated: "explicit", sensitivity: "routine" }],
});

test("mineCommitmentsFromTurn: invalid tenant ⇒ no LLM call, no write (fail CLOSED)", async () => {
  const { db, inserts } = fakeDb();
  for (const bad of [undefined, 0, -3, 1.5, NaN as any]) {
    const res = await mineCommitmentsFromTurn("I'll weigh in Monday", "ok", bad as any, null, { db, llmClient: oneLoopClient() });
    assert.deepEqual(res, { mined: 0, stored: 0 });
  }
  assert.equal(inserts.length, 0);
});

test("mineCommitmentsFromTurn: valid tenant ⇒ scoped write with redacted description", async () => {
  const { db, inserts } = fakeDb();
  const client = fakeClient({
    loops: [{ description: "User will pay with card 4111 1111 1111 1111 on Monday", who: "user", dueAt: null, stated: "explicit", sensitivity: "sensitive" }],
  });
  const res = await mineCommitmentsFromTurn("I'll pay Monday", "ok", 7, "Robert", { db, llmClient: client });
  assert.deepEqual(res, { mined: 1, stored: 1 });
  assert.equal(inserts.length, 1);
  assert.ok(inserts[0].includes("7"), "tenantId bound into the INSERT");
  assert.ok(inserts[0].includes("[REDACTED_CC]"), "Luhn-valid card redacted before storage");
  assert.ok(!inserts[0].includes("4111"), "raw card number never reaches the store");
});

test("mineCommitmentsFromTurn: repeat of the same promise dedupes (stored=0 second time)", async () => {
  const { db } = fakeDb();
  const first = await mineCommitmentsFromTurn("I'll weigh in Monday", "ok", 7, null, { db, llmClient: oneLoopClient() });
  const second = await mineCommitmentsFromTurn("I'll weigh in Monday", "ok", 7, null, { db, llmClient: oneLoopClient() });
  assert.deepEqual(first, { mined: 1, stored: 1 });
  assert.deepEqual(second, { mined: 1, stored: 0 });
  // Different tenant is NOT deduped against tenant 7.
  const other = await mineCommitmentsFromTurn("I'll weigh in Monday", "ok", 8, null, { db, llmClient: oneLoopClient() });
  assert.deepEqual(other, { mined: 1, stored: 1 });
});

test("mineCommitmentsFromTurn: db throw is swallowed (fail OPEN on the turn)", async () => {
  const res = await mineCommitmentsFromTurn("I'll weigh in Monday", "ok", 7, null, {
    db: { execute: async () => { throw new Error("boom"); } },
    llmClient: oneLoopClient(),
  });
  assert.deepEqual(res, { mined: 1, stored: 0 });
});

test("extractOpenLoops fails soft on malformed output", async () => {
  assert.deepEqual(await extractOpenLoops("m", "r", {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: "not json" } }] }) } },
  }), []);
  assert.deepEqual(await extractOpenLoops("m", "r", {
    chat: { completions: { create: async () => ({ choices: [] }) } },
  }), []);
});
