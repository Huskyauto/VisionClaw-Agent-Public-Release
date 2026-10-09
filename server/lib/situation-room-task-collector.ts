export interface TrackedHeartbeatTask {
  taskName: string;
  personaId: number | null;
  personaName: string | null;
  startedAt: number | Date;
  tenantId?: number | null;
}

export function collectHeartbeatTasksForTenant(
  tenantId: number,
  tracker: Iterable<readonly [number, TrackedHeartbeatTask]>,
): Array<{ taskName: string; personaName: string; runningSince: string }> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error("A positive trusted tenant ID is required to collect heartbeat tasks");
  }

  const personaNames: Record<number, string> = {
    1: "VisionClaw", 2: "Felix", 3: "Forge", 4: "Teagan", 5: "Blueprint",
    6: "Chief of Staff", 7: "Scribe", 8: "Proof", 9: "Radar", 10: "Neptune",
    11: "Apollo", 12: "Atlas", 13: "Cassandra", 14: "Luna",
  };

  const result: Array<{ taskName: string; personaName: string; runningSince: string }> = [];
  for (const [, task] of tracker) {
    if (task.tenantId !== tenantId) continue;
    result.push({
      taskName: task.taskName,
      personaName: task.personaName || personaNames[task.personaId as number] || `Persona ${task.personaId}`,
      runningSince: task.startedAt instanceof Date ? task.startedAt.toISOString() : String(task.startedAt),
    });
  }
  return result;
}