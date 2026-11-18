import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export interface NodeScope {
  tenantId: number;
  environment: "development" | "production";
}
const PREFIX = "legion:v1:";
const MAX_BYTES = 1024 * 1024;

function validateScope(scope: NodeScope) {
  if (scope.tenantId !== 1 ||
      !["development", "production"].includes(scope.environment)) {
    throw new Error("Legion identity requires the canonical owner environment");
  }
}
function keyFor(secret: string) {
  if (!secret) throw new Error("Legion identity encryption unavailable");
  return scryptSync(secret, "visionclaw-legion-node-v1", 32);
}
function validateState(state: string) {
  if (!state || Buffer.byteLength(state) > MAX_BYTES) throw new Error("Invalid Legion identity size");
  const parsed = JSON.parse(state);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).length === 0) throw new Error("Invalid Legion identity");
}

/** Dedicated authenticated envelope, never legacy plaintext credential behavior. */
export function sealNodeState(state: string, scope: NodeScope, secret: string): string {
  validateScope(scope);
  validateState(state);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  cipher.setAAD(Buffer.from(JSON.stringify(scope)));
  const ciphertext = Buffer.concat([cipher.update(state, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function openNodeState(value: string, scope: NodeScope, secret: string): string {
  validateScope(scope);
  if (!value.startsWith(PREFIX) || value.length > MAX_BYTES * 2) throw new Error("Invalid Legion identity envelope");
  const bytes = Buffer.from(value.slice(PREFIX.length), "base64");
  if (bytes.length < 29) throw new Error("Invalid Legion identity envelope");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), bytes.subarray(0, 12), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(JSON.stringify(scope)));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const state = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  validateState(state);
  return state;
}
