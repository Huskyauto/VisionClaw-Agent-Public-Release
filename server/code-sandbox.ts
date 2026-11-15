import { spawn } from "node:child_process";

export interface SandboxResult {
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
  returnValue?: any;
}

// This entire factory is self-contained so its compiled JS can run without a
// TS loader or workspace imports in the disposable, credential-free child.
function sandboxRuntime(vm: typeof import("node:vm")) {
const MAX_EXECUTION_TIME_MS = 5000;
const MAX_OUTPUT_LENGTH = 10000;
const MAX_LOG_LINES = 5000;

// SECURITY MODEL (be honest about what actually does the work here):
//
// Resource containment is enforced OUTSIDE this VM: a disposable process,
// total-address-space/CPU/core limits, bounded pipes, admission and a parent
// wall deadline. This VM is not an OS privilege boundary.
// The inner context restrictions are THREE properties, all required:
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
// ONLY `__logsStr__` / `__resultStr__` / `__resultType__`, each a string
// data-property on the global that user code cannot convert into a getter (that needs a `globalThis`/
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
// accessors. `__logsStr__` / `__resultStr__` / `__resultType__` are writable
// data-properties (the wrapper writes them) but non-configurable (cannot be
// turned into getters).
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
      if (v === undefined) return undefined;
      try {
        const serialized = typeof v === "object" ? _stringify(v, null, 2) : _String(v);
        if (typeof serialized !== "string") throw new TypeError("result produced no serialized value");
        return serialized;
      } catch (e) {
        const detail = e && typeof e.message === "string" ? ": " + e.message : "";
        throw new TypeError("Sandbox result serialization failed" + detail);
      }
    }, false);

    def("__logsStr__", undefined, true);
    def("__resultStr__", undefined, true);
    def("__resultType__", undefined, true);
    def("__storeResult__", (v) => {
      const type = typeof v;
      const serialized = __toResultStr__(v);
      __resultStr__ = serialized;
      __resultType__ = type;
    }, false);
    def("__storeLogs__", () => {
      __logsStr__ = __collectLogs__();
    }, false);

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
      const __safeStoreResult__ = __storeResult__;
      const __safeStoreLogs__ = __storeLogs__;
      let __result__;
      try {
        (function() {
          "use strict";
          ${code}
        })();
        __safeStoreResult__(__result__);
      } catch (error) {
        // The error (including hostile getters/coercion) stays INSIDE the
        // timed VM. Only a primitive string may cross the context boundary.
        const message = error && typeof error.message === "string" ? error.message : "Sandbox execution failed";
        __safeStoreResult__(undefined);
        throw String(message);
      } finally {
        __safeStoreLogs__();
      }
      return undefined;
    })()
  `;
}

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_LENGTH ? s.slice(0, MAX_OUTPUT_LENGTH) + "\n... (output truncated)" : s;
}

// Host-side read of a single string data-property on the contextified global.
// No context code runs, no object is deep-read, no value is coerced — this path
// physically cannot hang regardless of what the user script did.
function readGlobalRawString(
  sandbox: any,
  key: "__logsStr__" | "__resultStr__" | "__resultType__",
): string | undefined {
  const s = sandbox[key];
  return typeof s === "string" ? s : undefined;
}

function readGlobalString(
  sandbox: any,
  key: "__logsStr__" | "__resultStr__",
): string {
  return truncate(readGlobalRawString(sandbox, key) ?? "");
}

function rebuildSafeReturnValue(sandbox: any): unknown {
  const raw = readGlobalRawString(sandbox, "__resultStr__");
  const type = readGlobalRawString(sandbox, "__resultType__");
  if (type === "undefined") return undefined;
  if (raw === undefined || type === undefined) {
    throw new Error("Sandbox result reconstruction failed: missing serialized result metadata");
  }
  if (type === "object") {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error("Sandbox result reconstruction failed: invalid serialized object", { cause: error });
    }
  }
  if (type === "number") return Number(raw);
  if (type === "boolean") return raw === "true";
  return raw;
}

function executeInContext(code: string): SandboxResult {
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
    microtaskMode: "afterEvaluate",
  });

  vm.runInContext(CONTEXT_BOOTSTRAP, context, { filename: "sandbox-bootstrap.js" });

  const start = Date.now();
  try {
    const script = new vm.Script(wrap(code), { filename: "sandbox.js" });
    script.runInContext(context, { timeout: MAX_EXECUTION_TIME_MS });
    const executionTimeMs = Date.now() - start;

    let output = readGlobalString(sandbox, "__logsStr__");
    if (output.length === 0) output = readGlobalString(sandbox, "__resultStr__");
    const safeReturnValue = rebuildSafeReturnValue(sandbox);

    return {
      success: true,
      output: output || "(no output)",
      executionTimeMs,
      returnValue: safeReturnValue,
    };
  } catch (err: any) {
    const executionTimeMs = Date.now() - start;
    // Logs were collected in the wrapper's `finally` before the throw propagated.
    const output = readGlobalString(sandbox, "__logsStr__");

    // User throws were serialized in the timed context; native VM timeout
    // errors are created by Node, not by submitted JavaScript.
    const errorMsg = typeof err === "string" ? err : "Sandbox execution failed or timed out";
    const isTimeout = typeof errorMsg === "string" && errorMsg.includes("Script execution timed out");

    return {
      success: false,
      output: output || "",
      error: isTimeout ? `Execution timed out after ${MAX_EXECUTION_TIME_MS}ms` : errorMsg,
      executionTimeMs,
    };
  }
}
return executeInContext;
}

let activeChildren = 0;
const MAX_CHILDREN = 2;
const WALL_LIMIT_MS = 6500;
const MAX_WIRE_BYTES = 128 * 1024;

/** Process/VM containment, not a claim of OS privilege separation or a secure
 * general-purpose hostile-code host. Missing resource limiter fails CLOSED.
 * prlimit bounds total address space (including ArrayBuffers), CPU and core
 * dumps; the independent parent owns a hard wall deadline and output cap. */
export async function executeCode(code: string): Promise<SandboxResult> {
  const started = Date.now();
  const failure = (error: string): SandboxResult => ({
    success: false, output: "", error, executionTimeMs: Date.now() - started,
  });
  if (typeof code !== "string" || code.length > 50_000) {
    return failure("Code must be a string of at most 50,000 characters");
  }
  if (activeChildren >= MAX_CHILDREN) return failure("Sandbox capacity reached; no code executed");
  activeChildren++;
  // __name is emitted by tsx/esbuild's keep-names transform. Keeping the
  // factory self-contained also makes this work in the bundled production JS.
  const source = `const __name = (fn) => fn;
    const execute = (${sandboxRuntime.toString()})(require("node:vm"));
    const code = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    process.stdout.write(JSON.stringify(execute(code)));`;
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("/usr/bin/prlimit", [
        "--as=536870912", "--cpu=6", "--core=0", "--",
        process.execPath, "--jitless", "--max-old-space-size=64", "-e", source,
      ], { env: {}, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      activeChildren--;
      resolve(failure("Sandbox isolation unavailable; no fallback execution"));
      return;
    }
    let settled = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const finish = (result: SandboxResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(failure("Sandbox execution timed out; isolated child terminated"));
    }, WALL_LIMIT_MS);
    child.stdout!.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_WIRE_BYTES) {
        child.kill("SIGKILL");
        finish(failure("Sandbox output exceeded its transfer limit"));
      } else chunks.push(chunk);
    });
    // Drain without retaining OOM diagnostics or attacker-controlled messages.
    child.stderr!.resume();
    child.stdin!.on("error", () => {
      child.kill("SIGKILL");
      finish(failure("Sandbox input transfer failed"));
    });
    child.on("error", () => finish(failure("Sandbox isolation unavailable; no fallback execution")));
    child.on("close", (exitCode) => {
      // Retain admission until the OS confirms the child exited, even when
      // its caller's deadline has already fired.
      activeChildren--;
      if (settled) return;
      if (exitCode !== 0) return finish(failure("Sandbox child terminated or exceeded a resource limit"));
      try {
        const result: SandboxResult = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (typeof result.success !== "boolean" || typeof result.output !== "string") {
          throw new Error("Invalid child response");
        }
        finish({ ...result, executionTimeMs: Date.now() - started });
      } catch {
        finish(failure("Sandbox returned an invalid result"));
      }
    });
    child.stdin!.end(JSON.stringify(code));
  });
}
