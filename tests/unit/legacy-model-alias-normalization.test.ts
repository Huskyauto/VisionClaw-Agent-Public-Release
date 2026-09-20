/**
 * tests/unit/legacy-model-alias-normalization.test.ts
 *
 * Task 72 (gpt-4.1 → gpt-5 upgrade) regression guard: conversations and
 * settings persisted BEFORE the upgrade still carry the legacy id "gpt-4.1".
 * Request paths in server/routes.ts and server/chat-engine.ts hard-validate
 * the conversation model against MODEL_REGISTRY before any provider-level
 * aliasing runs, so a legacy id must be normalized FIRST or those rows die
 * with "Unknown model" at runtime. This suite proves:
 *   1. normalizeModelId maps every LEGACY_MODEL_ALIASES key to an id that
 *      exists in MODEL_REGISTRY (i.e. normalization always lands on a
 *      registered model — the exact check the request paths perform).
 *   2. "gpt-4.1" specifically resolves to "gpt-5" and passes the registry
 *      lookup used by the request paths.
 *   3. Both request-path boundaries actually call normalizeModelId on the
 *      persisted conversation model (static source check, so a refactor
 *      that drops the normalization fails loudly here).
 *
 * Run: node --import tsx --test tests/unit/legacy-model-alias-normalization.test.ts
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MODEL_REGISTRY,
  LEGACY_MODEL_ALIASES,
  normalizeModelId,
} from "../../server/providers";

// Providers chain holds open handles (timers); force clean exit like the
// sibling resilient/dispatch/last-resort suites.
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

test("every legacy alias normalizes to a registered model", () => {
  for (const [legacy, target] of Object.entries(LEGACY_MODEL_ALIASES)) {
    const normalized = normalizeModelId(legacy);
    assert.equal(normalized, target, `normalizeModelId(${legacy})`);
    const registered = MODEL_REGISTRY.find((m) => m.id === normalized);
    assert.ok(
      registered,
      `legacy alias "${legacy}" → "${normalized}" must exist in MODEL_REGISTRY or persisted rows fail "Unknown model"`,
    );
  }
});

test("persisted gpt-4.1 resolves to gpt-5 and passes the registry check", () => {
  const model = normalizeModelId("gpt-4.1");
  assert.equal(model, "gpt-5");
  const registeredModel = MODEL_REGISTRY.find((m) => m.id === model);
  assert.ok(registeredModel, "gpt-5 must be in MODEL_REGISTRY");
});

test("non-legacy ids pass through normalizeModelId unchanged", () => {
  assert.equal(normalizeModelId("gpt-5"), "gpt-5");
  assert.equal(normalizeModelId("auto"), "auto");
  assert.equal(normalizeModelId("totally-unknown"), "totally-unknown");
});

test("conversation create/update routes normalize legacy model ids before tenant validation", () => {
  const src = readFileSync("server/routes/conversations.ts", "utf8");
  assert.match(
    src,
    /let requestedModel = normalizeModelId\(/,
    "create flow must normalize the requested model before validateModelForTenant",
  );
  assert.match(
    src,
    /updateData\.model = normalizeModelId\(updateData\.model\)/,
    "patch flow must normalize updateData.model before validateModelForTenant",
  );
});

test("request-path boundaries normalize the persisted conversation model", () => {
  for (const file of ["server/routes.ts", "server/chat-engine.ts"]) {
    const src = readFileSync(file, "utf8");
    assert.match(
      src,
      /normalizeModelId\(conv\.model/,
      `${file} must normalize conv.model before the MODEL_REGISTRY validation`,
    );
  }
});
