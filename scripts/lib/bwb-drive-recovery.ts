import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface RecoveryReceipt {
  fileId: string;
  folderId: string;
  name: string;
  sha256: string;
  size: number;
}
export interface RecoveryTransport {
  put(name: string, bytes: Buffer, key: string): Promise<{ fileId: string; folderId: string }>;
  verify(receipt: { fileId: string; folderId: string }, bytes: Buffer): Promise<void>;
}
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

export function createBwbRecovery(videoId: string, injected?: RecoveryTransport) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(videoId)) throw new Error("Invalid BWB recovery identity");
  const inventory = new Map<string, RecoveryReceipt>();
  let transport = injected;
  let chain: Promise<unknown> = Promise.resolve();
  async function backend() {
    return transport ??= await (await import("./bwb-drive-recovery-transport")).createOwnerRecoveryTransport(videoId);
  }
  async function store(name: string, bytes: Buffer): Promise<RecoveryReceipt> {
    const digest = hash(bytes);
    const io = await backend();
    const old = inventory.get(name);
    const remote = old?.sha256 === digest
      ? old : await io.put(name, bytes, `bwb-recovery-v1:${videoId}:${hash(name)}:${digest}`);
    await io.verify(remote, bytes);
    const receipt = { ...remote, name, sha256: digest, size: bytes.length };
    inventory.set(name, receipt);
    return receipt;
  }
  function save(name: string, bytes: Buffer): Promise<RecoveryReceipt> {
    // Snapshot caller bytes before any asynchronous operation.
    const snapshot = Buffer.from(bytes);
    const work = chain.catch(() => undefined).then(async () => {
      if (!name || name.length > 240 || name.includes("\\") || name.includes("\0") ||
          name.split("/").some(p => !p || p.startsWith(".")) || path.posix.isAbsolute(name) ||
          /(?:^|\/)(?:secrets?|credentials?|[^/]*\.env)(?:\/|$)/i.test(name)) {
        throw new Error("Unsafe recovery artifact name");
      }
      if (snapshot.length > 512 * 1024 * 1024) throw new Error("Recovery artifact exceeds 512 MiB");
      const receipt = await store(name, snapshot);
      if (name !== "RECOVERY-INVENTORY.json") {
        const index = Buffer.from(JSON.stringify({
          version: 1, videoId,
          artifacts: [...inventory.values()].filter(r => r.name !== "RECOVERY-INVENTORY.json"),
        }, null, 2));
        await store("RECOVERY-INVENTORY.json", index);
      }
      console.log(`[bwb-recovery] verified ${name} (${snapshot.length} bytes) — https://drive.google.com/drive/folders/${receipt.folderId}`);
      return receipt;
    });
    const guarded = work.catch(error => {
      throw new Error(`BWB recovery paused: ${error.message}`, { cause: error });
    });
    chain = guarded;
    return guarded;
  }
  return {
    save,
    json: (name: string, value: unknown) => save(name, Buffer.from(JSON.stringify(value, null, 2))),
    async file(filePath: string) {
      try {
        const { name, bytes } = readBwbRecoveryFile(videoId, filePath);
        return await save(name, bytes);
      } catch (error) {
        if (error instanceof Error && error.message.includes("BWB recovery paused:")) throw error;
        throw new Error(`BWB recovery paused: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    },
  };
}
export type BwbRecovery = ReturnType<typeof createBwbRecovery>;

/** Immutable inventories are merged oldest-to-newest, including prior processes. */
export function mergeRecoveryInventories(versions: { version: number; videoId: string; artifacts: RecoveryReceipt[] }[]) {
  if (!versions.length || versions.length > 1000) throw new Error("Invalid recovery inventory history");
  const videoId = versions[0].videoId;
  const artifacts = new Map<string, RecoveryReceipt>();
  for (const version of versions) {
    if (version.version !== 1 || version.videoId !== videoId || !Array.isArray(version.artifacts) ||
        version.artifacts.length > 1000) throw new Error("Recovery inventory identity mismatch");
    for (const receipt of version.artifacts) artifacts.set(receipt.name, receipt);
  }
  return { version: 1, videoId, artifacts: [...artifacts.values()] };
}

function allowedBwbSource(videoId: string, name: string): boolean {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(videoId)) return false;
  const quoted = videoId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^(?:data/youtube/(?:scripts/${quoted}(?:\\.result)?\\.json|scenes/${quoted}/scene-\\d+\\.png(?:\\.prompt)?|${quoted}(?:-github-render|-thumbnail)?\\.(?:mp4|png))|project-assets/${quoted}(?:_ch\\d+_[A-Za-z0-9_-]+)?(?:_scene_\\d+(?:_a\\d+)?\\.(?:mp3|wav)(?:\\.voice)?|_\\d+\\.mp4)|(?:attached_assets|data/youtube/photos)/[^/]+\\.(?:png|jpe?g|webp))$`, "i",
  ).test(name) && !name.split("/").some(p => p.startsWith("."));
}

export async function restoreBwbRecovery(
  inventory: { version: number; videoId: string; artifacts: RecoveryReceipt[] },
  download: (receipt: RecoveryReceipt) => Promise<Buffer>,
  destinationRoot = process.cwd(),
) {
  if (inventory.version !== 1 || !/^[a-zA-Z0-9_-]{1,120}$/.test(inventory.videoId) ||
      !Array.isArray(inventory.artifacts) || inventory.artifacts.length > 1000) throw new Error("Invalid recovery inventory");
  const root = fs.realpathSync(destinationRoot);
  const targets = inventory.artifacts.map(receipt => {
    let target: string;
    if (receipt.name === "original-script.json") target = `data/youtube/scripts/${inventory.videoId}.json`;
    else if (allowedBwbSource(inventory.videoId, receipt.name)) target = receipt.name;
    else if (/^(?:[A-Za-z0-9_-]+\.(?:json|tar\.gz)|github-artifacts\/chapter-\d+\.zip)$/.test(receipt.name)) {
      target = `generated-artifacts/bwb-restored/${inventory.videoId}/${receipt.name}`;
    } else throw new Error("Unsafe recovery destination");
    if (!/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.size) ||
        receipt.size < 0 || receipt.size > 512 * 1024 * 1024) throw new Error("Invalid recovery receipt");
    return { receipt, target: path.join(root, target) };
  });
  for (const { receipt, target } of targets) {
    const bytes = await download(receipt);
    if (bytes.length !== receipt.size || hash(bytes) !== receipt.sha256) throw new Error("Recovery integrity check failed");
    if (receipt.name === "original-script.json" && JSON.parse(bytes.toString("utf8")).videoId !== inventory.videoId) {
      throw new Error("Recovery script identity mismatch");
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.realpathSync(path.dirname(target)) !== path.dirname(target)) throw new Error("Unsafe recovery symlink destination");
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink() || hash(fs.readFileSync(target)) !== receipt.sha256) {
        throw new Error("Refusing to overwrite different local work");
      }
      continue;
    }
    // Exclusive creation never overwrites files created by another process.
    const temporary = path.join(path.dirname(target), `.bwb-restore-${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
      fs.linkSync(temporary, target);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return { restored: targets.length, videoId: inventory.videoId };
}

/** Fixed output families only, never a general workspace exporter. */
export function readBwbRecoveryFile(videoId: string, filePath: string): { name: string; bytes: Buffer } {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(videoId)) throw new Error("Invalid BWB recovery identity");
  const root = fs.realpathSync(process.cwd());
  const absolute = path.resolve(root, filePath);
  const name = path.relative(root, absolute).split(path.sep).join("/");
  if (!allowedBwbSource(videoId, name) || fs.realpathSync(absolute) !== absolute) throw new Error("Unsafe BWB recovery source path");
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > 512 * 1024 * 1024) throw new Error("Invalid BWB recovery source");
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs || bytes.length !== after.size) {
      throw new Error("BWB recovery source changed during snapshot");
    }
    return { name, bytes };
  } finally { fs.closeSync(fd); }
}
