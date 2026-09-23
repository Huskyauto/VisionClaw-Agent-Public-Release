// ─────────────────────────────────────────────────────────────────────────────
// R93 — Project context-file loader (SOUL.md / AGENTS.md / .cursorrules)
// ─────────────────────────────────────────────────────────────────────────────
// Discovers and loads project-level context files for injection into the
// system prompt. Every file is run through the prompt-injection scanner
// (R85) before content is exposed to the model, so a malicious uploaded
// AGENTS.md cannot hijack instructions.
//
// Sources scanned (in order):
//   - AGENTS.md (recursive walk, alphabetical by path depth)
//   - .cursorrules + .cursor/rules/*.mdc
//   - SOUL.md (cwd, then ~/.visionclaw/SOUL.md fallback)
// Each individual block is capped at MAX_CHARS via head/tail truncation.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { logSilentCatch } from "./lib/silent-catch";
import * as os from "os";
import { scanContextContent } from "./prompt-injection-scanner";

const MAX_CHARS = 20_000;
const HEAD_RATIO = 0.7;
const TAIL_RATIO = 0.2;
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".cache", ".local", "__pycache__", "venv", ".venv", "dist", "build",
]);

function truncate(content: string, filename: string, maxChars = MAX_CHARS): string {
  if (content.length <= maxChars) return content;
  const head = content.slice(0, Math.floor(maxChars * HEAD_RATIO));
  const tail = content.slice(-Math.floor(maxChars * TAIL_RATIO));
  return `${head}\n\n[...truncated ${filename}: kept ${head.length}+${tail.length} of ${content.length} chars]\n\n${tail}`;
}

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function* walkAgentsMd(root: string, maxDepth = 6): Generator<string> {
  function* recurse(dir: string, depth: number): Generator<string> {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        yield* recurse(full, depth + 1);
      } else if (e.isFile() && e.name.toLowerCase() === "agents.md") {
        yield full;
      }
    }
  }
  yield* recurse(root, 0);
}

export interface LoadedContextFiles {
  systemPromptAddition: string;
  filesLoaded: string[];
  filesBlocked: Array<{ file: string; findings: string[] }>;
}

export function loadProjectContextFiles(cwd?: string): LoadedContextFiles {
  const root = path.resolve(cwd || process.cwd());
  const sections: string[] = [];
  const loaded: string[] = [];
  const blocked: Array<{ file: string; findings: string[] }> = [];

  // ─── AGENTS.md (hierarchical) ────────────────────────────────────────
  const topAgents = ["AGENTS.md", "agents.md"]
    .map((n) => path.join(root, n))
    .find((p) => fs.existsSync(p));

  if (topAgents) {
    const files = Array.from(walkAgentsMd(root)).sort(
      (a, b) => a.split(path.sep).length - b.split(path.sep).length,
    );
    let combined = "";
    for (const f of files) {
      const raw = safeRead(f);
      if (!raw) continue;
      const rel = path.relative(root, f);
      const scan = scanContextContent(raw.trim(), rel);
      if (!scan.clean) {
        blocked.push({ file: rel, findings: scan.findings.map((x) => x.pattern) });
        combined += `## ${rel}\n\n${scan.sanitized}\n\n`;
      } else {
        loaded.push(rel);
        combined += `## ${rel}\n\n${scan.sanitized}\n\n`;
      }
    }
    if (combined) sections.push(truncate(combined, "AGENTS.md"));
  }

  // ─── .cursorrules + .cursor/rules/*.mdc ─────────────────────────────
  let cursorBlock = "";
  const cursorRules = path.join(root, ".cursorrules");
  if (fs.existsSync(cursorRules)) {
    const raw = safeRead(cursorRules);
    if (raw) {
      const scan = scanContextContent(raw.trim(), ".cursorrules");
      if (!scan.clean) blocked.push({ file: ".cursorrules", findings: scan.findings.map((x) => x.pattern) });
      else loaded.push(".cursorrules");
      cursorBlock += `## .cursorrules\n\n${scan.sanitized}\n\n`;
    }
  }
  const cursorRulesDir = path.join(root, ".cursor", "rules");
  if (fs.existsSync(cursorRulesDir)) {
    let mdc: string[] = [];
    try {
      mdc = fs.readdirSync(cursorRulesDir).filter((f) => f.endsWith(".mdc")).sort();
    } catch (_silentErr) { logSilentCatch("server/context-files-loader.ts", _silentErr); }
    for (const name of mdc) {
      const full = path.join(cursorRulesDir, name);
      const raw = safeRead(full);
      if (!raw) continue;
      const rel = `.cursor/rules/${name}`;
      const scan = scanContextContent(raw.trim(), rel);
      if (!scan.clean) blocked.push({ file: rel, findings: scan.findings.map((x) => x.pattern) });
      else loaded.push(rel);
      cursorBlock += `## ${rel}\n\n${scan.sanitized}\n\n`;
    }
  }
  if (cursorBlock) sections.push(truncate(cursorBlock, ".cursorrules"));

  // ─── SOUL.md ─────────────────────────────────────────────────────────
  const soulCandidates = [
    path.join(root, "SOUL.md"),
    path.join(root, "soul.md"),
    path.join(os.homedir(), ".visionclaw", "SOUL.md"),
  ];
  for (const candidate of soulCandidates) {
    if (!fs.existsSync(candidate)) continue;
    const raw = safeRead(candidate);
    if (!raw) continue;
    const rel = path.relative(root, candidate) || candidate;
    const scan = scanContextContent(raw.trim(), "SOUL.md");
    if (!scan.clean) blocked.push({ file: rel, findings: scan.findings.map((x) => x.pattern) });
    else loaded.push(rel);
    sections.push(
      `## SOUL.md\n\nIf SOUL.md is present, embody its persona and tone.\n\n${truncate(scan.sanitized, "SOUL.md")}`,
    );
    break;
  }

  if (sections.length === 0) {
    return { systemPromptAddition: "", filesLoaded: [], filesBlocked: blocked };
  }

  return {
    systemPromptAddition:
      "# Project Context\n\nThe following project context files have been loaded and should be followed:\n\n" +
      sections.join("\n"),
    filesLoaded: loaded,
    filesBlocked: blocked,
  };
}
