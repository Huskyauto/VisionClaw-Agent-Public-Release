export interface PersistableEvaluatorSnapshot {
  evaluator: string;
  status: string;
  metrics: Record<string, unknown>;
}

export async function persistSnapshotsIndividually<T extends PersistableEvaluatorSnapshot>(
  results: readonly T[],
  persist: (result: T) => Promise<unknown>,
  onError: (error: unknown, result: T) => void = () => undefined,
): Promise<string[]> {
  const failedEvaluators: string[] = [];
  for (const result of results) {
    try {
      await persist(result);
    } catch (error) {
      failedEvaluators.push(result.evaluator);
      onError(error, result);
    }
  }
  return failedEvaluators;
}