/**
 * preflight-domain-boundaries.ts — cross-domain import gate for the tools-layer split.
 *
 * The strangler-fig split of server/tools.ts into server/tools/domains/<domain>/
 * only stays clean if domains never import each other. This gate fails CI the
 * moment any file under server/tools/domains/<A>/ imports (statically or
 * dynamically) from server/tools/domains/<B>/ where A !== B.
 *
 * Allowed from a domain file:
 *   - its own domain directory
 *   - the tools package root (../../lib, ../../middleware, types, context,
 *     define-tool, registry, dispatcher, etc.)
 *   - anything OUTSIDE server/tools/domains (legacy server/*, shared/*, node_modules)
 *
 * Zero dependencies (same convention as preflight-file-girth / preflight-stale-strings).
 * Exit codes: 0 = clean, 1 = violations found, 2 = scan error (missing dir).
 *
 * Usage: npx tsx scripts/preflight-domain-boundaries.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

const DOMAINS_ROOT = path.resolve("server/tools/domains");

interface Violation {
  file: string;
  line: number;
  specifier: string;
  fromDomain: string;
  toDomain: string;
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && full.endsWith(".ts") && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

// Matches: import ... from "x" | export ... from "x" | import("x") | require("x")
const SPECIFIER_RE =
  /(?:from\s+["']([^"']+)["'])|(?:import\s*\(\s*["']([^"']+)["']\s*\))|(?:require\s*\(\s*["']([^"']+)["']\s*\))/g;

// Non-literal dynamic import/require (template string or variable specifier) inside a
// domain file — unresolvable statically, so it's a policy violation by itself: a
// `import(\`./\${x}\`)` could reach a sibling domain and this gate would never see it.
const NON_LITERAL_DYNAMIC_RE = /(?:\bimport|\brequire)\s*\(\s*(?!["'])[^)\s]/;

function domainOf(absPath: string): string | null {
  const rel = path.relative(DOMAINS_ROOT, absPath);
  if (rel.startsWith("..")) return null;
  const first = rel.split(path.sep)[0];
  return first || null;
}

function main(): number {
  if (!fs.existsSync(DOMAINS_ROOT)) {
    console.error(`[domain-boundaries] scan error: ${DOMAINS_ROOT} does not exist`);
    return 2;
  }

  const files = listTsFiles(DOMAINS_ROOT);
  const violations: Violation[] = [];

  for (const file of files) {
    const fromDomain = domainOf(file);
    if (!fromDomain) continue;
    const src = fs.readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // Skip full-line comments; block comments with imports inside are rare
      // enough that a false positive there is acceptable (it fails loud, not silent).
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

      // Non-literal dynamic import/require — statically unresolvable, fail closed.
      if (NON_LITERAL_DYNAMIC_RE.test(lines[i])) {
        violations.push({
          file: path.relative(process.cwd(), file),
          line: i + 1,
          specifier: "<non-literal dynamic import/require>",
          fromDomain,
          toDomain: "<unresolvable>",
        });
        continue;
      }

      let m: RegExpExecArray | null;
      SPECIFIER_RE.lastIndex = 0;
      while ((m = SPECIFIER_RE.exec(lines[i])) !== null) {
        const spec = m[1] || m[2] || m[3];
        if (!spec) continue;
        let resolved: string | null = null;
        if (spec.startsWith(".")) {
          // Relative import — resolve against the importing file.
          resolved = path.resolve(path.dirname(file), spec);
        } else if (spec.includes("tools/domains/")) {
          // Alias/absolute-shaped import that names the domains tree directly
          // (e.g. "@server/tools/domains/x/y" or "server/tools/domains/x/y").
          const tail = spec.slice(spec.indexOf("tools/domains/") + "tools/domains/".length);
          resolved = path.join(DOMAINS_ROOT, tail);
        } else {
          continue; // bare package / non-domain alias — cannot reach a sibling domain
        }
        const toDomain = domainOf(resolved);
        if (toDomain && toDomain !== fromDomain) {
          violations.push({
            file: path.relative(process.cwd(), file),
            line: i + 1,
            specifier: spec,
            fromDomain,
            toDomain,
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(`[domain-boundaries] FAIL — ${violations.length} cross-domain import(s):`);
    for (const v of violations) {
      console.error(
        `  ${v.file}:${v.line}  ${v.fromDomain} → ${v.toDomain}  (import "${v.specifier}")`
      );
    }
    console.error(
      "[domain-boundaries] Fix: move shared logic into server/tools/lib/ (or the legacy server/ module both domains already use) — domains must never import each other."
    );
    return 1;
  }

  console.log(
    `[domain-boundaries] OK — ${files.length} files across ${new Set(files.map(domainOf)).size} domains, 0 cross-domain imports`
  );
  return 0;
}

process.exit(main());
