import OpenAI from "openai";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("OPENROUTER_API_KEY missing");
  process.exit(1);
}

const client = new OpenAI({
  apiKey,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://agenticcorporation.net",
    "X-Title": "VisionClaw Benchmark",
  },
});

const MODELS = [
  "inclusionai/ling-2.6-1t:free",
  "inclusionai/ling-2.6-flash",
  "openai/gpt-5-mini",
  "openai/gpt-5",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-3.5-sonnet",
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

interface TaskResult {
  ok: boolean;
  score: number;
  maxScore: number;
  completionTokens: number;
  promptTokens: number;
  latencyMs: number;
  contentChars: number;
  error?: string;
  details?: string;
}

interface Task {
  name: string;
  maxScore: number;
  run: (model: string) => Promise<TaskResult>;
}

const TIMEOUT_MS = 90000;
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${label}`)), ms))]);
}

// ============ Task 1: Tool execution ============
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "send_email",
      description: "Send an email.",
      parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "schedule_reminder",
      description: "Schedule a reminder.",
      parameters: { type: "object", properties: { when: { type: "string" }, note: { type: "string" } }, required: ["when", "note"] },
    },
  },
];

async function task1Tool(model: string): Promise<TaskResult> {
  const t0 = Date.now();
  try {
    const resp = await withTimeout(
      client.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "You are an execution-focused agent. Use tools. Be concise. Don't narrate." },
          { role: "user", content: "Customer Sarah Mitchell signed up at sarah.mitchell@acme.example. Send a welcome email, then schedule a 7-day follow-up. Today is 2026-05-02." },
        ],
        tools: TOOLS,
        tool_choice: "auto",
      }),
      TIMEOUT_MS,
      "task1"
    );
    const ms = Date.now() - t0;
    const msg: any = resp.choices?.[0]?.message;
    const calls = msg?.tool_calls || [];
    const email = calls.find((c: any) => c.function?.name === "send_email");
    const rmdr = calls.find((c: any) => c.function?.name === "schedule_reminder");
    let toOK = false, whenOK = false;
    if (email) { try { toOK = JSON.parse(email.function.arguments).to.toLowerCase().includes("sarah.mitchell@acme.example"); } catch {} }
    if (rmdr) { try { const w = JSON.parse(rmdr.function.arguments).when; whenOK = String(w).includes("2026-05-09") || String(w).includes("2026-05-08") || String(w).includes("2026-05-10"); } catch {} }
    const score = (email ? 1 : 0) + (rmdr ? 1 : 0) + (toOK ? 1 : 0) + (whenOK ? 1 : 0);
    return { ok: true, score, maxScore: 4, completionTokens: resp.usage?.completion_tokens ?? 0, promptTokens: resp.usage?.prompt_tokens ?? 0, latencyMs: ms, contentChars: (msg?.content || "").length };
  } catch (e: any) {
    return { ok: false, score: 0, maxScore: 4, completionTokens: 0, promptTokens: 0, latencyMs: Date.now() - t0, contentChars: 0, error: e?.message };
  }
}

// ============ Task 2: Plan decomposition ============
async function task2Plan(model: string): Promise<TaskResult> {
  const t0 = Date.now();
  try {
    const resp = await withTimeout(
      client.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "You are a concise planner. Output ONLY the requested format. No preamble, no postamble." },
          { role: "user", content: "Goal: launch a 7-day pre-order campaign for a new SaaS product. Output a numbered list of EXACTLY 5 concrete steps, each <=15 words. Nothing else." },
        ],
      }),
      TIMEOUT_MS,
      "task2"
    );
    const ms = Date.now() - t0;
    const content = resp.choices?.[0]?.message?.content || "";
    const lines = content.split("\n").map((l) => l.trim()).filter((l) => /^\d+[\.\)]/.test(l));
    const exact5 = lines.length === 5 ? 1 : 0;
    const numbered = lines.length >= 1 ? 1 : 0;
    const allShort = lines.length > 0 && lines.every((l) => l.replace(/^\d+[\.\)]\s*/, "").trim().split(/\s+/).length <= 15) ? 1 : 0;
    const noPreamble = !/here.*are|let.*me|sure|certainly|below|following/i.test(content.split("\n")[0] || "") ? 1 : 0;
    const score = numbered + exact5 + allShort + noPreamble;
    return { ok: true, score, maxScore: 4, completionTokens: resp.usage?.completion_tokens ?? 0, promptTokens: resp.usage?.prompt_tokens ?? 0, latencyMs: ms, contentChars: content.length, details: `${lines.length} numbered lines` };
  } catch (e: any) {
    return { ok: false, score: 0, maxScore: 4, completionTokens: 0, promptTokens: 0, latencyMs: Date.now() - t0, contentChars: 0, error: e?.message };
  }
}

// ============ Task 3: Code fix ============
async function task3Code(model: string): Promise<TaskResult> {
  const t0 = Date.now();
  try {
    const resp = await withTimeout(
      client.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "Return ONLY the corrected code, no explanation, no markdown fences, no prose." },
          { role: "user", content: "Fix the bug:\n\nfunction average(nums: number[]): number {\n  let sum = 0;\n  for (let i = 1; i <= nums.length; i++) {\n    sum += nums[i];\n  }\n  return sum / nums.length;\n}" },
        ],
      }),
      TIMEOUT_MS,
      "task3"
    );
    const ms = Date.now() - t0;
    const content = resp.choices?.[0]?.message?.content || "";
    const stripped = content.replace(/```[a-z]*\n?|```/g, "");
    const startsAt0 = /for\s*\(\s*let\s+i\s*=\s*0/.test(stripped) ? 1 : 0;
    const ltLength = /i\s*<\s*nums\.length/.test(stripped) ? 1 : 0;
    const hasFunc = /function\s+average/.test(stripped) ? 1 : 0;
    const noProse = content.length < 250 ? 1 : 0;
    const score = startsAt0 + ltLength + hasFunc + noProse;
    return { ok: true, score, maxScore: 4, completionTokens: resp.usage?.completion_tokens ?? 0, promptTokens: resp.usage?.prompt_tokens ?? 0, latencyMs: ms, contentChars: content.length };
  } catch (e: any) {
    return { ok: false, score: 0, maxScore: 4, completionTokens: 0, promptTokens: 0, latencyMs: Date.now() - t0, contentChars: 0, error: e?.message };
  }
}

// ============ Task 4: Structured extraction ============
async function task4Json(model: string): Promise<TaskResult> {
  const t0 = Date.now();
  try {
    const resp = await withTimeout(
      client.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "Output ONLY a JSON object. No markdown fences, no preamble, no explanation." },
          { role: "user", content: "Extract company, founder, year from: 'Stripe was founded in 2010 by Patrick Collison and his brother John in Palo Alto.' Keys: company, founder, year." },
        ],
      }),
      TIMEOUT_MS,
      "task4"
    );
    const ms = Date.now() - t0;
    const content = resp.choices?.[0]?.message?.content || "";
    const stripped = content.replace(/```[a-z]*\n?|```/g, "").trim();
    let parsed: any = null;
    try { parsed = JSON.parse(stripped); } catch {
      const m = stripped.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }
    const validJson = parsed && typeof parsed === "object" ? 1 : 0;
    const allKeys = parsed && parsed.company && parsed.founder && parsed.year ? 1 : 0;
    const valuesOk = parsed && /stripe/i.test(String(parsed.company || "")) && /patrick.*collison/i.test(String(parsed.founder || "")) && String(parsed.year).includes("2010") ? 1 : 0;
    const noProse = content.length < 200 ? 1 : 0;
    const score = validJson + allKeys + valuesOk + noProse;
    return { ok: true, score, maxScore: 4, completionTokens: resp.usage?.completion_tokens ?? 0, promptTokens: resp.usage?.prompt_tokens ?? 0, latencyMs: ms, contentChars: content.length };
  } catch (e: any) {
    return { ok: false, score: 0, maxScore: 4, completionTokens: 0, promptTokens: 0, latencyMs: Date.now() - t0, contentChars: 0, error: e?.message };
  }
}

const TASKS: Task[] = [
  { name: "Tool Exec", maxScore: 4, run: task1Tool },
  { name: "Plan",      maxScore: 4, run: task2Plan },
  { name: "Code Fix",  maxScore: 4, run: task3Code },
  { name: "JSON",      maxScore: 4, run: task4Json },
];

(async () => {
  console.log("");
  console.log(`COMPREHENSIVE BAKE-OFF: ${MODELS.length} models × ${TASKS.length} tasks`);
  console.log("Each task scored 0-4. Max total per model = 16.");
  console.log("=".repeat(120));

  const matrix: Record<string, Record<string, TaskResult>> = {};
  for (const m of MODELS) matrix[m] = {};

  console.log(`\nLaunching ALL ${MODELS.length * TASKS.length} (model x task) calls in parallel...`);
  const t0 = Date.now();
  const allCalls: Array<{ m: string; t: string; p: Promise<TaskResult> }> = [];
  for (const task of TASKS) for (const m of MODELS) allCalls.push({ m, t: task.name, p: task.run(m) });
  const settled = await Promise.allSettled(allCalls.map((c) => c.p));
  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`all calls finished in ${elapsed}s`);
  settled.forEach((r, i) => {
    const { m, t } = allCalls[i];
    if (r.status === "fulfilled") matrix[m][t] = r.value;
    else matrix[m][t] = { ok: false, score: 0, maxScore: 4, completionTokens: 0, promptTokens: 0, latencyMs: 0, contentChars: 0, error: r.reason?.message || String(r.reason) };
  });

  console.log("");
  console.log("=".repeat(120));
  console.log("PER-MODEL TOTALS (sorted by composite efficiency = score / completion-tokens × 1000)");
  console.log("=".repeat(120));

  const summary = MODELS.map((m) => {
    const tasks = TASKS.map((t) => matrix[m][t.name]);
    const validTasks = tasks.filter((t) => t.ok);
    const totalScore = tasks.reduce((s, t) => s + t.score, 0);
    const totalTokens = tasks.reduce((s, t) => s + t.completionTokens, 0);
    const totalLatency = tasks.reduce((s, t) => s + t.latencyMs, 0);
    const errors = tasks.filter((t) => !t.ok).length;
    const efficiency = totalTokens > 0 ? (totalScore / totalTokens) * 1000 : 0;
    return { model: m, totalScore, totalTokens, totalLatency, errors, efficiency, perTask: tasks.map((t) => t.score) };
  }).sort((a, b) => b.efficiency - a.efficiency);

  console.log("Model".padEnd(40) + "Score".padEnd(8) + "PerTask".padEnd(14) + "CompTok".padEnd(10) + "TotLat".padEnd(10) + "Errs".padEnd(6) + "Eff");
  console.log("-".repeat(120));
  for (const s of summary) {
    console.log(
      s.model.padEnd(40) +
      `${s.totalScore}/16`.padEnd(8) +
      `[${s.perTask.join(",")}]`.padEnd(14) +
      String(s.totalTokens).padEnd(10) +
      `${(s.totalLatency / 1000).toFixed(1)}s`.padEnd(10) +
      String(s.errors).padEnd(6) +
      s.efficiency.toFixed(2)
    );
  }

  console.log("");
  console.log("=".repeat(120));
  console.log("RAW MATRIX (per-task per-model)");
  console.log("=".repeat(120));
  console.log("Model".padEnd(40) + TASKS.map((t) => `${t.name.padEnd(12)}`).join(""));
  for (const m of MODELS) {
    let row = m.padEnd(40);
    for (const t of TASKS) {
      const r = matrix[m][t.name];
      if (!r.ok) row += `ERR`.padEnd(12);
      else row += `${r.score}/${r.maxScore} ${r.completionTokens}t`.padEnd(12);
    }
    console.log(row);
  }

  console.log("");
  console.log("=".repeat(120));
  console.log("ERROR DETAILS");
  console.log("=".repeat(120));
  for (const m of MODELS) {
    for (const t of TASKS) {
      const r = matrix[m][t.name];
      if (!r.ok) console.log(`  ${m} :: ${t.name} -> ${r.error}`);
    }
  }

  console.log("");
  console.log("=".repeat(120));
  console.log("VERDICT — Ling-2.6-1T position");
  console.log("=".repeat(120));
  const ling = summary.find((s) => s.model === "inclusionai/ling-2.6-1t:free");
  const lingFlash = summary.find((s) => s.model === "inclusionai/ling-2.6-flash");
  if (ling) {
    const lingRank = summary.indexOf(ling) + 1;
    console.log(`  Ling-2.6-1T  rank: #${lingRank} of ${summary.length} by efficiency`);
    console.log(`  Ling-2.6-1T  score: ${ling.totalScore}/16 in ${ling.totalTokens} completion tokens (${(ling.totalLatency / 1000).toFixed(1)}s total)`);
  }
  if (lingFlash) {
    const flashRank = summary.indexOf(lingFlash) + 1;
    console.log(`  Ling-Flash   rank: #${flashRank} of ${summary.length} by efficiency`);
    console.log(`  Ling-Flash   score: ${lingFlash.totalScore}/16 in ${lingFlash.totalTokens} completion tokens (${(lingFlash.totalLatency / 1000).toFixed(1)}s total)`);
  }
  const top = summary[0];
  console.log(`  Top by efficiency: ${top.model}  (${top.totalScore}/16 in ${top.totalTokens} tokens)`);
  const bestQuality = [...summary].sort((a, b) => b.totalScore - a.totalScore)[0];
  console.log(`  Top by quality:    ${bestQuality.model}  (${bestQuality.totalScore}/16, ${bestQuality.totalTokens} tokens)`);
})();
