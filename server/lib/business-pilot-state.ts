import { createHash } from "node:crypto";
import { z } from "zod";
import { analyzePilot, pilotSchemas, type PilotKind } from "../../shared/business-pilots";
import { reportText, type PilotResult } from "../../shared/business-pilots/common";

export class PilotError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export const pilotRequestSchema = z.object({
  requestId: z.string().uuid(), input: z.unknown(), baselineId: z.string().uuid().optional(),
}).strict();
const finding = z.object({ label: z.string(), status: z.enum(["reported", "gap", "blocked", "unknown"]),
  detail: z.string(), nextStep: z.string(), evidence: z.string().optional() }).strict();
const resultSchema = z.object({
  title: z.string(), verdict: z.string(), summary: z.string(), findings: z.array(finding).max(20),
  metrics: z.array(z.object({ label: z.string(), value: z.number().finite().nullable(), unit: z.string(),
    delta: z.number().finite().nullable().optional(), direction: z.enum(["improved", "worsened", "unchanged", "unknown"]).optional() }).strict()).max(10),
  limitations: z.array(z.string()).max(15),
}).strict();
const runSchema = z.object({
  id: z.string().uuid(), kind: z.enum(["health", "release", "governance", "cost"]),
  input: z.unknown(), result: resultSchema, report: z.string(), createdAt: z.string().datetime(),
  baselineId: z.string().uuid().optional(), digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export interface PilotRun {
  id: string; kind: PilotKind; input: unknown; result: PilotResult; report: string;
  createdAt: string; baselineId?: string; digest: string;
}
const digest = (input: unknown, baselineId?: string) => createHash("sha256")
  .update(JSON.stringify({ input, ...(baselineId ? { baselineId } : {}) })).digest("hex");
export function parsePilotState(text: string | null, kind: PilotKind): PilotRun[] {
  if (text === null) return [];
  try {
    if (Buffer.byteLength(text) > 900_000) throw new Error("oversize");
    const state = z.object({ version: z.literal(1), runs: z.array(runSchema).max(50) }).strict().parse(JSON.parse(text));
    if (new Set(state.runs.map(r => r.id)).size !== state.runs.length) throw new Error("duplicate");
    for (const run of state.runs) {
      const parsed = pilotSchemas[kind].parse(run.input);
      if (run.kind !== kind || run.digest !== digest(parsed, run.baselineId)) throw new Error("mismatched identity");
      if (run.baselineId && (kind !== "health" || !state.runs.some(r => r.id === run.baselineId && r.id !== run.id)))
        throw new Error("missing baseline");
    }
    return state.runs.map(run => ({ ...run, input: run.input }));
  } catch { throw new PilotError("Saved pilot data is corrupt or incompatible; no data was reset. Restore or review the stored record.", 500); }
}
export function appendPilotRun(runs: PilotRun[], kind: PilotKind, raw: unknown): { runs: PilotRun[]; run: PilotRun } {
  const request = pilotRequestSchema.parse(raw);
  const input = pilotSchemas[kind].parse(request.input);
  if (request.baselineId && kind !== "health") throw new PilotError("Only a health re-scan can select a baseline");
  const hash = digest(input, request.baselineId);
  const previous = runs.find(run => run.id === request.requestId);
  if (previous) {
    if (previous.digest !== hash) throw new PilotError("Request identity was already used with a different payload", 409);
    return { runs, run: previous };
  }
  if (runs.length >= 50) throw new PilotError("History is full (50 runs). Remove an unneeded run before saving another.", 409);
  const baseline = request.baselineId ? runs.find(r => r.id === request.baselineId) : undefined;
  if (request.baselineId && !baseline) throw new PilotError("Selected baseline no longer exists", 409);
  let result: PilotResult;
  try { result = analyzePilot(kind, input, baseline?.input); }
  catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw new PilotError(error instanceof Error ? error.message : "Pilot inputs cannot be analyzed");
  }
  const createdAt = new Date().toISOString();
  const run: PilotRun = { id: request.requestId, kind, input, result, createdAt, digest: hash,
    ...(request.baselineId ? { baselineId: request.baselineId } : {}),
    report: `Saved: ${createdAt}\nRun: ${request.requestId}\n${request.baselineId ? `Baseline: ${request.baselineId}\n` : ""}${reportText(result)}` };
  const next = [run, ...runs];
  if (Buffer.byteLength(JSON.stringify({ version: 1, runs: next })) > 900_000)
    throw new PilotError("Saved history size limit reached. Remove an unneeded run before saving another.", 409);
  return { runs: next, run };
}
export function deletePilotRun(runs: PilotRun[], id: string): PilotRun[] {
  if (!runs.some(run => run.id === id)) throw new PilotError("Run not found", 404);
  if (runs.some(run => run.baselineId === id)) throw new PilotError("This baseline is referenced by a saved re-scan. Remove the re-scan first.", 409);
  return runs.filter(run => run.id !== id);
}
