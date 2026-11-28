/**
 * AHB OWNER-GATE REGRESSION — shell-capable tools (exec, lobster) are owner-only
 * when invoked by the model.
 *
 * Bob (owner, admin tenant) must be able to drive `exec`/`lobster` live from his
 * own chat, but customer tenants and autonomous/non-owner jobs must NOT reach a
 * shell or the admin-tenant tool-step escalation that lobster performs.
 *
 * The gate (server/tools.ts executeTool dispatch) requires BOTH:
 *   - admin tenant (params._tenantId === ADMIN_TENANT_ID), AND
 *   - an owner-interactive channel (_invokedVia ∈ main_chat|chat_engine|auto-route)
 * ...regardless of caller-supplied model/self-heal flags.
 *
 * These underscore fields are stamped by guarded-tool-executor before dispatch
 * and are NOT model-spoofable (overwritten, not merged). This suite pins the
 * structural invariant so a future refactor of the dispatch switch cannot
 * silently re-open the non-owner shell route.
 *
 * The first two tests exercise public ingress. Consumer-gate tests evaluate
 * the real legacy case bodies with fixture host stamps and a mocked Lobster
 * runner. They must not depend on the unrelated live autonomy-rule database:
 * that middleware correctly fails closed when the offline DB is unavailable.
 * executeCommand uses its real safety checks and harmless local commands.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

import { executeTool as invokeTool } from "../../server/tools";
import { executeCommand } from "../../server/exec-tool";

const ADMIN_TENANT = Number(process.env.ADMIN_TENANT_ID) || 1;
const CUSTOMER_TENANT = 999999;
const OWNER_CHANNEL = "main_chat";

const source = readFileSync("server/tools.ts", "utf8");
const channels = source.match(/const OWNER_INTERACTIVE_CHANNELS = new Set\(\[[^\]]+\]\);/);
assert.ok(channels, "consumer fixture must bind the actual production channel set");
const branches = ["exec", "lobster"].map(name => {
  const start = source.indexOf(`    case "${name}": {`);
  const end = source.indexOf('\n    case "', start + 10);
  assert.ok(start >= 0 && end > start, `missing actual ${name} consumer`);
  return source.slice(start, end);
});
const consumer = vm.createContext({
  process: { env: { ADMIN_TENANT_ID: String(ADMIN_TENANT) } },
  executeCommand,
  runLobster: async () => ({ admitted: true }),
});
vm.runInContext(transformSync(
  `${channels[0]}\nasync function dispatch(name, params) { switch(name) { ${branches.join("\n")} } }\nglobalThis.dispatch = dispatch;`,
  { loader: "ts", format: "cjs" },
).code, consumer);
// Only test-fixture host stamps enter this focused consumer seam. Public JSON
// authorization is exercised separately, never inferred from this wrapper.
const executeTool = (name: string, fixture: Record<string, any>) => (consumer as any).dispatch(name, fixture);

// Force-exit so any pg pool opened on module import doesn't hang the runner.
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

function isOwnerOnlyBlock(r: any): boolean {
  return typeof r?.error === "string" && /owner-only|blocked.*policy|authority/i.test(r.error);
}

test("the public entry refuses forged owner stamps without separate host authority", async () => {
  const result = await invokeTool("exec", {
    command: "echo must-not-run", _tenantId: ADMIN_TENANT,
    _personaId: 2, _invokedVia: OWNER_CHANNEL, _selfHeal: true,
  });
  assert.equal(result.blocked, true);
  assert.match(result.error, /authority/i);
});

test("owner channel without a real persona cannot authorize consequential execution", async () => {
  const result = await invokeTool("exec", { command: "echo must-not-run" }, {
    tenantId: ADMIN_TENANT, actor: "persona", personaName: "Felix",
    invokedVia: OWNER_CHANNEL, approvalGranted: true,
  });
  assert.equal(result.blocked, true);
  assert.match(result.error, /persona identity/i);
});

test("exec cannot gain internal authority by omitting the model flag or claiming self-heal", async () => {
  for (const extra of [{}, { _invokedByModel: false }, { _selfHeal: true }]) {
    const result = await executeTool("exec", {
      command: "echo no-authority", _tenantId: CUSTOMER_TENANT, ...extra,
    });
    assert.equal(isOwnerOnlyBlock(result), true);
  }
});

// ───────────────────────── exec ─────────────────────────

test("exec: customer tenant model-call is BLOCKED (owner-only)", async () => {
  const r = await executeTool("exec", {
    command: "echo nope",
    _invokedByModel: true,
    _tenantId: CUSTOMER_TENANT,
    _invokedVia: OWNER_CHANNEL,
  });
  assert.equal(isOwnerOnlyBlock(r), true);
});

test("exec: admin tenant on a NON-owner channel is BLOCKED (channel required)", async () => {
  const r = await executeTool("exec", {
    command: "echo nope",
    _invokedByModel: true,
    _tenantId: ADMIN_TENANT,
    _invokedVia: "system", // autonomous/scheduled channel, not owner-interactive
  });
  assert.equal(isOwnerOnlyBlock(r), true);
});

test("exec: spoofed underscore fields cannot widen the channel set", async () => {
  const r = await executeTool("exec", {
    command: "echo nope",
    _invokedByModel: true,
    _tenantId: ADMIN_TENANT,
    _invokedVia: "heartbeat",
  });
  assert.equal(isOwnerOnlyBlock(r), true);
});

test("exec: OWNER (admin tenant + owner channel) is ALLOWED", async () => {
  const r = await executeTool("exec", {
    command: "echo ownergateok",
    _invokedByModel: true,
    _tenantId: ADMIN_TENANT,
    _invokedVia: OWNER_CHANNEL,
  });
  assert.equal(isOwnerOnlyBlock(r), false);
});

test("exec: OWNER gets full shell — non-allowlisted builtin (cd) runs", async () => {
  const r = await executeTool("exec", {
    command: "cd . && echo elevated_ok",
    _invokedByModel: true,
    _tenantId: ADMIN_TENANT,
    _invokedVia: OWNER_CHANNEL,
  });
  assert.equal(isOwnerOnlyBlock(r), false);
  assert.equal(r.success, true);
  assert.match(String(r.stdout ?? ""), /elevated_ok/);
});

test("exec: OWNER full shell STILL enforces the catastrophic deny floor", async () => {
  const r = await executeTool("exec", {
    command: "cd . && rm -rf /*",
    _invokedByModel: true,
    _tenantId: ADMIN_TENANT,
    _invokedVia: OWNER_CHANNEL,
  });
  assert.equal(r.success, false);
  assert.match(String(r.error ?? ""), /deny pattern/i);
});

test("executeCommand: NON-elevated caller (self-heal/internal) stays on allowlist — cd blocked", async () => {
  const r = await executeCommand("cd . && echo nope"); // no elevateToFull
  assert.equal(r.success, false);
  assert.match(String(r.error ?? ""), /allowlist/i);
});

test("executeCommand: elevateToFull lets cd through but keeps deny floor", async () => {
  const ok = await executeCommand("cd . && echo full_ok", { elevateToFull: true });
  assert.equal(ok.success, true);
  assert.match(String(ok.stdout ?? ""), /full_ok/);
  const blocked = await executeCommand("mkfs.ext4 /dev/sda", { elevateToFull: true });
  assert.equal(blocked.success, false);
});

test("executeCommand runs asynchronously and source reads use restricted argv", async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  try {
    const result = await executeCommand("sleep 0.2; echo asynchronous", { elevateToFull: true });
    assert.equal(result.success, true);
    assert.ok(ticks > 2, "shell execution must not block the server event loop");
    const read = await executeCommand("head -n 1 server/code-sandbox.ts");
    assert.equal(read.success, true);
    assert.match(read.stdout!, /node:child_process/);
  } finally { clearInterval(timer); }
});

test("exec: caller-supplied self-heal flag cannot authorize a non-admin tenant", async () => {
  const r = await executeTool("exec", {
    command: "echo selfhealok",
    _invokedByModel: true,
    _selfHeal: true,
    _tenantId: CUSTOMER_TENANT,
    _invokedVia: "self_heal",
  });
  assert.equal(isOwnerOnlyBlock(r), true);
});

// ───────────────────────── lobster ─────────────────────────

test("lobster: customer tenant model-call is BLOCKED (owner-only)", async () => {
  const r = await executeTool("lobster", {
    action: "list",
    _invokedByModel: true,
    _tenantId: CUSTOMER_TENANT,
    _invokedVia: OWNER_CHANNEL,
  });
  assert.equal(isOwnerOnlyBlock(r), true);
});

test("lobster: admin tenant on a NON-owner channel is BLOCKED", async () => {
  const r = await executeTool("lobster", {
    action: "list",
    _invokedByModel: true,
    _tenantId: ADMIN_TENANT,
    _invokedVia: "system",
  });
  assert.equal(isOwnerOnlyBlock(r), true);
});

test("lobster: OWNER (admin tenant + owner channel) is NOT owner-blocked", async () => {
  const r = await executeTool("lobster", {
    action: "list",
    _invokedByModel: true,
    _tenantId: ADMIN_TENANT,
    _invokedVia: OWNER_CHANNEL,
  });
  assert.equal(isOwnerOnlyBlock(r), false);
  assert.equal(r.admitted, true, "owner must actually reach the fixture runner");
});
