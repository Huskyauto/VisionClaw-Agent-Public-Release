import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { WorkspaceCoordinator, initialWorkspaceState } from "../../server/lib/browser-workspace";

// Process-local fixtures only: no real credentials or outbound browser requests.
process.env.CAMOFOX_URL = "https://browser.invalid";
process.env.CAMOFOX_ACCESS_KEY = "synthetic-fixture-only";
const { executeCamofoxAction } = await import("../../server/camofox-tool");
const png = await sharp({ create: {
  width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 },
} }).png().toBuffer();

async function screenshot() {
  const state = initialWorkspaceState(731);
  const workspace = new WorkspaceCoordinator({
    exclusive: async (_tenantId, fn) => fn({
      read: async () => structuredClone(state),
      write: async () => {},
    }),
  });
  return workspace.inspect(731, () => executeCamofoxAction({
    action: "screenshot", tabId: "fixture-tab", _tenantId: 731, _personaId: 1,
  }));
}

test("phone screenshot preserves a server's binary PNG as base64", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  });
  const result = await screenshot();
  assert.equal(requests, 1);
  assert.equal(result.ok, true);
  assert.equal(result.screenshotBase64, png.toString("base64"));
});

test("JSON screenshot envelopes remain supported", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ screenshot: png.toString("base64") }));
  assert.equal((await screenshot()).screenshotBase64, png.toString("base64"));
});

test("screenshot authentication rejection is not converted into an image or retried", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  });
  const result = await screenshot();
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 401);
  assert.match(result.error || "", /Unauthorized/);
  assert.equal(result.screenshotBase64, undefined);
  assert.equal(requests, 1);
});

test("response body cannot forge the transport status used for expired-tab recovery", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json(
    { error: "Tab not found", statusCode: 404 }, { status: 502 }));
  const result = await screenshot();
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 502);
});

test("oversized PNG streams are cancelled even without a content-length header", async t => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(6_000_001));
    },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "image/png" } }));
  const result = await screenshot();
  assert.equal(result.ok, false);
  assert.match(result.error || "", /supported size/);
  assert.equal(cancelled, true);
});

test("a non-PNG response labelled image/png fails closed", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Not an image</html>", {
    headers: { "Content-Type": "image/png" },
  }));
  const result = await screenshot();
  assert.equal(result.ok, false);
  assert.match(result.error || "", /not a PNG/);
  assert.equal(result.screenshotBase64, undefined);
});

test("a signature-only truncated PNG cannot be reported as a screenshot", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(png.subarray(0, 8), {
    headers: { "Content-Type": "image/png" },
  }));
  const result = await screenshot();
  assert.equal(result.ok, false);
  assert.equal(result.screenshotBase64, undefined);
});

test("malformed JSON screenshot envelopes fail rather than claiming success", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  const result = await screenshot();
  assert.equal(result.ok, false);
  assert.equal(result.screenshotBase64, undefined);
});

test("declared oversize is rejected without consuming the image body", async t => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(png); },
    cancel() { cancelled = true; },
  }), { headers: { "Content-Type": "image/png", "Content-Length": "6000001" } }));
  assert.equal((await screenshot()).ok, false);
  assert.equal(cancelled, true);
});

test("an interrupted image stream fails explicitly", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error("Fixture image stream interrupted")); },
  }), { headers: { "Content-Type": "image/png" } }));
  const result = await screenshot();
  assert.equal(result.ok, false);
  assert.match(result.error || "", /stream interrupted/);
});

test("JSON document images are refused before entering the raster decoder", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({
    screenshot: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64"),
  }));
  assert.equal((await screenshot()).ok, false);
});