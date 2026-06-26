/**
 * AST-based regression guard for the BWB render path's overlayFS-EIO hardening.
 *
 * WHY: the Reserved-VM overlayFS intermittently throws `EIO` on ANY syscall that
 * touches it. The weekly recap lost ~3h of fix-deploy-fail cycles to those faults
 * surfacing one un-wrapped `fs` op at a time. Every functional overlayFS op on the
 * render path now goes through an `eio-read` helper (readFileSyncEIO / copyFileSyncEIO
 * / statSyncEIO / readdirSyncEIO); the rare legitimately-raw op (cosmetic log, or a
 * call already inside a fall-through try/catch) carries an inline `eio-safe:` comment.
 *
 * This module is the enforcement: `findUnguardedFsOps(source)` returns every raw
 * read-class `fs` call that is NOT routed through a helper and NOT marked eio-safe.
 * It is AST-based (not a line regex) so it cannot be evaded by:
 *   - splitting the call across lines (`fs\n  .statSync(p)`),
 *   - module aliasing (`const f = fs` / `let f; f = fs`, incl. alias-of-alias),
 *   - computed-property access (`fs["statSync"](p)`),
 *   - bare named imports (`import { statSync } from "node:fs"`),
 *   - destructuring (`const { statSync } = fs` / `const { statSync } = require("fs")`),
 *   - or require()'d bindings.
 * A call counts as "marked eio-safe" only if a real `eio-safe` COMMENT (not a string
 * literal) is attached to the call's enclosing statement (same-line trailing or the
 * line(s) immediately preceding it) — a far-away or string-literal "eio-safe" can't
 * bless an unrelated op.
 *
 * Pure logic lives here (testable with inline fixtures); the file set + CI assertion
 * live in tests/unit/eio-read.test.ts.
 */
import * as ts from "typescript";

const FS_MODULE = /^(node:)?fs$/;
const OPS = new Set(["readFileSync", "copyFileSync", "statSync", "readdirSync"]);

export interface FsOffender {
  /** 1-based line of the call's start. */
  line: number;
  /** the fs op (e.g. "statSync"). */
  op: string;
  /** trimmed source of the call's start line, for the failure message. */
  text: string;
}

function isFsRequire(expr: ts.Expression | undefined): boolean {
  return (
    !!expr &&
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "require" &&
    expr.arguments.length === 1 &&
    ts.isStringLiteral(expr.arguments[0]) &&
    FS_MODULE.test((expr.arguments[0] as ts.StringLiteral).text)
  );
}

/**
 * Return every raw read-class `fs` op in `source` that is neither routed through an
 * eio-read helper nor marked `eio-safe`. Empty array = clean.
 */
export function findUnguardedFsOps(source: string, fileName = "input.ts"): FsOffender[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS);
  const lines = source.split("\n");

  // Identifiers that resolve to the fs module, and local names bound to a bare op.
  const fsNames = new Set<string>();
  const namedOpAliases = new Map<string, string>(); // localName -> op

  // Record a destructuring pattern `{ statSync, readFileSync: rf }` against an fs source.
  const collectBinding = (name: ts.BindingName): void => {
    if (!ts.isObjectBindingPattern(name)) return;
    for (const el of name.elements) {
      const prop = (el.propertyName ?? el.name);
      if (ts.isIdentifier(prop) && OPS.has(prop.text) && ts.isIdentifier(el.name)) {
        namedOpAliases.set(el.name.text, prop.text);
      }
    }
  };

  // If `expr` is a member-extraction of a read-class op off an fs root or require("fs")
  // — `fs.statSync`, `fs["statSync"]`, `require("fs").statSync`, `require("fs")["statSync"]`
  // — return the op name. Used so `const s = fs.statSync; s(p)` is still flagged.
  const opFromMemberExpr = (expr: ts.Expression): string | undefined => {
    const onFsRoot = (e: ts.Expression): boolean =>
      (ts.isIdentifier(e) && fsNames.has(e.text)) || isFsRequire(e);
    if (ts.isPropertyAccessExpression(expr) && OPS.has(expr.name.text) && onFsRoot(expr.expression)) {
      return expr.name.text;
    }
    if (
      ts.isElementAccessExpression(expr) &&
      expr.argumentExpression &&
      ts.isStringLiteral(expr.argumentExpression) &&
      OPS.has(expr.argumentExpression.text) &&
      onFsRoot(expr.expression)
    ) {
      return expr.argumentExpression.text;
    }
    return undefined;
  };

  // 1) Imports + require() of node:fs / fs.
  const visitImports = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      FS_MODULE.test(node.moduleSpecifier.text)
    ) {
      const ic = node.importClause;
      if (ic) {
        if (ic.name) fsNames.add(ic.name.text); // import fs from "node:fs"
        const nb = ic.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) fsNames.add(nb.name.text); // import * as fs
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            const imported = (el.propertyName ?? el.name).text;
            if (OPS.has(imported)) namedOpAliases.set(el.name.text, imported); // import { statSync as s }
          }
        }
      }
    }
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (isFsRequire(d.initializer)) {
          if (ts.isIdentifier(d.name)) fsNames.add(d.name.text); // const fs = require("node:fs")
          else collectBinding(d.name); // const { statSync } = require("node:fs")
        }
      }
    }
    ts.forEachChild(node, visitImports);
  };
  visitImports(sf);

  // 2) Local aliases / destructuring off an already-known fs binding.
  //    Multiple passes catch alias-of-alias and destructure-from-alias.
  for (let pass = 0; pass < 3; pass++) {
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        // const f = fs;  /  const { statSync } = fs;
        if (ts.isIdentifier(node.initializer) && fsNames.has(node.initializer.text)) {
          if (ts.isIdentifier(node.name)) fsNames.add(node.name.text);
          else collectBinding(node.name);
        }
        // const s = fs.statSync;  /  const s = require("fs").statSync;  (member extraction)
        else if (ts.isIdentifier(node.name)) {
          const op = opFromMemberExpr(node.initializer);
          if (op) namedOpAliases.set(node.name.text, op);
        }
      }
      // f = fs;  /  s = fs.statSync;  (assignment, not declaration)
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        if (ts.isIdentifier(node.right) && fsNames.has(node.right.text)) {
          fsNames.add(node.left.text);
        } else {
          const op = opFromMemberExpr(node.right);
          if (op) namedOpAliases.set(node.left.text, op);
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(sf);
  }

  // Lines carrying a REAL `eio-safe` comment. We collect string/template literal
  // ranges from the AST, then a line is "blessed" only when it has a comment opener
  // (`//` or `/*`) that is NOT inside a string literal and whose remainder contains
  // `eio-safe`. This is comment-aware: a string literal like `"eio-safe"` can NOT
  // bless a call (the architect's flagged false-bless). A call is marked iff such a
  // comment sits on one of the call's own source lines or the line immediately above.
  const stringRanges: Array<[number, number]> = [];
  const collectStrings = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateExpression(n)) {
      stringRanges.push([n.getStart(sf), n.getEnd()]);
    }
    ts.forEachChild(n, collectStrings);
  };
  collectStrings(sf);
  const inString = (pos: number): boolean => stringRanges.some(([a, b]) => pos >= a && pos < b);

  const eioSafeLines = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = ts.getPositionOfLineAndCharacter(sf, i, 0);
    const opener = /\/\/|\/\*/g;
    let m: RegExpExecArray | null;
    while ((m = opener.exec(line)) !== null) {
      if (inString(lineStart + m.index)) continue; // a `//` inside a string isn't a comment
      if (line.slice(m.index).includes("eio-safe")) {
        eioSafeLines.add(i);
        break;
      }
    }
  }

  const offenders: FsOffender[] = [];
  const record = (node: ts.Node, op: string): void => {
    const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
    for (let l = Math.max(0, startLine - 1); l <= endLine; l++) {
      if (eioSafeLines.has(l)) return; // marked eio-safe
    }
    offenders.push({ line: startLine + 1, op, text: (lines[startLine] || "").trim() });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const ce = node.expression;
      if (
        ts.isPropertyAccessExpression(ce) &&
        ts.isIdentifier(ce.expression) &&
        fsNames.has(ce.expression.text) &&
        OPS.has(ce.name.text)
      ) {
        record(node, ce.name.text); // fs.statSync(...)
      } else if (
        ts.isElementAccessExpression(ce) &&
        ts.isIdentifier(ce.expression) &&
        fsNames.has(ce.expression.text) &&
        ce.argumentExpression &&
        ts.isStringLiteral(ce.argumentExpression) &&
        OPS.has(ce.argumentExpression.text)
      ) {
        record(node, ce.argumentExpression.text); // fs["statSync"](...)
      } else if (ts.isIdentifier(ce) && namedOpAliases.has(ce.text)) {
        record(node, namedOpAliases.get(ce.text)!); // bare statSync(...) / destructured
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return offenders;
}
