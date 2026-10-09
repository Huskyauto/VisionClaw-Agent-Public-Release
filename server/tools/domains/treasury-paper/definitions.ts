import type { ToolDefinition } from "../../types";
export const treasuryPaperSimulationDefinition: ToolDefinition = {
  type:"function",function:{
    name:"treasury_paper_simulation",
    description:"Owner-only historical PAPER stock/crypto/USD simulations: BTC-USD, ETH-USD, SOL-USD; trend, reversion, breakout and rolling RSI rebound. Never real orders. Inspect saved evidence or request optional interpretation. Felix/Cassandra only. Jev shadow optional, not a calibrated trading edge. Returns pending run ID: use get until terminal. 20 attempts/day, one concurrent. Review requests Muse Spark under existing routing policy; served identity is explicit, never assumed.",
    parameters:{type:"object",additionalProperties:false,properties:{
      action:{type:"string",enum:["run","get","list","review"]},
      runId:{type:"string",description:"Exact UUID returned by run/list; required for get/review."},
      options:{type:"object",additionalProperties:false,properties:{
        symbol:{type:"string",description:"Uppercase stock ticker or crypto/USD pair: SPY, BTC-USD (Bitcoin), ETH-USD (Ethereum), SOL-USD (Solana). Crypto uses completed UTC candles including weekends, hypothetical USD cash and assumed fees/slippage. No exchange connection."},
        strategy:{type:"string",enum:["trend","reversion","breakout","rsi"],description:"Frozen rules: trend=SMA5>SMA20 and close>SMA20; reversion=close 2% below SMA20; breakout=close above PRIOR20 highs, hold until below SMA10; rsi=rolling14 RSI enter<30, hold, exit>55. Compare saved runs on identical windows/costs; do not select a winner from one overlapping sample."},mode:{type:"string",enum:["rules","jev_shadow"]},
        capital:{type:"number",minimum:100,maximum:1000000},
        feeBps:{type:"number",minimum:0,maximum:100},slippageBps:{type:"number",minimum:0,maximum:100},
      }},
    },required:["action"]},
  },
};
