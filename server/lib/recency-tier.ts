export function getRecencyTier(lastAccessed: Date | string): "hot" | "warm" | "cold" {
  const now = Date.now();
  const accessed = new Date(lastAccessed).getTime();
  const daysSince = (now - accessed) / (1000 * 60 * 60 * 24);
  if (daysSince <= 7) return "hot";
  if (daysSince <= 30) return "warm";
  return "cold";
}
