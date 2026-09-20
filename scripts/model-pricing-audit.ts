// Model-PRICING currency audit (R125+137.57).
//
// The model-currency audit (Pass 16) catches RETIRED model ids; this script catches
// STALE PRICES. Three files independently claim per-token unit cost:
//   - server/agentic/cost-ledger.ts        MODEL_COST_PER_1K        ($ per 1K)
//   - server/resource-predictor.ts         MODEL_COST_PER_MILLION   ($ per 1M)
//   - server/insights-engine.ts            PRICING_PER_M_TOKENS     ($ per 1M)
// Cross-map AGREEMENT is already pinned by tests/cost/model-pricing-drift.test.ts.
// What nothing verified until now: whether the agreed number matches the REAL
// provider rate (the Opus-4.5 incident: all maps could have happily agreed on the
// stale $15/$75 while the live rate was $5/$25).
//
// Verification source: keyless OpenRouter /api/v1/models pricing (prompt/completion
// $ per token → per M). Ids are normalized (provider prefix stripped, "." ⇄ "-")
// to match OpenRouter naming.
//
// Classification per map entry:
//   OK         — live rate found, within tolerance (default 1% relative)
//   DRIFT      — live rate found, differs beyond tolerance  → exit 1 (RED)
//   FROZEN     — in data/model-pricing-exceptions.json (deliberate legacy /
//                unverifiable), reported INFO, never DRIFT
//   UNVERIFIED — not listed on OpenRouter (integration-lane ids, previews) → advisory
//
// Fail-closed: if OpenRouter is unreachable or returns no priced models, exit 2
// (coverage unknown) — never a silent green. Strict-shape exceptions load aborts
// on malformed file (same convention as model-currency-audit).
//
// Static text parse only — importing server modules would open the pg pool
// (memory: node-test DB-pool hang).
//
// Usage: npx tsx scripts/model-pricing-audit.ts [--json] [--tolerance 0.01]
// Exit codes: 0 = current · 1 = pricing drift found · 2 = audit failure.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const JSON_MODE = process.argv.includes("--json");
const tolArg = process.argv.indexOf("--tolerance");
const TOLERANCE = tolArg >= 0 ? Number(process.argv[tolArg + 1]) : 0.01;
if (!(TOLERANCE > 0 && TOLERANCE < 1)) {
  console.error("[pricing-audit] --tolerance must be a fraction in (0,1)");
  process.exit(2);
}

type Price = { inPerM: number; outPerM: number };
type PriceMap = Record<string, Price>;

// ------------------------------------------------------------- map parsing
function sliceDecl(path: string, marker: string): string {
  const src = readFileSync(resolve(ROOT, path), "utf8");
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`${path}: declaration marker "${marker}" not found — map renamed? Update this audit.`);
  const rest = src.slice(start);
  const end = rest.search(/^\};|^\];/m);
  if (end < 0) throw new Error(`${path}: could not find end of "${marker}" declaration`);
  return rest.slice(0, end);
}

function parseLedger(): PriceMap {
  const block = sliceDecl("server/agentic/cost-ledger.ts", "MODEL_COST_PER_1K");
  const out: PriceMap = {};
  for (const m of block.matchAll(/"([^"]+)":\s*\{\s*in:\s*([\d.]+),\s*out:\s*([\d.]+)\s*\}/g)) {
    out[m[1]] = { inPerM: Number(m[2]) * 1000, outPerM: Number(m[3]) * 1000 };
  }
  if (Object.keys(out).length < 20) throw new Error("cost-ledger parse yielded suspiciously few entries — regex drift?");
  return out;
}

function parsePredictor(): PriceMap {
  const block = sliceDecl("server/resource-predictor.ts", "MODEL_COST_PER_MILLION");
  const out: PriceMap = {};
  for (const m of block.matchAll(/"([^"]+)":\s*\{\s*input:\s*([\d.]+),\s*output:\s*([\d.]+)\s*\}/g)) {
    out[m[1]] = { inPerM: Number(m[2]), outPerM: Number(m[3]) };
  }
  if (Object.keys(out).length < 20) throw new Error("resource-predictor parse yielded suspiciously few entries — regex drift?");
  return out;
}

function parseInsights(): PriceMap {
  const block = sliceDecl("server/insights-engine.ts", "PRICING_PER_M_TOKENS");
  const out: PriceMap = {};
  for (const m of block.matchAll(/\["([^"]+)",\s*\{\s*in:\s*([\d.]+),\s*out:\s*([\d.]+)\s*\}\]/g)) {
    const p = { inPerM: Number(m[2]), outPerM: Number(m[3]) };
    if (p.inPerM === 0 && p.outPerM === 0) continue; // deliberate free integration lane
    out[m[1]] = p;
  }
  if (Object.keys(out).length < 15) throw new Error("insights-engine parse yielded suspiciously few entries — regex drift?");
  return out;
}

// ------------------------------------------------------------- exceptions
// Frozen-price ids (deliberate legacy pricing / delisted-unverifiable). Strict-shape
// load: malformed file aborts (exit 2), never silently disables the list.
interface PricingException { id: string; reason: string }
function loadExceptions(): PricingException[] {
  const p = join(ROOT, "data/model-pricing-exceptions.json");
  if (!existsSync(p)) return [];
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  if (!Array.isArray(parsed?.exceptions)) throw new Error("model-pricing-exceptions.json: .exceptions must be an array");
  const out: PricingException[] = [];
  for (const e of parsed.exceptions) {
    if (typeof e?.id !== "string" || typeof e?.reason !== "string" || !e.id || !e.reason) {
      throw new Error("model-pricing-exceptions.json: every exception needs a non-empty id and reason");
    }
    out.push({ id: e.id, reason: e.reason });
  }
  return out;
}

// ------------------------------------------------------------- live rates
// Normalize an id for matching: strip provider prefix, lowercase, unify "." → "-".
function norm(id: string): string {
  const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  return bare.toLowerCase().replace(/\./g, "-");
}

async function fetchOpenRouter(): Promise<Map<string, Price>> {
  const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`OpenRouter /models HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
  const map = new Map<string, Price>();
  for (const m of body.data ?? []) {
    const inTok = Number(m.pricing?.prompt);
    const outTok = Number(m.pricing?.completion);
    if (!(inTok > 0) || !(outTok > 0)) continue; // skip free/unpriced variants
    if (/:free$|:extended$|-fast$/.test(m.id)) continue; // variant SKUs, not the base rate
    const key = norm(m.id);
    // Prefer the first (canonical) listing; don't let variants overwrite it.
    if (!map.has(key)) map.set(key, { inPerM: inTok * 1e6, outPerM: outTok * 1e6 });
  }
  return map;
}

function relDiff(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  return Math.abs(a - b) / scale;
}

// ------------------------------------------------------------- main
async function main() {
  const maps: Array<[string, PriceMap]> = [
    ["cost-ledger", parseLedger()],
    ["resource-predictor", parsePredictor()],
    ["insights-engine", parseInsights()],
  ];
  const exceptions = loadExceptions();
  const frozen = new Set(exceptions.map((e) => e.id));

  let live: Map<string, Price>;
  try {
    live = await fetchOpenRouter();
  } catch (e) {
    console.error(`[pricing-audit] AUDIT FAILED — OpenRouter unreachable: ${String((e as Error)?.message ?? e)}`);
    process.exit(2);
  }
  if (live.size < 50) {
    console.error(`[pricing-audit] AUDIT FAILED — OpenRouter returned only ${live.size} priced models; coverage unknown.`);
    process.exit(2);
  }

  const drift: Array<{ map: string; id: string; local: Price; live: Price; diffPct: string }> = [];
  const unverified: Array<{ map: string; id: string }> = [];
  const frozenHits: Array<{ id: string; reason: string }> = [];
  const healedExceptions: string[] = [];
  let okCount = 0;

  const seenFrozen = new Set<string>();
  for (const [mapName, priceMap] of maps) {
    for (const [id, local] of Object.entries(priceMap)) {
      const liveRate = live.get(norm(id));
      if (frozen.has(id)) {
        // Frozen ids whose live rate now AGREES should be pruned (ratchet, same as KNOWN_DRIFT).
        if (liveRate && relDiff(local.inPerM, liveRate.inPerM) < TOLERANCE && relDiff(local.outPerM, liveRate.outPerM) < TOLERANCE) {
          if (!healedExceptions.includes(id)) healedExceptions.push(id);
        }
        if (!seenFrozen.has(id)) {
          seenFrozen.add(id);
          frozenHits.push({ id, reason: exceptions.find((e) => e.id === id)!.reason });
        }
        continue;
      }
      if (!liveRate) { unverified.push({ map: mapName, id }); continue; }
      const dIn = relDiff(local.inPerM, liveRate.inPerM);
      const dOut = relDiff(local.outPerM, liveRate.outPerM);
      if (dIn >= TOLERANCE || dOut >= TOLERANCE) {
        drift.push({
          map: mapName, id, local, live: liveRate,
          diffPct: `${(Math.max(dIn, dOut) * 100).toFixed(1)}%`,
        });
      } else okCount++;
    }
  }

  const summary = {
    ok: okCount,
    drift,
    unverified,
    frozen: frozenHits,
    healedExceptions,
    tolerance: TOLERANCE,
    liveModelCount: live.size,
    generatedAt: new Date().toISOString(),
  };

  if (JSON_MODE) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`[pricing-audit] ok=${okCount} drift=${drift.length} unverified=${unverified.length} frozen=${frozenHits.length} (live models: ${live.size}, tolerance ${TOLERANCE * 100}%)`);
    for (const d of drift) {
      console.log(`  DRIFT ${d.map} ${d.id}: local $${d.local.inPerM}/$${d.local.outPerM} per M vs live $${d.live.inPerM}/$${d.live.outPerM} per M (${d.diffPct})`);
    }
    for (const u of unverified) console.log(`  UNVERIFIED ${u.map} ${u.id} (not on OpenRouter — verify by hand or add a frozen exception with a reason)`);
    for (const h of healedExceptions) console.log(`  HEALED exception ${h} — live rate now agrees; prune it from data/model-pricing-exceptions.json`);
  }

  process.exit(drift.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`[pricing-audit] AUDIT FAILED — ${String((e as Error)?.stack ?? e)}`);
  process.exit(2);
});
