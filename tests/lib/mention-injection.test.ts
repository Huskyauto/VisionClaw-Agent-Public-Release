import { test } from "node:test";
import assert from "node:assert";

// DB-free tests only (node-test-db-pool-hang: never open a real pg pool in
// lib tests). mention-injection imports db lazily inside functions, so the
// kill-switch short-circuit path is safe to exercise here.

test("kill switch: MENTION_INJECTION=off disables injection without touching the DB", async () => {
  const prev = process.env.MENTION_INJECTION;
  process.env.MENTION_INJECTION = "off";
  try {
    const { mentionInjectionEnabled, fetchRadioMessages } = await import("../../server/lib/mention-injection");
    assert.strictEqual(mentionInjectionEnabled(), false);
    const res = await fetchRadioMessages({ tenantId: 1, channelName: "test-radio", afterId: 42 });
    assert.strictEqual(res.block, "");
    assert.strictEqual(res.count, 0);
    // High-water mark must be preserved unchanged on the noop path.
    assert.strictEqual(res.lastId, 42);
  } finally {
    if (prev === undefined) delete process.env.MENTION_INJECTION;
    else process.env.MENTION_INJECTION = prev;
  }
});

test("kill switch default is ON (owner autonomy preference)", async () => {
  const prev = process.env.MENTION_INJECTION;
  delete process.env.MENTION_INJECTION;
  try {
    const { mentionInjectionEnabled } = await import("../../server/lib/mention-injection");
    assert.strictEqual(mentionInjectionEnabled(), true);
  } finally {
    if (prev !== undefined) process.env.MENTION_INJECTION = prev;
  }
});
