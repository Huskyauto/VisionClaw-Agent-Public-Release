import { sql, type SQL } from "drizzle-orm";

/** Typed array construction without hand-built PostgreSQL literal escaping. */
export function boundPostgresArray(values: unknown, type: "text" | "integer"): SQL {
  if (values === undefined || values === null) return sql`NULL`;
  if (!Array.isArray(values)) throw new Error("Expected an array");
  if (type !== "text" && type !== "integer") throw new Error("Unsupported array type");
  if (values.some(value => type === "text" ? typeof value !== "string"
    : !Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647))
    throw new Error("Invalid array element");
  if (!values.length) return sql`NULL`;
  const element = type === "integer" ? sql`value::integer` : sql`value`;
  return sql`ARRAY(SELECT ${element} FROM jsonb_array_elements_text(${JSON.stringify(values)}::jsonb) AS elements(value))`;
}
