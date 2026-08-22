import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "server/tools/domains/media/handlers.ts",
  "utf8",
);

test("video planner opens a curiosity gap and resolves it at the payoff", () => {
  assert.match(source, /Open a specific curiosity gap/);
  assert.match(source, /do not reveal its full answer until the later payoff/);
});

test("video planner requires every slide to advance the retention arc", () => {
  assert.match(source, /Every slide must advance the story or understanding/);
  assert.match(source, /Do not repeat the setup in different words/);
  assert.doesNotMatch(source, /pattern interrupt/);
});

test("video planner never invents an engagement CTA", () => {
  assert.match(
    source,
    /End on the payoff; do not invent a follow, subscribe, comment, or other engagement CTA/,
  );
  assert.match(source, /Never use forced engagement bait/);
});