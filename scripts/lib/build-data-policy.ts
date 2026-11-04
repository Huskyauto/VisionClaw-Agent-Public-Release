/** Release verification must neither export DB rows nor retain old exports. */
export function buildDataPolicy(releaseCheck: boolean, skipSync: boolean) {
  return {
    syncDevData: !releaseCheck && !skipSync,
    preserveDevSnapshot: !releaseCheck,
  };
}
