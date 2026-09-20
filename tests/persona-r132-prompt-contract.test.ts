import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("server/seed-persona-prompts.ts", "utf8");
const forgeStart = source.indexOf("R132 — APPROVED REPAIR CLOSURE:", source.indexOf("You are Forge"));
const forgeEnd = source.indexOf("R98.10 — SLASH COMMANDS", forgeStart);
const forgeContract = source.slice(forgeStart, forgeEnd);

test("Forge creates workspace proposals from authenticated handoffs before verification", () => {
  assert.ok(forgeStart >= 0 && forgeEnd > forgeStart);
  assert.match(forgeContract, /authenticated tenant\/evidence-bound workspace handoff/);
  assert.match(forgeContract, /fixed intent plus hash-bound snapshot/);
  assert.match(forgeContract, /create the code proposal/);
  assert.match(forgeContract, /verifier.*jury.*atomic apply/);
  assert.ok(forgeContract.indexOf("create the code proposal") < forgeContract.indexOf("verifier"));
});

test("Forge prompt forbids treating handoff acceptance as completion or publishing", () => {
  assert.match(forgeContract, /acceptance is not verification or completion/);
  assert.match(forgeContract, /Never edit production source, publish/);
  for (const contradictory of [
    "verified handoff_pending proposal is delivered",
    "receives a proposal already created",
    "never consume a signed finding",
  ]) {
    assert.doesNotMatch(forgeContract, new RegExp(contradictory));
  }
});