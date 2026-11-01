import { createHash } from "node:crypto";
import { compilationOperations, type CompilationMatrix, type CompilationOperation } from "./company-compilation-matrix";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Exact pinned-model identity, also used at the central spend boundary. */
export function isTruncatedCompilation(op: CompilationOperation, raw: any): boolean {
  const bare = op.model.replace(/^google\//, ""), served = raw?.model;
  return typeof served === "string" &&
    (served === op.model || served === bare ||
      served.startsWith(`${bare}-`) && /^\d{4}-\d{2}-\d{2}$/.test(served.slice(bare.length + 1))) &&
    raw?.choices?.length === 1 && raw.choices[0].finish_reason === "length" &&
    typeof raw.choices[0].message?.content === "string";
}

/** Only a known, received truncation is replaceable; never an uncertain claim.
 * One explicitly approved replacement per operation; all receipts/spend remain. */
export function compilationRecoveryPlan(job: any): { available: boolean; snapshot: string; operation?: string } {
  const matrix = job.payload?.state?.compilation as CompilationMatrix | undefined;
  const snapshot = digest({ id: job.id, tenant: job.tenant_id, matrix,
    spend: job.payload?.packageSpend });
  const no = { available: false, snapshot };
  if (job.tenant_id !== 1 || job.payload?.tenantId !== 1 || job.payload?.productionVersion !== 3 ||
      job.payload.state?.phase !== "blocked" || matrix?.phase !== "blocked" ||
      !matrix.subject ||
      !["succeeded", "failed", "failed_terminal"].includes(job.status)) return no;
  const operations = compilationOperations();
  if (Object.keys(matrix.slots).some(key => !operations.some(op => op.key === key))) return no;
  const op = operations.find(op => matrix.slots[op.key]?.phase !== "complete");
  if (!op || Object.hasOwn(matrix.replacements ?? {}, op.key) || matrix.slots[op.key]?.correction) return no;
  const slot = matrix.slots[op.key], raw = slot?.raw as any;
  if (slot?.phase !== "received" || !isTruncatedCompilation(op, raw) ||
      Object.values(matrix.slots).some(slot => slot.phase === "claimed")) return no;
  return { available: true, snapshot, operation: op.key };
}

export function approveCompilationReplacement(job: any, request: {
  snapshot?: string; replaceTruncatedCompilation?: boolean;
}): void {
  if (request.replaceTruncatedCompilation !== true) throw new Error("Explicit replacement approval required");
  const plan = compilationRecoveryPlan(job);
  if (!plan.available || !plan.operation || request.snapshot !== plan.snapshot)
    throw new Error("Saved compilation changed or replacement unavailable; refresh before approval");
  const matrix = job.payload.state.compilation as CompilationMatrix;
  const raw = matrix.slots[plan.operation].raw;
  matrix.replacements = { ...matrix.replacements, [plan.operation]: { raw, digest: digest(raw),
    snapshot: plan.snapshot, approvedAt: new Date().toISOString() } };
  delete matrix.slots[plan.operation];
  matrix.phase = "authors";
}
