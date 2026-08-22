import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PreparationDeadlineExceededError,
  runWithPreparationDeadline,
} from "../../server/lib/preparation-deadline";

describe("runWithPreparationDeadline", () => {
  it("releases a turn when a preparation dependency hangs", async () => {
    const parent = new AbortController();

    await assert.rejects(
      runWithPreparationDeadline(
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("cancelled")), {
              once: true,
            });
          }),
        { timeoutMs: 30, label: "prompt context", parentSignal: parent.signal },
      ),
      (err: unknown) => {
        assert.ok(err instanceof PreparationDeadlineExceededError);
        assert.equal((err as PreparationDeadlineExceededError).label, "prompt context");
        assert.equal((err as PreparationDeadlineExceededError).timeoutMs, 30);
        return true;
      },
    );
  });

  it("stops waiting immediately when the client disconnects", async () => {
    const parent = new AbortController();
    const startedAt = Date.now();
    const pending = runWithPreparationDeadline(
      () => new Promise<never>(() => {}),
      { timeoutMs: 1_000, label: "attachment context", parentSignal: parent.signal },
    );

    parent.abort();

    await assert.rejects(pending, (err: unknown) => {
      assert.equal((err as Error).name, "AbortError");
      return true;
    });
    assert.ok(Date.now() - startedAt < 100, "parent abort should not wait for the preparation deadline");
  });
});