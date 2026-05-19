/**
 * Paper ingestion — converts an attached PDF or arXiv tarball into chunked,
 * embedded rows in agent_knowledge so future ensemble_query / Neptune /
 * Robert / autoresearch can cite it. Designed to be called from a chat tool
 * (`ingest_paper`) OR a CLI (`scripts/ingest-paper.ts`).
 *
 * Storage shape: one row per chunk in agent_knowledge with:
 *   - category='paper'
 *   - source='paper:<arxiv-id-or-filename>'
 *   - title='<paper title> — chunk N/M'
 *   - content=<chunk text>
 *   - embedding_vec=<1536-d>
 *   - tenant_id=<provided, defaults to ADMIN tenant>
 *
 * No new schema. No new packages. Uses pdf-parse + tar + the existing
 * generateEmbedding() helper.
 */
import * as fs from "fs";
import { logSilentCatch } from "./silent-catch";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { generateEmbedding } from "../embeddings";

const CHUNK_MAX_CHARS = 2800;
const CHUNK_OVERLAP = 200;
const MAX_CHUNKS_PER_PAPER = 80;

export interface IngestResult {
  ok: boolean;
  paperId: string;
  title: string;
  sourceLabel: string;
  chunksWritten: number;
  chunksEmbedded: number;
  totalChars: number;
  knowledgeRowIds: number[];
  warnings: string[];
}

/**
 * Extract raw text from an arXiv source tarball (.tar / .tar.gz).
 * Strategy: extract to a tmp dir, find the primary .tex file (largest, OR
 * a file whose basename starts with main / ms / paper / arxiv), then
 * concatenate it with any sibling .tex files. Minimal LaTeX stripping.
 */
function extractFromTarball(tarPath: string): { text: string; title: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-ingest-"));
  try {
    const isGz = tarPath.endsWith(".gz") || tarPath.endsWith(".tgz");
    const args = isGz ? ["-xzf", tarPath, "-C", tmpDir] : ["-xf", tarPath, "-C", tmpDir];
    const res = spawnSync("tar", args, { encoding: "utf-8" });
    if (res.status !== 0) {
      throw new Error(`tar failed: ${res.stderr}`);
    }

    // Find all .tex files, recursively
    const texFiles: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.name.endsWith(".tex")) texFiles.push(p);
      }
    };
    walk(tmpDir);

    if (texFiles.length === 0) {
      throw new Error("no .tex files found in tarball");
    }

    // Prefer a "main"-style entry point, else the largest .tex
    const preferredNames = ["main", "ms", "paper", "arxiv", "manuscript"];
    let primary =
      texFiles.find((f) => preferredNames.some((n) => path.basename(f).toLowerCase().startsWith(n))) ||
      texFiles.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];

    // Read primary + all sibling .tex files in the same directory (covers
    // multi-file papers with intro.tex / experiments.tex / etc.)
    const primaryDir = path.dirname(primary);
    const merged: string[] = [];
    const orderHint = ["abstract", "intro", "method", "approach", "experiments", "results", "discussion", "conclusion", "appendix"];
    const sameDirTex = texFiles
      .filter((f) => path.dirname(f) === primaryDir)
      .sort((a, b) => {
        const aBase = path.basename(a, ".tex").toLowerCase();
        const bBase = path.basename(b, ".tex").toLowerCase();
        const aHint = orderHint.findIndex((h) => aBase.startsWith(h));
        const bHint = orderHint.findIndex((h) => bBase.startsWith(h));
        if (aHint !== -1 && bHint !== -1) return aHint - bHint;
        if (aHint !== -1) return -1;
        if (bHint !== -1) return 1;
        return aBase.localeCompare(bBase);
      });

    for (const f of sameDirTex) {
      merged.push(fs.readFileSync(f, "utf-8"));
    }

    let raw = merged.join("\n\n");

    // Title heuristic: \title{...}
    let title = "Untitled paper";
    const titleMatch = raw.match(/\\title[*]?\{([^}]{3,400})\}/);
    if (titleMatch) {
      title = stripLatex(titleMatch[1]).trim();
    }

    // Minimal LaTeX stripping — keep the math intact (paper content), drop
    // the boilerplate so embeddings see real prose.
    const text = stripLatex(raw);

    return { text, title };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_silentErr) { logSilentCatch("server/lib/paper-ingest.ts", _silentErr); }
  }
}

function stripLatex(s: string): string {
  return s
    // Strip comments
    .replace(/(^|[^\\])%[^\n]*/g, "$1")
    // Strip common boilerplate commands that destroy readability
    .replace(/\\(documentclass|usepackage|input|include|bibliography|bibliographystyle|maketitle|tableofcontents|newcommand|renewcommand|def|let|setlength|setcounter|pagestyle|thispagestyle|begin\{document\}|end\{document\}|begin\{figure[*]?\}|end\{figure[*]?\}|begin\{table[*]?\}|end\{table[*]?\}|includegraphics|caption|label|ref|cite[a-z]*|citep|citet|footnote|hline|toprule|midrule|bottomrule)(\[[^\]]*\])?(\{[^}]*\})?/g, " ")
    // Strip remaining single-arg commands but KEEP the argument
    .replace(/\\(textbf|textit|emph|underline|texttt|textsc|section[*]?|subsection[*]?|subsubsection[*]?|paragraph|title)\{([^}]*)\}/g, "$2")
    // Convert \newline / \\ to actual newlines, drop \linebreak etc.
    .replace(/\\(newline|linebreak|hfill|vfill|smallskip|medskip|bigskip|noindent|indent|par)\b/g, " ")
    .replace(/\\\\/g, "\n")
    // Strip $...$ inline math? No — keep, it's usually meaningful.
    // Collapse whitespace
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Extract raw text from a PDF using pdf-parse (already in deps).
 */
async function extractFromPdf(pdfPath: string): Promise<{ text: string; title: string }> {
  const buf = fs.readFileSync(pdfPath);
  // pdf-parse v2 ships a class-based API: `new PDFParse({ data }).getText()`.
  // Use dynamic import (replit.md: "require() under ESM silently fails inside
  // try/catch — use dynamic await import()").
  const mod: any = await import("pdf-parse");
  const PDFParse = mod.PDFParse || mod.default?.PDFParse || mod.default;
  if (typeof PDFParse !== "function") {
    throw new Error("pdf-parse: could not locate PDFParse export");
  }
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  const text = (result?.text || "").trim();

  // Title heuristic: first non-empty line that's short and not a page number /
  // arxiv stamp. Fallback to filename without extension.
  let title = path.basename(pdfPath, path.extname(pdfPath));
  const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 20)) {
    if (line.length < 8 || line.length > 200) continue;
    if (/^arxiv:|^\d+\s*$|^page\s+\d+/i.test(line)) continue;
    if (/^abstract\b/i.test(line)) break;
    title = line;
    break;
  }

  return { text, title };
}

/**
 * Split a long text body into overlapping chunks at paragraph boundaries
 * where possible. Hard cap at MAX_CHUNKS_PER_PAPER to bound cost.
 */
function chunkText(text: string): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  const paras = text.split(/\n\s*\n/);
  let buf = "";
  for (const p of paras) {
    const para = p.trim();
    if (!para) continue;
    if (buf.length + para.length + 2 > CHUNK_MAX_CHARS) {
      if (buf) chunks.push(buf);
      // overlap: last CHUNK_OVERLAP chars of previous chunk
      buf = buf.length > CHUNK_OVERLAP ? buf.slice(-CHUNK_OVERLAP) + "\n\n" + para : para;
    } else {
      buf = buf ? buf + "\n\n" + para : para;
    }
    if (chunks.length >= MAX_CHUNKS_PER_PAPER) break;
  }
  if (buf && chunks.length < MAX_CHUNKS_PER_PAPER) chunks.push(buf);
  return chunks;
}

function detectArxivId(filePath: string, fileBasename: string): string | null {
  // Match xxxx.xxxxx or xxxx.xxxxxvN (arXiv newstyle), e.g. 2605.14037v1
  const m = fileBasename.match(/(\d{4}\.\d{4,5})(v\d+)?/);
  return m ? m[1] + (m[2] || "") : null;
}

// R113.3+sec — path jail for ingest_paper (architect HIGH finding).
// Only files under these canonical roots may be ingested. Prevents arbitrary
// filesystem read via the chat-tool surface (e.g., `/etc/passwd`,
// `/var/lib/postgresql/...`, OAuth token files). Bob's attached files live
// in attached_assets/; CLI-driven backfills live in project-assets/ or data/;
// tarballs downloaded for arXiv ingestion land in /tmp/.
const INGEST_ALLOWED_ROOTS: string[] = [
  path.resolve(process.cwd(), "attached_assets"),
  path.resolve(process.cwd(), "project-assets"),
  path.resolve(process.cwd(), "data"),
  path.resolve(process.cwd(), "docs"),
  path.resolve(os.tmpdir()),
];

function isPathInsideAllowedRoot(abs: string): boolean {
  for (const root of INGEST_ALLOWED_ROOTS) {
    // Canonical containment: abs must equal root OR live below root + sep.
    if (abs === root) return true;
    if (abs.startsWith(root + path.sep)) return true;
  }
  return false;
}

export async function ingestPaper(opts: {
  filePath: string;
  tenantId: number;
  titleHint?: string;
  sourceUrl?: string;
}): Promise<IngestResult> {
  const { filePath, tenantId } = opts;
  // Reject obvious traversal/scheme inputs BEFORE resolving so the error
  // message points at the real problem.
  if (typeof filePath !== "string" || filePath.length === 0) {
    return {
      ok: false, paperId: "", title: "", sourceLabel: "",
      chunksWritten: 0, chunksEmbedded: 0, totalChars: 0,
      knowledgeRowIds: [], warnings: ["filePath must be a non-empty string"],
    };
  }
  if (filePath.includes("\u0000")) {
    return {
      ok: false, paperId: "", title: "", sourceLabel: "",
      chunksWritten: 0, chunksEmbedded: 0, totalChars: 0,
      knowledgeRowIds: [], warnings: ["filePath contains a NUL byte"],
    };
  }
  // realpath collapses .. and symlinks so we jail against the *true* target,
  // not the textual path. Fall back to resolve() if the file doesn't exist
  // yet (existsSync check below will catch it).
  let abs: string;
  try {
    abs = fs.realpathSync(path.resolve(filePath));
  } catch {
    abs = path.resolve(filePath);
  }
  if (!isPathInsideAllowedRoot(abs)) {
    return {
      ok: false, paperId: "", title: "", sourceLabel: "",
      chunksWritten: 0, chunksEmbedded: 0, totalChars: 0,
      knowledgeRowIds: [],
      warnings: [`ingest_paper: path outside allowed roots — must live under attached_assets/, project-assets/, data/, docs/, or os.tmpdir(). Got: ${abs}`],
    };
  }
  if (!fs.existsSync(abs)) {
    return {
      ok: false,
      paperId: "",
      title: "",
      sourceLabel: "",
      chunksWritten: 0,
      chunksEmbedded: 0,
      totalChars: 0,
      knowledgeRowIds: [],
      warnings: [`file not found: ${abs}`],
    };
  }
  if (!Number.isFinite(tenantId)) {
    throw new Error("ingestPaper: tenantId is required (no defaults — replit.md hard rule)");
  }

  const basename = path.basename(abs);
  const arxivId = detectArxivId(abs, basename);
  const lower = basename.toLowerCase();
  const isTarball = lower.endsWith(".tar.gz") || lower.endsWith(".tgz") || lower.includes(".tar_") || lower.endsWith(".tar");
  const isPdf = lower.endsWith(".pdf");

  const warnings: string[] = [];
  let text = "";
  let titleDetected = opts.titleHint || basename;

  try {
    if (isTarball) {
      const { text: t, title } = extractFromTarball(abs);
      text = t;
      titleDetected = opts.titleHint || title;
    } else if (isPdf) {
      const { text: t, title } = await extractFromPdf(abs);
      text = t;
      titleDetected = opts.titleHint || title;
    } else {
      return {
        ok: false,
        paperId: arxivId || basename,
        title: titleDetected,
        sourceLabel: basename,
        chunksWritten: 0,
        chunksEmbedded: 0,
        totalChars: 0,
        knowledgeRowIds: [],
        warnings: [`unsupported file extension: ${basename} (expected .pdf, .tar, .tar.gz, .tgz)`],
      };
    }
  } catch (err: any) {
    return {
      ok: false,
      paperId: arxivId || basename,
      title: titleDetected,
      sourceLabel: basename,
      chunksWritten: 0,
      chunksEmbedded: 0,
      totalChars: 0,
      knowledgeRowIds: [],
      warnings: [`extraction failed: ${err?.message || err}`],
    };
  }

  const totalChars = text.length;
  if (totalChars < 200) {
    return {
      ok: false,
      paperId: arxivId || basename,
      title: titleDetected,
      sourceLabel: basename,
      chunksWritten: 0,
      chunksEmbedded: 0,
      totalChars,
      knowledgeRowIds: [],
      warnings: [`extracted text too short (${totalChars} chars) — likely a scanned/image-only PDF`],
    };
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return {
      ok: false,
      paperId: arxivId || basename,
      title: titleDetected,
      sourceLabel: basename,
      chunksWritten: 0,
      chunksEmbedded: 0,
      totalChars,
      knowledgeRowIds: [],
      warnings: ["chunker produced 0 chunks"],
    };
  }
  if (chunks.length >= MAX_CHUNKS_PER_PAPER) {
    warnings.push(`truncated to ${MAX_CHUNKS_PER_PAPER} chunks (paper exceeds cap)`);
  }

  const paperId = arxivId || basename.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80);
  const sourceLabel = arxivId ? `paper:arxiv:${arxivId}` : `paper:${paperId}`;
  const sourceUrl = opts.sourceUrl || (arxivId ? `https://arxiv.org/abs/${arxivId.replace(/v\d+$/, "")}` : null);

  // R113.3+sec — Idempotency race fix (architect MEDIUM finding).
  // Pre-check is informational only; the AUTHORITATIVE idempotency gate is a
  // Postgres advisory lock + re-check inside the transaction below. Without
  // this, two concurrent ingest_paper calls for the same (tenant, source)
  // could both pass the pre-check and double-insert chunks.
  const existing = await db.execute(sql`
    SELECT id FROM agent_knowledge
    WHERE tenant_id = ${tenantId} AND source = ${sourceLabel}
    LIMIT 1
  `);
  const existingRows = (existing as any).rows || existing;
  if (existingRows.length > 0) {
    warnings.push("paper already ingested for this tenant — skipping (delete existing rows to re-ingest)");
    return {
      ok: true,
      paperId,
      title: titleDetected,
      sourceLabel,
      chunksWritten: 0,
      chunksEmbedded: 0,
      totalChars,
      knowledgeRowIds: [],
      warnings,
    };
  }

  // Pre-embed everything OUTSIDE the transaction (embeddings are slow network
  // calls; holding a tx open across them would starve the pool).
  type PendingRow = { title: string; content: string; priority: number; embedding: number[] | null };
  const pending: PendingRow[] = [];
  let embedded = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkTitle = `${titleDetected} — chunk ${i + 1}/${chunks.length}`;
    const embedding = await generateEmbedding(chunk);
    if (embedding) embedded++;
    pending.push({ title: chunkTitle, content: chunk, priority: 4, embedding: embedding || null });
  }

  // HEAD row — summary so a single semantic query "what does the LEANN paper say"
  // can land here even before chunk-level retrieval.
  const headTitle = `${titleDetected} — HEAD`;
  const headContent = [
    `Paper: ${titleDetected}`,
    sourceUrl ? `Source: ${sourceUrl}` : null,
    `Ingested: ${new Date().toISOString().slice(0, 10)}`,
    `Chunks: ${chunks.length} (${totalChars.toLocaleString()} chars)`,
    "",
    "OPENING:",
    text.slice(0, 2000),
  ].filter(Boolean).join("\n");
  const headEmbed = await generateEmbedding(headContent);
  if (headEmbed) embedded++;
  pending.push({ title: headTitle, content: headContent, priority: 5, embedding: headEmbed || null });

  // Validate embeddings are finite floats — defensive guard against bad
  // upstream data sneaking into the vector literal.
  for (const row of pending) {
    if (row.embedding && row.embedding.some((n) => !Number.isFinite(n))) {
      warnings.push(`row "${row.title}" had non-finite embedding values; storing without vector`);
      row.embedding = null;
    }
  }

  // Atomic insert: all rows in one transaction with a per-(tenant, source)
  // advisory lock so concurrent ingests for the same paper are serialized
  // and the re-check inside the lock catches any racer that won the pre-check.
  // The advisory lock is held until commit/rollback (pg_advisory_xact_lock).
  const rowIds: number[] = [];
  let skippedByRace = false;
  await db.transaction(async (tx) => {
    // Two-arg pg_advisory_xact_lock(int4, int4): namespace = tenantId,
    // key = hashtext(sourceLabel) (Postgres-native hash, no extension).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${tenantId}::int, hashtext(${sourceLabel})::int)`);
    // Re-check under the lock — the racer would have inserted by now.
    const recheck = await tx.execute(sql`
      SELECT 1 FROM agent_knowledge
      WHERE tenant_id = ${tenantId} AND source = ${sourceLabel}
      LIMIT 1
    `);
    const recheckRows = (recheck as any).rows || recheck;
    if (recheckRows.length > 0) {
      skippedByRace = true;
      return;
    }
    for (const row of pending) {
      // Parameterized vector literal — `${literal}::vector`. The literal is a
      // string we construct here from internally-generated finite floats; no
      // user input, no sql.raw. Pattern mirrors replit.md `text[]` guidance.
      const vecLiteral = row.embedding ? `[${row.embedding.join(",")}]` : null;
      const inserted = await tx.execute(sql`
        INSERT INTO agent_knowledge
          (tenant_id, title, content, category, priority, source, embedding_vec, created_at, updated_at)
        VALUES
          (${tenantId}, ${row.title}, ${row.content}, 'paper', ${row.priority}, ${sourceLabel},
           ${vecLiteral === null ? null : sql`${vecLiteral}::vector`},
           NOW(), NOW())
        RETURNING id
      `);
      const insertedRows = (inserted as any).rows || inserted;
      if (insertedRows[0]?.id) rowIds.push(insertedRows[0].id);
    }
  });

  if (skippedByRace) {
    warnings.push("concurrent ingest_paper for the same source completed first — skipped to preserve idempotency");
    return {
      ok: true,
      paperId,
      title: titleDetected,
      sourceLabel,
      chunksWritten: 0,
      chunksEmbedded: 0,
      totalChars,
      knowledgeRowIds: [],
      warnings,
    };
  }

  return {
    ok: true,
    paperId,
    title: titleDetected,
    sourceLabel,
    chunksWritten: rowIds.length,
    chunksEmbedded: embedded,
    totalChars,
    knowledgeRowIds: rowIds,
    warnings,
  };
}
