/**
 * tests/unit/drive-discover-week-window.test.ts
 *
 * Locks the BWB weekly recap window semantics in `computeWeekWindow`
 * (scripts/lib/drive-discover.ts):
 *   - Default week is ALWAYS Sunday (start) → the following Saturday (end).
 *   - With no anchor, the recap covers the JUST-COMPLETED week (prior Sun–Sat),
 *     because the current week isn't over when the autonomous job runs.
 *   - With an explicit anchor, the recap covers the Sun–Sat week CONTAINING it.
 *   - Explicit weekStart/weekEnd still pins a literal range and rejects
 *     partial/inverted/unparseable input.
 *
 * Run: node --import tsx --test tests/unit/drive-discover-week-window.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { computeWeekWindow } from "../../scripts/lib/drive-discover";

function ymd(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Build a local-midnight Date so getDay() reflects the intended weekday.
function localDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

// --- Default (no anchor): JUST-COMPLETED Sun–Sat week --------------------
// 2026-05-31 is a Sunday (start of a new week). The just-completed week is
// 2026-05-24 (Sun) → 2026-05-30 (Sat).
test("no anchor, run on a Sunday → prior completed Sun–Sat week", () => {
  const w = computeWeekWindow({ now: localDate("2026-05-31") });
  assert.equal(ymd(w.cutoff), "2026-05-24");
  assert.equal(ymd(w.upperBound), "2026-05-30");
});
// 2026-06-03 is a Wednesday. The just-completed week is still 05-24 → 05-30.
test("no anchor, run mid-week → still the last completed Sun–Sat week", () => {
  const w = computeWeekWindow({ now: localDate("2026-06-03") });
  assert.equal(ymd(w.cutoff), "2026-05-24");
  assert.equal(ymd(w.upperBound), "2026-05-30");
});
// 2026-06-06 is a Saturday (end of current week). Last completed week is still 05-24 → 05-30.
test("no anchor, run on a Saturday → last completed week, not the in-progress one", () => {
  const w = computeWeekWindow({ now: localDate("2026-06-06") });
  assert.equal(ymd(w.cutoff), "2026-05-24");
  assert.equal(ymd(w.upperBound), "2026-05-30");
});

// --- Explicit anchor: the Sun–Sat week CONTAINING the anchor ------------
test("anchor on a Saturday → its containing Sun–Sat week", () => {
  // 2026-05-30 is a Saturday; its week is 05-24 (Sun) → 05-30 (Sat).
  const w = computeWeekWindow({ anchorRaw: "2026-05-30" });
  assert.equal(ymd(w.cutoff), "2026-05-24");
  assert.equal(ymd(w.upperBound), "2026-05-30");
});
test("anchor mid-week → its containing Sun–Sat week", () => {
  // 2026-05-27 is a Wednesday; its week is 05-24 (Sun) → 05-30 (Sat).
  const w = computeWeekWindow({ anchorRaw: "2026-05-27" });
  assert.equal(ymd(w.cutoff), "2026-05-24");
  assert.equal(ymd(w.upperBound), "2026-05-30");
});
test("anchor on a Sunday → that week starts the same day", () => {
  // 2026-05-24 is a Sunday; its week is 05-24 → 05-30.
  const w = computeWeekWindow({ anchorRaw: "2026-05-24" });
  assert.equal(ymd(w.cutoff), "2026-05-24");
  assert.equal(ymd(w.upperBound), "2026-05-30");
});
test("window bounds are floored to start-of-day and ceiled to end-of-day", () => {
  const w = computeWeekWindow({ anchorRaw: "2026-05-27" });
  const start = new Date(w.cutoff);
  const end = new Date(w.upperBound);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
});

// --- Explicit literal range still works --------------------------------
test("explicit weekStart/weekEnd pins the literal range verbatim", () => {
  const w = computeWeekWindow({ weekStartRaw: "2026-05-24", weekEndRaw: "2026-05-30" });
  assert.equal(ymd(w.cutoff), "2026-05-24");
  assert.equal(ymd(w.upperBound), "2026-05-30");
  assert.match(w.windowDesc, /explicit week/);
});
test("partial explicit range (only one bound) throws", () => {
  assert.throws(() => computeWeekWindow({ weekStartRaw: "2026-05-24" }), /partial week range/);
  assert.throws(() => computeWeekWindow({ weekEndRaw: "2026-05-30" }), /partial week range/);
});
test("inverted explicit range throws", () => {
  assert.throws(
    () => computeWeekWindow({ weekStartRaw: "2026-05-30", weekEndRaw: "2026-05-24" }),
    /inverted/,
  );
});
test("unparseable explicit range throws", () => {
  assert.throws(
    () => computeWeekWindow({ weekStartRaw: "not-a-date", weekEndRaw: "also-bad" }),
    /invalid explicit week range/,
  );
});
test("unparseable anchor throws", () => {
  assert.throws(() => computeWeekWindow({ anchorRaw: "garbage" }), /invalid anchorDate/);
});

// --- DST boundaries (US 2026): local-calendar dates must stay correct ---
// Spring-forward Sunday is 2026-03-08; its week is 03-08 (Sun) → 03-14 (Sat).
test("week containing the spring-forward Sunday stays Sun–Sat in local dates", () => {
  const w = computeWeekWindow({ anchorRaw: "2026-03-10" }); // Tue of that week
  assert.equal(ymd(w.cutoff), "2026-03-08");
  assert.equal(ymd(w.upperBound), "2026-03-14");
});
// Fall-back Sunday is 2026-11-01; its week is 11-01 (Sun) → 11-07 (Sat).
test("week containing the fall-back Sunday stays Sun–Sat in local dates", () => {
  const w = computeWeekWindow({ anchorRaw: "2026-11-03" }); // Tue of that week
  assert.equal(ymd(w.cutoff), "2026-11-01");
  assert.equal(ymd(w.upperBound), "2026-11-07");
});

// --- The window is always exactly 7 calendar days (Sun..Sat) ------------
test("default window spans a full Sun–Sat week (~7 days, end ceiled to 23:59)", () => {
  const w = computeWeekWindow({ anchorRaw: "2026-05-27" });
  const spanDays = (w.upperBound - w.cutoff) / 86_400_000;
  // Sun 00:00:00 → Sat 23:59:59.999 ≈ 6.9999 days; never less than 6, never ≥ 7.
  assert.ok(spanDays > 6.99 && spanDays < 7, `span was ${spanDays}`);
});
