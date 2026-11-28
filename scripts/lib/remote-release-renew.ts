import { createRemoteGitHubClient } from "./remote-release-github";
import {
  REMOTE_RELEASE_BRANCH, REMOTE_RELEASE_REPO, type RemoteReleasePlan,
} from "./remote-release-contract";
import type { GitHubRequest } from "./remote-release-candidate";

const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface RemoteRenewalState {
  version: 1;
  sourceDigest: string;
  branch: string;
  head: string;
  base?: string;
  repositoryId: number;
  workflowId: number;
  plan: RemoteReleasePlan;
  runId?: number;
  runAttempt?: number;
  [key: string]: unknown;
}

export type RemoteRenewalUpdate = Omit<RemoteRenewalState, "runAttempt"> & {
  phase: "renewal_requested" | "waiting";
  runAttempt: undefined;
  expectedAttempt: number;
};

const positive = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

export async function requestRemoteRenewal(
  request: GitHubRequest,
  state: RemoteRenewalState,
  beforePost: (update: RemoteRenewalUpdate, runId: number, oldAttempt: number) => Promise<void> | void,
): Promise<RemoteRenewalUpdate> {
  if (typeof beforePost !== "function") throw Error("Renewal requires a persisted pre-POST intent");
  if (state?.version !== 1 || !SHA256.test(state.sourceDigest) ||
      state.branch !== `release-checks/${state.sourceDigest}` || !REMOTE_RELEASE_BRANCH.test(state.branch) ||
      !SHA.test(state.head) || state.plan?.repository !== REMOTE_RELEASE_REPO ||
      state.plan?.head !== state.head || state.plan?.sourceDigest !== state.sourceDigest ||
      !SHA.test(state.plan?.base) || (state.base !== undefined && state.base !== state.plan.base) ||
      !positive(state.repositoryId) || !positive(state.workflowId) ||
      (state.runId !== undefined && !positive(state.runId)) ||
      (state.runAttempt !== undefined && !positive(state.runAttempt)))
    throw Error("Renewal state is not bound to the exact candidate, branch and plan");

  const client = createRemoteGitHubClient(request);
  const metadata = await client.metadata();
  if (metadata.repositoryId !== state.repositoryId || metadata.workflowId !== state.workflowId)
    throw Error("Renewal repository/workflow identity differs from the verified state");

  const runs = await client.findRuns(state.head);
  const matches = runs.filter(run => run.head === state.head &&
    run.branch === state.branch && run.event === "workflow_dispatch");
  if (matches.length !== 1) throw Error("Renewal requires exactly one matching candidate workflow run");
  const run = matches[0];
  if (run.status !== "completed" || typeof run.conclusion !== "string")
    throw Error("Only a completed candidate run can be renewed");
  if ((state.runId !== undefined && state.runId !== run.runId) ||
      (state.runAttempt !== undefined && state.runAttempt !== run.runAttempt))
    throw Error("Existing renewal run or attempt differs from the saved state");
  const expectedAttempt = run.runAttempt + 1;
  if (!Number.isSafeInteger(expectedAttempt)) throw Error("Renewal attempt is outside the supported range");

  const update = {
    ...state, phase: "renewal_requested" as const, runId: run.runId,
    runAttempt: undefined, expectedAttempt,
  };
  await beforePost(update, run.runId, run.runAttempt);
  const response = await request(
    `/repos/${REMOTE_RELEASE_REPO}/actions/runs/${run.runId}/rerun`,
    { method: "POST", headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    } },
  );
  if (response.redirected || response.status !== 201)
    throw Error(`GitHub renewal rerun expected HTTP 201, received ${response.status}; do not retry an uncertain outcome`);
  return { ...update, phase: "waiting" };
}
