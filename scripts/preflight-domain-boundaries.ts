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
 * Uses the existing TypeScript development toolchain to inspect syntax without
 * executing scanned files. No new package or production dependency.
 * Exit codes: 0 = clean, 1 = violations found, 2 = scan error (missing dir).
 *
 * Usage: npx tsx scripts/preflight-domain-boundaries.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

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
    const source = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    // TypeScript exposes parser diagnostics on its runtime SourceFile, but not
    // on the public interface. Incomplete syntax must never produce a clean scan.
    const diagnostics = (source as ts.SourceFile & {
      parseDiagnostics: readonly ts.Diagnostic[];
    }).parseDiagnostics;
    if (!Array.isArray(diagnostics) || diagnostics.length > 0) {
      console.error(`[domain-boundaries] scan error: malformed source ${path.relative(process.cwd(), file)}`);
      return 2;
    }

    function check(node: ts.Node, target: ts.Node | undefined): void {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (!target || !ts.isStringLiteralLike(target)) {
        violations.push({
          file: path.relative(process.cwd(), file),
          line,
          specifier: "<non-literal dynamic import/require>",
          fromDomain,
          toDomain: "<unresolvable>",
        });
        return;
      }
      const spec = target.text;
      let resolved: string | null = null;
      if (spec.startsWith(".")) {
        // Relative import — resolve against the importing file.
        resolved = path.resolve(path.dirname(file), spec);
      } else if (spec.includes("tools/domains/")) {
        // Alias/absolute-shaped import that names the domains tree directly.
        const tail = spec.slice(spec.indexOf("tools/domains/") + "tools/domains/".length);
        resolved = path.join(DOMAINS_ROOT, tail);
      } else {
        return; // bare package / non-domain alias — unchanged scope
      }
      const toDomain = domainOf(resolved);
      if (toDomain && toDomain !== fromDomain) {
        violations.push({
          file: path.relative(process.cwd(), file),
          line,
          specifier: spec,
          fromDomain,
          toDomain,
        });
      }
    }

    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        check(node, node.moduleSpecifier);
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        check(node, node.moduleReference.expression);
      } else if (ts.isImportTypeNode(node)) {
        check(node, ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined);
      } else if (ts.isCallExpression(node)) {
        const expr = node.expression;
        const isRequire = (ts.isIdentifier(expr) && expr.text === "require")
          || (ts.isPropertyAccessExpression(expr) && expr.name.text === "require")
          || (ts.isElementAccessExpression(expr) && ts.isStringLiteralLike(expr.argumentExpression)
            && expr.argumentExpression.text === "require");
        if (expr.kind === ts.SyntaxKind.ImportKeyword || isRequire) {
          check(node, node.arguments[0]);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
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
