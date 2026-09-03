import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { registerProjectsRoutes } from "../../server/routes/projects";

test("frontier concept endpoints always stop at the platform-admin guard", async () => {
  const app = express();
  let guardCalls = 0;
  registerProjectsRoutes(app, {
    authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    getTenantFromRequest: () => 1,
    requirePlatformAdmin: (_req, res) => {
      guardCalls++;
      res.status(403).json({ error: "Platform admin access required" });
      return false;
    },
    upload: {
      array: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    } as any,
    SAFE_EXTENSIONS: {},
    UPLOADS_DIR: "/tmp/frontier-concepts-route-test-uploads",
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    for (const endpoint of [
      "/api/frontier-revenue/discoveries",
      "/api/frontier-revenue/discoveries/concept-a",
      "/api/frontier-revenue/discoveries/concept-a/files/brief",
      "/api/frontier-revenue/runs",
      "/api/frontier-revenue/runs/frontier-income-2026-08-22T08-00-23-443Z",
      "/api/frontier-revenue/runs/frontier-income-2026-08-22T08-00-23-443Z/file",
    ]) {
      const response = await fetch(`${baseUrl}${endpoint}`);
      assert.equal(response.status, 403, endpoint);
      assert.deepEqual(await response.json(), { error: "Platform admin access required" }, endpoint);
    }
    assert.equal(guardCalls, 6);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm("/tmp/frontier-concepts-route-test-uploads", { recursive: true, force: true });
  }
});

test("an owner can browse a saved frontier jury report without promoting it to a concept", async () => {
  const runRoot = await mkdtemp(path.join(os.tmpdir(), "frontier-jury-run-route-test-"));
  const escapedDir = await mkdtemp(path.join(os.tmpdir(), "frontier-jury-run-escape-test-"));
  const runId = "frontier-income-premium-fallback-2026-08-22T08-00-23-443Z";
  const rawRun = {
    prompt: "Find practical income opportunities within current VisionClaw capabilities.",
    aggregated: "## Practical Opportunity Comparison\n\nA saved monetization report.",
    aggregatorModel: "google/gemini-3.7-flash",
    proposers: [
      { modelId: "deepseek/deepseek-v4-pro-0813", providerLane: "openference", ok: true },
      { modelId: "z-ai/glm-5.2", providerLane: "profundo", ok: true },
      { modelId: "google/gemini-3.7-flash", providerLane: "google", ok: true },
    ],
    concordance: 0.72,
    shouldEscalate: false,
  };
  await writeFile(path.join(runRoot, `${runId}.json`), JSON.stringify(rawRun, null, 2));

  const app = express();
  registerProjectsRoutes(app, {
    authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    getTenantFromRequest: () => 1,
    requirePlatformAdmin: () => true,
    upload: {
      array: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    } as any,
    SAFE_EXTENSIONS: {},
    UPLOADS_DIR: path.join(runRoot, "uploads"),
    frontierJuryRunRoot: runRoot,
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const listResponse = await fetch(`${baseUrl}/api/frontier-revenue/runs`);
    assert.equal(listResponse.status, 200);
    assert.match(listResponse.headers.get("cache-control") || "", /no-store/);
    const runs = await listResponse.json();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, runId);
    assert.equal(runs[0].createdAt, "2026-08-22T08:00:23.443Z");
    assert.equal(runs[0].status, "complete");
    assert.equal(runs[0].successfulProposers, 3);

    const detailResponse = await fetch(`${baseUrl}/api/frontier-revenue/runs/${runId}`);
    assert.equal(detailResponse.status, 200);
    assert.match(detailResponse.headers.get("cache-control") || "", /no-store/);
    const detail = await detailResponse.json();
    assert.equal(detail.aggregated, rawRun.aggregated);
    assert.equal(detail.rawRun, undefined);
    assert.equal(detail.sourceUrl, `/api/frontier-revenue/runs/${runId}/file`);

    const sourceResponse = await fetch(`${baseUrl}${detail.sourceUrl}`);
    assert.equal(sourceResponse.status, 200);
    assert.match(sourceResponse.headers.get("cache-control") || "", /no-store/);
    assert.match(sourceResponse.headers.get("content-disposition") || "", /inline/);
    assert.deepEqual(await sourceResponse.json(), rawRun);

    const invalidIdResponse = await fetch(`${baseUrl}/api/frontier-revenue/runs/not-a-jury-run`);
    assert.equal(invalidIdResponse.status, 404);

    const escapedRunId = "frontier-income-2026-08-22T08-01-23-443Z";
    const escapedFile = path.join(escapedDir, `${escapedRunId}.json`);
    await writeFile(escapedFile, JSON.stringify(rawRun));
    await symlink(escapedFile, path.join(runRoot, `${escapedRunId}.json`));
    const escapedResponse = await fetch(`${baseUrl}/api/frontier-revenue/runs/${escapedRunId}`);
    assert.equal(escapedResponse.status, 500);
    const escapedListResponse = await fetch(`${baseUrl}/api/frontier-revenue/runs`);
    assert.equal(escapedListResponse.status, 500);
    assert.match(escapedListResponse.headers.get("cache-control") || "", /no-store/);

    await rm(path.join(runRoot, `${escapedRunId}.json`));
    const nonRegularRunId = "frontier-income-2026-08-22T08-02-23-443Z";
    await mkdir(path.join(runRoot, `${nonRegularRunId}.json`));
    const nonRegularListResponse = await fetch(`${baseUrl}/api/frontier-revenue/runs`);
    assert.equal(nonRegularListResponse.status, 500);
    assert.match(nonRegularListResponse.headers.get("cache-control") || "", /no-store/);

    await rm(path.join(runRoot, `${nonRegularRunId}.json`), { recursive: true });
    await writeFile(path.join(runRoot, "frontier-income-2026-08-02T08-00-23-443Z.json"), "{ malformed");
    const corruptListResponse = await fetch(`${baseUrl}/api/frontier-revenue/runs`);
    assert.equal(corruptListResponse.status, 500);
    assert.match(corruptListResponse.headers.get("cache-control") || "", /no-store/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(runRoot, { recursive: true, force: true });
    await rm(escapedDir, { recursive: true, force: true });
  }
});

test("an owner can browse an archived concept and open each evidence file", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "frontier-concepts-route-test-"));
  const escapedDir = await mkdtemp(path.join(os.tmpdir(), "frontier-concepts-escape-test-"));
  const conceptId = "compliance-evidence-desk-abc123";
  const conceptDir = path.join(rootDir, "archive", conceptId);
  await mkdir(conceptDir, { recursive: true });
  await mkdir(path.join(rootDir, "runs"), { recursive: true });

  const candidate = {
    title: "Compliance Evidence Desk",
    targetBuyer: "Small regulated service firms",
    painfulJob: "Prepare recurring evidence without recreating the same documents.",
    paidOffer: "A fixed-scope evidence-readiness desk.",
    existingSurfaceComparison: "A customer-owned evidence workflow, not an audit.",
    buildDelta: "A scoped evidence register.",
    proofExperiment: "Offer a paid readiness sprint to five qualified firms.",
    priceCostModel: "$750 setup; under $75 delivery cost.",
    evidencePlan: "Verify renewal deadlines and buyer interviews.",
    operationalRisks: "Customer documents require tenant isolation and human approval.",
    killCriterion: "No paid sprint after five qualified conversations.",
    scores: {
      novelty: 82,
      buyerPain: 78,
      willingnessToPay: 70,
      buildEffort: 40,
      timeToProof: 45,
      evidenceQuality: 55,
      operationalRisk: 35,
    },
  };
  await writeFile(path.join(rootDir, "archive", "index.json"), JSON.stringify({
    schema_version: 1,
    concepts: [{
      id: conceptId,
      title: candidate.title,
      targetBuyer: candidate.targetBuyer,
      paidOffer: candidate.paidOffer,
      buildDelta: candidate.buildDelta,
      scores: candidate.scores,
      noveltyStatus: "new",
      humanReviewState: "needs_review",
      createdAt: "2026-08-22T12:00:00.000Z",
      sourceRunCount: 1,
      archiveDirectory: conceptId,
      contentHash: "abc",
      sourceRunIds: ["frontier-run-1"],
      sourceRunFiles: ["runs/run.json"],
      sourceBriefFiles: [`archive/${conceptId}/README.md`],
    }],
  }, null, 2));
  await writeFile(path.join(conceptDir, "concept.json"), JSON.stringify({
    schema_version: 1,
    concept_id: conceptId,
    candidate,
    source_run_ids: ["frontier-run-1"],
  }, null, 2));
  await writeFile(path.join(conceptDir, "README.md"), "# Compliance Evidence Desk\n\nHuman decision required.\n");
  await writeFile(path.join(rootDir, "runs", "run.json"), JSON.stringify({
    run_id: "frontier-run-1",
    external_commitments: "none",
  }));

  const app = express();
  registerProjectsRoutes(app, {
    authMiddleware: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    getTenantFromRequest: () => 1,
    requirePlatformAdmin: (_req, _res) => true,
    upload: {
      array: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    } as any,
    SAFE_EXTENSIONS: {},
    UPLOADS_DIR: path.join(rootDir, "uploads"),
    frontierConceptRoot: rootDir,
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  try {
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const listResponse = await fetch(`${baseUrl}/api/frontier-revenue/discoveries`);
    assert.equal(listResponse.status, 200);
    assert.deepEqual((await listResponse.json()).map((item: { id: string }) => item.id), [conceptId]);

    const detailResponse = await fetch(`${baseUrl}/api/frontier-revenue/discoveries/${conceptId}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.title, candidate.title);
    assert.equal(detail.humanReviewState, "needs_review");
    assert.match(detail.urls.brief, new RegExp(`/files/brief$`));
    assert.match(detail.urls.concept, new RegExp(`/files/concept$`));
    assert.match(detail.urls.sourceRun, new RegExp(`/files/source$`));

    for (const [kind, contentType, expectedText] of [
      ["brief", "text/markdown", "Human decision required."],
      ["concept", "application/json", candidate.title],
      ["source", "application/json", "frontier-run-1"],
    ] as const) {
      const fileResponse = await fetch(`${baseUrl}${detail.urls[kind === "source" ? "sourceRun" : kind]}`);
      assert.equal(fileResponse.status, 200, kind);
      assert.match(fileResponse.headers.get("content-type") || "", new RegExp(contentType.replace("/", "\\/")));
      assert.match(await fileResponse.text(), new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), kind);
      assert.match(fileResponse.headers.get("content-disposition") || "", /inline/);
    }

    const escapedFile = path.join(escapedDir, "outside-archive.txt");
    const escapedContent = "content outside the frontier archive";
    await writeFile(escapedFile, escapedContent);
    for (const [kind, filePath, originalContents] of [
      ["concept", path.join(conceptDir, "concept.json"), JSON.stringify({
        schema_version: 1,
        concept_id: conceptId,
        candidate,
        source_run_ids: ["frontier-run-1"],
      }, null, 2)],
      ["brief", path.join(conceptDir, "README.md"), "# Compliance Evidence Desk\n\nHuman decision required.\n"],
      ["source", path.join(rootDir, "runs", "run.json"), JSON.stringify({
        run_id: "frontier-run-1",
        external_commitments: "none",
      })],
    ] as const) {
      await rm(filePath);
      await symlink(escapedFile, filePath);
      const escapedResponse = await fetch(`${baseUrl}${detail.urls[kind === "source" ? "sourceRun" : kind]}`);
      assert.equal(escapedResponse.status, 500, `${kind} symlink must be rejected as a corrupt archive`);
      assert.doesNotMatch(await escapedResponse.text(), new RegExp(escapedContent), `${kind} response must not expose outside content`);
      await rm(filePath);
      await writeFile(filePath, originalContents);

      await rm(filePath);
      const missingResponse = await fetch(`${baseUrl}${detail.urls[kind === "source" ? "sourceRun" : kind]}`);
      assert.equal(missingResponse.status, 404, `${kind} missing file must return not found`);
      await writeFile(filePath, originalContents);
    }

    assert.equal(await readFile(path.join(conceptDir, "README.md"), "utf8"), "# Compliance Evidence Desk\n\nHuman decision required.\n");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(rootDir, { recursive: true, force: true });
    await rm(escapedDir, { recursive: true, force: true });
  }
});