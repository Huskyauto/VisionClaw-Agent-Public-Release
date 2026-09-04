// R75 — GraphRAG Five: cAST (Context-Aware Splitting Tree) — minimal port.
// Splits source code at top-level symbol boundaries (function/class/export
// const) rather than fixed-line windows. Each chunk carries a header with
// the parent file, the symbol name, and its starting line so retrievers can
// preserve provenance. No tree-sitter dep — regex-based for now; we can
// upgrade to tree-sitter when we add a code-RAG corpus.

export interface Chunk {
  index: number;
  symbol: string;
  parentFile: string;
  startLine: number;
  endLine: number;
  content: string;
  tokens: number; // rough estimate (chars/4)
}

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"]);

function detectLang(filePath: string): "ts" | "py" | "other" {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".py")) return "py";
  for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
    if (lower.endsWith(ext)) return "ts";
  }
  return "other";
}

// Returns boundary line numbers (1-indexed) where a new top-level symbol begins.
function findTsBoundaries(lines: string[]): Array<{ line: number; symbol: string }> {
  const out: Array<{ line: number; symbol: string }> = [];
  // Top-level boundaries MUST start at column 0. Any leading whitespace means
  // we're inside a function, class body, namespace, or module — slicing there
  // would split mid-scope. The only `export` form may begin at col 0 anywhere.
  const patterns: Array<{ re: RegExp; group: number; kind: string }> = [
    { re: /^export\s+(?:default\s+)?(?:async\s+)?function\s*(?:\*\s*)?([A-Za-z_$][\w$]*)/, group: 1, kind: "function" },
    { re: /^(?:async\s+)?function\s*(?:\*\s*)?([A-Za-z_$][\w$]*)/, group: 1, kind: "function" },
    { re: /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, group: 1, kind: "class" },
    { re: /^(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, group: 1, kind: "class" },
    { re: /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:\s*[^=]+)?\s*=/, group: 1, kind: "const" },
    { re: /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, group: 1, kind: "const" },
    { re: /^export\s+interface\s+([A-Za-z_$][\w$]*)/, group: 1, kind: "interface" },
    { re: /^interface\s+([A-Za-z_$][\w$]*)/, group: 1, kind: "interface" },
    { re: /^export\s+type\s+([A-Za-z_$][\w$]*)/, group: 1, kind: "type" },
    { re: /^export\s+enum\s+([A-Za-z_$][\w$]*)/, group: 1, kind: "enum" },
  ];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (line.trim().startsWith("/*") && !line.includes("*/")) {
      inBlockComment = true;
      continue;
    }
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
    for (const p of patterns) {
      const m = line.match(p.re);
      if (m) {
        out.push({ line: i + 1, symbol: `${p.kind}:${m[p.group]}` });
        break;
      }
    }
  }
  return out;
}

function findPyBoundaries(lines: string[]): Array<{ line: number; symbol: string }> {
  const out: Array<{ line: number; symbol: string }> = [];
  // Top-level python symbols: column 0 def/class. Decorators (column 0 @...) attach
  // to the next def/class so we record the def line itself.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:async\s+)?(def|class)\s+([A-Za-z_][\w]*)/);
    if (m) out.push({ line: i + 1, symbol: `${m[1]}:${m[2]}` });
  }
  return out;
}

const MAX_CHUNK_CHARS_DEFAULT = 800 * 4; // ~800 tokens

export function chunkCodeContextAware(
  filePath: string,
  source: string,
  opts: { maxTokens?: number } = {},
): Chunk[] {
  const maxChars = (opts.maxTokens ?? 800) * 4;
  const lang = detectLang(filePath);
  const lines = source.split(/\r?\n/);

  if (lang === "other") {
    return naiveChunks(filePath, lines, maxChars);
  }
  const boundaries = lang === "ts" ? findTsBoundaries(lines) : findPyBoundaries(lines);
  if (boundaries.length === 0) {
    return naiveChunks(filePath, lines, maxChars);
  }

  const chunks: Chunk[] = [];
  // Prepend a virtual boundary at line 1 if the file has top-of-file content
  // before the first symbol (imports, comments). That preamble becomes its
  // own chunk so we don't lose import context.
  if (boundaries[0].line > 1) {
    boundaries.unshift({ line: 1, symbol: "__preamble" });
  }

  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].line;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].line - 1 : lines.length;
    const symbol = boundaries[i].symbol;
    let body = lines.slice(start - 1, end).join("\n");
    // If the chunk is too big, hard-split it but keep the same symbol header.
    if (body.length > maxChars) {
      const subPieces: string[] = [];
      for (let s = 0; s < body.length; s += maxChars) {
        subPieces.push(body.slice(s, s + maxChars));
      }
      let lineCursor = start;
      for (let p = 0; p < subPieces.length; p++) {
        const piece = subPieces[p];
        const pieceLines = piece.split("\n").length;
        chunks.push(makeChunk(chunks.length, filePath, `${symbol}#${p + 1}/${subPieces.length}`, lineCursor, lineCursor + pieceLines - 1, piece));
        lineCursor += pieceLines;
      }
    } else {
      chunks.push(makeChunk(chunks.length, filePath, symbol, start, end, body));
    }
  }
  return chunks;
}

function naiveChunks(filePath: string, lines: string[], maxChars: number): Chunk[] {
  // Fixed-line fallback: ~maxChars worth of lines per chunk.
  const out: Chunk[] = [];
  let buf: string[] = [];
  let bufStart = 1;
  let bufChars = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (bufChars + ln.length + 1 > maxChars && buf.length > 0) {
      out.push(makeChunk(out.length, filePath, "naive", bufStart, i, buf.join("\n")));
      buf = []; bufChars = 0; bufStart = i + 1;
    }
    buf.push(ln);
    bufChars += ln.length + 1;
  }
  if (buf.length > 0) {
    out.push(makeChunk(out.length, filePath, "naive", bufStart, lines.length, buf.join("\n")));
  }
  return out;
}

function makeChunk(index: number, parentFile: string, symbol: string, startLine: number, endLine: number, content: string): Chunk {
  const header = `// __cast: file=${parentFile}  symbol=${symbol}  lines=${startLine}-${endLine}\n`;
  const body = header + content;
  return {
    index, symbol, parentFile, startLine, endLine,
    content: body,
    tokens: Math.ceil(body.length / 4),
  };
}

export function isSupportedCodeFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const ext of SUPPORTED_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}
