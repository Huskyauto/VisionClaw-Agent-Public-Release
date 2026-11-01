import test from "node:test";
import assert from "node:assert/strict";
import { renderCompanyResearchPage } from "../../server/lib/company-research-browser";

test("second browser renders only socket-pinned HTML with scripts off and ALL website networking blocked", async () => {
  const events: string[] = [];
  let handler: (request: any) => void = () => { throw new Error("missing network guard"); };
  const page = {
    setJavaScriptEnabled: async (enabled: boolean) => { assert.equal(enabled, false); events.push("scripts-off"); },
    setRequestInterception: async () => { events.push("interception"); },
    on: (_event: string, listener: any) => { handler = listener; },
    setContent: async () => {
      for (const target of ["http://127.0.0.1/", "http://169.254.169.254/", "https://rebind.example/", "https://public.example/asset"]) {
        handler({ url: () => target, abort: async () => { events.push("blocked"); },
          continue: () => { throw new Error("browser network must never be enabled"); } });
      }
      events.push("rendered");
    },
    evaluate: async () => ({ snapshot: "Public company services and operating information. ".repeat(5), html: "<main>Safe facts</main>" }),
  };
  const deps: any = {
    loadConfig: () => ({ enabled: true, defaultProfile: "remote", profiles: { remote: { cdpUrl: "wss://renderer.example/" } } }),
    fetch: async (_url: string, options: any) => {
      assert.equal(options.maxRedirects, 2); assert.equal(options.maxBytes, 300_000); events.push("pinned-fetch");
      return { ok: true, finalUrl: "https://example.com/services/", text: "<main>Safe facts</main>" };
    },
    connect: async () => ({ createBrowserContext: async () => ({ newPage: async () => page,
      close: async () => { events.push("closed"); } }), disconnect: async () => { events.push("disconnected"); } }),
  };
  const result = await renderCompanyResearchPage("https://example.com/", deps);
  assert.equal(result.ok, true);
  assert.equal(events.filter(event => event === "blocked").length, 4);
  assert.ok(events.indexOf("scripts-off") < events.indexOf("rendered"));
  assert.deepEqual(events.slice(-2), ["closed", "disconnected"]);
  deps.fetch = async () => ({ ok: true, finalUrl: "http://127.0.0.1/", text: "Private response" });
  deps.connect = async () => { throw new Error("unsafe redirect must stop before browser connection"); };
  assert.equal((await renderCompanyResearchPage("https://example.com/", deps)).ok, false);
});
