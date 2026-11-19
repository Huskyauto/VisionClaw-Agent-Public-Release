import assert from "node:assert/strict";
import test from "node:test";
import { compileWorkingContext, hydrateWorkingContext, renderWorkingContext } from "../../server/lib/agent-working-context";

// Distinct, previously unused scenario fixtures. Extraction choices are controlled:
// this compares context components, not hosted-model behavior or total agent recall.
test("source-backed fixtures preserve interrupted-work details beyond the legacy preview window", () => {
  const scope = { tenantId: 91, personaId: 5, projectId: 19, conversationId: 63 };
  const cases = [
    { kind: "goal", quote: "Finish the east-wing equipment schedule before writing the commissioning checklist." },
    { kind: "constraint", quote: "Keep the budget below the approved limit and do not order replacement equipment." },
    { kind: "blocker", quote: "The load calculation is blocked until the missing site measurements arrive." },
    { kind: "next_action", quote: "Next, compare the two retained proposals without contacting either supplier." },
  ];
  let included = 0;
  for (const [i, scenario] of cases.entries()) {
    const id = 1000 + i;
    const source = { ...scope, id, role: "user" as const,
      content: "Earlier discussion of the project and available background. ".repeat(8) + scenario.quote,
      createdAt: "2026-11-18T15:00:00Z" };
    const legacyUserPreview = source.content.slice(0, 300);
    assert.equal(legacyUserPreview.includes(scenario.quote), false);
    const artifact = compileWorkingContext({ scope, userMessageId: id, sources: [source],
      candidate: [{ ...scenario, role: "user" }] });
    const prompt = renderWorkingContext(hydrateWorkingContext(scope, [artifact], [source]));
    if (prompt.includes(scenario.quote)) included++;
    assert.ok(prompt.length <= 2400);
  }
  assert.equal(included, cases.length);
});
