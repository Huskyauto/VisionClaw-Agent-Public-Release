import test from "node:test";
import assert from "node:assert/strict";
import { createBwbRecovery, restoreBwbRecovery, mergeRecoveryInventories } from "../../scripts/lib/bwb-drive-recovery";
import { assertPrivateRecoveryMetadata, recoveryArtifactKey } from "../../scripts/lib/bwb-drive-recovery-transport";
import { driveArtifactPropertyValue } from "../../server/lib/drive-artifact-property";
import { extractWeeklyDriveTranscripts } from "../../scripts/lib/drive-discover";
import { assertVideoRecoveryBatch } from "../../server/lib/video-recovery-guard";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

test("a failed Drive backup stops progression and a retry preserves exact bytes", async () => {
  const remote = new Map<string, Buffer>();
  let available = false;
  const recovery = createBwbRecovery("fixture-video", {
    async put(name, bytes) {
      if (!available) throw new Error("Drive unavailable");
      remote.set(name, Buffer.from(bytes));
      return { fileId: name, folderId: "private-folder" };
    },
    async verify(receipt, bytes) {
      assert.deepEqual(remote.get(receipt.fileId), bytes);
    },
  });
  await assert.rejects(recovery.save("script.json", Buffer.from("exact script")), /Drive unavailable/);
  available = true;
  const receipt = await recovery.save("script.json", Buffer.from("exact script"));
  assert.ok(receipt.sha256);
  assert.deepEqual(remote.get(receipt.fileId), Buffer.from("exact script"));
});

test("restore verifies exact bytes and never traverses or overwrites different local work", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bwb-restore-"));
  try {
    const bytes = Buffer.from("original image");
    const artifact = { fileId: "drive-file", folderId: "folder", name: "data/youtube/scenes/fixture/scene-2.png",
      sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
    const inventory = { version: 1, videoId: "fixture", artifacts: [artifact] };
    await assert.rejects(restoreBwbRecovery(inventory, async () => Buffer.from("wrong bytes"), root), /integrity/);
    await restoreBwbRecovery(inventory, async () => bytes, root);
    const target = path.join(root, artifact.name);
    assert.deepEqual(fs.readFileSync(target), bytes);
    fs.writeFileSync(target, "newer work");
    await assert.rejects(restoreBwbRecovery(inventory, async () => bytes, root), /overwrite/);
    await assert.rejects(restoreBwbRecovery({ ...inventory, artifacts: [{ ...artifact, name: "../outside" }] }, async () => bytes, root), /Unsafe/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("unchanged artifacts are reverified without another content upload", async () => {
  const uploads: string[] = [];
  let checks = 0;
  let missing = false;
  const recovery = createBwbRecovery("fixture", {
    async put(name) { uploads.push(name); return { fileId: name, folderId: "folder" }; },
    async verify() { checks++; if (missing) throw new Error("remote missing"); },
  });
  await recovery.save("image.png", Buffer.from("image"));
  await recovery.save("image.png", Buffer.from("image"));
  assert.equal(uploads.filter(n => n === "image.png").length, 1);
  assert.equal(uploads.filter(n => n === "RECOVERY-INVENTORY.json").length, 1);
  assert.equal(checks, 4);
  missing = true;
  await assert.rejects(recovery.save("image.png", Buffer.from("image")), /remote missing/);
  for (const name of ["../secrets", ".env", "/outside", "x/../y", "x\\y", "credentials/file"]) {
    await assert.rejects(recovery.save(name, Buffer.from("x")), /Unsafe/);
  }
});

test("recovery refuses public, shared, incomplete and wrong-folder Drive files", () => {
  const metadata = { ownedByMe: true, trashed: false, size: "4", parents: ["folder"], permissions: [{ type: "user", role: "owner" }] };
  assert.doesNotThrow(() => assertPrivateRecoveryMetadata(metadata, "folder", 4));
  for (const changed of [
    { ownedByMe: false }, { trashed: true }, { size: "3" }, { parents: ["other"] },
    { permissions: [] }, { permissions: [{ type: "anyone", role: "reader" }] },
    { permissions: [{ type: "user", role: "writer" }] },
  ]) assert.throws(() => assertPrivateRecoveryMetadata({ ...metadata, ...changed }, "folder", 4), /owner-private/);
});

test("durable recovery keys conform to the real Drive uploader contract", () => {
  const key = recoveryArtifactKey("bwb-recovery-v1:fixture:image.png:hash");
  assert.equal(driveArtifactPropertyValue(key), key);
  assert.equal(key, recoveryArtifactKey("bwb-recovery-v1:fixture:image.png:hash"));
  assert.notEqual(key, recoveryArtifactKey("bwb-recovery-v1:other:image.png:hash"));
});

test("a transcript backup outage stops before the next clip and preserves the cached result", async () => {
  const ids = ["first_clip_1234567890", "second_clip_1234567890"];
  const visited: string[] = [];
  const clips = ids.map(fileId => ({ fileId, name: `${fileId}.mp4`, durationSeconds: 30 })) as any;
  await assert.rejects(extractWeeklyDriveTranscripts(clips, async () => {
    throw new Error("BWB recovery paused: Drive unavailable");
  }, url => {
    visited.push(url);
    return { url, videoId: ids[0], title: "original", transcript: "retained words", durationSeconds: 30 };
  }), /BWB recovery paused/);
  assert.equal(visited.length, 1);
});

test("restoring a folder merges immutable inventories across process restarts", () => {
  const first = { fileId: "first", folderId: "folder", name: "image.png", size: 1, sha256: "a".repeat(64) };
  const later = { ...first, fileId: "second", name: "audio.mp3" };
  const versions = [
    { version: 1, videoId: "fixture", artifacts: [first] },
    { version: 1, videoId: "fixture", artifacts: [later] },
  ];
  assert.deepEqual(mergeRecoveryInventories(versions).artifacts, [first, later]);
  assert.throws(() => mergeRecoveryInventories([...versions, { ...versions[0], videoId: "another" }]), /identity/);
});

test("local chapter batches propagate backup failures before starting another batch", () => {
  let started = 0;
  assert.throws(() => {
    for (let batch = 0; batch < 3; batch++) {
      started++;
      assertVideoRecoveryBatch([{ status: "rejected", reason: new Error("BWB recovery paused: Drive outage") }]);
    }
  }, /BWB recovery paused/);
  assert.equal(started, 1);
  assert.throws(() => assertVideoRecoveryBatch([
    { status: "fulfilled", value: { result: { error: "BWB recovery paused: audio backup failed" } } },
  ]), /audio backup failed/);
});
