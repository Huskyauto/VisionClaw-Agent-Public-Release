import fs from "node:fs";
import ts from "typescript";

export type TenantAuditSchemaIndex = Map<string, { hasTenantId: boolean }>;

export type TenantAuditSchemaIndexResult =
  | { ok: true; index: TenantAuditSchemaIndex }
  | { ok: false; error: unknown };

export function buildTenantAuditSchemaIndex(schemaPath: string): TenantAuditSchemaIndexResult {
  let src: string;
  try {
    src = fs.readFileSync(schemaPath, "utf8");
  } catch (error) {
    return { ok: false, error };
  }

  try {
    const file = ts.createSourceFile(schemaPath, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
    if (diagnostics.length) throw new Error("Audit schema has syntax errors");
    const index: TenantAuditSchemaIndex = new Map();
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "pgTable") {
        const [name, columns] = node.arguments;
        if (!name || !ts.isStringLiteralLike(name) || !columns || !ts.isObjectLiteralExpression(columns)) {
          throw new Error("Audit schema contains an unsupported table declaration");
        }
        let hasTenantId = false;
        for (const column of columns.properties) {
          if (!ts.isPropertyAssignment(column)) throw new Error("Audit schema contains unsupported columns");
          // Follow fluent calls (integer(...).notNull().references(...)), not
          // arbitrary descendant strings, defaults, comments or index callbacks.
          let value = column.initializer;
          while (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
            value = value.expression.expression;
          }
          if (!ts.isCallExpression(value)) throw new Error("Audit schema column constructor is unresolved");
          const sqlName = value.arguments[0];
          if (sqlName && ts.isStringLiteralLike(sqlName) && sqlName.text === "tenant_id") hasTenantId = true;
        }
        if (index.has(name.text)) throw new Error("Audit schema contains duplicate tables");
        index.set(name.text, { hasTenantId });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (index.size === 0) throw new Error("Audit schema contains no resolved tables");
    return { ok: true, index };
  } catch (error) {
    return { ok: false, error };
  }
}