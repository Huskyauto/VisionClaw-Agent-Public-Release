// Minimal node:test shim for the vitest matcher subset used by the model-tier
// unit tests. These files were authored against `vitest`, which is NOT a
// dependency of this project (the runner is `node --test`, see tests/run.sh),
// so they silently never executed — illusory coverage. Rather than add a new
// dependency, this shim re-exports node:test's describe/it/lifecycle hooks and
// implements the exact (synchronous) matcher subset these hermetic tests use
// (including `.not` negation), so they run under the existing runner.
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

export { describe, it, before, after, beforeEach, afterEach };

const fmt = (v: unknown) => {
  try { return typeof v === "string" ? `"${v}"` : JSON.stringify(v); } catch { return String(v); }
};

// Runs a positive assertion thunk. When `negate` is true, the assertion is
// inverted: the test passes iff the thunk THROWS. The positive path calls the
// thunk directly so node:assert's detailed diff surfaces on failure.
function run(thunk: () => void, negate: boolean, negMsg: string) {
  if (!negate) { thunk(); return; }
  let passed = true;
  try { thunk(); } catch { passed = false; }
  if (passed) throw new assert.AssertionError({ message: negMsg });
}

function matchers(received: any, negate: boolean) {
  return {
    toBe: (e: unknown) => run(() => assert.strictEqual(received, e), negate, `expected ${fmt(received)} not to be ${fmt(e)}`),
    toEqual: (e: unknown) => run(() => assert.deepStrictEqual(received, e), negate, `expected value not to deep-equal ${fmt(e)}`),
    toStrictEqual: (e: unknown) => run(() => assert.deepStrictEqual(received, e), negate, `expected value not to deep-equal ${fmt(e)}`),
    toContain: (e: unknown) => run(() => {
      if (typeof received === "string") {
        assert.ok(received.includes(String(e)), `expected ${fmt(received)} to contain ${fmt(e)}`);
      } else {
        assert.ok(Array.isArray(received) && received.includes(e), `expected ${fmt(received)} to contain ${fmt(e)}`);
      }
    }, negate, `expected ${fmt(received)} not to contain ${fmt(e)}`),
    toThrow: (e?: unknown) => run(() => {
      if (e === undefined) assert.throws(received);
      else if (e instanceof RegExp) assert.throws(received, e);
      else assert.throws(received, (err: any) => String(err?.message ?? err).includes(String(e)));
    }, negate, `expected function not to throw`),
    toHaveLength: (e: number) => run(() => assert.strictEqual((received as any).length, e), negate, `expected length not to be ${e}`),
    toBeCloseTo: (e: number, numDigits = 2) => run(() => {
      const diff = Math.abs(received - e);
      assert.ok(diff < Math.pow(10, -numDigits) / 2, `expected ${received} to be close to ${e} (±${numDigits} digits)`);
    }, negate, `expected ${received} not to be close to ${e}`),
    toBeGreaterThan: (e: number) => run(() => assert.ok(received > e, `expected ${received} > ${e}`), negate, `expected ${received} not > ${e}`),
    toBeGreaterThanOrEqual: (e: number) => run(() => assert.ok(received >= e, `expected ${received} >= ${e}`), negate, `expected ${received} not >= ${e}`),
    toBeLessThan: (e: number) => run(() => assert.ok(received < e, `expected ${received} < ${e}`), negate, `expected ${received} not < ${e}`),
    toBeLessThanOrEqual: (e: number) => run(() => assert.ok(received <= e, `expected ${received} <= ${e}`), negate, `expected ${received} not <= ${e}`),
    toBeNull: () => run(() => assert.strictEqual(received, null), negate, `expected ${fmt(received)} not to be null`),
    toBeUndefined: () => run(() => assert.strictEqual(received, undefined), negate, `expected value not to be undefined`),
    toBeDefined: () => run(() => assert.notStrictEqual(received, undefined), negate, `expected value not to be defined`),
    toBeTruthy: () => run(() => assert.ok(received, `expected ${fmt(received)} to be truthy`), negate, `expected ${fmt(received)} not to be truthy`),
    toBeFalsy: () => run(() => assert.ok(!received, `expected ${fmt(received)} to be falsy`), negate, `expected ${fmt(received)} not to be falsy`),
    toMatch: (e: RegExp | string) => run(() => {
      const re = e instanceof RegExp ? e : new RegExp(String(e));
      assert.ok(re.test(String(received)), `expected ${fmt(received)} to match ${re}`);
    }, negate, `expected ${fmt(received)} not to match ${e}`),
  };
}

export function expect(received: any) {
  const positive = matchers(received, false);
  return Object.assign(positive, { not: matchers(received, true) });
}
