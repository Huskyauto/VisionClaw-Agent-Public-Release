#!/usr/bin/env tsx
/**
 * Prompt Staleness Audit — Task #134
 *
 * REPORT-ONLY audit of every always-loaded AI instruction surface for
 * MODEL-ERA STALENESS: "was this line written to patch a failure mode an
 * OLDER model had?" (Anthropic cut ~80% of Claude Code's built-in
 * instructions and it got better — instructions accumulate as patches for
 * old models and become dead weight.)
 *
 * Design contract (see .agents/memory/six-month-audit-prompt-verdict.md):
 *  - Fetches CURRENT provider prompting guidance LIVE (not training memory).
 *  - One verdict per line: DELETE / KEEP / REWRITE.
 *  - Every DELETE must cite a fetched source; no source => KEEP
 *    (fail-closed toward keeping). If NO live doc fetched, ALL DELETEs
 *    downgrade to KEEP.
 *  - Lines carrying a `**Why:**` marker (incident-derived guards) are
 *    EXEMPT from DELETE by default — downgraded to KEEP with a note.
 *  - Heuristic flags (no LLM): verify-twice phrasing, "don't overthink",
 *    role padding, stale model-name examples.
 *  - AUTO-APPLY (Bob directive 2026-08-01: "don't email me a verdict table —
 *    just take care of it and fix it"): full runs apply SAFE fixes
 *    automatically, bounded to:
 *      * DELETE verdicts only (REWRITE stays report-only — no replacement
 *        text is captured, so applying would mean inventing content).
 *      * Markdown surfaces only (replit.md, MEMORY.md). Persona prompts
 *        (code file) and skill frontmatter (structural YAML) are NEVER
 *        auto-edited — flagged in the report instead.
 *      * Exact-line match at audit-time text; if the file drifted since the
 *        scan, the line is skipped (no fuzzy deletion).
 *      * All fail-closed downgrades above still run FIRST (cited fetched
 *        source required; **Why:** guards exempt).
 *    Pass --report-only to suppress application. --heuristics-only never
 *    applies (no verdicts). This is the STALENESS sibling of
 *    token-usage-audit (which covers cost).
 *  - Fail-open: any chunk/LLM/fetch failure degrades to KEEP + a DEGRADED
 *    note in the report; exit code is always 0 unless the script itself
 *    cannot write its report.
 *
 * Scope (always-loaded surfaces):
 *  - replit.md (rule bullets)
 *  - .agents/memory/MEMORY.md (index lines)
 *  - server/seed-persona-prompts.ts (canonical persona prompt bullets; text-parsed, never imported)
 *  - .agents/skills/* /SKILL.md (frontmatter descriptions)
 *
 * Usage:
 *   npx tsx scripts/prompt-staleness-audit.ts                    # full run
 *   npx tsx scripts/prompt-staleness-audit.ts --heuristics-only  # $0, no LLM, flags only
 *   npx tsx scripts/prompt-staleness-audit.ts --limit=40         # bound item count (smoke test)
 *   npx tsx scripts/prompt-staleness-audit.ts --json             # machine-readable to stdout
 *   AUDIT_MODEL=openai/gpt-5-mini npx tsx scripts/prompt-staleness-audit.ts
 *
 * Output: /tmp/prompt-staleness-audit-<date>.md + .json (+ stdout summary).
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

type Verdict = "DELETE" | "KEEP" | "REWRITE";

interface Item {
  id: number;
  surface: string;       // e.g. "replit.md", "MEMORY.md", "persona-prompts", "skill:critique"
  location: string;      // file + line number
  text: string;          // the instruction line (truncated for the LLM display/judging)
  raw?: string;          // FULL untruncated raw line exactly as in the file (auto-apply comparison only)
  whyGuard: boolean;     // carries **Why:** => DELETE-exempt
  heuristicFlags: string[];
}

interface Result extends Item {
  verdict: Verdict;
  reason: string;
  source: string | null; // cited fetched-doc URL (required for DELETE)
  notes: string[];       // downgrades, degradations
}

const args = process.argv.slice(2);
const heuristicsOnly = args.includes("--heuristics-only");
const reportOnly = args.includes("--report-only");
const asJson = args.includes("--json");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 0) : Infinity;

// ---------------------------------------------------------------- heuristics

const HEURISTICS: Array<{ flag: string; re: RegExp }> = [
  { flag: "verify-twice-phrasing", re: /\b(double[- ]?check|verify (?:again|twice)|re-?verify before|check (?:your work|it again) before (?:answering|responding))\b/i },
  { flag: "dont-overthink", re: /\b(don'?t overthink|do not overthink|avoid overthinking|don'?t over-?analy[sz]e)\b/i },
  { flag: "role-padding", re: /\byou are (?:a|an|the) (?:world-?class|brilliant|genius|expert|elite|masterful|10x)\b/i },
  { flag: "stale-model-example", re: /\b(gpt-3\.5|gpt-4(?![o.\-\d])|text-davinci|claude-2\b|claude-instant|claude-3(?![.\-\d]))\b/i },
  { flag: "think-step-by-step", re: /\b(think step[- ]by[- ]step|let'?s think step)\b/i },
];

function heuristicFlags(text: string): string[] {
  return HEURISTICS.filter((h) => h.re.test(text)).map((h) => h.flag);
}

// ------------------------------------------------------------- item gathering

function bulletLines(file: string): Array<{ line: number; text: string; raw: string }> {
  if (!existsSync(file)) return [];
  const out: Array<{ line: number; text: string; raw: string }> = [];
  const lines = readFileSync(file, "utf-8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^- /.test(t) && t.length > 20) out.push({ line: i + 1, text: t, raw: lines[i] });
  }
  return out;
}

function gatherItems(): Item[] {
  const items: Item[] = [];
  let id = 0;
  const push = (surface: string, location: string, text: string, raw?: string) => {
    items.push({
      id: ++id,
      surface,
      location,
      text: text.length > 600 ? text.slice(0, 600) + "…" : text,
      raw,
      whyGuard: /\*\*Why:?\*\*|\bWhy:\*\*/.test(text),
      heuristicFlags: heuristicFlags(text),
    });
  };

  for (const b of bulletLines("replit.md")) push("replit.md", `replit.md:${b.line}`, b.text, b.raw);
  for (const b of bulletLines(".agents/memory/MEMORY.md")) push("MEMORY.md", `.agents/memory/MEMORY.md:${b.line}`, b.text, b.raw);

  // Persona prompts: text-parse the canonical file (never import — avoids DB
  // side effects; scripts/ is outside tsc scope anyway, keep it inert).
  const personaFile = "server/seed-persona-prompts.ts";
  if (existsSync(personaFile)) {
    const lines = readFileSync(personaFile, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      // instruction bullets and numbered rules inside the template literals
      if ((/^- /.test(t) || /^\d+\. /.test(t)) && t.length > 25 && !/^- \*\*[A-Za-z ]+\*\*$/.test(t)) {
        push("persona-prompts", `${personaFile}:${i + 1}`, t);
      }
    }
  }

  // Skill descriptions (frontmatter `description:`) — one item per skill.
  const skillsDir = ".agents/skills";
  if (existsSync(skillsDir)) {
    for (const dir of readdirSync(skillsDir)) {
      if (dir.startsWith("_") || dir.startsWith(".")) continue;
      const f = join(skillsDir, dir, "SKILL.md");
      if (!existsSync(f)) continue;
      const raw = readFileSync(f, "utf-8");
      const fm = raw.match(/^---\n([\s\S]*?)\n---/);
      if (!fm) continue;
      const desc = fm[1].match(/^description:\s*([\s\S]*?)(?=\n[a-zA-Z_-]+:|\n?$)/m);
      if (desc) push(`skill:${dir}`, `${f} (frontmatter)`, desc[1].replace(/\s+/g, " ").trim());
    }
  }

  return items.slice(0, limit === Infinity ? items.length : limit);
}

// ------------------------------------------------------- live provider guidance

const GUIDANCE_URLS = [
  "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview",
  "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices",
  "https://platform.openai.com/docs/guides/prompt-engineering",
  "https://ai.google.dev/gemini-api/docs/prompting-strategies",
];

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchGuidance(): Promise<Array<{ url: string; text: string }>> {
  const docs: Array<{ url: string; text: string }> = [];
  for (const url of GUIDANCE_URLS) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "VisionClaw-prompt-staleness-audit/1.0", Accept: "text/html,text/plain" },
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
      });
      if (!res.ok) { console.error(`[guidance] ${url} -> HTTP ${res.status} (skipping)`); continue; }
      const text = stripHtml(await res.text()).slice(0, 20_000);
      if (text.length < 500) { console.error(`[guidance] ${url} -> too little text after strip (skipping)`); continue; }
      docs.push({ url, text });
      console.error(`[guidance] fetched ${url} (${text.length} chars)`);
    } catch (e: any) {
      console.error(`[guidance] ${url} FAILED: ${e?.message ?? e}`);
    }
  }
  return docs;
}

// --------------------------------------------------------------- LLM judging

const AUDIT_MODEL = process.env.AUDIT_MODEL || "openai/gpt-5-mini";
const CHUNK_SIZE = 30;

async function judgeChunk(
  client: any,
  actualModelId: string,
  docs: Array<{ url: string; text: string }>,
  chunk: Item[],
): Promise<Map<number, { verdict: Verdict; reason: string; source: string | null }>> {
  const docBlock = docs.map((d, i) => `### SOURCE ${i + 1}: ${d.url}\n${d.text.slice(0, 12_000)}`).join("\n\n");
  const itemBlock = chunk.map((it) => `[${it.id}] (${it.surface}) ${it.text}`).join("\n");
  const sys = `You audit an AI agent platform's always-loaded instructions for MODEL-ERA STALENESS: lines written to patch failure modes of OLDER LLMs (gpt-4-era and before) that current frontier models no longer have, per the CURRENT provider guidance below.

Verdicts per line:
- DELETE: the line exists only to patch an old-model failure mode AND current guidance (cite the SOURCE url) says it's unnecessary or counterproductive (e.g. "think step by step" padding, verify-twice phrasing, role padding like "you are a world-class X", explicit chain-of-thought coaxing, verbose format scaffolding).
- REWRITE: the underlying rule is still valuable but the phrasing is old-model-era; suggest what to keep.
- KEEP: everything else. DEFAULT TO KEEP. Project-specific facts, incident-derived guards, safety rules, workflow conventions, routing tables, and domain knowledge are ALWAYS KEEP — they are not model-era patches.

Rules: A DELETE with no "source" field naming one of the SOURCE urls is invalid (will be treated as KEEP). Be conservative: most lines in an incident-log-shaped config are KEEP.

Respond with ONLY JSON: {"verdicts":[{"id":<number>,"verdict":"DELETE|KEEP|REWRITE","reason":"<short>","source":"<url or null>"}]}`;

  const resp = await client.chat.completions.create({
    model: actualModelId,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: `## CURRENT PROVIDER GUIDANCE (fetched live today)\n${docBlock}\n\n## LINES TO AUDIT\n${itemBlock}` },
    ],
    response_format: { type: "json_object" } as any,
    max_tokens: 8000,
  });
  const raw = resp?.choices?.[0]?.message?.content ?? "";
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON object in model response");
  const parsed = JSON.parse(m[0]);
  const out = new Map<number, { verdict: Verdict; reason: string; source: string | null }>();
  for (const v of parsed?.verdicts ?? []) {
    const verdict: Verdict = v?.verdict === "DELETE" || v?.verdict === "REWRITE" ? v.verdict : "KEEP";
    out.set(Number(v?.id), {
      verdict,
      reason: String(v?.reason ?? "").slice(0, 300),
      source: typeof v?.source === "string" && v.source.startsWith("http") ? v.source : null,
    });
  }
  return out;
}

// -------------------------------------------------------------------- main

async function main() {
  const items = gatherItems();
  console.error(`[audit] gathered ${items.length} always-loaded instruction items`);

  const docs = heuristicsOnly ? [] : await fetchGuidance();
  const fetchedUrls = new Set(docs.map((d) => d.url));
  const liveEvidence = docs.length > 0;

  const results: Result[] = items.map((it) => ({
    ...it,
    verdict: "KEEP" as Verdict,
    reason: heuristicsOnly ? "heuristics-only run (no LLM)" : "default",
    source: null,
    notes: [],
  }));
  const byId = new Map(results.map((r) => [r.id, r]));
  let degradedChunks = 0;

  if (!heuristicsOnly) {
    let client: any, actualModelId: string;
    try {
      const { getClientForModel } = await import("../server/providers");
      ({ client, actualModelId } = await getClientForModel(AUDIT_MODEL));
    } catch (e: any) {
      console.error(`[audit] DEGRADED — could not init LLM client (${e?.message ?? e}); all verdicts KEEP.`);
      degradedChunks = -1;
    }
    if (degradedChunks === 0 && client) {
      const chunks: Item[][] = [];
      for (let i = 0; i < items.length; i += CHUNK_SIZE) chunks.push(items.slice(i, i + CHUNK_SIZE));
      const CONCURRENCY = 6;
      const runChunk = async (chunk: Item[]) => {
        try {
          const verdicts = await judgeChunk(client, actualModelId!, docs, chunk);
          for (const it of chunk) {
            const v = verdicts.get(it.id);
            const r = byId.get(it.id)!;
            if (!v) { r.notes.push("no verdict returned — KEEP (fail-closed toward keeping)"); continue; }
            r.verdict = v.verdict; r.reason = v.reason; r.source = v.source;
          }
        } catch (e: any) {
          degradedChunks++;
          for (const it of chunk) byId.get(it.id)!.notes.push(`DEGRADED chunk (${String(e?.message ?? e).slice(0, 120)}) — KEEP`);
        }
      };
      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        await Promise.all(chunks.slice(i, i + CONCURRENCY).map(runChunk));
        console.error(`[audit] judged ${Math.min(i + CONCURRENCY, chunks.length)}/${chunks.length} chunks`);
      }
    }
  }

  // Fail-closed enforcement (post-LLM, deterministic):
  for (const r of results) {
    if (r.verdict === "DELETE") {
      if (!liveEvidence) { r.verdict = "KEEP"; r.notes.push("downgraded: no live provider doc fetched — no evidence basis for DELETE"); }
      else if (!r.source || !fetchedUrls.has(r.source)) { r.verdict = "KEEP"; r.notes.push("downgraded: DELETE cited no fetched source (fail-closed toward keeping)"); }
      else if (r.whyGuard) { r.verdict = "KEEP"; r.notes.push("downgraded: incident-derived guard (**Why:** line) — DELETE-exempt by policy"); }
    }
  }

  const counts = { DELETE: 0, KEEP: 0, REWRITE: 0 } as Record<Verdict, number>;
  for (const r of results) counts[r.verdict]++;
  const flagged = results.filter((r) => r.heuristicFlags.length > 0);

  // ------------------------------------------------------------- auto-apply
  // Bob directive 2026-08-01: fix findings instead of emailing tables.
  // Bounded: DELETE-only, markdown surfaces only, exact-line match, all
  // fail-closed downgrades already applied above.
  const APPLY_SURFACES = new Set(["replit.md", "MEMORY.md"]);
  const applied: string[] = [];
  const skippedApply: string[] = [];
  if (!heuristicsOnly && !reportOnly) {
    // group deletions per file so each file is rewritten once
    const byFile = new Map<string, Result[]>();
    for (const r of results) {
      if (r.verdict !== "DELETE") continue;
      if (!APPLY_SURFACES.has(r.surface)) {
        skippedApply.push(`${r.location} — surface '${r.surface}' is never auto-edited (manual review)`);
        continue;
      }
      const file = r.location.split(":")[0];
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file)!.push(r);
    }
    for (const [file, dels] of byFile) {
      try {
        const lines = readFileSync(file, "utf-8").split("\n");
        const drop = new Set<number>();
        for (const r of dels) {
          const lineNo = Number(r.location.split(":")[1]);
          const current = lines[lineNo - 1];
          // byte-for-byte match against the FULL untruncated audit-time raw
          // line; any drift (including whitespace) => skip, never fuzzy.
          if (typeof r.raw === "string" && current === r.raw) {
            drop.add(lineNo - 1);
            applied.push(`${r.location} — DELETED: ${current.trim().slice(0, 100)}`);
            r.notes.push("auto-applied: line deleted");
          } else if (typeof r.raw !== "string") {
            skippedApply.push(`${r.location} — no raw audit-time line captured, skipped (never fuzzy-delete)`);
            r.notes.push("apply skipped: no raw line captured");
          } else {
            skippedApply.push(`${r.location} — file drifted since scan (line no longer byte-identical), skipped`);
            r.notes.push("apply skipped: file drifted since scan");
          }
        }
        if (drop.size) writeFileSync(file, lines.filter((_, i) => !drop.has(i)).join("\n"));
      } catch (e: any) {
        skippedApply.push(`${file} — apply failed: ${String(e?.message ?? e).slice(0, 120)}`);
      }
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const summary = {
    generatedAt: new Date().toISOString(),
    mode: heuristicsOnly ? "heuristics-only" : "full",
    model: heuristicsOnly ? null : AUDIT_MODEL,
    itemCount: results.length,
    liveDocsFetched: docs.map((d) => d.url),
    degradedChunks,
    counts,
    heuristicFlagCount: flagged.length,
    applied,
    skippedApply,
    results,
    disclaimer: reportOnly || heuristicsOnly
      ? "REPORT-ONLY run — nothing applied."
      : "AUTO-APPLY mode (Bob directive 2026-08-01): safe DELETEs applied to markdown surfaces; REWRITEs + non-markdown surfaces listed for manual follow-up.",
  };

  const modeSuffix = heuristicsOnly ? "-heuristics" : "";
  const jsonPath = `/tmp/prompt-staleness-audit-${date}${modeSuffix}.json`;
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

  const md: string[] = [
    `# Prompt Staleness Audit — ${date}`,
    ``,
    reportOnly || heuristicsOnly
      ? `**REPORT-ONLY run.** Nothing applied.`
      : `**AUTO-APPLY mode.** ${applied.length} safe DELETE(s) applied; ${skippedApply.length} item(s) left for manual follow-up (listed below).`,
    ``,
    `- Mode: ${summary.mode}${summary.model ? ` (model: ${summary.model})` : ""}`,
    `- Items audited: ${results.length} · DELETE ${counts.DELETE} · REWRITE ${counts.REWRITE} · KEEP ${counts.KEEP}`,
    `- Live guidance fetched: ${docs.length ? docs.map((d) => d.url).join(", ") : "NONE (all DELETEs downgraded to KEEP)"}`,
    degradedChunks ? `- ⚠ DEGRADED: ${degradedChunks === -1 ? "LLM client init failed" : `${degradedChunks} chunk(s) failed`} — affected items defaulted to KEEP.` : ``,
    ``,
    `## Actionable (DELETE / REWRITE)`,
    ``,
    `| Verdict | Location | Line | Reason | Source |`,
    `|---|---|---|---|---|`,
    ...results.filter((r) => r.verdict !== "KEEP").map((r) =>
      `| ${r.verdict} | ${r.location} | ${r.text.slice(0, 120).replace(/\|/g, "\\|")} | ${r.reason.replace(/\|/g, "\\|")} | ${r.source ?? ""} |`),
    ``,
    ...(applied.length ? [``, `## Applied automatically (${applied.length})`, ``, ...applied.map((a) => `- ${a}`)] : []),
    ...(skippedApply.length ? [``, `## Not auto-applied — needs manual follow-up (${skippedApply.length})`, ``, ...skippedApply.map((s) => `- ${s}`)] : []),
    ``,
    `## Heuristic flags (${flagged.length})`,
    ``,
    ...flagged.map((r) => `- \`${r.heuristicFlags.join(",")}\` — ${r.location}: ${r.text.slice(0, 140)}`),
    ``,
    `Full detail (incl. every KEEP + downgrade notes): ${jsonPath}`,
  ].filter((l) => l !== null) as string[];
  const mdPath = `/tmp/prompt-staleness-audit-${date}${modeSuffix}.md`;
  writeFileSync(mdPath, md.join("\n"));

  if (asJson) console.log(JSON.stringify(summary));
  else {
    console.log(`Prompt Staleness Audit complete — ${results.length} items: DELETE ${counts.DELETE}, REWRITE ${counts.REWRITE}, KEEP ${counts.KEEP}${degradedChunks ? " (DEGRADED)" : ""}${!heuristicsOnly && !reportOnly ? ` · auto-applied ${applied.length}, manual follow-up ${skippedApply.length}` : ""}`);
    console.log(`Report: ${mdPath}\nJSON:   ${jsonPath}`);
  }
  process.exit(0); // report-only & fail-open: never a red exit for verdict content
}

main().catch((e) => { console.error(`[audit] fatal: ${e?.message ?? e}`); process.exit(1); });
