/**
 * Forcing-function tests for the inter-persona chain-of-command governance
 * (server/chain-of-command.ts, consumed by heartbeat.ts delegation +
 * delegateTaskFromChat).
 *
 * Background: a legitimate human-driven (chat) hand-off to a CEO persona was
 * being hard-blocked by the "no direct-to-CEO" rule, producing Bob's red
 * banner on the weekly recap. The fix relaxes the CEO guard for `source:"chat"`
 * (the human operator outranks every persona) while keeping AUTONOMOUS
 * (heartbeat) delegation strict. validateChainOfCommand had NO test coverage,
 * so a refactor could silently re-break it. These tests pin the matrix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateChainOfCommand,
  CHAIN_OF_COMMAND,
  CEO_PERSONAS,
} from "../../server/chain-of-command";
import type { Persona } from "@shared/schema";

// Minimal Persona stub — validateChainOfCommand only reads `name` and `id`.
function persona(name: string, id = 999): Persona {
  return { id, name } as Persona;
}

const NO_PERSONAS: Persona[] = [];

// --- source = heartbeat (autonomous) × target = CEO persona ---------------

test("heartbeat: non-Chief-of-Staff persona → CEO is BLOCKED", () => {
  for (const ceo of CEO_PERSONAS) {
    const res = validateChainOfCommand(persona("Forge"), ceo, NO_PERSONAS, "heartbeat");
    assert.equal(res.allowed, false, `Forge → ${ceo} (heartbeat) must be blocked`);
    assert.match(res.reason || "", /direct to CEO|Chief of Staff/i);
  }
});

test("heartbeat: Chief of Staff is EXEMPT from the direct-to-CEO rule (allow-list still governs)", () => {
  // The CEO-direct guard explicitly exempts Chief of Staff (the triage layer):
  // it must NOT produce the "direct to CEO" refusal. The independent
  // CHAIN_OF_COMMAND allow-list still applies, and since the CEOs are not on
  // CoS's report list the hand-off is blocked by THAT rule instead. This pins
  // both behaviours so a refactor can't conflate them.
  for (const ceo of CEO_PERSONAS) {
    const res = validateChainOfCommand(persona("Chief of Staff"), ceo, NO_PERSONAS, "heartbeat");
    assert.equal(res.allowed, false, `Chief of Staff → ${ceo} is still blocked by the allow-list`);
    assert.doesNotMatch(
      res.reason || "",
      /direct to CEO/i,
      "Chief of Staff must be exempt from the direct-to-CEO refusal",
    );
    assert.match(res.reason || "", /can only delegate to/i);
  }
});

test("heartbeat: default source argument is treated as heartbeat (strict)", () => {
  // No source arg → defaults to "heartbeat" → CEO guard must still fire.
  const res = validateChainOfCommand(persona("Forge"), "Felix", NO_PERSONAS);
  assert.equal(res.allowed, false, "Default (no source) must apply the strict heartbeat CEO guard");
});

// --- source = chat (human-driven) × target = CEO persona ------------------

test("chat: non-trusted persona → CEO is ALLOWED (human operator outranks)", () => {
  for (const ceo of CEO_PERSONAS) {
    const res = validateChainOfCommand(persona("Forge"), ceo, NO_PERSONAS, "chat");
    assert.equal(res.allowed, true, `Forge → ${ceo} (chat) must be allowed`);
  }
});

test("REGRESSION (Bob recap): chat, non-trusted Agent Blueprint → CEO deliverable hand-off succeeds", () => {
  // The exact failing scenario: a non-trusted worker persona, in a chat-driven
  // flow, hands a Felix-owned deliverable (weekly recap) up to the CEO. This
  // must NOT hard-fail anymore.
  const res = validateChainOfCommand(persona("Agent Blueprint"), "Felix", NO_PERSONAS, "chat");
  assert.equal(res.allowed, true, "Chat hand-off to CEO from a non-trusted persona must succeed");
  assert.equal(res.reason, undefined);
});

// --- Neptune guard enforces in BOTH paths --------------------------------

test("Neptune guard: unauthorized persona → Neptune is BLOCKED in heartbeat", () => {
  const res = validateChainOfCommand(persona("Forge"), "Neptune", NO_PERSONAS, "heartbeat");
  assert.equal(res.allowed, false);
  assert.match(res.reason || "", /Neptune only activates/i);
});

test("Neptune guard: unauthorized persona → Neptune is BLOCKED in chat too", () => {
  // The chat relaxation only covers the CEO guard, NOT the Neptune guard — a
  // worker still can't reach Neptune directly even in a chat flow.
  const res = validateChainOfCommand(persona("Forge"), "Neptune", NO_PERSONAS, "chat");
  assert.equal(res.allowed, false, "Neptune guard must still apply in chat");
  assert.match(res.reason || "", /Neptune only activates/i);
});

test("Neptune guard: Radar / Chief of Staff / Felix → Neptune is ALLOWED", () => {
  for (const allowed of ["Radar", "Chief of Staff", "Felix"]) {
    const res = validateChainOfCommand(persona(allowed), "Neptune", NO_PERSONAS, "heartbeat");
    assert.equal(res.allowed, true, `${allowed} → Neptune must be allowed`);
  }
});

// --- CHAIN_OF_COMMAND allow-list enforces in BOTH paths -------------------

test("CHAIN_OF_COMMAND: Scribe → Proof allowed, Scribe → Forge blocked (heartbeat)", () => {
  const ok = validateChainOfCommand(persona("Scribe"), "Proof", NO_PERSONAS, "heartbeat");
  assert.equal(ok.allowed, true, "Scribe → Proof is on the allow-list");

  const blocked = validateChainOfCommand(persona("Scribe"), "Forge", NO_PERSONAS, "heartbeat");
  assert.equal(blocked.allowed, false, "Scribe → Forge is not on the allow-list");
  assert.match(blocked.reason || "", /can only delegate to/i);
});

test("CHAIN_OF_COMMAND: Scribe → Forge still blocked in chat (allow-list is path-independent)", () => {
  const blocked = validateChainOfCommand(persona("Scribe"), "Forge", NO_PERSONAS, "chat");
  assert.equal(blocked.allowed, false, "Scribe's allow-list must hold in chat too");
  assert.match(blocked.reason || "", /can only delegate to/i);
});

test("CHAIN_OF_COMMAND: Chief of Staff can delegate to each listed report", () => {
  for (const target of CHAIN_OF_COMMAND["Chief of Staff"]) {
    const res = validateChainOfCommand(persona("Chief of Staff"), target, NO_PERSONAS, "heartbeat");
    assert.equal(res.allowed, true, `Chief of Staff → ${target} must be allowed`);
  }
});

// --- CEO-as-source + null-persona pass-throughs ---------------------------

test("CEO persona as source may delegate freely (heartbeat)", () => {
  const res = validateChainOfCommand(persona("Felix"), "Atlas", NO_PERSONAS, "heartbeat");
  assert.equal(res.allowed, true, "Felix (CEO) → anyone is allowed");
});

test("null fromPersona (system) is always allowed", () => {
  const res = validateChainOfCommand(null, "Felix", NO_PERSONAS, "heartbeat");
  assert.equal(res.allowed, true);
});

test("unlisted persona → unlisted target (non-CEO) is allowed (no allow-list = no restriction)", () => {
  // A persona with no CHAIN_OF_COMMAND entry is only constrained by the CEO +
  // Neptune guards; a lateral hand-off to a normal persona passes.
  const res = validateChainOfCommand(persona("Apollo"), "Atlas", NO_PERSONAS, "heartbeat");
  assert.equal(res.allowed, true);
});
