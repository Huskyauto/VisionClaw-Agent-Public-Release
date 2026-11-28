import test from "node:test";
import assert from "node:assert/strict";
import { requestRemoteRenewal } from "../../scripts/lib/remote-release-renew";
import { REMOTE_RELEASE_REPO, REMOTE_RELEASE_WORKFLOW } from "../../scripts/lib/remote-release-contract";
import type { GitHubRequest } from "../../scripts/lib/remote-release-candidate";

const sourceDigest = "a".repeat(64);
const head = "b".repeat(40);
const base = "c".repeat(40);
const branch = `release-checks/${sourceDigest}`;
const repositoryId = 101;
const workflowId = 202;
const runId = 303;

function fixture(config: {
  runs?: any[];
  postStatus?: number;
  throwOnPost?: boolean;
  state?: Record<string, unknown>;
} = {}) {
  const calls: { route: string; method: string }[] = [];
  const run = {
    id: runId, run_attempt: 1, workflow_id: workflowId,
    repository: { id: repositoryId }, path: REMOTE_RELEASE_WORKFLOW,
    head_sha: head, head_branch: branch, event: "workflow_dispatch",
    status: "completed", conclusion: "failure",
  };
  const request: GitHubRequest = async (route, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ route, method });
    if (route === `/repos/${REMOTE_RELEASE_REPO}`)
      return Response.json({ id: repositoryId, private: true, default_branch: "main" });
    if (route.endsWith("/branches/main"))
      return Response.json({ commit: { sha: base } });
    if (route.endsWith(`/actions/workflows/${REMOTE_RELEASE_WORKFLOW.split("/").at(-1)}`))
      return Response.json({ id: workflowId, path: REMOTE_RELEASE_WORKFLOW, state: "active" });
    if (route.includes("/actions/workflows/") && route.includes("/runs?head_sha=")) {
      const runs = config.runs ?? [run];
      return Response.json({ total_count: runs.length, workflow_runs: runs });
    }
    if (method === "POST" && route.endsWith(`/actions/runs/${runId}/rerun`)) {
      if (config.throwOnPost) throw new Error("uncertain response");
      return new Response(null, { status: config.postStatus ?? 201 });
    }
    return new Response(null, { status: 404 });
  };
  const state = {
    version: 1,
    phase: "verified",
    sourceDigest,
    branch,
    head,
    base,
    repositoryId,
    workflowId,
    runId,
    runAttempt: 1,
    plan: { version: 1, repository: REMOTE_RELEASE_REPO, base, head, sourceDigest, changed: [], checks: [] },
    ...config.state,
  };
  return { request, calls, run, state };
}

test("journals one same-source renewal before the single rerun POST", async () => {
  const f = fixture();
  let journal: any;
  const result = await requestRemoteRenewal(f.request, f.state, async (update, id, attempt) => {
    journal = { update, id, attempt };
  });
  assert.equal(journal.id, runId);
  assert.equal(journal.attempt, 1);
  assert.equal(journal.update.phase, "renewal_requested");
  assert.equal(journal.update.runId, runId);
  assert.equal(journal.update.runAttempt, undefined);
  assert.equal(journal.update.expectedAttempt, 2);
  assert.equal(result.phase, "waiting");
  assert.equal(result.expectedAttempt, 2);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
  assert.equal(f.calls.at(-1)?.route, `/repos/${REMOTE_RELEASE_REPO}/actions/runs/${runId}/rerun`);
});

test("a failed renewal journal prevents the rerun POST", async () => {
  const f = fixture();
  await assert.rejects(requestRemoteRenewal(f.request, f.state, async () => {
    throw new Error("journal failed");
  }), /journal failed/);
  assert.equal(f.calls.some(call => call.method === "POST"), false);
});

test("running, duplicated or stale-identity runs are refused without POST", async () => {
  const f = fixture();
  const running = { ...f.run, status: "in_progress", conclusion: null };
  const duplicate = { ...f.run, id: runId + 1 };
  const wrongEvent = { ...f.run, event: "push" };
  const wrongBranch = { ...f.run, head_branch: `release-checks/${"d".repeat(64)}` };
  const wrongHead = { ...f.run, head_sha: "e".repeat(40) };
  const cases = [
    fixture({ runs: [running] }),
    fixture({ runs: [f.run, duplicate] }),
    fixture({ runs: [wrongEvent] }),
    fixture({ runs: [wrongBranch] }),
    fixture({ runs: [wrongHead] }),
    fixture({ state: { runAttempt: 2 } }),
    fixture({ state: { runId: runId + 1 } }),
    fixture({ state: { repositoryId: repositoryId + 1 } }),
    fixture({ state: { workflowId: workflowId + 1 } }),
    fixture({ state: { branch: `release-checks/${"d".repeat(64)}` } }),
    fixture({ state: { plan: { ...f.state.plan, head: "e".repeat(40) } } }),
    fixture({ state: { plan: { ...f.state.plan, sourceDigest: "e".repeat(64) } } }),
  ];
  for (const item of cases) {
    let journaled = false;
    await assert.rejects(requestRemoteRenewal(item.request, item.state, async () => { journaled = true; }));
    assert.equal(journaled, false);
    assert.equal(item.calls.some(call => call.method === "POST"), false);
  }
});

test("an uncertain POST response is never retried", async () => {
  const f = fixture({ throwOnPost: true });
  await assert.rejects(requestRemoteRenewal(f.request, f.state, async () => {}), /uncertain response/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

test("only GitHub's created response is accepted and not retried", async () => {
  const f = fixture({ postStatus: 200 });
  await assert.rejects(requestRemoteRenewal(f.request, f.state, async () => {}), /201/);
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});
