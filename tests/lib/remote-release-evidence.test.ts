import { test } from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import { createRemoteReleasePlan } from "../../scripts/lib/remote-release-plan";
import { hashBytes, readRemoteEvidence } from "../../scripts/lib/remote-release-evidence";

const plan = createRemoteReleasePlan({ base: "a".repeat(40), head: "b".repeat(40),
  sourceDigest: "c".repeat(64), changed: ["scripts/lib/offline-verification.ts"] });
function fixture() {
  const zip = new AdmZip();
  zip.addFile("plan.json", Buffer.from(JSON.stringify(plan)));
  for (const check of plan.checks) {
    zip.addFile(`results/${check.id}.log`, Buffer.from("fixture log"));
    zip.addFile(`results/${check.id}.json`, Buffer.from(JSON.stringify({
      checkId: check.id, logSha256: hashBytes("fixture log"),
    })));
  }
  return zip;
}
test("reads exact expected archive in memory and verifies every log hash", () => {
  const result = readRemoteEvidence(fixture().toBuffer(), plan);
  assert.equal(result.receipts.length, plan.checks.length);
  assert.match(result.artifactSha256, /^[a-f0-9]{64}$/);
});
test("rejects unexpected, missing, changed and symlink evidence", () => {
  const extra = fixture(); extra.addFile("unexpected.json", Buffer.from("{}"));
  assert.throws(() => readRemoteEvidence(extra.toBuffer(), plan), /Unexpected/);
  const missing = fixture(); missing.deleteFile(`results/${plan.checks[0].id}.json`);
  assert.throws(() => readRemoteEvidence(missing.toBuffer(), plan), /Incomplete/);
  const changed = fixture(); changed.updateFile(`results/${plan.checks[0].id}.log`, Buffer.from("altered"));
  assert.throws(() => readRemoteEvidence(changed.toBuffer(), plan), /integrity/);
  const mismatch = fixture(); mismatch.updateFile("plan.json", Buffer.from(JSON.stringify({ ...plan, head: "d".repeat(40) })));
  assert.throws(() => readRemoteEvidence(mismatch.toBuffer(), plan), /plan differs/);
  const link = fixture(); link.getEntry("plan.json")!.attr = (0o120777 << 16) >>> 0;
  assert.throws(() => readRemoteEvidence(link.toBuffer(), plan), /symlink/);
  const traversal = fixture();
  traversal.addFile("unsafe.json", Buffer.from("{}")).entryName = "../unsafe.json";
  assert.throws(() => readRemoteEvidence(traversal.toBuffer(), plan), /Unsafe/);
});

test("caps actual deflate output even when ZIP headers falsely declare a tiny member", () => {
  const bomb = fixture();
  bomb.updateFile("plan.json", Buffer.alloc(9 * 1024 * 1024, 0x41));
  const bytes = bomb.toBuffer();
  const localHeader = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const centralHeader = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.notEqual(localHeader, -1);
  assert.notEqual(centralHeader, -1);
  bytes.writeUInt32LE(1, localHeader + 22);
  bytes.writeUInt32LE(1, centralHeader + 24);
  assert.throws(() => readRemoteEvidence(bytes, plan), /decompression failed or exceeded limit/);
});

test("rejects members whose decompressed bytes do not match ZIP CRC metadata", () => {
  const bytes = fixture().toBuffer();
  const centralHeader = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.notEqual(centralHeader, -1);
  bytes.writeUInt32LE((bytes.readUInt32LE(centralHeader + 16) ^ 1) >>> 0, centralHeader + 16);
  assert.throws(() => readRemoteEvidence(bytes, plan), /CRC mismatch/);
});
