import { createRoutineOffload } from "./routine-offload";
import { runLegionBackground } from "./background-runtime";
import { legionBackgroundEnabled, legionShutdownSignal } from "./runtime";
import { currentTenantId } from "../lib/tenant-context";
import { legionModelWarm } from "./warmup";

/** Separate activation: no customer routing or production/config changes by a model. */
export const localRoutineEnabled = () => legionBackgroundEnabled() &&
  process.env.APP_ACCESS_MODE === "owner-only" && process.env.LEGION_ROUTINE_ENABLED === "1" &&
  legionModelWarm();

export const routineCompletion = createRoutineOffload({
  enabled: localRoutineEnabled,
  trustedTenant: currentTenantId,
  shutdownSignal: legionShutdownSignal,
  run: runLegionBackground,
  event: value => { console.info(JSON.stringify(value)); },
});
