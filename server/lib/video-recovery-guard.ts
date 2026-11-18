/** Propagate backup barriers through Promise.allSettled before another batch. */
export function assertVideoRecoveryBatch(
  results: PromiseSettledResult<{ result: { error?: string } }>[],
): void {
  for (const settled of results) {
    const error = settled.status === "rejected"
      ? settled.reason?.message : settled.value.result.error;
    if (typeof error === "string" && error.includes("BWB recovery paused:")) {
      throw new Error(error);
    }
  }
}
