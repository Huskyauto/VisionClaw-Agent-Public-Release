import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import test from "node:test";

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

test("production binds the warm-up page before awaiting network-dependent auth discovery", async () => {
  const source = await readFile("server/index.ts", "utf8");
  const warmupMiddleware = source.indexOf('if (req.path !== "/" && req.path !== "/index.html")');
  const productionListen = source.indexOf('httpServer.listen({ port: earlyPort, host: "0.0.0.0" })');
  const authSetup = source.indexOf("await setupAuth(app)");

  assert(warmupMiddleware >= 0, "warm-up middleware must remain installed");
  assert(productionListen >= 0, "production early-bind must remain installed");
  assert(authSetup >= 0, "auth setup must remain installed");
  assert(
    warmupMiddleware < productionListen && productionListen < authSetup,
    "warm-up middleware and socket bind must precede awaited OIDC discovery",
  );
  assert(
    !source.includes('if (!accept.includes("text/html")) return next();'),
    "the platform root readiness probe must not depend on an Accept header",
  );
});

test("the production warm-up page keeps the VM root readiness probe healthy", { timeout: 30_000 }, async () => {
  const port = await unusedPort();
  let output = "";
  const child = spawn(process.execPath, ["dist/index.cjs"], {
    cwd: process.cwd(),
    env: {
      // Keep this production-mode probe isolated from workspace credentials,
      // databases and autonomous workers, even when run outside GitHub Actions.
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DATABASE_URL: "postgres://ci_readiness@127.0.0.1:1/ci_readiness",
      REPL_ID: "ci-startup-readiness",
      REPLIT_DOMAINS: "ci-startup-readiness.invalid",
      ISSUER_URL: "https://127.0.0.1:1",
      OPENAI_API_KEY: "sk-ci-readiness-placeholder",
      ANTHROPIC_API_KEY: "sk-ant-ci-readiness-placeholder",
      XAI_API_KEY: "xai-ci-readiness-placeholder",
      GOOGLE_OAUTH_CLIENT_ID: "ci-readiness-placeholder",
      GOOGLE_OAUTH_CLIENT_SECRET: "ci-readiness-placeholder",
      NODE_ENV: "production",
      PORT: String(port),
      // Throwaway test-only value satisfies production startup validation; never use in deployment.
      SESSION_SECRET: "startup-readiness-contract-test-only-session-secret",
      PIN_PEPPER: "startup-readiness-contract-test-only-pin-pepper",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-8_000);
  });
  child.stderr?.on("data", (chunk) => {
    output = `${output}${String(chunk)}`.slice(-8_000);
  });

  try {
    let response: Response | undefined;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        assert.fail(`production server exited before readiness probe: ${output}`);
      }
      try {
        const candidate = await fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(1_000),
        });
        const body = await candidate.text();
        if (body.includes("<title>Starting VisionClaw")) {
          response = new Response(body, {
            status: candidate.status,
            headers: candidate.headers,
          });
          break;
        }
      } catch {
        // The socket is expected to refuse connections before the early bind.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert(response, `did not observe the production warm-up response: ${output}`);
    assert.equal(response.status, 200, "Replit's GET / readiness probe must receive HTTP 200");
    assert.match(response.headers.get("content-type") || "", /^text\/html\b/);
    assert.equal(response.headers.get("cache-control"), "no-store");

    const apiResponse = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    assert.notEqual(apiResponse.status, 200, "warm-up handling must not bypass API authentication/readiness");
  } finally {
    await stop(child);
  }
});