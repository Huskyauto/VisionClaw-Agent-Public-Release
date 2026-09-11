import fs from "node:fs";

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

  const index: TenantAuditSchemaIndex = new Map();
  const re = /pgTable\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const name = match[1];
    const rest = src.slice(match.index, match.index + 4000);
    const nextTable = rest.slice(1).search(/pgTable\(/);
    const scope = nextTable > 0 ? rest.slice(0, nextTable + 1) : rest;
    const hasTenantId = /["'`]tenant_id["'`]|\btenantId\s*:/.test(scope);
    index.set(name, { hasTenantId });
  }
  return { ok: true, index };
}