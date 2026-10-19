import { channel } from "node:diagnostics_channel";

type CheckState = "checked" | "failed" | "unverified" | "pending";
export interface OutputCheck { code: string; status: CheckState }
export interface OutputVerification {
  version: 1; tool: string; status: CheckState;
  scope: "result_structure" | "artifact_contract";
  independentOutcomeVerified: false;
  retryOriginalAction: false;
  checks: OutputCheck[];
  instruction: string;
  artifactSha256?: string;
}
export interface ArtifactInspection {
  status: "checked" | "failed" | "unverified";
  artifactSha256?: string;
}
export interface OutputCheckOptions {
  productOutput?: boolean;
  inspectArtifact?: () => Promise<ArtifactInspection>;
}
const diagnostic = channel("visionclaw.tool_output_verification");
const states = new Set(["pending", "queued", "running", "processing", "scheduled", "completion_uncertain", "in_progress"]);
const failures = new Set(["failed", "error", "cancelled", "canceled", "rejected", "blocked", "expired"]);
const totals = { checked: 0, failed: 0, unverified: 0, pending: 0 };
export function getOutputVerificationTotals() { return { ...totals }; }

function inspectStructure(value: unknown): OutputCheck {
  const seen = new WeakSet<object>();
  let visited = 0, truncated = false;
  function visit(v: unknown, depth: number): boolean {
    if (++visited > 256 || depth > 6) { truncated = true; return true; }
    if (typeof v === "number") return Number.isFinite(v);
    if (v === undefined || typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") return false;
    if (!v || typeof v !== "object") return true;
    if (ArrayBuffer.isView(v)) { truncated = true; return true; }
    if (seen.has(v)) return false;
    seen.add(v);
    // Descriptors avoid invoking accessors on a returned object.
    for (const key in v) {
      if (!Object.hasOwn(v, key) || key === "_outputVerification") continue;
      const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
      if (!("value" in descriptor)) return false;
      if (descriptor.value === undefined) continue; // JSON omits optional object fields.
      if (!visit(descriptor.value, depth + 1)) return false;
      if (visited > 256) break;
    }
    seen.delete(v);
    return true;
  }
  const valid = visit(value, 0);
  return { code: !valid ? "non_json_or_invalid_output" : truncated ? "structure_budget_exceeded" : "result_structure",
    status: !valid ? "failed" : truncated ? "unverified" : "checked" };
}
const ownValue = (value: object, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;

/** All tool names, including unknown/custom tools, get inspection. A producer
 * status/URL is never promoted to independent customer-outcome proof. */
export async function inspectToolOutput(name: string, result: unknown, options: OutputCheckOptions = {}): Promise<OutputVerification> {
  const structure = inspectStructure(result);
  const report: OutputVerification = { version: 1, tool: name, status: "unverified", scope: "result_structure",
    independentOutcomeVerified: false, retryOriginalAction: false, checks: [structure],
    instruction: "Result structure is not outcome proof. Check requested content, tenant-scoped read-back or provider evidence before claiming completion. Do not repeat an action merely because verification is missing." };
  if (structure.status === "failed") report.status = "failed";
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const error = ownValue(result, "error");
    const state = ownValue(result, "status");
    if ((typeof error === "string" && !!error.trim()) || (error && typeof error === "object") || error === true ||
        ownValue(result, "success") === false || ownValue(result, "ok") === false ||
        ownValue(result, "passed") === false || (typeof state === "string" && failures.has(state.toLowerCase()))) {
      report.status = "failed"; report.checks.push({ code: "operation_failed", status: "failed" });
    } else if (typeof state === "string" && states.has(state.toLowerCase()) ||
        ownValue(result, "completionUncertain") === true || ownValue(result, "inProgress") === true) {
      if (report.status !== "failed") report.status = "pending";
      report.checks.push({ code: "not_completed", status: "pending" });
    }
  }
  if (options.productOutput && report.status === "unverified") {
    if (options.inspectArtifact) {
      try {
        const artifact = await options.inspectArtifact();
        report.status = artifact.status === "checked" && structure.status !== "checked" ? "unverified" : artifact.status;
        if (artifact.status === "checked") {
          report.scope = "artifact_contract";
          if (artifact.artifactSha256 && /^[a-f0-9]{64}$/.test(artifact.artifactSha256)) report.artifactSha256 = artifact.artifactSha256;
        }
        report.checks.push({ code: "artifact_contract", status: artifact.status });
      } catch {
        report.checks.push({ code: "artifact_inspector_unavailable", status: "unverified" });
      }
    } else report.checks.push({ code: "artifact_evidence_missing", status: "unverified" });
  }
  if (report.status === "failed") report.instruction = "Verification failed: do not claim a valid completed outcome or share a new artifact. Reconcile any existing side effect before considering a retry.";
  if (report.status === "pending") report.instruction = "Work is pending or completion is uncertain. Check the original job/receipt; do not claim completion or submit it again.";
  if (report.status === "checked") report.instruction = "The stated artifact contract was checked, not universal correctness. Still verify customer requirements, sources, visual/media quality and final delivery evidence.";
  totals[report.status]++;
  if (diagnostic.hasSubscribers) {
    // A failing observer must never cause an already-completed action to retry.
    try { diagnostic.publish({ tool: name.slice(0, 128), status: report.status, scope: report.scope, version: 1 }); }
    catch { console.warn("[tool-output-verification] diagnostic subscriber failed"); }
  }
  return report;
}

/** Preserve array/primitive shape for existing internal consumers. Their
 * receipts are observational, not silently wrapped into incompatible objects. */
export function attachOutputVerification(result: unknown, report: OutputVerification): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result) || ArrayBuffer.isView(result)) return result;
  const prototype = Object.getPrototypeOf(result);
  if (prototype !== Object.prototype && prototype !== null) return result;
  const descriptors = Object.getOwnPropertyDescriptors(result);
  delete descriptors._outputVerification;
  const clean = Object.defineProperties({}, descriptors);
  Object.defineProperty(clean, "_outputVerification", { value: report, enumerable: true, configurable: true, writable: true });
  return clean;
}

export async function postflightToolOutput(name: string, result: unknown, options: OutputCheckOptions = {}): Promise<{ result: unknown; report: OutputVerification }> {
  try {
    const report = await inspectToolOutput(name, result, options);
    return { result: attachOutputVerification(result, report), report };
  } catch {
    // The action may already have completed. No new error/retry signal.
    const report: OutputVerification = { version: 1, tool: name, status: "unverified", scope: "result_structure",
      independentOutcomeVerified: false, retryOriginalAction: false, checks: [{ code: "postflight_unavailable", status: "unverified" }],
      instruction: "Postflight unavailable; reconcile existing action evidence before claiming completion or retrying." };
    console.warn("[tool-output-verification] postflight unavailable");
    // An unreadable object may itself contain a forged verification field.
    // Never let a later consumer authorize auto-delivery from that field.
    return { result: { completionUncertain: true, originalResultUnavailable: true, _outputVerification: report }, report };
  }
}
