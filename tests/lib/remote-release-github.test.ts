import test from "node:test";
import assert from "node:assert/strict";
import {
  REMOTE_RELEASE_REPO,
  REMOTE_RELEASE_WORKFLOW,
  type RemoteReleasePlan,
} from "../../scripts/lib/remote-release-contract";
import { createRemoteGitHubClient } from "../../scripts/lib/remote-release-github";

const repoId = 1001;
const workflowId = 2002;
const runId = 3003;
const attempt = 1;
const mainSha = "a".repeat(40);
const head = "b".repeat(40);
const branch = `release-checks/${"c".repeat(12)}`;

function plan(): RemoteReleasePlan {
  return {
    version: 1,
    repository: REMOTE_RELEASE_REPO,
    base: mainSha,
    head,
    sourceDigest: "d".repeat(64),
    changed: ["server/example.ts"],
    checks: [],
  };
}

function responseJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function runPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: runId,
    run_attempt: attempt,
    workflow_id: workflowId,
    path: REMOTE_RELEASE_WORKFLOW,
    repository: { id: repoId },
    head_sha: head,
    head_branch: branch,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
}

function mockTransport(options: {
  privateRepo?: boolean;
  branchSha?: string;
  run?: Record<string, unknown>;
  jobs?: unknown[];
  artifacts?: unknown[];
  artifactResponse?: Response;
} = {}) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    calls.push({ path, init });
    if (path === `/repos/${REMOTE_RELEASE_REPO}`) {
      return responseJson({
        id: repoId, private: options.privateRepo ?? true, default_branch: "main",
      });
    }
    if (path === `/repos/${REMOTE_RELEASE_REPO}/branches/main`) {
      return responseJson({ name: "main", commit: { sha: mainSha } });
    }
    if (path === `/repos/${REMOTE_RELEASE_REPO}/actions/workflows/security-checks.yml`) {
      return responseJson({ id: workflowId, path: REMOTE_RELEASE_WORKFLOW, state: "active" });
    }
    if (path === `/repos/${REMOTE_RELEASE_REPO}/branches/${encodeURIComponent(branch)}`) {
      return responseJson({ name: branch, commit: { sha: options.branchSha ?? head } });
    }
    if (path.endsWith("/dispatches")) return new Response(null, { status: 204 });
    if (path === `/repos/${REMOTE_RELEASE_REPO}/actions/workflows/security-checks.yml/runs?head_sha=${head}&per_page=100`) {
      return responseJson({ total_count: 1, workflow_runs: [runPayload()] });
    }
    if (path === `/repos/${REMOTE_RELEASE_REPO}/actions/runs/${runId}/attempts/${attempt}`) {
      return responseJson(runPayload(options.run));
    }
    if (path === `/repos/${REMOTE_RELEASE_REPO}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`) {
      return responseJson({ total_count: options.jobs?.length ?? 0, jobs: options.jobs ?? [] });
    }
    if (path === `/repos/${REMOTE_RELEASE_REPO}/actions/runs/${runId}/artifacts?per_page=100`) {
      return responseJson({ total_count: options.artifacts?.length ?? 0, artifacts: options.artifacts ?? [] });
    }
    if (path === `/repos/${REMOTE_RELEASE_REPO}/actions/artifacts/765/zip`) {
      return options.artifactResponse ?? new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }
    throw new Error(`Unexpected mock request: ${path}`);
  };
  return { client: createRemoteGitHubClient(request), calls };
}

function artifact() {
  return {
    id: 765,
    name: `remote-release-${runId}-${attempt}`,
    expired: false,
    workflow_run: { id: runId },
  };
}

test("metadata, dispatch, run listing, inspection and artifact bytes use fixed GitHub API paths", async () => {
  const { client, calls } = mockTransport({
    jobs: [{ name: "Remote release", status: "completed", conclusion: "success" }],
    artifacts: [artifact()],
  });
  assert.deepEqual(await client.metadata(), { repositoryId: repoId, workflowId, mainSha });

  await client.dispatch(branch, plan());
  const dispatches = calls.filter(call => call.init?.method === "POST");
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].path, `/repos/${REMOTE_RELEASE_REPO}/actions/workflows/security-checks.yml/dispatches`);
  assert.deepEqual(JSON.parse(String(dispatches[0].init?.body)), {
    ref: branch,
    inputs: {
      release_base: mainSha,
      release_head: head,
      release_source: "d".repeat(64),
    },
  });

  assert.deepEqual(await client.findRuns(head), [{
    runId, runAttempt: attempt, head, branch, event: "workflow_dispatch",
    status: "completed", conclusion: "success",
  }]);
  const runListPath = calls.find(call => call.path.includes("/runs?"))?.path;
  assert.equal(new URLSearchParams(runListPath?.split("?")[1]).get("head_sha"), head);
  assert.equal(new URLSearchParams(runListPath?.split("?")[1]).has("head"), false);
  const inspected = await client.inspect(runId, attempt);
  assert.equal(inspected.artifactId, 765);
  assert.equal(inspected.trusted.repositoryId, repoId);
  assert.equal(inspected.trusted.workflowId, workflowId);
  assert.equal(inspected.trusted.head, head);
  assert.equal(inspected.trusted.artifact.runId, runId);
  assert.deepEqual([...await client.downloadArtifact(765)], [1, 2, 3]);
});

test("dispatch refuses a non-private repository and stale branch before any POST", async () => {
  const privateFailure = mockTransport({ privateRepo: false });
  await assert.rejects(privateFailure.client.dispatch(branch, plan()), /not private/);
  assert.equal(privateFailure.calls.filter(call => call.init?.method === "POST").length, 0);

  const stale = mockTransport({ branchSha: "e".repeat(40) });
  await assert.rejects(stale.client.dispatch(branch, plan()), /branch SHA/);
  assert.equal(stale.calls.filter(call => call.init?.method === "POST").length, 0);
});

test("dispatch refuses unsafe refs and malformed or mismatched plans without posting", async () => {
  const { client, calls } = mockTransport();
  await assert.rejects(client.dispatch("main", plan()), /not allowed/);
  const mismatched = plan();
  mismatched.head = "e".repeat(40);
  await assert.rejects(client.dispatch(branch, mismatched), /branch SHA/);
  assert.equal(calls.filter(call => call.init?.method === "POST").length, 0);
});

test("inspection rejects unsupported run attempts and artifacts not associated with that run", async () => {
  const wrongAttempt = mockTransport({ run: { run_attempt: attempt + 1 } });
  await wrongAttempt.client.metadata();
  await assert.rejects(wrongAttempt.client.inspect(runId, attempt), /identity metadata/);

  for (const artifacts of [
    [],
    [{ ...artifact(), workflow_run: { id: runId + 1 } }],
    [{ ...artifact(), expired: true }],
    [artifact(), artifact()],
  ]) {
    const invalidArtifact = mockTransport({ jobs: [], artifacts });
    await invalidArtifact.client.metadata();
    await assert.rejects(invalidArtifact.client.inspect(runId, attempt));
  }
});

test("inspection checks run repository and workflow numeric IDs against discovered fixed IDs", async () => {
  for (const run of [
    { repository: { id: repoId + 1 } },
    { workflow_id: workflowId + 1 },
  ]) {
    const mismatch = mockTransport({ run, artifacts: [artifact()] });
    await mismatch.client.metadata();
    await assert.rejects(mismatch.client.inspect(runId, attempt), /identity metadata/);
  }
});

test("metadata rejects workflow/repository identity drift and run listing rejects truncation", async () => {
  const notPrivate = mockTransport({ privateRepo: false });
  await assert.rejects(notPrivate.client.metadata(), /not private/);

  const truncated = mockTransport();
  await truncated.client.metadata();
  // A complete single-page response is mandatory; no fallback/pagination guess is allowed.
  const request = createRemoteGitHubClient(async path => {
    if (path === `/repos/${REMOTE_RELEASE_REPO}`) return responseJson({ id: repoId, private: true, default_branch: "main" });
    if (path === `/repos/${REMOTE_RELEASE_REPO}/branches/main`) return responseJson({ name: "main", commit: { sha: mainSha } });
    if (path === `/repos/${REMOTE_RELEASE_REPO}/actions/workflows/security-checks.yml`) return responseJson({ id: workflowId, path: REMOTE_RELEASE_WORKFLOW, state: "active" });
    if (path.includes("/runs?")) return responseJson({ total_count: 2, workflow_runs: [runPayload()] });
    throw new Error(`Unexpected mock request: ${path}`);
  });
  await request.metadata();
  await assert.rejects(request.findRuns(head), /incomplete or truncated/);
});

test("metadata pins repository/workflow numeric identities for the client session", async () => {
  let workflowReads = 0;
  const client = createRemoteGitHubClient(async path => {
    if (path === `/repos/${REMOTE_RELEASE_REPO}`) {
      return responseJson({ id: repoId, private: true, default_branch: "main" });
    }
    if (path === `/repos/${REMOTE_RELEASE_REPO}/branches/main`) {
      return responseJson({ name: "main", commit: { sha: mainSha } });
    }
    if (path === `/repos/${REMOTE_RELEASE_REPO}/actions/workflows/security-checks.yml`) {
      workflowReads++;
      return responseJson({
        id: workflowReads === 1 ? workflowId : workflowId + 1,
        path: REMOTE_RELEASE_WORKFLOW,
        state: "active",
      });
    }
    throw new Error(`Unexpected mock request: ${path}`);
  });
  await client.metadata();
  await assert.rejects(client.metadata(), /numeric identity changed/);
});

test("artifact downloads reject redirects and enforce a bounded streamed body", async () => {
  const redirected = mockTransport({
    jobs: [],
    artifacts: [artifact()],
    artifactResponse: new Response(null, {
    status: 302, headers: { Location: "https://untrusted.invalid/archive.zip" },
    }),
  });
  await redirected.client.metadata();
  await redirected.client.inspect(runId, attempt);
  await assert.rejects(redirected.client.downloadArtifact(765), /redirects/);

  const oversized = mockTransport({
    jobs: [],
    artifacts: [artifact()],
    artifactResponse: new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const block = new Uint8Array(16 * 1024 * 1024);
        controller.enqueue(block);
        controller.enqueue(block);
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    }),
    { status: 200 },
    ),
  });
  await oversized.client.metadata();
  await oversized.client.inspect(runId, attempt);
  await assert.rejects(oversized.client.downloadArtifact(765), /size limit/);
});
