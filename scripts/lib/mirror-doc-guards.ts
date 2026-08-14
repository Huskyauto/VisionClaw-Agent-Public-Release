/**
 * Pure comparison logic for the public-mirror doc guards (stages 0.1 / 0.2 of
 * scripts/build-public-mirror.sh). Extracted from
 * scripts/verify-mirror-tool-count.ts and scripts/verify-mirror-persona-count.ts
 * so the guards' fail-closed behavior is testable without a live DB or the
 * real registry (extract-error-contract pattern).
 *
 * Every function here FAILS CLOSED: any unreadable/inconsistent/empty input
 * produces { ok: false } — never a vacuous pass.
 */

export type GuardResult = { ok: true; message: string } | { ok: false; message: string };

/** Structural rows of docs/tools.md: one "| `tool_name` |" table row per public tool. */
export function parseToolDocRows(doc: string): string[] {
  const rowNames: string[] = [];
  const rowRe = /^\| `([a-z][a-z0-9_]*)` \|/gm;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(doc))) rowNames.push(m[1]);
  return rowNames;
}

/** Prose header count of docs/tools.md ("**N public tools**"); -1 when unparseable. */
export function parseToolDocHeaderCount(doc: string): number {
  const headerMatch = doc.match(/\*\*(\d+) public tools\*\*/);
  return headerMatch ? parseInt(headerMatch[1], 10) : -1;
}

/**
 * Verify docs/tools.md content against the authoritative public tool surface
 * (registered tool names minus trusted-only names). Compares NAME SETS, not
 * just counts, so an add+drop pair that nets to zero is still caught.
 */
export function checkToolsDoc(
  doc: string,
  registered: string[],
  trustedOnlyNames: Iterable<string>,
): GuardResult {
  const rowNames = parseToolDocRows(doc);
  const docNames = new Set(rowNames);
  if (docNames.size !== rowNames.length) {
    return {
      ok: false,
      message: `docs/tools.md has duplicate tool rows (${rowNames.length} rows, ${docNames.size} unique)`,
    };
  }

  // Internal consistency: prose header count must match the table rows. This
  // ALSO catches the vacuous-pass shape where the row regex matches zero rows
  // AND the header parse fails (0 !== -1 → fail closed).
  const headerCount = parseToolDocHeaderCount(doc);
  if (headerCount !== rowNames.length) {
    return {
      ok: false,
      message: `tools.md internally inconsistent — header says ${headerCount}, ${rowNames.length} table rows found`,
    };
  }

  if (registered.length === 0) {
    return {
      ok: false,
      message: "tool registry loaded EMPTY — authoritative surface unreadable (fail closed)",
    };
  }
  const trustedOnly = new Set(trustedOnlyNames);
  const expected = new Set(registered.filter((n) => !trustedOnly.has(n)));

  const missingFromDoc = [...expected].filter((n) => !docNames.has(n)).sort();
  const extraInDoc = [...docNames].filter((n) => !expected.has(n)).sort();
  if (missingFromDoc.length || extraInDoc.length) {
    return {
      ok: false,
      message:
        `docs/tools.md (${docNames.size} tools) does not match the authoritative public surface (${expected.size} = ${registered.length} registered − ${trustedOnly.size} trusted-only).\n` +
        (missingFromDoc.length ? `  Missing from doc (${missingFromDoc.length}): ${missingFromDoc.slice(0, 25).join(", ")}${missingFromDoc.length > 25 ? ", …" : ""}\n` : "") +
        (extraInDoc.length ? `  In doc but not registered publicly (${extraInDoc.length}): ${extraInDoc.slice(0, 25).join(", ")}${extraInDoc.length > 25 ? ", …" : ""}\n` : "") +
        `  Likely causes: a new tool-definition file/shape not covered by scripts/generate-public-docs.ts's extractor\n` +
        `  (it regexes server/tools.ts + server/tools/domains/** via scripts/lib/tool-source-files.ts), a tool missing its\n` +
        `  server/tool-registry.ts registerTool() entry, or a stale docs/tools.md. Fix the source, regenerate, re-run the mirror build.`,
    };
  }

  return {
    ok: true,
    message: `docs/tools.md (${docNames.size}) matches authoritative public tool surface (${registered.length} registered − ${trustedOnly.size} trusted-only)`,
  };
}

/** Structural per-persona section headers of docs/personas.md ("## <n>. <Name>"). */
export function parsePersonaDocSectionCount(doc: string): number {
  return (doc.match(/^## \d+\.\s+\S/gm) || []).length;
}

/** Prose header count of docs/personas.md ("**N personas**"); -1 when unparseable. */
export function parsePersonaDocHeaderCount(doc: string): number {
  const headerMatch = doc.match(/\*\*(\d+) personas\*\*/);
  return headerMatch ? parseInt(headerMatch[1], 10) : -1;
}

/**
 * Verify docs/personas.md content against the authoritative active-persona
 * count (from the DB — passed in so this stays pure/testable). activeCount<=0
 * fails closed: an empty personas table means the truth source is unreadable.
 */
export function checkPersonasDoc(doc: string, activeCount: number): GuardResult {
  const sectionCount = parsePersonaDocSectionCount(doc);
  const headerCount = parsePersonaDocHeaderCount(doc);
  if (headerCount !== sectionCount) {
    return {
      ok: false,
      message: `personas.md internally inconsistent — header says ${headerCount}, ${sectionCount} sections found`,
    };
  }
  if (!Number.isInteger(activeCount) || activeCount <= 0) {
    return {
      ok: false,
      message: `active persona count unreadable/empty (${activeCount}) — authoritative surface unavailable (fail closed)`,
    };
  }
  if (sectionCount !== activeCount) {
    return {
      ok: false,
      message:
        `docs/personas.md lists ${sectionCount} personas but the platform has ${activeCount} active personas.\n` +
        `  A persona was likely added in a source file scripts/generate-public-docs.ts does not parse\n` +
        `  (it reads server/seed-persona-prompts.ts + server/seed.ts). Fix the extractor, regenerate, and re-run the mirror build.`,
    };
  }
  return {
    ok: true,
    message: `docs/personas.md (${sectionCount}) matches active personas in DB (${activeCount})`,
  };
}
