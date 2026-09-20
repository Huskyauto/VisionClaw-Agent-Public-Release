import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPatchedCreate, COST_LEDGER_RECORDED } from "../../server/providers";

test("fully consumed streams expose whether usage was durably recorded", async () => {
  let records = 0;
  async function* source() {
    yield { choices: [{ delta: { content: "hello" } }] };
    yield { choices: [{ delta: { content: " world" } }], usage: { prompt_tokens: 4, completion_tokens: 2 } };
  }
  const create = buildPatchedCreate(
    async () => source(),
    () => "gpt-5-mini",
    () => 1,
    "test-provider",
    async () => {
      records++;
      return true;
    },
  );

  const stream: any = await create({ model: "gpt-5-mini", stream: true });
  for await (const _chunk of stream) {
    // Consume the complete stream so final usage accounting runs.
  }

  assert.equal(stream[COST_LEDGER_RECORDED], true);
  assert.equal(records, 1);
});

for (const scenario of ["missing-usage", "record-false", "record-throws", "partial"] as const) {
  test(`ordinary stream fails accounting closed for ${scenario}`, async () => {
    let records = 0;
    async function* source() {
      yield { choices: [{ delta: { content: "hello" } }] };
      if (scenario !== "missing-usage") {
        yield { choices: [{ delta: { content: " world" } }], usage: { prompt_tokens: 4, completion_tokens: 2 } };
      }
    }
    const create = buildPatchedCreate(
      async () => source(),
      () => "gpt-5-mini",
      () => 1,
      "test-provider",
      async () => {
        records++;
        if (scenario === "record-throws") throw new Error("ledger down");
        return scenario !== "record-false";
      },
    );

    const stream: any = await create({ model: "gpt-5-mini", stream: true });
    for await (const _chunk of stream) {
      if (scenario === "partial") break;
    }

    assert.equal(stream[COST_LEDGER_RECORDED], false);
    assert.equal(records, scenario === "record-false" || scenario === "record-throws" ? 1 : 0);
  });
}