/**
 * Tools-layer-split S27 — code-chunker-domain migrated handler.
 *
 * Single tool: `chunk_code` (cAST context-aware code splitting). The body is a
 * MECHANICAL move of the legacy switch arm (standing rules: no renames, no
 * behavior change, no added/removed gate; the workspace-relative path-traversal
 * safety check, size cap, and error strings preserved VERBATIM).
 *
 * SEAM: NONE — the arm is a PURE public-param wrapper (`params.filePath` /
 * `maxTokens` / `previewOnly`); it reads NO dispatcher-stripped trust signal, so
 * `ctx` is unused (verified against the deleted arm verbatim). Safety is
 * filesystem-scoped (workspace-root containment), not tenant-scoped.
 *
 * `../../../code-chunker`, `path`, and `fs` are pulled via call-time dynamic
 * `import(...)` — NOT top-level static imports — so the domain module statically
 * imports only within server/tools/ and cannot recurse into the app graph
 * (acyclicity invariant, plan.md S2). `server/code-chunker` does not import the
 * tools facade (grepped).
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import { defineTool } from "../../define-tool";
import type { RegisteredTool, ToolContext, ToolResult } from "../../types";
import { chunkCodeDefinition } from "./definitions";

async function chunkCodeHandler(
  params: Record<string, any>,
  _ctx: ToolContext,
): Promise<ToolResult> {
  const { chunkCodeContextAware, isSupportedCodeFile } = await import("../../../code-chunker");
  const fp = String(params.filePath || "").trim();
  if (!fp) return { error: "filePath is required" };
  // Basic safety: workspace-relative, no traversal outside the project root
  const path = await import("path");
  const fs = await import("fs");
  const root = process.cwd();
  const abs = path.isAbsolute(fp) ? fp : path.join(root, fp);
  const resolved = path.resolve(abs);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return { error: "filePath must resolve inside the workspace" };
  }
  if (!fs.existsSync(resolved)) return { error: `file not found: ${fp}` };
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) return { error: `not a file: ${fp}` };
  if (stat.size > 2_000_000) return { error: `file too large (${stat.size} bytes); cap is 2MB` };
  const source = fs.readFileSync(resolved, "utf-8");
  const maxTokens = typeof params.maxTokens === "number" ? Math.min(2000, Math.max(100, params.maxTokens)) : 800;
  const chunks = chunkCodeContextAware(fp, source, { maxTokens });
  const supported = isSupportedCodeFile(fp);
  if (params.previewOnly) {
    return {
      success: true, supported, count: chunks.length,
      chunks: chunks.map(c => ({ index: c.index, symbol: c.symbol, parentFile: c.parentFile, startLine: c.startLine, endLine: c.endLine, tokens: c.tokens })),
    };
  }
  return { success: true, supported, count: chunks.length, chunks };
}

/** Registered by ./index.ts at import time. */
export const codeChunkerDomainTools: RegisteredTool[] = [
  defineTool(chunkCodeDefinition, chunkCodeHandler),
];
