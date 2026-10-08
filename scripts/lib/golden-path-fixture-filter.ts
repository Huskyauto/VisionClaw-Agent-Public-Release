/** Select exactly one fixture for a controlled replay; unknown names fail before any producer runs. */
export function selectGoldenPathFixtures<T extends { id: string }>(
  fixtures: readonly T[],
  selectedId?: string,
): T[] {
  if (!selectedId) return [...fixtures];
  const fixture = fixtures.find((candidate) => candidate.id === selectedId);
  if (!fixture) throw new Error(`Unknown golden-path fixture: ${selectedId}`);
  return [fixture];
}