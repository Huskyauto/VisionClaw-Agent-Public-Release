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

const SYSTEM_PROMPT =
  "You are an execution-focused agent. Use tools to complete the user's request. " +
  "Be concise. Do not narrate your reasoning unless asked. Make the tool calls and finish.";

const USER_TASK =
  "A new customer named Sarah Mitchell just signed up at sarah.mitchell@acme.example. " +
  "Send her a brief friendly welcome email, then schedule a 7-day follow-up reminder " +
  "to check in about her onboarding progress. The current date is 2026-05-02.";

const TOOLS: any[] = [
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Send an email to a recipient.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["to", "subject", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_reminder",
      description: "Schedule a reminder for a future date.",
      parameters: {
        type: "object",
        properties: {
          when: { type: "string", description: "ISO 8601 date/time" },
          note: { type: "string", description: "What to remind about" },
        },
        required: ["when", "note"],
      },
    },
  },
];

interface RunResult {
  model: string;
  ok: boolean;
  emailCalled: boolean;
  reminderCalled: boolean;
  emailToCorrect: boolean;
  reminderDateRoughlyCorrect: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  contentChars: number;
  latencyMs: number;
  error?: string;
  rawContentPreview?: string;
}

async function runOne(model: string): Promise<RunResult> {
  const t0 = Date.now();
  try {
    const resp = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: USER_TASK },
      ],
      tools: TOOLS,
      tool_choice: "auto",
    });
    const ms = Date.now() - t0;
    const choice = resp.choices?.[0];
    const msg: any = choice?.message;
    const toolCalls = msg?.tool_calls || [];
    const content = msg?.content || "";

    const emailCall = toolCalls.find((t: any) => t.function?.name === "send_email");
    const reminderCall = toolCalls.find((t: any) => t.function?.name === "schedule_reminder");

    let emailToCorrect = false;
    if (emailCall) {
      try {
        const args = JSON.parse(emailCall.function.arguments);
        emailToCorrect = (args.to || "").toLowerCase().includes("sarah.mitchell@acme.example");
      } catch {}
    }
    let reminderDateRoughlyCorrect = false;
    if (reminderCall) {
      try {
        const args = JSON.parse(reminderCall.function.arguments);
        const w = String(args.when || "");
        reminderDateRoughlyCorrect = w.includes("2026-05-09") || w.includes("2026-05-08") || w.includes("2026-05-10");
      } catch {}
    }

    return {
      model,
      ok: true,
      emailCalled: !!emailCall,
      reminderCalled: !!reminderCall,
      emailToCorrect,
      reminderDateRoughlyCorrect,
      promptTokens: resp.usage?.prompt_tokens ?? -1,
      completionTokens: resp.usage?.completion_tokens ?? -1,
      totalTokens: resp.usage?.total_tokens ?? -1,
      contentChars: content.length,
      latencyMs: ms,
      rawContentPreview: content.slice(0, 200),
    };
  } catch (e: any) {
    return {
      model,
      ok: false,
      emailCalled: false,
      reminderCalled: false,
      emailToCorrect: false,
      reminderDateRoughlyCorrect: false,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      contentChars: 0,
      latencyMs: Date.now() - t0,
      error: e?.message || String(e),
    };
  }
}

const MODELS = [
  "inclusionai/ling-2.6-1t:free",
  "inclusionai/ling-2.6-flash",
  "openai/gpt-5-mini",
  "deepseek/deepseek-v4-flash",
  "x-ai/grok-4.1-fast",
];

(async () => {
  console.log("BENCHMARK: Ling-2.6 vs efficient defaults");
  console.log(`Task: 2 sequential tool calls (send_email + schedule_reminder)`);
  console.log("=".repeat(110));
  const results: RunResult[] = [];
  for (const m of MODELS) {
    process.stdout.write(`Running ${m.padEnd(40)} ... `);
    const r = await runOne(m);
    results.push(r);
    if (r.ok) {
      const score = (r.emailCalled ? 1 : 0) + (r.reminderCalled ? 1 : 0) + (r.emailToCorrect ? 1 : 0) + (r.reminderDateRoughlyCorrect ? 1 : 0);
      console.log(`done (${r.latencyMs}ms, ${r.completionTokens} compl tokens, score ${score}/4)`);
    } else {
      console.log(`ERROR: ${r.error}`);
    }
  }
  console.log("");
  console.log("=".repeat(110));
  console.log("RESULTS TABLE");
  console.log("=".repeat(110));
  console.log("Model".padEnd(38) + "Latency".padEnd(10) + "InTok".padEnd(8) + "OutTok".padEnd(8) + "Chars".padEnd(8) + "Email".padEnd(7) + "Rmdr".padEnd(6) + "ToOK".padEnd(6) + "WhenOK".padEnd(8) + "Score");
  console.log("-".repeat(110));
  for (const r of results) {
    const score = (r.emailCalled ? 1 : 0) + (r.reminderCalled ? 1 : 0) + (r.emailToCorrect ? 1 : 0) + (r.reminderDateRoughlyCorrect ? 1 : 0);
    console.log(
      r.model.padEnd(38) +
        `${r.latencyMs}ms`.padEnd(10) +
        String(r.promptTokens).padEnd(8) +
        String(r.completionTokens).padEnd(8) +
        String(r.contentChars).padEnd(8) +
        (r.emailCalled ? "Y" : "N").padEnd(7) +
        (r.reminderCalled ? "Y" : "N").padEnd(6) +
        (r.emailToCorrect ? "Y" : "N").padEnd(6) +
        (r.reminderDateRoughlyCorrect ? "Y" : "N").padEnd(8) +
        `${score}/4`
    );
  }
  console.log("");
  console.log("=".repeat(110));
  console.log("USEFUL INTELLIGENCE PER TOKEN (score/completion-tokens × 1000)");
  console.log("=".repeat(110));
  const efficiencies = results
    .filter((r) => r.ok && r.completionTokens > 0)
    .map((r) => {
      const score = (r.emailCalled ? 1 : 0) + (r.reminderCalled ? 1 : 0) + (r.emailToCorrect ? 1 : 0) + (r.reminderDateRoughlyCorrect ? 1 : 0);
      return { model: r.model, score, completionTokens: r.completionTokens, efficiency: (score / r.completionTokens) * 1000, contentChars: r.contentChars };
    })
    .sort((a, b) => b.efficiency - a.efficiency);
  for (const e of efficiencies) {
    console.log(`  ${e.model.padEnd(38)} ${e.efficiency.toFixed(2).padStart(8)}  (score ${e.score}/4 in ${e.completionTokens} tokens / ${e.contentChars} chars)`);
  }
  console.log("");
  console.log("=".repeat(110));
  console.log("RAW CONTENT PREVIEWS (does the model narrate vs execute?)");
  console.log("=".repeat(110));
  for (const r of results.filter((x) => x.ok)) {
    console.log(`\n[${r.model}] (${r.contentChars} chars of prose)`);
    console.log(`  "${r.rawContentPreview || "(empty — pure tool calls, ideal)"}"`);
  }
})();
