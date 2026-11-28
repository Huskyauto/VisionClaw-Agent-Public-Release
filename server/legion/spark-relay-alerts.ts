import { randomUUID } from "node:crypto";
import { SPARK_RELAY } from "./spark-relay-contract";

export interface RelayAlertState {
  staleSince?: number;
  observedSeenAt?: string;
  lastAttemptAt?: number;
  offlineAttempted?: boolean;
  offlineVerified?: boolean;
  recoveryAttempted?: boolean;
  pending?: string;
  pendingAt?: number;
  outcome?: "claimed" | "verified" | "uncertain";
}
export interface RelayAlertNotice {
  kind: "offline" | "recovery";
  token: string;
  environment: string;
  seenAt: string;
}
export function sparkRelayAlertConfiguration(env: Record<string, string | undefined>) {
  const minutes = (key: string, fallback: number, min: number, max: number) => {
    const raw = env[key];
    if (raw === undefined) return fallback * 60_000;
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= min && n <= max ? n * 60_000 : null;
  };
  const staleMs = minutes("LEGION_SPARK_RELAY_ALERT_STALE_MINUTES", 15, 5, 120);
  const cooldownMs = minutes("LEGION_SPARK_RELAY_ALERT_COOLDOWN_MINUTES", 360, 30, 1440);
  return {
    enabled: env.LEGION_SPARK_RELAY_ALERTS_ENABLED === "1" &&
      env.LEGION_SPARK_RELAY_INSTALLED === "1" &&
      env.LEGION_SPARK_RELAY_ALERT_ENVIRONMENT === "production" &&
      staleMs !== null && cooldownMs !== null,
    environment: "production",
    staleMs: staleMs ?? 900_000,
    cooldownMs: cooldownMs ?? 21_600_000,
  };
}
type Configuration = ReturnType<typeof sparkRelayAlertConfiguration>;
export interface RelayAlertDependencies {
  configuration(): Configuration;
  permitted(): boolean;
  now?(): number;
  observe(): Promise<{ enabled: boolean; environment: string;
    worker: { seenAt: string; ready?: boolean } | null }>;
  /** Must atomically persist mutations before resolving; no external I/O in fn. */
  update<T>(environment: string, fn: (state: RelayAlertState) => T): Promise<T>;
  send(notice: RelayAlertNotice): Promise<void>;
}

/** Observational only: no queue operations, inference calls, repairs or timers. */
export function createSparkRelayAlerts(deps: RelayAlertDependencies) {
  return async (tenantId: number): Promise<void> => {
    const config = deps.configuration();
    const allowed = () => tenantId === 1 && config.enabled && deps.configuration().enabled && deps.permitted();
    if (!allowed()) return;
    const observation = await deps.observe();
    if (!allowed() || !observation.enabled || observation.environment !== config.environment) return;
    const now = (deps.now ?? Date.now)();
    const seen = Date.parse(observation.worker?.seenAt ?? "");
    // Unknown is not offline/recovered. Break any previous stale streak.
    const known = Number.isFinite(seen) && seen <= now;
    const fresh = known && now - seen < SPARK_RELAY.workerFreshMs;
    const notice = await deps.update<RelayAlertNotice | undefined>(config.environment, state => {
      if (!allowed()) return;
      if (state.pending && state.pendingAt !== undefined && now - state.pendingAt >= config.cooldownMs) {
        delete state.pending;
        delete state.pendingAt;
        state.offlineVerified = false;
        state.outcome = "uncertain";
      }
      if (!known) { delete state.staleSince; return; }
      if (state.observedSeenAt !== observation.worker!.seenAt) {
        state.observedSeenAt = observation.worker!.seenAt;
        delete state.staleSince;
      }
      let kind: RelayAlertNotice["kind"];
      if (fresh) {
        delete state.staleSince;
        if (!state.offlineVerified || state.recoveryAttempted) {
          // An in-flight send keeps its incident until its fenced completion.
          if (state.pending) return;
          state.offlineAttempted = false;
          state.offlineVerified = false;
          state.recoveryAttempted = false;
          return;
        }
        if (state.pending) return;
        state.recoveryAttempted = true;
        kind = "recovery";
      } else {
        state.staleSince ??= now;
        if (state.pending || state.offlineAttempted || now - state.staleSince < config.staleMs ||
            (state.lastAttemptAt !== undefined && now - state.lastAttemptAt < config.cooldownMs)) return;
        state.offlineAttempted = true;
        state.offlineVerified = false;
        state.recoveryAttempted = false;
        state.lastAttemptAt = now;
        kind = "offline";
      }
      const token = randomUUID();
      state.pending = token;
      state.pendingAt = now;
      state.outcome = "claimed";
      return { kind, token, environment: config.environment, seenAt: observation.worker!.seenAt };
    });
    if (!notice) return;
    let verified = false;
    try {
      // Revoke permission even between claim and transport.
      if (allowed()) { await deps.send(notice); verified = true; }
    } finally {
      // Persisted claim prevents a duplicate after transport or settle failure.
      await deps.update(notice.environment, state => {
        if (state.pending !== notice.token) return;
        delete state.pending;
        delete state.pendingAt;
        state.outcome = verified ? "verified" : "uncertain";
        if (notice.kind === "offline") state.offlineVerified = verified;
        else {
          state.offlineAttempted = false;
          state.offlineVerified = false;
          state.recoveryAttempted = false;
        }
      });
    }
  };
}
