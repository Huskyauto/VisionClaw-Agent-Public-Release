import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { getCommittedToolArtifact, type ToolOutputAuthority } from "./tool-output-authority";
import type { ArtifactInspection } from "../tools/middleware/output-verification";
export interface VerifiedToolSnapshot { bytes: Buffer; fileName: string; sha256: string }
const snapshots = new WeakMap<ToolOutputAuthority, VerifiedToolSnapshot>();
export function getVerifiedToolSnapshot(authority: ToolOutputAuthority): VerifiedToolSnapshot | undefined {
  const snapshot = snapshots.get(authority);
  return snapshot ? { ...snapshot, bytes: Buffer.from(snapshot.bytes) } : undefined;
}

/** Read-only inspection, never remote fetching. Owner local outputs only:
 * a general tool result path is NOT proof of customer-file ownership. Customer
 * deliveries still use the existing tenant-scoped mandatory delivery verifier. */
export async function inspectProducedArtifact(
  result: unknown, tenantId: unknown, authority?: ToolOutputAuthority,
): Promise<ArtifactInspection> {
  if (tenantId !== 1 || !result || typeof result !== "object" || Array.isArray(result)) return { status: "unverified" };
  if (authority) snapshots.delete(authority);
  const get = (key: string) => Object.getOwnPropertyDescriptor(result, key)?.value;
  const candidate = ["filePath", "file_path", "outputPath", "path", "localPath"].map(get)
    .find(v => typeof v === "string" && v.length > 0 && v.length <= 4096);
  if (typeof candidate !== "string" || /^https?:\/\//i.test(candidate)) return { status: "unverified" };
  const filePath = /^\/(uploads|attached_assets|project-assets|stress-test-output)\//.test(candidate) ? candidate.slice(1) : candidate;
  const identity = getCommittedToolArtifact(authority, tenantId, path.basename(filePath));
  // File existence, tenant=owner, or a producer's path is not action provenance.
  if (!identity) return { status: "unverified" };
  let timer: NodeJS.Timeout | undefined;
  try {
    const inspection = (async (): Promise<ArtifactInspection> => {
      const { resolveDeliveryContractType } = await import("../delivery-artifact-recovery");
      const deliverableType = resolveDeliveryContractType(path.basename(filePath));
      if (!deliverableType) return { status: "unverified" };
      const { verifyDeliverable, isPathAllowed } = await import("../deliverable-verifier");
      const absolute = path.resolve(filePath);
      if (!isPathAllowed(absolute)) return { status: "failed" };
      const fd = fs.openSync(fs.realpathSync(absolute), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile()) return { status: "failed" };
        if (stat.size > 10 * 1024 * 1024) return { status: "unverified" };
        bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
          if (!n) return { status: "failed" };
          offset += n;
        }
        if (fs.fstatSync(fd).size !== stat.size) return { status: "failed" };
      } finally { fs.closeSync(fd); }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 !== identity.sha256) return { status: "failed" };
      // Parse the immutable snapshot we just bound to this action, not the
      // replaceable path. Existing contract defines exactly what was checked.
      const checked = await verifyDeliverable({ tenantId, deliverableType, filePath, buffer: bytes });
      if (checked.passed && checked.auditPersisted === true && authority) {
        snapshots.set(authority, { bytes, fileName: path.basename(filePath), sha256 });
      }
      return { status: checked.passed && checked.auditPersisted === true ? "checked" : "failed", artifactSha256: sha256 };
    })();
    return await Promise.race([inspection, new Promise<ArtifactInspection>(resolve => {
      timer = setTimeout(() => resolve({ status: "unverified" }), 12_000);
    })]);
  } catch {
    return { status: "unverified" };
  } finally { if (timer) clearTimeout(timer); }
}
