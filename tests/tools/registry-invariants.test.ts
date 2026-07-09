/**
 * Tools-layer-split S2 — invariants for the new `server/tools/` package.
 *
 * Contract: data/feature-contracts/tools-layer-split/plan.md (S2 acceptance):
 *   - no duplicate tool names (registration fails loud);
 *   - definition validation: snake_case name, non-empty description,
 *     object-typed JSON-Schema parameters;
 *   - the package is acyclic w.r.t. the rest of `server/` — no scaffold
 *     module may import anything outside `server/tools/`;
 *   - handler/definition pairing enforced by `defineTool`.
 *
 * NOTE: never imports `server/tools.ts` (monolith) — legacy inventory checks
 * live in tests/tools/source-union-parity.test.ts via static parsing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { defineTool, assertValidDefinition } from "../../server/tools/define-tool";
import {
  registerTools,
  getMigratedDefinitions,
  getMigratedHandler,
  getMigratedToolNames,
  isMigrated,
  __resetRegistryForTests,
} from "../../server/tools/registry";
import { stripTrustSignals, buildToolContext } from "../../server/tools/context";
import { unknownToolError } from "../../server/tools/unknown-tool";
import type { ToolDefinition } from "../../server/tools/types";

function validDef(name: string): ToolDefinition {
  return {
    type: "function",
    function: {
      name,
      description: `Test tool ${name}.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  };
}
const noopHandler = async () => ({ ok: true });

test("defineTool rejects malformed definitions, accepts valid ones", () => {
  assert.doesNotThrow(() => defineTool(validDef("good_tool"), noopHandler));

  const badName = validDef("BadName");
  assert.throws(() => assertValidDefinition(badName), /snake_case/);

  const emptyDesc = validDef("empty_desc");
  emptyDesc.function.description = "   ";
  assert.throws(() => assertValidDefinition(emptyDesc), /non-empty/);

  const badParams = validDef("bad_params");
  (badParams.function.parameters as any) = { type: "array" };
  assert.throws(() => assertValidDefinition(badParams), /JSON-Schema object/);

  const badType = { ...validDef("bad_type"), type: "tool" as any };
  assert.throws(() => assertValidDefinition(badType), /type must be "function"/);

  assert.throws(() => defineTool(validDef("no_handler"), undefined as any), /handler must be a function/);
});

test("registry rejects duplicate names and serves what it stores", () => {
  __resetRegistryForTests();
  registerTools([defineTool(validDef("alpha_tool"), noopHandler)]);
  registerTools([defineTool(validDef("beta_tool"), noopHandler)]);

  assert.throws(
    () => registerTools([defineTool(validDef("alpha_tool"), noopHandler)]),
    /duplicate tool name/,
  );

  assert.deepEqual(getMigratedToolNames().sort(), ["alpha_tool", "beta_tool"]);
  assert.equal(getMigratedDefinitions().length, 2);
  assert.equal(isMigrated("alpha_tool"), true);
  assert.equal(isMigrated("missing_tool"), false);
  assert.equal(typeof getMigratedHandler("beta_tool"), "function");
  assert.equal(getMigratedHandler("missing_tool"), undefined);
  __resetRegistryForTests();
  assert.equal(getMigratedToolNames().length, 0);
});

test("every registered definition passes full validation (parity of name/def/params/description)", () => {
  __resetRegistryForTests();
  registerTools([
    defineTool(validDef("gamma_tool"), noopHandler),
    defineTool(validDef("delta_tool"), noopHandler),
  ]);
  for (const def of getMigratedDefinitions()) {
    assert.doesNotThrow(() => assertValidDefinition(def));
    assert.equal(typeof getMigratedHandler(def.function.name), "function");
  }
  __resetRegistryForTests();
});

test("context: trust signals stripped from params; ctx built only from explicit args", () => {
  const dirty = {
    real_arg: 1,
    _tenantId: 999,
    _personaId: 7,
    _conversationId: 5,
    _approvedByGate: true,
    _rateLimitChecked: true,
    // Trust-seam authz signals must also be stripped so a migrated handler can
    // only ever read the trusted ctx value, never a caller-supplied one.
    _projectId: 42,
    _allowedPaths: ["/tmp/x"],
    // Telemetry/hint passthroughs must SURVIVE the strip (media/agentic read
    // them from params verbatim). Guard against accidental over-stripping.
    _projectDriveFolderId: "folder123",
    _invokedVia: "main_chat",
    _userId: "u1",
    _personaName: "Felix",
  };
  const clean = stripTrustSignals(dirty);
  assert.deepEqual(clean, {
    real_arg: 1,
    _projectDriveFolderId: "folder123",
    _invokedVia: "main_chat",
    _userId: "u1",
    _personaName: "Felix",
  });
  assert.equal((dirty as any)._tenantId, 999, "input must not be mutated");

  const ctx = buildToolContext({ tenantId: 1, rateLimitChecked: undefined as any });
  assert.equal(ctx.tenantId, 1);
  assert.equal(ctx.rateLimitChecked, false, "rateLimitChecked must be explicit-true only");

  // Trust-seam authz fields thread from explicit args onto ctx.
  const ctx2 = buildToolContext({ tenantId: 2, projectId: 42, allowedPaths: ["/tmp/x"] });
  assert.equal(ctx2.projectId, 42);
  assert.deepEqual(ctx2.allowedPaths, ["/tmp/x"]);
  const ctx3 = buildToolContext({ tenantId: 3 });
  assert.equal(ctx3.projectId, undefined, "projectId absent unless explicitly provided");
  assert.equal(ctx3.allowedPaths, undefined, "allowedPaths absent unless explicitly provided");
});

test("unknown-tool copy matches the legacy monolith arm byte-for-byte", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "server/tools.ts"), "utf8");
  const msg = unknownToolError("some_tool").error;
  // Legacy arm builds the same string with `"${name}"` interpolation.
  const legacyTemplateTail = msg.slice(msg.indexOf(". This tool does not exist yet."));
  assert.ok(
    src.includes(legacyTemplateTail),
    "legacy unknown-tool copy drifted from server/tools/unknown-tool.ts — keep them identical until S4 rewires it",
  );
});

test("package is acyclic w.r.t. server/: ALL modules (incl. domains/**) import only within server/tools/", () => {
  const pkgRoot = path.join(process.cwd(), "server/tools");

  // Recursively collect every .ts file in the package — S4+ growth lands in
  // server/tools/domains/**, so the boundary check must cover it too.
  const collect = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return collect(full);
      return e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [full] : [];
    });

  const files = collect(pkgRoot);
  assert.ok(files.length >= 5, `expected package files, saw ${files.length}`);

  const importRe = /^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const rel = path.relative(process.cwd(), file);
    for (const m of src.matchAll(importRe)) {
      const spec = m[1];
      if (spec.startsWith("node:")) continue; // stdlib only
      assert.ok(
        spec.startsWith("./") || spec.startsWith("../"),
        `${rel} imports "${spec}" — only node: stdlib and relative in-package imports allowed (acyclicity invariant, plan.md S2)`,
      );
      // Resolve the relative import and prove it stays INSIDE server/tools/.
      const resolved = path.resolve(path.dirname(file), spec);
      const within =
        resolved === pkgRoot || resolved.startsWith(pkgRoot + path.sep);
      assert.ok(
        within,
        `${rel} imports "${spec}" → resolves OUTSIDE server/tools/ (${path.relative(process.cwd(), resolved)}) — this can recurse back into server/tools.ts / the app graph (acyclicity invariant, plan.md S2)`,
      );
    }
  }
});
