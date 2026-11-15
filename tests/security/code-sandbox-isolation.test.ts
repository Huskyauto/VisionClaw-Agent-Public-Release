import test from "node:test";
import assert from "node:assert/strict";
import { executeCode } from "../../server/code-sandbox";

test("submitted JavaScript returns asynchronously from an isolated runtime", async () => {
  const pending = executeCode("__result__ = 21 * 2;");
  assert.ok(pending instanceof Promise, "execution must not run on the host event loop");
  const result = await pending;
  assert.equal(result.success, true);
  assert.equal(result.returnValue, 42);
});

test("promise, async and thrown-getter loops cannot freeze the parent", async () => {
  for (const code of [
    "Promise.resolve().then(() => { while (true) {} });",
    "(async () => { await 0; while (true) {} })();",
    'throw { get message() { while (true) {} } };',
  ]) {
    let ticks = 0;
    const interval = setInterval(() => ticks++, 20);
    const start = Date.now();
    try {
      const result = await executeCode(code);
      assert.equal(result.success, false);
      assert.ok(ticks > 2, "parent event loop must remain responsive");
      assert.ok(Date.now() - start < 8000, "independent execution deadline");
    } finally { clearInterval(interval); }
  }
});

test("heap and external-memory exhaustion stay in the disposable child", async () => {
  for (const code of [
    "const arrays = []; while (true) arrays.push(new Array(1000000).fill(1));",
    "__result__ = new Uint8Array(2 ** 30).length;",
  ]) {
    const result = await executeCode(code);
    assert.equal(result.success, false);
  }
  const next = await executeCode("__result__ = 7;");
  assert.equal(next.returnValue, 7, "a failed child cannot disable later execution");
});

test("sandbox capacity is bounded and no unbounded waiting queue is created", async () => {
  const code = "const end = Date.now() + 400; while (Date.now() < end) {} __result__ = 1;";
  const first = executeCode(code);
  const second = executeCode(code);
  const denied = await executeCode(code);
  assert.equal(denied.success, false);
  assert.match(denied.error!, /capacity/);
  assert.equal((await first).success, true);
  assert.equal((await second).success, true);
});
