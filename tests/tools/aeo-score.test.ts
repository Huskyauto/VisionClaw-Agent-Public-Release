/**
 * aeo-score.test.ts — unit tests for the R125+83 AEO citation-readiness scorer.
 * Pure logic: no DB, no network, no LLM (safe for run.sh — no pg pool held open).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAeo } from "../../server/lib/aeo-score";

const GOOD_DRAFT = `---
title: What is answer engine optimization?
schema_type: Article
---

**TL;DR:** Answer engine optimization (AEO) is the practice of structuring content so AI answer engines can lift and cite it.

Answer engine optimization (AEO) is the practice of structuring web content so that AI answer engines like ChatGPT and Google AI Overviews can extract and cite it directly.

## What is AEO?

AEO is a content discipline that makes passages extractable. It focuses on short direct answers, structured blocks, and self-contained claims.

## How does AEO differ from SEO?

AEO targets citation by AI engines rather than ranking in classic search results. Both share structure and clarity fundamentals.

Key signals engines reward:

- Definition-first leads
- Question-style headings with short answers
- Lists and tables

| Signal | Weight |
|---|---|
| QA coverage | 30 |
| Definition lead | 15 |
`;

const BAD_DRAFT = `# Our journey

This has been quite the ride for all of us here at the company and we could not have possibly imagined how far things would come when we first started out on this incredible adventure so many years ago together as a small team.

It was amazing. They said it could not be done but we kept pushing forward through all the various challenges and obstacles that presented themselves along the winding path of our unique entrepreneurial story.

Those were the days that shaped who we are now and it is with tremendous pride that we look back on everything that has happened.
`;

test("good draft scores strictly higher than bad draft (selftest parity)", () => {
  const good = scoreAeo(GOOD_DRAFT);
  const bad = scoreAeo(BAD_DRAFT);
  assert.ok(good.score > bad.score, `expected ${good.score} > ${bad.score}`);
  assert.ok(good.score >= 75, `good draft should be strong, got ${good.score}`);
  assert.ok(bad.score < 50, `bad draft should be weak, got ${bad.score}`);
});

test("signal weights sum to 100 and points never exceed max", () => {
  const r = scoreAeo(GOOD_DRAFT);
  const totalMax = r.signals.reduce((s, x) => s + x.max, 0);
  assert.equal(totalMax, 100);
  for (const s of r.signals) {
    assert.ok(s.points >= 0 && s.points <= s.max, `${s.id} points ${s.points} out of range 0..${s.max}`);
  }
  assert.equal(r.signals.length, 7);
});

test("front-matter schema_type earns SCHEMA; absence loses it", () => {
  const withSchema = scoreAeo(GOOD_DRAFT);
  const noSchema = scoreAeo(GOOD_DRAFT.replace("schema_type: Article\n", ""));
  const sig = (r: ReturnType<typeof scoreAeo>) => r.signals.find((s) => s.id === "SCHEMA")!;
  assert.equal(sig(withSchema).points, 10);
  assert.equal(sig(noSchema).points, 0);
});

test("question headings answered long lose QA points", () => {
  const longAnswer = GOOD_DRAFT.replace(
    "AEO is a content discipline that makes passages extractable. It focuses on short direct answers, structured blocks, and self-contained claims.",
    Array(20).fill("This sentence pads the answer well past the fifty word extractability threshold that answer engines prefer for lifting.").join(" "),
  );
  const full = scoreAeo(GOOD_DRAFT).signals.find((s) => s.id === "QA")!;
  const degraded = scoreAeo(longAnswer).signals.find((s) => s.id === "QA")!;
  assert.ok(degraded.points < full.points);
});

test("empty and garbage input degrade gracefully (no throw)", () => {
  assert.doesNotThrow(() => scoreAeo(""));
  assert.doesNotThrow(() => scoreAeo("---\nbroken front matter"));
  assert.doesNotThrow(() => scoreAeo("|||\n#\n- \n"));
  const empty = scoreAeo("");
  assert.equal(empty.grade, "weak");
  assert.ok(empty.score <= 15);
});

test("dangling openers reduce SELF score", () => {
  const r = scoreAeo(BAD_DRAFT);
  const self = r.signals.find((s) => s.id === "SELF")!;
  assert.ok(self.points < self.max, "bad draft opens paragraphs with This/It/Those — must lose SELF points");
});

test("advice lists concrete fixes for missing signals", () => {
  const r = scoreAeo(BAD_DRAFT);
  assert.ok(r.advice.length >= 3);
  assert.ok(r.advice.some((a) => /question/i.test(a)));
});
