#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { blobHash, candidateSnapshotIdentity, readCandidate, uploadCandidate, type GitHubRequest } from "./lib/remote-release-candidate";
import { createRemoteGitHubClient } from "./lib/remote-release-github";
import { createRemoteReleasePlan } from "./lib/remote-release-plan";
import { validateRemoteReleaseEvidence } from "./lib/remote-release-verifier";
import { readRemoteEvidence } from "./lib/remote-release-evidence";
import { REMOTE_RELEASE_REPO, type RemoteReleasePlan } from "./lib/remote-release-contract";
import { classifyReleaseScope } from "./lib/targeted-release-check";
import { setupSnapshot, uploadSetup } from "./lib/remote-release-setup";
import { changedRepositoryPaths, readGitTree, readRepositoryTree, verifyCandidateTree } from "./lib/remote-release-tree";
import { requestRemoteRenewal } from "./lib/remote-release-renew";

const ROOT = process.cwd();
const STATE = path.resolve(ROOT, ".local/remote-release");
const API = `/repos/${REMOTE_RELEASE_REPO}`;
interface State {
  version: 1; phase: string; sourceDigest: string; createdAt: string;
  branch?: string; head?: string; base?: string;
  repositoryId?: number; workflowId?: number; plan?: RemoteReleasePlan;
  runId?: number; runAttempt?: number; expectedAttempt?: number; reportPath?: string;
}

function localDirectory(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!lstatSync(dir).isDirectory() || realpathSync(dir) !== dir) throw Error("Operator directory must not follow symlinks");
}
function stateFile(file: string) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(STATE + path.sep) || realpathSync(resolved) !== resolved ||
      !lstatSync(resolved).isFile() || lstatSync(resolved).size > 2 * 1024 * 1024)
    throw Error("State must be a regular operator file inside .local/remote-release");
  return resolved;
}
const save = (file: string, state: State) => writeFileSync(file, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });

/** Reauthentication must not replace identical report bytes already independently reviewed. */
export function reusableCollectedReport(
  root: string, relative: string | undefined, expected: any, files: Map<string, Buffer>,
): string | undefined {
  if (!relative) return undefined;
  if (!/^\.local\/release-checks\/run-[A-Za-z0-9]+\/report\.json$/.test(relative))
    throw Error("Unsafe existing remote report path");
  const full = path.resolve(root, relative);
  const regular = (file: string, limit: number) => {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(file) !== file || stat.size > limit)
      throw Error("Unsafe or oversized existing remote evidence");
    return readFileSync(file);
  };
  const prior = JSON.parse(regular(full, 2 * 1024 * 1024).toString("utf8"));
  if (prior.remote?.trusted?.runId !== expected.remote.trusted.runId ||
      prior.remote?.trusted?.runAttempt !== expected.remote.trusted.runAttempt) return undefined;
  const { createdAt: oldTime, ...oldContents } = prior;
  const { createdAt: newTime, ...newContents } = expected;
  if (JSON.stringify(oldContents) !== JSON.stringify(newContents))
    throw Error("Previously collected remote report differs from authenticated evidence");
  for (const [name, bytes] of files) {
    if (name === "plan.json") continue;
    if (!regular(path.join(path.dirname(full), path.basename(name)), 8 * 1024 * 1024).equals(bytes))
      throw Error("Previously collected receipt/log differs from authenticated evidence");
  }
  return relative;
}

/** Connector authentication stays in the SDK; signed artifact URLs are never logged. */
export function connectorTransport(proxy = new ReplitConnectors().createProxyFetch("github")): GitHubRequest {
  return async (route, init = {}) => {
    if (!route.startsWith(API) || route.includes("..")) throw Error("Unexpected GitHub request route");
    const response = await proxy(route, { ...init, redirect: "manual", signal: AbortSignal.timeout(45_000) });
    if (response.status < 300 || response.status >= 400) return response;
    if (init.method !== "GET" || !/^\/repos\/Huskyauto\/VisionClaw-Agent\/actions\/artifacts\/\d+\/zip$/.test(route))
      throw Error("Unexpected GitHub redirect");
    const location = response.headers.get("location");
    if (!location) throw Error("Missing GitHub artifact location");
    const url = new URL(location);
    if (url.protocol !== "https:" || url.username || url.password ||
        !/^[a-z0-9-]+\.blob\.core\.windows\.net$/i.test(url.hostname))
      throw Error("Untrusted artifact storage location");
    return fetch(url, { redirect: "error", signal: AbortSignal.timeout(45_000) });
  };
}

async function changedPaths(request: GitHubRequest, base: string, head: string) {
  return changedRepositoryPaths(request, base, head);
}

async function upload(approved: boolean, request: GitHubRequest) {
  if (!approved) throw Error("Use upload --allow-test-branch-upload only with the owner's explicit approval");
  localDirectory(STATE);
  const candidate = readCandidate();
  const file = path.join(STATE, `state-${candidate.sourceDigest}.json`);
  if (existsSync(file)) throw Error(`Candidate already has operator state; inspect it rather than duplicate submission: ${file}`);
  const state: State = { version: 1, phase: "upload_requested",
    sourceDigest: candidate.sourceDigest, createdAt: new Date().toISOString() };
  writeFileSync(file, JSON.stringify(state, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  try {
    Object.assign(state, await uploadCandidate(request, candidate, true));
    state.phase = "uploaded";
    save(file, state);
    const client = createRemoteGitHubClient(request);
    const meta = await client.metadata();
    if (meta.repositoryId !== state.repositoryId) throw Error("Repository identity changed after upload");
    const changed = await changedPaths(request, state.base!, state.head!);
    state.workflowId = meta.workflowId;
    state.plan = createRemoteReleasePlan({ base: state.base!, head: state.head!,
      sourceDigest: candidate.sourceDigest, changed });
    save(file, state);
    console.log(JSON.stringify({ state: path.relative(ROOT, file), phase: state.phase,
      branch: state.branch, checks: state.plan.checks.map(c => c.id) }, null, 2));
  } catch (error) {
    state.phase = state.head ? "uploaded_needs_inspection" : "upload_uncertain";
    save(file, state);
    throw error;
  }
}

/** Read-only recovery after an uncertain ref response or interrupted planning. */
export async function reconcile(state: State, request: GitHubRequest): Promise<State> {
  if (state.version !== 1 || !/^[a-f0-9]{64}$/.test(state.sourceDigest))
    throw Error("Invalid operator recovery identity");
  const candidate = readCandidate();
  if (candidate.sourceDigest !== state.sourceDigest) throw Error("Recovery source changed");
  const client = createRemoteGitHubClient(request);
  const meta = await client.metadata();
  const get = async (route: string) => {
    const r = await request(API + route, { method: "GET" });
    if (!r.ok) throw Error("No-write recovery could not read the candidate");
    return r.json();
  };
  const branch = `release-checks/${state.sourceDigest}`;
  const ref = await get(`/git/ref/heads/${branch}`);
  const head = ref.object?.sha;
  if (!/^[a-f0-9]{40}$/.test(head)) throw Error("Recovery branch has an invalid head");
  const commit = await get(`/git/commits/${head}`);
  const base = commit.parents?.length === 1 && commit.parents[0].sha;
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(commit.tree?.sha))
    throw Error("Recovery candidate has an invalid parent/tree");
  verifyCandidateTree(candidate.files, await readGitTree(request, commit.tree.sha));
  const changed = await changedPaths(request, base, head);
  const plan = createRemoteReleasePlan({ base, head, changed, sourceDigest: state.sourceDigest });
  return { ...state, phase: "uploaded", branch, head, base,
    repositoryId: meta.repositoryId, workflowId: meta.workflowId, plan };
}

async function inspect(file: string, mode: string, request: GitHubRequest) {
  file = stateFile(file);
  let state = JSON.parse(readFileSync(file, "utf8")) as State;
  if (mode === "recover") {
    state = await reconcile(state, request);
    if (existsSync(file + ".dispatch-intent")) state.phase = "waiting";
    save(file, state);
    console.log(JSON.stringify({ phase: state.phase, branch: state.branch,
      message: "Reconciled exact source using GET requests only; nothing was uploaded or dispatched" }, null, 2));
    return;
  }
  if (state.version !== 1 || !state.plan || state.plan.sourceDigest !== state.sourceDigest ||
      readCandidate().sourceDigest !== state.sourceDigest) throw Error("Candidate source/state changed; existing evidence cannot clear it");
  if (mode === "renew") {
    const renewed = await requestRemoteRenewal(request, {
      ...state, branch: state.branch!, head: state.head!, plan: state.plan,
      repositoryId: state.repositoryId!, workflowId: state.workflowId!,
    }, (update, runId, oldAttempt) => {
      writeFileSync(`${file}.renew-intent-${runId}-${oldAttempt}`, "One explicitly requested renewal; never retry an uncertain response.\n",
        { flag: "wx", mode: 0o600 });
      Object.assign(state, update); save(file, state);
    });
    Object.assign(state, renewed); save(file, state);
    process.exitCode = 2;
    console.log("One exact-source CI renewal requested. Inspect or collect later; no automatic retry.");
    return;
  }
  const client = createRemoteGitHubClient(request);
  const meta = await client.metadata();
  if (meta.repositoryId !== state.repositoryId || meta.workflowId !== state.workflowId) throw Error("Remote identity changed");
  if (mode === "dispatch") {
    if (state.phase !== "uploaded") throw Error("Submission already requested or uncertain; inspect status instead of retrying");
    writeFileSync(file + ".dispatch-intent", "One dispatch requested; do not retry an uncertain outcome.\n",
      { flag: "wx", mode: 0o600 });
    state.phase = "dispatch_requested"; save(file, state);
    await client.dispatch(state.branch!, state.plan);
    state.phase = "waiting"; save(file, state);
    console.log("Submitted once. Run status later; no local heavy tests or polling loop was started.");
    return;
  }
  const runs = (await client.findRuns(state.head!)).filter(r =>
    r.branch === state.branch && r.event === "workflow_dispatch");
  if (runs.length !== 1) throw Error("Expected exactly one candidate workflow run; inspect GitHub before retrying");
  const run = runs[0];
  if (state.expectedAttempt !== undefined && run.runAttempt < state.expectedAttempt) {
    console.log("Explicitly requested CI renewal is not yet visible; prior attempt is not reusable.");
    process.exitCode = 2;
    return;
  }
  if (state.expectedAttempt !== undefined && run.runAttempt !== state.expectedAttempt)
    throw Error("Unexpected renewed run attempt; inspect before collecting");
  if ((state.runId && state.runId !== run.runId) || (state.runAttempt && state.runAttempt !== run.runAttempt))
    throw Error("Run identity or attempt changed; existing evidence is not reusable");
  state.runId = run.runId; state.runAttempt = run.runAttempt; save(file, state);
  const url = `https://github.com/${REMOTE_RELEASE_REPO}/actions/runs/${run.runId}`;
  if (mode === "status" || run.status !== "completed") {
    console.log(JSON.stringify({ ...run, url }, null, 2));
    if (mode === "collect") process.exitCode = 2;
    return;
  }
  if (run.conclusion !== "success") throw Error(`Remote checks ${run.conclusion}; inspect ${url}. No automatic rerun.`);
  const { trusted, artifactId } = await client.inspect(run.runId, run.runAttempt);
  const archive = await client.downloadArtifact(artifactId);
  const { receipts, files, artifactSha256 } = readRemoteEvidence(archive, state.plan);
  const verified = validateRemoteReleaseEvidence(state.plan, receipts, trusted, {
    repositoryId: state.repositoryId!, workflowId: state.workflowId!, branch: state.branch!,
    runId: run.runId, runAttempt: run.runAttempt,
  });
  const finalSource = readCandidate();
  if (finalSource.sourceDigest !== state.sourceDigest) throw Error("Source changed during remote evidence collection");
  verifyCandidateTree(finalSource.files, await readRepositoryTree(request, state.head!));
  if (candidateSnapshotIdentity(readCandidate()) !== candidateSnapshotIdentity(finalSource))
    throw Error("Source bytes/modes changed during remote tree verification");
  const regressions = verified.filter(r => r.checkId.startsWith("regressions-"));
  const checks = [{ name: "regressions", passed: true, code: 0, timedOut: false,
    outputLimitExceeded: false, elapsedMs: Math.max(...regressions.map(r => r.elapsedMs)),
    remoteLanes: regressions.map(r => r.checkId), environment: "credential-isolated-fixtures" },
  ...verified.filter(r => !r.checkId.startsWith("regressions-")).map(r =>
    ({ ...r, name: r.checkId, environment: "isolated-github-runner" }))];
  const report = { version: 1, createdAt: new Date().toISOString(), base: state.base,
    source: { digest: state.sourceDigest, count: finalSource.files.length },
    changed: state.plan.changed, scope: classifyReleaseScope(state.plan.changed),
    status: "AUTOMATED_CHECKS_PASSED_REVIEW_REQUIRED", sourceStable: true, scopeMembershipStable: true,
    checks, remote: { trusted, artifactSha256, url },
    limits: ["Authenticated remote check evidence, not independent code review or publication permission",
      "Existing audit baseline, disposition and current-source gates still apply"] };
  const reused = reusableCollectedReport(ROOT, state.reportPath, report, files);
  if (reused) {
    state.phase = "verified"; save(file, state);
    console.log(JSON.stringify({ status: state.phase, report: reused, url, reused: true }, null, 2));
    return;
  }
  localDirectory(path.resolve(ROOT, ".local/release-checks"));
  const dir = mkdtempSync(path.resolve(ROOT, ".local/release-checks/run-"));
  for (const [name, bytes] of files) {
    if (name === "plan.json") continue;
    writeFileSync(path.join(dir, path.basename(name)), bytes, { flag: "wx", mode: 0o600 });
  }
  const reportPath = path.join(dir, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  state.phase = "verified"; state.reportPath = path.relative(ROOT, reportPath); save(file, state);
  console.log(JSON.stringify({ status: state.phase, report: state.reportPath, url }, null, 2));
}

export async function main(args = process.argv.slice(2)) {
  const [mode, ...rest] = args;
  if (mode === "submit" && rest.length === 0) {
    localDirectory(STATE);
    const digest = readCandidate().sourceDigest;
    const file = path.join(STATE, `state-${digest}.json`);
    const request = connectorTransport();
    if (!existsSync(file)) await upload(true, request);
    const current = JSON.parse(readFileSync(stateFile(file), "utf8")) as State;
    if (current.phase === "uploaded") {
      await inspect(file, "dispatch", request);
      process.exitCode = 2;
      console.log(`Remote checks were submitted once. Run npm run publish:preflight after they finish. State: ${path.relative(ROOT, file)}`);
      return;
    }
    if (!["waiting", "dispatch_requested", "renewal_requested", "verified"].includes(current.phase))
      throw Error("Candidate requires read-only recovery/inspection; no upload or dispatch was retried");
    return inspect(file, "collect", request);
  }
  if (mode === "setup" && rest.length === 1 && rest[0] === "--allow-test-branch-upload") {
    localDirectory(STATE);
    const digest = setupSnapshot().digest;
    const file = path.join(STATE, `setup-${digest}.json`);
    const request = connectorTransport();
    const initialMetadata = await createRemoteGitHubClient(request).metadata();
    writeFileSync(file, JSON.stringify({ purpose: "setup-proof-not-release-clearance",
      phase: "upload_requested", digest, branch: `release-checks/${digest}`,
      ...initialMetadata }), { flag: "wx", mode: 0o600 });
    const setup = await uploadSetup(request, true);
    writeFileSync(file, JSON.stringify({ ...setup, phase: "dispatch_requested" }, null, 2), { mode: 0o600 });
    if (setup.digest !== digest) throw Error("Setup source changed during upload; no dispatch made");
    const r = await request(`${API}/actions/workflows/security-checks.yml/dispatches`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: setup.branch, inputs: { release_setup: "true" } }),
    });
    if (r.status !== 204) throw Error(`Setup dispatch returned ${r.status}; inspect saved state before retrying`);
    writeFileSync(file, JSON.stringify({ ...setup, phase: "waiting" }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ state: path.relative(ROOT, file), branch: setup.branch,
      head: setup.head, purpose: setup.purpose }, null, 2));
    return;
  }
  if (mode === "setup-status" && rest.length === 2 && rest[0] === "--state") {
    const file = stateFile(rest[1]);
    const setup = JSON.parse(readFileSync(file, "utf8"));
    if (setup.purpose !== "setup-proof-not-release-clearance" || setup.digest !== setupSnapshot().digest ||
        setup.branch !== `release-checks/${setup.digest}`) throw Error("Setup source or identity changed");
    const request = connectorTransport();
    const client = createRemoteGitHubClient(request);
    const meta = await client.metadata();
    if (meta.repositoryId !== setup.repositoryId || meta.workflowId !== setup.workflowId) throw Error("Setup repository/workflow changed");
    if (!setup.head) {
      const get = async (route: string) => {
        const r = await request(API + route, { method: "GET" });
        if (!r.ok) throw Error("Setup ref cannot be recovered; no write or dispatch was attempted");
        return r.json();
      };
      const ref = await get(`/git/ref/heads/${setup.branch}`);
      if (!/^[a-f0-9]{40}$/.test(ref.object?.sha)) throw Error("Invalid recovered setup head");
      const commit = await get(`/git/commits/${ref.object.sha}`);
      if (commit.parents?.length !== 1 || commit.parents[0].sha !== setup.mainSha ||
          !/^[a-f0-9]{40}$/.test(commit.tree?.sha)) throw Error("Recovered setup parent/tree differs");
      const tree = await get(`/git/trees/${commit.tree.sha}?recursive=1`);
      if (tree.truncated || !Array.isArray(tree.tree)) throw Error("Incomplete recovered setup tree");
      const entries = new Map<string, any>(tree.tree.map((f: any) => [f.path, f]));
      for (const f of setupSnapshot().files)
        if (entries.get(f.path)?.sha !== blobHash(f.bytes) || entries.get(f.path)?.mode !== f.mode)
          throw Error("Recovered setup source differs");
      setup.head = ref.object.sha;
      setup.phase = "recovered_not_resubmitted";
      writeFileSync(file, JSON.stringify(setup, null, 2), { mode: 0o600 });
      console.log("Recovered the exact setup branch using GET requests only. Inspect existing runs before any manual dispatch.");
      return;
    }
    const runs = (await client.findRuns(setup.head)).filter(r => r.branch === setup.branch && r.event === "workflow_dispatch");
    if (runs.length !== 1) throw Error("Setup run not yet discoverable or duplicated; inspect GitHub without resubmitting");
    const run = runs[0];
    const url = `https://github.com/${REMOTE_RELEASE_REPO}/actions/runs/${run.runId}`;
    if (run.status === "completed" && run.conclusion === "success") {
      const r = await request(`${API}/actions/runs/${run.runId}/attempts/${run.runAttempt}/jobs?per_page=100`, { method: "GET" });
      if (!r.ok) throw Error("Cannot verify setup check membership");
      const result = await r.json();
      const required = ["unit-tests", "typecheck", "portable-install", "publish-typecheck",
        "surface-preflight", "domain-preflight", "build"].map(n => `Setup / ${n}`);
      if (!Array.isArray(result.jobs) || result.total_count !== result.jobs.length ||
          required.some(n => result.jobs.filter((j: any) => j.name === n && j.conclusion === "success").length !== 1) ||
          result.jobs.some((j: any) => !required.includes(j.name) && j.conclusion !== "skipped"))
        throw Error("Missing, duplicated or unexpected setup jobs");
      writeFileSync(file, JSON.stringify({ ...setup, phase: "setup_verified", runId: run.runId, runAttempt: run.runAttempt, url }, null, 2));
    }
    console.log(JSON.stringify({ ...run, url, purpose: setup.purpose,
      releaseClearance: false }, null, 2));
    return;
  }
  if (mode === "upload" && rest.length === 1 && rest[0] === "--allow-test-branch-upload")
    return upload(true, connectorTransport());
  if (["dispatch", "status", "collect", "recover", "renew"].includes(mode) && rest.length === 2 && rest[0] === "--state")
    return inspect(rest[1], mode, connectorTransport());
  throw Error("Usage: release:remote submit | setup|upload --allow-test-branch-upload | setup-status|dispatch|status|collect|recover|renew --state <printed-state-path>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`[remote-release] ${error.message}`); process.exitCode = 1; });
}
