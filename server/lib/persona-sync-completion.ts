export interface PersonaSyncCompletion {
  expectedCount: number;
  syncedCount: number;
  errors: string[];
  verifiedCount: number;
}

export function assertPersonaSyncComplete(result: PersonaSyncCompletion): void {
  const problems: string[] = [];
  if (result.errors.length > 0) problems.push(result.errors.join("; "));
  if (result.syncedCount !== result.expectedCount) {
    problems.push(`updated ${result.syncedCount}/${result.expectedCount}`);
  }
  if (result.verifiedCount !== result.expectedCount) {
    problems.push(`CMMC guidance verified for ${result.verifiedCount}/${result.expectedCount}`);
  }
  if (problems.length > 0) {
    throw new Error(`Persona sync incomplete: ${problems.join("; ")}`);
  }
}