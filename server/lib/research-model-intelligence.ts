export const MODEL_INTELLIGENCE_PROGRAM = "Nightly AI Model & Provider Intelligence";
export const ANTHROPIC_MODEL_SOURCE = "https://api.anthropic.com/v1/models";
export const ANTHROPIC_LIFECYCLE_SOURCE = "https://platform.claude.com/docs/en/about-claude/model-deprecations.md";
export const MODEL_RELEASE_WINDOW_DAYS = 90;
const DAY = 86_400_000;
const MODEL_ID = /^claude-[a-z0-9]+(?:-[a-z0-9]+)+$/;
const DATED_SUFFIX = /-(\d{4})(\d{2})(\d{2})$/;

export interface ResearchModelCandidate {
  provider: "anthropic";
  id: string;
  releaseDate: string;
  sourceUrl: typeof ANTHROPIC_MODEL_SOURCE;
  lifecycleUrl: typeof ANTHROPIC_LIFECYCLE_SOURCE;
}

export function canonicalAnthropicModel(value: string): string {
  return value.toLowerCase().replace(/^anthropic\//, "").replace(/(?:-latest|-\d{8})$/, "");
}

/** Don't interpret absence from a negative list as active. Require an exact
 * affirmative row in the official status table and refuse format drift. */
export function parseAnthropicActiveModels(text: string): ReadonlySet<string> | null {
  const section = /^## Model status[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m;
  const body = section.exec(text)?.[1];
  if (!body) return null;
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === "| API model name | Current state | Deprecated | Tentative retirement date |");
  if (start < 0 || !/^\s*\|(?:\s*:?-+:?\s*\|){4}\s*$/.test(lines[start + 1] ?? "")) return null;
  const seen = new Set<string>();
  const active = new Set<string>();
  for (const line of lines.slice(start + 2)) {
    if (!line.trim()) break;
    const row = /^\|\s*`?(claude-[a-z0-9-]+)`?\s*\|\s*(Active|Legacy|Deprecated|Retired)\s*\|[^|]+\|[^|]+\|\s*$/.exec(line);
    if (!row || !MODEL_ID.test(row[1]) || seen.has(row[1])) return null;
    seen.add(row[1]);
    if (row[2] === "Active") active.add(row[1]);
  }
  return seen.size ? active : null;
}

export function configuredAnthropicResearchKey(env: { ANTHROPIC_API_TOKEN?: string; ANTHROPIC_API_KEY?: string }): string | null {
  const key = (env.ANTHROPIC_API_TOKEN ?? env.ANTHROPIC_API_KEY ?? "").trim();
  return key.startsWith("sk-ant-") ? key : null;
}

/** The provider documents created_at as the release timestamp. Cross-check
 * exact active identity independently; if the ID encodes a date, require agreement. */
export function selectRecentAnthropicModels(
  data: readonly unknown[], activeIds: ReadonlySet<string>,
  registryIds: Iterable<string>, retiredIds: Iterable<string>, now: number,
): ResearchModelCandidate[] {
  const known = new Set([...registryIds, ...retiredIds].map(canonicalAnthropicModel));
  const candidates = new Map<string, ResearchModelCandidate>();
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const { id, created_at, type } = raw as Record<string, unknown>;
    if (type !== "model" || typeof id !== "string" || id.length > 96 || !MODEL_ID.test(id) ||
        /(?:-latest|-preview)$/.test(id) || !activeIds.has(id) ||
        typeof created_at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(created_at)) continue;
    if (known.has(canonicalAnthropicModel(id))) continue;
    const version = DATED_SUFFIX.exec(id);
    const releaseDate = created_at.slice(0, 10);
    if (version && `${version[1]}-${version[2]}-${version[3]}` !== releaseDate) continue;
    const created = Date.parse(created_at);
    if (!Number.isFinite(created) ||
        new Date(created).toISOString().slice(0, 10) !== releaseDate ||
        created > now || now - created > MODEL_RELEASE_WINDOW_DAYS * DAY) continue;
    candidates.set(id, { provider: "anthropic", id, releaseDate, sourceUrl: ANTHROPIC_MODEL_SOURCE, lifecycleUrl: ANTHROPIC_LIFECYCLE_SOURCE });
  }
  return [...candidates.values()].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.id.localeCompare(b.id));
}

export function confirmsResearchModel(result: string, id: string): boolean {
  const lines = result.split(/\r?\n/).filter(line => /^\s*MODEL_ID\s*:/i.test(line));
  return lines.length === 1 && lines[0].trim() === `MODEL_ID: ${id}`;
}

export function researchModelDigestEvidence(text: unknown) {
  if (typeof text !== "string" || text.length > 2000) return null;
  try {
    const evidence = JSON.parse(text);
    if (evidence?.mode !== "provider_active_release" || evidence.provider !== "anthropic" ||
        typeof evidence.id !== "string" || evidence.id.length > 96 || !MODEL_ID.test(evidence.id) ||
        evidence.sourceUrl !== ANTHROPIC_MODEL_SOURCE || evidence.lifecycleUrl !== ANTHROPIC_LIFECYCLE_SOURCE ||
        !["queued", "already_recorded", "below_threshold"].includes(evidence.registryReview) ||
        evidence.performanceVerified !== false ||
        typeof evidence.releaseDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.releaseDate)) return null;
    const date = new Date(`${evidence.releaseDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== evidence.releaseDate) return null;
    return {
      id: evidence.id as string, releaseDate: evidence.releaseDate as string,
      sourceUrl: ANTHROPIC_MODEL_SOURCE, lifecycleUrl: ANTHROPIC_LIFECYCLE_SOURCE,
    };
  } catch {
    return null;
  }
}

/** A verified release is a review item, not a reason to draft routing changes. */
export function admitsResearchCodeProposal(programName: string): boolean {
  return programName !== MODEL_INTELLIGENCE_PROGRAM;
}
