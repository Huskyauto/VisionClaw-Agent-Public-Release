import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("YouTube bootstrap retains credentials privately without printing them", async () => {
  const moduleUrl = pathToFileURL(join(process.cwd(), "scripts/lib/private-oauth-output.mjs")).href;
  const { savePrivateOAuthCredentials } = await import(moduleUrl);
  const root = mkdtempSync(join(tmpdir(), "private-oauth-test-"));
  try {
    const sample = { YOUTUBE_CLIENT_ID: "fixture-id", YOUTUBE_CLIENT_SECRET: "fixture-secret", YOUTUBE_REFRESH_TOKEN: "fixture-token" };
    const file = savePrivateOAuthCredentials(sample, root);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), sample);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.match(readFileSync(".gitignore", "utf8"), /^\.local\/$/m);
    assert.match(readFileSync(".replitignore", "utf8"), /^\.local\/private-oauth\/$/m);
    const source = readFileSync("scripts/youtube-oauth-bootstrap.mjs", "utf8");
    assert.doesNotMatch(source, /console\.(?:log|error)\([^;\n]*(?:cfg\.client_secret|tokens\.refresh_token)/);
    assert.doesNotMatch(source, /Paste all three lines back.*chat/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("private OAuth handoff refuses a symlinked parent directory", async () => {
  const moduleUrl = pathToFileURL(join(process.cwd(), "scripts/lib/private-oauth-output.mjs")).href;
  const { savePrivateOAuthCredentials } = await import(moduleUrl);
  const root = mkdtempSync(join(tmpdir(), "private-oauth-parent-"));
  const external = mkdtempSync(join(tmpdir(), "private-oauth-external-"));
  try {
    symlinkSync(external, join(root, ".local"), "dir");
    assert.throws(() => savePrivateOAuthCredentials({ fixture: "not-a-secret" }, root), /real directory/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});
