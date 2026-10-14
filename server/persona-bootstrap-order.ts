/** Fresh databases alone reserve the legacy planner/coordinator positions.
 * Existing databases must keep their independently assigned IDs. */
export function orderFreshPersonaSeed<T extends { name: string; role: string }>(
  source: readonly T[],
): T[] {
  const planner = source.find(p => p.name === "Minerva" && p.role !== "General AI Assistant");
  const coordinator = source.find(p => p.name === "Felix" && p.role !== "General AI Assistant");
  if (!planner || !coordinator) throw new Error("Fresh persona seed lacks canonical planner or coordinator");
  const seen = new Set<string>();
  return [planner, coordinator, ...source].filter(persona => {
    if (seen.has(persona.name)) return false;
    seen.add(persona.name);
    return true;
  });
}
