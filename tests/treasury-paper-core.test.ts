import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePaperOptions, replayPaper, paperSnapshot, paperReviewParameters, type PaperBar } from "../server/lib/treasury-paper-core";

const bars: PaperBar[] = Array.from({ length: 70 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
  open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1000,
}));
test("review shapes token/temperature parameters for the SERVED model, including free GPT fallback",()=>{
  assert.deepEqual(paperReviewParameters("gpt-5.4"),{max_completion_tokens:800});
  assert.deepEqual(paperReviewParameters("openai/gpt-5.4-mini"),{max_completion_tokens:800});
  assert.deepEqual(paperReviewParameters("meta/muse-spark-1.3"),{max_tokens:800,temperature:0.2});
});

test("crypto pairs and four frozen strategies normalize without adding live execution options",()=>{
  for(const symbol of ["BTC-USD","ETH-USD","SOL-USD"])
    for(const strategy of ["trend","reversion","breakout","rsi"])
      assert.equal(normalizePaperOptions({symbol,strategy}).strategy,strategy);
  assert.throws(()=>normalizePaperOptions({symbol:"https://exchange.test/BTC"}));
});
test("breakout excludes the signal bar from its prior-high threshold and retains an open signal until SMA10 exit",()=>{
  const prefix=bars.slice(0,40).map(b=>({...b}));
  const threshold=Math.max(...prefix.slice(-21,-1).map(b=>b.high));
  prefix.at(-1)!.close=threshold+5; prefix.at(-1)!.high=threshold+6;
  const entry=paperSnapshot(prefix,"breakout");
  assert.equal(entry.priorHigh20,threshold);
  assert.equal(entry.ruleTarget,"long");
  prefix.at(-1)!.close=threshold-0.5;
  assert.equal(paperSnapshot(prefix,"breakout",252,"cash").ruleTarget,"cash");
  assert.equal(paperSnapshot(prefix,"breakout",252,"long").ruleTarget,"long");
  prefix.at(-1)!.close=50;
  assert.equal(paperSnapshot(prefix,"breakout",252,"long").ruleTarget,"cash");
});
test("rolling RSI14 rebound enters below30, retains neutral state, exits above55; flat prices return50",()=>{
  const prefix=bars.slice(0,40).map(b=>({...b,close:100}));
  assert.equal(paperSnapshot(prefix,"rsi").rsi14,50);
  assert.equal(paperSnapshot(prefix,"rsi",252,"long").ruleTarget,"long");
  assert.equal(paperSnapshot(prefix,"rsi",252,"cash").ruleTarget,"cash");
  prefix.slice(-15).forEach((b,i)=>{b.close=100-i;});
  assert.equal(paperSnapshot(prefix,"rsi").ruleTarget,"long");
  prefix.slice(-15).forEach((b,i)=>{b.close=100+i;});
  assert.equal(paperSnapshot(prefix,"rsi",252,"long").ruleTarget,"cash");
});
test("crypto annualized volatility uses365 daily bars, equities252; scored weekends are retained",async()=>{
  const stock=paperSnapshot(bars.slice(0,50),"trend");
  const crypto=paperSnapshot(bars.slice(0,50),"trend",365);
  assert.ok(Math.abs(crypto.volatilityPct/stock.volatilityPct-Math.sqrt(365/252))<1e-10);
  const result=await replayPaper(bars,normalizePaperOptions({symbol:"BTC-USD",strategy:"breakout"}));
  assert.equal(result.evaluationBars,20);
  assert.equal(result.rule.equity.length,20);
  assert.ok(result.limitations.some(l=>l.includes("365")));
});

test("strict options reject type confusion, excess exposure, unknown presets and unsafe symbols", () => {
  for (const patch of [{ capital: "10000" }, { feeBps: NaN }, { slippageBps: -1 }, { symbol: "../etc" }, { strategy: "generated-code" }, { mode: "live" }]) {
    assert.throws(() => normalizePaperOptions({ ...patch }));
  }
});
test("signals use causal prefixes and fill at the next open, not the signal close", async () => {
  const seen: number[] = [];
  const result = await replayPaper(bars, normalizePaperOptions({ symbol: "AAPL", mode: "jev_shadow" }), async snapshot => {
    seen.push(snapshot.sourceBars);
    assert.equal(snapshot.asOf, bars[snapshot.sourceBars - 1].date);
    assert.equal(snapshot.close, bars[snapshot.sourceBars - 1].close);
    return { target: "long", probability: 0.8, confidence: 0.9 };
  });
  assert.equal(seen.length, 20);
  const fill = result.rule.fills[0];
  assert.ok(fill.fillDate > fill.signalDate);
  assert.equal(fill.referencePrice, bars.find(bar => bar.date === fill.fillDate)!.open);
  assert.ok(result.rule.metrics.costsUsd > 0);
  assert.equal(result.shadow!.coverage.completed, 20);
});
test("future changes do not change earlier actions and fills", async () => {
  const options = normalizePaperOptions({});
  const base = await replayPaper(bars, options);
  const modified = await replayPaper(bars.map((b, i) => i < 65 ? b : { ...b, open: b.open * 2, high: b.high * 2, low: b.low * 2, close: b.close * 2 }), options);
  assert.deepEqual(base.rule.fills.filter(f => f.fillDate < bars[65].date), modified.rule.fills.filter(f => f.fillDate < bars[65].date));
});
test("provider gaps are explicitly incomplete and do not masquerade as successful shadow coverage", async () => {
  const result = await replayPaper(bars, normalizePaperOptions({ mode: "jev_shadow" }), async () => { throw new Error("unavailable"); });
  assert.equal(result.shadow!.coverage.completed, 0);
  assert.equal(result.shadow!.coverage.failed, 20);
  assert.equal(result.shadow!.evaluationStatus, "incomplete");
  assert.ok(Number.isFinite(result.rule.metrics.netReturnPct));
});
test("invalid, duplicate, unordered, future and insufficient data fail closed", async () => {
  for (const invalid of [bars.slice(0, 10), [...bars, bars[69]], [...bars].reverse(),
    bars.map((b,i)=>i===60?{...b,open:0}:b), bars.map((b,i)=>i===69?{...b,date:"2999-01-01"}:b)]) {
    await assert.rejects(replayPaper(invalid, normalizePaperOptions({})));
  }
});
test("deterministic arithmetic matches a hand-computed buy-and-hold entry without fees", async () => {
  const result=await replayPaper(bars,normalizePaperOptions({feeBps:0,slippageBps:0}));
  const shares=Math.floor(2500/bars[50].open*1e6)/1e6;
  assert.equal(result.rule.metrics.endEquityUsd,10000-shares*bars[50].open+shares*bars[69].close);
  assert.deepEqual(result.rule.metrics,result.benchmark.metrics);
  assert.equal(result.rule.metrics.winRatePct,null); // Still open, not a invented winning closed trade.
});
test("drawdown exits on next open and never re-enters, even after recovery", async () => {
  const shocked=bars.map((b,i)=>i===53?{...b,open:40,high:41,low:29,close:30}:b);
  const result=await replayPaper(shocked,normalizePaperOptions({}));
  assert.equal(result.rule.metrics.stopped,true);
  assert.ok(result.rule.metrics.maxDrawdownPct>10); // An overnight gap can overshoot.
  assert.equal(result.rule.fills.at(-1)!.side,"sell");
  assert.equal(result.rule.fills.at(-1)!.signalDate,bars[53].date);
  assert.equal(result.rule.fills.at(-1)!.fillDate,bars[54].date);
  assert.equal(result.rule.fills.length,2);
});
