// R116 — agentmemory N14 invariants on link_type taxonomy + coercion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MEMORY_LINK_TYPES } from "../../shared/schema";
import { coerceLinkType } from "../../server/memory-graph";

test("MEMORY_LINK_TYPES contains the 7 canonical edge kinds", () => {
  assert.deepEqual(
    [...MEMORY_LINK_TYPES].sort(),
    ["caused", "contradicts", "depends_on", "fixed", "related", "supersedes", "uses"].sort(),
  );
});

test("coerceLinkType passes through every canonical kind", () => {
  for (const k of MEMORY_LINK_TYPES) {
    assert.equal(coerceLinkType(k), k, `should pass through ${k}`);
  }
});

test("coerceLinkType normalises case + whitespace", () => {
  assert.equal(coerceLinkType("  USES "), "uses");
  assert.equal(coerceLinkType("DEPENDS_ON"), "depends_on");
});

test("coerceLinkType falls back to 'related' for unknown / null / empty", () => {
  assert.equal(coerceLinkType(null), "related");
  assert.equal(coerceLinkType(undefined), "related");
  assert.equal(coerceLinkType(""), "related");
  assert.equal(coerceLinkType("nonsense_kind"), "related");
  assert.equal(coerceLinkType("references"), "related"); // close-but-not-canonical → coerce
});

test("coerceLinkType never returns an off-taxonomy value (fail-CLOSED)", () => {
  const samples = ["", "  ", "\u0000", "../etc/passwd", '"; DROP TABLE--', "uses ", "uses\n"];
  for (const s of samples) {
    const out = coerceLinkType(s as any);
    assert.ok((MEMORY_LINK_TYPES as readonly string[]).includes(out), `off-taxonomy leak for input ${JSON.stringify(s)}: ${out}`);
  }
});
