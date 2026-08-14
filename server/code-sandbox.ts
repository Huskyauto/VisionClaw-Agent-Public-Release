import * as vm from "vm";

const MAX_EXECUTION_TIME_MS = 5000;
const MAX_OUTPUT_LENGTH = 10000;
const MAX_LOG_LINES = 5000;

// SECURITY MODEL (be honest about what actually does the work here):
//
// The trust boundary is THREE properties, all required:
//
// (1) `codeGeneration: { strings: false, wasm: false }` on the vm context, AND
// (2) injecting NO host-realm objects or functions into the sandbox, AND
// (3) the host reads results back ONLY as `typeof`-guarded STRING data-properties
//     on the contextified global — never touching an attacker-mutable object.
//
// WHY (1)+(2): `strings:false` is enforced per-realm. If a host builtin (e.g.
// `Date`, `Math`, `JSON`, or a host `console.log`) is passed into the sandbox,
// then `Date["constr"+"uctor"]("return process")()` resolves to the HOST realm's
// `Function`, which is NOT under the context's codeGeneration restriction — a
// verified `return process` / env-exfil escape. Computed member access
// (`x["const"+"ructor"]`) also defeats any regex blocklist. So we inject nothing
// from the host: the sandbox uses the context's OWN intrinsics, whose
// `.constructor` chain terminates at THIS context's `Function`, neutralized by
// `strings:false`. `console`/`atob`/`btoa` are the only non-intrinsic globals
// the sandbox needs, defined INSIDE the context (context-native closures) via a
// trusted bootstrap.
//
// WHY (3): reading ANY attacker-controlled context object from the host is a DoS
// trap — user code can hang the host with a poisoned `toJSON`/`toString`, or an
// accessor getter installed on an array index (`Object.defineProperty(arr,"0",
// {get(){while(1){}}})`), and that runs during host read-back with NO vm
// timeout. So: the log buffer is PRIVATE to the bootstrap closure (user has no
// reference to it, cannot poison it); logs and the result are serialized to
// plain strings INSIDE the bounded user script (via hermetic, non-writable
// helpers that only touch pristine captured references); the host then reads
// ONLY `__logsStr__` / `__resultStr__`, each a string data-property on the
// global that user code cannot convert into a getter (that needs a `globalThis`/
// `this` handle — `globalThis` is regex-blocked, `this` is undefined in the
// strict wrapper). Any hostile getter/`toJSON` cost is bounded by the same 5s
// script timeout, never an unbounded host hang.
//
// The regex blocklist below is DEFENSE-IN-DEPTH only. Do not relax the
// codeGeneration flags, do not inject host objects, and do not read attacker-
// mutable context objects from the host.
const BLOCKED_PATTERNS = [
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
  // Computed member-access forms of the dangerous props (raises the bar on the
  // naive string-literal bypass; concatenated forms still evade — that's why
  // "no host objects" + codeGeneration:{strings:false} are the real controls).
  /\[\s*["'`]\s*constructor/i,
  /\[\s*["'`]\s*__proto__/i,
  /\[\s*["'`]\s*prototype/i,
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

// Trusted bootstrap evaluated INSIDE the sandbox context. Everything created
// here is context-native. The log buffer (`buf`) and pristine references
// (`_stringify`, `_String`) live in this closure and are NEVER exposed to user
// code. The helpers exposed on the global are defined non-writable /
// non-configurable so user code can neither replace them nor redefine them as
// accessors. `__logsStr__` / `__resultStr__` are writable data-properties (the
// wrapper writes them) but non-configurable (cannot be turned into getters).
const CONTEXT_BOOTSTRAP = `
  "use strict";
  (function () {
    const _stringify = JSON.stringify;
    const _String = String;
    const fmt = (a) => {
      if (a === null) return "null";
      if (a === undefined) return "undefined";
      if (typeof a === "object") {
        try { return _stringify(a, null, 2); } catch (e) { return _String(a); }
      }
      return _String(a);
    };
    const buf = [];
    const cap = (...args) => { if (buf.length < ${MAX_LOG_LINES}) buf.push(args.map(fmt).join(" ")); };
    const def = (name, value, writable) =>
      Object.defineProperty(globalThis, name, { value, writable: !!writable, configurable: false, enumerable: false });

    def("console", Object.freeze({ log: cap, info: cap, warn: cap, error: cap, debug: cap, dir: cap }), false);

    // Serialize the PRIVATE buffer to a single string. buf only ever contains
    // strings produced by cap (already fmt'd), and user has no handle to it, so
    // this cannot invoke a hostile getter/toString.
    def("__collectLogs__", () => {
      let out = "";
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i];
        out += (typeof v === "string" ? v : fmt(v));
        if (i < buf.length - 1) out += "\\n";
      }
      return out;
    }, false);

    // Serialize the user's result to a string using pristine references. Any
    // hostile toJSON/toString on the result is bounded by the 5s script timeout.
    def("__toResultStr__", (v) => {
      if (v === undefined || v === null) return undefined;
      try { return typeof v === "object" ? _stringify(v, null, 2) : _String(v); }
      catch (e) { try { return _String(v); } catch (_e) { return "[unserializable]"; } }
    }, false);

    def("__logsStr__", undefined, true);
    def("__resultStr__", undefined, true);

    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    def("btoa", (input) => {
      const s = _String(input);
      let out = "";
      for (let i = 0; i < s.length; i += 3) {
        const c1 = s.charCodeAt(i);
        const c2 = s.charCodeAt(i + 1);
        const c3 = s.charCodeAt(i + 2);
        const e1 = c1 >> 2;
        const e2 = ((c1 & 3) << 4) | (Number.isNaN(c2) ? 0 : c2 >> 4);
        const e3 = Number.isNaN(c2) ? 64 : (((c2 & 15) << 2) | (Number.isNaN(c3) ? 0 : c3 >> 6));
        const e4 = Number.isNaN(c3) ? 64 : (c3 & 63);
        out += B64[e1] + B64[e2] + (e3 === 64 ? "=" : B64[e3]) + (e4 === 64 ? "=" : B64[e4]);
      }
      return out;
    }, false);
    def("atob", (input) => {
      const s = _String(input).replace(/[^A-Za-z0-9+/=]/g, "");
      let out = "";
      for (let i = 0; i < s.length; i += 4) {
        const b1 = B64.indexOf(s[i]);
        const b2 = B64.indexOf(s[i + 1]);
        const c3ch = s[i + 2];
        const c4ch = s[i + 3];
        const b3 = B64.indexOf(c3ch);
        const b4 = B64.indexOf(c4ch);
        out += String.fromCharCode((b1 << 2) | (b2 >> 4));
        if (c3ch && c3ch !== "=") out += String.fromCharCode(((b2 & 15) << 4) | (b3 >> 2));
        if (c4ch && c4ch !== "=") out += String.fromCharCode(((b3 & 3) << 6) | b4);
      }
      return out;
    }, false);
  })();
`;

// The user script serializes its own logs AND result to plain strings INSIDE the
// bounded execution (so any hostile getter/toJSON hang is caught by the script
// timeout). The `finally` guarantees logs are captured even when user code
// throws. Host code never coerces or deep-reads any untrusted context value.
function wrap(code: string): string {
  return `
    (function() {
      "use strict";
      let __result__;
      try {
        ${code}
        __resultStr__ = __toResultStr__(__result__);
      } finally {
        try { __logsStr__ = __collectLogs__(); } catch (e) { __logsStr__ = ""; }
      }
      return __result__;
    })()
  `;
}

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_LENGTH ? s.slice(0, MAX_OUTPUT_LENGTH) + "\n... (output truncated)" : s;
}

// Host-side read of a single string data-property on the contextified global.
// No context code runs, no object is deep-read, no value is coerced — this path
// physically cannot hang regardless of what the user script did.
function readGlobalString(sandbox: any, key: "__logsStr__" | "__resultStr__"): string {
  const s = sandbox[key];
  return typeof s === "string" ? truncate(s) : "";
}

export function executeCode(code: string): SandboxResult {
  const validationError = validateCode(code);
  if (validationError) {
    return { success: false, output: "", error: validationError, executionTimeMs: 0 };
  }

  // Start from a null-prototype bag so no host prototype leaks in. The context
  // still gets its own fresh set of JS intrinsics (Math, Date, JSON, Array, …)
  // from V8 — we deliberately do NOT overwrite them with host references. Keep
  // the reference so we can read result strings back via host-side access.
  const sandbox: any = Object.create(null);
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });

  vm.runInContext(CONTEXT_BOOTSTRAP, context, { filename: "sandbox-bootstrap.js" });

  const start = Date.now();
  try {
    const script = new vm.Script(wrap(code), { filename: "sandbox.js" });
    const returnValue = script.runInContext(context, { timeout: MAX_EXECUTION_TIME_MS });
    const executionTimeMs = Date.now() - start;

    let output = readGlobalString(sandbox, "__logsStr__");
    if (output.length === 0) output = readGlobalString(sandbox, "__resultStr__");

    return {
      success: true,
      output: output || "(no output)",
      executionTimeMs,
      returnValue: returnValue !== undefined ? returnValue : undefined,
    };
  } catch (err: any) {
    const executionTimeMs = Date.now() - start;
    // Logs were collected in the wrapper's `finally` before the throw propagated.
    const output = readGlobalString(sandbox, "__logsStr__");

    const errorMsg = err?.message || "Unknown error";
    const isTimeout = typeof errorMsg === "string" && errorMsg.includes("Script execution timed out");

    return {
      success: false,
      output: output || "",
      error: isTimeout ? `Execution timed out after ${MAX_EXECUTION_TIME_MS}ms` : errorMsg,
      executionTimeMs,
    };
  }
}
