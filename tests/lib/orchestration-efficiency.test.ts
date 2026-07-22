import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessHeavyLoopWorth, shouldUpRouteToHardModel } from "../../server/orchestration-efficiency";

describe("assessHeavyLoopWorth (arXiv:2605.22687 heavy-loop guard)", () => {
  it("flags pure arithmetic as skip (trivial)", () => {
    const r = assessHeavyLoopWorth({ message: "12 * 7 + 3" });
    assert.equal(r.verdict, "skip");
    assert.ok(r.triviality >= 0.6, `triviality=${r.triviality}`);
  });

  it("flags 'what is 12 * 7' as skip", () => {
    const r = assessHeavyLoopWorth({ message: "what is 12 * 7" });
    assert.equal(r.verdict, "skip");
  });

  it("flags greetings / acknowledgements as skip", () => {
    for (const m of ["thanks", "ok", "hello", "got it"]) {
      const r = assessHeavyLoopWorth({ message: m });
      assert.equal(r.verdict, "skip", `expected skip for "${m}"`);
    }
  });

  it("treats empty input as skip with max triviality", () => {
    const r = assessHeavyLoopWorth({ message: "   " });
    assert.equal(r.verdict, "skip");
    assert.equal(r.triviality, 1);
  });

  it("flags a multi-signal architecture/strategy request as worth", () => {
    const r = assessHeavyLoopWorth({
      message:
        "Compare the architecture trade-offs of a queue-based vs event-sourced design for our multi-tenant orchestrator, and analyze the security and scalability implications of each.",
    });
    assert.equal(r.verdict, "worth");
    assert.ok(r.triviality < 0.6);
  });

  it("treats a code-block + complexity request as worth", () => {
    const r = assessHeavyLoopWorth({
      message: "Why does this race condition happen and how should I refactor it?\n```ts\nlet x = 0;\n```",
      hasCodeBlock: true,
    });
    assert.equal(r.verdict, "worth");
  });

  it("returns neutral for an ordinary medium-length request with no strong signal", () => {
    const r = assessHeavyLoopWorth({
      message: "Please draft a short friendly reminder note to the team about the meeting tomorrow afternoon.",
    });
    assert.equal(r.verdict, "neutral");
  });

  it("does not let a single complexity keyword force a trivial short message up to worth", () => {
    // short + one keyword -> not 2 signals -> not "worth"; should stay skip/neutral
    const r = assessHeavyLoopWorth({ message: "security?" });
    assert.notEqual(r.verdict, "worth");
  });

  it("clamps triviality to the 0..1 range", () => {
    const r = assessHeavyLoopWorth({ message: "hi" });
    assert.ok(r.triviality >= 0 && r.triviality <= 1);
  });
});

describe("shouldUpRouteToHardModel (adaptive UP-route)", () => {
  it("up-routes a genuinely complex auto-routed turn that the ensemble did not trigger", () => {
    assert.equal(
      shouldUpRouteToHardModel({ ensembleTriggered: false, worthVerdict: "worth", userPinnedModel: false }),
      true,
    );
  });

  it("never up-routes when the ensemble already fired (no double spend)", () => {
    assert.equal(
      shouldUpRouteToHardModel({ ensembleTriggered: true, worthVerdict: "worth", userPinnedModel: false }),
      false,
    );
  });

  it("never overrides an explicitly user-pinned model", () => {
    assert.equal(
      shouldUpRouteToHardModel({ ensembleTriggered: false, worthVerdict: "worth", userPinnedModel: true }),
      false,
    );
  });

  it("stays on the cheap path for neutral verdicts", () => {
    assert.equal(
      shouldUpRouteToHardModel({ ensembleTriggered: false, worthVerdict: "neutral", userPinnedModel: false }),
      false,
    );
  });

  it("stays on the cheap path for skip (trivial) verdicts", () => {
    assert.equal(
      shouldUpRouteToHardModel({ ensembleTriggered: false, worthVerdict: "skip", userPinnedModel: false }),
      false,
    );
  });

  it("respects the kill switch even on a worthy request", () => {
    assert.equal(
      shouldUpRouteToHardModel({ ensembleTriggered: false, worthVerdict: "worth", userPinnedModel: false, enabled: false }),
      false,
    );
  });
});
