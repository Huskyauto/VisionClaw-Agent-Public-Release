import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { signWorkspaceRequest, authenticateWorkspaceRequest } from "../../server/lib/workspace-verifier-contract";
import { validateWorkspaceSnapshot, readWorkspaceVerificationContext } from "../../server/lib/workspace-verifier-contract";
import { captureVerifierSource, stageVerifierSource } from "../../server/lib/workspace-verifier-source";

test("workspace requests are purpose/path/body bound and expire before queue work", () => {
  const key = "fixture-only-not-a-credential";
  const body = '{"requestId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
  const signature = signWorkspaceRequest(key, "/internal/workspace-verifier/claim", body, 1000);
  assert.equal(authenticateWorkspaceRequest(key, "/internal/workspace-verifier/claim", body, "1000", signature, 1000), true);
  for (const [path, bytes, time] of [
    ["/internal/workspace-verifier/settle", body, 1000],
    ["/internal/workspace/source-repair-handoff", body, 1000],
    ["/internal/workspace-verifier/claim", `${body} `, 1000],
    ["/internal/workspace-verifier/claim", body, 62_000],
  ] as const) assert.equal(authenticateWorkspaceRequest(key, path, bytes, "1000", signature, time), false);
  assert.equal(authenticateWorkspaceRequest("", "/internal/workspace-verifier/claim", body, "1000", signature, 1000), false);
});

export const fixtureSnapshot = {
  version: 1, jobId: 3, tenantId: 2, proposalId: 7, attempt: 1,
  leaseUntil: 300_000, nonce: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  targetFile: "server/example.ts", codeDiff: "bounded diff",
  sourceSha256: "a".repeat(64), contextSha256: "b".repeat(64),
};

test("snapshot rejects forged scope, paths, digests and oversized inputs", () => {
  assert.deepEqual(validateWorkspaceSnapshot(fixtureSnapshot), fixtureSnapshot);
  for (const change of [
    { tenantId: "2" }, { tenantId: 0 }, { attempt: -1 }, { jobId: 1.5 },
    { targetFile: "../secret.ts" }, { targetFile: "server/../secret.ts" },
    { targetFile: "server//file.ts" }, { targetFile: "/server/file.ts" },
    { targetFile: "data/secrets.json" }, { sourceSha256: "fake" },
    { codeDiff: "x".repeat(100_000) }, { nonce: "guessed" },
  ]) assert.throws(() => validateWorkspaceSnapshot({ ...fixtureSnapshot, ...change }));
});

test("compiler staging is immutable, content-bound, bounded and rejects symlink source", () => {
  const root = mkdtempSync(join(tmpdir(), "verifier-source-fixture-"));
  let staged: ReturnType<typeof stageVerifierSource> | undefined;
  try {
    for (const folder of ["server", "shared", "client/src", "node_modules"]) mkdirSync(join(root, folder), { recursive: true });
    for (const file of ["tsconfig.json", "package.json", "package-lock.json"]) writeFileSync(join(root, file), "{}");
    writeFileSync(join(root, "server/example.ts"), "export const value = 1;");
    const source = captureVerifierSource(root);
    assert.throws(() => stageVerifierSource(root, "f".repeat(64)), /mismatch/);
    staged = stageVerifierSource(root, source.hash);
    writeFileSync(join(root, "server/example.ts"), "export const value = 2;");
    assert.equal(readFileSync(join(staged.root, "server/example.ts"), "utf8"), "export const value = 1;");
    assert.notEqual(captureVerifierSource(root).hash, source.hash);
    symlinkSync(join(root, "package.json"), join(root, "server/secret.ts"));
    assert.throws(() => captureVerifierSource(root), /symlink|regular/i);
  } finally { staged?.cleanup(); rmSync(root, { recursive: true, force: true }); }
});

test("staging captures imported public release metadata but not private documents", () => {
  const root = mkdtempSync(join(tmpdir(), "verifier-metadata-fixture-"));
  let staged: ReturnType<typeof stageVerifierSource> | undefined;
  try {
    for (const folder of ["server", "shared", "client/src", "node_modules", "docs"])
      mkdirSync(join(root, folder), { recursive: true });
    for (const file of ["tsconfig.json", "package.json", "package-lock.json"])
      writeFileSync(join(root, file), "{}");
    writeFileSync(join(root, "docs/release-facts.json"), '{"release":"fixture"}');
    writeFileSync(join(root, "docs/private.json"), '{"private":"must not be captured"}');
    const source = captureVerifierSource(root);
    assert.equal(source.files.get("docs/release-facts.json")?.toString(), '{"release":"fixture"}');
    assert.equal(source.files.has("docs/private.json"), false);
    staged = stageVerifierSource(root, source.hash);
    assert.equal(readFileSync(join(staged.root, "docs/release-facts.json"), "utf8"), '{"release":"fixture"}');
    writeFileSync(join(root, "docs/release-facts.json"), '{"release":"changed"}');
    assert.notEqual(captureVerifierSource(root).hash, source.hash);
    assert.throws(() => stageVerifierSource(root, source.hash), /baseline mismatch/);
  } finally { staged?.cleanup(); rmSync(root, { recursive: true, force: true }); }
});

test("workspace receipt context cannot be malformed, duplicated or silently dropped", () => {
  assert.equal(readWorkspaceVerificationContext("legacy receipt"), undefined);
  const line = `WORKSPACE_VERIFIER_CONTEXT_SHA256:${"a".repeat(64)}`;
  assert.equal(readWorkspaceVerificationContext(`summary\n${line}\nreceipt`), "a".repeat(64));
  assert.throws(() => readWorkspaceVerificationContext(`${line}\n${line}`), /context/i);
  assert.throws(() => readWorkspaceVerificationContext("WORKSPACE_VERIFIER_CONTEXT_SHA256:fake"), /context/i);
});
