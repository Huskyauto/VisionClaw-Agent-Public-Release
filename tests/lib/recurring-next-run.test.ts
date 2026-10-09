import assert from "node:assert/strict";
import test from "node:test";
import { computeNextRecurringRun } from "../../server/lib/recurring-next-run";

test("weekly recurring mail uses the requested Chicago schedule, not an hourly fallback", () => {
  const next = computeNextRecurringRun("0 7 * * 1", new Date("2026-10-04T12:00:00Z"));
  assert.equal(next.toISOString(), "2026-10-05T12:00:00.000Z");
});

test("invalid schedules fail rather than becoming unsolicited hourly mail", () => {
  assert.throws(() => computeNextRecurringRun("not a schedule", new Date("2026-10-04T12:00:00Z")));
});

test("Chicago daylight-saving changes preserve the requested local time", () => {
  assert.equal(
    computeNextRecurringRun("0 7 * * 1", new Date("2026-10-31T12:00:00Z")).toISOString(),
    "2026-11-02T13:00:00.000Z",
  );
});