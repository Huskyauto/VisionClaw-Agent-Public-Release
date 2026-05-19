/**
 * Orchestrator Ledger — R73 (Apr 2026)
 *
 * Multi-agent loop orchestrator modelled on Microsoft AutoGen's Magentic-One
 * pattern (https://github.com/microsoft/autogen). Three pieces:
 *
 *   1. FACTS LEDGER  — what's GIVEN, what to LOOK UP, what to DERIVE,
 *                       what's an EDUCATED GUESS (forces epistemic discipline)
 *   2. PLAN LEDGER   — bullet-point plan, no agents forced to participate
 *   3. PROGRESS LEDGER — per-turn structured JSON with five questions:
 *        is_request_satisfied | is_in_loop | is_progress_being_made
 *        | next_speaker | instruction_or_question
 *
 * Plus declarative TerminationCondition primitives (MaxTurns, MaxStalls,
 * TextMention, MaxTokens, Functional, Composite) and a stall-recovery loop
 * that regenerates facts + plan when n_stalls hits max.
 *
 * This module is intentionally pure: it imports a model client and a tiny
 * persistence helper, nothing else from the wider app. Designed to be wired
 * into heartbeat, crews-engine, debate-engine, minerva-planner, felix-brain
 * one consumer at a time.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { replitOpenai } from "./providers";
import { createHash } from "crypto";

import { logSilentCatch } from "./lib/silent-catch";
/**
 * Stable 60-bit Postgres advisory lock key derived from (ledgerKey, tenantId).
 * Postgres pg_advisory_xact_lock takes int8, so we keep the high bit clear by
 * slicing 15 hex chars (60 bits).
 */
function ledgerLockKey(ledgerKey: string, tenantId: number): string {
  const hex = createHash("sha1").update(`${ledgerKey}:${tenantId}`).digest("hex").slice(0, 15);
  return BigInt("0x" + hex).toString();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  is_request_satisfied:    { reason: string; answer: boolean };
  is_in_loop:              { reason: string; answer: boolean };
  is_progress_being_made:  { reason: string; answer: boolean };
  next_speaker:            { reason: string; answer: string };
  instruction_or_question: { reason: string; answer: string };
}

export interface TeamMember {
  name: string;
  description: string;
  /** Called when this member is selected. Receives the orchestrator's instruction. */
  handler: (instruction: string, ctx: TurnContext) => Promise<string>;
}

export interface TurnContext {
  task: string;
  facts: string;
  plan: string;
  history: TurnRecord[];
  turn: number;
}

export interface TurnRecord {
  speaker: string;
  instruction: string;
  response: string;
  ledger?: LedgerEntry;
  durationMs: number;
}

export interface RunState {
  task: string;
  facts: string;
  plan: string;
  nRounds: number;
  nStalls: number;
  history: TurnRecord[];
  tokenUsage: { prompt: number; completion: number };
  team: { name: string; description: string }[];
}

export interface LedgerRunOptions {
  task: string;
  team: TeamMember[];
  /** Stop after this many turns. Default 20. */
  maxTurns?: number;
  /** Regenerate facts+plan after this many consecutive stalls. Default 3. */
  maxStalls?: number;
  /** Hard cap on facts+plan regeneration cycles. Once exceeded the loop
   *  terminates instead of looping forever on a chronically stuck team.
   *  Default 2 (Magentic-One paper recommends 1–2). */
  maxRegenerates?: number;
  /** Hard cap on cumulative prompt+completion tokens. Default Infinity. */
  maxTokens?: number;
  /** Additional termination condition (composed AND with the built-ins). */
  termination?: TerminationCondition;
  /** Model to use for orchestrator-internal calls. Default gpt-4.1-mini
   *  (fast, non-reasoning — reasoning models like gpt-5-mini/o-series can
   *  consume the full token budget on internal "reasoning_tokens" and return
   *  empty content, which silently kills the loop). */
  model?: string;
  /** Persistence key — if set, ledger state is saved to memory_entries
   *  for resume across process restarts. */
  ledgerKey?: string;
  /** REQUIRED when ledgerKey is set (multi-tenant safety). When ledgerKey is
   *  not set, defaults to 1 for ephemeral runs. The runtime check throws
   *  rather than silently writing to tenant 1 because cross-tenant ledger
   *  pollution is a privacy/correctness risk in a multi-tenant deployment. */
  tenantId?: number;
  /** Per-turn observer hook (for logging / streaming). */
  onTurn?: (turn: number, ledger: LedgerEntry, response: string) => void | Promise<void>;
  /** Token-usage observer. Called after EVERY LLM call inside the loop
   *  (orchestrator-internal calls AND team-member handler calls when the
   *  handler reports back via the second arg of its return). The default
   *  RunState.tokenUsage only counts orchestrator-internal calls — handlers
   *  that spend tokens themselves are invisible without this hook. */
  onTokenUsage?: (delta: { prompt: number; completion: number; source: "orchestrator" | "handler"; speaker?: string }) => void;
  /** Optional verbose console logging. */
  verbose?: boolean;
}

export interface LedgerRunResult {
  finalAnswer: string;
  turns: number;
  stalls: number;
  terminationReason: string;
  facts: string;
  plan: string;
  history: TurnRecord[];
  tokenUsage: { prompt: number; completion: number };
}

// ---------------------------------------------------------------------------
// Termination Conditions (composable; mirrors AutoGen)
// ---------------------------------------------------------------------------

export interface TerminationCondition {
  /** Returns { stop, reason } given current state. Pure (no side effects). */
  check(state: RunState): { stop: boolean; reason?: string };
  /** Reset internal counters. */
  reset(): void;
}

export class MaxTurnsTermination implements TerminationCondition {
  constructor(private maxTurns: number) {}
  check(state: RunState) {
    if (state.nRounds >= this.maxTurns) {
      return { stop: true, reason: `max turns (${this.maxTurns}) reached` };
    }
    return { stop: false };
  }
  reset() {}
}

export class MaxStallsTermination implements TerminationCondition {
  constructor(private maxStalls: number) {}
  check(state: RunState) {
    if (state.nStalls >= this.maxStalls) {
      return { stop: true, reason: `max stalls (${this.maxStalls}) reached after plan-update attempts` };
    }
    return { stop: false };
  }
  reset() {}
}

export class MaxTokensTermination implements TerminationCondition {
  constructor(private maxTokens: number) {}
  check(state: RunState) {
    const total = state.tokenUsage.prompt + state.tokenUsage.completion;
    if (total >= this.maxTokens) {
      return { stop: true, reason: `token budget exceeded (${total} >= ${this.maxTokens})` };
    }
    return { stop: false };
  }
  reset() {}
}

export interface TextMentionOptions {
  /** Restrict matching to responses from these speaker names. */
  sources?: string[];
  /** Case-insensitive match. Default false (literal substring). */
  caseSensitive?: boolean;
}
export class TextMentionTermination implements TerminationCondition {
  private sources?: string[];
  private caseSensitive: boolean;
  constructor(private text: string, opts: TextMentionOptions | string[] = {}) {
    // Back-compat: 2nd arg used to be `string[]`. Accept either shape.
    if (Array.isArray(opts)) {
      this.sources = opts;
      this.caseSensitive = true;
    } else {
      this.sources = opts.sources;
      this.caseSensitive = opts.caseSensitive ?? true;
    }
  }
  check(state: RunState) {
    const needle = this.caseSensitive ? this.text : this.text.toLowerCase();
    for (const turn of state.history) {
      if (this.sources && !this.sources.includes(turn.speaker)) continue;
      const haystack = this.caseSensitive ? turn.response : turn.response.toLowerCase();
      if (haystack.includes(needle)) {
        return { stop: true, reason: `text "${this.text}" mentioned by ${turn.speaker}` };
      }
    }
    return { stop: false };
  }
  reset() {}
}

export class FunctionalTermination implements TerminationCondition {
  constructor(private fn: (state: RunState) => { stop: boolean; reason?: string }) {}
  check(state: RunState) { return this.fn(state); }
  reset() {}
}

export class CompositeTermination implements TerminationCondition {
  constructor(private conditions: TerminationCondition[], private mode: "and" | "or" = "or") {}
  check(state: RunState) {
    const results = this.conditions.map(c => c.check(state));
    if (this.mode === "or") {
      const fired = results.find(r => r.stop);
      return fired || { stop: false };
    } else {
      if (results.every(r => r.stop)) {
        return { stop: true, reason: results.map(r => r.reason).join(" AND ") };
      }
      return { stop: false };
    }
  }
  reset() { this.conditions.forEach(c => c.reset()); }
}

// ---------------------------------------------------------------------------
// Prompts (ported from AutoGen Magentic-One, Apache 2.0)
// ---------------------------------------------------------------------------

const FACTS_PROMPT = (task: string) => `Below I will present you a request. Before we begin addressing the request, please answer the following pre-survey to the best of your ability.

Here is the request:

${task}

Here is the pre-survey:
    1. Please list any specific facts or figures that are GIVEN in the request itself.
    2. Please list any facts that may need to be looked up, and WHERE SPECIFICALLY they might be found.
    3. Please list any facts that may need to be derived (e.g., via logical deduction, simulation, or computation).
    4. Please list any facts that are recalled from memory, hunches, well-reasoned guesses, etc.

Use these exact headings:
    1. GIVEN OR VERIFIED FACTS
    2. FACTS TO LOOK UP
    3. FACTS TO DERIVE
    4. EDUCATED GUESSES

DO NOT include any other headings. DO NOT list next steps or plans.`;

const PLAN_PROMPT = (team: string) => `Fantastic. To address this request we have assembled the following team:

${team}

Based on the team composition, and the known and unknown facts, please devise a short bullet-point plan for addressing the original request. Remember, there is no requirement to involve all team members — a team member's particular expertise may not be needed for this task.`;

const PROGRESS_LEDGER_PROMPT = (task: string, team: string, names: string[]) => `Recall we are working on the following request:

${task}

And we have assembled the following team:

${team}

To make progress, please answer the following, including necessary reasoning:
    - Is the request fully satisfied? (True if complete, or False if the original request has yet to be SUCCESSFULLY and FULLY addressed)
    - Are we in a loop where we are repeating the same requests / responses? Loops can span multiple turns.
    - Are we making forward progress? (True if just starting, or recent messages add value. False if stuck or facing significant barriers.)
    - Who should speak next? (select from: ${names.join(", ")})
    - What instruction or question would you give them? (Phrase as if speaking directly to them.)

Output PURE JSON, no prose, no code fences. Schema:
{
  "is_request_satisfied":   { "reason": "...", "answer": <bool> },
  "is_in_loop":             { "reason": "...", "answer": <bool> },
  "is_progress_being_made": { "reason": "...", "answer": <bool> },
  "next_speaker":           { "reason": "...", "answer": "<one of: ${names.join(" | ")}>" },
  "instruction_or_question":{ "reason": "...", "answer": "<text>" }
}`;

const FACTS_UPDATE_PROMPT = (task: string, facts: string) => `As a reminder, we are working to solve:

${task}

It's clear we aren't making as much progress as we'd like, but we may have learned something new. Please rewrite the following fact sheet, updating it to include anything new we've learned. Move educated guesses to verified facts where appropriate. Add or update at least one educated guess and explain your reasoning.

Old fact sheet:

${facts}`;

const PLAN_UPDATE_PROMPT = (team: string) => `Please briefly explain what went wrong on this last run (the root cause of the failure), and then come up with a NEW plan that takes steps and/or includes hints to overcome prior challenges and especially avoids repeating the same mistakes. The new plan should be concise and in bullet-point form. Team composition (do not invoke anyone outside this team):

${team}`;

const FINAL_ANSWER_PROMPT = (task: string) => `We were working on the following task:

${task}

We have completed the task (or run out of turns).

The above messages contain the conversation that took place. Based on what was gathered, provide the final answer to the original request, phrased as if speaking to the user.`;

// ---------------------------------------------------------------------------
// LLM helpers
// ---------------------------------------------------------------------------

async function callLLM(
  systemOrUserPrompt: string,
  model: string,
  state: RunState,
  options: {
    json?: boolean;
    history?: { role: "user" | "assistant"; content: string }[];
    onTokenUsage?: (delta: { prompt: number; completion: number; source: "orchestrator" | "handler"; speaker?: string }) => void;
  } = {}
): Promise<{ content: string; usage: { prompt: number; completion: number } }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: "You are an orchestrator coordinating a team of specialist agents. Be terse and decisive." },
    ...(options.history || []),
    { role: "user", content: systemOrUserPrompt },
  ];

  const isReasoning = /^(o\d|gpt-5)/.test(model);
  const tokenLimitField = isReasoning ? "max_completion_tokens" : "max_tokens";
  // Reasoning models burn tokens on internal "reasoning_tokens" before
  // emitting any visible content — give them a much larger ceiling so the
  // content isn't always empty.
  let tokenLimit = isReasoning ? 6000 : 1500;

  let content = "";
  let usage = { prompt: 0, completion: 0 };

  // Retry up to 2x on empty content (raises the token ceiling each time)
  for (let attempt = 0; attempt < 2; attempt++) {
    const req: any = { model, messages, [tokenLimitField]: tokenLimit };
    if (options.json) req.response_format = { type: "json_object" };
    const resp = await replitOpenai.chat.completions.create(req);
    content = resp.choices[0]?.message?.content?.trim() || "";
    usage = {
      prompt: resp.usage?.prompt_tokens || 0,
      completion: resp.usage?.completion_tokens || 0,
    };
    state.tokenUsage.prompt += usage.prompt;
    state.tokenUsage.completion += usage.completion;
    // Notify the external observer EVERY successful LLM round-trip including
    // empty-content retries so token spend is always accurate. Caller's
    // problem if they double-count — we err on the side of visibility.
    if (options.onTokenUsage && (usage.prompt > 0 || usage.completion > 0)) {
      try { options.onTokenUsage({ ...usage, source: "orchestrator" }); }
      catch (e) { console.warn(`[orchestrator-ledger] onTokenUsage callback threw: ${(e as Error).message}`); }
    }
    if (content.length > 0) break;
    // Empty — likely reasoning_tokens exhausted the budget. Bump and retry.
    tokenLimit = Math.min(tokenLimit * 3, 16000);
  }

  if (!content) {
    throw new Error(`callLLM(${model}): empty content after 2 attempts (likely reasoning-token exhaustion). Caller: ${systemOrUserPrompt.slice(0, 100)}`);
  }
  return { content, usage };
}

/**
 * Build the conversation context the orchestrator LLM needs to make grounded
 * progress-ledger decisions. Returns a chat-history array containing the
 * current facts sheet, current plan, and a (truncated) transcript of the
 * recent turns. Without this the orchestrator can't tell if the team is
 * looping, making progress, or finished — its judgments degenerate into
 * guesses based purely on the prompt template.
 *
 * Truncates to the last 12 turns and clips each response to ~600 chars to
 * keep prompt cost bounded on long runs.
 */
function buildLedgerContext(state: RunState, maxTurns = 12, perTurnChars = 600): { role: "user" | "assistant"; content: string }[] {
  const ctx: { role: "user" | "assistant"; content: string }[] = [];
  if (state.task) {
    ctx.push({ role: "user", content: `## Original task\n${state.task}` });
  }
  if (state.facts) {
    ctx.push({ role: "assistant", content: `## Current facts sheet\n${state.facts.slice(0, 2000)}` });
  }
  if (state.plan) {
    ctx.push({ role: "assistant", content: `## Current plan\n${state.plan.slice(0, 2000)}` });
  }
  const recent = state.history.slice(-maxTurns);
  for (const t of recent) {
    const clipped = t.response.length > perTurnChars
      ? t.response.slice(0, perTurnChars) + "…[truncated]"
      : t.response;
    ctx.push({ role: "assistant", content: `## Turn ${state.history.indexOf(t) + 1} — ${t.speaker}\nInstruction: ${t.instruction}\nResponse: ${clipped}` });
  }
  return ctx;
}

function safeJsonParse<T = any>(s: string): T | null {
  // strip markdown fences if any LLM ignores response_format
  const cleaned = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned); }
  catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { return null; } }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Persistence (memory_entries) — opt-in via ledgerKey
// ---------------------------------------------------------------------------

export async function saveLedgerState(ledgerKey: string, tenantId: number, state: RunState): Promise<void> {
  try {
    const payload = JSON.stringify({
      task: state.task,
      facts: state.facts,
      plan: state.plan,
      nRounds: state.nRounds,
      nStalls: state.nStalls,
      tokenUsage: state.tokenUsage,
      team: state.team,
      history: state.history.slice(-20), // bound state size
    });
    const source = `ledger:${ledgerKey}`;
    const lockKey = ledgerLockKey(ledgerKey, tenantId);
    // Wrap SELECT-then-UPDATE-or-INSERT in a transaction guarded by a
    // Postgres advisory lock keyed on (ledgerKey, tenantId). Without this,
    // two concurrent runners on the same ledger could both see "no row",
    // both INSERT, and create duplicate rows that fight over UPDATE on next
    // save. The xact lock auto-releases on commit/rollback. Same connection
    // is guaranteed by db.transaction(), required for advisory locks.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${sql.raw(lockKey)}::bigint)`);
      const existing: any = await tx.execute(sql`
        SELECT id FROM memory_entries
        WHERE source = ${source} AND tenant_id = ${tenantId} AND category = 'orchestrator_ledger'
        ORDER BY last_accessed DESC LIMIT 1
      `);
      const row = ((existing as any).rows || existing)[0];
      if (row) {
        await tx.execute(sql`
          UPDATE memory_entries
          SET fact = ${payload}, last_accessed = NOW(), access_count = COALESCE(access_count, 0) + 1
          WHERE id = ${row.id}
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO memory_entries (tenant_id, fact, category, source, status, created_at, last_accessed, access_count)
          VALUES (${tenantId}, ${payload}, 'orchestrator_ledger', ${source}, 'active', NOW(), NOW(), 1)
        `);
      }
    });
  } catch (e) {
    console.error(`[orchestrator-ledger] saveLedgerState failed: ${(e as Error).message}`);
  }
}

export async function loadLedgerState(ledgerKey: string, tenantId: number = 1): Promise<RunState | null> {
  try {
    const source = `ledger:${ledgerKey}`;
    const rows: any = await db.execute(sql`
      SELECT fact FROM memory_entries
      WHERE source = ${source} AND tenant_id = ${tenantId} AND category = 'orchestrator_ledger'
      ORDER BY last_accessed DESC LIMIT 1
    `);
    const row = ((rows as any).rows || rows)[0];
    if (!row) return null;
    return JSON.parse(row.fact);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main: runLedgerLoop — the Magentic-One orchestrator
// ---------------------------------------------------------------------------

export async function runLedgerLoop(opts: LedgerRunOptions): Promise<LedgerRunResult> {
  const model = opts.model || "gpt-4.1-mini";
  const maxTurns = opts.maxTurns ?? 20;
  const maxStalls = opts.maxStalls ?? 3;
  const maxRegenerates = opts.maxRegenerates ?? 2;
  // Multi-tenant safety: when ledgerKey is set, the persisted state lives in
  // memory_entries and would silently default to tenant 1 if not specified.
  // Throw rather than write to the wrong tenant — cross-tenant leakage is
  // worse than a startup error.
  if (opts.ledgerKey && opts.tenantId === undefined) {
    throw new Error("runLedgerLoop: tenantId is required when ledgerKey is set (multi-tenant safety)");
  }
  const tenantId = opts.tenantId ?? 1;
  // Bind onTokenUsage once so every callLLM site can pass it through without
  // each call having to remember.
  const llmOpts = opts.onTokenUsage ? { onTokenUsage: opts.onTokenUsage } : {};
  let regenerateAttempts = 0;

  const teamDescription = opts.team
    .map(m => `${m.name}: ${m.description.replace(/\s+/g, " ").trim()}`)
    .join("\n");
  const memberNames = opts.team.map(m => m.name);

  // Built-in terminations always active
  const builtins: TerminationCondition[] = [
    new MaxTurnsTermination(maxTurns),
    new MaxStallsTermination(maxStalls),
  ];
  if (opts.maxTokens && opts.maxTokens > 0 && opts.maxTokens < Infinity) {
    builtins.push(new MaxTokensTermination(opts.maxTokens));
  }
  if (opts.termination) builtins.push(opts.termination);
  const termination = new CompositeTermination(builtins, "or");

  const state: RunState = {
    task: opts.task,
    facts: "",
    plan: "",
    nRounds: 0,
    nStalls: 0,
    history: [],
    tokenUsage: { prompt: 0, completion: 0 },
    team: opts.team.map(m => ({ name: m.name, description: m.description })),
  };

  const log = (msg: string) => { if (opts.verbose) console.log(`[ledger:${opts.ledgerKey || "anon"}] ${msg}`); };

  // 1. FACTS
  log("gathering facts");
  const facts = await callLLM(FACTS_PROMPT(opts.task), model, state, llmOpts);
  state.facts = facts.content;

  // 2. PLAN
  log("creating plan");
  const plan = await callLLM(PLAN_PROMPT(teamDescription), model, state, llmOpts);
  state.plan = plan.content;

  if (opts.ledgerKey) await saveLedgerState(opts.ledgerKey, tenantId, state);

  // 3. PROGRESS LOOP
  let terminationReason = "completed";
  let satisfied = false;

  while (true) {
    const term = termination.check(state);
    if (term.stop) { terminationReason = term.reason || "terminated"; break; }

    state.nRounds++;
    log(`turn ${state.nRounds}`);

    // Ask the orchestrator for the progress ledger.
    // It MUST see the conversation so far — current facts, current plan, and
    // the recent turn transcript — otherwise its loop/progress/satisfied
    // judgments are ungrounded guesses and routing degenerates.
    const ledgerHistory = buildLedgerContext(state);
    let ledger: LedgerEntry | null = null;
    let raw = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await callLLM(
        PROGRESS_LEDGER_PROMPT(opts.task, teamDescription, memberNames),
        model,
        state,
        { ...llmOpts, json: true, history: ledgerHistory }
      );
      raw = r.content;
      const parsed = safeJsonParse<LedgerEntry>(raw);
      if (parsed && parsed.next_speaker?.answer && memberNames.includes(parsed.next_speaker.answer)) {
        ledger = parsed;
        break;
      }
      log(`progress-ledger parse attempt ${attempt + 1} failed`);
    }

    if (!ledger) {
      terminationReason = "orchestrator failed to produce valid progress ledger after 3 attempts";
      break;
    }

    // Stop if satisfied
    if (ledger.is_request_satisfied.answer) {
      satisfied = true;
      log(`request satisfied: ${ledger.is_request_satisfied.reason}`);
      terminationReason = "request satisfied";
      break;
    }

    // Stall detection: in a loop OR no progress
    const isStall = ledger.is_in_loop.answer || !ledger.is_progress_being_made.answer;
    if (isStall) {
      state.nStalls++;
      log(`stall detected (n=${state.nStalls}, in_loop=${ledger.is_in_loop.answer}, progress=${ledger.is_progress_being_made.answer})`);

      if (state.nStalls >= maxStalls) {
        if (regenerateAttempts >= maxRegenerates) {
          terminationReason = `max regenerate attempts (${maxRegenerates}) exhausted; team chronically stuck`;
          log(terminationReason);
          break;
        }
        regenerateAttempts++;
        log(`max stalls hit; regenerating facts + plan (attempt ${regenerateAttempts}/${maxRegenerates})`);
        // Pass conversation context so regeneration is grounded in what
        // actually happened — without it the orchestrator can't tell what
        // went wrong and tends to produce a near-identical plan.
        const updateHistory = buildLedgerContext(state);
        const newFacts = await callLLM(FACTS_UPDATE_PROMPT(opts.task, state.facts), model, state, { ...llmOpts, history: updateHistory });
        state.facts = newFacts.content;
        const newPlan = await callLLM(PLAN_UPDATE_PROMPT(teamDescription), model, state, { ...llmOpts, history: updateHistory });
        state.plan = newPlan.content;
        state.nStalls = 0; // reset after successful re-plan
        if (opts.ledgerKey) await saveLedgerState(opts.ledgerKey, tenantId, state);
        continue; // ask the orchestrator for a fresh next-speaker decision
      }
    } else {
      // forward progress — clear stall counter
      state.nStalls = 0;
    }

    // Dispatch to the chosen speaker
    const speaker = opts.team.find(m => m.name === ledger!.next_speaker.answer);
    if (!speaker) {
      terminationReason = `orchestrator selected unknown speaker "${ledger.next_speaker.answer}"`;
      break;
    }

    const turnStart = Date.now();
    let response = "";
    try {
      response = await speaker.handler(ledger.instruction_or_question.answer, {
        task: opts.task,
        facts: state.facts,
        plan: state.plan,
        history: [...state.history],
        turn: state.nRounds,
      });
    } catch (e) {
      response = `[ERROR from ${speaker.name}: ${(e as Error).message}]`;
    }

    const turnRecord: TurnRecord = {
      speaker: speaker.name,
      instruction: ledger.instruction_or_question.answer,
      response,
      ledger,
      durationMs: Date.now() - turnStart,
    };
    state.history.push(turnRecord);

    if (opts.onTurn) {
      try { await opts.onTurn(state.nRounds, ledger, response); } catch (_silentErr) { logSilentCatch("server/orchestrator-ledger.ts", _silentErr); }
    }

    if (opts.ledgerKey) await saveLedgerState(opts.ledgerKey, tenantId, state);
  }

  // 4. FINAL ANSWER
  log("synthesizing final answer");
  let finalAnswer = "";
  try {
    const finalCtx = state.history.length > 0
      ? state.history.map(h => `${h.speaker}: ${h.response}`).join("\n\n").slice(0, 8000)
      : "(no turns executed)";
    const r = await callLLM(
      `${FINAL_ANSWER_PROMPT(opts.task)}\n\nConversation summary:\n${finalCtx}`,
      model,
      state,
      llmOpts
    );
    finalAnswer = r.content;
  } catch (e) {
    finalAnswer = satisfied ? "(task completed, final synthesis failed)" : `(task incomplete: ${terminationReason})`;
  }

  return {
    finalAnswer,
    turns: state.nRounds,
    stalls: state.nStalls,
    terminationReason,
    facts: state.facts,
    plan: state.plan,
    history: state.history,
    tokenUsage: state.tokenUsage,
  };
}
