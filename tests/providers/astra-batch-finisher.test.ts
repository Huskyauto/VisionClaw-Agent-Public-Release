import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceAstraBatch,
  type AstraBatchRecord,
} from "../../server/lib/astra-batch-finisher";

const input = {
  tenantId: 1,
  orderId: "order-123",
  preparedDraft: [
    "=== SECTION: One ===",
    "First verified section. ".repeat(12),
    "=== SECTION: Two ===",
    "Second verified section. ".repeat(12),
  ].join("\n"),
  expectedHeadings: ["One", "Two"],
  baselineSections: [
    { heading: "One", body: "First verified section. ".repeat(12) },
    { heading: "Two", body: "Second verified section. ".repeat(12) },
  ],
  evidence: "Verified evidence",
  task: "Polish the report",
};

function initial(): AstraBatchRecord {
  return {
    phase: "claimed",
    submissionKey: "astra-batch-order-123",
  };
}

test("Astra Batch uploads JSONL and creates a 24-hour Responses batch with stable idempotency", async () => {
  const calls: any[] = [];
  const result = await advanceAstraBatch(input, initial(), {
    enabled: true,
    uploadFile: async (jsonl, options) => {
      calls.push({ type: "upload", jsonl, options });
      return { id: "file-in" };
    },
    createBatch: async (params, options) => {
      calls.push({ type: "batch", params, options });
      return { id: "batch-1", status: "validating", input_file_id: "file-in" };
    },
    findBatchByKey: async () => null,
    retrieveBatch: async () => assert.fail("must not poll during submission"),
    readFileContent: async () => assert.fail("must not read output during submission"),
  });

  assert.equal(result.kind, "pending");
  assert.equal(result.record.inputFileId, "file-in");
  assert.equal(result.record.providerBatchId, "batch-1");
  assert.equal(calls[0].options.idempotencyKey, "astra-batch-order-123-file");
  assert.equal(calls[1].options.idempotencyKey, "astra-batch-order-123-batch");
  assert.equal(calls[1].params.endpoint, "/v1/responses");
  assert.equal(calls[1].params.completion_window, "24h");
  const row = JSON.parse(calls[0].jsonl.trim());
  assert.equal(row.custom_id, "astra-report");
  assert.equal(row.body.max_output_tokens, 4_000);
});

test("Astra Batch output allowance grows with the prepared report", async () => {
  let jsonl = "";
  const largeInput = {
    ...input,
    preparedDraft: "x".repeat(8_000),
  };
  await advanceAstraBatch(largeInput, initial(), {
    enabled: true,
    uploadFile: async (body) => {
      jsonl = body;
      return { id: "file-large" };
    },
    createBatch: async () => ({ id: "batch-large", status: "validating", input_file_id: "file-large" }),
    findBatchByKey: async () => null,
    retrieveBatch: async () => assert.fail("must not poll during submission"),
    readFileContent: async () => assert.fail("must not read output during submission"),
  });
  assert.ok(JSON.parse(jsonl.trim()).body.max_output_tokens > 4_000);
});

test("Astra Batch resumes a stale claimed submission with the same idempotency keys", async () => {
  const keys: string[] = [];
  const deps = {
    enabled: true,
    uploadFile: async (_jsonl: string, options: any) => {
      keys.push(options.idempotencyKey);
      return { id: "file-in" };
    },
    createBatch: async (_params: any, options: any) => {
      keys.push(options.idempotencyKey);
      return { id: "batch-1", status: "validating", input_file_id: "file-in" };
    },
    findBatchByKey: async () => null,
    retrieveBatch: async () => assert.fail("not reached"),
    readFileContent: async () => assert.fail("not reached"),
  };
  await advanceAstraBatch(input, initial(), deps);
  await advanceAstraBatch(input, initial(), deps);
  assert.deepEqual(keys, [
    "astra-batch-order-123-file",
    "astra-batch-order-123-batch",
    "astra-batch-order-123-file",
    "astra-batch-order-123-batch",
  ]);
});

test("Astra Batch preserves the verified baseline when completed output is malformed", async () => {
  const result = await advanceAstraBatch(input, {
    phase: "submitted",
    submissionKey: "astra-batch-order-123",
    inputFileId: "file-in",
    providerBatchId: "batch-1",
  }, {
    enabled: true,
    uploadFile: async () => assert.fail("already uploaded"),
    createBatch: async () => assert.fail("already submitted"),
    findBatchByKey: async () => null,
    retrieveBatch: async () => ({ id: "batch-1", status: "completed", output_file_id: "file-out" }),
    readFileContent: async () => JSON.stringify({
      custom_id: "astra-report",
      response: {
        status_code: 200,
        body: {
          status: "completed",
          output_text: "bad output",
          usage: { input_tokens: 100, output_tokens: 10 },
        },
      },
    }),
  });

  assert.equal(result.kind, "completed");
  assert.equal(result.usedAstra, false);
  assert.equal(result.text, input.preparedDraft);
});

test("Astra Batch retrieves and accepts only the exact completed report contract", async () => {
  const polished = [
    "=== SECTION: One ===",
    "Polished first verified section. ".repeat(12),
    "=== SECTION: Two ===",
    "Polished second verified section. ".repeat(12),
  ].join("\n");
  const result = await advanceAstraBatch(input, {
    phase: "submitted",
    submissionKey: "astra-batch-order-123",
    inputFileId: "file-in",
    providerBatchId: "batch-1",
  }, {
    enabled: true,
    uploadFile: async () => assert.fail("already uploaded"),
    createBatch: async () => assert.fail("already submitted"),
    findBatchByKey: async () => null,
    retrieveBatch: async () => ({ id: "batch-1", status: "completed", output_file_id: "file-out" }),
    readFileContent: async () => JSON.stringify({
      custom_id: "astra-report",
      response: {
        status_code: 200,
        body: {
          status: "completed",
          output_text: polished,
          usage: { input_tokens: 1200, output_tokens: 300, input_tokens_details: { cached_tokens: 200 } },
        },
      },
    }),
  });

  assert.equal(result.kind, "completed");
  assert.equal(result.usedAstra, true);
  assert.equal(result.text, polished.trim());
  assert.equal(result.record.outputFileId, "file-out");
  assert.equal(result.record.tokensIn, 1200);
  assert.equal(result.record.tokensOut, 300);
  assert.equal(result.record.cachedTokensIn, 200);
});

test("Astra Batch terminal polling is idempotent and does not call the provider again", async () => {
  let calls = 0;
  const terminal: AstraBatchRecord = {
    phase: "completed",
    submissionKey: "astra-batch-order-123",
    inputFileId: "file-in",
    providerBatchId: "batch-1",
    outputFileId: "file-out",
    finalText: input.preparedDraft,
    usedAstra: false,
  };
  const result = await advanceAstraBatch(input, terminal, {
    enabled: true,
    uploadFile: async () => { calls++; return { id: "x" }; },
    createBatch: async () => { calls++; return { id: "x" }; },
    findBatchByKey: async () => { calls++; return null; },
    retrieveBatch: async () => { calls++; return { id: "x", status: "completed" }; },
    readFileContent: async () => { calls++; return ""; },
  });
  assert.equal(result.kind, "completed");
  assert.equal(calls, 0);
});

test("Astra Batch refuses to ledger a paid completion with missing usage", async () => {
  await assert.rejects(
    advanceAstraBatch(input, {
      phase: "submitted",
      submissionKey: "astra-batch-order-123",
      providerBatchId: "batch-1",
    }, {
      enabled: true,
      uploadFile: async () => assert.fail("already submitted"),
      createBatch: async () => assert.fail("already submitted"),
      findBatchByKey: async () => null,
      retrieveBatch: async () => ({ id: "batch-1", status: "completed", output_file_id: "file-out" }),
      readFileContent: async () => JSON.stringify({
        custom_id: "astra-report",
        response: { status_code: 200, body: { status: "completed", output_text: input.preparedDraft } },
      }),
    }),
    /valid nonzero usage accounting/,
  );
});