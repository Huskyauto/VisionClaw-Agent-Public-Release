import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInstinctCsrfToken } from "../../server/auth";
import {
  INSTINCT_OPENING_TEXT, registerInstinctWebChannel, type InstinctWebPorts,
} from "../../server/instinct-web-channel";

// Tests use a synthetic default owner; never inherit the deployed account binding.
const originalLoginBinding = process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
delete process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
after(() => {
  if (originalLoginBinding === undefined) delete process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
  else process.env.INSTINCT_OWNER_LOGIN_TENANT_ID = originalLoginBinding;
  setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref();
});

const OWNER = "a".repeat(64);
const OTHER = "b".repeat(64);
type Memory = ReturnType<typeof memoryPorts>;

function memoryPorts() {
  let thread: any;
  const sessions = new Map([[OWNER, 1], [OTHER, 2]]);
  const submissions = new Map<string, any>();
  let run: any = { status: "idle", reason: null, failedAt: null, updatedAt: new Date() };
  const dispatchCalls: any[] = [];
  const claims: any[] = [];
  const launches: any[] = [];
  const outbox = Array.from({ length: 55 }, (_, index) => ({
    id: 99 - index,
    message: index === 0 ? `<img src=x onerror=alert(1)>` : `Instinct outbox ${index}`,
    personaId: 2, personaName: "Felix", conversationId: 700,
    createdAt: new Date("2026-01-02T00:00:00Z"),
  }));
  let wrongPassword = false;
  const ports: InstinctWebPorts = {
    async getSession(token) {
      const tenantId = sessions.get(token);
      return tenantId ? { tenantId, isAdmin: false } : null;
    },
    async login(_req, _email, _password, ownerId) {
      if (wrongPassword || ownerId !== 1) return { error: "invalid" };
      return { token: OWNER };
    },
    async revoke(token) { sessions.delete(token); },
    async getThread(tenantId) { return tenantId === 1 ? thread : undefined; },
    async reserveOpening(tenantId, submission) {
      if (thread) return false;
      thread = { tenantId, state: "reserved", conversationId: null, statusUrl: null,
        createdAt: new Date(), updatedAt: new Date() };
      submissions.set(submission.tokenHash, { ...submission });
      return true;
    },
    async reserveReplacement(tenantId, _expectedConversationId, submission) {
      if (!thread || thread.state !== "ready") return false;
      thread = { ...thread, previousConversationId: thread.conversationId, conversationId: null,
        statusUrl: null, state: "reserved", updatedAt: new Date() };
      submissions.set(submission.tokenHash, { ...submission });
      return true;
    },
    async findSubmission(tenantId, tokenHash) {
      const row = submissions.get(tokenHash);
      return row?.tenantId === tenantId ? row : undefined;
    },
    async createSubmission(submission) {
      if (submissions.has(submission.tokenHash)) return false;
      submissions.set(submission.tokenHash, { ...submission });
      return true;
    },
    async bindOpening(tenantId, requestId, conversationId, statusUrl) {
      thread = { ...thread, state: "ready", conversationId, statusUrl, updatedAt: new Date() };
      const row = [...submissions.values()].find(s => s.tenantId === tenantId && s.requestId === requestId);
      if (row) { row.conversationId = conversationId; row.state = "running"; }
      run = { status: "running", reason: null, failedAt: null, updatedAt: new Date() };
    },
    async blockOpening(tenantId) {
      if (thread?.tenantId === tenantId && thread.state === "reserved") thread.state = "blocked";
    },
    async updateSubmission(tenantId, requestId, state, conversationId) {
      const row = [...submissions.values()].find(s => s.tenantId === tenantId && s.requestId === requestId);
      if (row?.tenantId === tenantId) { row.state = state; if (conversationId) row.conversationId = conversationId; }
    },
    async hasUncertainSubmission(tenantId, conversationId) {
      return [...submissions.values()].some(s => s.tenantId === tenantId &&
        s.conversationId === conversationId && ["accepted", "running"].includes(s.state));
    },
    async getStatus() { return run; },
    async resumeFailedTurn() { return "blocked"; },
    async reviewUncertainFailedTurn() { return "blocked"; },
    async history() {
      return [{ id: 1, role: "assistant", content: `<script>alert(1)</script>`, createdAt: new Date() }];
    },
    async isApiThread(_tenantId, conversationId) { return conversationId === 700; },
    async outbox(_tenantId, before) { return outbox.filter(row => before === undefined || row.id < before).slice(0, 50); },
    async dispatch(tenantId, task, agent, async, beforeLaunch) {
      dispatchCalls.push({ tenantId, task, agent, async });
      const conversationId = 700;
      const statusUrl = `/api/v1/conversations/${conversationId}`;
      await beforeLaunch({ conversationId, statusUrl });
      const turn = new Promise(() => {});
      return { conversationId, statusUrl, turn };
    },
    async claimFollowUp(_tenantId, conversationId, clientKey, message, requestId) {
      claims.push({ conversationId, clientKey, message, requestId });
      return run.status === "idle" || run.status === "complete"
        ? { outcome: "claimed", requestId }
        : { outcome: "busy", requestId };
    },
    launchFollowUp(tenantId, conversationId, message, settled) {
      launches.push({ tenantId, conversationId, message, settled });
      run = { status: "running", reason: null, failedAt: null, updatedAt: new Date() };
    },
  };
  return {
    ports, sessions, submissions, dispatchCalls, claims, launches, outbox,
    getThread: () => thread, getRun: () => run,
    setThread: (value: any) => { thread = value; },
    setRun: (value: any) => {
      run = value;
      if (value.status === "complete" || value.status === "failed") {
        for (const row of submissions.values()) {
          if (row.state === "running") row.state = value.status;
        }
      }
    },
    addUncertainSubmission: (tenantId: number, conversationId: number) => {
      const tokenHash = `uncertain-${submissions.size}`;
      submissions.set(tokenHash, {
        tenantId, conversationId, tokenHash, clientKey: "uncertain", message: "uncertain",
        state: "accepted", requestId: "uncertain-request",
      });
    },
    setWrongPassword: (value: boolean) => { wrongPassword = value; },
  };
}

async function withApp<T>(memory: Memory, body: (base: string) => Promise<T>, ports?: Partial<InstinctWebPorts>) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  registerInstinctWebChannel(app, ports || memory.ports);
  const server: Server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  try { return await body(base); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
const get = (base: string, path: string, cookie = "") => fetch(base + path, {
  redirect: "manual", headers: cookie ? { cookie } : {},
});

test("a settled provider failure can be explicitly acknowledged without replaying or completing the failed request", async () => {
  const memory = memoryPorts();
  const failureTime = "2026-10-01T06:36:45.572Z";
  memory.setThread({ tenantId: 1, state: "ready", conversationId: 700,
    statusUrl: "/api/v1/conversations/700", createdAt: new Date(), updatedAt: new Date() });
  memory.setRun({ status: "failed", reason: "expert_provider_rejected",
    failedAt: new Date(failureTime), updatedAt: new Date(failureTime) });
  const recoveryCalls: any[] = [];
  const failedReceipt = { tenantId: 1, conversationId: 700, state: "failed",
    message: "Review my business.", tokenHash: "prior-token", requestId: "prior-request" };
  memory.submissions.set("prior-token", failedReceipt);
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    const failedPage = await get(base, "/instinct/chat", cookie);
    const html = await failedPage.text();
    assert.match(html, /AI services could not finish this request/);
    assert.match(html, /Acknowledge failure and resume conversation/);
    assert.doesNotMatch(html, /Send to Felix<\/button>/);
    const resumed = await post(base, "/instinct/chat", cookie, base, {
      action: "resume", csrf: csrfFrom(html), conversationId: "700",
      failedAt: failureTime, recovery: valueFrom(html, "recovery"), acknowledge: "yes",
    });
    assert.equal(resumed.status, 303);
    assert.deepEqual(recoveryCalls, [[1, 700, failureTime, 1]]);
    assert.equal(memory.launches.length, 0);
    assert.equal(memory.dispatchCalls.length, 0);
    assert.equal(failedReceipt.state, "failed");
    const after = await get(base, "/instinct/chat", cookie);
    assert.match(await after.text(), /Send to Felix<\/button>/);
  }, {
    ...memory.ports,
    async resumeFailedTurn(tenantId: number, conversationId: number, failedAt: string, principalTenantId: number) {
      recoveryCalls.push([tenantId, conversationId, failedAt, principalTenantId]);
      memory.setRun({ status: "idle", reason: "expert_provider_rejected",
        failedAt: new Date(failureTime), updatedAt: new Date() });
      return "resumed";
    },
  } as Partial<InstinctWebPorts>);
});

test("recovery requires channel authentication, exact signed failure identity, explicit acknowledgement and same-origin CSRF", async () => {
  const memory = memoryPorts();
  const failedAt = "2026-10-01T06:36:45.572Z";
  memory.setThread({ tenantId: 1, state: "ready", conversationId: 700,
    statusUrl: "/api/v1/conversations/700", createdAt: new Date(), updatedAt: new Date() });
  memory.setRun({ status: "failed", reason: "expert_provider_rejected", failedAt: new Date(failedAt) });
  let acknowledgements = 0;
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    const html = await (await get(base, "/instinct/chat", cookie)).text();
    const body = { action: "resume", csrf: csrfFrom(html), conversationId: "700", failedAt,
      recovery: valueFrom(html, "recovery"), acknowledge: "yes" };
    assert.equal((await post(base, "/instinct/chat", "", base, body)).status, 303);
    assert.equal((await post(base, "/instinct/chat", `instinct_session=${OTHER}`, base, body)).status, 403);
    assert.equal((await post(base, "/instinct/chat", cookie, "https://foreign.invalid", body)).status, 403);
    assert.equal((await post(base, "/instinct/chat", cookie, "null", body)).status, 403);
    for (const altered of [
      { csrf: "invalid" }, { recovery: "invalid" }, { failedAt: "2026-10-01T06:37:00.000Z" },
      { conversationId: "701" },
    ]) {
      assert.equal((await post(base, "/instinct/chat", cookie, base, { ...body, ...altered })).status, 403);
    }
    assert.equal((await post(base, "/instinct/chat", cookie, base, { ...body, acknowledge: "" })).status, 400);
    assert.equal(acknowledgements, 0);
    const previous = process.env.INSTINCT_LINE_ENABLED;
    process.env.INSTINCT_LINE_ENABLED = "0";
    try { assert.equal((await post(base, "/instinct/chat", cookie, base, body)).status, 503); }
    finally {
      if (previous === undefined) delete process.env.INSTINCT_LINE_ENABLED;
      else process.env.INSTINCT_LINE_ENABLED = previous;
    }
    assert.equal((await post(base, "/instinct/chat", cookie, base, body)).status, 409);
    assert.equal(acknowledgements, 1, "authoritative storage refuses a stale or uncertain failure");
  }, { ...memory.ports, async resumeFailedTurn() { acknowledgements++; return "blocked"; } });
});

test("active, timeout, unknown and uncertain failures do not advertise recovery", async () => {
  const memory = memoryPorts();
  memory.setThread({ tenantId: 1, state: "ready", conversationId: 700,
    statusUrl: "/api/v1/conversations/700", createdAt: new Date(), updatedAt: new Date() });
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    for (const [status, reason] of [["running", null], ["failed", "timeout"],
      ["failed", "processing_error"], ["failed", "missing_reply"], ["failed", "unknown"],
      ["failed", "expert_provider_uncertain"], ["failed", "expert_provider_unavailable"],
      ["failed", "expert_context_limit"]]) {
      memory.setRun({ status, reason, failedAt: new Date() });
      const html = await (await get(base, "/instinct/chat", cookie)).text();
      assert.doesNotMatch(html, /Acknowledge failure and resume conversation/);
      assert.doesNotMatch(html, /Send to Felix<\/button>/);
    }
    memory.setRun({ status: "failed", reason: "expert_provider_rejected", failedAt: new Date() });
    memory.addUncertainSubmission(1, 700);
    assert.doesNotMatch(await (await get(base, "/instinct/chat", cookie)).text(),
      /Acknowledge failure and resume conversation/);
    assert.equal(memory.launches.length, 0);
  });
});

test("designated login explicitly reviews a terminal legacy failure without owner or admin access", async () => {
  const previous = process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
  process.env.INSTINCT_OWNER_LOGIN_TENANT_ID = "8";
  try {
    const memory = memoryPorts();
    memory.sessions.set(OTHER, 8);
    memory.sessions.set("d".repeat(64), 9);
    memory.ports.login = async (_req, _email, _password, loginTenantId) =>
      loginTenantId === 8 ? { token: OTHER } : { error: "invalid" };
    const failedAt = "2026-10-01T06:36:45.572Z";
    memory.setThread({ tenantId: 1, state: "ready", conversationId: 700,
      statusUrl: "/api/v1/conversations/700", createdAt: new Date(), updatedAt: new Date() });
    memory.setRun({ status: "failed", reason: "expert_provider_unavailable", failedAt: new Date(failedAt) });
    memory.submissions.set("legacy-receipt", {
      tenantId: 1, conversationId: 700, state: "failed", message: "Review the saved request.",
      tokenHash: "legacy-receipt", requestId: "legacy-request",
    });
    const reviewed: any[] = [];
    const ordinary: any[] = [];
    await withApp(memory, async base => {
      const { cookie } = await login(base);
      const pageResponse = await get(base, "/instinct/chat", cookie);
      const html = await pageResponse.text();
      assert.match(html, /Review terminal failure/);
      assert.match(html, /remote request may still be billed/i);
      assert.match(html, /partial work may already have happened/i);
      assert.match(html, /name="acknowledgeRemoteUncertainty" value="yes"/);
      assert.doesNotMatch(html, /\/admin\/instinct-recovery/);
      assert.doesNotMatch(html, /Acknowledge failure and resume conversation/);
      const form = {
        action: "review_uncertain", csrf: csrfFrom(html), conversationId: "700", failedAt,
        recovery: valueFrom(html, "recovery"),
      };
      assert.equal((await post(base, "/instinct/chat", cookie, base, form)).status, 400,
        "remote uncertainty, billing, and partial-work consent is mandatory");
      assert.equal((await post(base, "/instinct/chat", cookie, base,
        { ...form, acknowledgeRemoteUncertainty: "yes", csrf: "bad" })).status, 403);
      assert.equal((await post(base, "/instinct/chat", cookie, base,
        { ...form, acknowledgeRemoteUncertainty: "yes", recovery: "bad" })).status, 403);
      assert.equal((await post(base, "/instinct/chat", cookie, base,
        { ...form, acknowledgeRemoteUncertainty: "yes", failedAt: "2026-10-01T06:37:00.000Z" })).status, 403);
      assert.equal((await post(base, "/instinct/chat", `instinct_session=${"d".repeat(64)}`, base,
        { ...form, acknowledgeRemoteUncertainty: "yes" })).status, 403,
      "an authenticated wrong principal cannot use the designated account's review form");
      assert.equal((await post(base, "/instinct/chat", cookie, base,
        { ...form, acknowledgeRemoteUncertainty: "yes", conversationId: "701" })).status, 403);
      const acknowledged = await post(base, "/instinct/chat", cookie, base,
        { ...form, acknowledgeRemoteUncertainty: "yes" });
      assert.equal(acknowledged.status, 303);
      assert.deepEqual(reviewed, [[1, 700, failedAt, 8]]);
      assert.deepEqual(ordinary, [], "legacy uncertainty never enters the routine settled helper");
      assert.equal(memory.launches.length, 0);
      assert.equal(memory.dispatchCalls.length, 0);
      assert.equal(memory.submissions.get("legacy-receipt").state, "failed");
      assert.equal((await get(base, "/api/admin/instinct-recovery", cookie)).status, 404);
      const ownerOnlyRoute = await get(base, "/admin/instinct-recovery", cookie);
      assert.notEqual(ownerOnlyRoute.status, 200, "the designated login does not become a platform owner");
    }, {
      ...memory.ports,
      async resumeFailedTurn(...args: any[]) { ordinary.push(args); return "blocked"; },
      async reviewUncertainFailedTurn(...args: any[]) {
        reviewed.push(args);
        return "resumed";
      },
    } as any);
  } finally {
    if (previous === undefined) delete process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
    else process.env.INSTINCT_OWNER_LOGIN_TENANT_ID = previous;
  }
});

test("an acknowledgement storage error is visible and never launches a replacement turn", async () => {
  const memory = memoryPorts();
  const failedAt = "2026-10-01T06:36:45.572Z";
  memory.setThread({ tenantId: 1, state: "ready", conversationId: 700,
    statusUrl: "/api/v1/conversations/700", createdAt: new Date(), updatedAt: new Date() });
  memory.setRun({ status: "failed", reason: "expert_provider_rejected", failedAt: new Date(failedAt) });
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    const html = await (await get(base, "/instinct/chat", cookie)).text();
    const response = await post(base, "/instinct/chat", cookie, base, {
      action: "resume", csrf: csrfFrom(html), conversationId: "700", failedAt,
      recovery: valueFrom(html, "recovery"), acknowledge: "yes",
    });
    assert.equal(response.status, 503);
    assert.match(await response.text(), /Could not confirm recovery/);
    assert.equal(memory.launches.length, 0);
    assert.equal(memory.dispatchCalls.length, 0);
  }, { ...memory.ports, async resumeFailedTurn() { throw new Error("synthetic storage failure"); } });
});

test("a missing saved API-v1 thread requires explicit replacement and preserves its old numeric ID", async () => {
  const memory = memoryPorts();
  memory.setThread({
    tenantId: 1, state: "ready", conversationId: 999, statusUrl: "/api/v1/conversations/999",
    createdAt: new Date(), updatedAt: new Date(),
  });
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    const missing = await get(base, "/instinct/chat", cookie);
    const html = await missing.text();
    assert.match(html, /Saved conversation 999 is no longer a valid API-v1 thread/);
    assert.match(html, /Explicitly open a replacement Felix thread/);
    assert.equal(memory.dispatchCalls.length, 0);
    const replaced = await post(base, "/instinct/chat", cookie, base, {
      action: "replace", csrf: csrfFrom(html), submission: valueFrom(html, "submission"),
    });
    assert.equal(replaced.status, 303);
    assert.equal(memory.getThread().previousConversationId, 999);
    const current = await get(base, "/instinct/chat", cookie);
    const currentHtml = await current.text();
    assert.match(currentHtml, /Conversation ID: <strong>700<\/strong>/);
    assert.match(currentHtml, /Previous conversation: 999/);
  });
});
const post = (base: string, path: string, cookie: string, origin: string, data: Record<string, string>) =>
  fetch(base + path, {
    method: "POST", redirect: "manual", headers: {
      cookie, ...(origin ? { origin } : {}), "content-type": "application/x-www-form-urlencoded",
    }, body: new URLSearchParams(data),
  });
function csrfFrom(html: string) {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  assert.ok(match, "form has CSRF token");
  return match[1];
}
function valueFrom(html: string, name: string) {
  const match = new RegExp(`name="${name}" value="([^"]+)"`).exec(html);
  assert.ok(match, `form has ${name}`);
  return match[1];
}
function cookieFrom(response: Response, name: string) {
  const cookies = response.headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  const found = cookies.find(cookie => cookie.startsWith(`${name}=`));
  assert.ok(found, `${name} cookie is set`);
  return found.split(";")[0];
}
async function login(base: string) {
  const form = await get(base, "/instinct/login");
  const html = await form.text();
  const loginCookie = cookieFrom(form, "instinct_login_csrf");
  const nonce = loginCookie.slice(loginCookie.indexOf("=") + 1);
  const result = await post(base, "/instinct/login", loginCookie, base, {
    email: "owner@example.test", password: "secret-password", csrf: csrfFrom(html),
  });
  return { result, cookie: cookieFrom(result, "instinct_session"), nonce };
}

test("a designated login account reaches only the owner's restricted channel without becoming an owner session", async () => {
  const previous = process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
  process.env.INSTINCT_OWNER_LOGIN_TENANT_ID = "8";
  try {
    const memory = memoryPorts();
    memory.sessions.set(OTHER, 8);
    memory.sessions.set("c".repeat(64), 3);
    const resourceScopes: number[] = [];
    const originalOutbox = memory.ports.outbox;
    memory.ports.outbox = async (tenantId, before) => {
      resourceScopes.push(tenantId);
      return originalOutbox(tenantId, before);
    };
    memory.ports.login = async (_req, email, password, loginTenantId) =>
      loginTenantId === 8 && email.toLowerCase().trim() === "approved@example.test" && password === "synthetic-password"
        ? { token: OTHER } : { error: "invalid" };
    await withApp(memory, async base => {
      const form = await get(base, "/instinct/login");
      const nonceCookie = cookieFrom(form, "instinct_login_csrf");
      const credentials = {
        email: "Approved@example.test", password: "synthetic-password", csrf: csrfFrom(await form.text()),
      };
      assert.equal((await post(base, "/instinct/login", nonceCookie, base,
        { ...credentials, password: "wrong" })).status, 403);
      assert.equal((await post(base, "/instinct/login", nonceCookie, base,
        { ...credentials, email: "unapproved@example.test" })).status, 403);
      const result = await post(base, "/instinct/login", nonceCookie, base, credentials);
      assert.equal(result.status, 303, "the designated account can authenticate");
      const sessionCookie = cookieFrom(result, "instinct_session");
      assert.equal(memory.sessions.get(OTHER), 8, "the shared auth session keeps its actual account identity");
      assert.equal((await get(base, "/instinct/login", sessionCookie)).status, 303);
      const chat = await get(base, "/instinct/chat", sessionCookie);
      assert.equal(chat.status, 200);
      const data = { action: "open", tenantId: "3", _tenantId: "8", submission: valueFrom(await chat.clone().text(), "submission"),
        csrf: csrfFrom(await chat.text()) };
      assert.equal((await post(base, "/instinct/chat", sessionCookie, "null", data)).status, 403);
      assert.equal((await post(base, "/instinct/chat", sessionCookie, base, { ...data, csrf: "bad" })).status, 403);
      assert.equal((await post(base, "/instinct/chat", sessionCookie, base, data)).status, 303);
      assert.equal(memory.dispatchCalls[0].tenantId, 1, "business work remains in the owner resource scope");
      memory.setRun({ status: "complete", updatedAt: new Date() });
      const draftForm = await get(base, "/instinct/chat", sessionCookie);
      const draftHtml = await draftForm.text();
      const draftData = { action: "send", message: "Help develop a business opportunity from our existing products.",
        submission: valueFrom(draftHtml, "submission"), csrf: csrfFrom(draftHtml) };
      assert.equal((await post(base, "/instinct/chat", sessionCookie, base, draftData)).status, 303);
      assert.equal(memory.launches[0].tenantId, 1, "opportunity drafting stays in the owner resource scope");
      assert.equal((await get(base, "/instinct/outbox", sessionCookie)).status, 200);
      assert.deepEqual(resourceScopes, [1]);
      for (const route of ["/instinct/login", "/instinct/chat", "/instinct/outbox"])
        for (const token of [OWNER, "c".repeat(64)])
          assert.equal((await get(base, route, `instinct_session=${token}`)).status, 403, "other account sessions stay excluded");
      const current = await get(base, "/instinct/chat", sessionCookie);
      assert.equal((await post(base, "/instinct/logout", sessionCookie, base,
        { csrf: csrfFrom(await current.text()) })).status, 303);
      assert.equal(memory.sessions.has(OTHER), false);
      assert.equal((await get(base, "/instinct/chat", sessionCookie)).status, 303);
    });
  } finally {
    if (previous === undefined) delete process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
    else process.env.INSTINCT_OWNER_LOGIN_TENANT_ID = previous;
  }
});

test("malformed private login bindings fail closed before credential or owner-resource access", async () => {
  const previous = process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
  delete process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
  try {
    const memory = memoryPorts();
    memory.ports.login = async () => { throw new Error("invalid configuration must not attempt authentication"); };
    memory.ports.getThread = async () => { throw new Error("invalid configuration must not read owner resources"); };
    await withApp(memory, async base => {
      const form = await get(base, "/instinct/login");
      const loginCookie = cookieFrom(form, "instinct_login_csrf");
      const credentials = { email: "approved@example.test", password: "synthetic-password", csrf: csrfFrom(await form.text()) };
      for (const raw of ["", "0", "-1", "8tail", "1.5", " 8", "8e0", "9007199254740992"]) {
        process.env.INSTINCT_OWNER_LOGIN_TENANT_ID = raw;
        for (const route of ["/instinct/login", "/instinct/chat", "/instinct/outbox"])
          assert.equal((await get(base, route, `instinct_session=${OWNER}`)).status, 503, raw);
        assert.equal((await post(base, "/instinct/login", loginCookie, base, credentials)).status, 503, raw);
        for (const route of ["/instinct/chat", "/instinct/logout"])
          assert.equal((await post(base, route, `instinct_session=${OWNER}`, base, {})).status, 503, raw);
      }
    });
  } finally {
    if (previous === undefined) delete process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
    else process.env.INSTINCT_OWNER_LOGIN_TENANT_ID = previous;
  }
});

test("Instinct form pages preserve the browser's Origin without exposing referrer paths or query strings", async () => {
  await withApp(memoryPorts(), async base => {
    const form = await get(base, "/instinct/login");
    assert.equal(form.headers.get("referrer-policy"), "strict-origin");
    const { cookie } = await login(base);
    const chat = await get(base, "/instinct/chat", cookie);
    assert.equal(chat.headers.get("referrer-policy"), "strict-origin");
  });
});

test("HTTP login uses password-manager fields, signed pre-auth CSRF, Origin checking, and retryable errors", async () => {
  const memory = memoryPorts();
  memory.setWrongPassword(true);
  await withApp(memory, async base => {
    const form = await get(base, "/instinct/login");
    const html = await form.text();
    assert.match(html, /id="instinct-email" name="email" type="email" autocomplete="username"/);
    assert.match(html, /id="instinct-password" name="password" type="password" autocomplete="current-password"/);
    assert.doesNotMatch(html, /secret-password|instinct_session/);
    const loginCookie = cookieFrom(form, "instinct_login_csrf");
    const csrf = csrfFrom(html);
    const badOrigin = await post(base, "/instinct/login", loginCookie, "https://attacker.invalid", {
      email: "owner@example.test", password: "secret-password", csrf,
    });
    assert.equal(badOrigin.status, 403);
    // The browser uses HTTPS at Replit's ingress even though Express receives
    // an HTTP socket after TLS termination. Same-host HTTPS must be accepted.
    const proxiedOrigin = await post(base, "/instinct/login", loginCookie,
      base.replace("http:", "https:"), {
        email: "owner@example.test", password: "wrong", csrf,
      });
    assert.equal(proxiedOrigin.status, 403, "the HTTPS origin passes CSRF and reaches credential validation");
    assert.match(await proxiedOrigin.text(), /Sign-in failed/);
    const badCredential = await post(base, "/instinct/login", loginCookie, base, {
      email: "owner@example.test", password: "wrong", csrf,
    });
    assert.equal(badCredential.status, 403);
    assert.match(await badCredential.text(), /id="instinct-email"/);
    memory.setWrongPassword(false);
    const retry = await post(base, "/instinct/login", loginCookie, base, {
      email: "owner@example.test", password: "secret-password", csrf,
    });
    assert.equal(retry.status, 303);
    assert.equal(retry.headers.get("location"), "/instinct/chat");
    const sessionCookie = cookieFrom(retry, "instinct_session");
    assert.match(retry.headers.get("set-cookie") || "", /Path=\/instinct; HttpOnly; Secure; SameSite=Lax/);
    assert.equal(sessionCookie.split("=")[1], "a".repeat(64));
  });
});

test("missing Origin accepts only a matching signed form and cookie; mismatched Origin stays blocked", async () => {
  const memory = memoryPorts();
  await withApp(memory, async base => {
    const form = await get(base, "/instinct/login");
    const html = await form.text();
    const cookie = cookieFrom(form, "instinct_login_csrf");
    const csrf = csrfFrom(html);
    const data = { email: "owner@example.test", password: "secret-password", csrf };
    const missingOrigin = await post(base, "/instinct/login", cookie, "", data);
    assert.equal(missingOrigin.status, 303);
    assert.equal(missingOrigin.headers.get("location"), "/instinct/chat");
    const missingCookie = await post(base, "/instinct/login", "", "", data);
    assert.equal(missingCookie.status, 403);
    const foreignOrigin = await post(base, "/instinct/login", cookie, "https://attacker.invalid", data);
    assert.equal(foreignOrigin.status, 403);
    const opaqueOrigin = await post(base, "/instinct/login", cookie, "null", data);
    assert.equal(opaqueOrigin.status, 403, "opaque origins are not made trusted by a valid CSRF token");
    const sessionCookie = cookieFrom(missingOrigin, "instinct_session");
    const chat = await get(base, "/instinct/chat", sessionCookie);
    const chatHtml = await chat.text();
    const chatData = {
      action: "open", submission: valueFrom(chatHtml, "submission"), csrf: csrfFrom(chatHtml),
    };
    const foreignChat = await post(base, "/instinct/chat", sessionCookie, "https://attacker.invalid", chatData);
    assert.equal(foreignChat.status, 403);
    assert.equal((await post(base, "/instinct/chat", sessionCookie, "null", chatData)).status, 403);
    const badCsrfChat = await post(base, "/instinct/chat", sessionCookie, "", { ...chatData, csrf: "invalid" });
    assert.equal(badCsrfChat.status, 403);
    const opening = await post(base, "/instinct/chat", sessionCookie, "", chatData);
    assert.equal(opening.status, 303);
    const current = await get(base, "/instinct/chat", sessionCookie);
    const logoutData = { csrf: csrfFrom(await current.text()) };
    assert.equal((await post(base, "/instinct/logout", sessionCookie, "null", logoutData)).status, 403);
    const signedOut = await post(base, "/instinct/logout", sessionCookie, "", logoutData);
    assert.equal(signedOut.status, 303);
    assert.equal((await get(base, "/instinct/chat", sessionCookie)).status, 303);
  });
});

test("signed-out redirects and authenticated non-owner is denied on reads and writes", async () => {
  const memory = memoryPorts();
  await withApp(memory, async base => {
    const signedOut = await get(base, "/instinct/chat");
    assert.equal(signedOut.status, 303);
    assert.equal(signedOut.headers.get("location"), "/instinct/login");
    const nonOwner = `instinct_session=${OTHER}`;
    for (const route of ["/instinct/chat", "/instinct/outbox"]) {
      const response = await get(base, route, nonOwner);
      assert.equal(response.status, 403);
    }
    const csrf = "invalid";
    const deniedPost = await post(base, "/instinct/logout", nonOwner, base, { csrf });
    assert.equal(deniedPost.status, 403);
  });
});

test("logout is same-origin CSRF-protected and revokes the DB-session adapter", async () => {
  const memory = memoryPorts();
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    const chat = await get(base, "/instinct/chat", cookie);
    const html = await chat.text();
    const logoutForm = /<form method="post" action="\/instinct\/logout">([\s\S]*?)<\/form>/.exec(html);
    assert.ok(logoutForm);
    const csrf = /name="csrf" value="([^"]+)"/.exec(logoutForm[1])?.[1];
    assert.ok(csrf);
    const signedOut = await post(base, "/instinct/logout", cookie, base, { csrf });
    assert.equal(signedOut.status, 303);
    assert.equal((await get(base, "/instinct/chat", cookie)).status, 303);
  });
});

test("new durable web tables are declared in Drizzle and no startup DDL remains", () => {
  const schema = readFileSync(path.join(process.cwd(), "shared/schema.ts"), "utf8");
  const channel = readFileSync(path.join(process.cwd(), "server/instinct-web-channel.ts"), "utf8");
  assert.match(schema, /instinctWebThreads = pgTable\("instinct_web_threads"/);
  assert.match(schema, /instinctWebSubmissions = pgTable\("instinct_web_submissions"/);
  assert.match(schema, /instinct_web_submissions_message_size/);
  assert.match(schema, /instinct_web_threads_state_check/);
  assert.doesNotMatch(channel, /CREATE TABLE|CREATE INDEX|ensureTables/);
  const maintenance = readFileSync(path.join(process.cwd(), "server/spark-line.ts"), "utf8");
  assert.doesNotMatch(maintenance, /DELETE FROM instinct_web_submissions/i,
    "old browser form receipts must outlive outbox retention to prevent repeat spend");
  const migration = readFileSync(path.join(process.cwd(), "migrations/0113_instinct_web_channel.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS instinct_web_threads/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS instinct_web_submissions/);
});

test("opening is explicit, fixed-text, API-v1 dispatched once, pending, replay safe, and restart durable", async () => {
  const memory = memoryPorts();
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    const before = await get(base, "/instinct/chat", cookie);
    const openingForm = await before.text();
    assert.equal(memory.dispatchCalls.length, 0, "GET never dispatches");
    assert.match(openingForm, /Open Felix thread/);
    assert.match(openingForm, /This is Instinct Bot opening our private coordination thread/);
    assert.doesNotMatch(openingForm, /<textarea\b/, "opening text is fixed, not caller supplied");
    const csrf = csrfFrom(openingForm);
    const submission = valueFrom(openingForm, "submission");
    const concurrent = await Promise.all([
      post(base, "/instinct/chat", cookie, base, { action: "open", csrf, submission }),
      post(base, "/instinct/chat", cookie, base, { action: "open", csrf, submission }),
    ]);
    assert.deepEqual(concurrent.map(response => response.status), [303, 303]);
    assert.equal(memory.dispatchCalls.length, 1);
    assert.equal(memory.dispatchCalls[0].task, INSTINCT_OPENING_TEXT);
    assert.equal(memory.dispatchCalls[0].agent, "Felix");
    assert.equal(memory.dispatchCalls[0].async, true);
    assert.equal(memory.dispatchCalls[0].tenantId, 1);
    assert.equal(memory.getThread().conversationId, 700);
    const replay = await post(base, "/instinct/chat", cookie, base, { action: "open", csrf, submission });
    assert.equal(replay.status, 303);
    assert.equal(memory.dispatchCalls.length, 1);
  });
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    const afterRestart = await get(base, "/instinct/chat", cookie);
    const html = await afterRestart.text();
    assert.match(html, /Conversation ID: <strong>700<\/strong>/);
    assert.match(html, /Turn status: <strong>running<\/strong>/);
    assert.match(html, /Refresh status/);
    assert.match(html, /Felix is working on your message/);
    assert.doesNotMatch(html, /owner review is required|earlier submission is uncertain/i);
    assert.equal(memory.dispatchCalls.length, 1);
  });
});

test("an uncertain opening reservation remains blocked across reload and never retries dispatch", async () => {
  const memory = memoryPorts();
  let dispatchAttempts = 0;
  const ports: Partial<InstinctWebPorts> = {
    ...memory.ports,
    async dispatch() {
      dispatchAttempts++;
      throw new Error("simulated uncertain dispatch result");
    },
  };
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    const page = await get(base, "/instinct/chat", cookie);
    const html = await page.text();
    const csrf = csrfFrom(html);
    const submission = valueFrom(html, "submission");
    const uncertain = await post(base, "/instinct/chat", cookie, base, { action: "open", csrf, submission });
    assert.equal(uncertain.status, 503);
    const replay = await post(base, "/instinct/chat", cookie, base, { action: "open", csrf, submission });
    assert.equal(replay.status, 303, "identical retry resolves to its durable receipt");
    const blocked = await get(base, "/instinct/chat", cookie);
    assert.match(await blocked.text(), /opening state: blocked/i);
    assert.equal(dispatchAttempts, 1);
  }, ports);
});

test("follow-up POST is PRG/nonblocking and exact replay, mismatch, active, failed and timeout never double-dispatch", async () => {
  const memory = memoryPorts();
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    const opener = await get(base, "/instinct/chat", cookie);
    const openHtml = await opener.text();
    await post(base, "/instinct/chat", cookie, base, {
      action: "open", csrf: csrfFrom(openHtml), submission: valueFrom(openHtml, "submission"),
    });
    memory.setRun({ status: "complete", reason: null, failedAt: null, updatedAt: new Date() });
    const form = await get(base, "/instinct/chat", cookie);
    const html = await form.text();
    const csrf = csrfFrom(html);
    const submission = valueFrom(html, "submission");
    const message = "Please reply with the test receipt.";
    const sent = await Promise.all([
      post(base, "/instinct/chat", cookie, base, { action: "send", csrf, submission, message }),
      post(base, "/instinct/chat", cookie, base, { action: "send", csrf, submission, message }),
    ]);
    assert.deepEqual(sent.map(response => response.status), [303, 303]);
    assert.equal(memory.launches.length, 1, "worker is launched asynchronously after durable claim");
    const replay = await post(base, "/instinct/chat", cookie, base, { action: "send", csrf, submission, message });
    assert.equal(replay.status, 303);
    assert.equal(memory.launches.length, 1);
    const mismatch = await post(base, "/instinct/chat", cookie, base, {
      action: "send", csrf, submission, message: "different text",
    });
    assert.equal(mismatch.status, 409);
    assert.equal(memory.launches.length, 1);
    const pending = await get(base, "/instinct/chat", cookie);
    const pendingHtml = await pending.text();
    assert.match(pendingHtml, /Felix is working on your message/);
    assert.doesNotMatch(pendingHtml, /owner review is required/i);
    assert.doesNotMatch(pendingHtml, /Send to Felix<\/button>/);
    await memory.launches[0].settled("complete");
    memory.setRun({ status: "complete", reason: null, failedAt: null, updatedAt: new Date() });
    const nextPage = await get(base, "/instinct/chat", cookie);
    const nextHtml = await nextPage.text();
    assert.match(nextHtml, /Send to Felix<\/button>/, "completion re-enables conversation without another approval");
    const next = await post(base, "/instinct/chat", cookie, base, {
      action: "send", csrf: csrfFrom(nextHtml), submission: valueFrom(nextHtml, "submission"),
      message: "Review our business opportunities next.",
    });
    assert.equal(next.status, 303);
    assert.equal(memory.launches.length, 2, "a fresh follow-up starts without a permission-reset step");
    for (const status of ["running", "failed", "timeout"]) {
      memory.setRun({ status: status === "timeout" ? "failed" : status, reason: status === "timeout" ? "timeout" : status,
        failedAt: new Date(), updatedAt: new Date() });
      const blocked = await post(base, "/instinct/chat", cookie, base, {
        action: "send", csrf, submission: `${status}-` + "c".repeat(40), message: "not a second turn",
      });
      assert.equal(blocked.status, 409);
      if (status === "running") {
        assert.match(await blocked.text(), /Felix is working on your message/);
      }
    }
    assert.equal(memory.launches.length, 2);
  });
});

test("a submission abandoned before the API turn claim blocks sends after reload", async () => {
  const memory = memoryPorts();
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    const opening = await get(base, "/instinct/chat", cookie);
    const openingHtml = await opening.text();
    await post(base, "/instinct/chat", cookie, base, {
      action: "open", csrf: csrfFrom(openingHtml), submission: valueFrom(openingHtml, "submission"),
    });
    memory.setRun({ status: "complete", reason: null, failedAt: null, updatedAt: new Date() });
    memory.addUncertainSubmission(1, 700);
    const chat = await get(base, "/instinct/chat", cookie);
    assert.match(await chat.text(), /earlier submission is uncertain/);
    const rejected = await post(base, "/instinct/chat", cookie, base, {
      action: "send", csrf: csrfFrom(openingHtml), submission: "e".repeat(43), message: "No retry",
    });
    assert.equal(rejected.status, 409);
    assert.equal(memory.claims.length, 0);
    assert.equal(memory.launches.length, 0);
  });
});

test("CSRF rejects invalid tokens; history/outbox escape content, bound pagination, and honor kill switch", async () => {
  const memory = memoryPorts();
  await withApp(memory, async base => {
    const { cookie } = await login(base);
    const csrfReject = await post(base, "/instinct/logout", cookie, base, { csrf: "invalid" });
    assert.equal(csrfReject.status, 403);
    const opener = await get(base, "/instinct/chat", cookie);
    const openerHtml = await opener.text();
    await post(base, "/instinct/chat", cookie, base, {
      action: "open", csrf: csrfFrom(openerHtml), submission: valueFrom(openerHtml, "submission"),
    });
    memory.setRun({ status: "complete", reason: null, failedAt: null, updatedAt: new Date() });
    const chat = await get(base, "/instinct/chat", cookie);
    const chatHtml = await chat.text();
    assert.doesNotMatch(chatHtml, /<script>alert\(1\)<\/script>/);
    assert.match(chatHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    const badCursor = await get(base, "/instinct/chat?before=0", cookie);
    assert.equal(badCursor.status, 400);
    const outbox = await get(base, "/instinct/outbox", cookie);
    const outboxHtml = await outbox.text();
    assert.match(outboxHtml, /Outbox message 99/);
    assert.match(outboxHtml, /Felix \(persona 2\)/);
    assert.match(outboxHtml, /Conversation ID: 700/);
    assert.doesNotMatch(outboxHtml, /<img src=x onerror=alert\(1\)>/);
    assert.match(outboxHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.equal((outboxHtml.match(/<article>/g) || []).length, 50);
    assert.match(outboxHtml, /Older messages/);
    const older = await get(base, "/instinct/outbox?before=50", `instinct_session=${OWNER}`);
    assert.match(await older.text(), /Outbox message 49/);
    memory.setRun({ status: "failed", reason: "timeout", failedAt: new Date(), updatedAt: new Date() });
    const failed = await get(base, "/instinct/chat", cookie);
    assert.match(await failed.text(), /Turn status: <strong>failed<\/strong> — timeout/);
  });
  const prior = process.env.INSTINCT_LINE_ENABLED;
  process.env.INSTINCT_LINE_ENABLED = "0";
  try {
    await withApp(memory, async base => {
      const disabled = await get(base, "/instinct/outbox", `instinct_session=${OWNER}`);
      assert.equal(disabled.status, 503);
      assert.match(await disabled.text(), /disabled/i);
      const chatDisabled = await post(base, "/instinct/chat", `instinct_session=${OWNER}`, base, {
        action: "open", csrf: createInstinctCsrfToken(`session:${OWNER}`), submission: "d".repeat(43),
      });
      assert.equal(chatDisabled.status, 503);
      assert.equal(memory.dispatchCalls.length, 1, "kill switch cannot dispatch");
    });
  } finally {
    if (prior === undefined) delete process.env.INSTINCT_LINE_ENABLED;
    else process.env.INSTINCT_LINE_ENABLED = prior;
  }
});