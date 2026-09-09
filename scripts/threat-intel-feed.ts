#!/usr/bin/env tsx
/**
 * Threat-Intel Feed (GitHub deep-dive 2026-07 borrow — see
 * .agents/memory/github-deepdive-2026-07-verdict.md)
 *
 * Diffs two externally-maintained AI-agent security sources against a local
 * seen-state, and heuristically maps each NEW entry to a threat_model.md
 * coverage class. Advisory + fail-open: a source fetch failure degrades that
 * source, never errors the run; entries mapping to an UNCOVERED class are the
 * signal worth surfacing.
 *
 * $0, no LLM, no DB. Sources are UNTRUSTED external content: entries are
 * treated as data (hashed, truncated, categorized) and never executed or fed
 * into a prompt by this script.
 *
 * Usage:
 *   npx tsx scripts/threat-intel-feed.ts            # run, persist seen-state
 *   npx tsx scripts/threat-intel-feed.ts --json     # machine-readable output
 *   npx tsx scripts/threat-intel-feed.ts --dry-run  # don't persist seen-state
 *
 * Exit codes: 0 = always (advisory fail-open, even if both sources failed — degradation
 * is reported in the JSON/stderr), 2 = unknown CLI flag only (usage error).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const STATE_PATH = join(process.cwd(), "data", "threat-intel-state.json");
const MAX_ENTRY_CHARS = 300;
const FETCH_TIMEOUT_MS = 20_000;

const KNOWN_FLAGS = new Set(["--json", "--dry-run"]);
const args = process.argv.slice(2);
for (const a of args) {
  if (!KNOWN_FLAGS.has(a)) {
    console.error(`Unknown flag: ${a}. Known: ${[...KNOWN_FLAGS].join(", ")}`);
    process.exit(2);
  }
}
const asJson = args.includes("--json");
const dryRun = args.includes("--dry-run");

interface Source {
  id: string;
  url: string;
  kind: "incidents" | "research";
}

const SOURCES: Source[] = [
  {
    id: "webpro255/awesome-ai-agent-attacks",
    url: "https://raw.githubusercontent.com/webpro255/awesome-ai-agent-attacks/main/README.md",
    kind: "incidents",
  },
  {
    id: "LLMSecurity/awesome-agent-skills-security",
    url: "https://raw.githubusercontent.com/LLMSecurity/awesome-agent-skills-security/main/README.md",
    kind: "research",
  },
];

// Coverage classes mirror threat_model.md's ATLAS/OWASP cross-map. "covered"
// means a live control exists; "partial" mirrors the ◑ rows; anything that
// matches NO class is the interesting output (unmapped = review manually).
interface CoverageClass {
  key: string;
  coverage: "covered" | "partial";
  patterns: RegExp[];
}

const COVERAGE_CLASSES: CoverageClass[] = [
  { key: "prompt-injection", coverage: "covered", patterns: [/prompt.{0,3}injection/i, /indirect injection/i, /injection via/i] },
  { key: "jailbreak", coverage: "covered", patterns: [/jailbreak/i, /guardrail bypass/i, /refusal bypass/i] },
  { key: "tool-abuse / excessive agency", coverage: "covered", patterns: [/tool (abuse|poison|misuse)/i, /excessive agency/i, /plugin (compromise|attack)/i, /malicious (tool|skill|mcp)/i, /rogue (tool|agent)/i] },
  { key: "privilege-escalation", coverage: "covered", patterns: [/privilege escalation/i, /permission (bypass|escalation)/i, /sandbox escape/i, /rce\b/i, /remote code execution/i, /command injection/i] },
  { key: "exfiltration / secret leak", coverage: "covered", patterns: [/exfiltrat/i, /data (leak|theft)/i, /secret (leak|exposure)/i, /credential (theft|leak|stealing)/i, /api key/i] },
  { key: "memory / RAG poisoning", coverage: "covered", patterns: [/memory poison/i, /rag poison/i, /knowledge poison/i, /context poison/i] },
  { key: "supply-chain", coverage: "partial", patterns: [/supply.{0,3}chain/i, /typosquat/i, /malicious (package|dependency|npm|pypi)/i, /backdoor/i] },
  { key: "dos / unbounded consumption", coverage: "covered", patterns: [/denial.{0,4}of.{0,4}service/i, /\bdos attack/i, /resource exhaustion/i, /unbounded (consumption|spend)/i, /token (drain|burning)/i] },
  { key: "spoofing / impersonation", coverage: "covered", patterns: [/impersonat/i, /spoof/i, /phishing/i, /identity (theft|forgery)/i] },
  { key: "system-prompt leakage", coverage: "covered", patterns: [/system prompt (leak|extraction)/i, /prompt (leak|extraction)/i] },
  { key: "vector / embedding attacks", coverage: "partial", patterns: [/embedding (attack|inversion|poison)/i, /vector (store|db).{0,20}(attack|poison)/i] },
  { key: "deception / manipulation", coverage: "covered", patterns: [/agent deception/i, /manipulat/i, /social engineer/i, /scheming/i] },
];

function classify(text: string): { key: string; coverage: "covered" | "partial" | "unmapped" } {
  for (const c of COVERAGE_CLASSES) {
    if (c.patterns.some((p) => p.test(text))) return { key: c.key, coverage: c.coverage };
  }
  return { key: "unmapped", coverage: "unmapped" };
}

function normalize(line: string): string {
  return line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // strip md links, keep text
    .replace(/[*_`>#|\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract candidate entries: markdown bullets and table rows with substance.
function extractEntries(md: string): string[] {
  const out: string[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    const isBullet = /^[-*] /.test(line);
    const isTableRow = /^\|.*\|$/.test(line) && !/^\|[\s:-]+\|/.test(line) && !/^\|\s*(Name|Date|Project|Topic)/i.test(line);
    if (!isBullet && !isTableRow) continue;
    const text = normalize(line.replace(/^[-*] /, ""));
    if (text.length < 30) continue; // headers, nav fragments
    out.push(text.slice(0, MAX_ENTRY_CHARS));
  }
  return out;
}

function hashEntry(sourceId: string, text: string): string {
  return createHash("sha256").update(sourceId + "\n" + text.toLowerCase()).digest("hex").slice(0, 24);
}

interface State {
  seen: Record<string, string[]>; // sourceId -> hashes
  lastRunAt?: string;
}

function loadState(): State {
  try {
    if (existsSync(STATE_PATH)) {
      const parsed = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
      if (parsed && typeof parsed === "object" && parsed.seen && typeof parsed.seen === "object") {
        return { seen: parsed.seen, lastRunAt: parsed.lastRunAt };
      }
    }
  } catch { /* corrupted state = treat as first run (all entries "new" once) */ }
  return { seen: {} };
}

async function fetchSource(src: Source): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(src.url, { signal: ctrl.signal, headers: { "User-Agent": "visionclaw-threat-intel/1.0" } });
    if (!res.ok) return null;
    // Byte cap (72h-review round 3 MEDIUM): these are external, attacker-
    // influenceable URLs — never buffer an unbounded body. 2 MB is far above
    // any legitimate README size.
    const MAX_BYTES = 2 * 1024 * 1024;
    const lenHeader = Number(res.headers.get("content-length") ?? 0);
    if (Number.isFinite(lenHeader) && lenHeader > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface NewEntry {
  source: string;
  text: string;
  categoryKey: string;
  coverage: "covered" | "partial" | "unmapped";
}

async function main() {
  const state = loadState();
  const firstRunSources: string[] = [];
  const degradedSources: string[] = [];
  const newEntries: NewEntry[] = [];
  let sourcesOk = 0;

  for (const src of SOURCES) {
    const md = await fetchSource(src);
    if (md === null) {
      degradedSources.push(src.id);
      continue;
    }
    sourcesOk++;
    const entries = extractEntries(md);
    const prior = new Set(state.seen[src.id] ?? []);
    const isFirstRun = !state.seen[src.id];
    if (isFirstRun) firstRunSources.push(src.id);
    const nextHashes: string[] = [];
    for (const text of entries) {
      const h = hashEntry(src.id, text);
      nextHashes.push(h);
      if (!prior.has(h) && !isFirstRun) {
        const c = classify(text);
        newEntries.push({ source: src.id, text, categoryKey: c.key, coverage: c.coverage });
      }
    }
    state.seen[src.id] = nextHashes;
  }

  const uncovered = newEntries.filter((e) => e.coverage === "unmapped");
  const partial = newEntries.filter((e) => e.coverage === "partial");

  if (!dryRun && sourcesOk > 0) {
    state.lastRunAt = new Date().toISOString();
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }

  const result = {
    ok: sourcesOk > 0,
    sourcesOk,
    degradedSources,
    firstRunSources,
    newCount: newEntries.length,
    newEntries: newEntries.slice(0, 100),
    uncoveredCount: uncovered.length,
    partialCount: partial.length,
    dryRun,
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Threat-intel feed: ${sourcesOk}/${SOURCES.length} sources fetched${degradedSources.length ? ` (degraded: ${degradedSources.join(", ")})` : ""}`);
    if (firstRunSources.length) console.log(`First run (baseline captured, no diff): ${firstRunSources.join(", ")}`);
    console.log(`New entries since last run: ${newEntries.length} (unmapped: ${uncovered.length}, partial-coverage: ${partial.length})`);
    for (const e of uncovered.slice(0, 20)) console.log(`  [UNMAPPED] (${e.source}) ${e.text.slice(0, 160)}`);
    for (const e of partial.slice(0, 10)) console.log(`  [PARTIAL:${e.categoryKey}] (${e.source}) ${e.text.slice(0, 140)}`);
  }

  if (sourcesOk === 0) {
    // Advisory feed: ALWAYS exit 0 (72h-review round 3 MEDIUM). This script is
    // fail-open by contract (weekly-maintenance Pass 18, YELLOW-never-RED) —
    // a network outage must never fail the caller. Degradation is loud on
    // stderr + in the JSON (ok:false) instead.
    console.error("Both threat-intel sources failed to fetch — no coverage this run (advisory, exit 0). Check network / raw.githubusercontent.com availability.");
  }
  process.exit(0);
}

main().catch((e) => {
  // Fail-open advisory contract: even an unexpected crash must not RED the
  // weekly sweep. Loud on stderr, exit 0.
  console.error("threat-intel-feed failed (advisory, exit 0):", e?.message ?? e);
  process.exit(0);
});
