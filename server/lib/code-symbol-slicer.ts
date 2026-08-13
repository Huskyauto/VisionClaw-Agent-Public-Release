/**
 * Code Symbol Slicer (R117) — implements the Tree-sitter-style symbol-graph
 * pattern from `tirth8205/code-review-graph` (#3) and `mibayy/token-savior`
 * (#10) recommendations, adapted to use the TypeScript Compiler API (already
 * a dep at v5.6.3) so .ts / .tsx files get accurate AST-based extraction
 * without adding a new native dep.
 *
 * Goal: instead of reading a 5,000-line file just to inspect three functions,
 * extract only those symbols (plus optional surrounding context lines) so the
 * agent context drops from ~80K tokens to ~3K tokens for the same review job.
 *
 * Falls back to regex extraction for non-TS files (`.js`, `.py`, `.go`, `.rs`,
 * etc.) — best-effort, function/class/export only.
 *
 * Path-jail: all paths resolved against process.cwd(), rejected if they
 * escape the workspace root.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const WORKSPACE_ROOT = process.cwd();
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SLICE_LINES = 600;

export interface SliceRequest {
  filePath: string;
  symbols?: string[];
  lineRanges?: Array<[number, number]>;
  contextLines?: number;
  exportedOnly?: boolean;
}

export interface SymbolSlice {
  symbol: string;
  kind: string;
  startLine: number;
  endLine: number;
  exported: boolean;
  code: string;
}

export interface SliceResult {
  ok: boolean;
  error?: string;
  filePath?: string;
  totalLines?: number;
  totalBytes?: number;
  language?: string;
  slices?: SymbolSlice[];
  returnedLines?: number;
  returnedBytes?: number;
  compressionRatio?: number;
}

function safePath(input: string): string | null {
  try {
    const resolved = path.resolve(WORKSPACE_ROOT, input);
    if (!resolved.startsWith(WORKSPACE_ROOT + path.sep) && resolved !== WORKSPACE_ROOT) return null;
    // Reject symlinks at the entry — never follow into a target outside the workspace.
    let lst: fs.Stats;
    try { lst = fs.lstatSync(resolved); } catch { return null; }
    if (lst.isSymbolicLink()) return null;
    // Canonicalize and re-check the canonical workspace root.
    const rootReal = fs.realpathSync(WORKSPACE_ROOT);
    const real = fs.realpathSync(resolved);
    if (!real.startsWith(rootReal + path.sep) && real !== rootReal) return null;
    return real;
  } catch { return null; }
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts": case ".tsx": case ".cts": case ".mts": return "typescript";
    case ".js": case ".jsx": case ".cjs": case ".mjs": return "javascript";
    case ".py": return "python";
    case ".go": return "go";
    case ".rs": return "rust";
    case ".java": return "java";
    case ".rb": return "ruby";
    default: return "unknown";
  }
}

function extractWithRegex(source: string, lang: string): Omit<SymbolSlice, "code">[] {
  const out: Omit<SymbolSlice, "code">[] = [];
  const lines = source.split("\n");
  const totalLines = lines.length;
  const patterns: Array<{ re: RegExp; kind: string }> = [];
  if (lang === "javascript" || lang === "typescript") {
    patterns.push({ re: /^(export\s+)?(async\s+)?function\s+(\w+)/, kind: "function" });
    patterns.push({ re: /^(export\s+)?class\s+(\w+)/, kind: "class" });
    patterns.push({ re: /^(export\s+)?const\s+(\w+)\s*=\s*(async\s+)?\(/, kind: "function" });
    patterns.push({ re: /^(export\s+)?(interface|type|enum)\s+(\w+)/, kind: "type" });
  } else if (lang === "python") {
    patterns.push({ re: /^def\s+(\w+)/, kind: "function" });
    patterns.push({ re: /^class\s+(\w+)/, kind: "class" });
  } else if (lang === "go") {
    patterns.push({ re: /^func\s+(?:\([^)]+\)\s+)?(\w+)/, kind: "function" });
    patterns.push({ re: /^type\s+(\w+)/, kind: "type" });
  } else if (lang === "rust") {
    patterns.push({ re: /^(?:pub\s+)?fn\s+(\w+)/, kind: "function" });
    patterns.push({ re: /^(?:pub\s+)?struct\s+(\w+)/, kind: "type" });
  }
  for (let i = 0; i < lines.length; i++) {
    for (const p of patterns) {
      const m = lines[i].match(p.re);
      if (m) {
        const name = m[m.length - 1];
        if (!name || !/^[A-Za-z_]/.test(name)) continue;
        let endLine = i;
        const trimmed = lines[i].trimStart();
        const indent = lines[i].length - trimmed.length;
        if (lang === "python") {
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim() === "") continue;
            const jIndent = lines[j].length - lines[j].trimStart().length;
            if (jIndent <= indent) break;
            endLine = j;
          }
        } else {
          let depth = 0;
          let seenBrace = false;
          for (let j = i; j < lines.length && j < i + MAX_SLICE_LINES; j++) {
            for (const ch of lines[j]) {
              if (ch === "{") { depth++; seenBrace = true; }
              else if (ch === "}") { depth--; if (seenBrace && depth === 0) { endLine = j; j = lines.length; break; } }
            }
            if (!seenBrace && (lines[j].endsWith(";") || lines[j].endsWith(")"))) {
              endLine = j;
              if (!lang.includes("script") || !lines[j].includes("{")) break;
            }
          }
        }
        const exported = /^export\b|^pub\b/.test(lines[i].trimStart()) || lang === "python";
        out.push({ symbol: name, kind: p.kind, startLine: i + 1, endLine: endLine + 1, exported });
        break;
      }
    }
  }
  if (out.length === 0 && totalLines > 0) {
    // Nothing matched — degenerate; let caller decide
  }
  return out;
}

async function extractWithTs(source: string): Promise<Omit<SymbolSlice, "code">[]> {
  const ts = await import("typescript");
  const sf = ts.createSourceFile("slice.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Omit<SymbolSlice, "code">[] = [];
  function lineOf(pos: number): number {
    return sf.getLineAndCharacterOfPosition(pos).line + 1;
  }
  function visit(node: any) {
    let symbol: string | null = null;
    let kind: string | null = null;
    let exported = false;
    if (ts.isFunctionDeclaration(node) && node.name) {
      symbol = node.name.text; kind = "function";
      exported = !!(node.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword));
    } else if (ts.isClassDeclaration(node) && node.name) {
      symbol = node.name.text; kind = "class";
      exported = !!(node.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword));
    } else if (ts.isInterfaceDeclaration(node)) {
      symbol = node.name.text; kind = "interface";
      exported = !!(node.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword));
    } else if (ts.isTypeAliasDeclaration(node)) {
      symbol = node.name.text; kind = "type";
      exported = !!(node.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword));
    } else if (ts.isEnumDeclaration(node)) {
      symbol = node.name.text; kind = "enum";
      exported = !!(node.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword));
    } else if (ts.isMethodDeclaration(node) && node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name))) {
      const parentName = (node.parent && (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent)) && node.parent.name) ? node.parent.name.text + "." : "";
      symbol = parentName + (node.name as any).text;
      kind = "method";
      exported = !!(node.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword));
    } else if (ts.isVariableStatement(node)) {
      const decl = node.declarationList.declarations[0];
      if (decl && ts.isIdentifier(decl.name)) {
        symbol = decl.name.text;
        kind = (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) ? "function" : "const";
        exported = !!(node.modifiers?.some((m: any) => m.kind === ts.SyntaxKind.ExportKeyword));
      }
    }
    if (symbol && kind) {
      out.push({
        symbol, kind, exported,
        startLine: lineOf(node.getStart(sf)),
        endLine: lineOf(node.getEnd()),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

export async function sliceFile(req: SliceRequest): Promise<SliceResult> {
  const resolved = safePath(req.filePath);
  if (!resolved) return { ok: false, error: "path escapes workspace or invalid" };
  let st: fs.Stats;
  try { st = fs.statSync(resolved); } catch { return { ok: false, error: "file not found" }; }
  if (!st.isFile()) return { ok: false, error: "not a file" };
  if (st.size > MAX_FILE_BYTES) return { ok: false, error: `file too large (${st.size} > ${MAX_FILE_BYTES})` };
  const source = fs.readFileSync(resolved, "utf8");
  const totalBytes = Buffer.byteLength(source, "utf8");
  const lines = source.split("\n");
  const totalLines = lines.length;
  const lang = detectLanguage(resolved);

  let symbolMeta: Omit<SymbolSlice, "code">[];
  if (lang === "typescript" || lang === "javascript") {
    try { symbolMeta = await extractWithTs(source); }
    catch { symbolMeta = extractWithRegex(source, lang); }
  } else {
    symbolMeta = extractWithRegex(source, lang);
  }

  let filtered = symbolMeta;
  if (req.exportedOnly) filtered = filtered.filter((s) => s.exported);
  if (req.symbols && req.symbols.length > 0) {
    const wanted = new Set(req.symbols.map((s) => s.toLowerCase()));
    filtered = filtered.filter((s) => wanted.has(s.symbol.toLowerCase()));
  }

  const ctx = Math.max(0, Math.min(Number(req.contextLines) || 0, 20));
  let slices: SymbolSlice[] = filtered.map((s) => {
    const startIdx = Math.max(0, s.startLine - 1 - ctx);
    const endIdx = Math.min(lines.length, s.endLine + ctx);
    return { ...s, code: lines.slice(startIdx, endIdx).join("\n") };
  });

  if (req.lineRanges && req.lineRanges.length > 0) {
    for (const [start, end] of req.lineRanges) {
      const s = Math.max(1, Math.floor(Number(start) || 1));
      const e = Math.max(s, Math.floor(Number(end) || s));
      const startIdx = Math.max(0, s - 1 - ctx);
      const endIdx = Math.min(lines.length, e + ctx);
      slices.push({
        symbol: `lines_${s}_${e}`, kind: "range", exported: false,
        startLine: s, endLine: e,
        code: lines.slice(startIdx, endIdx).join("\n"),
      });
    }
  }

  // De-dup overlapping slices (keep the wider one)
  slices.sort((a, b) => a.startLine - b.startLine);
  const merged: SymbolSlice[] = [];
  for (const s of slices) {
    const prev = merged[merged.length - 1];
    if (prev && s.startLine <= prev.endLine + 1) {
      if (s.endLine > prev.endLine) {
        prev.endLine = s.endLine;
        prev.symbol = `${prev.symbol},${s.symbol}`;
        prev.code = lines.slice(prev.startLine - 1, prev.endLine).join("\n");
      }
    } else merged.push(s);
  }

  const returnedLines = merged.reduce((acc, s) => acc + (s.endLine - s.startLine + 1), 0);
  const returnedBytes = merged.reduce((acc, s) => acc + Buffer.byteLength(s.code, "utf8"), 0);
  const compressionRatio = totalBytes > 0 ? returnedBytes / totalBytes : 1;

  return {
    ok: true, filePath: resolved.replace(WORKSPACE_ROOT + path.sep, ""),
    totalLines, totalBytes, language: lang,
    slices: merged, returnedLines, returnedBytes,
    compressionRatio: Math.round(compressionRatio * 1000) / 1000,
  };
}

export const __internals = { WORKSPACE_ROOT, MAX_FILE_BYTES, MAX_SLICE_LINES, detectLanguage, extractWithRegex };
