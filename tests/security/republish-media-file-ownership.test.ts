import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { writeFileHandler, workspaceWriteAuthorizationError } from "../../server/tools/domains/files/handlers";
import { withTenantContext } from "../../server/lib/tenant-context";
import { ADMIN_TENANT_ID } from "../../server/tenant-constants";
import { burnCaptions, renderEDL, transcribeWords } from "../../server/video-editor";

// Even a regressed admission check must never reach a live transcription API.
delete process.env.ELEVENLABS_API_KEY;

test("tenant write_file fails closed without a trusted path grant before touching the workspace", async () => {
  const fileName = `republish-media-ownership-${process.pid}.txt`;
  const target = path.join("/home/runner/workspace", "project-assets", fileName);
  assert.equal(existsSync(target), false);

  const result = await writeFileHandler(
    { path: `project-assets/${fileName}`, content: "tenant-owned test content" },
    { tenantId: 27 },
  );

  assert.match(String(result.error), /trusted, non-empty allowedPaths grant/);
  assert.equal(existsSync(target), false, "denial must happen before any workspace write");
});

test("workspace write grants remain trusted, limited, and owner-compatible", () => {
  assert.match(
    String(workspaceWriteAuthorizationError("server/notes.txt", { tenantId: 27 })),
    /trusted, non-empty allowedPaths grant/,
  );
  assert.equal(
    workspaceWriteAuthorizationError("project-assets/tenant-27/notes.txt", {
      tenantId: 27,
      allowedPaths: ["project-assets/tenant-27"],
    }),
    null,
  );
  assert.match(
    String(workspaceWriteAuthorizationError("server/notes.txt", {
      tenantId: 27,
      allowedPaths: ["project-assets/tenant-27"],
    })),
    /Directory freeze active/,
  );
  assert.equal(
    workspaceWriteAuthorizationError("server/notes.txt", { tenantId: ADMIN_TENANT_ID }),
    null,
    "platform owner keeps intentional workspace access when no allowlist is stamped",
  );
  assert.match(
    String(workspaceWriteAuthorizationError("server/notes.txt", {
      tenantId: ADMIN_TENANT_ID,
      allowedPaths: ["project-assets"],
    })),
    /Directory freeze active/,
    "a trusted allowlist continues to constrain even the owner",
  );
});

test("tenant video APIs reject foreign shared-workspace sources before read/render/provider work", async () => {
  const sharedSource = path.resolve("server/tools.ts");
  const outputName = `foreign-tenant-source-${process.pid}`;
  const expectedOutput = path.resolve("project-assets", `${outputName}.mp4`);
  assert.equal(existsSync(expectedOutput), false);

  const result = await withTenantContext(
    { tenantId: 27, source: "explicit" },
    async () => ({
      transcript: await transcribeWords(sharedSource, 27),
      edit: await renderEDL(sharedSource, [{ start: 0, end: 1 }], { outputName }, 27),
      captions: await burnCaptions(sharedSource, [{ word: "private", start: 0, end: 1 }], { outputName }, 27),
    }),
  );

  assert.match(String(result.transcript.error), /Access denied/);
  assert.match(String(result.edit.error), /Access denied/);
  assert.match(String(result.captions.error), /Access denied/);
  assert.equal(existsSync(expectedOutput), false, "foreign source rejection must precede render output creation");
});

test("video APIs require authenticated tenant context and reject mismatched explicit tenant IDs", async () => {
  const sharedSource = path.resolve("server/tools.ts");
  const withoutContext = await transcribeWords(sharedSource, 27);
  assert.match(String(withoutContext.error), /trusted tenant context/);

  const mismatch = await withTenantContext(
    { tenantId: 27, source: "explicit" },
    () => transcribeWords(sharedSource, 28),
  );
  assert.match(String(mismatch.error), /does not match the authenticated tenant context/);
});

test("platform owner can retain intentional workspace media access without invoking a provider", async () => {
  const source = path.resolve("server/tools.ts");
  const originalKey = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  try {
    const result = await withTenantContext(
      { tenantId: ADMIN_TENANT_ID, source: "explicit" },
      () => transcribeWords(source, ADMIN_TENANT_ID),
    );
    assert.equal(result.success, false);
    assert.equal(result.error, "ELEVENLABS_API_KEY not set",
      "reaching the provider configuration check proves owner path authorization passed without network I/O");
  } finally {
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
  }
});
