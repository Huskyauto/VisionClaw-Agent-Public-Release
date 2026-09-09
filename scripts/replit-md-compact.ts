#!/usr/bin/env tsx
/**
 * scripts/replit-md-compact.ts — auto-compaction of replit.md "Recent rounds".
 *
 * Why this exists:
 *   replit.md is the live, human + agent-readable platform README. Each new
 *   release prepends a one-liner under the "Recent rounds" section. Left
 *   unchecked the section grows linearly forever; the platform itself starts
 *   nagging "the file is getting large", and Bob has to ask the agent to
 *   manually compact (R110.14 was the second time in two days). This script
 *   makes that automatic.
 *
 * What it does (idempotent, safe to run on every commit cycle):
 *   1. Parses the "Recent rounds (one-liner; ..." section in replit.md.
 *   2. Keeps the KEEP_RECENT_ROUNDS most recent (default 8).
 *   3. Moves older one-liners to docs/release-log-archive.md as stub prose
 *      entries (### R{round} — {title} ({date}) + body). Stubs are
 *      prepended above the existing entries to preserve newest-first order.
 *   4. Updates the "Full prose R98.24 → RX" pointer at top of replit.md to
 *      reflect the new newest archived round.
 *   5. Atomic writes (tmp + rename) on both files. Refuses to write on any
 *      sanity-check failure (no archive entries, regex miss, etc.).
 *
 * Threshold tuning:
 *   - KEEP_RECENT_ROUNDS=8 covers ~1 week of active development.
 *   - Override via env: REPLIT_MD_KEEP_RECENT_ROUNDS=12 npx tsx scripts/replit-md-compact.ts
 *
 * Wiring:
 *   - scripts/git-auto-push.sh runs this BEFORE `git add -A` every cycle.
 *   - Fails OPEN (non-zero exit logs but does not block the commit).
 *   - Manual run: `npx tsx scripts/replit-md-compact.ts`.
 *
 * Exit codes:
 *   0 = success (compacted OR no-op under threshold)
 *   1 = sanity check failed, no writes performed
 *   2 = unexpected error (file missing, malformed)
 */

import * as fs from "fs";
import * as path from "path";

const REPLIT_MD = "replit.md";
const ARCHIVE = "docs/release-log-archive.md";
const KEEP_RECENT_ROUNDS = parseInt(process.env.REPLIT_MD_KEEP_RECENT_ROUNDS || "5", 10);
// R111.3 — size-based gate. The original count-only trigger let huge essay
// entries (R111, R111.1, R111.2 are 2-3KB each) blow up the file even when
// round count was under 8. Now we ALSO compact if the recent-rounds section
// exceeds MAX_SECTION_CHARS, keeping at least MIN_KEEP rounds.
const MAX_SECTION_CHARS = parseInt(process.env.REPLIT_MD_MAX_SECTION_CHARS || "6000", 10);
const MIN_KEEP_ROUNDS = parseInt(process.env.REPLIT_MD_MIN_KEEP_ROUNDS || "3", 10);

// "- **R110.14** (2026-05-11) — body..."
// "- **R110.11.7 +sec** (2026-05-11) — body..."
// R111.3 — broaden round-tag matcher. Was `R[\d.]+(?:\s\+sec)?` only, which
// missed `R111.1 INCIDENT FIX`, `R110.21.2 +sec`, etc. and broke section
// scanning at the first non-matching bullet, leaving the section under-counted
// and the size gate unable to fire. Now anything between `**...**` is fine
// as long as it starts with `R<digits>`.
const ROUND_LINE_PATTERN = /^- \*\*(R[\d.]+[^*]*?)\*\*\s*\((\d{4}-\d{2}-\d{2})\)\s*—\s*(.+)$/;
const SECTION_HEADER_PATTERN = /^\*\*Recent rounds \(one-liner;/;
// "- **Full prose R98.24 → R110.12** → `docs/release-log-archive.md`."
const FULL_PROSE_POINTER_PATTERN = /^(- \*\*Full prose R[\d.]+(?:\s\+sec)? → )(R[\d.]+(?:\s\+sec)?)(\*\* → `docs\/release-log-archive\.md`\.)\s*$/;

function atomicWrite(filePath: string, contents: string): void {
  const tmp = filePath + ".tmp." + process.pid;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filePath);
}

function deriveTitleFromBody(body: string): string {
  // Strip leading bold marker like "**R110.14**" — but our regex already did.
  // Title heuristic: take everything up to the first " **" (next bolded
  // section start) OR first ". " (sentence end), whichever comes first.
  // Cap at 140 chars. This produces nice human-readable archive headers.
  const stops = [body.indexOf(" **"), body.indexOf(". "), 140].filter((n) => n > 0);
  const cut = Math.min(...stops);
  let title = body.slice(0, cut).trim();
  // Strip trailing "**" if we cut mid-bold accidentally
  title = title.replace(/\s*\*+\s*$/, "").trim();
  // Final cap
  if (title.length > 140) title = title.slice(0, 137) + "...";
  if (!title) title = "(see body)";
  return title;
}

function main(): number {
  if (!fs.existsSync(REPLIT_MD)) {
    console.error(`[replit-md-compact] ${REPLIT_MD} not found — exiting 2`);
    return 2;
  }
  if (!fs.existsSync(ARCHIVE)) {
    console.error(`[replit-md-compact] ${ARCHIVE} not found — refusing to compact without archive (exit 1)`);
    return 1;
  }
  if (!Number.isFinite(KEEP_RECENT_ROUNDS) || KEEP_RECENT_ROUNDS < 1 || KEEP_RECENT_ROUNDS > 50) {
    console.error(`[replit-md-compact] KEEP_RECENT_ROUNDS=${KEEP_RECENT_ROUNDS} out of range [1,50] — exit 1`);
    return 1;
  }

  const md = fs.readFileSync(REPLIT_MD, "utf8");
  const lines = md.split("\n");

  const headerIdx = lines.findIndex((l) => SECTION_HEADER_PATTERN.test(l));
  if (headerIdx < 0) {
    console.log("[replit-md-compact] no 'Recent rounds (one-liner;' section header found — nothing to do");
    return 0;
  }

  // Collect round bullet line indices following the header. Stop when we hit
  // a non-bullet, non-blank-followed-by-bullet line (i.e. next section).
  // Round entries are single-line bullets; section ends at next "## " heading
  // or "**Aggregate" or any other non-empty non-bullet line.
  const roundIndices: number[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (ROUND_LINE_PATTERN.test(line)) {
      roundIndices.push(i);
      continue;
    }
    if (line.trim() === "") {
      // Blank line: peek ahead — if next non-blank starts a new section,
      // we're done. Otherwise (continuation gap inside list), keep scanning.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j >= lines.length) break;
      if (!ROUND_LINE_PATTERN.test(lines[j])) break;
      continue;
    }
    // Non-blank, non-bullet line → section ended.
    break;
  }

  // Two gates: count-based (KEEP_RECENT_ROUNDS) and size-based (MAX_SECTION_CHARS).
  // Whichever fires first wins; we always keep at least MIN_KEEP_ROUNDS.
  const sectionChars = roundIndices.reduce((s, i) => s + lines[i].length + 1, 0);
  const overByCount = roundIndices.length > KEEP_RECENT_ROUNDS;
  const overBySize = sectionChars > MAX_SECTION_CHARS && roundIndices.length > MIN_KEEP_ROUNDS;
  if (!overByCount && !overBySize) {
    console.log(`[replit-md-compact] ${roundIndices.length} rounds, ${sectionChars}ch (count_threshold=${KEEP_RECENT_ROUNDS}, size_threshold=${MAX_SECTION_CHARS}ch) — no-op`);
    return 0;
  }

  // Determine how many to keep. If size gate fires, shrink down to MIN_KEEP_ROUNDS
  // (or fewer if needed) until section drops below the threshold.
  let keep = overByCount ? KEEP_RECENT_ROUNDS : roundIndices.length;
  if (overBySize) {
    keep = Math.min(keep, roundIndices.length - 1);
    while (keep > MIN_KEEP_ROUNDS) {
      const trial = roundIndices.slice(0, keep).reduce((s, i) => s + lines[i].length + 1, 0);
      if (trial <= MAX_SECTION_CHARS) break;
      keep--;
    }
  }
  console.log(`[replit-md-compact] gate fired (overByCount=${overByCount}, overBySize=${overBySize}, ${sectionChars}ch); keeping ${keep} of ${roundIndices.length} rounds`);

  const moveIdx = roundIndices.slice(keep); // older entries
  const moveLines = moveIdx.map((i) => lines[i]);

  // Build stub prose entries for the archive. Stubs follow the existing
  // archive entry shape: `### Round — Title (Date)` + blank + body + blank
  // + `---` + blank.
  const stubs: string[] = [];
  for (const line of moveLines) {
    const m = line.match(ROUND_LINE_PATTERN);
    if (!m) {
      console.error(`[replit-md-compact] sanity: expected round line, got: ${line.slice(0, 80)} — exit 1`);
      return 1;
    }
    const round = m[1];
    const date = m[2];
    const body = m[3];
    const title = deriveTitleFromBody(body);
    stubs.push(`### ${round} — ${title} (${date})`);
    stubs.push("");
    stubs.push(`_(auto-compacted from replit.md by scripts/replit-md-compact.ts)_`);
    stubs.push("");
    stubs.push(body);
    stubs.push("");
    stubs.push("---");
    stubs.push("");
  }

  // Prepend stubs to archive above the first existing `### R` entry.
  const archive = fs.readFileSync(ARCHIVE, "utf8");
  const archiveLines = archive.split("\n");
  const firstEntryIdx = archiveLines.findIndex((l) => /^### R/.test(l));
  if (firstEntryIdx < 0) {
    console.error("[replit-md-compact] sanity: archive has no `### R` entries — refusing to corrupt (exit 1)");
    return 1;
  }
  const newArchiveLines = [
    ...archiveLines.slice(0, firstEntryIdx),
    ...stubs,
    ...archiveLines.slice(firstEntryIdx),
  ];

  // Remove moved lines from replit.md (reverse order preserves indices).
  const newMdLines = [...lines];
  for (let i = moveIdx.length - 1; i >= 0; i--) {
    newMdLines.splice(moveIdx[i], 1);
  }

  // Update "Full prose R98.24 → RX" pointer to newest-archived round.
  // Order in file: newest-first. moveLines[0] = newest of moved (= new
  // newest archived round, since archive grows newest-first too).
  // R111.3 — match the broadened ROUND_LINE_PATTERN; previously narrow regex
  // missed `R111.1 INCIDENT FIX` etc., so the "Full prose ... → RX" pointer
  // never advanced past the suffix-style rounds.
  const newestArchivedRound = moveLines[0].match(/^- \*\*(R[\d.]+[^*]*?)\*\*/)?.[1];
  if (newestArchivedRound) {
    const pointerIdx = newMdLines.findIndex((l) => FULL_PROSE_POINTER_PATTERN.test(l));
    if (pointerIdx >= 0) {
      newMdLines[pointerIdx] = newMdLines[pointerIdx].replace(
        FULL_PROSE_POINTER_PATTERN,
        (_match, p1, _p2, p3) => `${p1}${newestArchivedRound}${p3}`,
      );
    }
  }

  atomicWrite(ARCHIVE, newArchiveLines.join("\n"));
  atomicWrite(REPLIT_MD, newMdLines.join("\n"));

  // R111.3 — same broadened pattern; the moved-rounds log line was reporting
  // 9 moved but only listing 7 names because INCIDENT FIX rows fell out.
  const movedRounds = moveLines.map((l) => l.match(/^- \*\*(R[\d.]+[^*]*?)\*\*/)?.[1]).filter(Boolean);
  console.log(`[replit-md-compact] moved ${moveLines.length} round(s): ${movedRounds.join(", ")}`);
  console.log(`[replit-md-compact] replit.md: ${lines.length} → ${newMdLines.length} lines`);
  console.log(`[replit-md-compact] archive: ${archiveLines.length} → ${newArchiveLines.length} lines`);
  return 0;
}

try {
  process.exit(main());
} catch (e: any) {
  console.error(`[replit-md-compact] unexpected error: ${e?.message || String(e)}`);
  process.exit(2);
}
