import assert from "node:assert/strict";
import test from "node:test";
import { deliverEmailChannel, getEmailChannelStatus } from "../../server/lib/email-channel-delivery";

test("email delivery uses the tenant's Gmail transport and returns its receipt", async () => {
  const calls: unknown[][] = [];
  const result = await deliverEmailChannel(7, "recipient@example.test", "Report\nPlain <b>text</b> & details", async (...args) => {
    calls.push(args);
    return { id: "gmail-receipt" };
  });
  assert.deepEqual(result, { success: true, channel: "email", messageId: "gmail-receipt" });
  assert.deepEqual(calls, [[7, "recipient@example.test", "Report", "Report<br>Plain &lt;b&gt;text&lt;/b&gt; &amp; details"]]);
});

test("email delivery fails closed without a trusted positive tenant", async () => {
  let calls = 0;
  for (const tenant of [null, undefined, 0, -1, NaN, 1.5, "1"]) {
    const result = await deliverEmailChannel(tenant as any, "recipient@example.test", "Report", async () => {
      calls++;
      return { id: "wrong-tenant" };
    });
    assert.equal(result.success, false);
    assert.equal(result.uncertain, undefined);
  }
  assert.equal(calls, 0);
});

test("concurrent email deliveries retain their independent tenant identities", async () => {
  const calls: number[] = [];
  await Promise.all([7, 8].map(tenant => deliverEmailChannel(tenant, "recipient@example.test", "Report", async actualTenant => {
    await Promise.resolve();
    calls.push(actualTenant);
    return { id: `receipt-${actualTenant}` };
  })));
  assert.deepEqual(calls.sort(), [7, 8]);
});

test("missing receipts and transport errors report uncertain acceptance, not success", async () => {
  for (const sender of [
    async () => ({}),
    async () => ({ id: "" }),
    async () => { throw new Error("private-provider-error"); },
  ]) {
    const result = await deliverEmailChannel(7, "recipient@example.test", "Report", sender);
    assert.equal(result.success, false);
    assert.equal(result.uncertain, true);
    assert.doesNotMatch(result.error!, /private-provider-error/);
  }
});

test("email configuration is checked through the actual tenant connection, not legacy env names", async () => {
  const seen: number[] = [];
  const connected = await getEmailChannelStatus(7, async tenant => { seen.push(tenant); });
  assert.equal(connected.configured, true);
  assert.deepEqual(seen, [7]);
  const missing = await getEmailChannelStatus(null, async () => { throw new Error("must not run"); });
  assert.equal(missing.configured, false);
  const failed = await getEmailChannelStatus(7, async () => { throw new Error("private-token-error"); });
  assert.equal(failed.configured, false);
  assert.doesNotMatch(failed.status, /private-token-error/);
});