/**
 * Deliverable Failure-Mode Checklist (no-LLM, $0)
 *
 * Concept emulated (NOT copied) from the ARS "AI Research Failure Mode
 * Checklist" (Lu et al. 2026, Nature 651:914) reviewed 2026-06-30: instead of a
 * holistic "does this look right?" pass, a verifier should explicitly rule out a
 * fixed set of NAMED failure modes — because bad output "looks like competent
 * work" (a hallucinated number reads identically to a real one). We adapt the
 * academic taxonomy to VisionClaw's general deliverables (reports, PDFs, data,
 * web/markdown) as cheap, high-precision string/number heuristics. NO model call.
 *
 * Two severities:
 *   - HARD  → a finished customer deliverable must never contain this. These flip
 *             the deliverable to FAILED (blocking).
 *   - ADVISORY → a statistical smell that warrants a human glance but is too
 *             false-positive-prone to block on (the ARS "suspiciously round
 *             number / constant leaking through a broken pipeline" heuristic).
 *
 * Fail-OPEN by contract: any internal error returns ZERO findings (a scanner bug
 * must never sink a delivery). Quality checks fail open; see completion-verifier.
 */

export type FailureModeSeverity = "hard" | "advisory";

export type FailureModeId =
  | "ai_meta_leakage"
  | "unfilled_placeholder"
  | "error_token_leakage"
  | "empty_content"
  | "truncation_marker"
  | "suspicious_constant"
  | "suspicious_round";

export interface FailureModeFinding {
  mode: FailureModeId;
  severity: FailureModeSeverity;
  detail: string;
}

export interface FailureModeScanResult {
  findings: FailureModeFinding[];
  /** Human-readable strings for HARD findings (these block delivery). */
  blocking: string[];
  /** Human-readable strings for ADVISORY findings (surfaced, never block). */
  advisory: string[];
}

const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".txt", ".md", ".markdown", ".html", ".htm", ".csv", ".json", ".rtf",
]);

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_EXACT: ReadonlySet<string> = new Set([
  "application/json", "application/xml",
]);

/** Decide whether a deliverable is text-like enough to run string heuristics. */
export function isTextLike(ext?: string, mime?: string): boolean {
  if (ext && TEXT_EXTENSIONS.has(ext.toLowerCase())) return true;
  if (mime) {
    const m = mime.toLowerCase();
    if (TEXT_MIME_EXACT.has(m)) return true;
    if (TEXT_MIME_PREFIXES.some((p) => m.startsWith(p))) return true;
  }
  return false;
}

// ── HARD pattern banks (high precision; these should NEVER ship) ────────────

// AI meta / refusal text that leaked into a finished artifact.
const AI_META_PATTERNS: RegExp[] = [
  /\bas an ai language model\b/i,
  /\bas a large language model\b/i,
  /\bas an ai\b[,.]?\s+i\b/i,
  /\bi(?:'m| am)\s+(?:sorry,?\s+)?(?:but\s+)?(?:i\s+)?(?:can(?:'|no)t|cannot|unable to)\s+(?:fulf(?:il|ill)|assist|help|provide|comply|complete)\b/i,
  /\bi (?:do|does) not have (?:access to )?real[- ]time\b/i,
  /\bmy (?:training data|knowledge) (?:only )?(?:goes up to|cutoff|extends to)\b/i,
  /\bknowledge cutoff\b/i,
  /\bi cannot browse the (?:internet|web)\b/i,
];

// Unfilled template placeholders.
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\{\{\s*[\w.\-]+\s*\}\}/,                                  // {{handlebars}}
  /\[\s*(?:INSERT|TODO|TKTK|PLACEHOLDER|FIXME|YOUR[ _][A-Z ]+|COMPANY[ _]NAME|CLIENT[ _]NAME|CUSTOMER[ _]NAME|DATE[ _]HERE)\b[^\]]*\]/i,
  /\blorem ipsum\b/i,
  /\bTKTK\b/,
  /<\s*placeholder\s*>/i,
  /\bXXXX+\b/,
  /\$\{[\w.\-]+\}/,                                          // ${unfilled}
];

// Runtime error tokens that leaked into user-facing text (skipped for JSON,
// where `null` is legitimate and `undefined` won't validly appear anyway).
const ERROR_TOKEN_PATTERNS: RegExp[] = [
  /\[object Object\]/,
  /(?:[:=]\s*|\(|\b)undefined\b(?!\s+(?:term|behaviou?r|variable|reference|word))/,
  /(?<![\w.])NaN(?![\w])/,
  /\bReferenceError\b/,
  /\bTypeError:/,
  /\bundefined is not (?:a function|an object)\b/i,
];

// Explicit truncation markers.
const TRUNCATION_PATTERNS: RegExp[] = [
  /\[\s*(?:truncated|content continues|output truncated|\.{3}\s*truncated)\s*\]/i,
  /\b(?:output|response|content|text) (?:was )?truncated\b/i,
  /\[\s*\.{3}\s*\]/,
];

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const snippet = m[0].slice(0, 80).replace(/\s+/g, " ").trim();
      return snippet;
    }
  }
  return null;
}

/**
 * ADVISORY — suspicious-constant detection in CSV columns. A numeric column with
 * >= MIN_ROWS data rows whose values are ALL identical is the canonical "a
 * constant is leaking through a broken pipeline" smell (zero variance across
 * conditions). High precision on real tabular data, so we only run it for CSV.
 */
function scanCsvConstants(text: string): FailureModeFinding[] {
  const findings: FailureModeFinding[] = [];
  const MIN_ROWS = 4;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < MIN_ROWS + 1) return findings; // need header + MIN_ROWS
  const splitRow = (l: string) => l.split(",").map((c) => c.trim());
  const header = splitRow(lines[0]);
  const dataRows = lines.slice(1).map(splitRow);
  const colCount = header.length;
  if (colCount < 1 || colCount > 64) return findings;
  for (let c = 0; c < colCount; c++) {
    const cells = dataRows.map((r) => (c < r.length ? r[c] : "")).filter((v) => v !== "");
    if (cells.length < MIN_ROWS) continue;
    const nums = cells.map((v) => Number(v.replace(/[%$,]/g, "")));
    if (nums.some((n) => !Number.isFinite(n))) continue; // non-numeric column
    // Ignore trivially-constant columns of 0 (often legit padding/flags).
    const allSame = nums.every((n) => n === nums[0]);
    if (allSame && nums[0] !== 0) {
      const label = header[c] ? `"${header[c]}"` : `#${c + 1}`;
      findings.push({
        mode: "suspicious_constant",
        severity: "advisory",
        detail: `CSV column ${label} is constant (${nums[0]}) across all ${nums.length} rows — possible constant leaking through a broken pipeline`,
      });
    }
  }
  return findings;
}

/**
 * ADVISORY — a single exact percentage/decimal value repeated implausibly often
 * across the document (e.g. the same "15.2%" appearing 6 times) suggests a
 * hard-coded number rather than computed results.
 */
function scanRepeatedExactValues(text: string): FailureModeFinding[] {
  const findings: FailureModeFinding[] = [];
  const MIN_REPEATS = 5;
  const counts = new Map<string, number>();
  const re = /(?<![\w.])(\d{1,3}\.\d{1,3})\s*%/g; // decimal percentages only
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [val, n] of counts) {
    if (n >= MIN_REPEATS && val !== "0.0" && val !== "100.0") {
      findings.push({
        mode: "suspicious_round",
        severity: "advisory",
        detail: `the exact value ${val}% appears ${n} times — verify these are computed, not a hard-coded constant`,
      });
    }
  }
  return findings;
}

export interface ScanOptions {
  ext?: string;
  mime?: string;
}

/**
 * Run the failure-mode checklist over a deliverable's text content. Pure,
 * no-LLM, $0. Returns ZERO findings on any internal error (fail-open).
 */
export function scanFailureModes(content: string, opts: ScanOptions = {}): FailureModeScanResult {
  const findings: FailureModeFinding[] = [];
  try {
    const text = String(content || "");
    const ext = (opts.ext || "").toLowerCase();
    const isJson = ext === ".json" || (opts.mime || "").toLowerCase() === "application/json";

    // empty_content (HARD): a text deliverable that is effectively blank.
    const visible = text.replace(/\s+/g, "");
    if (visible.length < 10) {
      findings.push({ mode: "empty_content", severity: "hard", detail: `deliverable has < 10 visible characters (effectively empty)` });
      // Nothing else worth scanning.
      return assemble(findings);
    }

    const aiMeta = firstMatch(text, AI_META_PATTERNS);
    if (aiMeta) findings.push({ mode: "ai_meta_leakage", severity: "hard", detail: `AI meta/refusal text in deliverable: "${aiMeta}"` });

    const placeholder = firstMatch(text, PLACEHOLDER_PATTERNS);
    if (placeholder) findings.push({ mode: "unfilled_placeholder", severity: "hard", detail: `unfilled template placeholder: "${placeholder}"` });

    if (!isJson) {
      const errTok = firstMatch(text, ERROR_TOKEN_PATTERNS);
      if (errTok) findings.push({ mode: "error_token_leakage", severity: "hard", detail: `runtime error token in deliverable: "${errTok}"` });
    }

    const trunc = firstMatch(text, TRUNCATION_PATTERNS);
    if (trunc) findings.push({ mode: "truncation_marker", severity: "hard", detail: `truncation marker in deliverable: "${trunc}"` });

    // Advisory statistical smells.
    if (ext === ".csv") findings.push(...scanCsvConstants(text));
    findings.push(...scanRepeatedExactValues(text));

    return assemble(findings);
  } catch {
    // Fail-open: a scanner bug must never block a delivery.
    return { findings: [], blocking: [], advisory: [] };
  }
}

function assemble(findings: FailureModeFinding[]): FailureModeScanResult {
  const blocking = findings.filter((f) => f.severity === "hard").map((f) => `failure-mode[${f.mode}]: ${f.detail}`);
  const advisory = findings.filter((f) => f.severity === "advisory").map((f) => `failure-mode[${f.mode}]: ${f.detail}`);
  return { findings, blocking, advisory };
}
