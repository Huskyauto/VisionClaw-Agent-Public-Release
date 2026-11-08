import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { proveReadiness, type LoopContract } from "../../server/loop-contracts";

test("distributed loop readiness proves actual guard sources without accepting prose or escapes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loop-readiness-"));
  try {
    fs.writeFileSync(path.join(root, "entry.ts"), "// entry");
    fs.writeFileSync(path.join(root, "gate.ts"), "if (process.env.TEST_STOP === '0') return;");
    const fixture = {
      source: "entry.ts",
      readiness: { killSwitch: "TEST_STOP", sources: { killSwitch: "gate.ts" } },
    } as unknown as LoopContract;
    assert.equal(proveReadiness(fixture, root).proof.killSwitch, true);
    fixture.readiness!.killSwitch = "not a real token";
    assert.equal(proveReadiness(fixture, root).proof.killSwitch, false);
    fixture.readiness!.killSwitch = "TEST_STOP";
    fixture.readiness!.sources!.killSwitch = "../gate.ts";
    assert.equal(proveReadiness(fixture, root).proof.killSwitch, false);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "loop-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "gate.ts"), "TEST_STOP");
      fs.symlinkSync(outside, path.join(root, "linked"));
      fixture.readiness!.sources!.killSwitch = "linked/gate.ts";
      assert.equal(proveReadiness(fixture, root).proof.killSwitch, false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
