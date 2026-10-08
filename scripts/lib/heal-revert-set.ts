// Pure helper for the Agentic CI Self-Healer verify-fail revert path.
// Extracted so it can be unit-tested without importing the self-healer script
// (whose module body starts an infinite poll loop on import).
//
// GUARANTEE: a file that was already uncommitted/dirty BEFORE the fixer ran
// (e.g. a live editing session in the same workspace) is NEVER in the returned
// revert set, so the healer can never `git checkout`/`git clean` work in
// progress. Only files the FIXER itself dirtied are eligible for revert.
//
// The self-healer fails CLOSED before calling the fixer when the pre-fix
// snapshot is unavailable (preFixSnapshotOk=false), so in production that
// branch never reaches a revert. The flag is still honored here for defence:
// without a trustworthy snapshot we fall back to the rule's self-reported
// touchedFiles only — never the git-dirty union — and still subtract whatever
// pre-fix dirt we do know about.
export function computeRevertSet(opts: {
  touchedFiles: string[];
  postFixDirty: string[];
  preFixDirty: Set<string>;
  preFixSnapshotOk: boolean;
}): string[] {
  const { touchedFiles, postFixDirty, preFixDirty, preFixSnapshotOk } = opts;
  const newlyDirty = postFixDirty.filter((f) => !preFixDirty.has(f));
  const candidate = preFixSnapshotOk
    ? [...touchedFiles, ...newlyDirty]
    : [...touchedFiles];
  return Array.from(new Set(candidate)).filter((f) => !preFixDirty.has(f));
}
