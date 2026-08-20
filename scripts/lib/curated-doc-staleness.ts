/**
 * Curated persona tools_doc staleness scan — shared logic (Task 116, 2026-08-01).
 *
 * Since Task 115, the PERSONA_DOCS[*].tools_doc literals in
 * server/seed-persona-prompts.ts are documentation-only (server/persona-sync.ts
 * is the single canonical writer of personas.tools_doc), but they still feed
 * the public mirror via scripts/generate-public-docs.ts. With no writer keeping
 * them honest, a renamed/removed tool would silently ship stale capability
 * descriptions to the public mirror.
 *
 * This module is deliberately PURE + STATIC (no server imports, no DB) so it
 * can run in three contexts:
 *   - scripts/verify-agent-wiring.ts Check 7 (live registry, exit bit 16)
 *   - scripts/verify-curated-tools-doc.ts (static gate inside
 *     scripts/build-public-mirror.sh — fail-closed before any push)
 *   - tests (no pg pool — a lib test that opens a DB pool hangs under run.sh)
 *
 * Rule: every snake_case token in a curated tools_doc / tools_doc_addendum
 * literal must be either a registered tool or on the explicit non-tool
 * allowlist below. Removing/renaming a tool makes its mention "unknown" and
 * trips the scan.
 */

/**
 * Known NON-tool snake_case tokens that legitimately appear in curated docs
 * (tool params, sub-actions, DB tables, workflow args). Audited 2026-08-01.
 * Adding a new non-tool snake_case term to a curated doc requires adding it
 * here — deliberate friction so stale tool names can't hide.
 */
export const CURATED_DOC_NON_TOOL_TOKENS = new Set<string>([
  "add_doc", "add_file", "add_note", "auto_contextualize", "call_to_action",
  "customer_email", "drive_url", "email_to", "generate_image", "has_photo",
  "job_id", "lease_grants", "open_access_only", "photo_path",
  "preflight_blocked", "produce_video_args", "project_id",
  "repair_incidents", "skill_candidate", "source_material", "style_notes",
  "target_duration_seconds", "use_bwb_weekly_build", "watch_progress_url",
  "watch_url", "youtube_upload",
]);

/** Snake_case token shape: lowercase, at least one underscore segment. */
const TOKEN_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/**
 * Scan one curated doc text; return the distinct tokens that are neither a
 * registered tool nor allowlisted (i.e. suspected-stale tool mentions).
 */
export function scanCuratedDocText(
  text: string,
  registeredTools: ReadonlySet<string>,
  allowlist: ReadonlySet<string> = CURATED_DOC_NON_TOOL_TOKENS,
): string[] {
  const stale: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(TOKEN_RE)) {
    const tok = m[0];
    if (seen.has(tok)) continue;
    seen.add(tok);
    if (registeredTools.has(tok)) continue;
    if (allowlist.has(tok)) continue;
    stale.push(tok);
  }
  return stale;
}

export interface CuratedDocLiteral {
  personaId: number;
  field: "tools_doc" | "tools_doc_addendum";
  text: string;
}

/**
 * Statically extract every tools_doc / tools_doc_addendum template literal
 * from the seed-persona-prompts.ts SOURCE TEXT, associating each with the
 * nearest preceding `<id>: {` PERSONA_DOCS key. Static so the mirror gate
 * never imports server modules (side effects / DB).
 */
export function extractCuratedDocLiterals(seedSrc: string): CuratedDocLiteral[] {
  const out: CuratedDocLiteral[] = [];
  const litRe = /(tools_doc(?:_addendum)?):\s*`((?:[^`\\]|\\.)*)`/g;
  const idRe = /^\s*(\d+):\s*\{/gm;
  const idPositions: Array<{ idx: number; id: number }> = [];
  let im: RegExpExecArray | null;
  while ((im = idRe.exec(seedSrc))) idPositions.push({ idx: im.index, id: parseInt(im[1], 10) });
  let m: RegExpExecArray | null;
  while ((m = litRe.exec(seedSrc))) {
    let personaId = -1;
    for (const p of idPositions) {
      if (p.idx < m.index) personaId = p.id;
      else break;
    }
    out.push({
      personaId,
      field: m[1] as CuratedDocLiteral["field"],
      text: m[2],
    });
  }
  return out;
}

/**
 * Statically extract registered tool names from tool source texts by the same
 * OpenAI function-envelope anchor generate-public-docs.ts uses. Kept here so
 * the mirror gate and tests share one extraction.
 */
export function extractStaticToolNames(sources: readonly string[]): Set<string> {
  const names = new Set<string>();
  const re = /function:\s*\{\s*name:\s*"([a-z][a-z0-9_]*)"/g;
  for (const src of sources) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(src))) names.add(m[1]);
  }
  return names;
}
