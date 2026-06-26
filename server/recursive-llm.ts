import vm from "node:vm";
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

// THREAT MODEL: this module assumes the ROOT LLM (a trusted modelfarm model) is
// the source of executed code. The user's prompt is exposed as a string literal
// only; the user does NOT directly write code that runs in the vm. Node vm is
// not a security boundary against an adversarial code author, but it is an
// adequate isolation layer when the code author is a non-malicious LLM and the
// recovery path is the only entry point. See replit.md R74.13z deferred work
// for the future process-isolation rearchitecture.

export const RLM_RECURSIVE_THRESHOLD_TOKENS = 150_000;
export const RLM_DEFAULT_ROOT_MODEL = "gpt-5.5";
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

  // Semaphore to cap parallel sub-LLM calls (defense vs. runaway cost / rate limits).
  let inFlight = 0;
  const waitForSlot = (): Promise<void> =>
    new Promise((resolve) => {
      const tryAcquire = () => {
        if (inFlight < SUBLLM_MAX_CONCURRENCY) {
          inFlight++;
          resolve();
        } else {
          setTimeout(tryAcquire, 25);
        }
      };
      tryAcquire();
    });

  // Host-realm implementations of the bindings. These are NOT exposed directly
  // to the sandbox — instead, sandbox-realm wrappers (installed via runInContext
  // below) call into these via a single bridge object whose .constructor reaches
  // host Function. We therefore never let the bridge leak past the wrappers.
  const __host = {
    promptString: userPrompt,
    appendStdout: (line: string) => {
      sandbox.__stdout += line + "\n";
    },
    storeFinal: (answer: string) => {
      state.Final = answer;
    },
    callSubLLM: async (subPrompt: string) => {
      if (options.signal?.aborted) throw new Error("aborted");
      if (state.subCalls >= SUBLLM_MAX_CALLS) {
        throw new Error(`subLLM budget exceeded (max ${SUBLLM_MAX_CALLS})`);
      }
      const trimmed = String(subPrompt ?? "").slice(0, SUBLLM_MAX_PROMPT_CHARS);
      await waitForSlot();
      state.subCalls++;
      state.totalSubPromptChars += trimmed.length;
      try {
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
        const content = resp?.choices?.[0]?.message?.content || "";
        state.totalSubResponseChars += content.length;
        options.onProgress?.({
          type: "subllm",
          promptChars: trimmed.length,
          responseChars: content.length,
        });
        return content;
      } catch (err: any) {
        const msg = String(err?.message || err);
        options.onProgress?.({ type: "error", message: `subLLM: ${msg.slice(0, 120)}` });
        return `[subLLM error: ${msg.slice(0, 200)}]`;
      } finally {
        inFlight = Math.max(0, inFlight - 1);
      }
    },
  };

  // Minimal sandbox object — no host primordials are injected. The sandbox
  // realm has its own Object/Array/String/etc accessible via `{}.constructor`,
  // `[].constructor`, etc. (those resolve to sandbox-realm intrinsics, not host).
  const sandbox: any = {
    __host, // bridge — wrapped immediately below; sandbox code never sees this directly
    __stdout: "",
  };

  const ctx = vm.createContext(sandbox, {
    name: "rlm-sandbox",
    codeGeneration: { strings: false, wasm: false },
  });

  // Install sandbox-realm wrappers so that `subLLM`, `print`, `setFinal`, `slice`,
  // `len`, `chunkText`, and `prompt` all have .constructor === sandbox-realm Function.
  // Then DELETE the bridge so subsequent sandbox code cannot reach host functions.
  const PROMPT_LITERAL = JSON.stringify(userPrompt);
  vm.runInContext(
    `
    (function installBindings() {
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
      globalThis.subLLM = function subLLM(text) { return __h.callSubLLM(text); };
      delete globalThis.__host;
    })();
    `,
    ctx,
    { timeout: 1_000 },
  );

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

    sandbox.__stdout = "";
    let execError: string | null = null;
    try {
      const wrapped = `(async () => { ${code}\n })()`;
      const result = vm.runInContext(wrapped, ctx, { timeout: REPL_SYNC_TIMEOUT_MS });
      await Promise.race([
        result,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`REPL block exceeded ${REPL_TOTAL_TIMEOUT_MS}ms`)),
            REPL_TOTAL_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (err: any) {
      execError = String(err?.message || err).slice(0, 500);
    }

    if (state.Final !== null) {
      options.onProgress?.({ type: "final", chars: state.Final.length });
      break;
    }

    const stdoutFull = sandbox.__stdout || "";
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
