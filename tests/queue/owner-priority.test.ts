import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createConversationQueue } from "../../server/conversation-queue";

test("customer chats cannot occupy Bob's reserved capacity or jump ahead of him", async () => {
  const queue = createConversationQueue({ maxConcurrent: 3, maxSecondary: 1, timeoutMs: 1000 });
  const customer = await queue.acquire(10, 42);
  const owner1 = await queue.acquire(11, 1);
  const owner2 = await queue.acquire(12, 1);
  let customerStarted = false;
  let ownerStarted = false;
  const nextCustomer = queue.acquire(13, 43).then(release => { customerStarted = true; return release; });
  const nextOwner = queue.acquire(14, 1).then(release => { ownerStarted = true; return release; });
  owner1();
  const releaseOwner = await nextOwner;
  assert.equal(ownerStarted, true);
  assert.equal(customerStarted, false);
  releaseOwner(); owner2(); customer();
  (await nextCustomer)();
  assert.equal(queue.stats().globalActive, 0);
});

test("anonymous public chat never receives Bob's priority even on his public widget", async () => {
  const queue = createConversationQueue({ maxConcurrent: 2, maxSecondary: 1, timeoutMs: 1000 });
  const publicRelease = await queue.acquire(20, 1, { publicAccess: true });
  let secondPublicStarted = false;
  const publicPending = queue.acquire(21, 1, { publicAccess: true })
    .then(release => { secondPublicStarted = true; return release; });
  const ownerRelease = await queue.acquire(22, 1);
  assert.equal(secondPublicStarted, false);
  ownerRelease(); publicRelease(); (await publicPending)();
  await assert.rejects(queue.acquire(23, undefined as any), /tenant/i);
});

test("tenant-scoped locks serialize one tenant's conversation, not another tenant's lane", async () => {
  const queue = createConversationQueue({ maxConcurrent: 3, maxSecondary: 2, timeoutMs: 1000 });
  const a = await queue.acquire(30, 42);
  const b = await queue.acquire(30, 43);
  a(); a(); b();
  assert.equal(queue.stats().globalActive, 0);
});

test("two customers can run together but one customer cannot take both secondary slots", async () => {
  const queue = createConversationQueue({ maxConcurrent: 4, maxSecondary: 2, timeoutMs: 1000 });
  const a = await queue.acquire(31, 42);
  const b = await queue.acquire(32, 43);
  let nextStarted = false;
  const next = queue.acquire(33, 42).then(release => { nextStarted = true; return release; });
  assert.equal(queue.stats().secondaryActive, 2);
  b();
  const owner = await queue.acquire(34, 1);
  assert.equal(nextStarted, false);
  a(); (await next)(); owner();
  assert.equal(queue.stats().globalActive, 0);
});

test("timed-out waiting work is removed without releasing the active conversation", async () => {
  const queue = createConversationQueue({ maxConcurrent: 2, maxSecondary: 1, timeoutMs: 20 });
  const active = await queue.acquire(35, 42);
  await assert.rejects(queue.acquire(35, 42), /timeout/);
  assert.equal(queue.stats().totalWaiting, 0);
  assert.equal(queue.stats().globalActive, 1);
  active(); active();
  assert.equal(queue.stats().globalActive, 0);
});

test("durable claims prefer owner jobs without rewriting tenant identity or removing lease locks", () => {
  const source = fs.readFileSync("server/job-queue.ts", "utf8");
  assert.match(source, /ORDER BY CASE WHEN tenant_id = \$\{ADMIN_TENANT_ID\} THEN 0 ELSE 1 END,\s*CASE WHEN tenant_id = \$\{ADMIN_TENANT_ID\}\s*AND kind IN \('legion_runbook_compile','surface_runbook_rule'\)\s*AND payload->>'priority'='daytime' THEN 0 ELSE 1 END,\s*next_run_at ASC, id ASC/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.doesNotMatch(source, /SET\s+tenant_id\s*=/i);
});
