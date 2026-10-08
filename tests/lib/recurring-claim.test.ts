import assert from "node:assert/strict";
import test from "node:test";
import { runClaimedRecurringOccurrence } from "../../server/lib/recurring-claim";

test("scheduled delivery is not attempted until the durable claim succeeds", async () => {
  const order: string[] = [];
  const result = await runClaimedRecurringOccurrence(
    async () => { order.push("claim"); return true; },
    async () => { order.push("send"); return "receipt"; },
  );
  assert.deepEqual(order, ["claim", "send"]);
  assert.deepEqual(result, { claimed: true, result: "receipt" });
  const skipped = await runClaimedRecurringOccurrence(async () => false, async () => { throw new Error("must not send"); });
  assert.deepEqual(skipped, { claimed: false });
});

test("competing workers execute only the winning occurrence", async () => {
  let durableClaimed = false, sends = 0;
  const claim = async () => {
    if (durableClaimed) return false;
    durableClaimed = true;
    return true;
  };
  const results = await Promise.all([1, 2].map(() =>
    runClaimedRecurringOccurrence(claim, async () => { sends++; }),
  ));
  assert.equal(sends, 1);
  assert.equal(results.filter(result => result.claimed).length, 1);
});

test("a post-send persistence failure never releases the claim for blind retry", async () => {
  let durableClaimed = false, sends = 0;
  const claim = async () => {
    if (durableClaimed) return false;
    durableClaimed = true;
    return true;
  };
  await assert.rejects(runClaimedRecurringOccurrence(claim, async () => {
    sends++;
    throw new Error("receipt persistence failed");
  }), /receipt persistence failed/);
  const retry = await runClaimedRecurringOccurrence(claim, async () => { sends++; });
  assert.deepEqual(retry, { claimed: false });
  assert.equal(sends, 1);
});