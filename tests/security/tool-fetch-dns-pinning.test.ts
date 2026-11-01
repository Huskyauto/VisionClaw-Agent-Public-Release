import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { isIP } from "node:net";
import ts from "typescript";

function harness() {
  let lookups = 0;
  const agents: Array<{ connect: { lookup: Function } }> = [];
  const calls: string[] = [];
  const source = fs.readFileSync("server/tools/lib/safe-fetch.ts", "utf8")
    .replace('await import("dns")', "await Promise.resolve(dnsMock)");
  const exports: Record<string, any> = {};
  const context = vm.createContext({
    exports, URL, console,
    dnsMock: { promises: { lookup: async () => {
      lookups++;
      return [{ address: lookups === 1 ? "93.184.216.34" : "1.1.1.1", family: 4 }];
    } } },
    require: (name: string) => {
      if (name === "node:net") return { isIP };
      if (name === "undici") return { Agent: class {
        constructor(public options: { connect: { lookup: Function } }) { agents.push(options); }
        async close() {}
      } };
      throw new Error(`unexpected dependency: ${name}`);
    },
    fetch: async (url: string, init: any) => {
      assert.ok(init.dispatcher, "every request must have a pinned dispatcher");
      calls.push(url);
      return new Response("ok", calls.length === 1
        ? { status: 302, headers: { location: "https://redirect.example/report" } }
        : { status: 200 });
    },
  });
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return { exports, agents, calls, lookups: () => lookups };
}

test("tool fetch pins each redirect hop to its already-validated DNS answer", async () => {
  const h = harness();
  await h.exports.safeFetchFollowRedirects("https://start.example/report", {});
  assert.equal(h.lookups(), 2);
  assert.equal(h.calls.length, 2);
  assert.equal(h.agents.length, 2);
  const pinned = h.agents.map((agent) => {
    let answer: string | undefined;
    agent.connect.lookup("rebound.example", {}, (err: Error | null, address: string) => {
      assert.equal(err, null); answer = address;
    });
    return answer;
  });
  assert.deepEqual(pinned, ["93.184.216.34", "1.1.1.1"]);
});

test("tool fetch refuses a private initial URL before making any request", async () => {
  const h = harness();
  await assert.rejects(h.exports.safeFetchFollowRedirects("http://127.0.0.1/private", {}), /unsafe/i);
  assert.equal(h.calls.length, 0);
});
