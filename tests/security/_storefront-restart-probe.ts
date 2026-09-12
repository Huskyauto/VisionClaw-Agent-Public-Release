// Helper used ONLY by storefront-checkout-rate-limit.test.ts to prove the
// throttle's persistence across a TRUE process boundary (not just across
// two server instances inside one process, which an in-memory
// module-scoped store would still pass).
//
// Reads a single JSON object on argv[2] of the form:
//   { url?: string, body: object, expectedStatus: number }
// Spins up a fresh checkout server in this brand-new process, sends one
// POST, prints the resulting status code to stdout, exits 0 on a status
// match and 1 otherwise. The parent test process spawns this via
// child_process.spawnSync so the storefront-rate-limit-store module is
// loaded fresh from disk — there is no shared heap with the parent.
//
// Stripe is faked the same way as the test file: every https.request to
// api.stripe.com is intercepted and returns a canned Checkout Session.

import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import https from "node:https";

const origHttpsRequest = https.request;
let probeSessionCounter = 0;
(https as any).request = function patchedHttpsRequest(...args: any[]) {
  const opts = (typeof args[0] === "string" ? { host: new URL(args[0]).host } : args[0]) || {};
  const host = (opts as any).host || (opts as any).hostname || "";
  if (typeof host === "string" && host.includes("api.stripe.com")) {
    const reqEmitter = new EventEmitter() as any;
    reqEmitter.setHeader = () => {};
    reqEmitter.getHeader = () => undefined;
    reqEmitter.removeHeader = () => {};
    reqEmitter.write = () => true;
    reqEmitter.end = () => {
      const id = ++probeSessionCounter;
      const sessionPayload = {
        id: `cs_test_probe_${id}`,
        url: `https://checkout.stripe.com/c/pay/cs_test_probe_${id}`,
      };
      const body = JSON.stringify(sessionPayload);
      const res: any = new Readable({ read() {} });
      res.statusCode = 200;
      res.headers = { "content-type": "application/json" };
      res.push(body);
      res.push(null);
      const cb = args.find((a: any) => typeof a === "function");
      if (cb) setImmediate(() => cb(res));
    };
    reqEmitter.on = EventEmitter.prototype.on.bind(reqEmitter);
    reqEmitter.once = EventEmitter.prototype.once.bind(reqEmitter);
    reqEmitter.emit = EventEmitter.prototype.emit.bind(reqEmitter);
    reqEmitter.destroy = () => {};
    return reqEmitter;
  }
  return origHttpsRequest.apply(this, args as any);
};

async function main() {
  const raw = process.argv[2];
  if (!raw) { console.error("missing argv JSON"); process.exit(2); }
  const spec = JSON.parse(raw) as { body: any; expectedStatus: number; testLimit: number; testWindowMs: number };

  const express = (await import("express")).default;
  const sessionMod = (await import("express-session")).default;
  const { registerStoreCheckoutRoutes } = await import("../../server/routes/store-checkout");

  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(sessionMod({ secret: "probe-secret", resave: false, saveUninitialized: true }));
  registerStoreCheckoutRoutes(app);

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as any).port as number;
  const url = `http://127.0.0.1:${port}/api/store/checkout`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-rate-limit": String(spec.testLimit),
      "x-test-rate-window-ms": String(spec.testWindowMs),
    },
    body: JSON.stringify(spec.body),
  });
  const text = await resp.text();
  process.stdout.write(JSON.stringify({ status: resp.status, body: text, retryAfter: resp.headers.get("retry-after") }));
  server.close();
  process.exit(resp.status === spec.expectedStatus ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(3); });
