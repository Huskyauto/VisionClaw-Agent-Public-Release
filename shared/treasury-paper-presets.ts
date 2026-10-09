/** Frozen, code-owned research presets. Neither models nor callers can edit rules. */
export const PAPER_ASSETS = [
  {symbol:"SPY",label:"US stocks · SPY"},
  {symbol:"BTC-USD",label:"Bitcoin · BTC"},
  {symbol:"ETH-USD",label:"Ethereum · ETH"},
  {symbol:"SOL-USD",label:"Solana · SOL"},
] as const;
export const PAPER_STRATEGIES = [
  {id:"trend",label:"Trend following",description:"Long when SMA5 exceeds SMA20 and the close exceeds SMA20; otherwise cash."},
  {id:"reversion",label:"Mean reversion",description:"Long while the close is more than 2% below SMA20; otherwise cash."},
  {id:"breakout",label:"20-day breakout",description:"Enter above the previous 20 daily highs; hold until the close falls below SMA10."},
  {id:"rsi",label:"RSI rebound",description:"Rolling RSI14: enter below 30, hold through neutral readings, exit above 55."},
] as const;
export type PaperStrategy = typeof PAPER_STRATEGIES[number]["id"];
export const paperAssetKind = (symbol:string):"crypto"|"stock" => symbol.endsWith("-USD")?"crypto":"stock";
