import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createCompletionWithTimeout,
  StreamCreateTimeoutError,
} from "../../server/lib/stream-create-timeout";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createCompletionWithTimeout", () => {
  it("returns the stream when create resolves before the timeout", async () => {
    const ac = new AbortController();
    const result = await createCompletionWithTimeout(
      async () => "STREAM",
      ac.signal,
      1000,
      "test-model",
    );
    assert.equal(result, "STREAM");
  });

  it("throws StreamCreateTimeoutError when create hangs past the timeout", async () => {
    const ac = new AbortController();
    await assert.rejects(
      createCompletionWithTimeout(
        (signal) =>
          new Promise((_resolve, reject) => {
            // Hang until the local signal aborts (mimics a stuck provider).
            signal.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          }),
        ac.signal,
        30,
        "slow-model",
      ),
      (err: unknown) => {
        assert.ok(err instanceof StreamCreateTimeoutError);
        assert.equal((err as StreamCreateTimeoutError).timeoutMs, 30);
        assert.equal((err as StreamCreateTimeoutError).modelId, "slow-model");
        return true;
      },
    );
  });

  it("propagates the ORIGINAL error (not a timeout) on client disconnect", async () => {
    const ac = new AbortController();
    const p = createCompletionWithTimeout(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("client-disconnect")),
            { once: true },
          );
        }),
      ac.signal,
      5000,
      "model",
    );
    // Caller disconnects before the create-timeout fires.
    await sleep(10);
    ac.abort();
    await assert.rejects(p, (err: unknown) => {
      assert.ok(!(err instanceof StreamCreateTimeoutError));
      assert.equal((err as Error).message, "client-disconnect");
      return true;
    });
  });

  it("aborts immediately when the shared signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      createCompletionWithTimeout(
        (signal) =>
          new Promise((_resolve, reject) => {
            if (signal.aborted) return reject(new Error("pre-aborted"));
            signal.addEventListener("abort", () => reject(new Error("pre-aborted")), {
              once: true,
            });
          }),
        ac.signal,
        5000,
        "model",
      ),
      (err: unknown) => {
        assert.ok(!(err instanceof StreamCreateTimeoutError));
        return true;
      },
    );
  });

  it("does not leave a dangling timer after a fast resolve", async () => {
    const ac = new AbortController();
    const before = (process as any)._getActiveHandles?.().length ?? 0;
    await createCompletionWithTimeout(async () => "ok", ac.signal, 10_000);
    await sleep(20);
    const after = (process as any)._getActiveHandles?.().length ?? 0;
    // The 10s timer must have been cleared, not left pending.
    assert.ok(after <= before + 1);
  });
});
