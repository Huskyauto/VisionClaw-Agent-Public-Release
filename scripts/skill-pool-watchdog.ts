/**
 * Skill Pool Watchdog — R125+155 (2026-08-18).
 *
 * Driver for server/lib/skill-pool-similarity.ts. Loads the FULL skill pool
 * the agents actually see:
 *   - runtime DB skills (skills table, enabled, with prompt content), and
 *   - .agents/skills/<name>/SKILL.md frontmatter descriptions (main-agent pool)
 * then computes pairwise semantic similarity and reports confusable
 * near-duplicate pairs as merge/prune candidates, plus pool-size decay risk
 * (arXiv:2608.14036: retrieval precision 29.6% → 3.3% going 5 → 100 skills).
 *
 * ADVISORY ONLY: always exits 0 unless the analysis itself crashes; nothing
 * is disabled or deleted. Output: human summary on stdout, full JSON at
 * /tmp/skill-pool-watchdog.json (use --json for JSON on stdout).
 */
import fs from "node:fs";
import path from "node:path";
import { analyzeSkillPool, type PoolSkill } from "../server/lib/skill-pool-similarity";
import { generateEmbedding } from "../server/embeddings";
import { storage } from "../server/storage";

const asJson = process.argv.includes("--json");

function agentsDirSkills(): PoolSkill[] {
  const root = path.resolve(".agents/skills");
  const out: PoolSkill[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root).filter((d) => !d.startsWith(".") && !d.startsWith("_"));
  } catch {
    return out;
  }
  for (const d of dirs) {
    try {
      const md = fs.readFileSync(path.join(root, d, "SKILL.md"), "utf8");
      const fm = /^---\n([\s\S]*?)\n---/.exec(md);
      const descMatch = fm ? /(?:^|\n)description:\s*([\s\S]*?)(?=\n[a-zA-Z_-]+:|$)/.exec(fm[1]) : null;
      const desc = (descMatch?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 600);
      if (desc) out.push({ name: d, text: `${d}: ${desc}`, source: "agents-dir" });
    } catch {
      /* unreadable skill dir — skip */
    }
  }
  return out;
}

async function main() {
  const pool: PoolSkill[] = [];
  try {
    const dbSkills = await storage.getSkills();
    for (const s of dbSkills as any[]) {
      if (!s?.enabled || !s?.promptContent) continue;
      const desc = (s.description || "").trim() || String(s.promptContent).slice(0, 400);
      pool.push({ name: s.name, text: `${s.name}: ${desc}`, source: "db" });
    }
  } catch (e: any) {
    console.error(`[skill-pool-watchdog] DB skill load failed (continuing with .agents only): ${e?.message}`);
  }
  pool.push(...agentsDirSkills());

  const analysis = await analyzeSkillPool({ skills: pool, embed: generateEmbedding });

  const report = {
    generatedAt: new Date().toISOString(),
    ...analysis,
    // Keep the JSON slim: top 25 confusable pairs is plenty for triage.
    confusablePairs: analysis.confusablePairs.slice(0, 25).map((p) => ({ ...p, similarity: Number(p.similarity.toFixed(3)) })),
    flaggedPairs: analysis.flaggedPairs.map((p) => ({ ...p, similarity: Number(p.similarity.toFixed(3)) })),
    recommendation: analysis.flaggedPairs.length > 0
      ? "Review flagged pairs: merge near-duplicates or sharpen their descriptions so they stay distinguishable."
      : "No merge/prune candidates at the current threshold.",
  };

  try {
    fs.writeFileSync("/tmp/skill-pool-watchdog.json", JSON.stringify(report, null, 2));
  } catch { /* tmp write is best-effort */ }

  if (asJson) {
    console.log(JSON.stringify(report));
  } else {
    console.log(`[skill-pool-watchdog] ${analysis.summary}`);
    for (const p of report.flaggedPairs) {
      console.log(`  FLAGGED ${p.similarity} — "${p.a}" (${p.aSource}) ↔ "${p.b}" (${p.bSource})`);
    }
    for (const p of report.confusablePairs.filter((c) => c.similarity < (0.85))) {
      console.log(`  warn    ${p.similarity} — "${p.a}" ↔ "${p.b}"`);
    }
    console.log(`[skill-pool-watchdog] full report: /tmp/skill-pool-watchdog.json`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`[skill-pool-watchdog] fatal: ${e?.message || e}`);
  process.exit(1);
});
