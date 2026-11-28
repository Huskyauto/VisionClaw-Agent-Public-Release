import { ADMIN_TENANT_ID } from "../../server/tenant-constants";
import { snapshotToolAuthority, type ToolAuthority } from "../../server/tools/invocation-authority";

const replayTools = ["build_html_app", "create_styled_report", "start_video_job",
  "mpeg_produce_parallel", "grade_deliverable"] as const;
type ReplayTool = typeof replayTools[number];

export class ReplayToolBlocked extends Error {
  constructor(tool: ReplayTool) {
    super(`${tool} was denied by the tool authority or policy gate`);
  }
}

/** Only these historical failures proved the producer was never called. */
export function isLegacyReplayAuthorityFreeze(reason: unknown): boolean {
  const error = "Tool authority or policy enforcement unavailable; no execution.";
  return reason === `producer returned no usable artifact path (got: ${JSON.stringify({ error, blocked: true })})` ||
    reason === `producer threw: Two-scene video job did not start with exactly two scenes: ${error}`;
}

export async function withGoldenPathProgress(
  run: () => Promise<void>, save: () => void, alert: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } finally {
    try { save(); }
    finally { await alert(); }
  }
}

export function createGoldenPathDispatcher(execute: (
  name: string, params: Record<string, unknown>, context: ToolAuthority,
) => Promise<any>) {
  const authority = snapshotToolAuthority({
    tenantId: ADMIN_TENANT_ID,
    actor: "system",
    invokedVia: "golden-path-replay",
    internalPurpose: "Run fixed nightly platform-owned canary fixtures",
  });
  return async (tool: ReplayTool, params: Record<string, unknown>) => {
    if (!replayTools.includes(tool)) throw new Error("Not a golden-path replay tool");
    const result = await execute(tool, params, authority);
    if (result?.blocked === true) throw new ReplayToolBlocked(tool);
    return result;
  };
}
