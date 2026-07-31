// Human-verified suppression allowlist for the tenant-isolation audit.
// data/tenant-isolation-audit/suppressions.json holds findings a HUMAN-DRIVEN
// triage campaign verified as false positives (each entry cites the benign
// pattern + evidence). FAIL CLOSED at every step: a missing/unparseable file or
// a malformed entry suppresses NOTHING; an entry only fires on exact file match
// + issue substring match (min 12 chars, resistant to line-number drift) + a
// recognized benign pattern name.
import fs from "fs";
import { logSilentCatch } from "./silent-catch";

export interface SuppressionEntry {
  file: string;
  pattern: string;
  match: string;
  anchor: string; // structural fingerprint "op:table" derived from the issue text
  reason: string;
  verifiedBy: string;
  date: string;
}

// Deterministic structural fingerprint of an audit finding: SQL operation +
// target table, extracted from the issue text. Shared by allowlist GENERATION
// and MATCH time so a suppression only fires when the new finding describes
// the SAME operation on the SAME table — a shared prose phrase alone is not
// enough. Returns null when no operation/table is identifiable (such findings
// can never be suppressed: fail closed / under-suppress).
const ANCHOR_STOPWORDS = new Set([
  "that", "this", "with", "from", "into", "where", "when", "which", "without",
  "the", "and", "for", "are", "not", "all", "any", "but", "can", "may", "via",
  "rows", "row", "table", "tables", "column", "columns", "clause", "query",
  "select", "insert", "update", "delete", "upsert", "tenant", "tenants",
  "against", "will", "does", "uses", "using", "only", "also", "each", "every",
  "tenant_id", "project_id", "created_at", "updated_at",
]);

// Live schema table names (single source of truth: shared/schema.ts pgTable
// declarations). Loaded lazily, fail-open to empty set — an empty set only
// makes anchoring STRICTER (fewer suppressions), never looser.
let knownTablesCache: Set<string> | null = null;
function knownTables(): Set<string> {
  if (knownTablesCache) return knownTablesCache;
  const tables = new Set<string>();
  try {
    for (const src of ["shared/schema.ts", "shared/models/auth.ts"]) {
      try {
        const text = fs.readFileSync(src, "utf8");
        for (const m of text.matchAll(/pgTable\(\s*["']([a-z0-9_]+)["']/g)) tables.add(m[1]);
      } catch (_silentErr) { logSilentCatch("server/lib/audit-suppressions.ts", _silentErr); }
    }
  } catch (_silentErr) { logSilentCatch("server/lib/audit-suppressions.ts", _silentErr); }
  knownTablesCache = tables;
  return tables;
}

// An anchor right-hand side must be a real code identifier, not an English
// word: a live schema table name, snake_case, camelCase, or a plain word that
// appears in code context in the issue text (backticked, quoted, parens/dots).
function isIdentifierLike(token: string, issue: string): boolean {
  if (ANCHOR_STOPWORDS.has(token.toLowerCase())) return false;
  if (knownTables().has(token.toLowerCase())) return true;
  if (token.includes("_")) return true;
  if (/[a-z][A-Z]/.test(token)) return true;
  return (
    issue.includes("`" + token) || issue.includes("'" + token) ||
    issue.includes('"' + token) || issue.includes("(" + token) ||
    issue.includes(token + "(") || issue.includes("." + token) ||
    issue.includes(token + ".")
  );
}

// Canonicalize a captured operation word ("SELECTs", "selecting", "queries")
// to its base verb so generation and loader validation agree.
const OP_CANON: [string, string][] = [
  ["select", "select"], ["insert", "insert"], ["updat", "update"],
  ["delet", "delete"], ["upsert", "upsert"], ["count", "count"],
  ["quer", "query"], ["read", "read"], ["writ", "write"], ["purg", "purge"],
  ["call", "call"], ["invok", "invoke"], ["join", "join"],
];
function canonicalOp(raw: string): string {
  const lower = raw.toLowerCase();
  for (const [prefix, canon] of OP_CANON) if (lower.startsWith(prefix)) return canon;
  return "op";
}

export function extractStructuralAnchor(issue: string): string | null {
  // 1) SQL-shaped: operation keyword followed by the target table name.
  //    Scan ALL occurrences — the first may be prose ("UPDATE that claims…"),
  //    a later one the real statement ("UPDATE plans SET…").
  for (const sql of issue.matchAll(
    /\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE|UPSERT\s+INTO|(?:SELECT|COUNT\s*\(\s*\*?\s*\))[\s\S]{0,160}?\bFROM)\s+["'`]?([A-Za-z_][A-Za-z0-9_]{3,})/gi,
  )) {
    if (isIdentifierLike(sql[2], issue)) {
      return `${canonicalOp(sql[1].split(/[\s(]/)[0])}:${sql[2].toLowerCase()}`;
    }
  }
  // 2) Prose-shaped: operation verb + the first concrete code identifier
  //    (snake_case or camelCase — a table, column, or function name).
  const opWord = issue.match(
    /\b(insert|update|delete|select|upsert|read|write|purge|count|call|invoke|query|queries|join)[sd]?(?:ing|es)?\b/i,
  );
  const idents = issue.match(/\b(?:[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]{2,}|[a-z][a-z0-9]+[A-Z][A-Za-z0-9]{2,})\b/g);
  let ident = (idents || []).find((t) => isIdentifierLike(t, issue));
  if (!ident) {
    // Plain-word live schema table name cited in the prose.
    const words = issue.match(/\b[a-z][a-z0-9]{3,}\b/g) || [];
    ident = words.find((w) => knownTables().has(w) && !ANCHOR_STOPWORDS.has(w));
  }
  if (ident) {
    const op = opWord ? canonicalOp(opWord[1]) : "op";
    return `${op}:${ident.toLowerCase()}`;
  }
  // 3) Quoted-code fragment: findings that cite an actual code snippet
  //    (template literal / cast) get an anchor from the CODE, not prose.
  const code = issue.match(/\$\{[^}]{6,80}\}|`[^`]{8,80}`/);
  if (code) {
    const norm = code[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
    if (norm.length >= 8) return `code:${norm}`;
  }
  // No structural fingerprint derivable ⇒ null ⇒ never suppressible.
  return null;
}

export interface SuppressibleFinding {
  file: string;
  issue: string;
}

// A low-specificity match key is one that could collide with a genuinely NEW
// finding in the same file — e.g. a bare table/identifier name ("project_files")
// that any future issue text about that table would contain. We require a
// structural anchor: either a multi-token code/prose fragment (contains
// whitespace or code punctuation) of >=20 chars, or a very long (>=40 char)
// single token. Entries failing this are SKIPPED (fail closed: not suppressed).
export function isLowSpecificity(match: string): boolean {
  if (match.length < 12) return true;
  const bareIdentifier = /^[A-Za-z0-9_.:-]+$/.test(match);
  if (bareIdentifier) return match.length < 40;
  return match.length < 20;
}

export function loadSuppressions(
  filePath: string,
  recognizedPatterns: ReadonlySet<string>,
  log: (msg: string) => void = () => {},
): SuppressionEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return []; // no allowlist — nothing suppressed
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    log(`suppressions UNPARSEABLE (${(e as Error)?.message}) — ignoring allowlist entirely (fail closed).`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    log(`suppressions file is not an array — ignoring allowlist entirely (fail closed).`);
    return [];
  }
  const valid: SuppressionEntry[] = [];
  for (const e of parsed as any[]) {
    const ok =
      e && typeof e.file === "string" && e.file &&
      typeof e.pattern === "string" && recognizedPatterns.has(e.pattern) &&
      typeof e.match === "string" && e.match.length >= 12 &&
      typeof e.anchor === "string" &&
      /^(insert|update|delete|select|upsert|count|read|write|purge|call|invoke|query|join|op|code):[a-z0-9_]+$/.test(e.anchor) &&
      !ANCHOR_STOPWORDS.has(e.anchor.split(":")[1]) &&
      typeof e.reason === "string" && e.reason &&
      typeof e.verifiedBy === "string" && e.verifiedBy &&
      typeof e.date === "string" && e.date;
    if (!ok) {
      log(`suppressions: SKIPPING malformed entry ${JSON.stringify(e).slice(0, 160)} (fail closed).`);
      continue;
    }
    if (isLowSpecificity(e.match)) {
      log(`suppressions: SKIPPING low-specificity match "${String(e.match).slice(0, 80)}" for ${e.file} — could mask a NEW finding (fail closed).`);
      continue;
    }
    valid.push(e as SuppressionEntry);
  }
  return valid;
}

export function matchSuppression<F extends SuppressibleFinding>(
  finding: F,
  entries: SuppressionEntry[],
): SuppressionEntry | undefined {
  const anchor = extractStructuralAnchor(finding.issue);
  if (!anchor) return undefined; // no structural fingerprint ⇒ never suppress (fail closed)
  return entries.find(
    (e) => e.file === finding.file && e.anchor === anchor && finding.issue.includes(e.match),
  );
}
