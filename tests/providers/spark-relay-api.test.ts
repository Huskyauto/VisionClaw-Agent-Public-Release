test("real authentication scope policy permits only anchored chat-scoped relay writes", async () => {
  const { checkApiKeyScopes } = await import("../../server/auth");
  for (const path of ["/api/v1/spark/legion-relay/poll",
    "/api/v1/spark/legion-relay/12/start", "/api/v1/spark/legion-relay/12/result"]) {
    assert.equal(checkApiKeyScopes({ method: "POST", path, apiKeyScopes: ["chat"] } as any), null);
    assert.ok(checkApiKeyScopes({ method: "POST", path, apiKeyScopes: ["read"] } as any));
  }
  for (const path of ["/api/v1/spark/legion-relay/poll/extra",
    "/api/v1/spark/legion-relay/probe", "/api/v1/spark/legion-relay/12/release"])
    assert.ok(checkApiKeyScopes({ method: "POST", path, apiKeyScopes: ["chat"] } as any));
});
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express, { type Express, type RequestHandler } from "express";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { registerSparkRelayApi } from "../../server/routes/spark-legion-relay";
import {
  makeRelayRequest, SPARK_RELAY, validateRelayCompletion,
} from "../../server/legion/spark-relay-contract";
import { RelayConflict } from "../../server/legion/spark-relay-store";
import { guardLocalMessages, LEGION_MODEL } from "../../server/legion/model-policy";

const prefix = "/api/v1/spark/legion-relay";
const execFileAsync = promisify(execFile);

const apiOnlyFixture: RequestHandler = (req, res, next) =>
  Number.isSafeInteger((req as any).apiKeyId) ? next() : res.status(403).json({ error: "API key required" });

function makeApp(store: any = {}) {
  const app = express();
  app.use(express.json());
  const auth: RequestHandler = (req, res, next) => {
    const identity = {
      "owner-chat": { tenant: 1, key: 101, scopes: ["chat"] },
      "owner-read": { tenant: 1, key: 102, scopes: ["read"] },
      "owner-admin": { tenant: 1, key: 103, scopes: ["admin"] },
      "other-chat": { tenant: 2, key: 201, scopes: ["chat"] },
      "session-only": { tenant: 1 },
    }[(req.header("authorization") ?? "").replace(/^Bearer /, "")];
    if (!identity) return res.status(401).json({ error: "Unauthorized fixture credential" });
    (req as any).tenantId = identity.tenant;
    if ("key" in identity) {
      (req as any).apiKeyId = identity.key;
      (req as any).apiKeyScopes = identity.scopes;
    } else {
      (req as any).user = { tenantId: identity.tenant };
    }
    next();
  };
  registerSparkRelayApi(app as Express, auth, apiOnlyFixture, req => (req as any).tenantId ?? null,
    store, () => true);
  return app;
}

async function serve(t: import("node:test").TestContext, app = makeApp()) {
  const server: Server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  t.after(() => new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())));
  const origin = `http://127.0.0.1:${address.port}`;
  const base = `${origin}${prefix}`;
  const call = (path: string, token = "owner-chat", init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });
  return { call, base, origin };
}

test("owner API identity and scopes are trusted; body tenant values cannot grant ownership", async t => {
  const calls: string[] = [];
  const app = makeApp({
    status: async (tenant: number) => { calls.push(`status:${tenant}`); return { jobs: [] }; },
    poll: async (...args: unknown[]) => { calls.push(`poll:${args[0]}:${args[1]}`); return null; },
    get: async () => undefined,
  });
  const { call } = await serve(t, app);
  const schema = await call("/schema", "owner-read");
  assert.equal(schema.status, 200);
  assert.equal(schema.headers.get("cache-control"), "no-store");
  assert.equal((await call("/schema", "other-chat")).status, 403);
  assert.equal((await call("/schema", "session-only")).status, 403);
  assert.equal((await call("/status", "owner-read")).status, 200);
  assert.equal((await call("/poll", "owner-read", {
    method: "POST", body: JSON.stringify({
      tenantId: 1, protocol: SPARK_RELAY.protocol, workerId: "worker_0001",
      model: SPARK_RELAY.model, ready: true,
    }),
  })).status, 403, "read-only credential cannot use worker writes");
  assert.equal((await call("/poll", "other-chat", {
    method: "POST", body: JSON.stringify({
      tenantId: 1, protocol: SPARK_RELAY.protocol, workerId: "worker_0001",
      model: SPARK_RELAY.model, ready: true,
    }),
  })).status, 403, "untrusted request-body tenant does not elevate a non-owner API key");
  assert.deepEqual(calls, ["status:1"]);
});

test("GET job endpoint returns only metadata for the API key that owns the claim", async t => {
  const app = makeApp({
    get: async (_tenant: number, id: number) => ({
      id, status: "relay_claimed",
      payload: {
        task: "compile-runbook", requestJson: "PRIVATE TASK TEXT", requestId: "request-id",
        digest: "a".repeat(64), deadlineAt: "2030-01-01T00:00:00.000Z",
        claim: { apiKeyId: 101 },
      },
    }),
  });
  const { call } = await serve(t, app);
  const own = await call("/123", "owner-chat");
  assert.equal(own.status, 200);
  const ownBody = await own.json() as Record<string, unknown>;
  assert.equal(ownBody.jobId, 123);
  assert.equal(ownBody.status, "claimed");
  assert.equal("requestJson" in ownBody, false);
  assert.equal("task" in ownBody, false);
  assert.equal((await call("/123", "owner-read")).status, 404);
  assert.equal((await call("/123", "session-only")).status, 403);
});

test("start false and conflict responses never trigger result submission or infer inference success", async t => {
  let resultCalls = 0;
  let conflict = false;
  const app = makeApp({
    start: async () => {
      if (conflict) throw new RelayConflict("admission rejected");
      return { started: false };
    },
    result: async () => { resultCalls++; return { accepted: true, duplicate: false }; },
  });
  const { call } = await serve(t, app);
  const binding = {
    protocol: SPARK_RELAY.protocol, workerId: "worker_0001",
    requestId: "00000000-0000-4000-8000-000000000001",
    digest: "a".repeat(64), claimToken: "00000000-0000-4000-8000-000000000002",
  };
  const response = await call("/123/start", "owner-chat", { method: "POST", body: JSON.stringify(binding) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { started: false });
  conflict = true;
  const rejected = await call("/123/start", "owner-chat", { method: "POST", body: JSON.stringify(binding) });
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.json() as { error: string }).error, "admission rejected");
  assert.equal(resultCalls, 0, "the API must not infer success or submit a result after start false");
});

test("API rate cap rejects requests beyond 60 per minute", async t => {
  const { call } = await serve(t);
  let last: Response | undefined;
  for (let i = 0; i < 61; i++) last = await call("/schema");
  assert.equal(last?.status, 429);
});

test("actual Python worker completes one request through real Express relay ingress and local Ollama HTTP", async t => {
  const body = {
    model: LEGION_MODEL, temperature: 0, stream: false, max_tokens: 64,
    messages: guardLocalMessages([{ role: "user", content: "What is 17 + 25? Reply only with the number." }]),
  };
  const request = makeRelayRequest(body);
  const requestId = "b63a12a0-0302-4d09-8dc7-4a6c3a3b9239";
  const claimToken = "521ba125-e899-47d5-98dd-3aa541bde36c";
  const jobId = 76543;
  const deadlineAt = new Date(Date.now() + SPARK_RELAY.deadlineMs).toISOString();
  const nativeResponse = JSON.stringify({
    model: LEGION_MODEL, done: true, done_reason: "stop",
    message: { role: "assistant", content: "42" }, prompt_eval_count: 12, eval_count: 1,
  });
  const calls = { poll: 0, start: 0, result: 0 };
  const apiRequests: string[] = [];
  let ollamaTagsCalls = 0, inferenceCalls = 0;
  let ollamaAuthorization: string | undefined;
  let nativeRequestBytes: Buffer | undefined;
  let claimedWorkerId: string | undefined;
  let savedResponseJson: string | undefined;
  const fixtureErrors: Error[] = [];
  const job = { jobId, requestId, digest: request.digest, requestJson: request.requestJson, claimToken, deadlineAt };

  const app = express();
  app.use((req, _res, next) => { apiRequests.push(`${req.method} ${req.originalUrl}`); next(); });
  app.use(express.json());
  const { checkApiKeyScopes } = await import("../../server/auth");
  const auth: RequestHandler = (req, res, next) => {
    if (req.header("authorization") !== "Bearer vc_fixture") return res.status(401).end();
    (req as any).apiKeyId = 101;
    (req as any).apiKeyScopes = ["chat"];
    (req as any).tenantId = 1;
    const denied = checkApiKeyScopes(req);
    if (denied) return res.status(403).json({ error: denied.error });
    next();
  };
  const store = {
    poll: async (tenant: number, apiKeyId: number, workerId: string, ready: boolean) => {
      calls.poll++;
      try {
        assert.equal(tenant, 1);
        assert.equal(apiKeyId, 101);
        assert.match(workerId, /^[A-Za-z0-9_-]{8,64}$/);
        claimedWorkerId = workerId;
        assert.equal(ready, true);
      } catch (error) { fixtureErrors.push(error as Error); throw error; }
      return job;
    },
    start: async (tenant: number, apiKeyId: number, id: number, binding: any) => {
      calls.start++;
      try {
        assert.equal(tenant, 1);
        assert.equal(apiKeyId, 101);
        assert.equal(id, jobId);
        assert.equal(binding.protocol, SPARK_RELAY.protocol);
        assert.equal(binding.requestId, requestId);
        assert.equal(binding.digest, request.digest);
        assert.equal(binding.claimToken, claimToken);
        assert.equal(binding.workerId, claimedWorkerId);
      } catch (error) { fixtureErrors.push(error as Error); throw error; }
      return { started: true };
    },
    result: async (tenant: number, apiKeyId: number, id: number, binding: any, outcome: string, responseJson?: string) => {
      calls.result++;
      try {
        assert.equal(tenant, 1);
        assert.equal(apiKeyId, 101);
        assert.equal(id, jobId);
        assert.equal(binding.protocol, SPARK_RELAY.protocol);
        assert.equal(binding.requestId, requestId);
        assert.equal(binding.digest, request.digest);
        assert.equal(binding.claimToken, claimToken);
        assert.equal(binding.workerId, claimedWorkerId);
        assert.equal(outcome, "complete");
        assert.equal(typeof responseJson, "string");
        savedResponseJson = responseJson;
        assert.deepEqual(validateRelayCompletion(request.requestJson, responseJson!), {
          model: LEGION_MODEL, system_fingerprint: "fp_ollama",
          usage: { prompt_tokens: 12, completion_tokens: 1 },
          choices: [{ finish_reason: "stop", message: { role: "assistant", content: "42" } }],
        });
      } catch (error) { fixtureErrors.push(error as Error); throw error; }
      // Deliberately omit task/probe and usage; ingress must not invoke billing.
      return { accepted: true, duplicate: false };
    },
  };
  registerSparkRelayApi(app as Express, auth, apiOnlyFixture,
    req => (req as any).tenantId ?? null, store as any, () => true);
  const { origin: appOrigin } = await serve(t, app);

  const ollamaServer: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    ollamaAuthorization = req.headers.authorization;
    if (req.method === "GET" && req.url === "/api/tags") {
      ollamaTagsCalls++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: LEGION_MODEL }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/chat") {
      inferenceCalls++;
      nativeRequestBytes = Buffer.concat(chunks);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(nativeResponse);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>(resolve => ollamaServer.listen(0, "127.0.0.1", resolve));
  const ollamaAddress = ollamaServer.address();
  assert.ok(ollamaAddress && typeof ollamaAddress === "object");
  t.after(() => new Promise<void>((resolve, reject) =>
    ollamaServer.close(error => error ? reject(error) : resolve())));

  const home = mkdtempSync(join(tmpdir(), "spark-relay-python-worker-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const workerScript = String.raw`
import importlib.util
import json
import sys
from pathlib import Path

worker_path, app_base, ollama_base, home = sys.argv[1:5]
spec = importlib.util.spec_from_file_location("spark_legion_worker_fixture", worker_path)
worker_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker_module
spec.loader.exec_module(worker_module)

class LocalOllamaClient:
    def __init__(self, origin):
        self.origin = origin.rstrip("/")
        self.client = worker_module.UrllibClient()
    def request(self, method, url, body=None, headers=None, timeout=20, max_bytes=65536):
        prefix = worker_module.OLLAMA_BASE
        if not url.startswith(prefix):
            raise RuntimeError("unexpected provider URL")
        return self.client.request(method, self.origin + url[len(prefix):],
                                   body, headers, timeout, max_bytes)

worker = worker_module.RelayWorker(
    app_base=app_base,
    api_key="vc_fixture",
    home=Path(home),
    app_client=worker_module.UrllibClient(),
    ollama_client=LocalOllamaClient(ollama_base),
    environ={},
)
print(json.dumps({"outcome": worker.run_once(), "lastError": worker.last_error}))
`;
  const childEnv: NodeJS.ProcessEnv = { PYTHONDONTWRITEBYTECODE: "1" };
  if (process.env.PATH) childEnv.PATH = process.env.PATH;
  if (process.env.LANG) childEnv.LANG = process.env.LANG;
  const workerPath = resolve("scripts/spark-legion-worker.py");
  const { stdout } = await execFileAsync("python3", ["-c", workerScript, workerPath, appOrigin,
    `http://127.0.0.1:${ollamaAddress.port}`, home], {
    env: childEnv, timeout: 25_000, maxBuffer: 1024 * 1024,
  });
  const report = JSON.parse(stdout.trim()) as { outcome: string; lastError: string | null };

  assert.deepEqual(fixtureErrors, []);
  assert.equal(report.outcome, "complete",
    `Python worker did not complete: ${report.lastError}; API requests: ${apiRequests.join(", ")}`);
  assert.equal(report.lastError, null);
  assert.deepEqual(calls, { poll: 1, start: 1, result: 1 });
  assert.equal(ollamaTagsCalls, 1);
  assert.equal(inferenceCalls, 1, "one successful /start authorizes exactly one inference");
  assert.equal(ollamaAuthorization, undefined, "the API credential must never reach the Ollama endpoint");
  assert.ok(nativeRequestBytes);
  assert.equal(nativeRequestBytes.toString("utf8"), request.requestJson, "worker sends the exact claimed request bytes");
  assert.equal(createHash("sha256").update(nativeRequestBytes).digest("hex"), request.digest);
  assert.equal(savedResponseJson, nativeResponse, "result ingress saves the exact native response bytes");
  assert.equal(JSON.parse(nativeResponse).message.content, "42");
});
