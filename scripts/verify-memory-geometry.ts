/**
 * R107 verification: prove the Geometry of Consolidation math works.
 *
 * Three layers:
 *   1. Synthetic clusters with known regime → assert computeClusterGeometry
 *      classifies them correctly (TIGHT / SPREAD / degenerate-collapsed).
 *   2. pairRegime sanity on the same vectors.
 *   3. Live scan against Bob's tenant memory — print top spread pairs +
 *      write an SVG chart of d̄ vs n per scanned scope.
 *
 * Run: npx tsx scripts/verify-memory-geometry.ts
 * Exit codes: 0 all PASS, 1 synthetic FAIL, 2 live-scan error.
 */

import { computeClusterGeometry, pairRegime } from "../server/lib/memory-geometry";
import * as fs from "fs";
import * as path from "path";

type Case = { name: string; vecs: number[][]; expectRegime: "tight" | "spread" | "degenerate"; theta: number; note: string };

function unitVec(d: number, seed: number): number[] {
  // Deterministic pseudo-random unit vector
  const v: number[] = [];
  let s = seed;
  for (let i = 0; i < d; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    v.push((s / 0xffffffff) - 0.5);
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return v.map(x => x / n);
}

function nearVec(base: number[], seed: number, eps: number): number[] {
  const v: number[] = [];
  let s = seed;
  for (let i = 0; i < base.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    v.push(base[i] + ((s / 0xffffffff) - 0.5) * eps);
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return v.map(x => x / n);
}

const D = 64; // small enough for quick test, large enough to be representative
const base = unitVec(D, 1);

const cases: Case[] = [
  {
    name: "TIGHT — 5 vectors clustered tight around a base (eps=0.02)",
    vecs: [base, ...Array.from({ length: 4 }, (_, i) => nearVec(base, 100 + i, 0.02))],
    expectRegime: "tight",
    theta: 0.85,
    note: "small jitter around base ⇒ d̄ should be tiny, well below θ'=0.15",
  },
  {
    name: "SPREAD — 5 random unit vectors in 64-D",
    vecs: [unitVec(D, 11), unitVec(D, 22), unitVec(D, 33), unitVec(D, 44), unitVec(D, 55)],
    expectRegime: "spread",
    theta: 0.85,
    note: "random high-dim unit vectors are nearly orthogonal ⇒ d̄ ≈ 1 ≫ θ'=0.15",
  },
  {
    name: "DEGENERATE-COLLAPSED — 5 identical vectors",
    vecs: [base, base, base, base, base],
    expectRegime: "tight",
    theta: 0.85,
    note: "identical ⇒ d̄ = 0; d_eff guarded to 1 by the R107 epsilon fix (no NaN)",
  },
  {
    name: "EDGE — single vector",
    vecs: [base],
    expectRegime: "degenerate",
    theta: 0.85,
    note: "n<2 ⇒ degenerate (no pairs to measure)",
  },
  {
    name: "BOUNDARY — pair at the regime cutoff",
    vecs: [base, nearVec(base, 7, 0.5)],
    expectRegime: "spread", // moderate jitter pushes d̄ above 0.15
    theta: 0.85,
    note: "moderate jitter ⇒ d̄ should land in spread for θ=0.85",
  },
];

let synthFail = 0;
const results: Array<{ name: string; n: number; dBar: number; dEff: number; regime: string; expected: string; pass: boolean; note: string }> = [];

console.log("\n═══ R107 GEOMETRY OF CONSOLIDATION — VERIFICATION ═══\n");
console.log("LAYER 1: Synthetic cluster classification\n");

for (const c of cases) {
  const g = computeClusterGeometry(c.vecs, c.theta);
  const pass = g.regime === c.expectRegime;
  if (!pass) synthFail++;
  results.push({ name: c.name, n: g.n, dBar: g.dBar, dEff: g.dEff, regime: g.regime, expected: c.expectRegime, pass, note: c.note });
  const tag = pass ? "✅ PASS" : "❌ FAIL";
  console.log(`  ${tag}  ${c.name}`);
  console.log(`         n=${g.n}  d̄=${g.dBar.toFixed(4)}  d_eff=${g.dEff.toFixed(2)}  θ'=${g.thetaPrime.toFixed(3)}  margin=${g.margin.toFixed(4)}`);
  console.log(`         expected=${c.expectRegime}  actual=${g.regime}`);
  console.log(`         ${c.note}\n`);
}

console.log(`LAYER 1 RESULT: ${cases.length - synthFail}/${cases.length} PASS\n`);

console.log("LAYER 2: pairRegime sanity\n");
const tightPair = pairRegime(base, nearVec(base, 99, 0.02), 0.85);
const spreadPair = pairRegime(unitVec(D, 1234), unitVec(D, 5678), 0.85);
const tightOK = tightPair.regime === "tight";
const spreadOK = spreadPair.regime === "spread";
console.log(`  ${tightOK ? "✅" : "❌"}  tight pair (eps=0.02):  d̄=${tightPair.dBar.toFixed(4)} → ${tightPair.regime}`);
console.log(`  ${spreadOK ? "✅" : "❌"}  random pair:            d̄=${spreadPair.dBar.toFixed(4)} → ${spreadPair.regime}`);
if (!tightOK || !spreadOK) synthFail++;
console.log("");

console.log("LAYER 3: Live scan against tenant memory\n");

const liveResults: Array<{ scope: string; n: number; dBar: number; dEff: number; regime: string; spreadCount: number; totalPairs: number }> = [];

(async () => {
  let liveErr = false;
  try {
    const { pool } = await import("../server/db");
    const tenantsRes = await pool.query(`SELECT DISTINCT tenant_id, COUNT(*)::int as n FROM memory_entries WHERE status='active' AND embedding IS NOT NULL GROUP BY tenant_id ORDER BY n DESC LIMIT 5`);
    const tenants = (tenantsRes as any).rows || [];

    if (tenants.length === 0) {
      console.log("  (no tenants with active memory embeddings — skipping live scan)\n");
    }

    for (const t of tenants) {
      const tenantId = t.tenant_id;
      const r = await pool.query(`SELECT id, fact, embedding FROM memory_entries WHERE tenant_id=$1 AND status='active' AND embedding IS NOT NULL ORDER BY id DESC LIMIT 200`, [tenantId]);
      const rows = (r as any).rows || [];
      if (rows.length < 2) continue;
      const g = computeClusterGeometry(rows.map((x: any) => x.embedding), 0.85);
      let spreadCount = 0; let totalPairs = 0;
      const top: Array<{ a: number; b: number; aFact: string; bFact: string; dBar: number }> = [];
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const pr = pairRegime(rows[i].embedding, rows[j].embedding, 0.85);
          if (pr.regime === "degenerate") continue;
          totalPairs++;
          if (1 - pr.dBar > 0.85 && pr.regime === "spread") {
            spreadCount++;
            top.push({ a: rows[i].id, b: rows[j].id, aFact: (rows[i].fact || "").slice(0, 70), bFact: (rows[j].fact || "").slice(0, 70), dBar: pr.dBar });
          }
        }
      }
      top.sort((a, b) => b.dBar - a.dBar);
      liveResults.push({ scope: `tenant=${tenantId}`, n: g.n, dBar: g.dBar, dEff: g.dEff, regime: g.regime, spreadCount, totalPairs });
      console.log(`  tenant=${tenantId}  n=${g.n}  d̄=${g.dBar.toFixed(3)}  d_eff=${g.dEff.toFixed(1)}  regime=${g.regime}`);
      console.log(`         total-pairs=${totalPairs}  spread-would-be-merge-pairs=${spreadCount}`);
      if (top.length > 0) {
        console.log(`         worst 3 spread pairs by d̄:`);
        for (const p of top.slice(0, 3)) {
          console.log(`           [#${p.a}↔#${p.b}] d̄=${p.dBar.toFixed(3)}  "${p.aFact}" ↔ "${p.bFact}"`);
        }
      }
      console.log("");
    }
    await pool.end();
  } catch (e: any) {
    console.error(`LAYER 3 ERROR: ${e?.message || e}`);
    liveErr = true;
  }

  // Render SVG visualisation.
  const W = 720, H = 420, PAD = 60;
  const all = [...results.map(r => ({ label: r.regime + (r.pass ? "" : "!"), n: r.n, dBar: r.dBar, regime: r.regime, kind: "synthetic" })),
              ...liveResults.map(r => ({ label: r.scope, n: r.n, dBar: r.dBar, regime: r.regime, kind: "live" }))];
  const maxN = Math.max(50, ...all.map(p => p.n));
  const maxD = 1.0;
  const x = (n: number) => PAD + (n / maxN) * (W - 2 * PAD);
  const y = (d: number) => H - PAD - (d / maxD) * (H - 2 * PAD);
  const thetaPrimeY = y(0.15);
  const colorOf = (regime: string) => regime === "tight" ? "#22c55e" : regime === "spread" ? "#ef4444" : "#9ca3af";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12">
  <rect width="${W}" height="${H}" fill="#0b0f17"/>
  <text x="${W / 2}" y="24" fill="#e5e7eb" text-anchor="middle" font-size="16" font-weight="600">R107 Memory Geometry — d̄ vs n (θ=0.85, θ'=0.15)</text>
  <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="#374151"/>
  <line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="#374151"/>
  <line x1="${PAD}" y1="${thetaPrimeY}" x2="${W - PAD}" y2="${thetaPrimeY}" stroke="#fbbf24" stroke-dasharray="4,4"/>
  <text x="${W - PAD - 4}" y="${thetaPrimeY - 4}" fill="#fbbf24" text-anchor="end">θ' = 0.15  (above = SPREAD / collapse-risk)</text>
  <text x="${PAD - 8}" y="${y(0)}" fill="#9ca3af" text-anchor="end" dominant-baseline="middle">0</text>
  <text x="${PAD - 8}" y="${y(0.5)}" fill="#9ca3af" text-anchor="end" dominant-baseline="middle">0.5</text>
  <text x="${PAD - 8}" y="${y(1.0)}" fill="#9ca3af" text-anchor="end" dominant-baseline="middle">1.0</text>
  <text x="${PAD}" y="${H - PAD + 16}" fill="#9ca3af" text-anchor="middle">0</text>
  <text x="${W - PAD}" y="${H - PAD + 16}" fill="#9ca3af" text-anchor="middle">${maxN}</text>
  <text x="${W / 2}" y="${H - PAD + 36}" fill="#9ca3af" text-anchor="middle">cluster size n</text>
  <text x="20" y="${H / 2}" fill="#9ca3af" text-anchor="middle" transform="rotate(-90 20 ${H / 2})">mean within-cluster cosine distance d̄</text>
  ${all.map(p => `<circle cx="${x(p.n).toFixed(1)}" cy="${y(p.dBar).toFixed(1)}" r="${p.kind === "live" ? 8 : 6}" fill="${colorOf(p.regime)}" fill-opacity="${p.kind === "live" ? 0.9 : 0.6}" stroke="#fff" stroke-width="${p.kind === "live" ? 2 : 1}"><title>${p.label} n=${p.n} d̄=${p.dBar.toFixed(3)} (${p.regime})</title></circle>`).join("\n  ")}
  <g transform="translate(${W - PAD - 200}, ${PAD + 8})" font-size="11">
    <rect x="-8" y="-4" width="208" height="78" fill="#111827" stroke="#374151" rx="4"/>
    <circle cx="6" cy="10" r="5" fill="#22c55e"/><text x="18" y="14" fill="#e5e7eb">tight (safe to consolidate)</text>
    <circle cx="6" cy="28" r="5" fill="#ef4444"/><text x="18" y="32" fill="#e5e7eb">spread (centroid = collapse)</text>
    <circle cx="6" cy="46" r="5" fill="#9ca3af"/><text x="18" y="50" fill="#e5e7eb">degenerate (n&lt;2)</text>
    <text x="0" y="68" fill="#9ca3af">small=synthetic, large=live tenant</text>
  </g>
</svg>`;

  const outDir = path.resolve("attached_assets");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "memory-geometry-r107.svg");
  fs.writeFileSync(outPath, svg);
  console.log(`SVG chart written: ${outPath}\n`);

  console.log("═══ SUMMARY ═══");
  console.log(`  Synthetic: ${cases.length - synthFail}/${cases.length} PASS`);
  console.log(`  Live scan: ${liveResults.length} tenant scope(s) scanned${liveErr ? " (error encountered)" : ""}`);
  if (liveResults.length > 0) {
    const totSpread = liveResults.reduce((a, b) => a + b.spreadCount, 0);
    const totPairs = liveResults.reduce((a, b) => a + b.totalPairs, 0);
    console.log(`  Aggregate: ${totSpread} would-be-merge spread pairs / ${totPairs} candidate pairs across all scanned tenants`);
    console.log(`             → these are the pairs the R107 gate now KEEPS DISTINCT instead of merging`);
  }

  process.exit(synthFail > 0 ? 1 : (liveErr ? 2 : 0));
})();
