import { createHash } from "node:crypto";

/** Drive's limit counts BOTH the property name and UTF-8 value. Preserve old
 * valid identities; longer keys could never have been stored successfully. */
export function driveArtifactPropertyValue(key: string): string {
  if (!/^(?:delivery|artifact):[A-Za-z0-9:_-]{8,180}$/.test(key)) {
    throw new Error("Invalid durable artifact recovery key");
  }
  if (Buffer.byteLength("visionclawArtifactKey" + key, "utf8") <= 124) return key;
  return `${key.split(":")[0]}:sha256:${createHash("sha256").update(key).digest("hex")}`;
}
