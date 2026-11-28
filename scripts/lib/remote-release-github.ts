import {
  REMOTE_RELEASE_BRANCH,
  REMOTE_RELEASE_REPO,
  REMOTE_RELEASE_WORKFLOW,
  type RemoteReleasePlan,
  type TrustedRemoteRun,
} from "./remote-release-contract";

const API = `/repos/${REMOTE_RELEASE_REPO}`;
const WORKFLOW_FILE = REMOTE_RELEASE_WORKFLOW.split("/").at(-1)!;
const METADATA_LIMIT = 1024 * 1024;
const ARTIFACT_LIMIT = 32 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface RemoteRunSummary {
  runId: number;
  runAttempt: number;
  head: string;
  branch: string;
  event: string;
  status: string;
  conclusion: string | null;
}

export interface RemoteGitHubMetadata {
  repositoryId: number;
  workflowId: number;
  mainSha: string;
}

export interface RemoteGitHubClient {
  metadata(): Promise<RemoteGitHubMetadata>;
  dispatch(branch: string, plan: RemoteReleasePlan): Promise<void>;
  findRuns(head: string): Promise<RemoteRunSummary[]>;
  inspect(runId: number, attempt: number): Promise<{ trusted: TrustedRemoteRun; artifactId: number }>;
  downloadArtifact(id: number): Promise<Uint8Array>;
}

function reject(message: string): never {
  throw new Error(`remote GitHub request rejected: ${message}`);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function requirePositive(value: unknown, label: string): asserts value is number {
  if (!positiveInteger(value)) reject(`${label} is invalid`);
}

function headers(extra?: HeadersInit): Headers {
  const result = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  new Headers(extra).forEach((value, key) => result.set(key, value));
  return result;
}

async function responseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (response.redirected || (response.status >= 300 && response.status < 400))
    reject("redirects are not followed by this client");
  if (response.status !== 200) reject(`GitHub API returned HTTP ${response.status}`);
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes))
    reject("response exceeds its size limit");
  if (!response.body) reject("response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        reject("response exceeds its size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function decodeJson(bytes: Uint8Array): any {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    reject("GitHub API returned invalid JSON");
  }
}

export function createRemoteGitHubClient(
  request: (path: string, init?: RequestInit) => Promise<Response>,
): RemoteGitHubClient {
  let cached: RemoteGitHubMetadata | undefined;
  const inspectedArtifacts = new Set<number>();

  async function get(path: string): Promise<any> {
    const response = await request(path, { method: "GET", headers: headers() });
    return decodeJson(await responseBytes(response, METADATA_LIMIT));
  }

  async function getMetadata(): Promise<RemoteGitHubMetadata> {
    const [repo, branch, workflow] = await Promise.all([
      get(API),
      get(`${API}/branches/main`),
      get(`${API}/actions/workflows/${WORKFLOW_FILE}`),
    ]);
    if (repo?.private !== true || repo?.default_branch !== "main")
      reject("repository is not private with the fixed main default branch");
    if (workflow?.path !== REMOTE_RELEASE_WORKFLOW || workflow?.state !== "active")
      reject("fixed release workflow is missing or inactive");
    requirePositive(repo.id, "repository ID");
    requirePositive(workflow.id, "workflow ID");
    const mainSha = branch?.commit?.sha;
    if (typeof mainSha !== "string" || !SHA.test(mainSha))
      reject("main branch commit is missing or malformed");
    return { repositoryId: repo.id, workflowId: workflow.id, mainSha };
  }

  async function refreshMetadata(): Promise<RemoteGitHubMetadata> {
    const fresh = await getMetadata();
    if (cached && (cached.repositoryId !== fresh.repositoryId || cached.workflowId !== fresh.workflowId))
      reject("repository or workflow numeric identity changed during this client session");
    cached = fresh;
    return fresh;
  }

  function knownMetadata(): RemoteGitHubMetadata {
    if (!cached) reject("metadata() must establish repository/workflow IDs first");
    return cached;
  }

  async function checkedList(path: string, field: string): Promise<any[]> {
    const payload = await get(path);
    const list = payload?.[field];
    if (!Array.isArray(list) || !Number.isSafeInteger(payload?.total_count) ||
        payload.total_count !== list.length || list.length > 100)
      reject(`GitHub ${field} list is incomplete or truncated`);
    return list;
  }

  return {
    async metadata() {
      const value = await refreshMetadata();
      return { ...value };
    },

    async dispatch(branch, plan) {
      if (!REMOTE_RELEASE_BRANCH.test(branch)) reject("candidate branch is not allowed");
      if (!plan || plan.repository !== REMOTE_RELEASE_REPO ||
          !SHA.test(plan.head) || !SHA.test(plan.base) || !SHA256.test(plan.sourceDigest) ||
          plan.head.length !== 40)
        reject("release plan identity is invalid");
      const meta = await refreshMetadata();
      const branchInfo = await get(`${API}/branches/${encodeURIComponent(branch)}`);
      if (branchInfo?.name !== branch || branchInfo?.commit?.sha !== plan.head)
        reject("candidate branch SHA does not match the plan head");
      const response = await request(`${API}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          ref: branch,
          inputs: {
            release_base: plan.base,
            release_head: plan.head,
            release_source: plan.sourceDigest,
          },
        }),
      });
      if (response.redirected || (response.status >= 300 && response.status < 400))
        reject("workflow dispatch redirected");
      if (response.status !== 204) reject(`workflow dispatch returned HTTP ${response.status}`);
    },

    async findRuns(head) {
      const meta = knownMetadata();
      if (!SHA.test(head)) reject("requested candidate head is malformed");
      const query = new URLSearchParams({ head_sha: head, per_page: "100" });
      const runs = await checkedList(
        `${API}/actions/workflows/${WORKFLOW_FILE}/runs?${query.toString()}`,
        "workflow_runs",
      );
      return runs.map(run => {
        if (run?.workflow_id !== meta.workflowId || run?.repository?.id !== meta.repositoryId ||
            run?.path !== REMOTE_RELEASE_WORKFLOW || run?.head_sha !== head)
          reject("workflow run list contains mismatched or incomplete identity metadata");
        requirePositive(run.id, "run ID");
        requirePositive(run.run_attempt, "run attempt");
        if (typeof run.head_branch !== "string" || !REMOTE_RELEASE_BRANCH.test(run.head_branch) ||
            typeof run.event !== "string" || typeof run.status !== "string" ||
            !(typeof run.conclusion === "string" || run.conclusion === null))
          reject("workflow run list contains malformed status metadata");
        return {
          runId: run.id,
          runAttempt: run.run_attempt,
          head: run.head_sha,
          branch: run.head_branch,
          event: run.event,
          status: run.status,
          conclusion: run.conclusion,
        };
      });
    },

    async inspect(runId, attempt) {
      const meta = knownMetadata();
      requirePositive(runId, "run ID");
      requirePositive(attempt, "run attempt");
      const attemptPath = `${API}/actions/runs/${runId}/attempts/${attempt}`;
      const run = await get(attemptPath);
      if (run?.id !== runId || run?.run_attempt !== attempt ||
          run?.workflow_id !== meta.workflowId || run?.repository?.id !== meta.repositoryId ||
          run?.path !== REMOTE_RELEASE_WORKFLOW || typeof run?.head_sha !== "string" ||
          !SHA.test(run.head_sha) || typeof run?.head_branch !== "string" ||
          !REMOTE_RELEASE_BRANCH.test(run.head_branch) || typeof run?.event !== "string" ||
          typeof run?.status !== "string" ||
          !(typeof run?.conclusion === "string" || run?.conclusion === null))
        reject("requested run attempt has mismatched or incomplete identity metadata");

      const [jobs, artifacts] = await Promise.all([
        checkedList(`${API}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`, "jobs"),
        checkedList(`${API}/actions/runs/${runId}/artifacts?per_page=100`, "artifacts"),
      ]);
      const exactName = `remote-release-${runId}-${attempt}`;
      const matches = artifacts.filter(artifact =>
        artifact?.name === exactName && artifact?.workflow_run?.id === runId);
      if (matches.length !== 1) reject("run attempt does not have exactly one associated receipt artifact");
      const artifact = matches[0];
      requirePositive(artifact.id, "artifact ID");
      if (artifact.expired !== false) reject("receipt artifact is expired");
      inspectedArtifacts.add(artifact.id);
      const trusted: TrustedRemoteRun = {
        repository: REMOTE_RELEASE_REPO,
        repositoryId: run.repository.id,
        workflowId: run.workflow_id,
        workflowPath: run.path,
        head: run.head_sha,
        branch: run.head_branch,
        runId: run.id,
        runAttempt: run.run_attempt,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        jobs: jobs.map(job => {
          if (typeof job?.name !== "string" || typeof job?.status !== "string" ||
              !(typeof job?.conclusion === "string" || job?.conclusion === null))
            reject("workflow job metadata is malformed");
          return { name: job.name, status: job.status, conclusion: job.conclusion };
        }),
        artifact: { id: artifact.id, name: artifact.name, runId: artifact.workflow_run.id, expired: artifact.expired },
      };
      return { trusted, artifactId: artifact.id };
    },

    async downloadArtifact(id) {
      requirePositive(id, "artifact ID");
      knownMetadata();
      if (!inspectedArtifacts.has(id)) reject("artifact ID has not been verified against an inspected run");
      const response = await request(`${API}/actions/artifacts/${id}/zip`, {
        method: "GET",
        headers: headers(),
      });
      return responseBytes(response, ARTIFACT_LIMIT);
    },
  };
}
