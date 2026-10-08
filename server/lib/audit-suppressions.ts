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
  /** Paraphrase-immune code-site anchor: the EXACT (trimmed) source line of the
   *  verified code site. The first-pass model re-words its issue text every
   *  night, so the verbatim `match` substring alone almost never re-fires; the
   *  CODE is stable. When present, a finding also matches if its reported line
   *  lands within a small window of where this line currently sits in the file
   *  (fail closed: file unreadable / line gone / no finding line ⇒ no match). */
  codeLine?: string;
}

/** A dated, expiring deferral: a REAL (not false-positive) finding the owner
 *  consciously parked with a review-by date (docs/…/deferred-*.md). Matches
 *  like a suppression but ONLY until `reviewBy`; after that it goes red again.
 *  Mirrors the weekly-sweep rule that deferrals must be scoped + expiring. */
export interface DeferralEntry {
  file: string;
  match: string;
  anchor: string;
  reason: string;
  deferredBy: string;
  date: string;
  reviewBy: string; // YYYY-MM-DD — entry stops matching after this date
  codeLine?: string;
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
  /** Line the audit finding points at (used only by the codeLine site match). */
  line?: number;
}

// A codeLine is usable only when it is specific enough to name ONE code site:
// ≥ 12 chars after trimming and containing a real identifier token.
export function isUsableCodeLine(codeLine: unknown): codeLine is string {
  if (typeof codeLine !== "string") return false;
  const t = codeLine.trim();
  return t.length >= 12 && /[A-Za-z_$][A-Za-z0-9_$]{3,}/.test(t);
}

// How far (in lines) a finding's reported line may sit from the current
// location of the verified codeLine and still count as the SAME code site.
const CODELINE_WINDOW = 10;

// Per-process cache of source files read for codeLine matching (the audit is a
// one-shot script; entries are small).
const srcLineCache = new Map<string, string[] | null>();
function sourceLines(file: string): string[] | null {
  if (srcLineCache.has(file)) return srcLineCache.get(file)!;
  let lines: string[] | null = null;
  try {
    lines = fs.readFileSync(file, "utf8").split("\n");
  } catch {
    lines = null; // unreadable ⇒ codeLine can never match (fail closed)
  }
  srcLineCache.set(file, lines);
  return lines;
}

/** TRUE iff the finding's reported line lands within CODELINE_WINDOW of an
 *  occurrence of the entry's verified codeLine in the CURRENT source. Fails
 *  closed on: no codeLine, no finding line, unreadable file, line no longer
 *  present (code changed ⇒ needs re-verification). */
function codeLineSiteMatch(finding: SuppressibleFinding, codeLine: string | undefined): boolean {
  if (!isUsableCodeLine(codeLine)) return false;
  if (typeof finding.line !== "number" || !Number.isFinite(finding.line) || finding.line < 1) return false;
  const lines = sourceLines(finding.file);
  if (!lines) return false;
  const want = codeLine.trim();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === want && Math.abs(i + 1 - finding.line) <= CODELINE_WINDOW) return true;
  }
  return false;
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
    // codeLine is optional; an unusable one is DROPPED (entry falls back to the
    // verbatim-match-only path — strictly less suppression, never more).
    let entry = e as SuppressionEntry;
    if (entry.codeLine !== undefined && !isUsableCodeLine(entry.codeLine)) {
      log(`suppressions: dropping unusable codeLine for ${entry.file} [${entry.anchor}] (verbatim match still applies).`);
      entry = { ...entry, codeLine: undefined };
    }
    valid.push(entry);
  }
  return valid;
}

// The anchor's rhs identifier, normalized for prose-vs-code drift
// ("event_log" vs "finalizeEvent" quoting styles): lowercase, underscores out.
function normIdent(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Anchor compatibility for the codeLine path. Strict anchor EQUALITY rots
 *  under paraphrase (the model may fingerprint the same site as
 *  update:event_log one night and update:finalizeevent the next), so when the
 *  finding already points at the verified SOURCE LINE we relax the RHS
 *  identifier — but NEVER the operation. Requirements (all fail closed):
 *   1. canonical operation EQUALITY — an entry anchored to update:X can never
 *      absorb a finding fingerprinted delete:Y at the same site; a different
 *      SQL operation is a DIFFERENT issue even on a shared source line;
 *   2. the entry anchor's rhs identifier (normalized, ≥6 chars) must still be
 *      what the new issue text talks about: it appears in the issue text, or
 *      the two anchor rhs identifiers match.
 *  A nearby-but-different issue about an unrelated operation or an unrelated
 *  table/function therefore stays red. */
function anchorCompatible(entryAnchor: string, findingAnchor: string, issue: string): boolean {
  if (entryAnchor === findingAnchor) return true;
  const [entryOp, entryRhsRaw] = entryAnchor.split(":");
  const [findingOp, findingRhsRaw] = findingAnchor.split(":");
  if (entryOp !== findingOp) return false; // canonical operation equality (fail closed)
  const entryRhs = normIdent(entryRhsRaw ?? "");
  if (entryRhs.length < 6) return false; // too short to be a reliable identifier
  return normIdent(issue).includes(entryRhs) || normIdent(findingRhsRaw ?? "") === entryRhs;
}

export function matchSuppression<F extends SuppressibleFinding>(
  finding: F,
  entries: SuppressionEntry[],
): SuppressionEntry | undefined {
  const anchor = extractStructuralAnchor(finding.issue);
  if (!anchor) return undefined; // no structural fingerprint ⇒ never suppress (fail closed)
  return entries.find(
    (e) =>
      e.file === finding.file &&
      // Same code site, established either way:
      //  (a) legacy: strict anchor equality + the verified issue phrasing
      //      appears verbatim in the new issue text (survives only when the
      //      model repeats itself), or
      //  (b) paraphrase-immune: the finding points at the CURRENT location of
      //      the verified source line AND the entry's anchored identifier is
      //      still what the new issue is about (anchorCompatible).
      ((e.anchor === anchor && finding.issue.includes(e.match)) ||
        (anchorCompatible(e.anchor, anchor, finding.issue) && codeLineSiteMatch(finding, e.codeLine))),
  );
}

// ── Dated deferrals ──────────────────────────────────────────────────────────

/** Load + validate deferrals.json. FAIL CLOSED like loadSuppressions: missing/
 *  unparseable file or malformed entry defers NOTHING. EXPIRED entries (today >
 *  reviewBy) are skipped LOUDLY — the finding goes red again until re-triaged. */
export function loadDeferrals(
  filePath: string,
  log: (msg: string) => void = () => {},
  today: Date = new Date(),
): DeferralEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    log(`deferrals UNPARSEABLE (${(e as Error)?.message}) — ignoring deferrals entirely (fail closed).`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    log(`deferrals file is not an array — ignoring deferrals entirely (fail closed).`);
    return [];
  }
  const valid: DeferralEntry[] = [];
  for (const e of parsed as any[]) {
    const ok =
      e && typeof e.file === "string" && e.file &&
      typeof e.match === "string" && e.match.length >= 12 && !isLowSpecificity(e.match) &&
      typeof e.anchor === "string" &&
      /^(insert|update|delete|select|upsert|count|read|write|purge|call|invoke|query|join|op|code):[a-z0-9_]+$/.test(e.anchor) &&
      !ANCHOR_STOPWORDS.has(e.anchor.split(":")[1]) &&
      typeof e.reason === "string" && e.reason &&
      typeof e.deferredBy === "string" && e.deferredBy &&
      typeof e.date === "string" && e.date &&
      typeof e.reviewBy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.reviewBy) &&
      Number.isFinite(Date.parse(e.reviewBy));
    if (!ok) {
      log(`deferrals: SKIPPING malformed entry ${JSON.stringify(e).slice(0, 160)} (fail closed).`);
      continue;
    }
    // Expiry: an entry defers only through the END of its reviewBy day (UTC).
    if (today.getTime() > Date.parse(e.reviewBy) + 24 * 60 * 60 * 1000 - 1) {
      log(`deferrals: EXPIRED ${e.file} [${e.anchor}] (reviewBy ${e.reviewBy}) — finding will report red until re-triaged.`);
      continue;
    }
    valid.push(e as DeferralEntry);
  }
  return valid;
}

export function matchDeferral<F extends SuppressibleFinding>(
  finding: F,
  entries: DeferralEntry[],
): DeferralEntry | undefined {
  const anchor = extractStructuralAnchor(finding.issue);
  if (!anchor) return undefined;
  return entries.find(
    (e) =>
      e.file === finding.file &&
      ((e.anchor === anchor && finding.issue.includes(e.match)) ||
        (anchorCompatible(e.anchor, anchor, finding.issue) && codeLineSiteMatch(finding, e.codeLine))),
  );
}
