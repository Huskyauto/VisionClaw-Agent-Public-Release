import fs from "node:fs";
import path from "node:path";

export interface StableVideoSnapshot {
  filePath: string;
  cleanup: () => void;
}

/** Private no-follow copy: verification and delivery read the same bytes. */
export function createStableVideoSnapshot(filePath: string, snapshotParent = path.dirname(filePath)): StableVideoSnapshot {
  let sourceFd: number | undefined;
  let snapshotFd: number | undefined;
  let tempDir: string | undefined;
  try {
    if (!fs.lstatSync(filePath).isFile()) throw new Error("render output is not a regular file (symlinks rejected)");
    if (fs.constants.O_NOFOLLOW === undefined) throw new Error("platform cannot reject symlinks");
    tempDir = fs.mkdtempSync(path.join(snapshotParent, ".bwb-delivery-"));
    const snapshotPath = path.join(tempDir, "final.mp4");
    sourceFd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(sourceFd);
    if (!before.isFile()) throw new Error("render output changed to a non-regular file");
    snapshotFd = fs.openSync(snapshotPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0;
    // Bound copying to the opened size, even if a producer keeps appending.
    while (total < before.size) {
      const count = fs.readSync(sourceFd, buffer, 0, Math.min(buffer.length, before.size - total), null);
      if (!count) throw new Error("render output truncated during snapshot");
      let written = 0;
      while (written < count) written += fs.writeSync(snapshotFd, buffer, written, count - written, null);
      total += count;
    }
    const after = fs.fstatSync(sourceFd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      throw new Error("render output changed during snapshot");
    fs.closeSync(sourceFd);
    sourceFd = undefined;
    fs.closeSync(snapshotFd);
    snapshotFd = undefined;
    fs.chmodSync(snapshotPath, 0o400);
    return {
      filePath: snapshotPath,
      cleanup: () => {
        try { fs.rmSync(tempDir!, { recursive: true, force: true }); }
        catch { console.warn("[video-verification] snapshot cleanup failed"); }
      },
    };
  } catch (error) {
    if (sourceFd !== undefined) {
      try { fs.closeSync(sourceFd); } catch { console.warn("[video-verification] source descriptor cleanup failed; preserving original failure"); }
    }
    if (snapshotFd !== undefined) {
      try { fs.closeSync(snapshotFd); } catch { console.warn("[video-verification] snapshot descriptor cleanup failed; preserving original failure"); }
    }
    if (tempDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { console.warn("[video-verification] failed-snapshot cleanup failed; preserving original failure"); }
    }
    throw error;
  }
}
