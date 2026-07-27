import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Forecast {
  symbol: string; horizonDays: number;
  trend: "bullish" | "bearish" | "neutral"; confidence: number;
  reasoning: string;
  recentBars: Array<{ date: string; close: number }>;
  asOf: string;
}
interface Portfolio {
  totalValueUsd: number;
  positions: Array<{ symbol: string; shares: number; lastPrice: number; valueUsd: number; weightPct: number }>;
  concentrationRisk: string; diversificationScore: number;
  recommendations: string[]; asOf: string;
}

async function postJson<T>(url: string, body: any): Promise<T> {
  const res = await apiRequest("POST", url, body);
  const j: any = await res.json();
  if (j?.error) throw new Error(j.error);
  return j as T;
}

function TrendIcon({ trend }: { trend: string }) {
  if (trend === "bullish") return <TrendingUp className="h-5 w-5 text-green-600" />;
  if (trend === "bearish") return <TrendingDown className="h-5 w-5 text-red-600" />;
  return <Minus className="h-5 w-5 text-muted-foreground" />;
}

export default function TreasuryPage() {
  const [symbol, setSymbol] = useState("AAPL");
  const [horizonDays, setHorizonDays] = useState(30);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [holdingsRaw, setHoldingsRaw] = useState("AAPL,10\nMSFT,5\nNVDA,3");
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);

  const forecastMut = useMutation({
    mutationFn: () => postJson<Forecast>("/api/treasury/forecast", { symbol, horizonDays }),
    onSuccess: (data) => setForecast(data),
  });

  const portfolioMut = useMutation({
    mutationFn: () => {
      const holdings = holdingsRaw.split("\n").map(line => {
        const [sym, sh] = line.split(",").map(s => s.trim());
        return { symbol: sym, shares: parseFloat(sh) };
      }).filter(h => h.symbol && Number.isFinite(h.shares) && h.shares > 0);
      if (holdings.length === 0) throw new Error("Enter at least one holding (format: SYMBOL,SHARES per line)");
      return postJson<Portfolio>("/api/treasury/portfolio", { holdings });
    },
    onSuccess: (data) => setPortfolio(data),
  });

  return (
    <div className="h-full overflow-y-auto container mx-auto py-6 max-w-6xl space-y-6" data-testid="page-treasury">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">Treasury & Market Intelligence</h1>
        <p className="text-muted-foreground mt-1">Directional forecasts and portfolio diagnostics. Structural analysis only — never buy/sell advice.</p>
      </div>

      <Card data-testid="card-disclaimer" className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
        <CardContent className="pt-4 flex gap-2 items-start text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-amber-900 dark:text-amber-200">
            Educational analysis only — not personalized investment advice. Forecasts use 90 days of free Stooq OHLC data + LLM technical reasoning. Confidence is calibrated, not guaranteed. Portfolio holdings (symbols + share counts) are sent to the LLM provider for diversification analysis — do not enter holdings you consider confidential.
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-forecast">
        <CardHeader><CardTitle>Forecast a Ticker</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-muted-foreground">Symbol</label>
              <Input data-testid="input-forecast-symbol" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="AAPL" />
            </div>
            <div className="w-32">
              <label className="text-xs text-muted-foreground">Horizon (days)</label>
              <Input data-testid="input-forecast-horizon" type="number" value={horizonDays} onChange={e => setHorizonDays(Number(e.target.value) || 30)} />
            </div>
            <Button data-testid="button-run-forecast" onClick={() => forecastMut.mutate()} disabled={forecastMut.isPending || !symbol.trim()}>
              {forecastMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Forecast
            </Button>
          </div>
          {forecastMut.error ? <div className="text-sm text-red-600" data-testid="text-forecast-error">{(forecastMut.error as Error).message}</div> : null}
          {forecast ? (
            <div className="space-y-3 border rounded-md p-4" data-testid={`forecast-result-${forecast.symbol}`}>
              <div className="flex items-center gap-3">
                <TrendIcon trend={forecast.trend} />
                <div className="text-xl font-semibold" data-testid="text-forecast-symbol">{forecast.symbol}</div>
                <Badge data-testid="badge-trend" variant={forecast.trend === "bullish" ? "default" : forecast.trend === "bearish" ? "destructive" : "secondary"}>
                  {forecast.trend.toUpperCase()}
                </Badge>
                <Badge variant="outline" data-testid="badge-confidence">Confidence: {(forecast.confidence * 100).toFixed(0)}%</Badge>
                <Badge variant="outline" data-testid="badge-horizon">Horizon: {forecast.horizonDays}d</Badge>
              </div>
              <div className="text-sm" data-testid="text-forecast-reasoning">{forecast.reasoning}</div>
              <div className="text-xs text-muted-foreground" data-testid="text-recent-closes">
                Last 10 closes: {forecast.recentBars.map(b => `$${b.close.toFixed(2)}`).join(" → ")}
              </div>
              <div className="text-xs text-muted-foreground">As of {new Date(forecast.asOf).toLocaleString()}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card data-testid="card-portfolio">
        <CardHeader><CardTitle>Analyze a Portfolio</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Holdings (one per line, format: SYMBOL,SHARES)</label>
            <textarea
              data-testid="textarea-holdings"
              className="w-full border rounded-md p-2 font-mono text-sm bg-background"
              rows={5}
              value={holdingsRaw}
              onChange={e => setHoldingsRaw(e.target.value)}
            />
          </div>
          <Button data-testid="button-analyze-portfolio" onClick={() => portfolioMut.mutate()} disabled={portfolioMut.isPending}>
            {portfolioMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Analyze
          </Button>
          {portfolioMut.error ? <div className="text-sm text-red-600" data-testid="text-portfolio-error">{(portfolioMut.error as Error).message}</div> : null}
          {portfolio ? (
            <div className="space-y-3 border rounded-md p-4" data-testid="portfolio-result">
              <div className="flex flex-wrap gap-2 items-center">
                <div className="text-2xl font-bold" data-testid="text-portfolio-value">${portfolio.totalValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <Badge data-testid="badge-concentration" variant={portfolio.concentrationRisk === "HIGH" ? "destructive" : portfolio.concentrationRisk === "MODERATE" ? "secondary" : "default"}>
                  Concentration: {portfolio.concentrationRisk}
                </Badge>
                <Badge variant="outline" data-testid="badge-diversification">Diversification: {portfolio.diversificationScore}/100</Badge>
              </div>
              <div className="space-y-1">
                {portfolio.positions.map(p => (
                  <div key={p.symbol} className="flex justify-between text-sm border-b py-1" data-testid={`row-position-${p.symbol}`}>
                    <span className="font-mono">{p.symbol}</span>
                    <span>{p.shares} sh @ ${p.lastPrice.toFixed(2)}</span>
                    <span>${p.valueUsd.toFixed(2)}</span>
                    <span className="text-muted-foreground">{p.weightPct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Recommendations</div>
                <ul className="list-disc pl-5 text-sm">
                  {portfolio.recommendations.map((r, i) => <li key={i} data-testid={`text-recommendation-${i}`}>{r}</li>)}
                </ul>
              </div>
              <div className="text-xs text-muted-foreground">As of {new Date(portfolio.asOf).toLocaleString()}</div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
