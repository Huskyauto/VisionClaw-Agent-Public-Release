/**
 * EXEC CATASTROPHIC-FLOOR REGRESSION — the irreversible-damage / host-takedown
 * deny floor must block in EVERY security mode (including owner-elevated "full"),
 * and must not be evadable with case, whitespace, or flag-order tricks.
 *
 * The floor (server/exec-tool.ts CATASTROPHIC_DENY) is now a RegExp[] matched
 * against a normalized command (lowercased + whitespace collapsed). This suite
 * pins that a future refactor can't silently re-open a substring-only bypass.
 *
 * Runs offline (no spawn, no network) — isCommandAllowed is pure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isCommandAllowed } from "../../server/exec-tool";

const FULL = {
  enabled: true,
  securityMode: "full" as const,
  timeoutSeconds: 30,
  maxOutputBytes: 32768,
  allowlist: [],
  denyPatterns: [],
  workdir: process.cwd(),
};

// Variants that MUST be blocked even in owner-elevated full mode.
const MUST_BLOCK = [
  "rm -rf /",
  "RM -RF /",
  "rm  -rf   /",
  "rm\t-rf\t/",
  "rm -fr /",
  "rm -rf /*",
  "rm -r -f /",
  "rm   -r  -f  /*",
  "rm --recursive --force /",
  // Quoted / escaped root targets — normalizeCommand strips quotes & escapes
  // so these can't slip the floor (regression for the quoted-root bypass).
  'rm -rf "/"',
  "rm -rf '/'",
  'rm -rf "/*"',
  "rm -rf '/'*",
  "rm -rf \\/",
  "rm --recursive --force '/'",
  "mkfs.ext4 /dev/sda",
  "dd if=/dev/zero of=/dev/sda",
  "sudo SHUTDOWN now",
  "reboot",
  "halt",
  "poweroff",
  "chmod 777 /",
  ":(){ :|:& };:",
  "kill -9 1",
  "init 0",
  "init 6",
  "fdisk /dev/sda",
];

// Safe commands that MUST still be allowed in full mode.
const MUST_ALLOW = [
  "rm -rf /tmp/foo",
  "rm -rf ./build",
  "rm -r node_modules",
  "ls -la /",
  "npm run build",
  "git status",
  "cat /etc/hosts",
  "echo hello world",
];

test("catastrophic floor blocks dangerous variants in full mode", () => {
  for (const cmd of MUST_BLOCK) {
    const res = isCommandAllowed(cmd, FULL);
    assert.equal(res.allowed, false, `expected BLOCK but got allow: ${JSON.stringify(cmd)}`);
  }
});

test("catastrophic floor allows safe commands in full mode", () => {
  for (const cmd of MUST_ALLOW) {
    const res = isCommandAllowed(cmd, FULL);
    assert.equal(res.allowed, true, `expected ALLOW but got block: ${JSON.stringify(cmd)} (${res.reason})`);
  }
});

test("catastrophic floor also applies in allowlist mode", () => {
  const allowlistCfg = { ...FULL, securityMode: "allowlist" as const, allowlist: ["rm", "echo"] };
  const res = isCommandAllowed("RM -RF /", allowlistCfg);
  assert.equal(res.allowed, false, "allowlist mode must still hit the catastrophic floor");
});

test("disabled exec is always blocked", () => {
  const res = isCommandAllowed("echo hi", { ...FULL, enabled: false });
  assert.equal(res.allowed, false);
});
