import { execSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isLoaderHijackKey, sanitizeSpawnEnv } from "../../server/safety/spawn-env-guard";

export type ScheduledSeverity = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "INFO";
export type ScheduledFinding = { severity: ScheduledSeverity; message: string; detail?: unknown };

export const SECURITY_REGEX = "(?i)jailbreak|injection|ssrf|denied|blocked|rate.?limit|unauthor|forbidden|escalat|destruct";
export const REQUIRED_SCHEDULED_PASSES = [3, 4, 5];
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: string | null;
}

interface JsonHookResult {
  configured: boolean;
  payload: any | null;
  error?: string;
  exitCode?: number;
}

/**
 * Scheduled deployments cannot invoke Replit Agent callbacks (security_scan,
 * database, and deployment). These helpers define the narrow JSON boundary
 * used by operator-owned runners. Raw output is never returned for reporting.
 */
export function redactSensitive(text: string): string {
  let redacted = text;
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || !/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|DATABASE_URL|PIN|AUTH|SESSION|COOKIE)/i.test(key)) continue;
    redacted = redacted.split(value).join("[REDACTED]");
  }
  return redacted
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password|credential|private[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s]+)@/gi, "$1[REDACTED]@")
    .replace(/\b(?:sk|pk|rk|AIza)[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]");
}

export function safeErrorDetail(text: string, max = 800): string {
  return redactSensitive(text).replace(/\s+/g, " ").trim().slice(0, max);
}

function executeRunner(command: string, opts: { timeout?: number; env: NodeJS.ProcessEnv }): ExecResult {
  try {
    const stdout = execSync(command, {
      encoding: "utf-8",
      timeout: opts.timeout ?? 60_000,
      stdio: ["ignore", "pipe", "pipe"],
      env: opts.env,
    });
    return { stdout, stderr: "", exitCode: 0, signal: null };
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? "",
      exitCode: typeof error.status === "number" ? error.status : 1,
      signal: error.signal ?? null,
    };
  }
}

function parseJsonOutput(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Permit a short diagnostic before the JSON result, but only accept a
    // complete object/array line rather than an arbitrary substring.
    for (const line of trimmed.split("\n").reverse().slice(0, 20)) {
      const candidate = line.trim();
      if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
      try { return JSON.parse(candidate); } catch { /* keep looking */ }
    }
    return null;
  }
}

export function runJsonHook(
  envName: string,
  opts: { timeout?: number; env?: NodeJS.ProcessEnv } = {},
): JsonHookResult {
  const command = (process.env[envName] || "").trim();
  if (!command) return { configured: false, payload: null };

  const allowedBaseKeys = [
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP",
    "LANG", "LC_ALL", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  ];
  const requestedKeys = (process.env[`${envName}_ENV_ALLOWLIST`] || "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key) && !isLoaderHijackKey(key));
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of [...allowedBaseKeys, ...requestedKeys]) {
    const value = process.env[key];
    if (value !== undefined) childEnv[key] = value;
  }
  Object.assign(childEnv, opts.env || {});
  const result = executeRunner(command, { ...opts, env: sanitizeSpawnEnv(childEnv) });
  if (result.exitCode !== 0) {
    return {
      configured: true,
      payload: null,
      exitCode: result.exitCode,
      error: `${envName} exited ${result.exitCode}${result.signal ? ` (${result.signal})` : ""}: ${safeErrorDetail(result.stderr || result.stdout)}`,
    };
  }
  const payload = parseJsonOutput(result.stdout);
  if (payload === null) {
    return {
      configured: true,
      payload: null,
      exitCode: result.exitCode,
      error: `${envName} returned no parseable JSON`,
    };
  }
  return { configured: true, payload };
}

function scannerFindings(scanner: any): any[] | null {
  if (!scanner || typeof scanner !== "object") return [];
  for (const key of ["findings", "results", "vulnerabilities"]) {
    if (Array.isArray(scanner[key])) return scanner[key];
  }
  return null;
}

function scannerSeverity(value: unknown): ScheduledSeverity | null {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "CRITICAL") return "CRITICAL";
  if (normalized === "HIGH") return "HIGH";
  if (normalized === "MODERATE" || normalized === "MEDIUM") return "MODERATE";
  if (normalized === "LOW") return "LOW";
  if (normalized === "INFO" || normalized === "INFORMATIONAL") return "INFO";
  return null;
}

export function scannerSummary(
  label: string,
  scanner: any,
  findings: ScheduledFinding[],
): { hasSevere: boolean; hasModerate: boolean; unavailable: boolean } {
  if (!scanner || typeof scanner !== "object") {
    findings.push({ severity: "LOW", message: `${label} result missing from the scheduled security runner` });
    return { hasSevere: false, hasModerate: false, unavailable: true };
  }
  if (scanner.status !== "ok" || scanner.ok === false || scanner.truncated === true || scanner.coverageComplete === false) {
    findings.push({
      severity: "LOW",
      message: `${label} did not report an explicit complete ok result — coverage is unavailable`,
      detail: safeErrorDetail(String(scanner.error || scanner.message || scanner.status || "runner reported failure")),
    });
    return { hasSevere: false, hasModerate: false, unavailable: true };
  }

  const entries = scannerFindings(scanner);
  if (!entries) {
    findings.push({ severity: "LOW", message: `${label} did not return a recognized findings array — coverage is unavailable` });
    return { hasSevere: false, hasModerate: false, unavailable: true };
  }
  const counts: Record<ScheduledSeverity, number> = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0, INFO: 0 };
  const unclassified: any[] = [];
  for (const entry of entries) {
    const severity = scannerSeverity(entry?.severity);
    if (severity) counts[severity]++;
    else unclassified.push(entry);
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  findings.push({
    severity: counts.CRITICAL || counts.HIGH ? "HIGH" : counts.MODERATE ? "MODERATE" : "INFO",
    message: `${label}: ${total} finding(s) — critical=${counts.CRITICAL}, high=${counts.HIGH}, moderate=${counts.MODERATE}, low=${counts.LOW}, info=${counts.INFO}`,
  });
  for (const entry of entries
    .filter((item) => ["CRITICAL", "HIGH"].includes(String(item?.severity || "").toUpperCase()))
    .slice(0, 10)) {
    findings.push({
      severity: scannerSeverity(entry?.severity) || "HIGH",
      message: `${label} remediation evidence: ${safeErrorDetail(String(entry?.message || entry?.title || entry?.rule || "finding"))}`,
      detail: {
        location: safeErrorDetail(String(entry?.location?.file || entry?.location || entry?.file || "unknown"), 300),
        id: safeErrorDetail(String(entry?.checkId || entry?.id || entry?.hash || "unknown"), 160),
      },
    });
  }
  if (unclassified.length) {
    findings.push({ severity: "LOW", message: `${label} returned ${unclassified.length} finding(s) with an unknown severity — review runner output` });
  }
  return {
    hasSevere: counts.CRITICAL > 0 || counts.HIGH > 0,
    hasModerate: counts.MODERATE > 0,
    unavailable: scanner.coverageComplete === false || unclassified.length > 0,
  };
}

export function summarizeIntegrationRecords(records: any[]): {
  safeRecords: Array<{ name: string; current: string; available: string; advisory: string }>;
  malformedCount: number;
  hasIssues: boolean;
} {
  const safeRecords: Array<{ name: string; current: string; available: string; advisory: string }> = [];
  let malformedCount = 0;
  let hasIssues = false;
  for (const item of records) {
    const name = item?.name;
    const current = item?.currentVersion || item?.current;
    const available = item?.availableVersion || item?.latest;
    const advisory = item?.advisory || item?.securityAdvisory || "";
    if (typeof name !== "string" || !name.trim() || typeof current !== "string" || !current.trim()
      || typeof available !== "string" || !available.trim() || typeof advisory !== "string") {
      malformedCount++;
      continue;
    }
    if (advisory.trim() || item?.status === "error") hasIssues = true;
    safeRecords.push({
      name: safeErrorDetail(name, 120),
      current: safeErrorDetail(current, 80),
      available: safeErrorDetail(available, 80),
      advisory: safeErrorDetail(advisory, 240),
    });
  }
  return { safeRecords, malformedCount, hasIssues };
}

function findMatchingBrace(source: string, opening: number): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  for (let i = opening; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      const newline = source.indexOf("\n", i + 2);
      i = newline < 0 ? source.length : newline;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i;
  }
  return -1;
}

export function expectedSchemaFromSource(): Map<string, Set<string>> {
  const files = ["shared/schema.ts"];
  try {
    files.push(...readdirSync("shared/models").filter((file) => file.endsWith(".ts")).map((file) => join("shared/models", file)));
  } catch (error) {
    throw new Error(`cannot enumerate shared schema sources: ${safeErrorDetail(String(error))}`);
  }

  const tables = new Map<string, Set<string>>();
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const tablePattern = /\bpgTable\s*\(\s*(?:"([^"]+)"|'([^']+)')\s*,/g;
    let match: RegExpExecArray | null;
    while ((match = tablePattern.exec(source))) {
      const tableName = match[1] || match[2];
      const opening = source.indexOf("{", tablePattern.lastIndex);
      const closing = opening >= 0 ? findMatchingBrace(source, opening) : -1;
      if (!tableName || opening < 0 || closing < 0) throw new Error(`could not parse schema table declaration in ${file}`);
      const body = source.slice(opening + 1, closing);
      const columns = new Set<string>();
      const columnPattern = /\b[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$][\w$]*\s*\(\s*(?:"([^"]+)"|'([^']+)')/g;
      let column: RegExpExecArray | null;
      while ((column = columnPattern.exec(body))) {
        const columnName = column[1] || column[2];
        if (columnName) columns.add(columnName);
      }
      if (!columns.size) throw new Error(`could not parse columns for ${tableName} in ${file}`);
      const existing = tables.get(tableName) || new Set<string>();
      for (const columnName of columns) existing.add(columnName);
      tables.set(tableName, existing);
    }
  }
  if (!tables.size) throw new Error("no pgTable declarations found in shared schema sources");
  return tables;
}