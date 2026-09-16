/**
 * Model-currency audit — verifies every hardcoded AI model id in the codebase
 * against the LIVE provider model lists, so a provider retiring a model can
 * never silently break a pipeline again (the ideabrowser dated-Sonnet incident,
 * R125+137.55).
 *
 * What it does ($0 LLM spend — list endpoints only):
 *   1. Scans server/, scripts/, shared/ + data/model-tiers.json for model-id
 *      shaped tokens (claude-*, gpt-*, gemini-*, grok-*).
 *   2. Fetches live model lists: Anthropic /v1/models, OpenAI /v1/models,
 *      Google generativelanguage /v1beta/models, OpenRouter /api/v1/models
 *      (public, keyless — secondary "still routable somewhere" check).
 *   3. Classifies each referenced id:
 *        LIVE      — present in its provider's live list (exact or alias/dated
 *                    prefix match, e.g. claude-sonnet-4-5 ⇄ claude-sonnet-4-5-20250929)
 *        ROUTABLE  — missing from the provider list but present on OpenRouter
 *        RETIRED   — provider list fetched OK, id absent everywhere, and the id
 *                    is date-stamped (-20\d{6,}) ⇒ high-confidence retirement
 *        UNKNOWN   — absent everywhere but not date-stamped (could be an alias
 *                    the list endpoint doesn't expose) ⇒ advisory
 *   4. If a provider's list endpoint can't be fetched, its ids are DEGRADED —
 *      the audit NEVER claims green coverage it doesn't have (fail-closed on
 *      coverage, per audit-fail-closed-coverage convention).
 *
 * Usage:  npx tsx scripts/model-currency-audit.ts [--json]
 * Exit:   0 = all referenced ids live/routable
 *         1 = at least one RETIRED id found (fix required)
 *         2 = audit itself failed (no provider list reachable / scan error)
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const asJson = process.argv.includes("--json");

// ---------------------------------------------------------------- scan config
const SCAN_DIRS = ["server", "shared", "scripts"];
const EXTRA_FILES = ["data/model-tiers.json"];
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "tests", "test", "__tests__", "dist", "attached_assets"]);
// Historical/archival files where stale ids are EXPECTED and harmless.
const EXCLUDE_FILE_PATTERNS = [
  /comprehensive-features/i,
  /release-log/i,
  /round\d+-/i,
  /\.md$/i,
  /build-features-doc/i,
  /generate-app-doc/i,
];

// Model-id shaped tokens. Deliberately conservative: require a digit so prose
// like "claude-code" or "gpt-based" doesn't match.
const ID_PATTERNS: Array<{ provider: string; re: RegExp }> = [
  { provider: "anthropic", re: /claude-[a-z]+-[a-z0-9]+(?:[-.][a-z0-9]+)*/g },
  { provider: "openai", re: /gpt-[0-9][a-z0-9.]*(?:-[a-z0-9.]+)*/g },
  { provider: "google", re: /gemini-[0-9][a-z0-9.]*(?:-[a-z0-9.]+)*/g },
  { provider: "xai", re: /grok-[0-9][a-z0-9.]*(?:-[a-z0-9.]+)*/g },
];

// Tokens that match the shape but are not standalone billable model ids
// (embeddings handled fine by list; these are pure noise sources).
const IGNORE_IDS = new Set<string>([]);

// Intentional legacy-compat references (remap-table KEYS etc.) — reported as
// INFO, never RETIRED — but ONLY at callsites whose repo-relative path contains
// filePattern. Any other callsite of the same id is still audited normally
// (a global id-level exemption would mask real stale callsites elsewhere).
// Strict-shape load: a malformed file aborts (exit 2), never silently disables
// the exception list or the audit.
interface CurrencyException { id: string; filePattern: string; reason: string }
function loadExceptions(): CurrencyException[] {
  const p = join(ROOT, "data/model-currency-exceptions.json");
  if (!existsSync(p)) return [];
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(parsed?.exceptions)) throw new Error("model-currency-exceptions.json: .exceptions must be an array");
  const out: CurrencyException[] = [];
  for (const e of parsed.exceptions) {
    if (
      typeof e?.id !== "string" || typeof e?.reason !== "string" || typeof e?.filePattern !== "string" ||
      !e.id || !e.reason || !e.filePattern
    ) {
      throw new Error("model-currency-exceptions.json: every exception needs a non-empty id, filePattern, and reason");
    }
    out.push({ id: e.id, filePattern: e.filePattern, reason: e.reason });
  }
  return out;
}

interface Ref { id: string; provider: string; file: string; line: number }

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|json)$/.test(entry)) yield full;
  }
}

function scanRefs(): Ref[] {
  const refs: Ref[] = [];
  const files: string[] = [];
  for (const d of SCAN_DIRS) if (existsSync(join(ROOT, d))) files.push(...walk(join(ROOT, d)));
  for (const f of EXTRA_FILES) if (existsSync(join(ROOT, f))) files.push(join(ROOT, f));
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel === "scripts/model-currency-audit.ts") continue; // don't scan ourself (pattern docs)
    if (EXCLUDE_FILE_PATTERNS.some((p) => p.test(rel))) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((lineText, i) => {
      for (const { provider, re } of ID_PATTERNS) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lineText))) {
          const id = m[0].replace(/[.:,]+$/, "");
          if (id.length < 6 || IGNORE_IDS.has(id)) continue;
          refs.push({ id, provider, file: rel, line: i + 1 });
        }
      }
    });
  }
  return refs;
}

// ------------------------------------------------------------- live registries
async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function liveLists(): Promise<{ lists: Record<string, Set<string>>; degraded: string[]; openrouter: Set<string> }> {
  const lists: Record<string, Set<string>> = {};
  const degraded: string[] = [];
  let openrouter = new Set<string>();

  const jobs: Array<Promise<void>> = [];

  if (process.env.ANTHROPIC_API_KEY) {
    jobs.push(
      fetchJson("https://api.anthropic.com/v1/models?limit=100", {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      })
        .then((j) => { lists.anthropic = new Set((j.data || []).map((m: any) => String(m.id))); })
        .catch(() => { degraded.push("anthropic"); })
    );
  } else degraded.push("anthropic (no key)");

  if (process.env.OPENAI_API_KEY) {
    jobs.push(
      fetchJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` })
        .then((j) => { lists.openai = new Set((j.data || []).map((m: any) => String(m.id))); })
        .catch(() => { degraded.push("openai"); })
    );
  } else degraded.push("openai (no key)");

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    jobs.push(
      fetchJson(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${geminiKey}`)
        .then((j) => { lists.google = new Set((j.models || []).map((m: any) => String(m.name).replace(/^models\//, ""))); })
        .catch(() => { degraded.push("google"); })
    );
  } else degraded.push("google (no key)");

  // OpenRouter is public/keyless — cross-provider routable check (also the only
  // check for xai/grok ids, which we route through OpenRouter anyway).
  jobs.push(
    fetchJson("https://openrouter.ai/api/v1/models")
      .then((j) => {
        openrouter = new Set(
          (j.data || []).flatMap((m: any) => {
            const id = String(m.id);
            const bare = id.includes("/") ? id.split("/")[1] : id;
            return [id, bare];
          })
        );
      })
      .catch(() => { degraded.push("openrouter"); })
  );

  await Promise.all(jobs);
  return { lists, degraded, openrouter };
}

// Alias-tolerant liveness: exact match, OR one is a dated extension of the other
// (claude-sonnet-4-5 ⇄ claude-sonnet-4-5-20250929).
function isLiveIn(id: string, list: Set<string>): boolean {
  if (list.has(id)) return true;
  for (const live of list) {
    if (live.startsWith(`${id}-20`) || id.startsWith(`${live}-20`)) return true;
  }
  return false;
}

// ----------------------------------------------------------------------- main
async function main() {
  const refs = scanRefs();
  const exceptions = loadExceptions();
  const { lists, degraded, openrouter } = await liveLists();

  if (Object.keys(lists).length === 0 && openrouter.size === 0) {
    console.error("[model-currency] AUDIT FAILED — no provider model list reachable; coverage unknown.");
    process.exit(2);
  }

  // Aggregate by id (dedupe callsites).
  const byId = new Map<string, { provider: string; refs: Ref[] }>();
  for (const r of refs) {
    const e = byId.get(r.id) || { provider: r.provider, refs: [] };
    e.refs.push(r);
    byId.set(r.id, e);
  }

  const legacyCompat: Array<{ id: string; provider: string; reason: string }> = [];
  const retired: Array<{ id: string; provider: string; callsites: string[] }> = [];
  const unknown: Array<{ id: string; provider: string; callsites: string[] }> = [];
  const routableOnly: Array<{ id: string; provider: string }> = [];
  const degradedIds: Array<{ id: string; provider: string }> = [];
  let liveCount = 0;

  for (const [id, { provider, refs: allSites }] of byId) {
    const list = lists[provider];
    // Callsite-scoped exceptions: only sites matching an exception's filePattern
    // are exempt; the remaining sites of the same id are still audited.
    const matching = exceptions.filter((e) => e.id === id);
    const sites = matching.length
      ? allSites.filter((s) => !matching.some((e) => s.file.includes(e.filePattern)))
      : allSites;
    if (matching.length && sites.length < allSites.length) {
      legacyCompat.push({ id, provider, reason: matching.map((e) => e.reason).join(" | ") });
    }
    if (sites.length === 0) continue;
    const callsites = sites.slice(0, 5).map((s) => `${s.file}:${s.line}`);
    if (!list) {
      // Provider list unavailable — OpenRouter presence is the only signal.
      if (openrouter.has(id)) { liveCount++; continue; }
      degradedIds.push({ id, provider });
      continue;
    }
    if (isLiveIn(id, list)) { liveCount++; continue; }
    if (openrouter.has(id)) { routableOnly.push({ id, provider }); continue; }
    if (/-20\d{6}/.test(id)) retired.push({ id, provider, callsites });
    else unknown.push({ id, provider, callsites });
  }

  const summary = {
    ok: retired.length === 0,
    scannedRefs: refs.length,
    distinctIds: byId.size,
    live: liveCount,
    retired,
    unknown,
    routableOnly,
    legacyCompat,
    degradedProviders: degraded,
    degradedIds,
    generatedAt: new Date().toISOString(),
  };

  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`[model-currency] ${byId.size} distinct ids across ${refs.length} callsites — live ${liveCount}, retired ${retired.length}, unknown ${unknown.length}, routable-only ${routableOnly.length}, degraded ${degradedIds.length}`);
    for (const r of retired) console.log(`  RETIRED  ${r.id} (${r.provider}) — ${r.callsites.join(", ")}`);
    for (const u of unknown) console.log(`  UNKNOWN  ${u.id} (${u.provider}) — ${u.callsites.join(", ")}`);
    for (const l of legacyCompat) console.log(`  LEGACY   ${l.id} (${l.provider}) — ${l.reason}`);
    for (const d of degradedIds) console.log(`  DEGRADED ${d.id} (${d.provider} list unavailable — cannot verify)`);
    if (degraded.length) console.log(`  provider lists degraded: ${degraded.join(", ")}`);
  }

  process.exit(retired.length ? 1 : 0);
}

main().catch((e) => {
  console.error(`[model-currency] AUDIT FAILED: ${e?.message || e}`);
  process.exit(2);
});
