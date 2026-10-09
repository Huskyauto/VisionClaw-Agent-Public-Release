import { createHash } from "node:crypto";
import type { PaperOptions, PaperBar, PaperDecision, PaperSnapshot, PaperResult, PaperTrack } from "../../shared/treasury-paper-contract";
export type { PaperBar } from "../../shared/treasury-paper-contract";
import { PAPER_STRATEGIES, paperAssetKind } from "../../shared/treasury-paper-presets";
export const PAPER_ENGINE_VERSION = "daily-causal-v2";
export const PAPER_MAX_DAYS = 20;
export function paperReviewParameters(modelId:string) {
  return /(?:^|\/)(gpt-5|o[1-9])/i.test(modelId)
    ? {max_completion_tokens:800}
    : {max_tokens:800,temperature:0.2};
}
export function derivePaperInvocationKey(tenantId:number,conversationId:number,ownerMessageId:number,options:PaperOptions):string {
  const hex=createHash("sha256").update(JSON.stringify([tenantId,conversationId,ownerMessageId,options])).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
const allocation = 0.25, drawdownLimit = 0.10;

export function normalizePaperOptions(input: unknown): PaperOptions {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Simulation options must be an object");
  const p = input as Record<string, unknown>;
  for (const key of Object.keys(p)) if (!["symbol","strategy","mode","capital","feeBps","slippageBps"].includes(key)) throw new Error(`Unknown option: ${key}`);
  const symbol = p.symbol === undefined ? "SPY" : p.symbol;
  if (typeof symbol !== "string" || !/^[A-Z]{1,5}(?:[.-][A-Z]{1,3})?$/.test(symbol)) throw new Error("Enter an uppercase stock ticker or crypto/USD pair, for example SPY or BTC-USD");
  const strategy = p.strategy ?? "trend", mode = p.mode ?? "rules";
  if (!PAPER_STRATEGIES.some(preset=>preset.id===strategy)) throw new Error("Unknown strategy preset");
  if (mode !== "rules" && mode !== "jev_shadow") throw new Error("Only rules or Jev shadow simulation is supported");
  const number = (key: string, fallback: number, min: number, max: number) => {
    const v = p[key] === undefined ? fallback : p[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`${key} must be a finite number between ${min} and ${max}`);
    return v;
  };
  return { symbol, strategy:strategy as PaperOptions["strategy"], mode, capital: number("capital",10000,100,1000000),
    feeBps: number("feeBps",10,0,100), slippageBps: number("slippageBps",5,0,100) };
}

export function validatePaperBars(bars: PaperBar[]): void {
  if (!Array.isArray(bars) || bars.length < 45 || bars.length > 90) throw new Error("Simulation requires 45–90 valid daily price bars");
  let previous = "";
  const today = new Date().toISOString().slice(0,10);
  for (const b of bars) {
    if (!b || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
        new Date(b.date).toISOString().slice(0,10) !== b.date || b.date <= previous || b.date >= today ||
        ![b.open,b.high,b.low,b.close,b.volume].every(v => typeof v === "number" && Number.isFinite(v)) ||
        Math.min(b.open,b.high,b.low,b.close) < 0.000001 || Math.max(b.open,b.high,b.low,b.close)>1000000000 || b.volume < 0 ||
        b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close) || b.high < b.low) {
      throw new Error("Price history has invalid, unordered, duplicate, future or unfinished daily bars");
    }
    previous = b.date;
  }
}

export function paperSnapshot(prefix: PaperBar[], strategy: PaperOptions["strategy"], annualizationDays=252, previousTarget:"long"|"cash"="cash"): PaperSnapshot {
  const closes = prefix.map(b => b.close), last = closes.at(-1)!;
  const mean = (n: number) => closes.slice(-n).reduce((a,b)=>a+b,0)/n;
  const sma5 = mean(5), sma20 = mean(20), sma10=mean(10);
  const returns = closes.slice(-21).slice(1).map((v,i) => v / closes.slice(-21)[i] - 1);
  const average = returns.reduce((a,b)=>a+b,0)/returns.length;
  const volatilityPct = Math.sqrt(returns.reduce((a,b)=>a+(b-average)**2,0)/returns.length)*Math.sqrt(annualizationDays)*100;
  const changes=closes.slice(-15).slice(1).map((v,i)=>v-closes.slice(-15)[i]);
  const gains=changes.reduce((sum,v)=>sum+Math.max(0,v),0), losses=changes.reduce((sum,v)=>sum+Math.max(0,-v),0);
  const rsi14=gains===0&&losses===0?50:losses===0?100:100-100/(1+gains/losses);
  const priorHigh20=Math.max(...prefix.slice(-21,-1).map(b=>b.high));
  const target = strategy === "trend" ? sma5 > sma20 && last > sma20
    : strategy==="reversion" ? last < sma20 * 0.98
    : strategy==="breakout" ? (previousTarget==="long"?last>=sma10:last>priorHigh20)
    : (rsi14<30?true:rsi14>55?false:previousTarget==="long");
  return { asOf: prefix.at(-1)!.date, sourceBars: prefix.length, close:last, sma5,sma20,
    return5Pct:(last/closes[closes.length-6]-1)*100, volatilityPct, ruleTarget:target?"long":"cash",
    rsi14,priorHigh20,sma10,volatilityAnnualizationDays:annualizationDays };
}

function track(options: PaperOptions) {
  let cash = options.capital, shares = 0, peak = options.capital, worstDrawdown = 0, stopped = false;
  let costs = 0, turnover = 0, entryCost = 0;
  const pnl: number[] = [];
  const fills: PaperTrack["fills"] = [], equity: PaperTrack["equity"] = [];
  return {
    step(target: "long" | "cash", signal: PaperSnapshot, bar: PaperBar) {
      const effective = stopped ? "cash" : target;
      const side = effective === "long" && shares === 0 ? "buy" : effective === "cash" && shares > 0 ? "sell" : null;
      if (side) {
        const price = bar.open * (1 + (side === "buy" ? 1 : -1) * options.slippageBps / 10000);
        const quantity = side === "buy" ? Math.floor(cash * allocation / (price * (1 + options.feeBps/10000)) * 1e6)/1e6 : shares;
        const gross = quantity * price, fee = gross * options.feeBps/10000;
        const slippage = quantity * Math.abs(price-bar.open);
        if (side === "buy") { cash -= gross + fee; shares = quantity; entryCost = gross + fee; }
        else { cash += gross-fee; shares=0; pnl.push(gross-fee-entryCost); }
        costs += fee + slippage; turnover += gross;
        fills.push({ signalDate:signal.asOf,fillDate:bar.date,side,shares:quantity,referencePrice:bar.open,price,feeUsd:fee,slippageUsd:slippage,reason:stopped?"drawdown stop (next open)":"preset/shadow target" });
      }
      const value = cash + shares * bar.close;
      peak = Math.max(peak,value);
      const dd = (peak-value)/peak; worstDrawdown = Math.max(worstDrawdown,dd);
      if (dd >= drawdownLimit) stopped=true;
      equity.push({date:bar.date,equityUsd:value});
    },
    result(): PaperTrack {
      const end = equity.at(-1)?.equityUsd ?? options.capital;
      const wins = pnl.filter(p=>p>0), losses = pnl.filter(p=>p<0);
      const lossTotal = -losses.reduce((a,b)=>a+b,0);
      return { fills,equity,metrics:{endEquityUsd:end,pnlUsd:end-options.capital,netReturnPct:(end/options.capital-1)*100,
        maxDrawdownPct:worstDrawdown*100,closedTrades:pnl.length,winRatePct:pnl.length?wins.length/pnl.length*100:null,
        profitFactor:lossTotal>0?wins.reduce((a,b)=>a+b,0)/lossTotal:null,costsUsd:costs,turnoverUsd:turnover,
        openPositionShares:shares,stopped} };
    },
  };
}

export async function replayPaper(bars: PaperBar[], options: PaperOptions,
  judge?: (snapshot: PaperSnapshot) => Promise<PaperDecision>): Promise<PaperResult> {
  validatePaperBars(bars);
  const first = bars.length - PAPER_MAX_DAYS;
  const rule = track(options), benchmark = track(options), shadow = track(options);
  const coverage = {planned:20,completed:0,failed:0,lowConfidence:0};
  const usage = { inputTokens:0,outputTokens:0 }, decisions: NonNullable<PaperResult["shadow"]>["decisions"] = [];
  let brierSum = 0, brierCount = 0;
  let previousRuleTarget:"long"|"cash"="cash";
  for (let index = first; index < bars.length; index++) {
    const snapshot = paperSnapshot(bars.slice(0,index),options.strategy,paperAssetKind(options.symbol)==="crypto"?365:252,previousRuleTarget);
    previousRuleTarget=snapshot.ruleTarget;
    rule.step(snapshot.ruleTarget,snapshot,bars[index]);
    benchmark.step("long",snapshot,bars[index]);
    if (options.mode === "jev_shadow") {
      let target: "long" | "cash" = "cash";
      try {
        if (!judge) throw new Error("Jev shadow provider was not supplied");
        const d = await judge(snapshot);
        if (!["long","cash"].includes(d.target) || typeof d.confidence !== "number" || !Number.isFinite(d.confidence) ||
            d.confidence < 0 || d.confidence > 1 || typeof d.probability !== "number" ||
            !Number.isFinite(d.probability) || d.probability < 0 || d.probability > 1) throw new Error("Invalid Jev shadow judgment");
        coverage.completed++;
        target = d.confidence >= 0.6 ? d.target : "cash";
        if (d.confidence < 0.6) coverage.lowConfidence++;
        usage.inputTokens += d.inputTokens ?? 0; usage.outputTokens += d.outputTokens ?? 0;
        const outcome = bars[index].close > snapshot.close ? 1 : 0;
        brierSum += (d.probability-outcome)**2; brierCount++;
        decisions.push({date:snapshot.asOf,target,probability:d.probability,confidence:d.confidence,
          latencyMs:d.latencyMs,servedModel:d.servedModel,regime:d.regime,riskProbability:d.riskProbability});
      } catch {
        coverage.failed++; decisions.push({date:snapshot.asOf,target:"cash",probability:null,confidence:null,error:"Jev unavailable or invalid; cash-only shadow step"});
      }
      shadow.step(target,snapshot,bars[index]);
    }
  }
  const ruleResult = rule.result(), benchmarkResult=benchmark.result();
  return {engineVersion:PAPER_ENGINE_VERSION,strategyVersion:`${options.strategy}-frozen-v1`,options,
    dataDigest:createHash("sha256").update(JSON.stringify(bars)).digest("hex"),startDate:bars[first].date,endDate:bars.at(-1)!.date,
    sourceBars:bars.length,warmupBars:first,evaluationBars:20,rule:ruleResult,benchmark:benchmarkResult,
    excessReturnPct:ruleResult.metrics.netReturnPct-benchmarkResult.metrics.netReturnPct,
    shadow:options.mode==="jev_shadow"?{...shadow.result(),coverage,usage,decisions,
      evaluationStatus:coverage.failed?"incomplete":"complete",directionBrierScore:brierCount?brierSum/brierCount:null,directionSamples:brierCount}:null,
    limitations:["Historical replay, not forward paper trading or live trading. No profitability guarantee.",
      paperAssetKind(options.symbol)==="crypto"?"Crypto/USD uses completed UTC daily candles including weekends; annualized volatility uses 365 days. USD cash is hypothetical, not a stablecoin holding. Exchange fees/spreads may be higher than the inputs; no funding, staking or exchange execution is modeled.":"Equity annualized volatility uses 252 trading days.",
      "Daily free feeds may be delayed/unadjusted; corporate actions and intraday execution are not modeled.",
      "Frozen presets; final 20 bars are evaluation only. No parameter optimization or LLM strategy fitting.",
      "Long/cash only; 25% entry allocation. Appreciation can increase exposure; no leverage/shorting.",
      "10% end-of-day drawdown stop exits at the next open. Overnight gaps can exceed that threshold.",
      "Benchmark holds a 25% entry allocation subject to the same drawdown stop and costs; remaining cash earns no interest. Open positions are marked-to-market, not closed trades.",
      "Jev shadow confidence is not financial calibration; missing/uncertain decisions use cash, never the rule portfolio.",
      "Trading P&L deducts fees/slippage, not inference or data-subscription costs. Jev usage is recorded; this is not all-in operational profit.",
      "Repeated replays can share overlapping bars; do not count repeated windows as independent performance evidence.",
      "Directional Brier score measures close-to-close direction, not a profitable trade probability; small historical samples may reflect model training exposure."] };
}
