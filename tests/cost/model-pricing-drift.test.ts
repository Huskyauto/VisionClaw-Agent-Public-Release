// Model-pricing cross-map drift guard (R125+135).
//
// Three files independently claim per-token unit cost for AI models:
//   - server/agentic/cost-ledger.ts        MODEL_COST_PER_1K        ($ per 1K tokens)
//   - server/resource-predictor.ts         MODEL_COST_PER_MILLION   ($ per 1M tokens)
//   - server/insights-engine.ts            PRICING_PER_M_TOKENS     ($ per 1M tokens; fuzzy
//                                          prefix table with DELIBERATE {0,0} rows for free
//                                          integration lanes — zero rows are skipped here)
//
// R125+134 architect review found metered Grok usage was being ledgered at ~$0 because
// cost-ledger simply lacked the entries — the other two maps had them. This test is the
// ratchet that prevents the next silent divergence:
//   1. For every model id present (exact match) in two maps, prices must agree within a
//      relative epsilon — UNLESS the pair is enumerated in KNOWN_DRIFT below.
//   2. KNOWN_DRIFT is a snapshot of drift that PRE-DATES this guard (documented, visible,
//      to be reconciled deliberately — see the R125+3.7+sec precedent). Removing an id from
//      a map or fixing its price should be paired with pruning it from this list. NEVER add
//      a new id here to silence a failure without verifying the true provider rate.
//      (2026-07-11 reconciliation: all drifting ids were resynced to live OpenRouter rates
//      EXCEPT the two xiaomi MiMo ids, which are delisted from OpenRouter — unverifiable.)
//   3. The Grok ids specifically must exist in ALL three maps at their live OpenRouter rates:
//      grok-4.5 $2/$6 per M, grok-4.20-multi-agent $1.25/$2.50 per M (verified 2026-07-11).
//
// Static text parse only — importing server modules would open the pg pool and hang the
// node:test runner (see memory: node-test DB-pool hang).

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Price = { inPerM: number; outPerM: number };
type PriceMap = Record<string, Price>;

const ROOT = resolve(import.meta.dirname, "..", "..");

function sliceDecl(path: string, marker: string): string {
  const src = readFileSync(resolve(ROOT, path), "utf8");
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `${path}: declaration marker "${marker}" not found — map renamed? Update this guard.`);
  const rest = src.slice(start);
  const end = rest.search(/^\};|^\];/m);
  assert.ok(end >= 0, `${path}: could not find end of "${marker}" declaration`);
  return rest.slice(0, end);
}

function parseLedger(): PriceMap {
  // "id": { in: X, out: Y }  — per 1K → normalize to per 1M
  const block = sliceDecl("server/agentic/cost-ledger.ts", "MODEL_COST_PER_1K");
  const out: PriceMap = {};
  for (const m of block.matchAll(/"([^"]+)":\s*\{\s*in:\s*([\d.]+),\s*out:\s*([\d.]+)\s*\}/g)) {
    out[m[1]] = { inPerM: Number(m[2]) * 1000, outPerM: Number(m[3]) * 1000 };
  }
  assert.ok(Object.keys(out).length >= 20, "cost-ledger parse yielded suspiciously few entries — regex drift?");
  return out;
}

function parsePredictor(): PriceMap {
  // "id": { input: X, output: Y }  — already per 1M
  const block = sliceDecl("server/resource-predictor.ts", "MODEL_COST_PER_MILLION");
  const out: PriceMap = {};
  for (const m of block.matchAll(/"([^"]+)":\s*\{\s*input:\s*([\d.]+),\s*output:\s*([\d.]+)\s*\}/g)) {
    out[m[1]] = { inPerM: Number(m[2]), outPerM: Number(m[3]) };
  }
  assert.ok(Object.keys(out).length >= 20, "resource-predictor parse yielded suspiciously few entries — regex drift?");
  return out;
}

function parseInsights(): PriceMap {
  // ["id", { in: X, out: Y }]  — per 1M; skip deliberate {0,0} free-lane rows
  const block = sliceDecl("server/insights-engine.ts", "PRICING_PER_M_TOKENS");
  const out: PriceMap = {};
  for (const m of block.matchAll(/\["([^"]+)",\s*\{\s*in:\s*([\d.]+),\s*out:\s*([\d.]+)\s*\}\]/g)) {
    const p = { inPerM: Number(m[2]), outPerM: Number(m[3]) };
    if (p.inPerM === 0 && p.outPerM === 0) continue; // deliberate free integration lane
    out[m[1]] = p;
  }
  assert.ok(Object.keys(out).length >= 15, "insights-engine parse yielded suspiciously few entries — regex drift?");
  return out;
}

// Pre-existing drift snapshot (measured 2026-07-11 when this guard shipped).
// Format: "mapA|mapB" -> set of model ids allowed to disagree between those two maps.
const KNOWN_DRIFT: Record<string, string[]> = {
  // 2026-07-11: everything else reconciled to live OpenRouter rates. The xiaomi MiMo ids
  // are DELISTED from OpenRouter (model-freshness flags them stale) — true rate is
  // unverifiable, so their values stay frozen until the ids are retired from the maps.
  "predictor|insights": ["xiaomi/mimo-v2-flash", "xiaomi/mimo-v2-omni"],
};

function close(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  return Math.abs(a - b) / scale < 1e-6;
}

function comparePair(nameA: string, mapA: PriceMap, nameB: string, mapB: PriceMap) {
  const allow = new Set(KNOWN_DRIFT[`${nameA}|${nameB}`] ?? []);
  // Stale-allowlist guard (architect R125+135): an allowlisted id that no longer exists in
  // BOTH maps is dead weight — prune it so the list stays an honest snapshot.
  const stale = [...allow].filter((id) => !(id in mapA) || !(id in mapB));
  assert.deepStrictEqual(
    stale,
    [],
    `KNOWN_DRIFT["${nameA}|${nameB}"] contains ids no longer present in both maps — prune them: ${stale.join(", ")}`,
  );
  const drift: string[] = [];
  const healed: string[] = [];
  for (const id of Object.keys(mapA)) {
    if (!(id in mapB)) continue;
    const a = mapA[id];
    const b = mapB[id];
    const agrees = close(a.inPerM, b.inPerM) && close(a.outPerM, b.outPerM);
    if (!agrees && !allow.has(id)) {
      drift.push(`${id}: ${nameA}=($${a.inPerM}/M in, $${a.outPerM}/M out) vs ${nameB}=($${b.inPerM}/M in, $${b.outPerM}/M out)`);
    }
    if (agrees && allow.has(id)) healed.push(id);
  }
  assert.deepStrictEqual(
    drift,
    [],
    `NEW pricing drift between ${nameA} and ${nameB} (not in KNOWN_DRIFT — reconcile the maps to the real provider rate, do NOT just allowlist):\n${drift.join("\n")}`,
  );
  // Ratchet: once a known-drift id is reconciled, prune it so it can't silently re-drift.
  assert.deepStrictEqual(
    healed,
    [],
    `These ids now AGREE between ${nameA} and ${nameB} — remove them from KNOWN_DRIFT["${nameA}|${nameB}"] to lock the fix in: ${healed.join(", ")}`,
  );
}

const ledger = parseLedger();
const predictor = parsePredictor();
const insights = parseInsights();

test("no NEW pricing drift: cost-ledger vs resource-predictor", () => {
  comparePair("ledger", ledger, "predictor", predictor);
});

test("no NEW pricing drift: cost-ledger vs insights-engine", () => {
  comparePair("ledger", ledger, "insights", insights);
});

test("no NEW pricing drift: resource-predictor vs insights-engine", () => {
  comparePair("predictor", predictor, "insights", insights);
});

test("R125+136 reconciled ids are PRESENT in the cost-ledger map (absence = silent fallback mispricing)", () => {
  // The cross-map drift tests only compare OVERLAPPING ids — a reconciled id that is
  // simply MISSING from a map is invisible to them. These ids were verified against
  // live OpenRouter rates 2026-07-11; absence from the ledger re-opens the exact bug
  // this round fixed (gpt-5-mini billed via the $5/$5 unknown-gpt fallback, glm-5.1
  // ledgered at $0 via the unknown-model fallback).
  const required: Record<string, Price> = {
    "gpt-5-mini": { inPerM: 0.25, outPerM: 2 },
    "z-ai/glm-5.1": { inPerM: 0.966, outPerM: 3.036 },
    "gpt-5.4": { inPerM: 2.5, outPerM: 15 },
    "gpt-4.1": { inPerM: 2, outPerM: 8 },
    "deepseek/deepseek-v3.2": { inPerM: 0.214, outPerM: 0.322 },
    "gemini-3-flash-preview": { inPerM: 0.5, outPerM: 3 },
  };
  for (const [id, want] of Object.entries(required)) {
    const p = ledger[id];
    assert.ok(p, `${id} missing from cost-ledger pricing map`);
    assert.ok(
      close(p.inPerM, want.inPerM) && close(p.outPerM, want.outPerM),
      `${id} in ledger expected $${want.inPerM}/$${want.outPerM} per M, got $${p.inPerM}/$${p.outPerM}`,
    );
  }
});

test("platform default model gpt-5.6-sol present in all three maps (R125+137.3 regression)", () => {
  // The Sol migration flipped most defaults to gpt-5.6-sol while all three pricing maps
  // lacked an entry: insights silently reported $0 for the majority of conversations
  // (pricingFor fall-through) and the ledger billed via the $5/$5 unknown-gpt fallback.
  // Flagship-class estimate (matches gpt-5.4) until a live rate is verified.
  const want: Price = { inPerM: 2.5, outPerM: 15 };
  for (const [name, map] of [["ledger", ledger], ["predictor", predictor], ["insights", insights]] as const) {
    const p = map["gpt-5.6-sol"];
    assert.ok(p, `gpt-5.6-sol missing from ${name} pricing map — default-model usage prices via silent fallback`);
    assert.ok(
      close(p.inPerM, want.inPerM) && close(p.outPerM, want.outPerM),
      `gpt-5.6-sol in ${name} expected $${want.inPerM}/$${want.outPerM} per M, got $${p.inPerM}/$${p.outPerM}`,
    );
  }
});

test("Grok ids present in all three maps at live OpenRouter rates (R125+134 regression)", () => {
  const expected: Record<string, Price> = {
    "x-ai/grok-4.5": { inPerM: 2, outPerM: 6 },
    "x-ai/grok-4.20-multi-agent": { inPerM: 1.25, outPerM: 2.5 },
  };
  for (const [id, want] of Object.entries(expected)) {
    for (const [name, map] of [["ledger", ledger], ["predictor", predictor], ["insights", insights]] as const) {
      const p = map[id];
      assert.ok(p, `${id} missing from ${name} pricing map`);
      assert.ok(
        close(p.inPerM, want.inPerM) && close(p.outPerM, want.outPerM),
        `${id} in ${name} expected $${want.inPerM}/$${want.outPerM} per M, got $${p.inPerM}/$${p.outPerM}`,
      );
    }
  }
});
