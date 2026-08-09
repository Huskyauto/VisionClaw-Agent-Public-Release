// R105 — Hierarchical document index (PageIndex nugget).
//
// Builds a navigable TOC-style tree from markdown headings (#/##/### ...) so
// a persona can WALK a long doc instead of relying purely on chunk-vector
// retrieval. Pure structural parsing — no LLM, no embedding cost. Stored at
// ingest time in `doc_heading_trees`, surfaced at query time via the
// `knowledge_navigate` tool.
//
// Source pattern: VectifyAI/PageIndex (MIT) — "reasoning-based retrieval"
// alternative to vector RAG for long structured docs (financial filings,
// legal contracts, technical manuals). Adopted as a complement, not a
// replacement, for the existing pgvector + MNEMA stack.

import { db } from "./db";
import { sql } from "drizzle-orm";

const TREE_MIN_HEADINGS = 3;
// Cap to keep a single tree row sane. Headings beyond this are flattened into
// the last accepted parent. 5000 is far above any realistic real-world doc.
const TREE_MAX_HEADINGS = 5000;
// How much body text to return per `read` navigation. Bounded to keep tool
// outputs comfortable for the model context window.
const READ_MAX_CHARS = 6000;

export interface HeadingNode {
  title: string;
  level: number;       // 1..6 (markdown heading depth)
  lineStart: number;   // 0-indexed line of the heading itself
  lineEnd: number;     // 0-indexed line just before the next heading at same-or-shallower level
  children: HeadingNode[];
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Parse markdown content into a nested heading tree.
 * Returns { tree, totalHeadings, totalLines } — tree is an array of top-level
 * heading nodes (so a doc with multiple H1s reads naturally).
 */
export function buildHeadingTree(content: string): {
  tree: HeadingNode[];
  totalHeadings: number;
  totalLines: number;
} {
  const lines = content.split("\n");
  const flat: HeadingNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (!m) continue;
    if (flat.length >= TREE_MAX_HEADINGS) break;
    const level = m[1].length;
    const title = m[2].trim().slice(0, 300);
    if (!title) continue;
    flat.push({ title, level, lineStart: i, lineEnd: lines.length - 1, children: [] });
  }

  // Backfill lineEnd: a heading's section ends just before the next heading
  // at the same OR shallower level.
  for (let i = 0; i < flat.length; i++) {
    const cur = flat[i];
    let end = lines.length - 1;
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[j].level <= cur.level) {
        end = flat[j].lineStart - 1;
        break;
      }
    }
    cur.lineEnd = end;
  }

  // Build nested structure via a stack of currently-open ancestors.
  const tree: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  for (const node of flat) {
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (stack.length === 0) tree.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return { tree, totalHeadings: flat.length, totalLines: lines.length };
}

/**
 * Persist (or refresh) the heading tree for a single doc. Returns whether a
 * tree was actually written (false = doc too small / no headings).
 */
export async function saveHeadingTree(opts: {
  collectionId: number;
  docPath: string;
  docTitle: string;
  content: string;
  tenantId: number;
}): Promise<{ stored: boolean; totalHeadings: number; totalLines: number }> {
  const { tree, totalHeadings, totalLines } = buildHeadingTree(opts.content);
  if (totalHeadings < TREE_MIN_HEADINGS) {
    // Clear any stale tree from a previous larger version of the doc.
    await db.execute(sql`
      DELETE FROM doc_heading_trees
      WHERE collection_id = ${opts.collectionId}
        AND doc_path = ${opts.docPath}
        AND tenant_id = ${opts.tenantId}
    `);
    return { stored: false, totalHeadings, totalLines };
  }
  const treeJson = JSON.stringify(tree);
  await db.execute(sql`
    INSERT INTO doc_heading_trees
      (collection_id, doc_path, doc_title, tree, total_headings, total_lines, tenant_id, updated_at)
    VALUES
      (${opts.collectionId}, ${opts.docPath}, ${opts.docTitle},
       ${treeJson}::jsonb, ${totalHeadings}, ${totalLines}, ${opts.tenantId}, NOW())
    ON CONFLICT (collection_id, doc_path, tenant_id) DO UPDATE SET
      doc_title       = EXCLUDED.doc_title,
      tree            = EXCLUDED.tree,
      total_headings  = EXCLUDED.total_headings,
      total_lines     = EXCLUDED.total_lines,
      updated_at      = NOW()
  `);
  return { stored: true, totalHeadings, totalLines };
}

/**
 * Whether a tenant has ANY heading trees. Used by chat-engine's low-κ
 * fallback to decide whether suggesting `knowledge_navigate` is meaningful.
 */
export async function tenantHasHeadingTrees(tenantId: number): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      SELECT 1 FROM doc_heading_trees WHERE tenant_id = ${tenantId} LIMIT 1
    `);
    return ((r as any).rows || []).length > 0;
  } catch {
    return false;
  }
}

interface ListTreeOptions {
  tenantId: number;
  query?: string;       // matches doc_title / doc_path (case-insensitive)
  collection?: string;  // collection name filter
  docPath?: string;     // exact doc_path
  limit?: number;
}

/**
 * List heading trees (full tree of each matching doc). Bounded by limit to
 * protect the model context. Returns one entry per matching doc.
 */
export async function listHeadingTrees(opts: ListTreeOptions): Promise<{
  docs: Array<{
    collectionId: number;
    collectionName: string | null;
    docPath: string;
    docTitle: string;
    totalHeadings: number;
    totalLines: number;
    tree: HeadingNode[];
  }>;
}> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  const conditions: any[] = [sql`t.tenant_id = ${opts.tenantId}`];
  if (opts.docPath) {
    conditions.push(sql`t.doc_path = ${opts.docPath}`);
  } else if (opts.query) {
    const like = `%${opts.query.toLowerCase()}%`;
    conditions.push(sql`(LOWER(t.doc_title) LIKE ${like} OR LOWER(t.doc_path) LIKE ${like})`);
  }
  if (opts.collection) {
    conditions.push(sql`c.name = ${opts.collection}`);
  }
  let where = conditions[0];
  for (let i = 1; i < conditions.length; i++) {
    where = sql`${where} AND ${conditions[i]}`;
  }
  const r = await db.execute(sql`
    SELECT t.collection_id, t.doc_path, t.doc_title, t.total_headings,
           t.total_lines, t.tree, c.name AS collection_name
    FROM doc_heading_trees t
    LEFT JOIN doc_collections c ON c.id = t.collection_id
    WHERE ${where}
    ORDER BY t.updated_at DESC
    LIMIT ${limit}
  `);
  const rows = (r as any).rows || [];
  return {
    docs: rows.map((row: any) => ({
      collectionId: row.collection_id,
      collectionName: row.collection_name ?? null,
      docPath: row.doc_path,
      docTitle: row.doc_title,
      totalHeadings: row.total_headings,
      totalLines: row.total_lines,
      tree: row.tree as HeadingNode[],
    })),
  };
}

/**
 * Walk a tree following a heading-path (array of titles, case-insensitive,
 * substring-tolerant) and return the matched node, plus the body text under
 * it (looked up from doc_chunks reassembled, or from the raw markdown if we
 * stored line ranges only). Falls back to nearest matching ancestor when an
 * intermediate path segment doesn't match exactly.
 */
function walkPath(tree: HeadingNode[], path: string[]): HeadingNode | null {
  let nodes = tree;
  let last: HeadingNode | null = null;
  for (const seg of path) {
    const segLower = seg.toLowerCase().trim();
    const match =
      nodes.find((n) => n.title.toLowerCase() === segLower) ||
      nodes.find((n) => n.title.toLowerCase().includes(segLower));
    if (!match) return last;
    last = match;
    nodes = match.children;
  }
  return last;
}

/**
 * Read the body text under a heading-path. We reassemble from the doc's
 * stored chunks (no need to hold raw doc text in the trees row).
 */
export async function readHeadingSection(opts: {
  tenantId: number;
  collectionId: number;
  docPath: string;
  headingPath: string[];
}): Promise<{
  found: boolean;
  heading?: { title: string; level: number; lineStart: number; lineEnd: number };
  text?: string;
  truncated?: boolean;
}> {
  const treeRow = await db.execute(sql`
    SELECT tree FROM doc_heading_trees
    WHERE tenant_id = ${opts.tenantId}
      AND collection_id = ${opts.collectionId}
      AND doc_path = ${opts.docPath}
    LIMIT 1
  `);
  const tRows = (treeRow as any).rows || [];
  if (!tRows.length) return { found: false };
  const tree = tRows[0].tree as HeadingNode[];
  const node = walkPath(tree, opts.headingPath);
  if (!node) return { found: false };

  // Reassemble approximate section text from chunks. Chunks don't carry line
  // numbers, so we concatenate by chunk_index and slice by character length.
  // Good enough for navigation hints; precise line slicing would require
  // re-extracting the source PDF.
  const chunkRes = await db.execute(sql`
    SELECT content FROM doc_chunks
    WHERE tenant_id = ${opts.tenantId}
      AND collection_id = ${opts.collectionId}
      AND doc_path = ${opts.docPath}
    ORDER BY chunk_index
  `);
  const allText = ((chunkRes as any).rows || [])
    .map((r: any) => r.content as string)
    .join("\n\n");

  // Find the heading title in reassembled text and slice from there.
  const idx = allText.toLowerCase().indexOf(node.title.toLowerCase());
  let section = idx >= 0 ? allText.slice(idx) : allText;
  // Stop at the next heading line of same-or-shallower depth (rough cut).
  const stopRe = new RegExp(`\\n#{1,${node.level}}\\s`, "m");
  const stopMatch = section.slice(node.title.length + 1).search(stopRe);
  if (stopMatch >= 0) section = section.slice(0, node.title.length + 1 + stopMatch);

  const truncated = section.length > READ_MAX_CHARS;
  if (truncated) section = section.slice(0, READ_MAX_CHARS) + "\n…[truncated]…";

  return {
    found: true,
    heading: {
      title: node.title,
      level: node.level,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
    },
    text: section,
    truncated,
  };
}
