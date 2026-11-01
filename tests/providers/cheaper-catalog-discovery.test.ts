import test from "node:test";
import assert from "node:assert/strict";
import { parseCheaperCatalog } from "../../server/lib/cheaper-inference-automatic";

const chat = {
  id: "gpt-5.6-luna", type: "text", endpoint: "/v1/chat/completions", context_length: 128000,
  pricing: { input_per_million: "1", output_per_million: "2", discount_percent: "40" },
};
test("new discovery-only families do not disable known chat and never become callable", () => {
  const entries = parseCheaperCatalog({ data: [
    chat,
    { id: "luna-batch", type: "text", endpoint: "/v4/ai/batch" },
    { id: "image-chat", type: "image", endpoint: "/v1/chat/completions" },
    { id: "reranker", type: "rerank", endpoint: "/v1/rerank" },
  ] });
  assert.deepEqual(entries.map(x => x.id), [chat.id]);
});
test("unknown family, mismatched endpoint, duplicate and invalid callable price still fail closed", () => {
  for (const extra of [
    { id: "unknown", type: "unknown", endpoint: "/v1/unknown" },
    { id: "bad-rerank", type: "rerank", endpoint: "/v1/chat/completions" },
    { id: chat.id, type: "text", endpoint: "/v4/ai/batch" },
    { ...chat, id: "bad-price", pricing: { input_per_million: "bad", output_per_million: "2" } },
  ]) assert.throws(() => parseCheaperCatalog({ data: [chat, extra] }));
});
