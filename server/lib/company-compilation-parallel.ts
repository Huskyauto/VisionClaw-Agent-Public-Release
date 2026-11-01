import { advanceCompilationMatrix, COMPILATION_AUTHORS, compilationOperations, type CompilationMatrix } from "./company-compilation-matrix";

type Ports = Parameters<typeof advanceCompilationMatrix>[1];
const active = new WeakSet<CompilationMatrix>();
/** One lease owner, nine overlapping authors, three dependency-bound syntheses.
 * All checkpoint writes are serialized. Failure waits for in-flight siblings,
 * preserving their received responses before a package-level stop. */
export async function advanceParallelCompilation(state: CompilationMatrix, ports: Ports): Promise<void> {
  if (state.phase === "complete") return;
  if (state.phase === "blocked") throw new Error("Compilation is stopped; no automatic retry");
  if (active.has(state)) throw new Error("Compilation already advancing");
  active.add(state);
  let writes = Promise.resolve();
  let checkpointFailed = false;
  const checkpoint = () => {
    writes = writes.then(async () => {
      if (checkpointFailed) throw new Error("Compilation checkpoint unavailable");
      try { await ports.checkpoint(state); } catch (error) { checkpointFailed = true; throw error; }
    });
    return writes;
  };
  const operations = compilationOperations();
  const failures: unknown[] = [], syntheses: Promise<void>[] = [];
  const scheduled = new Set<string>();
  const run = async (op: typeof operations[number]) => {
    if (state.slots[op.key]?.phase === "complete") return;
    if (checkpointFailed) throw new Error("Compilation checkpoint unavailable");
    await advanceCompilationMatrix(state, { ...ports, checkpoint }, op, true);
  };
  const synthesizeReady = () => {
    for (const op of operations.filter(op => op.stage === "synthesis")) {
      if (scheduled.has(op.key) || checkpointFailed ||
          !COMPILATION_AUTHORS.every(author => state.slots[`author:${op.kind}:${author.model}`]?.phase === "complete")) continue;
      scheduled.add(op.key);
      // Catch immediately: other authors can remain in flight for minutes.
      syntheses.push(run(op).catch(error => { failures.push(error); }));
    }
  };
  try {
    if (Object.keys(state.slots).some(key => !operations.some(op => op.key === key)))
      throw new Error("Unknown compilation operation");
    synthesizeReady();
    await Promise.all(operations.filter(op => op.stage === "author").map(async op => {
      try { await run(op); synthesizeReady(); } catch (error) { failures.push(error); }
    }));
    synthesizeReady();
    await Promise.all(syntheses);
    state.phase = failures.length ? "blocked" :
      operations.every(op => state.slots[op.key]?.phase === "complete") ? "complete" : "blocked";
    await checkpoint();
    if (failures.length) throw failures[0];
    if (state.phase !== "complete") throw new Error("Compilation dependencies incomplete");
  } finally { active.delete(state); }
}
