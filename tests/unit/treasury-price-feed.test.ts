import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { fetchPriceHistory } from "../../server/treasury";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("Treasury reads daily OHLC bars from the Yahoo chart feed", async () => {
  let requestedUrl = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      chart: {
        result: [{
          timestamp: [1787342400, 1787428800],
          indicators: {
            quote: [{
              open: [301.1, 302.2],
              high: [303.4, 304.5],
              low: [300.2, 301.3],
              close: [302.3, 303.4],
              volume: [1000, 2000],
            }],
          },
        }],
        error: null,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const bars = await fetchPriceHistory("VTSTK");

  assert.match(requestedUrl, /query1\.finance\.yahoo\.com\/v8\/finance\/chart\/VTSTK/);
  assert.deepEqual(bars.map(({ date, close, volume }) => ({ date, close, volume })), [
    { date: "2026-08-21", close: 302.3, volume: 1000 },
    { date: "2026-08-22", close: 303.4, volume: 2000 },
  ]);
});

test("Treasury skips incomplete Yahoo bars instead of coercing a missing close to zero", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    chart: {
      result: [{
        timestamp: [1787342400, 1787428800],
        indicators: {
          quote: [{
            open: [301.1, null],
            high: [303.4, null],
            low: [300.2, null],
            close: [302.3, null],
            volume: [1000, null],
          }],
        },
      }],
      error: null,
    },
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  const bars = await fetchPriceHistory("VTNULL");

  assert.deepEqual(bars.map(bar => bar.close), [302.3]);
});

test("Treasury skips Yahoo bars with incomplete OHLC fields", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    chart: {
      result: [{
        timestamp: [1787342400, 1787428800],
        indicators: {
          quote: [{
            open: [301.1, 302.2],
            high: [303.4, null],
            low: [300.2, 301.3],
            close: [302.3, 303.4],
            volume: [1000, 2000],
          }],
        },
      }],
      error: null,
    },
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  const bars = await fetchPriceHistory("VTOHLC");

  assert.deepEqual(bars.map(bar => bar.close), [302.3]);
});

test("Treasury skips invalid Stooq close values when Yahoo is unavailable", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).includes("query1.finance.yahoo.com")) {
      return new Response("temporarily unavailable", { status: 503 });
    }
    return new Response([
      "Date,Open,High,Low,Close,Volume",
      "2026-08-21,10,11,9,0,1000",
      "2026-08-22,10,11,9,10.5,2000",
    ].join("\n"), { status: 200, headers: { "content-type": "text/csv" } });
  }) as typeof fetch;

  const bars = await fetchPriceHistory("VTSTOOQ");

  assert.deepEqual(bars.map(bar => bar.close), [10.5]);
});

test("Treasury never exposes provider HTML when no market-data feed is usable", async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("query1.finance.yahoo.com")) {
      return new Response("temporarily unavailable", { status: 503 });
    }
    return new Response("<!doctype html><html><body>verification page</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;

  await assert.rejects(
    () => fetchPriceHistory("VTERR"),
    (error: Error) => {
      assert.match(error.message, /^Market data unavailable for "VTERR":/);
      assert.doesNotMatch(error.message, /<!doctype|html>|Unexpected CSV format/i);
      return true;
    },
  );
});