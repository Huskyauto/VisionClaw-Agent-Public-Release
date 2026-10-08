import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyWorkspaceHandback, workspaceTabs } from "../../server/lib/browser-workspace-remote";

test("expired target can be handed back only after typed 404 and a fresh empty list of the exact scope", async () => {
  const calls: any[] = [];
  const target = { personaId: 5, tabId: "gone", userIdSuffix: "private" };
  const result = await verifyWorkspaceHandback(71, target, async params => {
    calls.push(params);
    return params.action === "snapshot"
      ? { ok: false, action: "snapshot", engine: "camofox", statusCode: 404 }
      : { ok: true, action: "list_tabs", engine: "camofox", tabs: [] };
  });
  assert.equal(result, "expired");
  assert.deepEqual(calls.map(p => [p._tenantId, p._personaId, p.userIdSuffix, p.action]),
    [[71, 5, "private", "snapshot"], [71, 5, "private", "list_tabs"]]);
});

test("outages, auth rejection and untyped errors cannot trigger empty-session handback", async () => {
  for (const statusCode of [undefined, 401, 403, 429, 500, 502, 503]) {
    let calls = 0;
    await assert.rejects(verifyWorkspaceHandback(71, { personaId: 5, tabId: "old" }, async () => {
      calls++; return { ok: false, action: "snapshot", engine: "camofox", statusCode };
    }), /could not be verified/);
    assert.equal(calls, 1);
  }
});

test("successful fresh page keeps its target and does not perform a second read", async () => {
  let calls = 0;
  assert.equal(await verifyWorkspaceHandback(71, { personaId: 5, tabId: "active" }, async () => {
    calls++; return { ok: true, action: "snapshot", engine: "camofox", snapshot: "fresh page" };
  }), undefined);
  assert.equal(calls, 1);
});

test("malformed lists and remaining tabs never count as verified absence", async () => {
  for (const tabs of [undefined, {}, [null], [{ title: "unknown" }], [{ tabId: "../bad" }], [{ tabId: "other" }]]) {
    await assert.rejects(verifyWorkspaceHandback(71, { personaId: 5, tabId: "old" }, async p =>
      p.action === "snapshot" ? { ok: false, action: "snapshot", engine: "camofox", statusCode: 404 }
        : { ok: true, action: "list_tabs", engine: "camofox", tabs: tabs as any }));
  }
  assert.throws(() => workspaceTabs({ ok: false, action: "list_tabs", engine: "camofox", tabs: [] }));
  assert.throws(() => workspaceTabs({ ok: true, action: "list_tabs", engine: "camofox", tabs: Array(513).fill({ tabId: "a" }) }));
});