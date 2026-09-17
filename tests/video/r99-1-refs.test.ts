/**
 * R99.1 — Reference image plumbing tests.
 *
 * Verifies that `reference_image_paths` flows correctly from the
 * generate_social_image tool dispatch through to generateImage's
 * `referenceImagePaths` option, and that the gpt-image-2 edits endpoint is
 * actually selected when references are provided.
 *
 * No real network calls — we mock global.fetch and capture the request.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";

process.env.NO_INTENT_GATE_LLM = "1";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-r991-fake";

// R99.1 +sec — write test ref images inside project-assets so the path jail
// allows them. Using os.tmpdir() would (correctly) be rejected by the jail.
const ALLOWED_TEST_DIR = path.resolve(process.cwd(), "project-assets", "_r991_test");
fs.mkdirSync(ALLOWED_TEST_DIR, { recursive: true });

after(() => {
  try { fs.rmSync(ALLOWED_TEST_DIR, { recursive: true, force: true }); } catch {}
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

function writeTinyPng(p: string): void {
  fs.writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));
}

function allowedTmpPath(name: string): string {
  return path.join(ALLOWED_TEST_DIR, name);
}

test("generateImage(refs): routes to /v1/images/edits with multipart image[] parts", async () => {
  const { generateImage } = await import("../../server/replit_integrations/image/client");

  const tmpA = allowedTmpPath(`r991_ref_a_${Date.now()}.png`);
  const tmpB = allowedTmpPath(`r991_ref_b_${Date.now()}.png`);
  writeTinyPng(tmpA);
  writeTinyPng(tmpB);

  let capturedUrl = "";
  let capturedBodyIsFormData = false;
  let capturedAuthHeader = "";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    capturedUrl = String(url);
    capturedBodyIsFormData = init?.body instanceof FormData;
    capturedAuthHeader = init?.headers?.Authorization || "";
    const fakeB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    return new Response(JSON.stringify({ data: [{ b64_json: fakeB64 }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;

  try {
    const dataUrl = await generateImage("a happy bob in a gym", {
      referenceImagePaths: [tmpA, tmpB],
      callerLabel: "r99.1-test",
    });
    assert.match(dataUrl, /^data:image\/png;base64,/, "should return data URL");
    assert.equal(capturedUrl, "https://api.openai.com/v1/images/edits", "should hit edits endpoint");
    assert.equal(capturedBodyIsFormData, true, "body should be FormData (multipart)");
    assert.match(capturedAuthHeader, /^Bearer /, "should include bearer auth");
  } finally {
    globalThis.fetch = realFetch;
    try { fs.unlinkSync(tmpA); } catch {}
    try { fs.unlinkSync(tmpB); } catch {}
  }
});

test("generateImage(refs): falls back to refs-less cascade when edits endpoint fails", async () => {
  const { generateImage } = await import("../../server/replit_integrations/image/client");

  const tmpA = allowedTmpPath(`r991_ref_fb_${Date.now()}.png`);
  writeTinyPng(tmpA);

  let editsCalls = 0;
  let cascadeReached = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("/v1/images/edits")) {
      editsCalls++;
      return new Response(JSON.stringify({ error: "synthetic 500" }), { status: 500 });
    }
    if (u.includes("/v1/images/generations")) {
      cascadeReached = true;
      const fakeB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
      return new Response(JSON.stringify({ data: [{ b64_json: fakeB64 }] }), { status: 200 });
    }
    return new Response("", { status: 500 });
  }) as any;

  try {
    // Force model so cascade is deterministic and Gemini isn't tried first.
    const dataUrl = await generateImage(`test fallback prompt unique-r991-${Date.now()}-${Math.random()}`, {
      referenceImagePaths: [tmpA],
      model: "gpt-image-2",
      callerLabel: "r99.1-fallback-test",
    });
    assert.match(dataUrl, /^data:image\/png;base64,/);
    assert.equal(editsCalls, 1, "edits endpoint should be tried first");
    assert.equal(cascadeReached, true, "should fall back to refs-less generations endpoint");
  } finally {
    globalThis.fetch = realFetch;
    try { fs.unlinkSync(tmpA); } catch {}
  }
});

test("R99.1 +sec: path jail rejects paths outside project-assets/uploads/attached_assets", async () => {
  const { isPathInAllowedRoots, filterAllowedRefPaths } = await import("../../server/lib/image-ref-jail");
  const cwd = process.cwd();

  // Allowed roots accept files within them.
  assert.equal(isPathInAllowedRoots(path.join(cwd, "project-assets", "x.png")), true);
  assert.equal(isPathInAllowedRoots(path.join(cwd, "uploads", "y.png")), true);
  assert.equal(isPathInAllowedRoots(path.join(cwd, "attached_assets", "z.png")), true);

  // Sensitive system paths rejected.
  assert.equal(isPathInAllowedRoots("/etc/passwd"), false);
  assert.equal(isPathInAllowedRoots("/root/.ssh/id_rsa"), false);
  assert.equal(isPathInAllowedRoots(path.join(cwd, ".env")), false);
  assert.equal(isPathInAllowedRoots(path.join(cwd, "server", "storage.ts")), false);

  // Path-traversal escape attempts rejected (normalized resolution catches them).
  assert.equal(isPathInAllowedRoots(path.join(cwd, "project-assets", "..", "..", "etc", "passwd")), false);
  assert.equal(isPathInAllowedRoots("project-assets/../server/storage.ts"), false);

  // Sibling-dir prefix attack: "/cwd/project-assets-evil/x" must NOT match "/cwd/project-assets".
  assert.equal(isPathInAllowedRoots(path.join(cwd, "project-assets-evil", "x.png")), false);

  // Filter helper splits correctly.
  const { allowed, rejected } = filterAllowedRefPaths([
    path.join(cwd, "project-assets", "ok.png"),
    "/etc/passwd",
    path.join(cwd, "uploads", "ok2.png"),
  ]);
  assert.equal(allowed.length, 2);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0], "/etc/passwd");
});

test("generateImage(no refs): does NOT touch the edits endpoint", async () => {
  const { generateImage } = await import("../../server/replit_integrations/image/client");

  let editsCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("/v1/images/edits")) editsCalls++;
    const fakeB64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    return new Response(JSON.stringify({ data: [{ b64_json: fakeB64 }] }), { status: 200 });
  }) as any;

  try {
    await generateImage(`no-refs path test prompt unique-r991-noref-${Date.now()}-${Math.random()}`, {
      model: "gpt-image-2",
      callerLabel: "r99.1-noref-test",
    });
    assert.equal(editsCalls, 0, "edits endpoint should never be hit when no refs");
  } finally {
    globalThis.fetch = realFetch;
  }
});
