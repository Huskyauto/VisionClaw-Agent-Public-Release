import * as Diff from "diff";

export interface DiffInput {
  before?: string;
  after?: string;
  patch?: string;
  path?: string;
  context?: number;
}

export interface DiffResult {
  success: boolean;
  diff?: string;
  stats?: {
    additions: number;
    deletions: number;
    changes: number;
    hunks: number;
  };
  path?: string;
  error?: string;
}

export function generateDiff(input: DiffInput): DiffResult {
  try {
    if (input.patch && (input.before || input.after)) {
      return { success: false, error: "Provide either patch or before/after, not both." };
    }

    if (input.patch) {
      return formatPatchResult(input.patch, input.path);
    }

    if (input.before === undefined || input.after === undefined) {
      return { success: false, error: "Provide both 'before' and 'after' text, or a 'patch'." };
    }

    if (input.before.length > 512 * 1024 || input.after.length > 512 * 1024) {
      return { success: false, error: "Input exceeds 512KB limit." };
    }

    const contextLines = input.context ?? 3;
    const fileName = input.path || "text";

    const patch = Diff.createTwoFilesPatch(
      `a/${fileName}`,
      `b/${fileName}`,
      input.before,
      input.after,
      undefined,
      undefined,
      { context: contextLines }
    );

    const stats = computeStats(patch);

    if (stats.additions === 0 && stats.deletions === 0) {
      return {
        success: true,
        diff: "(no changes)",
        stats: { additions: 0, deletions: 0, changes: 0, hunks: 0 },
        path: input.path,
      };
    }

    return {
      success: true,
      diff: patch,
      stats,
      path: input.path,
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Diff generation failed" };
  }
}

function formatPatchResult(patch: string, path?: string): DiffResult {
  if (patch.length > 2 * 1024 * 1024) {
    return { success: false, error: "Patch exceeds 2MB limit." };
  }

  const stats = computeStats(patch);

  return {
    success: true,
    diff: patch,
    stats,
    path,
  };
}

function computeStats(patch: string): {
  additions: number;
  deletions: number;
  changes: number;
  hunks: number;
} {
  let additions = 0;
  let deletions = 0;
  let hunks = 0;

  const lines = patch.split("\n");
  for (const line of lines) {
    if (line.startsWith("@@")) hunks++;
    else if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }

  return {
    additions,
    deletions,
    changes: additions + deletions,
    hunks,
  };
}

export function applyPatch(original: string, patch: string): { success: boolean; result?: string; error?: string } {
  try {
    const applied = Diff.applyPatch(original, patch);
    if (applied === false) {
      return { success: false, error: "Patch could not be applied cleanly." };
    }
    return { success: true, result: applied };
  } catch (err: any) {
    return { success: false, error: err.message || "Patch application failed" };
  }
}

export function wordDiff(before: string, after: string): { success: boolean; diff?: string; error?: string } {
  try {
    const changes = Diff.diffWords(before, after);
    let result = "";
    for (const part of changes) {
      if (part.added) result += `{+${part.value}+}`;
      else if (part.removed) result += `{-${part.value}-}`;
      else result += part.value;
    }
    return { success: true, diff: result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
