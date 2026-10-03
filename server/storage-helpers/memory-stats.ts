export type MemoryStatusGroup = {
  status: string;
  category: string;
  count: number;
};

export function summarizeMemoryGroups(groups: MemoryStatusGroup[], knowledgeCount: number) {
  let active = 0;
  let archived = 0;
  let total = 0;
  const byCategory: Record<string, number> = {};

  for (const group of groups) {
    total += group.count;
    if (group.status === "active") {
      active += group.count;
      byCategory[group.category] = (byCategory[group.category] || 0) + group.count;
    } else if (group.status === "archived" || group.status === "superseded") {
      archived += group.count;
    }
  }

  return { active, archived, total, byCategory, knowledgeCount };
}