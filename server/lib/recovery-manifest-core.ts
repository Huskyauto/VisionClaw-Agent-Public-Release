/**
 * Pure, bounded recovery-manifest record construction.
 *
 * Recovery manifests are evidence for human inspection after a restart. They
 * never contain an executable operation, and their cursor is deliberately
 * inspect-only so a record cannot be turned into an implicit retry request.
 */
import { createHash } from "node:crypto";
import { buildHarnessManifest, redactManifestSecrets, stableManifestStringify } from "./harness-manifest-core";

const MAX_DEPTH = 5;
const MAX_KEYS = 32;
const MAX_ARRAY_ITEMS = 32;
const MAX_STRING_CHARS = 512;
const MAX_PAYLOAD_BYTES = 8_192;
const EVENT_TYPE = /^[a-z][a-z0-9._-]{0,63}$/;

export type RecoveryJson =
  | string
  | number
  | boolean
  | null
  | RecoveryJson[]
  | { [key: string]: RecoveryJson };

export interface RecoveryScope {
  runId?: number;
  conversationId?: number;
  traceId?: string;
}

export interface RecoveryCursor extends RecoveryScope {
  mode: "inspect-only";
  eventIndex: number;
}

export interface RecoveryCheckpoint {
  schemaVersion: 1;
  eventType: string;
  eventIndex: number;
  scope: RecoveryScope;
  stateHash: string;
  payload: RecoveryJson;
  nextCursor: RecoveryCursor;
  idempotencyKey: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function redactString(value: string): string {
  const redacted = value
    .replace(/(bearer\s+)[a-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|rk|pk)-[a-z0-9_-]{12,}\b/gi, "[REDACTED]")
    .replace(/\bAIza[a-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/g, "[REDACTED]");
  return redacted.length <= MAX_STRING_CHARS
    ? redacted
    : `${redacted.slice(0, MAX_STRING_CHARS)}…[truncated]`;
}

function textMetadata(value: string): RecoveryJson {
  const redacted = redactString(value);
  // Payload strings can be raw prompts, provider errors, tool responses, or
  // credentials under innocent-looking names. Persisting a digest and length
  // preserves correlation without retaining the text itself.
  return {
    _textHash: sha256(redacted),
    _chars: redacted.length,
  };
}

function structuralFieldName(key: string): string {
  // Keys are untrusted text too: a tool/provider can place prompt text or a
  // credential in a property name. Preserve only deterministic structure.
  return `field_${sha256(key)}`;
}

function safeSecretRedaction(value: unknown): unknown {
  try {
    return redactManifestSecrets(value);
  } catch {
    // An unsupported runtime value is not useful recovery evidence. Replacing
    // it is safer than serializing a best-effort representation of it.
    console.warn("[recovery-manifest] redaction failed; checkpoint value replaced");
    return "[[unsupported recovery value]]";
  }
}

function boundJson(value: unknown, depth = 0): RecoveryJson {
  if (depth > MAX_DEPTH) return "[[depth truncated]]";
  if (value === null) return null;
  if (typeof value === "string") return textMetadata(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[[non-finite number]]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => boundJson(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[[${value.length - MAX_ARRAY_ITEMS} items truncated]]`);
    return items;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    const result: Record<string, RecoveryJson> = {};
    for (const key of keys.slice(0, MAX_KEYS)) {
      result[structuralFieldName(key)] = boundJson(source[key], depth + 1);
    }
    if (keys.length > MAX_KEYS) result._truncatedKeys = `[[${keys.length - MAX_KEYS} keys truncated]]`;
    return result;
  }
  return `[[unsupported ${typeof value}]]`;
}

function boundedPayload(value: unknown): RecoveryJson {
  const safe = boundJson(safeSecretRedaction(value));
  const encoded = JSON.stringify(safe);
  if (Buffer.byteLength(encoded, "utf8") <= MAX_PAYLOAD_BYTES) return safe;
  return {
    _truncated: true,
    _originalBytes: Buffer.byteLength(encoded, "utf8"),
    _contentHash: sha256(encoded),
  };
}

function validatePositiveId(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Recovery manifest ${field} must be a positive integer`);
  }
  return value;
}

function normalizeScope(scope: RecoveryScope): RecoveryScope {
  const runId = validatePositiveId(scope.runId, "runId");
  const conversationId = validatePositiveId(scope.conversationId, "conversationId");
  const traceId = scope.traceId?.trim();
  if (traceId !== undefined && (!traceId || traceId.length > 128 || /[\u0000-\u001f]/.test(traceId))) {
    throw new Error("Recovery manifest traceId must be a short printable string");
  }
  if (!runId && !conversationId && !traceId) {
    throw new Error("Recovery manifest scope must contain a runId, conversationId, or traceId");
  }
  return {
    ...(runId ? { runId } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(traceId ? { traceId } : {}),
  };
}

/**
 * Construct a record that can be stored verbatim. Identity is stable across
 * object key order, while the event index and state hash make semantic retries
 * distinct from accidental duplicate writes.
 */
export function buildRecoveryCheckpoint(input: {
  tenantId: number;
  scope: RecoveryScope;
  eventType: string;
  eventIndex: number;
  state: unknown;
  payload?: unknown;
}): RecoveryCheckpoint {
  if (!Number.isSafeInteger(input.tenantId) || input.tenantId <= 0) {
    throw new Error("Recovery manifest tenantId must be a positive integer");
  }
  if (!EVENT_TYPE.test(input.eventType)) {
    throw new Error("Recovery manifest eventType must be a lowercase dotted identifier");
  }
  if (!Number.isSafeInteger(input.eventIndex) || input.eventIndex < 0) {
    throw new Error("Recovery manifest eventIndex must be a non-negative integer");
  }

  const scope = normalizeScope(input.scope);
  const safeState = boundedPayload(input.state);
  const payload = boundedPayload(input.payload ?? {});
  const stateHash = buildHarnessManifest({ state: safeState }).hash;
  const idempotencyKey = sha256(stableManifestStringify({
    schemaVersion: 1,
    tenantId: input.tenantId,
    scope,
    eventType: input.eventType,
    eventIndex: input.eventIndex,
    stateHash,
  }));

  return {
    schemaVersion: 1,
    eventType: input.eventType,
    eventIndex: input.eventIndex,
    scope,
    stateHash,
    payload,
    nextCursor: {
      mode: "inspect-only",
      eventIndex: input.eventIndex + 1,
      ...scope,
    },
    idempotencyKey,
  };
}