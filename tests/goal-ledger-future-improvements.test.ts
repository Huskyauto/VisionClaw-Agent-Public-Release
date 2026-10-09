import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  parseFutureImprovements,
  readFutureImprovementsLedger,
} from "../server/lib/goal-ledger-future-improvements";

const validLedger = {
  schemaVersion: 1,
  items: [
    {
      id: "recall-citation-gold-set",
      title: "Build a labeled recall and citation gold set",
      why: "Measure baseline misses before changing retrieval.",
      revisitTrigger: "Revisit after the baseline evaluation shows attributable misses.",
      status: "deferred",
      evidence: [
        "https://github.com/undefined-ui/second-brain-os",
        "docs/research/second-brain-os-review-2026-09-27.md",
      ],
    },
  ],
};

test("parses and validates future-improvement records", () => {
  assert.deepEqual(parseFutureImprovements(JSON.stringify(validLedger)), {
    items: validLedger.items,
  });
});

test("rejects malformed, oversized, and invalid future-improvement ledgers", () => {
  assert.throws(() => parseFutureImprovements("{"), /valid JSON/);
  assert.throws(
    () => parseFutureImprovements(JSON.stringify({ ...validLedger, items: [{ ...validLedger.items[0], status: "active" }] })),
    /invalid future improvement/,
  );
  assert.throws(() => parseFutureImprovements(" ".repeat(32_769)), /size limit/);
});

test("reports missing and non-regular tracked ledger paths as unavailable", async () => {
  const tracked = await readFutureImprovementsLedger(
    path.join(process.cwd(), "data", "goal-ledger-future-improvements.json"),
  );
  assert.equal(tracked.status, "available");
  if (tracked.status === "available") assert.equal(tracked.items.length, 4);

  const missing = await readFutureImprovementsLedger(
    path.join(process.cwd(), "data", "goal-ledger-future-improvements.missing.json"),
  );
  assert.equal(missing.status, "unavailable");
  if (missing.status === "unavailable") assert.match(missing.error, /Future improvements unavailable/);

  const directory = await readFutureImprovementsLedger(path.join(process.cwd(), "data"));
  assert.equal(directory.status, "unavailable");
  if (directory.status === "unavailable") assert.match(directory.error, /regular file/);
});