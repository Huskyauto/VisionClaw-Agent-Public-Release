/** Read-only replay of a privately retained checkpoint; no providers or DB. */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { acceptCompilation } from "../server/lib/company-compilation-content";
import { compilationOperations, advanceCompilationMatrix } from "../server/lib/company-compilation-matrix";

const state = JSON.parse(readFileSync(process.argv[2], "utf8"));
const op = compilationOperations().find(op => state.compilation.slots[op.key]?.phase === "received")!;
if (!op) throw new Error("No received compilation to replay");
const matrix = structuredClone(state.compilation);
const original = JSON.stringify(matrix.slots[op.key].raw);
const completed = Object.fromEntries(Object.entries(matrix.slots).filter(([, slot]: any) => slot.phase === "complete"));
matrix.phase = "authors"; // In-memory recovery only; never writes the source.
let requests = 0;
advanceCompilationMatrix(matrix, {
  checkpoint: async () => {},
  request: async () => { requests++; throw new Error("Offline replay cannot call a provider"); },
  accept: (operation, raw) => acceptCompilation(state, operation, raw),
}).then(() => {
  assert.equal(requests, 0);
  assert.equal(matrix.slots[op.key].phase, "complete");
  assert.equal(JSON.stringify(matrix.slots[op.key].raw), original);
  for (const [key, slot] of Object.entries(completed)) assert.deepEqual(matrix.slots[key], slot);
  assert.deepEqual(JSON.parse(readFileSync(process.argv[2], "utf8")), state);
  console.log("Retained compilation replay passed", { operation: op.key,
    characters: matrix.slots[op.key].text.length, requests, priorCompleted: Object.keys(completed).length,
    sourceUnchanged: true });
}).catch(error => {
  console.error("Retained compilation replay failed:", (error as Error).message);
  process.exitCode = 1;
});
