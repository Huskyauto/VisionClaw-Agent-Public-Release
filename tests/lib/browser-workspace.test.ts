import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceCoordinator, initialWorkspaceState, pageElements, parseWorkspaceState, snapshotDigest, isWorkspaceHumanAction } from "../../server/lib/browser-workspace";
import { randomUUID } from "node:crypto";

function fixture() {
  let state = initialWorkspaceState(7);
  let busy = false;
  const store = { exclusive: async (_tid: number, fn: any) => {
    if (busy) throw new Error("busy");
    busy = true;
    try { return await fn({ read: async () => structuredClone(state),
      write: async (next: any) => { state = structuredClone(next); } }); }
    finally { busy = false; }
  } };
  return { workspace: new WorkspaceCoordinator(store), state: () => structuredClone(state) };
}

test("human takeover blocks agent browser execution and survives a new coordinator", async () => {
  let state = initialWorkspaceState(7);
  const store = { exclusive: async (_tid: number, fn: any) => fn({
    read: async () => structuredClone(state),
    write: async (next: any) => { state = structuredClone(next); },
  }) };
  const workspace = new WorkspaceCoordinator(store);
  await workspace.control(7, "take", 0, "00000000-0000-4000-8000-000000000001");
  let called = false;
  await assert.rejects(
    new WorkspaceCoordinator(store).agent(7, { action: "click", tabId: "tab-a" }, async () => { called = true; }),
    /human control/i,
  );
  assert.equal(called, false);
  assert.equal(state.mode, "human");
});

test("phone controls recognize both ref= and bracketed Camofox element identifiers", () => {
  assert.deepEqual(pageElements('- link "More information" [e1]\n- textbox "Email" [ref=e2]'), [
    { ref: "e1", role: "link", label: "More information" },
    { ref: "e2", role: "textbox", label: "Email" },
  ]);
});

test("ambiguous human action cannot be repeated by retrying its operation identity", async () => {
  const f = fixture();
  await f.workspace.control(7, "take", 0, randomUUID());
  let effects = 0;
  const id = randomUUID();
  await assert.rejects(f.workspace.human(7, 1, id, "click", async () => {}, async () => {
    effects++; throw new Error("network lost after click");
  }), /network lost/);
  const retried = await f.workspace.human(7, 1, id, "click", async () => {}, async () => { effects++; });
  assert.equal(retried.replayed, true);
  assert.equal(retried.state.lastOutcome, "uncertain");
  assert.equal(effects, 1);
  await assert.rejects(f.workspace.human(7, 1, randomUUID(), "click", async () => {}, async () => { effects++; }), /state changed/);
});

test("failed handback leaves durable human control unchanged", async () => {
  const f = fixture();
  await f.workspace.control(7, "take", 0, randomUUID());
  await assert.rejects(f.workspace.control(7, "return", 1, randomUUID(), async () => {
    throw new Error("snapshot unavailable");
  }), /snapshot unavailable/);
  assert.equal(f.state().mode, "human");
  assert.equal(f.state().revision, 1);
});

test("explicit verified-empty handback clears the expired target without relaxing agent freshness", async () => {
  const f = fixture();
  await f.workspace.control(7, "take", 0, randomUUID());
  await f.workspace.view(7, { personaId: 5, tabId: "expired" }, async () => ({ snapshot: "old page" }));
  await f.workspace.control(7, "return", 1, randomUUID(), async target => {
    assert.equal(target?.tabId, "expired");
    return "expired" as const;
  });
  assert.equal(f.state().mode, "agent");
  assert.equal(f.state().target, null);
  assert.equal(f.state().requireFresh, true);
  await assert.rejects(f.workspace.agent(7, { action: "click", tabId: "new", _personaId: 5 },
    async () => ({ ok: true })), /fresh snapshot/);
});

test("newly opened human tab binds its server-validated persona before the first view", async () => {
  const f = fixture();
  await f.workspace.control(7, "take", 0, randomUUID());
  await f.workspace.human(7, 1, randomUUID(), "open", async () => {},
    async () => ({ ok: true, tabId: "new-tab" }), { personaId: 5, userIdSuffix: "work" });
  assert.deepEqual(f.state().target, { personaId: 5, userIdSuffix: "work", tabId: "new-tab" });
});

test("failed or malformed human opens preserve the old target and cannot be replayed as success", async () => {
  for (const result of [{ ok: false, tabId: "new-tab" }, { ok: true, tabId: "../bad" }]) {
    const f = fixture();
    const oldTarget = { personaId: 1, tabId: "old" };
    await f.workspace.control(7, "take", 0, randomUUID());
    await f.workspace.view(7, oldTarget, async () => ({ snapshot: "page" }));
    const id = randomUUID();
    const open = () => f.workspace.human(7, 1, id, "open", async () => {},
      async () => result, { personaId: 5 });
    if (result.ok) await assert.rejects(open(), /could not be identified/);
    else await open();
    assert.deepEqual(f.state().target, oldTarget);
    assert.equal(f.state().mode, "human");
    assert.equal(f.state().lastOutcome, "uncertain");
    const replay = await open();
    assert.equal(replay.replayed, true);
    assert.equal(replay.result, null);
  }
});

test("confirmed close of the selected last tab clears its handback target", async () => {
  const f = fixture();
  await f.workspace.control(7, "take", 0, randomUUID());
  await f.workspace.view(7, { personaId: 1, tabId: "last-tab" }, async () => ({ snapshot: "page" }));
  await f.workspace.human(7, 1, randomUUID(), "close_tab", async () => {}, async () => ({ ok: true }));
  assert.equal(f.state().target, null);
  await f.workspace.control(7, "return", 2, randomUUID(), async target => assert.equal(target, null));
  assert.equal(f.state().mode, "agent");
});

test("handback fences stale agent actions until a fresh snapshot of the exact persona/tab", async () => {
  const f = fixture();
  await f.workspace.control(7, "take", 0, randomUUID());
  await f.workspace.control(7, "return", 1, randomUUID(), async () => {});
  const action = { action: "click", tabId: "tab-a", _personaId: 1 };
  await assert.rejects(f.workspace.agent(7, action, async () => ({ ok: true })), /fresh snapshot/);
  await f.workspace.agent(7, { ...action, action: "snapshot" }, async () => ({ ok: true }));
  await f.workspace.agent(7, action, async () => ({ ok: true }));
  await assert.rejects(f.workspace.agent(7, { ...action, _personaId: 2 }, async () => ({ ok: true })), /fresh snapshot/);
  await assert.rejects(f.workspace.agent(7, { ...action, userIdSuffix: "other" }, async () => ({ ok: true })), /fresh snapshot/);
  await assert.rejects(f.workspace.agent(7, { action: "close_session" }, async () => ({ ok: true })), /entire session/);
});

test("takeover cannot race past an in-flight agent action", async () => {
  const f = fixture();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const action = f.workspace.agent(7, { action: "click" }, async () => { await gate; return { ok: true }; });
  await assert.rejects(f.workspace.control(7, "take", 0, randomUUID()), /busy/);
  finish(); await action;
  await f.workspace.control(7, "take", 0, randomUUID());
  assert.equal(f.state().mode, "human");
});

test("stale page verification fails before committing or performing a human effect", async () => {
  const f = fixture();
  await f.workspace.control(7, "take", 0, randomUUID());
  let called = false;
  await assert.rejects(f.workspace.human(7, 1, randomUUID(), "type", async () => {
    throw new Error("page changed");
  }, async () => { called = true; }), /page changed/);
  assert.equal(called, false);
  assert.equal(f.state().revision, 1);
});

test("stored malformed or cross-tenant control cannot silently restore agent authority", () => {
  assert.deepEqual(parseWorkspaceState(initialWorkspaceState(7), 7), initialWorkspaceState(7));
  for (const value of [null, {}, { ...initialWorkspaceState(7), mode: "unknown" },
    { ...initialWorkspaceState(7), requireFresh: "false" }, initialWorkspaceState(8)]) {
    assert.throws(() => parseWorkspaceState(value, 7), /remain blocked/);
  }
});

test("human actor exists only inside server-owned context; page digests bind identity and bytes", async () => {
  const f = fixture();
  assert.equal(isWorkspaceHumanAction(7), false);
  await f.workspace.inspect(7, async () => {
    assert.equal(isWorkspaceHumanAction(7), true);
    assert.equal(isWorkspaceHumanAction(8), false);
  });
  assert.equal(isWorkspaceHumanAction(7), false);
  const target = { personaId: 1, tabId: "a" };
  assert.notEqual(snapshotDigest(target, "page"), snapshotDigest({ ...target, personaId: 2 }, "page"));
  assert.notEqual(snapshotDigest(target, "page"), snapshotDigest(target, "changed"));
});