import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import { transformSync } from "esbuild";

// Execute the actual route module with synthetic credentials and inert imports.
// Never load the DB, refresh tokens, send mail, or contact Google.
function fixture() {
  const require = createRequire(import.meta.url);
  const module = { exports: {} as any };
  const code = transformSync(readFileSync("server/routes/gmail-direct.ts", "utf8"), {
    loader: "ts", format: "cjs",
  }).code;
  vm.runInNewContext(code, {
    module, exports: module.exports, Buffer, console, URLSearchParams,
    process: { env: {
      ADMIN_PIN: "synthetic-test-pin",
      SESSION_SECRET: "synthetic-state-signing-key",
      GOOGLE_OAUTH_CLIENT_ID: "synthetic-client",
      REPLIT_DOMAINS: "app.example.test",
    } },
    require(name: string) {
      if (name === "crypto") return require("node:crypto");
      if (name === "../lib/owner-email") return { resolveOwnerEmail: () => "" };
      if (name === "../lib/silent-catch") return { logSilentCatch() {} };
      if (name === "../lib/gmail-direct-token") return {};
      if (name === "../google-workspace") return {};
      throw new Error(`Unexpected route dependency: ${name}`);
    },
  });
  const handlers = new Map<string, Function>();
  module.exports.registerGmailDirectRoutes({
    get(path: string, handler: Function) { handlers.set(`GET ${path}`, handler); },
    post(path: string, handler: Function) { handlers.set(`POST ${path}`, handler); },
  });
  function response() {
    return {
      headers: new Map<string, string>([
        ["Content-Security-Policy", "default-src 'self';form-action 'self'"],
      ]),
      body: "", statusCode: 200, location: "",
      setHeader(name: string, value: string) { this.headers.set(name, value); return this; },
      type(_value: string) { return this; },
      status(value: number) { this.statusCode = value; return this; },
      send(value: string) { this.body = value; return this; },
      redirect(value: string) { this.statusCode = 302; this.location = value; return this; },
    };
  }
  return { handlers, response };
}

test("Gmail reconnect form allows the exact Google redirect without opening arbitrary form targets", () => {
  const { handlers, response } = fixture();
  const res = response();
  handlers.get("GET /api/admin/gmail-direct/start")!({}, res);
  const policy = res.headers.get("Content-Security-Policy")!;
  const formAction = policy.split(";").find(part => part.trim().startsWith("form-action"))!.trim();
  assert.equal(formAction, "form-action 'self' https://accounts.google.com");
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /base-uri 'none'/);
  assert.match(res.body, /method="post" action="\/api\/admin\/gmail-direct\/auth"/);
  assert.doesNotMatch(res.body, /[?&]pin=/);
});

test("only a valid body/header PIN starts Google OAuth; the PIN never enters its URL", () => {
  const { handlers, response } = fixture();
  const auth = handlers.get("POST /api/admin/gmail-direct/auth")!;
  const valid = response();
  auth({ headers: {}, body: { pin: "synthetic-test-pin" }, ip: "test-valid" }, valid);
  assert.equal(valid.statusCode, 302);
  const redirect = new URL(valid.location);
  assert.equal(redirect.origin, "https://accounts.google.com");
  assert.equal(redirect.searchParams.get("redirect_uri"), "https://app.example.test/api/admin/gmail-direct/callback");
  assert.equal(redirect.searchParams.get("scope"),
    "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send");
  assert.ok(redirect.searchParams.get("state"));
  assert.doesNotMatch(valid.location, /synthetic-test-pin/);
  assert.equal(valid.headers.get("Content-Security-Policy"), "default-src 'self';form-action 'self'");

  for (const req of [
    { headers: {}, body: { pin: "wrong" } },
    { headers: {}, body: {}, query: { pin: "synthetic-test-pin" } },
  ]) {
    const rejected = response();
    auth({ ...req, ip: "test-invalid" }, rejected);
    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.location, "");
  }
});
