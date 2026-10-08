import { extractBwbWeekWindow, extractBwbWeightFacts, isBwbWeeklyRecapBrief } from "../build-video-from-brief";

type FelixIdentity = { id: number; name: string };
type PolicyResult = { action: string; reason?: string };

export interface BwbOwnerWebChatDeps {
  ownerAuthorized: boolean;
  tenantId: number;
  sourcePersonaId: number | null;
  resolveFelix: () => Promise<FelixIdentity | null>;
  enforcePolicy: (persona: FelixIdentity) => Promise<PolicyResult>;
  execute: (name: string, params: Record<string, unknown>) => Promise<any>;
  now?: Date;
}

export async function launchBwbWeeklyRecapFromOwnerWebChat(
  content: string,
  deps: BwbOwnerWebChatDeps,
): Promise<{ jobId: string; response: string; toolOutput: any } | null> {
  if (!isBwbWeeklyRecapBrief(content) || !deps.ownerAuthorized) return null;
  if (deps.tenantId !== 1) throw new Error("BWB owner web-chat launch requires owner tenant 1");

  const felix = await deps.resolveFelix();
  if (!felix || felix.id !== 2 || felix.name.toLowerCase() !== "felix") {
    throw new Error("BWB owner web-chat launch refused: Felix identity could not be verified");
  }
  const policy = await deps.enforcePolicy(felix);
  if (policy.action === "block") {
    throw new Error(`BWB owner web-chat launch blocked by tool policy: ${policy.reason || "not authorized"}`);
  }

  let win = extractBwbWeekWindow(content);
  if (!win) {
    const { autoPinWindowYmd } = await import("../../scripts/lib/drive-discover");
    const pinned = autoPinWindowYmd({ now: deps.now });
    win = { weekStart: pinned.start, weekEnd: pinned.end };
  }
  const weights = extractBwbWeightFacts(content);
  const windowKey = `${win.weekStart}:${win.weekEnd}`;
  const weightKey = weights
    ? `${weights.currentWeight ?? "x"}:${weights.totalLost ?? "x"}:${weights.startWeight ?? "x"}`
    : "stored";
  const launchKey = `owner-web-chat:${deps.tenantId}:${windowKey}:${weightKey}`;
  const toolOutput = await deps.execute("bwb_weekly_build", {
    ...win,
    ...(weights || {}),
    _tenantId: deps.tenantId,
    _personaId: felix.id,
    _launchKey: launchKey,
  });
  if (toolOutput?.started !== true || typeof toolOutput?.job_id !== "string") {
    throw new Error(`BWB weekly builder did not return a durable job acknowledgement: ${toolOutput?.error || "unknown failure"}`);
  }
  const jobId = toolOutput.job_id;
  const reused = toolOutput.idempotent === true ? "The existing weekly recap job was reused" : "The weekly recap build was started";
  return {
    jobId,
    toolOutput,
    response: `${reused} through Felix. Job: ${jobId}. Follow live progress at /jobs. Publishing remains approval-first.`,
  };
}