import * as vm from "vm";

import { logSilentCatch } from "./lib/silent-catch";
const MAX_EXECUTION_TIME_MS = 5000;
const MAX_OUTPUT_LENGTH = 10000;

const BLOCKED_PATTERNS = [
  /require\s*\(/,
  /import\s*\(/,
  /process\./,
  /child_process/,
  /\bfs\b\./,
  /eval\s*\(/,
  /Function\s*\(/,
  /Proxy/,
  /Reflect\./,
  /\.constructor/,
  /__proto__/,
  /prototype\s*\[/,
  /globalThis/,
  /\bthis\b\s*\.\s*constructor/,
];

interface SandboxResult {
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
  returnValue?: any;
}

function validateCode(code: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      return `Blocked: code contains restricted pattern "${pattern.source}"`;
    }
  }
  if (code.length > 50000) {
    return "Code exceeds maximum length of 50,000 characters";
  }
  return null;
}

function freezeDeep(obj: any, depth = 0): void {
  if (depth > 3 || obj === null || obj === undefined) return;
  if (typeof obj !== "object" && typeof obj !== "function") return;
  try {
    Object.freeze(obj);
  } catch (_silentErr) { logSilentCatch("server/code-sandbox.ts", _silentErr); }
}

export function executeCode(code: string): SandboxResult {
  const validationError = validateCode(code);
  if (validationError) {
    return { success: false, output: "", error: validationError, executionTimeMs: 0 };
  }

  const logs: string[] = [];
  const capture = (...args: any[]) => {
    const line = args.map(a => {
      if (a === null) return "null";
      if (a === undefined) return "undefined";
      if (typeof a === "object") {
        try { return JSON.stringify(a, null, 2); } catch { return String(a); }
      }
      return String(a);
    }).join(" ");
    logs.push(line);
  };

  const safeConsole = Object.freeze({
    log: capture, info: capture, warn: capture, error: capture, debug: capture, dir: capture
  });

  const sandbox: Record<string, any> = {
    console: safeConsole,
    Math,
    Date,
    JSON: Object.freeze({ parse: JSON.parse, stringify: JSON.stringify }),
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Number,
    String,
    Boolean,
    Array,
    Object: Object.freeze({
      keys: Object.keys,
      values: Object.values,
      entries: Object.entries,
      assign: Object.assign,
      freeze: Object.freeze,
      fromEntries: Object.fromEntries,
    }),
    Map,
    Set,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    Symbol,
    BigInt,
    Intl,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
    btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    fetch: undefined,
    XMLHttpRequest: undefined,
    WebSocket: undefined,
    global: undefined,
    globalThis: undefined,
    module: undefined,
    exports: undefined,
    require: undefined,
    __dirname: undefined,
    __filename: undefined,
    Buffer: undefined,
    process: undefined,
    queueMicrotask: undefined,
  };

  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });

  const wrappedCode = `
    (function() {
      "use strict";
      let __result__;
      ${code}
      return __result__;
    })()
  `;

  const start = Date.now();
  try {
    const script = new vm.Script(wrappedCode, { filename: "sandbox.js" });
    const returnValue = script.runInContext(context, { timeout: MAX_EXECUTION_TIME_MS });
    const executionTimeMs = Date.now() - start;

    let output = logs.join("\n");
    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(0, MAX_OUTPUT_LENGTH) + "\n... (output truncated)";
    }

    if (returnValue !== undefined && logs.length === 0) {
      const retStr = typeof returnValue === "object"
        ? JSON.stringify(returnValue, null, 2)
        : String(returnValue);
      output = retStr;
    }

    return {
      success: true,
      output: output || "(no output)",
      executionTimeMs,
      returnValue: returnValue !== undefined ? returnValue : undefined,
    };
  } catch (err: any) {
    const executionTimeMs = Date.now() - start;
    let output = logs.join("\n");
    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(0, MAX_OUTPUT_LENGTH) + "\n... (output truncated)";
    }

    const errorMsg = err.message || "Unknown error";
    const isTimeout = errorMsg.includes("Script execution timed out");

    return {
      success: false,
      output: output || "",
      error: isTimeout ? `Execution timed out after ${MAX_EXECUTION_TIME_MS}ms` : errorMsg,
      executionTimeMs,
    };
  }
}
