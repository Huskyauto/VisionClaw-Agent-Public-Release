import { execSync } from "child_process";
import fs from "fs";
import path from "path";

import { logSilentCatch } from "./lib/silent-catch";
const CONFIG_PATH = path.join(process.cwd(), "data", "exec-config.json");
const WORKSPACE_ROOT = process.cwd();

interface ExecConfig {
  enabled: boolean;
  securityMode: "deny" | "allowlist" | "full";
  timeoutSeconds: number;
  maxOutputBytes: number;
  allowlist: string[];
  denyPatterns: string[];
  workdir: string;
}

const ADMIN_TENANT_ID = Number(process.env.ADMIN_TENANT_ID) || 1;

const DEFAULT_CONFIG: ExecConfig = {
  enabled: true,
  securityMode: "allowlist",
  timeoutSeconds: 30,
  maxOutputBytes: 32768,
  allowlist: [
    "ls", "cat", "head", "tail", "wc", "grep", "find", "date",
    "whoami", "pwd", "echo", "sort", "uniq", "cut", "tr",
    "diff", "file", "stat", "du", "df", "uname", "uptime",
    "which", "type", "realpath", "dirname", "basename", "jq",
    "sed", "awk", "xargs", "tee", "rev", "paste", "comm",
    "md5sum", "sha256sum", "base64", "yes", "seq", "printf",
  ],
  denyPatterns: [
    "rm -rf /", "rm -rf /*", "mkfs", "dd if=", "chmod 777 /",
    ":(){ :|:& };:", "> /dev/sd", "shutdown", "reboot", "halt",
    "kill -9 1", "killall", "pkill", "init 0", "init 6",
    "passwd", "useradd", "userdel", "groupadd",
    "iptables", "nft ", "ufw ",
    "mount ", "umount ", "fdisk",
    "nc -l", "ncat -l", "socat ",
    "eval ", "exec ", "source /dev",
    "export PATH=", "unset PATH",
    "python -c", "python3 -c", "node -e", "ruby -e", "perl -e",
    "curl ", "wget ", "env ",
  ],
  workdir: WORKSPACE_ROOT,
};

// Irreversible-damage / host-takedown commands. Enforced in EVERY security mode,
// INCLUDING owner-elevated "full" mode — this is accident prevention, not an
// access-control gate. The broader `denyPatterns` list above (curl/wget/node -e/
// exec/eval/env/...) is an allowlist-MODE restriction that the owner-at-keyboard
// `elevateToFull` path is intentionally allowed to bypass; these are NOT. Not
// user-editable on purpose — it's the hard floor under every mode. Kept as a
// subset of the catastrophic entries in `denyPatterns` (plus obvious bypass
// variants) so the floor stays robust even when the editable list is customized.
// Regex floor (matched against a normalized command — lowercased + whitespace
// collapsed) so trivial bypasses (case changes, extra/tab/newline whitespace,
// flag-order variants like `-rf` vs `-fr` vs `-r -f`) can't slip past.
const CATASTROPHIC_DENY: RegExp[] = [
  // rm recursive targeting filesystem root (`rm -rf /`, `/*`, `-fr`, `-r -f`, `--recursive`)
  /\brm\b[^|&;\n]*?\s-[^\s]*r[^\s]*\s+[^|&;\n]*?\/(\s|\*|$)/,
  /\brm\b[^|&;\n]*?\s--recursive\b[^|&;\n]*?\/(\s|\*|$)/,
  /\bmkfs\b/,
  /\bdd\b[^\n]*\bif=/,
  /(?:>|\bof=)\s*\/dev\/(?:sd|nvme|hd|vd)/,
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, // fork bomb
  /\bchmod\b[^|&;\n]*\b777\s+\/(\s|$)/,
  /\bshutdown\b/, /\breboot\b/, /\bhalt\b/, /\bpoweroff\b/,
  /\bkill\s+-9\s+1(\s|$)/,
  /\binit\s+[06](\s|$)/,
  /\bfdisk\b/,
];

// Lowercase + collapse all whitespace runs to single spaces so the regex floor
// and substring deny checks can't be evaded with case or whitespace tricks.
// Also unescape backslash-escapes and strip shell quotes BEFORE collapsing
// whitespace so quoted/escaped catastrophic targets can't slip the floor —
// e.g. `rm -rf "/"`, `rm -rf '/'`, `rm -rf \/` all normalize to `rm -rf /`.
function normalizeCommand(command: string): string {
  return command
    .toLowerCase()
    .replace(/\\(.)/g, "$1") // unescape `\/` → `/`, `\ ` → ` `, etc.
    .replace(/['"]/g, "")    // strip ' and " so quoted root targets are exposed
    .replace(/\s+/g, " ")
    .trim();
}

// Boundary-safe workspace containment. A naive `startsWith(WORKSPACE_ROOT)` lets
// a sibling like `/home/runner/workspace-evil` pass; require an exact match OR a
// real path-separator boundary.
function isWithinWorkspace(resolvedPath: string): boolean {
  const root = path.resolve(WORKSPACE_ROOT);
  const p = path.resolve(resolvedPath);
  return p === root || p.startsWith(root + path.sep);
}

export function loadExecConfig(): ExecConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (_silentErr) { logSilentCatch("server/exec-tool.ts", _silentErr); }
  return { ...DEFAULT_CONFIG };
}

export function saveExecConfig(updates: Partial<ExecConfig>): ExecConfig {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const current = loadExecConfig();

  if (updates.workdir) {
    const resolved = path.resolve(WORKSPACE_ROOT, updates.workdir);
    if (!isWithinWorkspace(resolved)) {
      throw new Error("Working directory must be within workspace");
    }
    updates.workdir = resolved;
  }

  const merged = { ...current, ...updates };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

function extractBinary(command: string): string {
  const trimmed = command.trim();
  const parts = trimmed.split(/\s+/);
  let bin = parts[0];
  if (bin.includes("/")) bin = bin.split("/").pop() || bin;
  return bin;
}

export function isCommandAllowed(command: string, config: ExecConfig): { allowed: boolean; reason?: string } {
  if (!config.enabled) {
    return { allowed: false, reason: "Exec tool is disabled. Enable it in Settings → Exec." };
  }

  if (config.securityMode === "deny") {
    return { allowed: false, reason: "Security mode is set to 'deny'. All execution blocked." };
  }

  // Catastrophic floor — irreversible-damage / host-takedown commands blocked in
  // EVERY mode, including owner-elevated full mode. Accident prevention.
  // Match against the normalized command so case/whitespace/flag-order can't evade.
  const normalized = normalizeCommand(command);
  for (const pattern of CATASTROPHIC_DENY) {
    if (pattern.test(normalized)) {
      return { allowed: false, reason: `Command matches catastrophic deny pattern: ${pattern.source}` };
    }
  }

  // Owner-at-keyboard full mode: the catastrophic floor above is the ONLY limit.
  // The broader denyPatterns / command-substitution / redirection / allowlist
  // restrictions are allowlist-mode-only and are intentionally bypassed here —
  // the owner-driven gate (admin tenant ∧ owner channel), the stripped env, and
  // workspace-root containment in executeCommand are the real fence.
  if (config.securityMode === "full") {
    return { allowed: true };
  }

  // Allowlist mode (agents, self-heal, customer tenants): full restriction set.
  for (const pattern of config.denyPatterns) {
    if (command.includes(pattern)) {
      return { allowed: false, reason: `Command matches deny pattern: "${pattern}"` };
    }
  }

  if (command.includes("`") || command.includes("$(")) {
    return { allowed: false, reason: "Command substitution ($() / backticks) is not allowed." };
  }

  if (/[><]/.test(command)) {
    return { allowed: false, reason: "I/O redirection (>, <) is not allowed in allowlist mode." };
  }

  const segments = command.split(/\s*(?:&&|\|\||;)\s*/);
  for (const segment of segments) {
    const pipeParts = segment.split(/\s*\|\s*/);
    for (const pipePart of pipeParts) {
      const bin = extractBinary(pipePart.trim());
      if (!bin) continue;
      if (!config.allowlist.includes(bin)) {
        return {
          allowed: false,
          reason: `Binary "${bin}" is not in the allowlist. Allowed: ${config.allowlist.slice(0, 15).join(", ")}...`,
        };
      }
    }
  }

  return { allowed: true };
}

export interface ExecResult {
  success: boolean;
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
  error?: string;
  securityMode?: string;
}

export async function executeCommand(command: string, options?: {
  workdir?: string;
  timeout?: number;
  elevateToFull?: boolean;
}): Promise<ExecResult> {
  const baseConfig = loadExecConfig();
  // Owner-driven calls (Bob at the keyboard via the owner-gated exec dispatch)
  // may elevate allowlist→full so the agent can use cd / pipes / redirection /
  // command substitution / curl / node -e / any tooling it needs. The hard
  // safety floor STILL applies even in full mode: the CATASTROPHIC_DENY list
  // (rm -rf /, mkfs, dd, fork bomb, shutdown, ...) runs before the full-mode
  // short-circuit in isCommandAllowed, plus the stripped env (no secrets handed
  // to the shell) and workspace-root containment below. The broader denyPatterns
  // (exec/eval/curl/wget/env/node -e/...) and the command-substitution +
  // redirection blocks are allowlist-MODE restrictions, intentionally bypassed
  // for the owner. An explicit 'deny' kill switch or a disabled tool is NOT
  // overridden — we only ever upgrade the default 'allowlist' mode.
  const config = (options?.elevateToFull && baseConfig.securityMode === "allowlist")
    ? { ...baseConfig, securityMode: "full" as const }
    : baseConfig;
  const check = isCommandAllowed(command, config);

  if (!check.allowed) {
    return {
      success: false,
      command,
      error: check.reason || "Command not allowed",
      securityMode: config.securityMode,
    };
  }

  let workdir = config.workdir || WORKSPACE_ROOT;
  if (options?.workdir) {
    const resolved = path.resolve(WORKSPACE_ROOT, options.workdir);
    if (!isWithinWorkspace(resolved)) {
      return {
        success: false,
        command,
        error: "Working directory must be within workspace",
        securityMode: config.securityMode,
      };
    }
    // R95.c — Symlink/realpath containment check. Prior implementation only
    // did `path.resolve` + prefix check, which a symlinked dir under
    // workspace could trivially defeat (symlink → /etc, command runs there).
    try {
      const fsSync = await import("node:fs");
      const lst = fsSync.lstatSync(resolved);
      if (lst.isSymbolicLink()) {
        return { success: false, command, error: "Working directory must not be a symlink", securityMode: config.securityMode };
      }
      const real = fsSync.realpathSync(resolved);
      if (!isWithinWorkspace(real)) {
        return { success: false, command, error: "Working directory realpath escapes workspace", securityMode: config.securityMode };
      }
      workdir = real;
    } catch (e: any) {
      return { success: false, command, error: `Working directory check failed: ${e.message}`, securityMode: config.securityMode };
    }
  }

  const timeout = Math.min(
    (options?.timeout || config.timeoutSeconds) * 1000,
    config.timeoutSeconds * 1000
  );

  const start = Date.now();

  try {
    const result = execSync(command, {
      cwd: workdir,
      timeout,
      maxBuffer: config.maxOutputBytes,
      encoding: "utf-8",
      // SECURITY: stripped env — exec is owner-only but if owner runs a
      // prompt-injected shell command, do NOT hand it the platform's secrets
      // (every other tenant's API keys, OAuth tokens, etc. live in process.env).
      // Whitelist only the bare minimum needed for shell utilities to function.
      env: {
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        HOME: WORKSPACE_ROOT,
        PWD: workdir,
        LANG: process.env.LANG || "en_US.UTF-8",
        LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
        TERM: process.env.TERM || "dumb",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const durationMs = Date.now() - start;
    const stdout = (result || "").toString();
    const truncated = stdout.length >= config.maxOutputBytes;

    return {
      success: true,
      command,
      stdout: truncated ? stdout.slice(0, config.maxOutputBytes) : stdout,
      stderr: "",
      exitCode: 0,
      durationMs,
      truncated,
      securityMode: config.securityMode,
    };
  } catch (err: any) {
    const durationMs = Date.now() - start;

    if (err.killed || err.signal === "SIGTERM") {
      return {
        success: false,
        command,
        error: `Command timed out after ${timeout / 1000}s`,
        durationMs,
        securityMode: config.securityMode,
      };
    }

    return {
      success: err.status === 0,
      command,
      stdout: (err.stdout || "").toString().slice(0, config.maxOutputBytes),
      stderr: (err.stderr || "").toString().slice(0, 4096),
      exitCode: err.status ?? 1,
      durationMs,
      securityMode: config.securityMode,
    };
  }
}

export function isExecEnabled(): boolean {
  return loadExecConfig().enabled;
}

export function getExecStatus() {
  const config = loadExecConfig();
  return {
    enabled: config.enabled,
    securityMode: config.securityMode,
    timeoutSeconds: config.timeoutSeconds,
    allowlistCount: config.allowlist.length,
    denyPatternCount: config.denyPatterns.length,
  };
}
