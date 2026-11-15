import { HASH_PATTERN } from "./workspace-verifier-contract";

export const MAX_WORKSPACE_CONTEXT_RUNS = 3;
export interface WorkspaceRecovery {
  contextSha256: string;
  runs: number;
  paused: boolean;
}

/** Count admission before execution, so process death cannot refund the bound. */
export function nextWorkspaceRecovery(previous: unknown, contextSha256: string): WorkspaceRecovery {
  if (!HASH_PATTERN.test(contextSha256)) throw new Error("Invalid recovery context");
  const prior = previous as Partial<WorkspaceRecovery> | null;
  let runs = 0;
  if (prior?.contextSha256 === contextSha256) {
    if (!Number.isSafeInteger(prior.runs) || prior.runs! < 1
      || prior.runs! >= MAX_WORKSPACE_CONTEXT_RUNS || prior.paused !== false) {
      throw new Error("Workspace verification recovery paused");
    }
    runs = prior.runs!;
  }
  return { contextSha256, runs: runs + 1, paused: runs + 1 >= MAX_WORKSPACE_CONTEXT_RUNS };
}
