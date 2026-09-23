import { createHash } from "node:crypto";
import { parseStrictCron } from "../cron-utils";

export const HEARTBEAT_REPAIR_VERSION = 1;
export const HEARTBEAT_REPAIR_KIND = "heartbeat_task";
export const HEARTBEAT_REPAIR_VERIFIER = "heartbeat_task_exact_state";

export type HeartbeatRepairAction = {
  version: 1;
  kind: "heartbeat_task";
  taskId: number;
  expectedBefore: { enabled?: boolean; cronExpression?: string };
  desiredAfter: { enabled?: boolean; cronExpression?: string };
  verifier: "heartbeat_task_exact_state";
  bindingHash: string;
};

const STATE_FIELDS = new Set(["enabled", "cronExpression"]);
const ACTION_FIELDS = new Set([
  "version", "kind", "taskId", "expectedBefore", "desiredAfter", "verifier", "bindingHash",
]);

function sorted(value: any): any {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = sorted(value[key]);
    return out;
  }, {} as any);
}

export function canonicalizeRepairAction(action: Omit<HeartbeatRepairAction, "bindingHash">): string {
  return JSON.stringify(sorted(action));
}

export function hashRepairAction(action: Omit<HeartbeatRepairAction, "bindingHash">): string {
  return createHash("sha256").update(canonicalizeRepairAction(action)).digest("hex");
}

export function validateHeartbeatRepairAction(input: unknown): HeartbeatRepairAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("repair action must be an object");
  const action = input as any;
  for (const key of Object.keys(action)) if (!ACTION_FIELDS.has(key)) throw new Error(`unsupported repair action field: ${key}`);
  if (action.version !== HEARTBEAT_REPAIR_VERSION || action.kind !== HEARTBEAT_REPAIR_KIND ||
      action.verifier !== HEARTBEAT_REPAIR_VERIFIER) throw new Error("unsupported heartbeat repair contract");
  if (!Number.isInteger(action.taskId) || action.taskId <= 0) throw new Error("taskId must be positive");
  for (const name of ["expectedBefore", "desiredAfter"]) {
    const state = action[name];
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error(`${name} is required`);
    const keys = Object.keys(state);
    if (!keys.length || keys.some((key) => !STATE_FIELDS.has(key))) throw new Error(`${name} contains unsupported fields`);
    if ("enabled" in state && typeof state.enabled !== "boolean") throw new Error(`${name}.enabled must be boolean`);
    // The observed state is evidence and may be the malformed value that
    // triggered this repair. Only the proposed state must be a safe cron.
    if (name === "desiredAfter" && "cronExpression" in state) {
      state.cronExpression = parseStrictCron(state.cronExpression);
    } else if ("cronExpression" in state && typeof state.cronExpression !== "string") {
      throw new Error(`${name}.cronExpression must be a string`);
    }
  }
  if (Object.keys(action.expectedBefore).some((key) => !(key in action.desiredAfter))) {
    throw new Error("desiredAfter must bind every expectedBefore field");
  }
  const unsigned = {
    version: 1 as const, kind: "heartbeat_task" as const, taskId: action.taskId,
    expectedBefore: action.expectedBefore, desiredAfter: action.desiredAfter,
    verifier: "heartbeat_task_exact_state" as const,
  };
  if (typeof action.bindingHash !== "string" || !/^[a-f0-9]{64}$/.test(action.bindingHash) ||
      action.bindingHash !== hashRepairAction(unsigned)) throw new Error("repair action binding hash mismatch");
  return { ...unsigned, bindingHash: action.bindingHash };
}

export function createHeartbeatRepairAction(input: Omit<HeartbeatRepairAction, "bindingHash" | "version" | "kind" | "verifier">): HeartbeatRepairAction {
  const unsigned = {
    version: 1 as const, kind: "heartbeat_task" as const, taskId: input.taskId,
    expectedBefore: input.expectedBefore, desiredAfter: input.desiredAfter,
    verifier: "heartbeat_task_exact_state" as const,
  };
  return { ...unsigned, bindingHash: hashRepairAction(unsigned) };
}