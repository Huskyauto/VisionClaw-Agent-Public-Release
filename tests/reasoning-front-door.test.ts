import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontDoorPlan, shouldTrustPlan, isFrontDoorEnabled, withDeadline, type FrontDoorPlan } from "../server/reasoning-front-door-core";

const CATS = ["simple-chat", "general", "writing", "coding", "reasoning"];
const ctx = { modelUsed: "gemini-2.5-flash", routableCategories: CATS };

test("parses a well-formed plan", () => {
  const text = JSON.stringify({
    intent: "Refactor the auth module",
    category: "coding",
    confidence: 0.9,
    needsDeliberation: true,
    peersToConsult: ["Radar"],
    outputShape: "a diff",
    reasoning: "Clear coding task.",
  });
  const plan = parseFrontDoorPlan(text, ctx);
  assert.ok(plan);
  assert.equal(plan!.category, "coding");
  assert.equal(plan!.confidence, 0.9);
  assert.equal(plan!.needsDeliberation, true);
  assert.deepEqual(plan!.peersToConsult, ["Radar"]);
  assert.equal(plan!.source, "reasoning-front-door");
});

test("extracts JSON embedded in surrounding prose", () => {
  const text = 'Here is the plan:\n{"intent":"say hi","category":"simple-chat","confidence":0.8}\nDone.';
  const plan = parseFrontDoorPlan(text, ctx);
  assert.ok(plan);
  assert.equal(plan!.category, "simple-chat");
  assert.equal(plan!.needsDeliberation, false);
});

test("unknown category falls back to the router hint, then first category", () => {
  const text = JSON.stringify({ intent: "x", category: "made-up", confidence: 0.7 });
  const withHint = parseFrontDoorPlan(text, { ...ctx, fallbackCategory: "writing" });
  assert.equal(withHint!.category, "writing");
  const noHint = parseFrontDoorPlan(text, ctx);
  assert.equal(noHint!.category, "simple-chat");
});

test("clamps out-of-range confidence and coerces bad types", () => {
  const text = JSON.stringify({ intent: "x", category: "general", confidence: 5, peersToConsult: "nope" });
  const plan = parseFrontDoorPlan(text, ctx);
  assert.equal(plan!.confidence, 1);
  assert.deepEqual(plan!.peersToConsult, []);
});

test("returns null on unparseable / empty / intent-less input (fail-open)", () => {
  assert.equal(parseFrontDoorPlan("no json here", ctx), null);
  assert.equal(parseFrontDoorPlan("", ctx), null);
  assert.equal(parseFrontDoorPlan("{not valid json}", ctx), null);
  assert.equal(parseFrontDoorPlan(JSON.stringify({ category: "general", confidence: 0.9 }), ctx), null);
});

test("shouldTrustPlan: only confident + routable plans override the classifier", () => {
  const base: FrontDoorPlan = {
    intent: "x", category: "coding", confidence: 0.8, needsDeliberation: false,
    peersToConsult: [], outputShape: "", reasoning: "", modelUsed: "m", source: "reasoning-front-door",
  };
  assert.equal(shouldTrustPlan(base, CATS), true);
  assert.equal(shouldTrustPlan({ ...base, confidence: 0.4 }, CATS), false);
  assert.equal(shouldTrustPlan({ ...base, category: "unknown" }, CATS), false);
  assert.equal(shouldTrustPlan(null, CATS), false);
});

test("isFrontDoorEnabled reflects the env flag and defaults OFF", () => {
  const prev = process.env.REASONING_FRONT_DOOR;
  delete process.env.REASONING_FRONT_DOOR;
  assert.equal(isFrontDoorEnabled(), false);
  process.env.REASONING_FRONT_DOOR = "1";
  assert.equal(isFrontDoorEnabled(), true);
  if (prev === undefined) delete process.env.REASONING_FRONT_DOOR;
  else process.env.REASONING_FRONT_DOOR = prev;
});

test("withDeadline: returns the work value when it wins the race", async () => {
  const result = await withDeadline(Promise.resolve("fast"), 50);
  assert.equal(result, "fast");
});

test("withDeadline: returns null and fires onExpire when work exceeds the deadline", async () => {
  let aborted = false;
  // work that never settles within the deadline
  const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 200));
  const result = await withDeadline(slow, 20, () => { aborted = true; });
  assert.equal(result, null);
  assert.equal(aborted, true, "onExpire (abort) must fire on timeout");
});

test("withDeadline: a late REJECTION from the losing work never leaks as unhandled", async () => {
  let unhandled: unknown = null;
  const onUnhandled = (e: unknown) => { unhandled = e; };
  process.on("unhandledRejection", onUnhandled);
  // work that rejects AFTER the deadline has already expired
  const slowReject = new Promise<string>((_resolve, reject) =>
    setTimeout(() => reject(new Error("boom-after-timeout")), 30),
  );
  const result = await withDeadline(slowReject, 10);
  assert.equal(result, null);
  // give the late rejection time to fire so the swallow path is exercised
  await new Promise((r) => setTimeout(r, 60));
  process.removeListener("unhandledRejection", onUnhandled);
  assert.equal(unhandled, null, "late rejection must be swallowed, not surfaced");
});
