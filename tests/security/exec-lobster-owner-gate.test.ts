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
 * ...when the call is model-driven (_invokedByModel === true) and not self-heal.
 *
 * These underscore fields are stamped by guarded-tool-executor before dispatch
 * and are NOT model-spoofable (overwritten, not merged). This suite pins the
 * structural invariant so a future refactor of the dispatch switch cannot
 * silently re-open the non-owner shell route.
 *
 * Runs offline (no LLM, no network). Block paths return early with no DB I/O.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { executeTool } from "../../server/tools";
import { executeCommand } from "../../server/exec-tool";

const ADMIN_TENANT = Number(process.env.ADMIN_TENANT_ID) || 1;
const CUSTOMER_TENANT = 999999;
const OWNER_CHANNEL = "main_chat";

// Force-exit so any pg pool opened on module import doesn't hang the runner.
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

function isOwnerOnlyBlock(r: any): boolean {
  return typeof r?.error === "string" && /owner-only/i.test(r.error);
}

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

test("exec: self-heal escape hatch is honored even for non-admin tenant", async () => {
  const r = await executeTool("exec", {
    command: "echo selfhealok",
    _invokedByModel: true,
    _selfHeal: true,
    _tenantId: CUSTOMER_TENANT,
    _invokedVia: "self_heal",
  });
  assert.equal(isOwnerOnlyBlock(r), false);
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
  let r: any;
  try {
    r = await executeTool("lobster", {
      action: "list",
      _invokedByModel: true,
      _tenantId: ADMIN_TENANT,
      _invokedVia: OWNER_CHANNEL,
    });
  } catch {
    // A runtime error inside runLobster is fine — we only assert the gate did
    // not short-circuit with the owner-only refusal.
    r = {};
  }
  assert.equal(isOwnerOnlyBlock(r), false);
});
