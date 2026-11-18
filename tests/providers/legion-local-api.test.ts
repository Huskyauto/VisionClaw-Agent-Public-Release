import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTailnetNode } from "../../server/legion/local-api";

test("local startup accepts the real 204 contract and sends the key only in the Unix-socket body", async () => {
  const dir = await mkdtemp(join(tmpdir(), "legion-api-test-"));
  const socket = join(dir, "control.sock");
  let observed: Record<string, any> | undefined;
  const paths: string[] = [];
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    paths.push(request.url!);
    const body = Buffer.concat(chunks).toString("utf8");
    if (request.url === "/localapi/v0/start") observed = JSON.parse(body);
    else assert.equal(body, "");
    response.writeHead(204).end();
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  try {
    await startTailnetNode(socket, "synthetic-not-a-real-key", "development");
    assert.deepEqual(paths, ["/localapi/v0/start", "/localapi/v0/login-interactive"]);
    assert.equal(observed?.AuthKey, "synthetic-not-a-real-key");
    // Tailscale lowercases policy tags; LocalAPI callers must use canonical form.
    assert.deepEqual(observed?.UpdatePrefs.AdvertiseTags, ["tag:visionclaw"]);
    assert.equal(observed?.UpdatePrefs.CorpDNS, false);
    assert.equal(observed?.UpdatePrefs.RouteAll, false);
    assert.equal(observed?.UpdatePrefs.ShieldsUp, true);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
