import { Worker } from "node:worker_threads";
import { getClientForModel } from "./providers";

const ROOT_MAX_ITERATIONS = 8;
const SUBLLM_MAX_CALLS = 50;
const SUBLLM_MAX_CONCURRENCY = 8;
const SUBLLM_MAX_PROMPT_CHARS = 200_000;
const SUBLLM_TIMEOUT_MS = 90_000;
const REPL_SYNC_TIMEOUT_MS = 5_000;
const REPL_TOTAL_TIMEOUT_MS = 60_000;
const STDOUT_PREFIX_CHARS = 4_000;
const PROMPT_PREFIX_CHARS = 2_000;

// How long the HOST waits past the worker's own block budget before it gives up
// on a self-report and hard-kills the worker with terminate(). A responsive
// worker ALWAYS posts a "done" (success / error / its own timeout) before this
// fires — so this only ever triggers when the worker event loop is genuinely
// WEDGED (a synchronous hang inside thenable assimilation that no in-worker
// timer can interrupt). That is the structural close for the plain-object
// thenable async-DoS class (Vectors B/C): a separate thread can be terminated;
// a wedged single event loop cannot self-rescue.
const WATCHDOG_GRACE_MS = 5_000;
const WORKER_INIT_TIMEOUT_MS = 10_000;
const BOOTSTRAP_TIMEOUT_MS = 1_000;
// Bound the worker's heap so an in-sandbox memory bomb crashes the worker (which
// the host observes via 'error'/'exit') instead of pressuring the host process.
const RLM_WORKER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 32,
  codeRangeSizeMb: 16,
};

// THREAT MODEL: this module runs LLM-generated JS. The ROOT LLM (a trusted
// modelfarm model) authors the code; the user's prompt is exposed as a string
// literal only (the user does NOT directly write executed code). Two layered
// isolation boundaries defend the host:
//   1. A Node `vm` context per the code-sandbox pattern (null-proto global,
//      codeGeneration:{strings:false}, strict regular-async wrapper, reboxed
//      subLLM, defense-in-depth blocklist) — closes the RCE / host-env-exfil
//      escape class.
//   2. A dedicated WORKER THREAD that actually runs the vm, spawned with an
//      EMPTY env (no secrets even reach the worker) and bounded heap. The host
//      can `worker.terminate()` a wedged worker — the only reliable interrupt
//      for a synchronous hang reached through async thenable assimilation
//      (Vectors B/C). See docs/architecture-notes.md.

export const RLM_RECURSIVE_THRESHOLD_TOKENS = 150_000;
export const RLM_DEFAULT_ROOT_MODEL = "gpt-5.6-sol";
export const RLM_DEFAULT_SUB_MODEL = "gpt-5-mini";

export type RLMProgressEvent =
  | { type: "iteration"; round: number; codeChars: number }
  | { type: "stdout"; round: number; output: string }
  | { type: "subllm"; promptChars: number; responseChars: number }
  | { type: "final"; chars: number }
  | { type: "error"; message: string };

export interface RLMOptions {
  rootModel?: string;
  subModel?: string;
  tenantId?: number | null;
  signal?: AbortSignal;
  onProgress?: (event: RLMProgressEvent) => void;
  taskHint?: string;
}

export interface RLMResult {
  ok: boolean;
  answer: string | null;
  rounds: number;
  subCalls: number;
  totalSubPromptChars: number;
  totalSubResponseChars: number;
  rootModel: string;
  subModel: string;
  error?: string;
}

const SYSTEM_PROMPT = `You are operating as the ROOT model in a Recursive Language Model (RLM) loop.

The user's full prompt has been loaded into a JavaScript REPL as a variable named \`prompt\`. The prompt is too large to read directly — you MUST inspect it programmatically by writing code that slices it and invokes a smaller sub-model on slices.

== Available REPL bindings ==
- prompt              : (string) the user's full input. NEVER print the entire variable.
- len(s)              : returns string length
- slice(start, end)   : substring of the prompt (or any string)
- chunkText(s, size)  : returns array of substrings of length \`size\`
- await subLLM(text)  : invoke a smaller LLM on the given prompt; returns its full response as a string
- print(...args)      : write to stdout (only the first ${STDOUT_PREFIX_CHARS} chars are returned to you)
- setFinal(answer)    : store the final answer string and END the loop
- Promise, JSON, Math, Number, String, Array, Object, Date are available

== Your job ==
1. First, inspect the prompt's structure (length, prefix, perhaps suffix).
2. Decompose the work: write loops that iterate over slices and call \`await subLLM(...)\` on each slice with a precise sub-task.
3. Aggregate sub-results in JavaScript. Variables persist across rounds.
4. When the answer is ready, call setFinal(yourAnswer).

== Hard rules ==
- Each REPL block is wrapped as an async function — top-level await IS supported.
- NEVER write \`print(prompt)\` or any code that emits the whole prompt.
- Use Promise.all for parallel sub-calls (max 8 in parallel) to stay within budget.
- You have at most ${ROOT_MAX_ITERATIONS} root rounds and ${SUBLLM_MAX_CALLS} total sub-calls.
- Each REPL block has a ${REPL_TOTAL_TIMEOUT_MS / 1000}s wall-clock budget.

== Output format ==
Each turn, emit EXACTLY ONE JavaScript code block fenced with \`\`\`js. No prose outside the code block.

The loop terminates as soon as setFinal(answer) is called.`;

// The worker's main-thread source. It runs as an eval:true worker (CommonJS —
// `require` is available; verified in this env), holds ONE vm context across
// rounds, and delegates every subLLM call BACK to the host over the message
// channel (the LLM client + credentials live on the host and NEVER enter the
// worker). Kept free of backticks / ${...} so it survives being embedded here.
const RLM_WORKER_SOURCE = [
  "'use strict';",
  "const { parentPort } = require('node:worker_threads');",
  "const vm = require('node:vm');",
  "let ctx = null;",
  "let sandbox = null;",
  "let workerFinal = null;",
  "const pending = new Map();",
  "let subllmSeq = 0;",
  "function makeHostBridge() {",
  "  return {",
  "    appendStdout: function (line) { sandbox.__stdout += line + '\\n'; },",
  "    storeFinal: function (answer) {",
  "      workerFinal = (typeof answer === 'string')",
  "        ? answer",
  "        : (function () { try { return JSON.stringify(answer); } catch (_e) { return String(answer); } })();",
  "    },",
  "    callSubLLM: function (text) {",
  "      return new Promise(function (resolve, reject) {",
  "        const id = ++subllmSeq;",
  "        pending.set(id, { resolve: resolve, reject: reject });",
  "        parentPort.postMessage({ type: 'subllm', id: id, text: String(text == null ? '' : text) });",
  "      });",
  "    },",
  "  };",
  "}",
  "function handleInit(msg) {",
  "  try {",
  "    sandbox = Object.create(null);",
  "    sandbox.__host = makeHostBridge();",
  "    sandbox.__stdout = '';",
  "    ctx = vm.createContext(sandbox, { name: 'rlm-sandbox', codeGeneration: { strings: false, wasm: false } });",
  "    vm.runInContext(msg.bootstrapSource, ctx, { timeout: msg.bootstrapTimeoutMs || 1000 });",
  "    parentPort.postMessage({ type: 'ready' });",
  "  } catch (e) {",
  "    parentPort.postMessage({ type: 'init-error', error: String((e && e.message) || e).slice(0, 500) });",
  "  }",
  "}",
  "async function handleRun(msg) {",
  "  let error = null;",
  "  try {",
  "    sandbox.__stdout = '';",
  "    const result = vm.runInContext(msg.wrapped, ctx, { timeout: msg.syncTimeoutMs });",
  "    let timer = null;",
  "    const timeout = new Promise(function (_resolve, reject) {",
  "      timer = setTimeout(function () { reject(new Error('REPL block exceeded ' + msg.totalTimeoutMs + 'ms')); }, msg.totalTimeoutMs);",
  "    });",
  "    try {",
  "      await Promise.race([result, timeout]);",
  "    } finally {",
  "      if (timer) clearTimeout(timer);",
  "    }",
  "  } catch (e) {",
  "    error = String((e && e.message) || e).slice(0, 500);",
  "  }",
  "  const stdout = (sandbox && sandbox.__stdout) || '';",
  "  parentPort.postMessage({ type: 'done', stdout: stdout, final: workerFinal, error: error });",
  "}",
  "function handleSubllmResult(msg) {",
  "  const p = pending.get(msg.id);",
  "  if (!p) return;",
  "  pending.delete(msg.id);",
  "  if (msg.ok) p.resolve(String(msg.value == null ? '' : msg.value));",
  "  else p.reject(new Error(String(msg.value == null ? 'subLLM failed' : msg.value)));",
  "}",
  "parentPort.on('message', function (msg) {",
  "  if (!msg || typeof msg !== 'object') return;",
  "  if (msg.type === 'init') handleInit(msg);",
  "  else if (msg.type === 'run') { handleRun(msg); }",
  "  else if (msg.type === 'subllm-result') handleSubllmResult(msg);",
  "});",
].join("\n");

// Builds the sandbox-bootstrap source that installs the REPL bindings inside the
// vm context. Runs ONCE per session (before any model-authored code). Authored
// here (not in the worker string) so it stays readable and single-sourced; the
// worker just executes it verbatim via vm.runInContext.
export function buildBootstrapSource(userPrompt: string): string {
  const PROMPT_LITERAL = JSON.stringify(userPrompt);
  return `
    (function installBindings() {
      // SECURITY (availability): lock the Promise intrinsic BEFORE any untrusted
      // code runs. Each block is bounded via Promise.race([result, timeout]) and
      // is AWAITED; if sandbox code could redefine Promise.prototype.then/catch/
      // finally, thenable assimilation would invoke attacker code on the event
      // loop OUTSIDE the vm timeout. Freezing these descriptors makes that vector
      // fail CLOSED — the strict-mode reassignment throws, bounded as a reject.
      // NOTE: this does NOT bound a malicious PLAIN-object thenable that user
      // code returns or awaits (its .then is not on Promise.prototype); THAT
      // deeper async-microtask DoS class is closed by running this whole context
      // inside a worker thread the host can terminate() (Vectors B/C).
      (function lockPromiseIntrinsic() {
        try {
          const P = Promise.prototype;
          for (const k of ["then", "catch", "finally"]) {
            Object.defineProperty(P, k, { value: P[k], writable: false, configurable: false });
          }
          Object.defineProperty(globalThis, "Promise", { value: Promise, writable: false, configurable: false });
        } catch (e) {
          // Fail OPEN: locking is defense-in-depth (the worker terminate() is the
          // hard backstop). Record the reason on a sandbox global (host-only
          // logSilentCatch is NOT in scope inside this vm realm) so a diagnostic
          // can surface it without breaking bootstrap.
          globalThis.__promiseLockError = String((e && e.message) || e);
        }
      })();
      const __h = __host;
      globalThis.prompt = ${PROMPT_LITERAL};
      globalThis.len = function len(s) { return (typeof s === 'string' ? s.length : String(s == null ? '' : s).length); };
      globalThis.slice = function slice(start, end) { return globalThis.prompt.slice(start, end); };
      globalThis.chunkText = function chunkText(s, size) {
        const out = [];
        const txt = String(s == null ? '' : s);
        const sz = Math.max(1, Math.floor(size));
        for (let i = 0; i < txt.length; i += sz) out.push(txt.slice(i, i + sz));
        return out;
      };
      globalThis.print = function print(...args) {
        const line = args.map(a => typeof a === 'string' ? a : (function(){ try { return JSON.stringify(a); } catch(_) { return String(a); } })()).join(' ');
        __h.appendStdout(line);
      };
      globalThis.setFinal = function setFinal(answer) {
        __h.storeFinal(typeof answer === 'string' ? answer : (function(){ try { return JSON.stringify(answer); } catch(_) { return String(answer); } })());
      };
      globalThis.subLLM = function subLLM(text) {
        // SECURITY: __h.callSubLLM is async and returns a WORKER-realm Promise.
        // Returning it directly would hand sandbox code a non-vm-realm object
        // whose .constructor.constructor reaches the worker's Function, defeating
        // the per-realm codeGeneration:{strings:false} guard. Rebox into a
        // sandbox-realm Promise that resolves ONLY primitive strings, so no
        // out-of-realm object ever crosses the boundary.
        const __hostP = __h.callSubLLM(text);
        return new Promise(function (resolve, reject) {
          __hostP.then(
            function (v) { resolve(String(v)); },
            function (e) { reject(String((e && e.message) || e)); }
          );
        });
      };
      delete globalThis.__host;
    })();
  `;
}

export interface RlmBlockResult {
  stdout: string;
  final: string | null;
  error: string | null;
  wedged: boolean;
}

export interface RlmWorkerSessionOptions {
  onSubLLM: (text: string) => Promise<string>;
  syncTimeoutMs?: number;
  totalTimeoutMs?: number;
  watchdogGraceMs?: number;
  bootstrapTimeoutMs?: number;
  initTimeoutMs?: number;
  onError?: (message: string) => void;
}

// Owns a single worker thread that executes the vm context across rounds. The
// host holds the LLM client + budget; the worker holds the vm. runBlock()
// returns { wedged:true } and terminates the worker if it fails to self-report
// within the block budget + grace — the hard kill for the async-DoS class.
export class RlmWorkerSession {
  private worker: Worker | null = null;
  private aliveFlag = false;
  private onReady: ((v: { ok: boolean; error?: string }) => void) | null = null;
  private onRunDone: ((v: RlmBlockResult) => void) | null = null;
  private readonly onSubLLM: (text: string) => Promise<string>;
  private readonly onErrorCb?: (message: string) => void;
  private readonly syncTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly watchdogGraceMs: number;
  private readonly bootstrapTimeoutMs: number;
  private readonly initTimeoutMs: number;

  constructor(options: RlmWorkerSessionOptions) {
    this.onSubLLM = options.onSubLLM;
    this.onErrorCb = options.onError;
    this.syncTimeoutMs = options.syncTimeoutMs ?? REPL_SYNC_TIMEOUT_MS;
    this.totalTimeoutMs = options.totalTimeoutMs ?? REPL_TOTAL_TIMEOUT_MS;
    this.watchdogGraceMs = options.watchdogGraceMs ?? WATCHDOG_GRACE_MS;
    this.bootstrapTimeoutMs = options.bootstrapTimeoutMs ?? BOOTSTRAP_TIMEOUT_MS;
    this.initTimeoutMs = options.initTimeoutMs ?? WORKER_INIT_TIMEOUT_MS;
  }

  get alive(): boolean {
    return this.aliveFlag;
  }

  async init(bootstrapSource: string): Promise<{ ok: boolean; error?: string }> {
    const worker = new Worker(RLM_WORKER_SOURCE, {
      eval: true,
      // No secrets in the worker: even a hypothetical vm escape lands in an
      // EMPTY process.env (verified 0 keys). The worker makes no network/DB
      // calls — subLLM is delegated back to the host.
      env: {},
      resourceLimits: RLM_WORKER_RESOURCE_LIMITS,
    });
    this.worker = worker;
    this.aliveFlag = true;

    worker.on("message", (msg: any) => this.handleMessage(msg));
    worker.on("error", (err: any) => {
      this.aliveFlag = false;
      const m = `RLM worker error: ${String(err?.message || err).slice(0, 200)}`;
      this.onErrorCb?.(m);
      this.failPending(m);
    });
    worker.on("exit", () => {
      this.aliveFlag = false;
      this.failPending("RLM worker exited");
    });

    const readyPromise = new Promise<{ ok: boolean; error?: string }>((resolve) => {
      this.onReady = resolve;
    });
    worker.postMessage({
      type: "init",
      bootstrapSource,
      bootstrapTimeoutMs: this.bootstrapTimeoutMs,
    });
    const res = await Promise.race([
      readyPromise,
      new Promise<{ ok: boolean; error?: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, error: "RLM worker init timeout" }), this.initTimeoutMs),
      ),
    ]);
    this.onReady = null;
    if (!res.ok) await this.terminate();
    return res;
  }

  private failPending(message: string): void {
    if (this.onReady) {
      const cb = this.onReady;
      this.onReady = null;
      cb({ ok: false, error: message });
    }
    if (this.onRunDone) {
      const cb = this.onRunDone;
      this.onRunDone = null;
      cb({ stdout: "", final: null, error: message, wedged: true });
    }
  }

  private handleMessage(msg: any): void {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ready") {
      if (this.onReady) {
        const cb = this.onReady;
        this.onReady = null;
        cb({ ok: true });
      }
    } else if (msg.type === "init-error") {
      if (this.onReady) {
        const cb = this.onReady;
        this.onReady = null;
        cb({ ok: false, error: String(msg.error || "init error") });
      }
    } else if (msg.type === "done") {
      if (this.onRunDone) {
        const cb = this.onRunDone;
        this.onRunDone = null;
        cb({
          stdout: String(msg.stdout || ""),
          final: msg.final ?? null,
          error: msg.error ?? null,
          wedged: false,
        });
      }
    } else if (msg.type === "subllm") {
      this.handleSubllm(msg);
    }
  }

  private handleSubllm(msg: any): void {
    void (async () => {
      let ok = true;
      let value = "";
      try {
        value = await this.onSubLLM(String(msg?.text ?? ""));
      } catch (err: any) {
        ok = false;
        value = String(err?.message || err).slice(0, 200);
      }
      if (this.aliveFlag && this.worker) {
        try {
          this.worker.postMessage({ type: "subllm-result", id: msg.id, ok, value });
        } catch (err: any) {
          // Worker died between the alive-check and the post; nothing to deliver.
          this.onErrorCb?.(`RLM subLLM result undeliverable: ${String(err?.message || err).slice(0, 120)}`);
        }
      }
    })();
  }

  async runBlock(wrapped: string): Promise<RlmBlockResult> {
    if (!this.worker || !this.aliveFlag) {
      return { stdout: "", final: null, error: "RLM worker not available", wedged: true };
    }
    const worker = this.worker;
    return await new Promise<RlmBlockResult>((resolve) => {
      let settled = false;
      const watchdog = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.onRunDone = null;
        // The worker event loop is WEDGED — a synchronous hang reached through
        // thenable assimilation cannot be interrupted from within, and no
        // in-worker timer can fire. terminate() is the ONLY reliable kill. This
        // is the structural close for the plain-object thenable class (B/C).
        void this.terminate();
        resolve({
          stdout: "",
          final: null,
          error: `REPL block wedged — worker terminated after ${this.totalTimeoutMs + this.watchdogGraceMs}ms`,
          wedged: true,
        });
      }, this.totalTimeoutMs + this.watchdogGraceMs);

      this.onRunDone = (v) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        resolve(v);
      };

      worker.postMessage({
        type: "run",
        wrapped,
        syncTimeoutMs: this.syncTimeoutMs,
        totalTimeoutMs: this.totalTimeoutMs,
      });
    });
  }

  async terminate(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.aliveFlag = false;
    if (!worker) return;
    try {
      await worker.terminate();
    } catch (err: any) {
      this.onErrorCb?.(`RLM worker terminate failed: ${String(err?.message || err).slice(0, 120)}`);
    }
  }
}

export interface SubLlmBudgetState {
  subCalls: number;
  totalSubPromptChars: number;
  totalSubResponseChars: number;
}

export interface SubLlmGateConfig {
  maxCalls: number;
  maxConcurrency: number;
  maxPromptChars: number;
}

/**
 * Wrap a raw sub-LLM executor with (a) a concurrency semaphore and (b) an
 * ATOMIC per-run budget gate. This is the ONLY thing the worker delegates back
 * to the host, so the cap here is the tenant-facing spend ceiling — it MUST hold
 * even when the worker fires many subLLM requests concurrently.
 *
 * The budget check-and-increment is a single synchronous critical section (NO
 * await between the `>= maxCalls` test and `state.subCalls++`). Because the host
 * event loop is single-threaded, that ordering makes the reservation atomic: N
 * concurrently-queued requests can no longer all pass a pre-slot check and then
 * each increment past the cap after awaiting a slot. The reservation is
 * permanent (never rolled back on a failed call) — the safe direction: it
 * over-counts, never under-counts, matching the original "every attempt counts"
 * semantics. Exported so the concurrency/cap invariant is regression-testable.
 */
export function createBudgetedSubLLM(
  state: SubLlmBudgetState,
  config: SubLlmGateConfig,
  perform: (trimmedPrompt: string) => Promise<string>,
  hooks?: {
    isAborted?: () => boolean;
    onProgress?: (event: any) => void;
  },
): (subPrompt: string) => Promise<string> {
  // Semaphore to cap parallel sub-LLM calls (defense vs. runaway cost / rate limits).
  let inFlight = 0;
  const waitForSlot = (): Promise<void> =>
    new Promise((resolve) => {
      const tryAcquire = () => {
        if (inFlight < config.maxConcurrency) {
          inFlight++;
          resolve();
        } else {
          setTimeout(tryAcquire, 25);
        }
      };
      tryAcquire();
    });

  return async (subPrompt: string): Promise<string> => {
    if (hooks?.isAborted?.()) throw new Error("aborted");
    // ATOMIC budget reservation — see the function doc-comment above. Do NOT
    // introduce an `await` between this check and the increment.
    if (state.subCalls >= config.maxCalls) {
      throw new Error(`subLLM budget exceeded (max ${config.maxCalls})`);
    }
    state.subCalls++;
    const trimmed = String(subPrompt ?? "").slice(0, config.maxPromptChars);
    await waitForSlot();
    state.totalSubPromptChars += trimmed.length;
    try {
      const content = await perform(trimmed);
      state.totalSubResponseChars += content.length;
      hooks?.onProgress?.({
        type: "subllm",
        promptChars: trimmed.length,
        responseChars: content.length,
      });
      return content;
    } catch (err: any) {
      const msg = String(err?.message || err);
      hooks?.onProgress?.({ type: "error", message: `subLLM: ${msg.slice(0, 120)}` });
      return `[subLLM error: ${msg.slice(0, 200)}]`;
    } finally {
      inFlight = Math.max(0, inFlight - 1);
    }
  };
}

export async function runRecursiveLLM(
  userPrompt: string,
  options: RLMOptions = {},
): Promise<RLMResult> {
  const rootModel = options.rootModel || RLM_DEFAULT_ROOT_MODEL;
  const subModel = options.subModel || RLM_DEFAULT_SUB_MODEL;
  const tenantId = options.tenantId ?? undefined;

  let rootClientResult, subClientResult;
  try {
    rootClientResult = await getClientForModel(rootModel, tenantId, { requiresTools: false });
    subClientResult = await getClientForModel(subModel, tenantId, { requiresTools: false });
  } catch (err: any) {
    const msg = `RLM client init failed: ${String(err?.message || err).slice(0, 200)}`;
    options.onProgress?.({ type: "error", message: msg });
    return emptyResult(rootModel, subModel, msg);
  }

  const rootClient = rootClientResult.client;
  const rootActualModel = rootClientResult.actualModelId;
  const subClient = subClientResult.client;
  const subActualModel = subClientResult.actualModelId;

  const state = {
    Final: null as string | null,
    subCalls: 0,
    totalSubPromptChars: 0,
    totalSubResponseChars: 0,
  };

  // Host-realm subLLM executor. This is the ONLY thing the worker delegates back
  // to the host — the LLM client + credentials + budget all live here and never
  // enter the worker. The atomic budget gate + concurrency semaphore live in
  // createBudgetedSubLLM (exported + regression-tested); `perform` does only the
  // raw network call and always resolves to a string, so the worker's rebox
  // always sees a primitive.
  const hostCallSubLLM = createBudgetedSubLLM(
    state,
    {
      maxCalls: SUBLLM_MAX_CALLS,
      maxConcurrency: SUBLLM_MAX_CONCURRENCY,
      maxPromptChars: SUBLLM_MAX_PROMPT_CHARS,
    },
    async (trimmed: string): Promise<string> => {
      const resp: any = await Promise.race([
        subClient.chat.completions.create({
          model: subActualModel,
          messages: [{ role: "user", content: trimmed }],
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`subLLM call exceeded ${SUBLLM_TIMEOUT_MS}ms`)),
            SUBLLM_TIMEOUT_MS,
          ),
        ),
      ]);
      return resp?.choices?.[0]?.message?.content || "";
    },
    {
      isAborted: () => !!options.signal?.aborted,
      onProgress: options.onProgress,
    },
  );

  const session = new RlmWorkerSession({
    onSubLLM: hostCallSubLLM,
    onError: (message) => options.onProgress?.({ type: "error", message }),
  });

  try {
    const initRes = await session.init(buildBootstrapSource(userPrompt));
    if (!initRes.ok) {
      const msg = `RLM worker init failed: ${initRes.error || "unknown"}`;
      options.onProgress?.({ type: "error", message: msg });
      return emptyResult(rootModel, subModel, msg);
    }

    const promptLen = userPrompt.length;
    const promptPrefix = userPrompt.slice(0, PROMPT_PREFIX_CHARS);
    const promptSuffix =
      promptLen > PROMPT_PREFIX_CHARS * 2 ? userPrompt.slice(-PROMPT_PREFIX_CHARS) : "";

    const taskHintBlock = options.taskHint
      ? `\n== Task hint (from caller) ==\n${options.taskHint.slice(0, 1500)}\n`
      : "";

    const initialUser = `The \`prompt\` variable has been loaded.

len(prompt) = ${promptLen.toLocaleString()} characters

First ${PROMPT_PREFIX_CHARS} chars of prompt:
"""
${promptPrefix}
"""${
      promptSuffix
        ? `

Last ${PROMPT_PREFIX_CHARS} chars of prompt:
"""
${promptSuffix}
"""`
        : ""
    }
${taskHintBlock}
Plan your approach, then write your first JavaScript code block. Remember to call setFinal(answer) when done.`;

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: initialUser },
    ];

    let roundsRun = 0;
    for (let round = 1; round <= ROOT_MAX_ITERATIONS; round++) {
      roundsRun = round;
      if (options.signal?.aborted) {
        return finalize(state, roundsRun, rootModel, subModel, "aborted");
      }

      let assistantText: string;
      try {
        const resp: any = await rootClient.chat.completions.create({
          model: rootActualModel,
          messages: messages as any,
        });
        assistantText = resp?.choices?.[0]?.message?.content || "";
      } catch (err: any) {
        const msg = `root model error: ${String(err?.message || err).slice(0, 200)}`;
        options.onProgress?.({ type: "error", message: msg });
        return finalize(state, roundsRun - 1, rootModel, subModel, msg);
      }

      messages.push({ role: "assistant", content: assistantText });

      const code = extractJsCodeBlock(assistantText);
      if (!code) {
        const trimmed = assistantText.trim();
        if (trimmed) {
          state.Final = trimmed;
          options.onProgress?.({ type: "final", chars: trimmed.length });
        }
        break;
      }

      options.onProgress?.({ type: "iteration", round, codeChars: code.length });

      let execError: string | null = null;

      // DEFENSE-IN-DEPTH: reject realm-escape / host-reach attempts before the
      // code ever hits the vm (the reboxed subLLM + codeGeneration flags + worker
      // isolation are the primary controls; this is a secondary layer).
      const blockErr = validateSandboxCode(code);
      if (blockErr) {
        execError = blockErr;
        options.onProgress?.({ type: "error", message: blockErr });
        const observation = `[round ${round}] ${blockErr}\nRewrite the code WITHOUT that pattern — use only the documented REPL bindings.\n`;
        messages.push({ role: "user", content: observation });
        continue;
      }

      // SECURITY: strict-mode REGULAR async function (not an arrow). An arrow
      // inherits the top-level `this` (the context global); a strict regular
      // function forces `this === undefined`, closing the
      // `this.constructor.constructor` -> Function escape as a structural control
      // alongside the null-proto global in the bootstrap.
      const wrapped = `(async function () { "use strict";\n${code}\n })()`;
      const blockRes = await session.runBlock(wrapped);

      if (blockRes.final !== null) state.Final = blockRes.final;
      if (blockRes.error) execError = blockRes.error;

      if (blockRes.wedged) {
        // The worker was terminated (async-DoS kill or a fatal worker error).
        // It cannot be reused, so end the run here.
        options.onProgress?.({ type: "error", message: blockRes.error || "RLM worker terminated" });
        break;
      }

      if (state.Final !== null) {
        options.onProgress?.({ type: "final", chars: state.Final.length });
        break;
      }

      const stdoutFull = blockRes.stdout || "";
      const stdoutShown = stdoutFull.slice(0, STDOUT_PREFIX_CHARS);
      options.onProgress?.({ type: "stdout", round, output: stdoutShown });

      let observation = `[round ${round} stdout — ${stdoutFull.length} chars total, showing first ${STDOUT_PREFIX_CHARS}]:\n${
        stdoutShown || "(empty)"
      }\n`;
      if (execError) observation += `\n[execution error]: ${execError}\n`;
      observation += `\n[budget] subCalls used: ${state.subCalls}/${SUBLLM_MAX_CALLS}, root rounds remaining: ${
        ROOT_MAX_ITERATIONS - round
      }`;
      observation += `\n\nContinue. Call setFinal(answer) when ready.`;

      messages.push({ role: "user", content: observation });
    }

    if (state.Final === null) {
      return finalize(
        state,
        roundsRun,
        rootModel,
        subModel,
        "exhausted iterations without setFinal()",
      );
    }

    return finalize(state, roundsRun, rootModel, subModel);
  } finally {
    await session.terminate();
  }
}

export function shouldUseRecursive(messages: Array<{ role: string; content: any }>): boolean {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") chars += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const p of m.content) if (p?.text) chars += String(p.text).length;
    }
  }
  return chars / 3.5 > RLM_RECURSIVE_THRESHOLD_TOKENS;
}

export function flattenMessagesForRecursive(
  messages: Array<{ role: string; content: any }>,
): { prompt: string; taskHint: string } {
  const parts: string[] = [];
  let lastUser = "";
  for (const m of messages) {
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((p: any) => p?.type === "text" && typeof p.text === "string")
              .map((p: any) => p.text)
              .join("\n")
          : safeStringify(m.content);
    parts.push(`<<${m.role}>>\n${text}`);
    if (m.role === "user") lastUser = text;
  }
  return {
    prompt: parts.join("\n\n"),
    taskHint: lastUser ? `Most recent user request:\n${lastUser.slice(0, 1500)}` : "",
  };
}

function extractJsCodeBlock(text: string): string | null {
  const re = /```(?:js|javascript)?\s*\n([\s\S]*?)```/i;
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

// DEFENSE-IN-DEPTH blocklist, mirroring server/code-sandbox.ts. The real
// controls are "no out-of-realm objects cross the boundary" (subLLM is reboxed)
// + codeGeneration:{strings:false,wasm:false} + worker isolation. This regex
// layer raises the bar on realm-escape / host-reach attempts in the
// LLM-generated REPL code. The legitimate RLM bindings (prompt, len, slice,
// chunkText, subLLM, print, setFinal, Promise/JSON/Math/Number/String/Array/
// Object/Date) never trip it.
const BLOCKED_PATTERNS: RegExp[] = [
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bprocess\b/,
  /\bchild_process\b/,
  /\bfs\b\./,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /Proxy/,
  /Reflect\./,
  /\.constructor/,
  /__proto__/,
  /prototype\s*\[/,
  /globalThis/,
  /\bthis\b\s*\.\s*constructor/,
  /\[\s*["'`]\s*constructor/i,
  /\[\s*["'`]\s*__proto__/i,
  /\[\s*["'`]\s*prototype/i,
];

// Strip string/template literals and comments so the blocklist only inspects
// CODE, not prose. RLM sub-prompts routinely contain words like "process" or
// "constructor" inside string arguments to subLLM(...) — scanning raw source
// would wrongly block legitimate work. This is a heuristic (imperfect on exotic
// escapes) but acceptable: the blocklist is defense-in-depth only; the real
// controls are the null-proto global + strict `this` + reboxed subLLM + worker.
function stripLiteralsAndComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/\/\/[^\n]*/g, " ") // line comments
    .replace(/'(?:\\.|[^'\\])*'/g, "''") // single-quoted strings
    .replace(/"(?:\\.|[^"\\])*"/g, '""') // double-quoted strings
    .replace(/`(?:\\.|[^`\\])*`/g, "``"); // template literals
}

function validateSandboxCode(code: string): string | null {
  const scannable = stripLiteralsAndComments(code);
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(scannable)) {
      return `Blocked: code contains restricted pattern "${pattern.source}"`;
    }
  }
  return null;
}

function safeStringify(v: any): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function emptyResult(rootModel: string, subModel: string, error: string): RLMResult {
  return {
    ok: false,
    answer: null,
    rounds: 0,
    subCalls: 0,
    totalSubPromptChars: 0,
    totalSubResponseChars: 0,
    rootModel,
    subModel,
    error,
  };
}

function finalize(
  state: { Final: string | null; subCalls: number; totalSubPromptChars: number; totalSubResponseChars: number },
  rounds: number,
  rootModel: string,
  subModel: string,
  error?: string,
): RLMResult {
  return {
    ok: state.Final !== null && !error,
    answer: state.Final,
    rounds,
    subCalls: state.subCalls,
    totalSubPromptChars: state.totalSubPromptChars,
    totalSubResponseChars: state.totalSubResponseChars,
    rootModel,
    subModel,
    error,
  };
}
