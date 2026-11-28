import { sql } from "drizzle-orm";
import { db } from "./db";
import { MODEL_REGISTRY, RETIRED_MODEL_IDS } from "./model-registry";
import { ADMIN_TENANT_ID } from "./tenant-constants";
import {
  ANTHROPIC_LIFECYCLE_SOURCE, ANTHROPIC_MODEL_SOURCE, canonicalAnthropicModel,
  configuredAnthropicResearchKey, parseAnthropicActiveModels, selectRecentAnthropicModels,
  type ResearchModelCandidate,
} from "./lib/research-model-intelligence";

const CATALOG_TTL = 60 * 60_000;
const FAILURE_TTL = 15 * 60_000;
type OfficialCatalog = { rows: readonly unknown[]; active: ReadonlySet<string> };
let cached: { expires: number; data: OfficialCatalog | null } | undefined;
let inFlight: Promise<OfficialCatalog | null> | undefined;

async function boundedText(response: Response): Promise<string | null> {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const reader = response.body.getReader();
  let text = "";
  let bytes = 0;
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 128_000) return null;
      text += utf8.decode(value, { stream: true });
    }
    return text + utf8.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function fetchOfficialCatalog(): Promise<OfficialCatalog | null> {
  // Existing platform direct auth, never tenant credentials or a proxy.
  const apiKey = configuredAnthropicResearchKey({
    ANTHROPIC_API_TOKEN: process.env.ANTHROPIC_API_TOKEN,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  });
  if (!apiKey) return null;
  const signal = AbortSignal.timeout(8000);
  const [catalog, lifecycle] = await Promise.all([
    fetch(`${ANTHROPIC_MODEL_SOURCE}?limit=100`, {
      redirect: "error", signal,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", Accept: "application/json" },
    }).then(boundedText),
    fetch(ANTHROPIC_LIFECYCLE_SOURCE, {
      redirect: "error", signal, headers: { Accept: "text/markdown" },
    }).then(boundedText),
  ]);
  if (catalog === null || lifecycle === null) return null;
  const rows = JSON.parse(catalog)?.data;
  const active = parseAnthropicActiveModels(lifecycle);
  return Array.isArray(rows) && rows.length <= 100 && active ? { rows, active } : null;
}

async function readOfficialCatalog() {
  if (cached && cached.expires > Date.now()) return cached.data;
  if (!inFlight) {
    inFlight = fetchOfficialCatalog().catch(() => null).then(data => {
      cached = { data, expires: Date.now() + (data ? CATALOG_TTL : FAILURE_TTL) };
      return data;
    }).finally(() => { inFlight = undefined; });
  }
  return inFlight;
}

// Compare exact provider-qualified identities with their known alias/snapshot
// spellings. This is dedupe, not a blanket major-version retirement policy.
const priorCandidate = (tenantId: number, key: string) => sql`
  SELECT id FROM model_registry_updates
  WHERE tenant_id = ${tenantId} AND update_type = 'add'
    AND regexp_replace(regexp_replace(lower(model_id), '^anthropic/', ''),
      '(-latest|-[0-9]{8})$', '') = ${key}
  LIMIT 1`;

export async function loadResearchModelCandidates(tenantId: number): Promise<ResearchModelCandidate[] | null> {
  if (tenantId !== ADMIN_TENANT_ID) return null;
  const catalog = await readOfficialCatalog();
  if (!catalog) return null;
  return selectRecentAnthropicModels(catalog.rows, catalog.active, MODEL_REGISTRY.map(m => m.id), RETIRED_MODEL_IDS, Date.now());
}

export async function queueResearchModelCandidate(tenantId: number, candidate: ResearchModelCandidate, score: number):
  Promise<"queued" | "already_recorded" | "evidence_unavailable"> {
  if (tenantId !== ADMIN_TENANT_ID || !Number.isInteger(score) || score < 8 || score > 10) return "evidence_unavailable";
  const key = canonicalAnthropicModel(candidate.id);
  // Recheck the current provider record/registry after the advisory model call.
  const current = await loadResearchModelCandidates(tenantId);
  const verified = current?.find(row => row.id === candidate.id && row.releaseDate === candidate.releaseDate);
  if (!verified) return "evidence_unavailable";
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`research-model-add:${tenantId}:${key}`}, 0::bigint))`);
    if ((await tx.execute(priorCandidate(tenantId, key))).rows.length) return "already_recorded";
    await tx.execute(sql`
      INSERT INTO model_registry_updates (tenant_id, update_type, model_id, model_data, status)
      VALUES (${tenantId}, 'add', ${verified.id},
        ${JSON.stringify({ source: "autoresearch", provider: verified.provider, release_date: verified.releaseDate,
          source_url: verified.sourceUrl, lifecycle_url: verified.lifecycleUrl,
          score, evidence: "provider-confirmed-active-release" })}::jsonb, 'pending')`);
    return "queued";
  });
}

export async function hasResearchModelCandidate(tenantId: number, candidate: ResearchModelCandidate) {
  if (tenantId !== ADMIN_TENANT_ID) return true;
  return (await db.execute(priorCandidate(tenantId, canonicalAnthropicModel(candidate.id)))).rows.length > 0;
}
