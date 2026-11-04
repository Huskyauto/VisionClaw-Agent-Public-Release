import { digestFailures, failureKey, splitFailures, type FailureSample } from "./harness-addendum-lib";

/** Diagnostic priorities only. Never an evaluator, safety policy or approval. */
export const HARNESS_DIAGNOSIS_POLICY = {
  version: "recurrence-v1",
  windows: 3,
  minRecentOccurrences: 2,
  maxCriteria: 8,
  maxDigestChars: 2800,
} as const;

export type TimedFailureSample = FailureSample & { startedAt?: string | null };
export type DiagnosticState = "newly-observed" | "recurring" | "returned"
  | "not-observed-recently" | "insufficient-evidence";
export interface FailureCriterion {
  key: string;
  state: DiagnosticState;
  recent: number;
  middle: number;
  older: number;
}
export interface HarnessDiagnosis {
  mode: "adaptive" | "baseline";
  reason: string;
  digest: string;
  criteria: FailureCriterion[];
}

/** The split happens before diagnosis by construction, not by prompt instruction. */
export function prepareHarnessEvidence<T extends TimedFailureSample>(
  samples: T[],
  options: { nowMs: number; windowDays: number; heldOutRatio: number; seed: number; enabled?: boolean },
) {
  const { train, heldOut } = splitFailures(samples, options.heldOutRatio, options.seed);
  let diagnosis: HarnessDiagnosis;
  try {
    diagnosis = prepareHarnessDiagnosis(train, options);
  } catch {
    // Observable fallback reason travels to the existing nightly result log.
    diagnosis = { mode: "baseline", reason: "preparation-error", digest: digestFailures(train), criteria: [] };
  }
  return { train, heldOut, diagnosis };
}

export function prepareHarnessDiagnosis(
  train: TimedFailureSample[],
  options: { nowMs: number; windowDays: number; enabled?: boolean },
): HarnessDiagnosis {
  const baseline = (reason: string): HarnessDiagnosis => ({
    mode: "baseline", reason, digest: digestFailures(train), criteria: [],
  });
  if (options.enabled === false) return baseline("disabled");
  const horizon = options.windowDays * 86_400_000;
  if (!Number.isFinite(options.nowMs) || !Number.isFinite(horizon) || horizon <= 0) {
    return baseline("invalid-time-window");
  }
  const errors = train.filter((row) => row.status === "error");
  if (errors.length === 0) return baseline("no-error-evidence");
  const groups = new Map<string, [number, number, number]>();
  for (const row of errors) {
    const time = typeof row.startedAt === "string" ? Date.parse(row.startedAt) : NaN;
    const age = options.nowMs - time;
    // Partial timestamp coverage would silently bias which weaknesses get attention.
    if (!Number.isFinite(time) || age < 0 || age > horizon) {
      return baseline("incomplete-time-evidence");
    }
    const bin = Math.min(2, Math.floor(age / (horizon / 3)));
    const key = failureKey(row);
    const counts = groups.get(key) ?? [0, 0, 0];
    counts[bin]++;
    groups.set(key, counts);
  }
  const criteria = [...groups].map(([key, [recent, middle, older]]): FailureCriterion => ({
    key, recent, middle, older,
    state: recent === 0 ? "not-observed-recently"
      : recent < HARNESS_DIAGNOSIS_POLICY.minRecentOccurrences ? "insufficient-evidence"
      : older >= 2 && middle === 0 ? "returned"
      : middle + older === 0 ? "newly-observed" : "recurring",
  })).sort((a, b) =>
    Number(b.recent >= 2) - Number(a.recent >= 2)
    || Number(b.recent > 0) - Number(a.recent > 0)
    || b.recent - a.recent || b.middle - a.middle || b.older - a.older
    || a.key.localeCompare(b.key),
  ).slice(0, HARNESS_DIAGNOSIS_POLICY.maxCriteria);
  // Keep baseline evidence for statuses not assessed as errors. In particular a
  // declined action may be correct refusal; it is not a new diagnostic defect.
  const other = train.filter((row) => row.status !== "error");
  const digest = [
    ...criteria.map((c) => `- [${c.state}; recent=${c.recent}, middle=${c.middle}, older=${c.older}] ${c.key}`),
    ...(other.length ? ["Other recorded traces (declines are not automatically defects):", digestFailures(other, 2)] : []),
  ].join("\n").slice(0, HARNESS_DIAGNOSIS_POLICY.maxDigestChars);
  return { mode: "adaptive", reason: "training-errors-only", digest, criteria };
}
