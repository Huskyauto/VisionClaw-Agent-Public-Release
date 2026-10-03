/**
 * Read-only resurfacing of the existing project memory index. This is an
 * advisory inventory, not a fact verifier, evaluator, or permission to apply
 * any suggested change. No model calls, DB access, or runtime state writes.
 */
export interface ResearchCandidate {
  title: string;
  path: string;
  summary: string;
  revisitWhen: string | null;
  status: string;
  matchedTerms: string[];
  reason: "need-match" | "review-due" | "rotation";
}

export interface ResearchRevisitReport {
  mode: "need" | "weekly";
  total: number;
  eligible: number;
  candidates: ResearchCandidate[];
  omitted: number;
  note: string;
}

const STOP = new Set([
  "about", "after", "again", "agent", "agents", "against", "already", "also",
  "before", "could", "during", "every", "from", "have", "into", "need",
  "only", "project", "research", "should", "that", "their", "them", "there",
  "these", "this", "visionclaw", "when", "where", "with", "would", "your",
]);

function terms(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9]{4,}/g) || [])
    .map((word) => word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word)
    .filter((word) => !STOP.has(word)))];
}

function metadata(body: string, key: string): string | null {
  const frontmatter = body.match(/^---\r?\n([\s\S]{0,4000}?)\r?\n---(?:\r?\n|$)/)?.[1] ?? "";
  const value = frontmatter.split(/\r?\n/).find((line) => line.startsWith(`${key}:`));
  return value ? value.slice(key.length + 1).trim().replace(/^["']|["']$/g, "").slice(0, 300) : null;
}

/**
 * Preserve the current index as authority, but also discover older verdict
 * topics that were never linked from its short, always-loaded subset.
 */
export function appendUnindexedResearchTopics(
  indexText: string,
  basenames: string[],
  readTopic: (basename: string) => string,
): string {
  const indexed = new Set([...indexText.matchAll(/\]\(([a-z0-9-]+\.md)\)/g)].map((match) => match[1]));
  const additions: string[] = [];
  for (const basename of basenames.sort()) {
    if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(basename)
        || !/(verdict|paper|study|research|review|frontier|evaluation|report)/.test(basename)
        || indexed.has(basename)) continue;
    const body = readTopic(basename);
    const clean = (text: string) => text.replace(/[\[\]()\r\n]/g, " ").replace(/\s+/g, " ").trim();
    const title = clean(metadata(body, "name") || basename.replace(/\.md$/, "").replace(/-/g, " ")).slice(0, 160);
    const summary = clean(metadata(body, "description") || "Prior research or review; inspect source before acting.").slice(0, 500);
    additions.push(`- [${title}](${basename}) — ${summary}`);
    indexed.add(basename);
  }
  return [indexText.trimEnd(), ...additions].join("\n");
}

export function buildResearchRevisitReport(
  indexText: string,
  readTopic: (basename: string) => string | undefined,
  opts: { need?: string; now: Date; limit?: number },
): ResearchRevisitReport {
  if (!Number.isFinite(opts.now.getTime())) throw new Error("Invalid review date");
  const need = opts.need?.trim();
  if (need && need.length > 500) throw new Error("Need query exceeds 500 characters");
  const queryTerms = new Set(terms(need || ""));
  if (need && !queryTerms.size) throw new Error("Need query has no searchable terms");
  const limit = Math.min(20, Math.max(1, opts.limit ?? 10));
  const seen = new Set<string>();
  const entries: ResearchCandidate[] = [];
  const week = Math.floor(opts.now.getTime() / (7 * 86400_000));
  let eligible = 0;
  let total = 0;

  for (const line of indexText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!line.startsWith("- [")) throw new Error("Invalid research memory index entry");
    const match = line.match(/^- \[([^\]\n]{1,160})\]\(([^)\n]+)\)\s*[—–-]\s*(.{1,500})$/);
    if (!match) throw new Error("Invalid research memory index entry");
    const [, title, path, summary] = match;
    if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(path)) throw new Error("Unsafe research memory index path");
    if (seen.has(path)) throw new Error(`Duplicate research memory index entry: ${path}`);
    seen.add(path);
    total++;
    const body = readTopic(path);
    if (typeof body !== "string") throw new Error(`Missing research memory topic: ${path}`);
    const status = metadata(body, "reviewStatus") ?? "untriaged";
    if (!["untriaged", "watch", "trial", "adopted", "parked", "rejected"].includes(status)) {
      throw new Error(`Invalid reviewStatus for ${path}`);
    }
    if (status === "rejected" || status === "adopted") continue;
    const revisitWhen = metadata(body, "revisitWhen");
    const dateText = metadata(body, "reviewAfter");
    if (dateText && !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) throw new Error(`Invalid reviewAfter for ${path}`);
    const due = Boolean(dateText && dateText <= opts.now.toISOString().slice(0, 10));
    // On-demand searches cover ALL prior lessons; the weekly rotation narrows
    // itself to likely studies/reviews so maintenance mail stays useful.
    const isResearch = /(verdict|research|paper|study|review|frontier|evidence|evaluation|report)/i.test(`${title} ${path}`);
    if (!need && !isResearch && !revisitWhen) continue;
    eligible++;
    const searchable = `${title} ${summary} ${revisitWhen || ""}`;
    const matchedTerms = terms(searchable).filter((term) => queryTerms.has(term));
    if (need && matchedTerms.length < 2) continue;
    entries.push({
      title, path, summary, revisitWhen, status, matchedTerms,
      reason: need ? "need-match" : due ? "review-due" : "rotation",
    });
  }
  if (!total) throw new Error("Research memory index has no entries");
  entries.sort((a, b) =>
    (a.reason === "review-due" ? -1 : 0) - (b.reason === "review-due" ? -1 : 0) ||
    b.matchedTerms.length - a.matchedTerms.length || a.path.localeCompare(b.path));
  let candidates: ResearchCandidate[];
  if (need) {
    candidates = entries.slice(0, limit);
  } else {
    const due = entries.filter((entry) => entry.reason === "review-due");
    const rotating = entries.filter((entry) => entry.reason !== "review-due");
    if (due.length < limit) {
      const capacity = limit - due.length;
      const pages = Math.max(1, Math.ceil(rotating.length / capacity));
      candidates = [...due, ...rotating.slice((week % pages) * capacity, (week % pages + 1) * capacity)];
    } else {
      // Even an oversized overdue list cannot starve the rest of the inventory.
      const pages = Math.ceil(entries.length / limit);
      candidates = entries.slice((week % pages) * limit, (week % pages + 1) * limit);
    }
  }
  return {
    mode: need ? "need" : "weekly",
    total,
    eligible,
    candidates,
    omitted: Math.max(0, entries.length - candidates.length),
    note: "Advisory candidates only. Recheck the primary source and current code before any experiment or change; no recommendation is auto-approved.",
  };
}