import test from "node:test";
import assert from "node:assert/strict";
import { juryPublicSearch } from "../../server/lib/jury-public-search";

test("no-spend search retrieves attributable public RSS snippets without any paid provider", async () => {
  const urls: string[] = [];
  const result = await juryPublicSearch("maintenance reporting pricing", async (url, opts) => {
    urls.push(String(url));
    assert.equal(opts?.redirect, "manual");
    return new Response("<rss><channel><item><title>Example pricing</title><link>https://example.com/prices</link><description>Plans start at $49; not buyer validation.</description></item></channel></rss>", { status: 200 });
  });
  assert.equal(result.success, true);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].startsWith("https://www.bing.com/search?"));
  assert.ok(JSON.stringify(result).includes("https://example.com/prices"));
});

test("a throwing diagnostic sink preserves the free fallback and bounded unavailable result", async () => {
  const original = console.warn;
  console.warn = () => { throw new Error("broken sink"); };
  try {
    let calls = 0;
    const recovered = await juryPublicSearch("fixture query", async () => {
      if (++calls === 1) throw new Error("primary unavailable");
      return new Response(JSON.stringify({ query: { search: [{
        title: "Fixture evidence", snippet: "A fixed public fact",
      }] } }), { status: 200 });
    });
    assert.equal(recovered.success, true);
    assert.equal(calls, 2);
    calls = 0;
    const unavailable = await juryPublicSearch("fixture query", async () => {
      calls++;
      throw new Error("sources unavailable");
    });
    assert.equal(unavailable.success, false);
    assert.deepEqual(unavailable.results, []);
    assert.equal(calls, 2, "No paid or unbounded fallback may be introduced");
  } finally { console.warn = original; }
});
