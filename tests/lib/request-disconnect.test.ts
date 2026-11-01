import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, request } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { watchRequestDisconnect } from "../../server/lib/request-disconnect";

test("a fully received HTTP POST can keep streaming after request close", async () => {
  let disconnected = false;
  let requestClosed = false;
  const server = createServer((req, res) => {
    watchRequestDisconnect(req, () => { disconnected = true; });
    req.once("close", () => { requestClosed = true; });
    req.resume();
    req.once("end", () => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: first\n\n");
      setTimeout(() => res.end("data: completed\n\n"), 25);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as { port: number };
    const body = await new Promise<string>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port: address.port, method: "POST" }, res => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => resolve(data));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end("synthetic prompt");
    });
    assert.equal(requestClosed, true, "exercise Node's real request-close event");
    assert.equal(disconnected, false, "normal body completion is not a browser disconnect");
    assert.match(body, /completed/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("an aborted or incomplete request still cancels work", () => {
  for (const state of [{ aborted: true, complete: true }, { aborted: false, complete: false }]) {
    const req = Object.assign(new EventEmitter(), state);
    let disconnected = false;
    watchRequestDisconnect(req as any, () => { disconnected = true; });
    req.emit("close");
    assert.equal(disconnected, true);
  }
});

test("abort followed by close notifies once, including a late-bound observer", () => {
  const req = Object.assign(new EventEmitter(), { aborted: false, complete: false });
  let notifications = 0;
  watchRequestDisconnect(req as any, () => { notifications++; });
  req.aborted = true;
  req.emit("aborted");
  req.emit("close");
  assert.equal(notifications, 1);
  watchRequestDisconnect(req as any, () => { notifications++; });
  assert.equal(notifications, 2, "a late observer immediately sees the existing abort");
});
