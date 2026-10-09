import assert from "node:assert/strict";
import test from "node:test";
import { readResponseTextBounded } from "../server/lib/bounded-response";
import { makeWebCollectionRunKey } from "../server/lib/web-collection-idempotency";

test("bounded response reader accepts a response within the byte ceiling", async () => {
  const response = new Response("hello", { headers: { "content-length": "5" } });
  assert.equal(await readResponseTextBounded(response, 5), "hello");
});

test("bounded response reader rejects a declared oversized response before reading it", async () => {
  let aborted = false;
  const response = new Response("hello", { headers: { "content-length": "500" } });
  await assert.rejects(
    () => readResponseTextBounded(response, 5, () => { aborted = true; }),
    /exceeds 5 byte limit/,
  );
  assert.equal(aborted, true);
});

test("bounded response reader cancels a chunked response that crosses the ceiling", async () => {
  let aborted = false;
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
      controller.close();
    },
  }));
  await assert.rejects(
    () => readResponseTextBounded(response, 5, () => { aborted = true; }),
    /exceeds 5 byte limit/,
  );
  assert.equal(aborted, true);
});

test("collection idempotency key is stable within a bucket and scoped by tenant and lanes", () => {
  const now = 1_800_000;
  const a = makeWebCollectionRunKey(1, "https://example.com/a", ["web_fetch", "scrapling_scrape"], "static", now);
  const reordered = makeWebCollectionRunKey(1, "https://example.com/a", ["scrapling_scrape", "web_fetch"], "static", now + 1);
  const otherTenant = makeWebCollectionRunKey(2, "https://example.com/a", ["web_fetch", "scrapling_scrape"], "static", now);
  assert.equal(a.runKey, reordered.runKey);
  assert.notEqual(a.runKey, otherTenant.runKey);
});