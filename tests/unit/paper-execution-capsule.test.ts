import assert from "node:assert/strict";
import test from "node:test";
import express, { type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import {
  compilePaperExecutionCapsule,
} from "../../server/lib/paper-execution-capsule";
import { registerAdminRoutes } from "../../server/routes/admin";

function validManifest() {
  return {
    paper: {
      title: "A reproducible computational method",
      sourceUrl: "https://arxiv.org/abs/2509.06917",
      version: "v2",
    },
    repository: {
      sourceUrl: "https://github.com/example/method",
      revision: "0123456789abcdef",
    },
    datasets: [{
      name: "Public benchmark",
      sourceUrl: "https://example.org/datasets/benchmark",
      license: "CC-BY-4.0",
    }],
    tutorials: [{
      name: "Reproduce figure one",
      sourceUrl: "https://example.org/tutorials/figure-one",
      expectedArtifacts: ["figure-1.png"],
    }],
    supportedTasks: [{
      name: "score_variant",
      objective: "Score one bounded variant using the documented method.",
      requiredInputs: ["chromosome", "position", "reference", "alternate"],
      expectedOutputs: ["numeric score", "method version"],
    }],
    unsupportedTasks: ["Clinical diagnosis", "Treatment recommendation"],
    environment: {
      runtime: "Python 3.12",
      dependencies: ["method-lib==1.2.3"],
      hardware: "CPU",
      networkAccess: "none",
      estimatedCost: "$0.00 per fixed test",
    },
    independentEvaluator: "Reference outputs checked by a separate human-authored fixture.",
  };
}

test("valid manifests compile to deterministic report-only capsules without scientific or execution authority", () => {
  const manifest = validManifest();

  const first = compilePaperExecutionCapsule(manifest);
  const second = compilePaperExecutionCapsule({
    ...manifest,
    unsupportedTasks: [...manifest.unsupportedTasks].reverse(),
  });

  assert.equal(first.reportOnly, true);
  assert.equal(first.autonomyChanged, false);
  assert.equal(first.authorityEffect, "none");
  assert.equal(first.scientificValidation, "not_established");
  assert.equal(first.capsuleId, second.capsuleId);
  assert.deepEqual(first, second);
  assert.match(first.limitations.join(" "), /does not execute|scientific/i);
});

test("accessor-backed manifest fields are rejected without invoking untrusted code", () => {
  let invoked = false;
  const manifest = validManifest();
  Object.defineProperty(manifest, "paper", {
    enumerable: true,
    get() {
      invoked = true;
      return validManifest().paper;
    },
  });

  assert.throws(
    () => compilePaperExecutionCapsule(manifest),
    /accessor|plain data/i,
  );
  assert.equal(invoked, false);
});

test("accessor-backed and sparse nested arrays are rejected without invoking untrusted code", () => {
  for (const field of ["unsupportedTasks", "datasets"] as const) {
    let invoked = false;
    const manifest = validManifest();
    const values = manifest[field] as unknown[];
    Object.defineProperty(values, "0", {
      enumerable: true,
      get() {
        invoked = true;
        return field === "unsupportedTasks" ? "Clinical diagnosis" : validManifest().datasets[0];
      },
    });
    assert.throws(() => compilePaperExecutionCapsule(manifest), /accessor|plain data/i);
    assert.equal(invoked, false);
  }

  const sparse = validManifest();
  sparse.unsupportedTasks = new Array(1) as string[];
  assert.throws(() => compilePaperExecutionCapsule(sparse), /sparse/i);

  const huge = validManifest();
  huge.unsupportedTasks = new Array(0xffffffff) as string[];
  assert.throws(() => compilePaperExecutionCapsule(huge), /exceeds 12 items/i);

  const named = validManifest();
  Object.defineProperty(named.unsupportedTasks, "4294967295", {
    value: "not an array index",
    enumerable: true,
  });
  assert.throws(() => compilePaperExecutionCapsule(named), /named properties/i);

  const symbolKeyed = validManifest();
  Object.defineProperty(symbolKeyed.unsupportedTasks, Symbol("hidden"), {
    value: "not JSON data",
    enumerable: true,
  });
  assert.throws(() => compilePaperExecutionCapsule(symbolKeyed), /named properties/i);
});

test("set-like Unicode inputs use locale-independent canonical ordering", () => {
  const manifest = validManifest();
  manifest.unsupportedTasks = ["Ångström", "Zulu", "Éclair"];
  manifest.tutorials[0].expectedArtifacts = ["β.json", "A.json"];
  manifest.supportedTasks[0].requiredInputs = ["évidence", "alpha"];
  manifest.supportedTasks[0].expectedOutputs = ["結果", "score"];

  const reordered = structuredClone(manifest);
  reordered.unsupportedTasks.reverse();
  reordered.tutorials[0].expectedArtifacts.reverse();
  reordered.supportedTasks[0].requiredInputs.reverse();
  reordered.supportedTasks[0].expectedOutputs.reverse();

  assert.deepEqual(
    compilePaperExecutionCapsule(manifest),
    compilePaperExecutionCapsule(reordered),
  );
});

test("private and loopback source URLs are rejected, including bracketed IPv6", () => {
  for (const sourceUrl of [
    "https://127.0.0.1/paper",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/paper",
    "https://[::ffff:127.0.0.1]/paper",
  ]) {
    const manifest = validManifest();
    manifest.paper.sourceUrl = sourceUrl;
    assert.throws(
      () => compilePaperExecutionCapsule(manifest),
      /unsafe host/i,
      sourceUrl,
    );
  }
});

test("strict parsing rejects unknown fields and unsafe URL components", () => {
  const withUnknown = {
    ...validManifest(),
    executeNow: true,
  };
  assert.throws(
    () => compilePaperExecutionCapsule(withUnknown),
    /unknown field: executeNow/i,
  );

  for (const sourceUrl of [
    "http://example.org/paper",
    "https://user:password@example.org/paper",
    "https://example.org:8443/paper",
    "https://example.org/paper#hidden",
  ]) {
    const manifest = validManifest();
    manifest.paper.sourceUrl = sourceUrl;
    assert.throws(
      () => compilePaperExecutionCapsule(manifest),
      /HTTPS|credentials, fragments, or ports/i,
      sourceUrl,
    );
  }
});

test("missing reproducibility prerequisites remain explicit evidence gaps", () => {
  const manifest = validManifest();
  delete (manifest.paper as Partial<typeof manifest.paper>).version;
  delete (manifest as Partial<typeof manifest>).repository;
  delete (manifest.datasets[0] as Partial<typeof manifest.datasets[number]>).license;
  delete (manifest as Partial<typeof manifest>).independentEvaluator;
  manifest.environment = { dependencies: [] } as typeof manifest.environment;

  const capsule = compilePaperExecutionCapsule(manifest);
  assert.deepEqual(capsule.evidenceGaps, [
    "dataset_license_missing",
    "dependency_manifest_missing",
    "execution_cost_missing",
    "execution_not_performed",
    "hardware_requirement_missing",
    "independent_evaluator_missing",
    "independent_expected_result_unverified",
    "network_requirement_missing",
    "paper_version_missing",
    "repository_missing",
    "reproducibility_not_observed",
    "runtime_missing",
    "scientific_correctness_unverified",
    "source_content_unverified",
    "source_reachability_unverified",
  ]);
});

test("capsule compiler has no persistence, model, tool, process, filesystem-write, or network-fetch imports", () => {
  const source = readFileSync("server/lib/paper-execution-capsule.ts", "utf8");
  assert.doesNotMatch(
    source,
    /from\s+["'](?:\.\.\/db|\.\.\/tools|node:child_process|node:fs|node:http|node:https)["']/,
  );
  assert.doesNotMatch(source, /\b(?:fetch|executeTool|spawn|execFile|writeFile)\s*\(/);
});

test("paper execution capsule route is authenticated, admin-tenant-only, validated, and POST-only", async () => {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  registerAdminRoutes(app, {
    authMiddleware(req: Request, res: Response, next: () => void) {
      if (req.headers.authorization !== "session") {
        return res.status(401).json({ error: "Authentication required" });
      }
      next();
    },
    getTenantFromRequest(req) {
      return Number(req.headers["x-tenant-id"]);
    },
    isAdminRequest(req) {
      return req.headers["x-platform-admin"] === "1";
    },
    ADMIN_TENANT_ID: 1,
    requirePlatformAdmin: () => true,
    paperExecutionCapsuleCompiler: compilePaperExecutionCapsule,
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}/api/admin/paper-execution-capsule`;
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      });

    assert.equal((await post(validManifest())).status, 401);
    assert.equal((await post(validManifest(), {
      authorization: "session",
      "x-tenant-id": "2",
      "x-platform-admin": "1",
    })).status, 403);
    assert.equal((await post(validManifest(), {
      authorization: "session",
      "x-tenant-id": "1",
      "x-platform-admin": "0",
    })).status, 403);

    const response = await post(validManifest(), {
      authorization: "session",
      "x-tenant-id": "1",
      "x-platform-admin": "1",
    });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.reportOnly, true);
    assert.equal(body.authorityEffect, "none");
    assert.equal(body.scientificValidation, "not_established");

    assert.equal((await post({ paper: "invalid" }, {
      authorization: "session",
      "x-tenant-id": "1",
      "x-platform-admin": "1",
    })).status, 400);
    assert.equal((await fetch(url, {
      headers: {
        authorization: "session",
        "x-tenant-id": "1",
        "x-platform-admin": "1",
      },
    })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});