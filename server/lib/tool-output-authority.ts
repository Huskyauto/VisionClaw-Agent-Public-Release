import { AsyncLocalStorage } from "node:async_hooks";

export interface ToolOutputAuthority { readonly operation: symbol }
interface ArtifactIdentity { tenantId: number; logicalName: string; sha256: string }
const identities = new WeakMap<ToolOutputAuthority, ArtifactIdentity[]>();
const exceeded = new WeakSet<ToolOutputAuthority>();
const context = new AsyncLocalStorage<ToolOutputAuthority>();
export function createToolOutputAuthority(): ToolOutputAuthority {
  const token = Object.freeze({ operation: Symbol("tool-output") });
  identities.set(token, []);
  return token;
}
export function withToolOutputAuthority<T>(token: ToolOutputAuthority, fn: () => T): T {
  if (!identities.has(token)) throw new Error("Invalid output authority");
  return context.run(token, fn);
}
/** Called only after the real durable intent transaction commits. Never source
 * this signal from result fields, params, IDs or model-authored metadata. */
export function recordCommittedToolArtifact(record: ArtifactIdentity): void {
  const token = context.getStore();
  if (!token || !identities.has(token) || !Number.isSafeInteger(record.tenantId) ||
      !/^[a-f0-9]{64}$/.test(record.sha256)) return;
  const list = identities.get(token)!;
  if (list.length < 100) list.push({ tenantId: record.tenantId, logicalName: record.logicalName, sha256: record.sha256 });
  else exceeded.add(token);
}
export function getCommittedToolArtifact(token: ToolOutputAuthority | undefined, tenantId: number, logicalName: string): ArtifactIdentity | undefined {
  if (!token || exceeded.has(token)) return undefined;
  const matches = identities.get(token)?.filter(r => r.tenantId === tenantId && r.logicalName === logicalName);
  // Multiple distinct revisions are ambiguous, not grounds to select the convenient one.
  if (!matches?.length || new Set(matches.map(r => r.sha256)).size !== 1) return undefined;
  return { ...matches[0] };
}
