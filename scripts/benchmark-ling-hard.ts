import OpenAI from "openai";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) { console.error("OPENROUTER_API_KEY missing"); process.exit(1); }

const client = new OpenAI({
  apiKey,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: { "HTTP-Referer": "https://agenticcorporation.net", "X-Title": "VisionClaw HardBench" },
});

const MODELS = [
  "inclusionai/ling-2.6-1t:free",
  "inclusionai/ling-2.6-flash",
  "openai/gpt-5-mini",
  "openai/gpt-5",
  "anthropic/claude-sonnet-4",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "x-ai/grok-4.1-fast",
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "moonshotai/kimi-k2.6",
  "z-ai/glm-5",
  "nvidia/nemotron-3-super-120b-a12b",
  "meta-llama/llama-4-maverick",
];

interface R { ok: boolean; score: number; max: number; outTok: number; inTok: number; ms: number; chars: number; err?: string; raw?: string }
const TIMEOUT = 90000;
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${label}`)), ms))]);
}
async function call(model: string, system: string, user: string): Promise<{ resp: any; ms: number }> {
  const t0 = Date.now();
  const resp = await withTimeout(client.chat.completions.create({ model, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: user }] }), TIMEOUT, model);
  return { resp, ms: Date.now() - t0 };
}
function pack(resp: any, ms: number, score: number, max: number, content: string): R {
  return { ok: true, score, max, outTok: resp.usage?.completion_tokens ?? 0, inTok: resp.usage?.prompt_tokens ?? 0, ms, chars: content.length, raw: content.slice(0, 200) };
}
function fail(ms: number, err: string, max: number): R { return { ok: false, score: 0, max, outTok: 0, inTok: 0, ms, chars: 0, err }; }
function tryParseJson(s: string): any {
  const stripped = s.replace(/```[a-z]*\n?|```/g, "").trim();
  try { return JSON.parse(stripped); } catch {}
  const m = stripped.match(/[\{\[][\s\S]*[\}\]]/);
  if (m) try { return JSON.parse(m[0]); } catch {}
  return null;
}

// ============ T1: Multi-hop logic puzzle ============
async function t1Logic(model: string): Promise<R> {
  const sys = "You solve logic puzzles. Output ONLY the requested JSON, no explanation.";
  const usr = "Alice, Bob, Carol, and Dave each picked a different color from {red, blue, green, yellow}. " +
    "Constraints: (1) Alice didn't pick red or blue. (2) Bob picked the color that comes alphabetically " +
    "right after Alice's color. (3) Carol picked blue. (4) Dave didn't pick green. " +
    "Output ONLY a JSON object {\"alice\":\"...\",\"bob\":\"...\",\"carol\":\"...\",\"dave\":\"...\"} with lowercase color names.";
  try {
    const { resp, ms } = await call(model, sys, usr);
    const c = resp.choices?.[0]?.message?.content || "";
    const j = tryParseJson(c);
    let s = 0;
    if (j && typeof j === "object") s++;
    if (j && j.alice && j.bob && j.carol && j.dave) s++;
    if (j && String(j.alice).toLowerCase() === "green") s++;
    if (j && String(j.bob).toLowerCase() === "red") s++;
    if (j && String(j.carol).toLowerCase() === "blue" && String(j.dave).toLowerCase() === "yellow") s++;
    return pack(resp, ms, s, 5, c);
  } catch (e: any) { return fail(0, e?.message || String(e), 5); }
}

// ============ T2: Subtle async bug ============
async function t2AsyncBug(model: string): Promise<R> {
  const sys = "Return ONLY the corrected TypeScript code. No explanation, no markdown fences, no prose.";
  const usr = "Find and fix the bug:\n\n" +
    "async function processItems(items: string[]): Promise<number[]> {\n" +
    "  const results = [];\n" +
    "  items.forEach(async (item) => {\n" +
    "    const n = await fetch('/api/score?q=' + item).then(r => r.json());\n" +
    "    results.push(n.value);\n" +
    "  });\n" +
    "  return results;\n" +
    "}";
  try {
    const { resp, ms } = await call(model, sys, usr);
    const c = resp.choices?.[0]?.message?.content || "";
    const code = c.replace(/```[a-z]*\n?|```/g, "");
    let s = 0;
    if (!/\.forEach\s*\(\s*async/.test(code)) s++;
    if (/for\s*\(\s*const\s+\w+\s+of/.test(code) || /Promise\.all\s*\(/.test(code) || /for\s+await/.test(code)) s++;
    if (/return\s+results/.test(code) || /return\s+(?:await\s+)?Promise\.all/.test(code)) s++;
    if (/async\s+function\s+processItems/.test(code)) s++;
    if (c.length < 600) s++;
    return pack(resp, ms, s, 5, c);
  } catch (e: any) { return fail(0, e?.message || String(e), 5); }
}

// ============ T3: Constraint satisfaction ============
async function t3Schedule(model: string): Promise<R> {
  const sys = "You solve scheduling puzzles. Output ONLY the requested JSON, no explanation.";
  const usr = "Schedule meetings A, B, C, D into time slots 9am, 10am, 11am, 12pm (exactly one meeting per slot). " +
    "Constraints: (1) A must be scheduled before C. (2) B cannot be at 9am. (3) C cannot be at 10am. " +
    "(4) The meeting at 12pm must be D. " +
    "Output ONLY a JSON object: {\"slot_9am\":\"X\",\"slot_10am\":\"X\",\"slot_11am\":\"X\",\"slot_12pm\":\"X\"} with the meeting letter (A/B/C/D) in each slot.";
  try {
    const { resp, ms } = await call(model, sys, usr);
    const c = resp.choices?.[0]?.message?.content || "";
    const j = tryParseJson(c);
    let s = 0;
    if (j && typeof j === "object") s++;
    if (j && j.slot_9am && j.slot_10am && j.slot_11am && j.slot_12pm) s++;
    if (j && String(j.slot_12pm).toUpperCase() === "D") s++;
    if (j && String(j.slot_11am).toUpperCase() === "C") s++;
    if (j && String(j.slot_9am).toUpperCase() === "A" && String(j.slot_10am).toUpperCase() === "B") s++;
    return pack(resp, ms, s, 5, c);
  } catch (e: any) { return fail(0, e?.message || String(e), 5); }
}

// ============ T4: Math word problem with compounding ============
async function t4Math(model: string): Promise<R> {
  const sys = "Output ONLY a single integer. No explanation, no units, no commas.";
  const usr = "A factory produces 240 widgets on Monday. Each subsequent day it makes 15% more than the previous day " +
    "(rounded to fractional widgets, not integers). After how many TOTAL days (including Monday) does cumulative " +
    "production first exceed 1500 widgets? Output only the integer answer.";
  try {
    const { resp, ms } = await call(model, sys, usr);
    const c = resp.choices?.[0]?.message?.content || "";
    const m = c.trim().match(/^[^0-9]*(\d+)[^0-9]*$/);
    let s = 0;
    if (m) s++;
    if (m && parseInt(m[1]) === 5) s++;
    if (c.length < 50) s++;
    if (!/day|week|widget|because|total|cumul/i.test(c)) s++;
    if (c.trim().length > 0 && c.trim().length < 10) s++;
    return pack(resp, ms, s, 5, c);
  } catch (e: any) { return fail(0, e?.message || String(e), 5); }
}

// ============ T5: Spec ambiguity / clarifying questions ============
async function t5Spec(model: string): Promise<R> {
  const sys = "You are a senior engineer. Output ONLY a JSON array. No explanation.";
  const usr = "A user says: 'Add a delete button to my todos page.' List the top 3 most important clarifying " +
    "questions you would ask. Output ONLY a JSON array of 3 short strings, each strictly less than 12 words, " +
    "each ending with a question mark.";
  try {
    const { resp, ms } = await call(model, sys, usr);
    const c = resp.choices?.[0]?.message?.content || "";
    const j = tryParseJson(c);
    let s = 0;
    if (Array.isArray(j)) s++;
    if (Array.isArray(j) && j.length === 3) s++;
    if (Array.isArray(j) && j.every((x) => typeof x === "string")) s++;
    if (Array.isArray(j) && j.every((x: any) => typeof x === "string" && x.split(/\s+/).length < 12)) s++;
    if (Array.isArray(j) && j.every((x: any) => typeof x === "string" && x.trim().endsWith("?"))) s++;
    return pack(resp, ms, s, 5, c);
  } catch (e: any) { return fail(0, e?.message || String(e), 5); }
}

const TASKS = [
  { name: "Logic",  fn: t1Logic },
  { name: "AsyncBug", fn: t2AsyncBug },
  { name: "Schedule", fn: t3Schedule },
  { name: "Math",   fn: t4Math },
  { name: "Spec",   fn: t5Spec },
];

(async () => {
  console.log("");
  console.log(`HARD BAKE-OFF: ${MODELS.length} models × ${TASKS.length} tasks (multi-hop logic, async bug, scheduling, math, spec ambiguity)`);
  console.log("Each task scored 0-5. Max total per model = 25.");
  console.log("=".repeat(125));

  const matrix: Record<string, Record<string, R>> = {};
  for (const m of MODELS) matrix[m] = {};
  console.log(`\nLaunching ALL ${MODELS.length * TASKS.length} (model x task) calls in parallel...`);
  const t0 = Date.now();
  const calls: Array<{m: string; t: string; p: Promise<R>}> = [];
  for (const t of TASKS) for (const m of MODELS) calls.push({ m, t: t.name, p: t.fn(m) });
  const settled = await Promise.allSettled(calls.map((c) => c.p));
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
  settled.forEach((r, i) => {
    const { m, t } = calls[i];
    if (r.status === "fulfilled") matrix[m][t] = r.value;
    else matrix[m][t] = { ok: false, score: 0, max: 5, outTok: 0, inTok: 0, ms: 0, chars: 0, err: r.reason?.message };
  });

  console.log("");
  console.log("=".repeat(125));
  console.log("PER-MODEL TOTALS — sorted by score then by tokens (asc)");
  console.log("=".repeat(125));
  const summary = MODELS.map((m) => {
    const arr = TASKS.map((t) => matrix[m][t.name]);
    const score = arr.reduce((s, x) => s + x.score, 0);
    const tok = arr.reduce((s, x) => s + x.outTok, 0);
    const lat = arr.reduce((s, x) => s + x.ms, 0);
    const errs = arr.filter((x) => !x.ok).length;
    const eff = tok > 0 ? (score / tok) * 1000 : 0;
    return { m, score, tok, lat, errs, eff, per: arr.map((x) => x.score) };
  }).sort((a, b) => b.score - a.score || a.tok - b.tok);

  console.log("Model".padEnd(40) + "Score".padEnd(9) + "PerTask".padEnd(16) + "OutTok".padEnd(10) + "TotLat".padEnd(10) + "Errs".padEnd(6) + "Eff");
  console.log("-".repeat(125));
  for (const s of summary) {
    console.log(s.m.padEnd(40) + `${s.score}/25`.padEnd(9) + `[${s.per.join(",")}]`.padEnd(16) + String(s.tok).padEnd(10) + `${(s.lat/1000).toFixed(1)}s`.padEnd(10) + String(s.errs).padEnd(6) + s.eff.toFixed(2));
  }

  console.log("");
  console.log("=".repeat(125));
  console.log("RAW MATRIX");
  console.log("=".repeat(125));
  console.log("Model".padEnd(40) + TASKS.map((t) => t.name.padEnd(13)).join(""));
  for (const m of MODELS) {
    let row = m.padEnd(40);
    for (const t of TASKS) {
      const r = matrix[m][t.name];
      row += (r.ok ? `${r.score}/${r.max} ${r.outTok}t` : "ERR").padEnd(13);
    }
    console.log(row);
  }

  console.log("");
  console.log("=".repeat(125));
  console.log("FAILED ANSWERS (raw output preview for debug)");
  console.log("=".repeat(125));
  for (const m of MODELS) for (const t of TASKS) {
    const r = matrix[m][t.name];
    if (r.ok && r.score < r.max && r.raw) console.log(`[${m} :: ${t.name} ${r.score}/${r.max}] ${JSON.stringify(r.raw.slice(0, 140))}`);
    if (!r.ok) console.log(`[${m} :: ${t.name}] ERR: ${r.err}`);
  }

  console.log("");
  console.log("=".repeat(125));
  console.log("VERDICT");
  console.log("=".repeat(125));
  const ling = summary.find((s) => s.m === "inclusionai/ling-2.6-1t:free");
  const flash = summary.find((s) => s.m === "inclusionai/ling-2.6-flash");
  const top = summary[0];
  console.log(`  Top by quality:    ${top.m}  ${top.score}/25 in ${top.tok} tokens (${(top.lat/1000).toFixed(1)}s)`);
  if (ling) console.log(`  Ling-2.6-1T:       rank #${summary.indexOf(ling)+1}  ${ling.score}/25 in ${ling.tok} tokens (${(ling.lat/1000).toFixed(1)}s) — ${(top.score - ling.score)} pts behind top`);
  if (flash) console.log(`  Ling-Flash:        rank #${summary.indexOf(flash)+1}  ${flash.score}/25 in ${flash.tok} tokens (${(flash.lat/1000).toFixed(1)}s) — ${(top.score - flash.score)} pts behind top`);
  const efficient = [...summary].filter(s => s.tok > 0).sort((a, b) => b.eff - a.eff)[0];
  console.log(`  Top by efficiency: ${efficient.m}  ${efficient.score}/25 in ${efficient.tok} tokens (eff ${efficient.eff.toFixed(2)})`);
})();
