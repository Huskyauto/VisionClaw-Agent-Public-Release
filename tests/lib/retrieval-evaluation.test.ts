import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRetrieval } from "../../server/lib/retrieval-evaluation";

test("retrieval evaluation reports ranking quality and authorization leakage at k", () => {
  const result = evaluateRetrieval({
    rankedIds: ["tenant-a-2", "tenant-b-secret", "tenant-a-9", "tenant-a-7"],
    relevantIds: ["tenant-a-9", "tenant-a-7"],
    authorizedIds: ["tenant-a-2", "tenant-a-9", "tenant-a-7"],
    k: 3,
  });

  assert.equal(result.precisionAtK, 1 / 3);
  assert.equal(result.recallAtK, 1 / 2);
  assert.equal(result.meanReciprocalRankAtK, 1 / 3);
  assert.ok(Math.abs(result.ndcgAtK - 0.3065735963827292) < 1e-12);
  assert.equal(result.authorizationLeakageCount, 1);
  assert.equal(result.authorizationLeakageRate, 1 / 3);
});

test("retrieval evaluation rejects duplicate ranked IDs instead of inflating relevance", () => {
  assert.throws(
    () => evaluateRetrieval({
      rankedIds: ["doc-1", "doc-1"],
      relevantIds: ["doc-1"],
      authorizedIds: ["doc-1"],
      k: 2,
    }),
    /rankedIds must be unique/,
  );
});