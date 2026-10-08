import test from "node:test";
import assert from "node:assert/strict";
import { providerLaneLocallyReady, getClientForModel } from "../../server/providers";

test("Profundo disabled switch prevents even explicitly pinned requests without selecting a paid fallback", async () => {
  const saved = process.env.PROFUNDO_ENABLED;
  process.env.PROFUNDO_ENABLED = "0";
  try {
    assert.equal(providerLaneLocallyReady("profundo"), false);
    await assert.rejects(getClientForModel("gpt-5.6-sol", 1, { providerLane: "profundo", juryLane: true }),
      /unavailable/);
  } finally {
    if (saved === undefined) delete process.env.PROFUNDO_ENABLED;
    else process.env.PROFUNDO_ENABLED = saved;
  }
});
