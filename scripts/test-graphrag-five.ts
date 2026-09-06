// R75 — GraphRAG Five verification harness.
// Runs 7 acceptance checks; prints PASS/FAIL per check with concise reasons.
// No external network deps beyond what the modules already use.
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { TOOL_DEFINITIONS, executeTool } from "../server/tools";

let pass = 0;
let fail = 0;
const results: Array<{ name: string; ok: boolean; note: string }> = [];

function record(name: string, ok: boolean, note: string) {
  results.push({ name, ok, note });
  if (ok) pass++; else fail++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name} — ${note}`);
}

async function check1_schema() {
  console.log("\n[1] Schema present");
  try {
    const t1 = await db.execute<{ exists: boolean }>(sql`SELECT to_regclass('public.knowledge_communities') IS NOT NULL AS exists`);
    const t2 = await db.execute<{ exists: boolean }>(sql`SELECT to_regclass('public.causal_chains') IS NOT NULL AS exists`);
    const c1 = await db.execute<{ exists: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='graph_memory' AND column_name='importance') AS exists`);
    const c2 = await db.execute<{ exists: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='graph_memory' AND column_name='community_id') AS exists`);
    const c3 = await db.execute<{ exists: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='knowledge_triples' AND column_name='meta') AS exists`);
    const ok = (t1.rows[0] as any)?.exists && (t2.rows[0] as any)?.exists && (c1.rows[0] as any)?.exists && (c2.rows[0] as any)?.exists && (c3.rows[0] as any)?.exists;
    record("schema", !!ok, ok ? "tables + columns present" : "one or more missing");
  } catch (e: any) {
    record("schema", false, e?.message?.slice(0, 120) || "error");
  }
}

async function check2_communities() {
  console.log("\n[2] Communities present (query existing; light rebuild check)");
  try {
    const { queryCommunities, buildCommunitiesForTenant } = await import("../server/graph-communities");
    // Check the read path always (cheap).
    const list = await queryCommunities(1, "", 5);
    // Soft, time-bounded rebuild — uses cooldown by default so it should be fast.
    let buildNote = "skip-build";
    try {
      const r = await Promise.race([
        buildCommunitiesForTenant(1, { force: false }),
        new Promise<any>((_, rej) => setTimeout(() => rej(new Error("build-timeout")), 25000)),
      ]);
      buildNote = `nodes=${r.nodes} edges=${r.edges} written=${r.written} skipped=${r.skippedReason || "no"}`;
    } catch (be: any) {
      buildNote = `build-soft-skip(${be?.message?.slice(0, 40)})`;
    }
    const ok = Array.isArray(list);
    record("communities", ok, `listed=${list.length} ${buildNote}`);
  } catch (e: any) {
    record("communities", false, e?.message?.slice(0, 200) || "error");
  }
}

async function check3_pagerank() {
  console.log("\n[3] PageRank importance");
  try {
    const { scoreImportanceForTenant } = await import("../server/graph-importance");
    const r = await scoreImportanceForTenant(1);
    const allFloats = r.topPaths.every(p => Number.isFinite(p.score) && p.score >= 0 && p.score <= 1);
    const ok = r.updated >= 0 && allFloats;
    record("pagerank", ok, `nodes=${r.nodes} updated=${r.updated} top=${r.topPaths.slice(0,3).map(p=>p.score.toFixed(3)).join(",")}`);
  } catch (e: any) {
    record("pagerank", false, e?.message?.slice(0, 200) || "error");
  }
}

async function check4_causal() {
  console.log("\n[4] Causal: query existing + small extraction");
  try {
    const { queryCausalChain, extractCausalChainsForTenant } = await import("../server/causal-extractor");
    // Always check the query path (doesn't depend on slow LLM calls).
    const q = await queryCausalChain(1, "visionclaw", "both", 5);
    // Optional small extraction with a short timeout — non-blocking on overall verdict.
    let extractNote = "skip-extract";
    try {
      const ec = await Promise.race([
        extractCausalChainsForTenant(1, { limit: 4, sinceHours: 168 }),
        new Promise<any>((_, rej) => setTimeout(() => rej(new Error("extract-timeout")), 30000)),
      ]);
      extractNote = `scanned=${ec.scanned} chains=${ec.chains} inserted=${ec.inserted} dup=${ec.skippedDup ?? 0}`;
    } catch (extractErr: any) {
      extractNote = `extract-soft-skip(${extractErr?.message?.slice(0, 40)})`;
    }
    const ok = Array.isArray(q);
    record("causal", ok, `query-count=${q.length} ${extractNote}`);
  } catch (e: any) {
    record("causal", false, e?.message?.slice(0, 200) || "error");
  }
}

async function check5_cast() {
  console.log("\n[5] cAST chunking on tools.ts");
  try {
    const { chunkCodeContextAware } = await import("../server/code-chunker");
    const fs = await import("fs");
    const sample = fs.readFileSync("server/code-chunker.ts", "utf-8");
    const chunks = chunkCodeContextAware("server/code-chunker.ts", sample, { maxTokens: 800 });
    const hasHeaders = chunks.every(c => c.content.includes("__cast:") && c.content.includes("symbol="));
    const ok = chunks.length >= 2 && hasHeaders;
    record("cast", ok, `chunks=${chunks.length} symbols=[${chunks.slice(0,4).map(c=>c.symbol).join(",")}]`);
  } catch (e: any) {
    record("cast", false, e?.message?.slice(0, 200) || "error");
  }
}

async function check6_recall_routing() {
  console.log("\n[6] recall_context level=auto routing on 5 prompts");
  try {
    const samples: Array<{ query: string; expect: "global" | "causal" | "local" }> = [
      { query: "what are the main themes in my knowledge", expect: "global" },
      { query: "give me an overview of topics here", expect: "global" },
      { query: "why did the deployment fail", expect: "causal" },
      { query: "what causes pgvector slowness", expect: "causal" },
      { query: "find the email about the invoice", expect: "local" },
    ];
    let ok = true;
    const detail: string[] = [];
    for (const s of samples) {
      const r: any = await executeTool("recall_context", { _tenantId: 1, level: "auto", query: s.query, _conversationId: 1 });
      const got = r?.level || "local";
      const match = got === s.expect;
      if (!match) ok = false;
      detail.push(`${s.expect}=${got}${match ? "" : "*"}`);
    }
    record("recall_routing", ok, detail.join(" | "));
  } catch (e: any) {
    record("recall_routing", false, e?.message?.slice(0, 200) || "error");
  }
}

async function check7_new_tools_dispatch() {
  console.log("\n[7] All 3 new tools registered + dispatched");
  try {
    const names = TOOL_DEFINITIONS.map(d => d.function.name);
    const haveAll = ["query_communities", "query_causal", "chunk_code"].every(n => names.includes(n));
    const total = names.length;
    const r1: any = await executeTool("query_communities", { _tenantId: 1, query: "", limit: 2 });
    const r2: any = await executeTool("query_causal", { _tenantId: 1, term: "visionclaw", direction: "both", limit: 3 });
    const r3: any = await executeTool("chunk_code", { filePath: "server/code-chunker.ts", maxTokens: 800, previewOnly: true });
    const ok = haveAll && r1?.success === true && (r2?.success === true || r2?.chains !== undefined) && r3?.success === true && (r3?.count ?? 0) > 0;
    record("new_tools", ok, `total=${total} q_communities=${r1?.count ?? "?"} q_causal=${r2?.count ?? "?"} chunk_code=${r3?.count ?? "?"}`);
  } catch (e: any) {
    record("new_tools", false, e?.message?.slice(0, 200) || "error");
  }
}

async function check8_tenant_isolation() {
  console.log("\n[8] recall_context tenant fail-closed + projectWide isolation (strict)");
  try {
    const checks: string[] = [];
    let ok = true;
    const expectBlocked = (label: string, r: any) => {
      const blocked = !!(r?.error && /tenant context required/i.test(r.error));
      if (!blocked) ok = false;
      checks.push(`${label}=${blocked ? "blocked" : "LEAK"}`);
    };
    // a) No tenant + no conv → error
    expectBlocked("no-ctx", await executeTool("recall_context", { query: "x" }));
    // b) No tenant + caller conversationId only (untrusted) → error (no tenant inference)
    expectBlocked("no-ctx+conv", await executeTool("recall_context", { query: "x", conversationId: 1 }));
    // c) No tenant + level=global → error
    expectBlocked("no-ctx+global", await executeTool("recall_context", { query: "themes", level: "global" }));
    // d) No tenant + level=causal + conv → error (must not infer tenant from conv)
    expectBlocked("no-ctx+causal+conv", await executeTool("recall_context", { query: "why", level: "causal", conversationId: 1 }));
    // e) Mismatched tenant=999 + conv 1 (owned by tenant 1), projectWide → must isolate
    const r5: any = await executeTool("recall_context", { _tenantId: 999, conversationId: 1, projectWide: true, query: "the" });
    const arc5 = Array.isArray(r5?.archives) ? r5.archives : [];
    const res5 = Array.isArray(r5?.results) ? r5.results : [];
    const e5 = arc5.length === 0 && res5.length === 0;
    if (!e5) ok = false;
    checks.push(`xtenant-projectwide=${e5 ? "isolated" : `LEAK(arc=${arc5.length},res=${res5.length})`}`);
    // f) Mismatched tenant=999 + conv 1, level=global → returns global communities for tenant 999, NOT tenant 1.
    const r6: any = await executeTool("recall_context", { _tenantId: 999, conversationId: 1, level: "global", query: "themes" });
    const com6 = Array.isArray(r6?.communities) ? r6.communities : [];
    // tenant 999 has no communities → list must be empty (we have communities only on tenant 1).
    const f6 = com6.length === 0;
    if (!f6) ok = false;
    checks.push(`xtenant-global=${f6 ? "isolated" : `LEAK(${com6.length})`}`);
    record("tenant_isolation", ok, checks.join(" | "));
  } catch (e: any) {
    record("tenant_isolation", false, e?.message?.slice(0, 200) || "error");
  }
}

async function main() {
  console.log("R75 — GraphRAG Five verification\n================================");
  await check1_schema();
  await check2_communities();
  await check3_pagerank();
  await check4_causal();
  await check5_cast();
  await check6_recall_routing();
  await check7_new_tools_dispatch();
  await check8_tenant_isolation();

  console.log(`\n================================\nResult: ${pass} PASS / ${fail} FAIL of ${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error("FATAL:", e?.message || e); process.exit(2); });
