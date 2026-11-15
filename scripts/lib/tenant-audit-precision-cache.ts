/** Stable file-local batches prevent one new finding shifting every later file. */
export function groupPrecisionFindings<T extends { file: string; line?: number; issue: string }>(
  findings: readonly T[], limit: number,
): T[][] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid precision batch bound");
  const files = new Map<string, T[]>();
  for (const finding of findings) {
    const list = files.get(finding.file) ?? [];
    list.push(finding);
    files.set(finding.file, list);
  }
  const batches: T[][] = [];
  for (const file of [...files.keys()].sort()) {
    const list = files.get(file)!.sort((a, b) =>
      (a.line ?? 0) - (b.line ?? 0) || a.issue.localeCompare(b.issue));
    for (let i = 0; i < list.length; i += limit) batches.push(list.slice(i, i + limit));
  }
  return batches;
}
