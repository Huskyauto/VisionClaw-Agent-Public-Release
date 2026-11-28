import { currentTenantId } from "../lib/tenant-context";
import { createLocalMemoryTasks, memoryResultAllowsHosted, type LocalMemoryResult } from "./memory-tasks";
import { runLegionBackground } from "./background-runtime";
import { legionBackgroundEnabled, legionShutdownSignal } from "./runtime";
import { localHostedFallbackEnabled } from "./runbook-hosted";
import { withLocalPriority } from "./local-slots";

export const localMemoryEnabled = () => legionBackgroundEnabled()
  && process.env.LOCAL_MEMORY_ENABLED === "1" && process.env.APP_ACCESS_MODE === "owner-only";

export const localMemoryTasks = createLocalMemoryTasks({
  enabled: localMemoryEnabled,
  trustedTenant: currentTenantId,
  run: work => work.task === "dream-digest" || work.task === "dream-proposals"
    ? withLocalPriority("overnight", () => runLegionBackground(work))
    : runLegionBackground(work),
});

/** Original route on local unavailability, only under the owner's recovery opt-in. */
export function localMemoryAllowsHosted(result: LocalMemoryResult<unknown>) {
  return memoryResultAllowsHosted(result, localHostedFallbackEnabled(), legionShutdownSignal().aborted);
}
