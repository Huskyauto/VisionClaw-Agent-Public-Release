#!/usr/bin/env -S npx tsx
/**
 * Memory benchmark harness — scores VisionClaw's OWN memory system
 * (Memory V2 + MNEMA: real `generateEmbedding` + `hybridSearchMemory` recall)
 * on the public LoCoMo long-conversation QA benchmark, and can run a controlled
 * HEAD-TO-HEAD against the Moorcheh retrieval engine (the backend behind Memanto).
 *
 * This is NOT an integration of any third-party memory tool into the app runtime.
 * It borrows the standardized LoCoMo eval (the same dataset Mem0 / Zep / Letta /
 * Memanto report on) so we get an apples-to-apples number for our in-house stack,
 * and — with --engine=both — a fair side-by-side against Moorcheh.
 *
 * Fairness model (important): both engines ingest the SAME turn-level facts and
 * are scored through the SAME answer model + SAME LLM judge at the SAME top-K.
 * Only the RETRIEVAL layer differs:
 *   - vc       → real hybridSearchMemory (vector + BM25 + RRF) over pgvector
 *   - moorcheh → Moorcheh text-namespace semantic search (api.moorcheh.ai)
 * This isolates retrieval quality. NOTE: it does NOT reproduce Memanto's
 * published 87.1% headline — that number comes from Memanto's full
 * remember/recall/answer agent (LLM fact-extraction + typed schema + its own
 * answer model), which is a different, uncontrolled pipeline. What we measure
 * here is the retrieval engine head-to-head under one identical harness.
 *
 * Pipeline per conversation, per engine:
 *   1. Ingest every dialog turn as a fact (vc: createMemoryEntry + embedding →
 *      pgvector under an ISOLATED benchmark tenant; moorcheh: upload as text
 *      documents to a throwaway namespace).
 *   2. For each QA pair: recall top-K, answer from ONLY those snippets with an
 *      LLM, and grade the answer with an LLM judge.
 *   3. Tally accuracy per LoCoMo category + overall; tear down the scratch data.
 *
 * Categories (LoCoMo): 1=multi-hop, 2=temporal, 3=open-domain, 4=single-hop,
 * 5=adversarial (the correct behavior is to decline — info is NOT present).
 *
 * Usage:
 *   npx tsx scripts/memory-benchmark.ts                              # vc only, 1 convo, 30 Qs
 *   npx tsx scripts/memory-benchmark.ts --engine=both               # head-to-head, 1 convo
 *   npx tsx scripts/memory-benchmark.ts --engine=both --limit=10 --questions=0   # full head-to-head
 *   npx tsx scripts/memory-benchmark.ts --engine=moorcheh --limit=3
 *
 * Flags:
 *   --engine=E        vc | moorcheh | both (default vc; moorcheh/both need MOORCHEH_API_KEY)
 *   --limit=N         conversations to run (default 1; max 10)
 *   --questions=M     cap QA pairs per conversation (default 30; 0 = all)
 *   --max-turns=N     cap dialog turns ingested per conversation (default 0 = all)
 *   --topk=K          memories retrieved per question (default 10)
 *   --tenant-base=ID  base benchmark tenant id for the vc engine (default 990100; convo i uses base+i)
 *   --answer-model=ID OpenRouter model that answers from snippets (default openai/gpt-4o-mini)
 *   --judge-model=ID  OpenRouter model that grades (default openai/gpt-4o-mini)
 *   --concurrency=N   parallel embed/insert + upload workers (default 6)
 *   --dataset=path    local LoCoMo json (default data/benchmarks/locomo10.json; auto-downloads)
 *   --no-cleanup      keep ingested rows / namespaces after the run (for inspection)
 *
 * Env: OPENROUTER_API_KEY (answer+judge), the app's DB + OpenAI provider key
 * (vc embeddings), and MOORCHEH_API_KEY (only when engine includes moorcheh).
 *
 * Exit codes: 0 = ran to completion, 1 = error.
 */
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { storage } from "../server/storage";
import { generateEmbedding, hybridSearchMemory } from "../server/embeddings";

const DATASET_URL = "https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json";
const CATEGORY_LABELS: Record<number, string> = {
  1: "multi_hop",
  2: "temporal",
  3: "open_domain",
  4: "single_hop",
  5: "adversarial",
};
type Engine = "vc" | "moorcheh";

function arg(name: string, def?: string): string | undefined {
  const flag = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(flag));
  return found ? found.slice(flag.length) : def;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const openrouterKey = process.env.OPENROUTER_API_KEY;
if (!openrouterKey) {
  console.error("ERROR: OPENROUTER_API_KEY missing — needed for the answer + judge models.");
  process.exit(1);
}
const llm = new OpenAI({
  apiKey: openrouterKey,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: { "HTTP-Referer": "https://agenticcorporation.net", "X-Title": "VisionClaw Memory Benchmark" },
});

// ---- Moorcheh client (retrieval engine behind Memanto) -----------------------
const MOORCHEH_BASE = "https://api.moorcheh.ai/v1";
const moorchehKey = process.env.MOORCHEH_API_KEY;
function mhHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", "x-api-key": moorchehKey || "" };
}
async function mhFetch(pathname: string, init: RequestInit): Promise<{ status: number; body: any }> {
  // Moorcheh's free tier enforces a per-second rate cap; under parallel grading
  // it returns 429 ("Too Many Requests" / "Limit Exceeded"). Those are transient,
  // so retry with exponential backoff + jitter rather than dropping the question
  // (a dropped question would shrink moorcheh's denominator and bias the H2H).
  const MAX_RETRIES = 6;
  let lastDetail = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const r = await fetch(`${MOORCHEH_BASE}${pathname}`, init);
    const text = await r.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    // 200 OK, 201 Created, 202 Accepted (async upload/delete) are all success;
    // 409 Conflict on create means the namespace already exists — tolerate it.
    if (r.ok || r.status === 202 || r.status === 409) {
      return { status: r.status, body };
    }
    lastDetail = typeof body === "string" ? body : JSON.stringify(body);
    const retryable = r.status === 429 || r.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      const backoff = Math.min(16000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
      await new Promise((z) => setTimeout(z, backoff));
      continue;
    }
    throw new Error(`Moorcheh ${init.method || "GET"} ${pathname} → ${r.status}: ${lastDetail}`);
  }
  throw new Error(`Moorcheh ${init.method || "GET"} ${pathname} exhausted retries: ${lastDetail}`);
}
async function mhCreateNamespace(ns: string): Promise<void> {
  await mhFetch(`/namespaces`, {
    method: "POST",
    headers: mhHeaders(),
    body: JSON.stringify({ namespace_name: ns, type: "text" }),
  });
}
async function mhDeleteNamespace(ns: string): Promise<void> {
  try {
    await mhFetch(`/namespaces/${ns}`, { method: "DELETE", headers: mhHeaders() });
  } catch (e) {
    console.warn(`    [moorcheh] delete ${ns} failed (non-fatal): ${(e as Error).message}`);
  }
}
async function mhUpload(ns: string, facts: string[]): Promise<number> {
  const BATCH = 200; // stay well under the 10MB payload cap
  let uploaded = 0;
  for (let i = 0; i < facts.length; i += BATCH) {
    const slice = facts.slice(i, i + BATCH);
    const documents = slice.map((text, j) => ({ id: `t${i + j}`, text }));
    await mhFetch(`/namespaces/${ns}/documents`, {
      method: "POST",
      headers: mhHeaders(),
      body: JSON.stringify({ documents }),
    });
    uploaded += slice.length;
  }
  return uploaded;
}
async function mhSearch(ns: string, query: string, topK: number): Promise<string[]> {
  const { body } = await mhFetch(`/search`, {
    method: "POST",
    headers: mhHeaders(),
    body: JSON.stringify({ query, namespaces: [ns], top_k: topK }),
  });
  const results: any[] = (body && body.results) || [];
  return results.map((r) => r.text).filter((t): t is string => typeof t === "string" && t.length > 0);
}
/**
 * Upload is async (202). Poll a sample query until the namespace returns hits.
 * Fail CLOSED on timeout: throw so the caller marks this engine-convo as
 * skipped, rather than silently grading on a not-yet-indexed namespace (which
 * would unfairly depress Moorcheh's score as if retrieval, not indexing, failed).
 */
async function mhWaitReady(ns: string, sampleQuery: string, timeoutMs = 30000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const hits = await mhSearch(ns, sampleQuery, 1);
      if (hits.length > 0) return;
    } catch {
      /* transient — retry */
    }
    await new Promise((z) => setTimeout(z, 1500));
  }
  throw new Error(`Moorcheh namespace ${ns} not searchable within ${timeoutMs}ms (indexing lag) — skipping engine-convo`);
}

type LocomoTurn = { speaker: string; text?: string; dia_id?: string; blip_caption?: string };
type LocomoQA = { question: string; answer?: unknown; adversarial_answer?: unknown; category: number; evidence?: string[] };
type LocomoSample = { sample_id?: string; conversation: Record<string, any>; qa: LocomoQA[] };

async function loadDataset(localPath: string): Promise<LocomoSample[]> {
  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, "utf8"));
  }
  console.log(`[dataset] not found locally, downloading LoCoMo → ${localPath}`);
  const res = await fetch(DATASET_URL);
  if (!res.ok) {
    throw new Error(`failed to download LoCoMo (${res.status}). Place the file at ${localPath} manually.`);
  }
  const text = await res.text();
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, text);
  return JSON.parse(text);
}

/** Flatten a LoCoMo conversation into ordered, date-stamped turn facts. */
function turnsFromConversation(conv: Record<string, any>): string[] {
  const facts: string[] = [];
  const sessionNums = Object.keys(conv)
    .map((k) => /^session_(\d+)$/.exec(k))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  for (const n of sessionNums) {
    const turns = conv[`session_${n}`] as LocomoTurn[];
    if (!Array.isArray(turns)) continue;
    const when = conv[`session_${n}_date_time`] || `session ${n}`;
    for (const t of turns) {
      const body = (t.text || "").trim();
      const img = t.blip_caption ? ` (shared an image: ${t.blip_caption.trim()})` : "";
      if (!body && !img) continue;
      facts.push(`[${when}] ${t.speaker}: ${body}${img}`);
    }
  }
  return facts;
}

/** Bounded-concurrency map. */
async function pool<T>(items: T[], concurrency: number, worker: (item: T, idx: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function clearTenant(tenantId: number): Promise<void> {
  // Fail-safe: scope the delete to source='benchmark' so that even if a real
  // tenant id ever collides with the benchmark range, only rows this harness
  // inserted are removed — never a real tenant's actual memory.
  await db.execute(sql`DELETE FROM memory_entries WHERE tenant_id = ${tenantId} AND source = 'benchmark'`);
}

async function ingestVC(facts: string[], tenantId: number, concurrency: number): Promise<{ stored: number; embedded: number }> {
  let stored = 0;
  let embedded = 0;
  await pool(facts, concurrency, async (fact) => {
    const entry = await storage.createMemoryEntry({
      fact,
      category: "conversation",
      source: "benchmark",
      status: "active",
      personaId: null,
      tenantId,
      confidence: 1.0,
      confidenceSource: "benchmark",
    } as any);
    stored++;
    const emb = await generateEmbedding(fact);
    if (emb) {
      await storage.updateMemoryEmbedding(entry.id, emb);
      embedded++;
    }
  });
  return { stored, embedded };
}

function goldAnswer(qa: LocomoQA): string {
  // LoCoMo category 5 is adversarial: the information is NOT in the conversation
  // and the correct behavior is to decline. Feeding the `adversarial_answer`
  // distractor as "gold" would contradict the judge's adversarial rule, so we
  // use an explicit decline target and let judge()'s category-5 branch grade it.
  if (qa.category === 5) return "Not mentioned in the conversation (adversarial — the information is not present).";
  const raw = qa.answer ?? qa.adversarial_answer;
  return raw == null ? "" : String(raw);
}

async function answerFromMemory(question: string, snippets: string[], model: string): Promise<string> {
  const context = snippets.length
    ? snippets.map((s, i) => `(${i + 1}) ${s}`).join("\n")
    : "(no relevant memories were retrieved)";
  const resp = await llm.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 300,
    messages: [
      {
        role: "system",
        content:
          "You answer a question using ONLY the retrieved memory snippets from a long conversation. " +
          "If the answer is not supported by the snippets, reply exactly: Not mentioned in the conversation. " +
          "Be concise — a short phrase or sentence, no preamble.",
      },
      { role: "user", content: `Memory snippets:\n${context}\n\nQuestion: ${question}\nAnswer:` },
    ],
  });
  return (resp.choices[0]?.message?.content || "").trim();
}

async function judge(question: string, gold: string, predicted: string, category: number, model: string): Promise<boolean> {
  const adversarialNote =
    category === 5
      ? "\nThis is an ADVERSARIAL question: the information is NOT in the conversation. The prediction is CORRECT only if it declines / says the info is not mentioned / unknown."
      : "";
  const resp = await llm.chat.completions.create({
    model,
    temperature: 0,
    max_tokens: 5,
    messages: [
      {
        role: "system",
        content:
          "You are a strict grader for a memory QA benchmark. Decide if the PREDICTED answer is " +
          "semantically correct given the GOLD answer. Accept paraphrases, equivalent dates, and extra " +
          "correct detail. Reply with exactly one word: CORRECT or WRONG." + adversarialNote,
      },
      { role: "user", content: `Question: ${question}\nGold: ${gold}\nPredicted: ${predicted}\nVerdict:` },
    ],
  });
  // Strict parse: "INCORRECT".startsWith("CORRECT") is false, so a judge that
  // says INCORRECT/WRONG is never miscounted as correct.
  const verdict = (resp.choices[0]?.message?.content || "").trim().toUpperCase();
  return verdict.startsWith("CORRECT");
}

type Tally = { correct: number; total: number };
function blankTally(): Record<string, Tally> {
  const t: Record<string, Tally> = { overall: { correct: 0, total: 0 } };
  for (const label of Object.values(CATEGORY_LABELS)) t[label] = { correct: 0, total: 0 };
  return t;
}
function bump(tally: Record<string, Tally>, category: number, correct: boolean) {
  const label = CATEGORY_LABELS[category] || `cat_${category}`;
  (tally[label] ||= { correct: 0, total: 0 });
  tally[label].total++;
  tally.overall.total++;
  if (correct) {
    tally[label].correct++;
    tally.overall.correct++;
  }
}
function mergeTally(into: Record<string, Tally>, from: Record<string, Tally>) {
  for (const k of Object.keys(from)) {
    (into[k] ||= { correct: 0, total: 0 });
    into[k].correct += from[k].correct;
    into[k].total += from[k].total;
  }
}
function pct(t: Tally): string {
  return t.total ? `${((100 * t.correct) / t.total).toFixed(1)}%` : "—";
}
function pctNum(t: Tally): number {
  return t.total ? (100 * t.correct) / t.total : 0;
}

type RecallFn = (question: string, topK: number) => Promise<string[]>;

/** Run one engine over one conversation's QA set with a given recall fn. */
// Per-question outcome keyed by the QA pair's original index in the convo, so
// two engines' results can be intersected for strictly paired H2H scoring.
type Outcome = { category: number; correct: boolean };
async function gradeConvo(
  qas: LocomoQA[],
  recall: RecallFn,
  topK: number,
  answerModel: string,
  judgeModel: string,
  label: string,
  concurrency: number,
): Promise<{ tally: Record<string, Tally>; errored: number; outcomes: Map<number, Outcome> }> {
  const tally = blankTally();
  const outcomes = new Map<number, Outcome>();
  let errored = 0;
  let done = 0;
  const answerable = qas.map((qa, idx) => ({ qa, idx })).filter((x) => x.qa.question);
  // JS is single-threaded, so bump()/counter/Map mutations inside the pool
  // workers are race-free; only the awaited LLM/recall calls actually overlap.
  await pool(answerable, concurrency, async ({ qa, idx }) => {
    const gold = goldAnswer(qa);
    try {
      const snippets = await recall(qa.question, topK);
      const predicted = await answerFromMemory(qa.question, snippets, answerModel);
      const correct = await judge(qa.question, gold, predicted, qa.category, judgeModel);
      bump(tally, qa.category, correct);
      outcomes.set(idx, { category: qa.category, correct }); // only NON-errored land here
    } catch (e) {
      // Infra/model outage is NOT a memory-quality failure — exclude from denom.
      errored++;
      console.warn(`    [${label}] Q errored (excluded): ${(e as Error).message}`);
    }
    done++;
    if (done % 10 === 0 || done === answerable.length) {
      process.stdout.write(`    [${label}] graded ${done}/${answerable.length} (running ${pct(tally.overall)})\r`);
    }
  });
  process.stdout.write("\n");
  return { tally, errored, outcomes };
}

function printResults(label: string, tally: Record<string, Tally>, errored: number) {
  console.log(`\n=== RESULTS — ${label} ===`);
  const order = ["single_hop", "multi_hop", "temporal", "open_domain", "adversarial", "overall"];
  for (const l of order) {
    const t = tally[l];
    if (t) console.log(`  ${l.padEnd(13)} ${pct(t).padStart(7)}  (${t.correct}/${t.total})`);
  }
  if (errored) console.log(`  ${"errored".padEnd(13)} ${String(errored).padStart(7)}  (excluded from accuracy)`);
}

const H2H_ORDER = ["single_hop", "multi_hop", "temporal", "open_domain", "adversarial", "overall"];
function printPairedH2H(vc: Record<string, Tally>, moorcheh: Record<string, Tally>, pairedQuestions: number) {
  console.log(`\n=== HEAD-TO-HEAD (vc − moorcheh), strictly paired ===`);
  console.log(`  Counts ONLY the ${pairedQuestions} question(s) BOTH engines answered (neither errored).`);
  if (pairedQuestions === 0) {
    console.log(`  No questions were answered by both engines — no fair comparison possible.`);
    return;
  }
  console.log(`  ${"category".padEnd(13)} ${"vc".padStart(8)} ${"moorcheh".padStart(10)} ${"Δ".padStart(8)} ${"n".padStart(6)}`);
  for (const l of H2H_ORDER) {
    const v = vc[l];
    const m = moorcheh[l];
    if (!v || !m) continue;
    const haveBoth = v.total > 0 && m.total > 0; // Δ vs a zero baseline is meaningless, not a win
    const d = pctNum(v) - pctNum(m);
    const dStr = haveBoth ? `${d >= 0 ? "+" : ""}${d.toFixed(1)}` : "n/a";
    console.log(`  ${l.padEnd(13)} ${pct(v).padStart(8)} ${pct(m).padStart(10)} ${dStr.padStart(8)} ${String(v.total).padStart(6)}`);
  }
}

/**
 * Stitch several per-run result JSONs (one per quota window) into a single
 * combined report. Cross-day merge is valid because each run covers a DISJOINT
 * set of convos (use --offset to pace), so grand + paired tallies simply sum.
 */
function mergeMode(dir: string) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f))
    .sort();
  if (files.length === 0) {
    console.error(`ERROR: no .json result files found in ${dir}`);
    process.exit(1);
  }
  const grand: Record<string, { tally: Record<string, Tally>; errored: number }> = {};
  const paired = { vc: blankTally(), moorcheh: blankTally() };
  let pairedQuestions = 0;
  let convoEntries = 0;
  console.log(`=== MERGE ${files.length} run file(s) from ${dir} ===`);
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const e of Object.keys(j.grand || {})) {
      grand[e] ||= { tally: blankTally(), errored: 0 };
      mergeTally(grand[e].tally, j.grand[e].tally);
      grand[e].errored += j.grand[e].errored || 0;
    }
    if (j.headToHeadPaired) {
      mergeTally(paired.vc, j.headToHeadPaired.vc);
      mergeTally(paired.moorcheh, j.headToHeadPaired.moorcheh);
      pairedQuestions += j.headToHeadPaired.pairedQuestions || 0;
    }
    const n = (j.perConvo || []).length;
    convoEntries += n;
    console.log(`  + ${path.basename(f)} — ${n} convo(s)`);
  }
  console.log(`\n  combined ${convoEntries} convo entries`);
  for (const e of Object.keys(grand)) printResults(e, grand[e].tally, grand[e].errored);
  if (grand.vc && grand.moorcheh) printPairedH2H(paired.vc, paired.moorcheh, pairedQuestions);
}

async function main() {
  const mergeDir = arg("merge");
  if (mergeDir) {
    mergeMode(mergeDir);
    return;
  }

  const engineArg = (arg("engine", "vc") || "vc").toLowerCase();
  const engines: Engine[] =
    engineArg === "both" ? ["vc", "moorcheh"] : engineArg === "moorcheh" ? ["moorcheh"] : ["vc"];
  if (!["vc", "moorcheh", "both"].includes(engineArg)) {
    console.error(`ERROR: --engine must be vc | moorcheh | both (got "${engineArg}").`);
    process.exit(1);
  }
  if (engines.includes("moorcheh") && !moorchehKey) {
    console.error("ERROR: MOORCHEH_API_KEY missing — needed for the moorcheh engine.");
    process.exit(1);
  }

  const limit = Math.max(1, Number(arg("limit", "1")));
  const offset = Math.max(0, Number(arg("offset", "0"))); // skip first N convos — pace across quota windows
  const questionCap = Number(arg("questions", "30")); // 0 = all
  const topK = Number(arg("topk", "10"));
  const maxTurns = Number(arg("max-turns", "0")); // 0 = all
  const tenantBase = Number(arg("tenant-base", "990100"));
  const answerModel = arg("answer-model", "openai/gpt-4o-mini")!;
  const judgeModel = arg("judge-model", "openai/gpt-4o-mini")!;
  const concurrency = Math.max(1, Number(arg("concurrency", "6")));
  // Moorcheh's free tier rate-caps hard, so grade it with a gentler concurrency
  // (backoff still kicks in, but starting low keeps the run fast & retry-light).
  const mhConcurrency = Math.max(1, Number(arg("mh-concurrency", "3")));
  const datasetPath = arg("dataset", "data/benchmarks/locomo10.json")!;
  const cleanup = !hasFlag("no-cleanup");
  const nsBase = `vcbench-${Date.now()}`; // unique per run → no namespace collisions

  console.log("=== VisionClaw Memory Benchmark (LoCoMo) ===");
  console.log(
    `engine=${engines.join("+")} limit=${limit} questions/convo=${questionCap || "all"} topK=${topK} ` +
      `answer=${answerModel} judge=${judgeModel} concurrency=${concurrency} cleanup=${cleanup}`,
  );

  const dataset = await loadDataset(datasetPath);
  const samples = dataset.slice(offset, Math.min(offset + limit, dataset.length));
  if (samples.length === 0) {
    console.error(`ERROR: --offset ${offset} is past the end of the dataset (${dataset.length} convos).`);
    process.exit(1);
  }
  const startedAt = Date.now();
  const grand: Record<string, { tally: Record<string, Tally>; errored: number; convosSkipped?: number }> = {};
  for (const e of engines) grand[e] = { tally: blankTally(), errored: 0 };
  // Strictly-paired H2H: only questions BOTH engines answered (non-errored, same
  // convo) count, so asymmetric infra failures (e.g. Moorcheh 429s) can't bias
  // the delta. Built only when running both engines.
  const grandPaired: Record<string, Record<string, Tally>> = { vc: blankTally(), moorcheh: blankTally() };
  let pairedQuestions = 0;
  const perConvo: any[] = [];

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const allFacts = turnsFromConversation(sample.conversation);
    const facts = maxTurns > 0 ? allFacts.slice(0, maxTurns) : allFacts;
    const qas = questionCap > 0 ? sample.qa.slice(0, questionCap) : sample.qa;
    const firstQ = qas.find((q) => q.question)?.question || facts[0] || "hello";
    const absIdx = offset + i; // absolute convo index in the dataset (offset-aware)
    console.log(`\n--- convo ${absIdx + 1} (${i + 1}/${samples.length} this run, sample ${sample.sample_id ?? absIdx}) — ${facts.length} turns, ${qas.length} questions ---`);

    const convoEntry: any = { sampleId: sample.sample_id ?? absIdx, convoIndex: absIdx, turns: facts.length, engines: {} };
    const convoOutcomes: Record<string, Map<number, Outcome>> = {};

    for (const engine of engines) {
      const t0 = Date.now();
      try {
        let res: { tally: Record<string, Tally>; errored: number; outcomes: Map<number, Outcome> };
        if (engine === "vc") {
          const tenantId = tenantBase + absIdx;
          await clearTenant(tenantId); // fresh scratch in case a prior run aborted
          const { stored, embedded } = await ingestVC(facts, tenantId, concurrency);
          console.log(`  [vc] ingested ${stored} memories (${embedded} embedded) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          const recall: RecallFn = async (question, k) =>
            (await hybridSearchMemory(question, { tenantId, topK: k })).map((h) => h.fact);
          res = await gradeConvo(qas, recall, topK, answerModel, judgeModel, "vc", concurrency);
          if (cleanup) await clearTenant(tenantId);
        } else {
          const ns = `${nsBase}-${absIdx}`;
          await mhCreateNamespace(ns);
          const uploaded = await mhUpload(ns, facts);
          await mhWaitReady(ns, firstQ);
          console.log(`  [moorcheh] uploaded ${uploaded} docs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          const recall: RecallFn = async (question, k) => mhSearch(ns, question, k);
          res = await gradeConvo(qas, recall, topK, answerModel, judgeModel, "moorcheh", mhConcurrency);
          if (cleanup) await mhDeleteNamespace(ns);
        }
        mergeTally(grand[engine].tally, res.tally);
        grand[engine].errored += res.errored;
        convoOutcomes[engine] = res.outcomes;
        convoEntry.engines[engine] = { accuracy: res.tally, errored: res.errored };
        console.log(`  [${engine}] convo ${absIdx + 1} overall: ${pct(res.tally.overall)}${res.errored ? ` (${res.errored} errored)` : ""}`);
      } catch (e) {
        // A whole-engine setup failure (e.g. Moorcheh free-tier quota lock on
        // create/upload) must NOT abort the run and discard the other engine's
        // completed work. Record the convo as skipped for this engine and move on.
        convoEntry.engines[engine] = { skipped: true, reason: (e as Error).message };
        grand[engine].convosSkipped = (grand[engine].convosSkipped || 0) + 1;
        console.warn(`  [${engine}] convo ${absIdx + 1} SKIPPED — ${(e as Error).message}`);
      }
    }
    // Intersection-paired tally: count only QA pairs BOTH engines answered.
    if (convoOutcomes.vc && convoOutcomes.moorcheh) {
      for (const [idx, vcOut] of convoOutcomes.vc) {
        const mhOut = convoOutcomes.moorcheh.get(idx);
        if (!mhOut) continue; // one side errored this question → drop from paired set
        bump(grandPaired.vc, vcOut.category, vcOut.correct);
        bump(grandPaired.moorcheh, mhOut.category, mhOut.correct);
        pairedQuestions++;
      }
    }
    perConvo.push(convoEntry);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  for (const engine of engines) printResults(engine, grand[engine].tally, grand[engine].errored);

  if (engines.length === 2) {
    printPairedH2H(grandPaired.vc, grandPaired.moorcheh, pairedQuestions);
    console.log(
      `\n  Note: this is a RETRIEVAL-LAYER comparison under one identical answer+judge harness — ` +
        `not Memanto's full remember/recall/answer agent (which reports 87.1% on LoCoMo via a different pipeline).`,
    );
  }
  console.log(`\n  ran in ${elapsed}s over ${samples.length} conversation(s)`);

  const outDir = "data/benchmarks/results";
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `locomo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        benchmark: "LoCoMo",
        ranAt: new Date().toISOString(),
        config: { engines, limit, questionCap, topK, answerModel, judgeModel, concurrency },
        elapsedSeconds: Number(elapsed),
        grand,
        headToHeadPaired: engines.length === 2 ? { pairedQuestions, vc: grandPaired.vc, moorcheh: grandPaired.moorcheh } : undefined,
        perConvo,
      },
      null,
      2,
    ),
  );
  console.log(`  wrote ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
