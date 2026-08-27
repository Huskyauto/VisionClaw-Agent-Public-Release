# Barry Zhang (Anthropic) — Building Effective Agents

**Source:** Perplexity-summarized seminar, Barry Zhang, Anthropic — companion to Anthropic's blog post _Building Effective Agents_ (anthropic.com/research/building-effective-agents).
**Captured:** 2026-05-11
**Audience:** Engineers and product owners deciding when to ship an agent vs a workflow, and how to debug the ones they do ship.

This document is a practical playbook, not theory. Every section is meant to be actionable when you're staring at a blank `tools.ts` or wondering whether the thing you're about to build should be an agent at all.

---

## TL;DR — The Three Principles

1. **Don't build agents for everything.** If a workflow or single LLM call works, ship that. Agents add latency, cost, and failure modes — pay that price only when the task is ambiguous, high-value, and the search space is too big to enumerate.
2. **Keep it simple.** Every agent reduces to **model + tools + environment**, glued by a system prompt. Reuse one backbone, swap prompts and tools per use case. Resist multi-agent setups, fancy planners, and frameworks until one simple agent works reliably end-to-end.
3. **Think like your agent.** Mentally restrict yourself to the agent's context window and the tool results it has actually seen. Most "the model is dumb" failures are actually "we didn't give it the information" failures. Your logs are the proof.

These rules came out of Anthropic shipping real agents (research, computer-use, code) and watching the failure patterns repeat.

---

## 1. Introduction — Why This Talk Exists

Barry Zhang opens by noting that the gap between an impressive agent demo and a reliable production agent is enormous, and most teams underestimate it. The talk distills Anthropic's experience into three principles that are deliberately blunt — they're the rules Barry wishes someone had given him before he built his first three agents.

The talk expands the company's _Building Effective Agents_ post (Schluntz & Zhang, Dec 2024) with deployment lessons: where teams over-engineer, where they under-instrument, and how to debug an agent that "works" in the demo and quietly fails in production.

---

## 2. What Is an AI Agent?

### Working definition

> **An agent starts with a user goal, plans steps, and acts autonomously using tools and feedback from its environment until a stopping condition is met.**

The two qualifiers that distinguish an agent from a "smart LLM call":

- **Autonomous trajectory.** The agent — not the developer — decides which tools to call, in what order, when to ask the user, and when to stop.
- **Feedback loop with the environment.** Each action produces an observation that conditions the next action.

A pure LLM call (even a sophisticated one with retrieval and post-processing) is not an agent. A pre-mapped pipeline of LLM calls is a **workflow**, not an agent. Both are often the right answer.

### Spectrum, not a binary

```
Single LLM call → Pipeline / Workflow → Tool-using LLM → Agent → Multi-agent system
                                                         ↑
                                                  This is where most teams
                                                  should stop until proven need.
```

### Example use cases that justify an agent

- **Research assistant** — searches the web, drafts a report, runs code or stat checks against the draft, loops until quality criteria are met.
- **Computer-use agent** — clicks through a browser, fills forms, downloads reports, adapts to changing pages.
- **Code agent** — reads a repo, makes a plan, edits files, runs tests, fixes regressions.

### Use cases that should NOT be agents

- A chatbot that answers FAQs from a knowledge base. (RAG + single LLM call.)
- A nightly ETL job. (Workflow with a typed pipeline.)
- "Generate a product description for this SKU." (Single LLM call.)

---

## 3. Principle 1 — Don't Build Agents For Everything

### 3.1 The default should be "no agent"

Barry's first rule, stated bluntly: **if a simple workflow or single LLM call can do the job, you should not build an agent.** The cost of agentic behavior is real:

| Cost | Why it bites |
|---|---|
| **Latency** | Each turn is another model round-trip and tool call. Workflows are 1-2 calls; agents are 5-30. |
| **$$** | Output tokens compound — agents re-read their own scratchpad on every iteration. |
| **Debuggability** | A failed pipeline gives you a stack trace. A failed agent gives you a transcript you have to read. |
| **Failure modes** | Agents can get stuck in loops, drift off-task, or take destructive actions if tool design is loose. |
| **Eval surface** | You can unit-test a workflow. You evaluate an agent against trajectories — much harder. |

### 3.2 The five questions to ask before reaching for an agent

Use this as a literal checklist:

1. **Is the task ambiguous?** Are there too many possible execution paths to enumerate manually? If you can draw the flowchart in 10 minutes, build the flowchart.
2. **Is the task high-value?** The outcome must justify the engineering, compute, and ongoing eval cost. "Save 30 seconds on a low-stakes step" doesn't qualify.
3. **Are the critical capabilities present?** Can the model actually read the inputs, reason about them, call the tools reliably, and recover from errors? If any of these is shaky, your agent will be shakier.
4. **Do you understand the cost of failure?** What's the worst thing the agent can do if it goes off-rails? Send a $10k wire? Email the wrong customer? Delete a row? You need guardrails proportional to the blast radius.
5. **Do you have the observability to debug it later?** If you can't see what the agent saw and what it did, you can't fix it.

If you answer "no" to any of 1, 2, 3, or "I don't know" to 4 or 5 — don't build an agent yet.

### 3.3 Concrete examples

**Good agent candidate:**

> "Given these 20 PDFs, extract every marketing claim, verify each on the web, and propose a compliant campaign for our next product launch."

- Ambiguous (which claims are material? which sources count as verification?)
- High value (regulatory exposure)
- Multiple tools needed (RAG, web search, policy checker, drafting)
- Search space is huge → agent.

**Bad agent candidate (do this as a workflow):**

> "Every Monday at 8am, pull last week's invoices from Stripe, summarize the top 5 customers by revenue, and email me a one-paragraph summary."

- Pre-mappable, deterministic, low ambiguity → cron + Stripe API + one LLM call. No agent needed.

---

## 4. Principle 2 — Keep It Simple

> Every agent is just **model + tools + environment**, with a **system prompt** that glues them together.

That's it. There is no framework you must adopt. There is no orchestrator you must install. The complexity you add beyond this is on you to justify.

### 4.1 The four core components

**Model**
The LLM that reasons, plans, and chooses the next action. Pick one good frontier model and stick with it until you've proven the agent works. Do not start by routing across three providers.

**Tools**
Functions the model can invoke. Each tool is:
- A typed JSON schema describing its arguments
- A description telling the model when to use it
- An implementation that does the work and returns a typed result
Tools should be **few, sharp, and orthogonal**. 8 well-designed tools beats 40 overlapping ones.

**Environment**
The external system the agent acts on — files, browser, CRM, OS, your own DB. The environment determines what observations the agent gets back from each tool call.

**System prompt**
The contract. Tells the agent its goal, its constraints, what tools it has, when to ask the user, when to stop, and how to report progress.

### 4.2 The minimum viable agent loop

```
loop:
  response = model.call(history + system_prompt + tool_schemas)
  if response is text:
    return response       # agent decided it's done
  if response is tool_call:
    result = run_tool(response)
    history.append(result)
  if iterations > MAX:
    abort
```

That's the entire pattern. Everything else is decoration.

### 4.3 Best practices Barry calls out

- **Reuse the same backbone across many use cases.** Swap prompts and tools rather than rewriting the loop. One generic `runAgent()` function should serve research agents, support agents, and code agents.
- **Avoid premature complexity.** No multi-agent setup, no planner, no separate critic until your single-agent version works for 80% of cases.
- **Add observability from day one.** Log every tool call, every tool result, every model thought, and the token count of the visible context. You cannot debug what you cannot see.
- **Cap iterations early.** Set `MAX_ITERATIONS` low (e.g. 10) at first. If the agent needs more, that's a signal — usually missing context or a missing tool, not a real need for more turns.
- **Fail loudly.** If a tool can't run, return a structured error to the model. Don't return `null` or `""` — the model will treat silence as success and hallucinate the next step.

---

## 5. Principle 3 — Think Like Your Agent

This is the part most teams skip and then pay for in production.

### 5.1 The "context window" mindset

When you debug an agent, you bring your full world knowledge — the codebase, the customer, the goal of the feature. The agent has none of that. It has only what's in its current context window.

**The mental drill:**

> Sit down with a printout of the agent's full context at the moment of failure (system prompt + every message + every tool result). Ask yourself: with only this information, would I have made the right next decision?

Almost always, the answer is no — and the fix is "give it more / better information," not "use a smarter model."

### 5.2 Why most "the model is dumb" failures are really context failures

Common patterns that masquerade as model failures:

- The relevant fact was in the system prompt 8000 tokens ago and got lost in the haystack.
- The tool returned data in a format the model can't parse (e.g. raw HTML instead of structured JSON).
- The screenshot was captured before the modal opened, so the button the agent needed isn't visible.
- The agent doesn't know whether the previous action succeeded because the tool returned `200 OK` with no body.
- Two tools have nearly identical descriptions, so the model picks the wrong one.

Fix the input, not the model.

### 5.3 Computer-use as the canonical example

Barry uses Anthropic's computer-use agent as the case study. The agent sees only screenshots and short instructions. Common failures:

- **Missing UI state** — a tooltip didn't appear in time and isn't in the screenshot.
- **Ambiguous instructions** — "open the report" with three identically-named links.
- **No action confirmation** — the click happened but no observation tells the agent whether the page changed.

The fixes are not "use a bigger model" — they are:

- Provide structured DOM state alongside images so the agent has an alternative grounding signal.
- Encode explicit retry rules and confirmation patterns in the prompt ("after every click, take a new screenshot and verify the expected text is present").
- Add a "ask the user" tool the agent can invoke when confidence is low.

### 5.4 The debug ritual

When an agent fails:

1. **Pull the full transcript** — system prompt, every user/assistant turn, every tool call, every tool result.
2. **Find the inflection point** — the first turn where the agent went off-rails.
3. **Read only the context up to that turn**, ignoring everything you know about the codebase or the user goal.
4. **Decide what you would have done** with only that information.
5. If you would have done the same wrong thing → the input was bad. Fix the prompt, the tool description, or the tool result format.
6. If you would have done the right thing → it's a real model failure. Add an example to the prompt or use a stronger model for that subtask.

You will be shocked how often step 5 wins.

---

## 6. Iteration, Safety, and Future Directions

### 6.1 Autonomy demands monitoring

The more autonomy you give an agent, the more you must invest in:

- **Stopping conditions** — explicit, multiple, fail-safe. Iteration cap, budget cap, time cap, "ask the user" cap.
- **Human checkpoints** — a HITL approval gate before any destructive or irreversible action (send email, charge card, delete row, push commit).
- **Telemetry** — per-step structured logs you can grep months later when something blows up.
- **Replay tools** — the ability to load a past trajectory and step through it offline.

### 6.2 What's coming next

- **Meta-tools** — agents that refine their own tool schemas, write their own helper scripts, or generate prompts for sub-agents.
- **Multi-agent setups** — one planner, several specialized executors, one verifier. Use this only after a single-agent version is reliable. (Barry is explicit: most multi-agent designs in 2024-2025 were premature.)
- **Self-improving agents** — agents that emit candidate skills/tools to a review queue (human-approved) so the system gets better over time.

### 6.3 The safety mindset

Two rules Barry implies repeatedly:

1. **Default-deny destructive actions.** A tool that moves money / deletes data / sends mass comms requires explicit policy, dollar caps, and approval — not a polite system-prompt request.
2. **Fail closed on safety, fail open on observability.** If the safety check breaks, refuse the action. If the logging breaks, still let the agent run but loudly alert. The opposite is the catastrophic order.

---

## 7. TypeScript Code Ideas

These are not transcripts — they are practical TypeScript skeletons that follow the talk's principles and align with Anthropic's tool-use API. Use them as starting points, not as final code.

### 7.1 Minimal type definitions — model + tools + environment

```ts
// Core building blocks — explicit so reuse is forced.

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  toolUseId: string;
  name: string;
  result: unknown;
  success: boolean;
  error?: string;
};

export type AgentEnvironment = {
  userId: string;
  workspaceRoot: string;
  // Any domain-specific shared state — DB handle, HTTP client, brand config, etc.
};

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON schema
  run: (args: any, env: AgentEnvironment) => Promise<ToolResult>;
};

export type AgentConfig = {
  name: string;
  systemPrompt: string;
  maxIterations: number;
  maxBudgetUsd: number;          // hard cap; agent aborts if exceeded
  maxWallClockSeconds: number;   // hard cap; agent aborts if exceeded
  tools: Record<string, ToolDef>;
  hitlGate?: (call: ToolCall) => Promise<boolean>; // human approval for destructive tools
};
```

The point: `model + tools + environment` is not a slogan, it's the type system.

### 7.2 The minimum viable agent loop

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function runAgent(
  config: AgentConfig,
  env: AgentEnvironment,
  userGoal: string,
): Promise<{ done: boolean; output: string; trace: AgentTrace }> {
  const trace: AgentTrace = { steps: [], totalUsd: 0, abortedReason: null };
  const startedAt = Date.now();

  const messages: any[] = [{ role: "user", content: userGoal }];

  for (let i = 0; i < config.maxIterations; i++) {
    // Hard caps — fail loudly, not silently.
    if (trace.totalUsd > config.maxBudgetUsd) {
      trace.abortedReason = "budget_exceeded";
      return { done: false, output: "Aborted: budget exceeded.", trace };
    }
    if ((Date.now() - startedAt) / 1000 > config.maxWallClockSeconds) {
      trace.abortedReason = "wallclock_exceeded";
      return { done: false, output: "Aborted: wall-clock exceeded.", trace };
    }

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system: config.systemPrompt,
      messages,
      tools: Object.values(config.tools).map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as any,
      })),
    });

    trace.totalUsd += estimateCost(response);
    trace.steps.push({ iteration: i, response });

    // If model returned plain text only → it's done.
    const textBlocks = response.content.filter((b) => b.type === "text");
    const toolBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolBlocks.length === 0) {
      const finalText = textBlocks.map((b: any) => b.text).join("\n");
      return { done: true, output: finalText, trace };
    }

    // Execute every tool call from this turn.
    messages.push({ role: "assistant", content: response.content });
    const toolResults = [];
    for (const block of toolBlocks as any[]) {
      const tool = config.tools[block.name];
      if (!tool) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `ERROR: unknown tool "${block.name}"`,
          is_error: true,
        });
        continue;
      }

      // HITL gate for destructive tools.
      if (config.hitlGate && (await config.hitlGate({ id: block.id, name: block.name, arguments: block.input })) !== true) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `ERROR: human declined "${block.name}"`,
          is_error: true,
        });
        continue;
      }

      try {
        const result = await tool.run(block.input, env);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result.result),
          is_error: !result.success,
        });
      } catch (err: any) {
        // FAIL LOUD — tell the model exactly what broke so it can recover.
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `ERROR: tool "${block.name}" threw: ${err?.message ?? String(err)}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  trace.abortedReason = "max_iterations";
  return { done: false, output: "Aborted: max iterations reached.", trace };
}

type AgentTrace = {
  steps: Array<{ iteration: number; response: any }>;
  totalUsd: number;
  abortedReason: null | "budget_exceeded" | "wallclock_exceeded" | "max_iterations";
};

function estimateCost(_resp: any): number {
  // Plug in your own cost calculator using usage tokens.
  return 0;
}
```

Design notes that mirror the talk:

- **Loop is dead simple** — model → tool calls → tool results → repeat.
- **Three hard stops** — iteration, budget, wall-clock. Always.
- **Tool errors return loud structured strings** — never silent nulls.
- **HITL gate is opt-in per tool** — destructive actions can never run unattended.
- **Trace is captured by default** — debugging is impossible without it.

### 7.3 Workflow vs. agent — the same task two ways

**Workflow (no agent) — pre-mapped, deterministic.**

```ts
// Good for predictable, linear tasks.
async function summarizeInvoices(csv: string): Promise<string> {
  const rows = parseCsv(csv);
  const valid = rows.filter(isValidInvoice);

  const summary = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 512,
    messages: [
      { role: "user", content: `Summarize these invoices in one paragraph:\n${JSON.stringify(valid)}` },
    ],
  });

  return summary.content[0].type === "text" ? summary.content[0].text : "";
}
```

**Agent — open-ended, ambiguous research task.**

```ts
const researchAgent: AgentConfig = {
  name: "marketing_researcher",
  systemPrompt: `
You are a careful market-research agent.

Goals:
- Use the provided tools to search the web and read documents.
- Verify every factual claim against at least 2 independent sources.
- If the user goal is ambiguous, call ask_user with a sharp clarifying question BEFORE doing more research.
- Stop when you have a concise cited summary AND a list of risks.

Constraints:
- Do not invoke web_search more than 8 times total.
- Do not return a final answer without citing your sources inline.
- If a tool returns an error, retry once. If it fails again, surface the error to the user — do not invent the data.
`.trim(),
  maxIterations: 12,
  maxBudgetUsd: 1.5,
  maxWallClockSeconds: 180,
  tools: {
    web_search: {
      name: "web_search",
      description: "Search the web for a query. Returns a list of {title, url, snippet}.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      run: async (args, _env) => {
        const results = await searchWebApi(String(args.query));
        return { toolUseId: "", name: "web_search", result: results, success: true };
      },
    },
    read_document: {
      name: "read_document",
      description: "Read a local document by path relative to the workspace root.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      run: async (args, env) => {
        const full = `${env.workspaceRoot}/${String(args.path)}`;
        const content = await fs.promises.readFile(full, "utf8");
        return { toolUseId: "", name: "read_document", result: content, success: true };
      },
    },
    ask_user: {
      name: "ask_user",
      description: "Ask the user a clarifying question. Use only when the goal is ambiguous.",
      inputSchema: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
      run: async (args, _env) => {
        const answer = await promptHuman(String(args.question));
        return { toolUseId: "", name: "ask_user", result: answer, success: true };
      },
    },
  },
};
```

The shape is the same; the difference is autonomy and stopping criteria.

### 7.4 "Think like your agent" — debugging helper

```ts
type AgentMessageRow = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  approxTokens: number;
};

export function printAgentPerspective(history: AgentMessageRow[], stopAtIteration: number): void {
  console.log("┌─────────────────────────────────────────────────");
  console.log(`│ Agent perspective at iteration ${stopAtIteration}`);
  console.log(`│ Total visible tokens: ${history.reduce((s, r) => s + r.approxTokens, 0)}`);
  console.log("├─────────────────────────────────────────────────");
  for (const row of history) {
    const head = `[${row.role.padEnd(9)}] (${row.approxTokens} tok)`;
    console.log(`│ ${head}`);
    for (const line of row.content.split("\n")) console.log(`│   ${line}`);
    console.log("├─────────────────────────────────────────────────");
  }
  console.log("└─────────────────────────────────────────────────");
  console.log(`Question: with ONLY the above information, what's the right next action?`);
}
```

The point isn't the formatting — it's the ritual. Print the agent's view, ignore your privileged knowledge, and decide what you would do.

### 7.5 Tool design — the four checks before you ship a tool

```ts
/**
 * Before adding a tool, every "yes" below is mandatory.
 *
 * 1. Sharp scope — does this tool do ONE thing the model can recognize?
 *    BAD:  manage_calendar(action, args)   // 8 sub-actions in one tool
 *    GOOD: list_events, create_event, delete_event   // three orthogonal tools
 *
 * 2. Self-describing result — can the model understand the output without
 *    extra context? Return structured JSON with named fields. Never raw HTML
 *    or unlabeled tuples.
 *
 * 3. Loud failures — on error, return is_error=true with a one-sentence
 *    human-readable reason. Never return empty string, null, or "ok".
 *
 * 4. Idempotency or explicit warning — destructive tools must declare it
 *    in the description AND require HITL gate. Read-only tools should be
 *    marked safe so they can be retried freely.
 */
export function assertGoodToolDef(t: ToolDef): void {
  if (!t.description || t.description.length < 30) {
    throw new Error(`Tool ${t.name}: description too thin (${t.description?.length ?? 0} chars)`);
  }
  if (!("type" in t.inputSchema) || t.inputSchema.type !== "object") {
    throw new Error(`Tool ${t.name}: input schema must be an object schema`);
  }
  if (typeof t.run !== "function") {
    throw new Error(`Tool ${t.name}: run() must be implemented`);
  }
}
```

### 7.6 Stopping conditions — the trio you always need

```ts
export type StopReason = "goal_met" | "iter_cap" | "budget_cap" | "wallclock_cap" | "hitl_decline" | "tool_repeated_failure";

export class StopController {
  constructor(
    private readonly maxIter: number,
    private readonly maxUsd: number,
    private readonly maxSeconds: number,
  ) {}
  private startedAt = Date.now();
  private spentUsd = 0;
  private iter = 0;
  private repeatedFailures = 0;

  tick(spentDeltaUsd: number, lastWasFailure: boolean): StopReason | null {
    this.iter += 1;
    this.spentUsd += spentDeltaUsd;
    this.repeatedFailures = lastWasFailure ? this.repeatedFailures + 1 : 0;

    if (this.iter >= this.maxIter) return "iter_cap";
    if (this.spentUsd >= this.maxUsd) return "budget_cap";
    if ((Date.now() - this.startedAt) / 1000 >= this.maxSeconds) return "wallclock_cap";
    if (this.repeatedFailures >= 3) return "tool_repeated_failure";
    return null;
  }
}
```

The "3 repeated failures → stop" rule echoes a pattern from Anthropic's own deployments and from VisionClaw's `replit.md` 2-failed-corrections rule (R110.12). Past 2-3 attempts at the same fix, fresh context beats more iterations.

### 7.7 HITL gate — the safety pattern for destructive tools

```ts
type DestructivePolicy = "always_ask" | "ask_above_dollar" | "auto_with_audit";

export function makeHitlGate(policy: DestructivePolicy, dollarCap: number = 0) {
  return async (call: ToolCall): Promise<boolean> => {
    const isDestructive = DESTRUCTIVE_TOOLS.has(call.name);
    if (!isDestructive) return true;

    if (policy === "auto_with_audit") {
      await auditLog("destructive_tool_auto", { call });
      return true;
    }
    if (policy === "ask_above_dollar") {
      const cost = estimateDollarImpact(call);
      if (cost <= dollarCap) {
        await auditLog("destructive_tool_under_cap", { call, cost });
        return true;
      }
    }
    // always_ask, or above_dollar over the cap
    return promptHumanForApproval(call);
  };
}

const DESTRUCTIVE_TOOLS = new Set(["send_email", "charge_card", "delete_row", "push_commit", "transfer_funds"]);
```

This is the engineering version of "default-deny destructive actions."

### 7.8 Trajectory eval — how you actually grade an agent

```ts
type GoldenTrajectory = {
  goal: string;
  expectedToolCallsInOrder: string[];     // the canonical happy path
  expectedFinalContains: string[];         // substrings that must appear
  forbiddenToolCalls: string[];            // tools that must NOT be used
  maxIterations: number;
};

export async function evalAgent(config: AgentConfig, env: AgentEnvironment, golden: GoldenTrajectory) {
  const result = await runAgent({ ...config, maxIterations: golden.maxIterations }, env, golden.goal);
  const toolNames = result.trace.steps
    .flatMap((s: any) => s.response.content)
    .filter((b: any) => b.type === "tool_use")
    .map((b: any) => b.name);

  const findings: string[] = [];

  for (const forbidden of golden.forbiddenToolCalls) {
    if (toolNames.includes(forbidden)) findings.push(`forbidden tool used: ${forbidden}`);
  }
  for (const expected of golden.expectedFinalContains) {
    if (!result.output.includes(expected)) findings.push(`final output missing: "${expected}"`);
  }
  // Loose ordering check — the expected calls must appear in order, but extras are OK.
  let cursor = 0;
  for (const want of golden.expectedToolCallsInOrder) {
    const idx = toolNames.indexOf(want, cursor);
    if (idx === -1) findings.push(`expected tool call missing or out-of-order: ${want}`);
    else cursor = idx + 1;
  }

  return { passed: findings.length === 0, findings, trace: result.trace };
}
```

You eval agents on **trajectories**, not single inputs/outputs. The talk pushes hard on this.

---

## 8. Applying This — A Decision Worksheet

Use this before you write a single line of agent code.

```
[ ] What is the user goal in one sentence?
[ ] Can I draw the full execution flowchart in 10 minutes?       → If yes, build a workflow.
[ ] What is the dollar value of one successful run?              → If <$10, probably not worth an agent.
[ ] What is the worst single action the agent could take?        → That action needs a HITL gate.
[ ] Which 3-8 tools does it absolutely need?                     → Anything beyond 8 → cut or merge.
[ ] What are the hard caps? iter / budget / wall-clock?          → All three required.
[ ] What does "done" look like?                                  → If you can't write the stop rule, you don't have an agent yet.
[ ] How will I see what the agent saw when it fails?             → No logs = no agent.
[ ] What's the rollback plan if the agent does damage?           → No rollback = HITL gate must be tighter.
```

If you can answer all nine, build it. Otherwise, do the workflow first and earn the right to upgrade to an agent.

---

## 9. Anti-Patterns From the Field

Patterns Barry implicitly or explicitly warns against:

- **Multi-agent before single-agent works.** Coordination overhead is brutal; you'll spend more time debugging the choreography than the agents.
- **Reaching for a framework on day one.** Most agent frameworks lock you into their abstractions before you understand your own problem.
- **Tool sprawl.** 40 tools with overlapping descriptions is worse than 8 sharp ones. The model's tool-selection accuracy degrades with the number of choices.
- **Silent tool failures.** Returning `null` or `""` on error makes the agent hallucinate the next step. Always return loud structured errors.
- **Unbounded loops.** "Just let it run" is how you discover what a runaway costs at 3am.
- **No HITL on destructive tools.** "It's just an email tool" is exactly how you spam your customer base with a half-finished draft.
- **Debugging the model instead of the input.** "Smarter model" is rarely the answer. Better context almost always is.
- **Eval by single-shot output.** Grade the trajectory; the final string hides the loops, retries, and tool misuse along the way.

---

## 10. How This Maps to VisionClaw

The talk's three principles already show up in VisionClaw conventions — this is a useful cross-check:

| Talk principle | VCA equivalent |
|---|---|
| Don't build agents for everything | Default to `ensemble_query` for thinking; only spin up async subagents for genuinely open-ended work (replit.md Orchestration). |
| Keep it simple — model + tools + environment | Tools live in `server/tools.ts`, env in storage/personas, prompts in `server/seed-persona-prompts.ts`. Same backbone, different prompts. |
| Think like your agent | The new `critique` skill (R110.12) and the silent-failure-hunter skill both encode "look at what the agent actually saw." |
| Stopping conditions | 2-failed-corrections rule, subagent timeout, chunk-and-parallel for >5min jobs. |
| Loud failures | Drilled into VCA via R110.7 → R110.11.7 silent-failure burn-down. |
| HITL on destructive tools | `server/safety/destructive-tool-policy.ts` + intent gate. |
| Trajectory eval | `Golden Path Replay` workflow + `tests/security/ahb-regression.test.ts`. |

The talk is not new to VCA — but it's a clean, externally-attested articulation of the same principles, and a good one to hand to anyone joining the project.

---

## 11. Source & Credits

- **Speaker:** Barry Zhang, Anthropic.
- **Companion blog post:** _Building Effective Agents_ — Erik Schluntz & Barry Zhang, Anthropic, Dec 2024 (anthropic.com/research/building-effective-agents).
- **Capture method:** Perplexity-summarized seminar transcript, organized and expanded with TypeScript skeletons that align with Anthropic's tool-use API and the spirit of the talk.
- **Captured into VisionClaw repo:** 2026-05-11.

The TypeScript code in §7 is **not** lifted verbatim from the talk — it is illustrative, written to match the talk's design principles and Anthropic's published tool-use API shape. Use as starting points; do not paste-and-ship without your own type-checks and test coverage.
