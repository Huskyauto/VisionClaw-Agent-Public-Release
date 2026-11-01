import { compilationValidationFailure } from "./company-compilation-checks";
import type { CompilationOperation } from "./company-compilation-matrix";
import { createHash } from "node:crypto";

/** Version 1 is retained verbatim for existing spending identities. Version 2
 * hashes JSON values independent of object-key order (PostgreSQL JSONB changes it).
 * String contents and array order remain exact. Never rewrite a legacy digest. */
export function compilationReceiptDigest(raw: unknown, version?: 2): string {
  const canonical = (value: any): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object")
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  };
  if (version !== undefined && version !== 2) throw new Error("Unknown compilation receipt digest version");
  const text = JSON.stringify(raw);
  return createHash("sha256").update(version === 2 ? canonical(JSON.parse(text)) : text).digest("hex");
}

/** A received pinned-model content failure, never a refusal or uncertain call. */
export function correctionCheck(op: CompilationOperation, raw: any, error: unknown): string | undefined {
  const bare = op.model.replace(/^google\//, ""), served = raw?.model;
  if (typeof served !== "string" || !(served === op.model || served === bare ||
      served.startsWith(`${bare}-`) && /^\d{4}-\d{2}-\d{2}$/.test(served.slice(bare.length + 1))) ||
      raw?.choices?.length !== 1 || raw.choices[0].message?.refusal ||
      typeof raw.choices[0].message?.content !== "string" ||
      !raw.choices[0].message.content.trim() || raw.choices[0].message.content.length > 90_000) return;
  if (raw.choices[0].finish_reason === "length" && (error as any)?.code === "COMPILATION_TRUNCATED")
    return "OUTPUT_TRUNCATED";
  if (raw.choices[0].finish_reason !== "stop") return;
  return compilationValidationFailure(error)?.check;
}

export function hasCompilationCorrectionApproval(payload: any): boolean {
  return payload?.tenantId === 1 && payload.productionVersion === 3 &&
    payload.compilationCorrectionPolicy?.version === 1 &&
    payload.compilationCorrectionPolicy?.maxPerOperation === 1 &&
    Number.isFinite(Date.parse(payload.compilationCorrectionPolicy?.approvedAt)) &&
    Number.isSafeInteger(payload.modelBudgetMicros) &&
    payload.modelBudgetMicros >= 10_000_000 && payload.modelBudgetMicros <= 150_000_000;
}
