import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import type { PaperOptions, PaperRun } from "@shared/treasury-paper-contract";
import { PAPER_ASSETS, PAPER_STRATEGIES } from "@shared/treasury-paper-presets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

type PaperStatus = { enabled: boolean; jevReady: boolean };

function strategyLabel(strategy: string) {
  return PAPER_STRATEGIES.find(preset => preset.id === strategy)?.label ?? strategy;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await apiRequest("GET", url);
  return response.json() as Promise<T>;
}
async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await apiRequest("POST", url, body);
  return response.json() as Promise<T>;
}
function metricValue(value: unknown, suffix = "") {
  return value === null || value === undefined ? "Not defined" : `${typeof value==="number"?value.toLocaleString(undefined,{maximumFractionDigits:4}):String(value)}${suffix}`;
}
function Metrics({ label, track }: { label: string; track: NonNullable<PaperRun["result"]>["rule"] }) {
  const metrics = track.metrics;
  const rows: [string, unknown, string][] = [
    ["End equity", metrics.endEquityUsd, " USD"], ["P&L", metrics.pnlUsd, " USD"],
    ["Net return", metrics.netReturnPct, "%"], ["Max drawdown", metrics.maxDrawdownPct, "%"],
    ["Closed trades", metrics.closedTrades, ""], ["Win rate", metrics.winRatePct, "%"],
    ["Profit factor", metrics.profitFactor, ""], ["Costs", metrics.costsUsd, " USD"],
    ["Turnover", metrics.turnoverUsd, " USD"], ["Open position", metrics.openPositionShares, " shares"],
    ["Stopped", metrics.stopped, ""],
  ];
  return <section className="space-y-2" data-testid={`paper-metrics-${label}`}>
    <h4 className="font-medium">{label} metrics</h4>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
      {rows.map(([name, value, suffix]) => <div key={name} className="flex justify-between gap-2 border-b py-1">
        <dt className="text-muted-foreground">{name}</dt><dd className="font-mono text-right">{metricValue(value, suffix)}</dd>
      </div>)}
    </dl>
  </section>;
}
function TrackTables({ label, track }: { label: string; track: NonNullable<PaperRun["result"]>["rule"] }) {
  return <div className="space-y-4" data-testid={`paper-tables-${label}`}>
    <div>
      <h4 className="mb-2 font-medium">{label} fills ({track.fills.length})</h4>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs">
        <thead><tr>{["Signal date", "Fill date", "Side", "Shares", "Reference", "Price", "Fee", "Slippage", "Reason"].map(x => <th key={x} className="border-b p-2">{x}</th>)}</tr></thead>
        <tbody>{track.fills.map((fill, i) => <tr key={`${fill.fillDate}-${i}`} className="border-b">
          {[fill.signalDate, fill.fillDate, fill.side, fill.shares, fill.referencePrice, fill.price, fill.feeUsd, fill.slippageUsd, fill.reason].map((v, j) => <td key={j} className="p-2">{String(v)}</td>)}
        </tr>)}</tbody>
      </table></div>
    </div>
    <div>
      <h4 className="mb-2 font-medium">{label} equity ({track.equity.length} points)</h4>
      <div className="max-h-56 overflow-auto"><table className="w-full text-left text-xs">
        <thead><tr><th className="border-b p-2">Date</th><th className="border-b p-2">Equity (USD)</th></tr></thead>
        <tbody>{track.equity.map((point, i) => <tr key={`${point.date}-${i}`} className="border-b"><td className="p-2">{point.date}</td><td className="p-2 font-mono">{point.equityUsd}</td></tr>)}</tbody>
      </table></div>
    </div>
  </div>;
}

export function TreasuryPaperPanel() {
  const tenant=useAuth().tenant;
  const isOwner = tenant?.isAdmin === true;
  const historyKey = ["/api/treasury/paper/runs",tenant?.id];
  const detailKey = (id:string) => ["/api/treasury/paper/runs",tenant?.id,id];
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = useState("SPY");
  const [strategy, setStrategy] = useState<PaperOptions["strategy"]>("trend");
  const [mode, setMode] = useState<PaperOptions["mode"]>("rules");
  const [capital, setCapital] = useState("10000");
  const [feeBps, setFeeBps] = useState("10");
  const [slippageBps, setSlippageBps] = useState("5");
  const [selectedId, setSelectedId] = useState("");
  const [runRetry, setRunRetry] = useState<{ key: string; options: PaperOptions } | null>(null);
  const [reviewRetryId, setReviewRetryId] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["/api/treasury/paper/status",tenant?.id],
    queryFn: () => getJson<PaperStatus>("/api/treasury/paper/status"),
    enabled: isOwner,
  });
  const enabled = isOwner && statusQuery.data?.enabled === true;
  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: () => getJson<{ runs: PaperRun[] }>("/api/treasury/paper/runs"),
    enabled: isOwner,
  });
  const runs = isOwner ? historyQuery.data?.runs ?? [] : [];
  const activeId = selectedId || runs[0]?.id || "";
  const selected = isOwner ? runs.find(run => run.id === activeId) : undefined;
  const detailQuery = useQuery({
    queryKey: detailKey(activeId),
    queryFn: () => getJson<PaperRun>(`/api/treasury/paper/runs/${encodeURIComponent(activeId)}`),
    enabled: isOwner && !!activeId,
    refetchInterval: query => {
      const run = query.state.data as PaperRun | undefined;
      return run && (run.status === "running" || run.reviewing) ? 2000 : false;
    },
  });
  const run = isOwner ? detailQuery.data ?? selected : undefined;
  const terminalSeen = useRef("");
  useEffect(() => {
    if (run && run.status !== "running" && !run.reviewing) {
      const signature = `${run.id}:${run.status}:${run.finished_at ?? ""}`;
      if (terminalSeen.current !== signature) {
        terminalSeen.current = signature;
        void queryClient.invalidateQueries({ queryKey: historyKey });
      }
    }
  }, [run?.id, run?.status, run?.finished_at, run?.reviewing, queryClient]);

  const submitRun = useMutation({
    mutationFn: ({ key, options }: { key: string; options: PaperOptions }) =>
      postJson<PaperRun>("/api/treasury/paper/runs", { requestKey: key, options }),
    onSuccess: (result) => {
      setRunRetry(null);
      setSelectedId(result.id);
      queryClient.setQueryData(detailKey(result.id), result);
      void queryClient.invalidateQueries({ queryKey: historyKey });
    },
  });
  const review = useMutation({
    mutationFn: (id: string) => {
      return postJson<PaperRun>(`/api/treasury/paper/runs/${encodeURIComponent(id)}/review`);
    },
    onSuccess: result => {
      setReviewRetryId(null);
      queryClient.setQueryData(detailKey(result.id), result);
      void queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError: (_error, id) => setReviewRetryId(id),
  });
  const handleRun = () => {
    if (!isOwner || !enabled) return;
    const options = runRetry?.options ?? {
      symbol: symbol.trim().toUpperCase(),
      strategy,
      mode,
      capital: Number(capital),
      feeBps: Number(feeBps),
      slippageBps: Number(slippageBps),
    };
    if (!options.symbol || !Number.isFinite(options.capital) || options.capital <= 0) return;
    const key = runRetry?.key ?? crypto.randomUUID();
    setRunRetry({ key, options });
    submitRun.mutate({ key, options });
  };
  const discardRetry = () => {
    setRunRetry(null);
    submitRun.reset();
  };
  if (!isOwner) return null;

  const result = run?.result;
  return <Card className="border-primary/20" data-testid="paper-panel">
    <CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2">
      <span>Historical paper replay</span><Badge variant="outline">Simulation only</Badge>
    </CardTitle></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm text-muted-foreground">Evidence-first historical simulation for research. No real orders are placed. Results are not investment advice; past replay outcomes do not guarantee profits, and confidence is not claimed to be calibrated.</p>
      {statusQuery.isLoading ? <div className="h-8 animate-pulse rounded bg-muted" aria-label="Loading replay availability" /> : null}
      {statusQuery.error ? <p role="alert" className="text-sm text-destructive" data-testid="paper-status-error">{(statusQuery.error as Error).message} <Button variant="ghost" onClick={() => statusQuery.refetch()}>Retry availability</Button></p> : null}
      {statusQuery.data && !statusQuery.data.enabled ? <p className="text-sm">Paper replay is currently disabled.</p> : null}
      {enabled ? <>
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <strong>Selected new-run preset:</strong> {PAPER_STRATEGIES.find(preset=>preset.id===strategy)?.description} Rules mode is deterministic; Jev shadow is a separate optional comparison. Breakout and RSI may retain long positions through neutral signals. The final 20 bars are scored; earlier bars supply indicator history, not parameter tuning.
          <div className="mt-2 text-xs text-muted-foreground">Examples: SPY with trend/rules; Bitcoin (BTC-USD) with breakout; Ethereum (ETH-USD) with RSI rebound. Each is compared with its own same-window 25%-allocation benchmark.</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3">
            <span className="text-xs font-medium">Quick asset choices</span>
            <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Quick asset choices">
              {PAPER_ASSETS.map(asset => <Button key={asset.symbol} type="button" size="sm" variant={symbol === asset.symbol ? "default" : "outline"} aria-pressed={symbol === asset.symbol} disabled={!!runRetry} onClick={() => setSymbol(asset.symbol)} data-testid={`paper-asset-${asset.symbol}`}>
                {asset.symbol} <span className="ml-1 font-normal opacity-80">{asset.label}</span>
              </Button>)}
            </div>
          </div>
          <div><label htmlFor="paper-symbol" className="text-xs">Ticker — stocks or crypto/USD (e.g. SPY, BTC-USD, ETH-USD)</label><Input id="paper-symbol" data-testid="paper-symbol" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} maxLength={12} autoCapitalize="characters" disabled={!!runRetry} /></div>
          <div>
            <label htmlFor="paper-strategy" className="text-xs">Strategy preset</label>
            <select id="paper-strategy" data-testid="paper-strategy" className="h-10 w-full min-w-0 max-w-full rounded-md border bg-background px-3 text-sm" value={strategy} onChange={e => setStrategy(e.target.value as PaperOptions["strategy"])} disabled={!!runRetry}>
              {PAPER_STRATEGIES.map(preset => <option key={preset.id} value={preset.id}>{preset.label} — {preset.description}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">{PAPER_STRATEGIES.find(preset => preset.id === strategy)?.description}</p>
          </div>
          <div><label htmlFor="paper-mode" className="text-xs">Mode</label><select id="paper-mode" data-testid="paper-mode" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={mode} onChange={e => setMode(e.target.value as PaperOptions["mode"])} disabled={!!runRetry}><option value="rules">Rules</option><option value="jev_shadow" disabled={!statusQuery.data?.jevReady}>Jev shadow{statusQuery.data?.jevReady ? "" : " (not ready)"}</option></select></div>
          <div><label htmlFor="paper-capital" className="text-xs">Simulated starting USD (example: 10000)</label><Input id="paper-capital" data-testid="paper-capital" type="number" min="100" max="1000000" value={capital} onChange={e => setCapital(e.target.value)} disabled={!!runRetry} /></div>
          <div><label htmlFor="paper-fees" className="text-xs">Fee per fill, basis points (example: 10 = 0.1%)</label><Input id="paper-fees" data-testid="paper-fees" type="number" min="0" max="100" value={feeBps} onChange={e => setFeeBps(e.target.value)} disabled={!!runRetry} /></div>
          <div><label htmlFor="paper-slippage" className="text-xs">Adverse fill slippage, basis points (example: 5)</label><Input id="paper-slippage" data-testid="paper-slippage" type="number" min="0" max="100" value={slippageBps} onChange={e => setSlippageBps(e.target.value)} disabled={!!runRetry} /></div>
        </div>
        <p className="text-xs text-muted-foreground">Crypto uses daily candles across a seven-day week. Simulated fees and adverse slippage are assumptions; replay prices are not exchange-executable quotes.</p>
        <div className="flex flex-wrap gap-2">
          <Button data-testid="paper-submit" onClick={handleRun} disabled={!enabled || submitRun.isPending || !symbol.trim() || Number(capital) <= 0}>
            {submitRun.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{runRetry ? "Retry same run request" : "Run historical replay"}
          </Button>
          {runRetry && !submitRun.isPending ? <Button type="button" variant="outline" onClick={discardRetry} data-testid="paper-discard-retry">Discard retry and edit options</Button> : null}
          <Button data-testid="paper-history-refresh" variant="outline" onClick={() => historyQuery.refetch()} disabled={historyQuery.isFetching}><RefreshCw className="mr-2 h-4 w-4" />Refresh history</Button>
        </div>
        {runRetry ? <p className="text-xs text-muted-foreground" role="status">Options are locked because retry will reuse the existing request key and original settings. Discard that retry to edit and submit a new request.</p> : null}
      </> : null}
        {submitRun.error ? <p role="alert" className="text-sm text-destructive" data-testid="paper-run-error">Request failed; existing evidence is retained. Retry uses the same request key and options. {(submitRun.error as Error).message}</p> : null}
        {historyQuery.error ? <p role="alert" className="text-sm text-destructive" data-testid="paper-history-error">History could not be refreshed; previously loaded evidence remains available. {(historyQuery.error as Error).message}</p> : null}
        {historyQuery.isLoading ? <div className="h-10 animate-pulse rounded bg-muted" aria-label="Loading paper history" /> : runs.length ? <div className="space-y-2">
          <h3 className="font-medium">Run history</h3>
          <div className="flex flex-wrap gap-2">{runs.map(item => <Button key={item.id} variant={activeId === item.id ? "default" : "outline"} data-testid={`paper-history-${item.id}`} onClick={() => setSelectedId(item.id)} aria-pressed={activeId === item.id}>
            {item.options.symbol} · {strategyLabel(item.options.strategy)} · {item.status}{item.reviewing ? " · reviewing" : ""}
          </Button>)}</div>
        </div> : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="paper-empty">No replay evidence yet. A run will appear here after submission.</p>}
        {detailQuery.error ? <p role="alert" className="text-sm text-destructive" data-testid="paper-detail-error">This run could not be loaded. Other history remains available. {(detailQuery.error as Error).message}</p> : null}
        {detailQuery.isFetching && !run ? <div className="h-24 animate-pulse rounded bg-muted" aria-label="Loading selected replay" /> : null}
        {run ? <div className="space-y-5 border-t pt-4" data-testid="paper-run-detail">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold">{run.options.symbol} · {strategyLabel(run.options.strategy)} replay</h3><Badge variant={run.status === "failed" ? "destructive" : "secondary"}>{run.status}{run.reviewing ? " · reviewing" : ""}</Badge><span className="text-xs text-muted-foreground">Run {run.id} · {run.created_at}</span></div>
          {run.status === "running" || run.reviewing ? <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />{run.reviewing ? "Optional model review in progress; polling every 2 seconds." : "Replay running; polling every 2 seconds."}</p> : null}
          {run.error ? <p className="text-sm text-destructive" data-testid="paper-result-error">{run.error}</p> : null}
          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(run.options).map(([key, value]) => <div key={key}><span className="text-muted-foreground">{key}: </span><span className="font-mono">{String(value)}</span></div>)}
          </div>
          {result ? <>
            <div className="text-sm" data-testid="paper-window">Evaluation window: {result.startDate} – {result.endDate} · {result.evaluationBars} evaluation bars · {result.sourceBars} source bars · warmup {result.warmupBars} bars (20 source bars required before evaluation)</div>
            <div className="text-xs text-muted-foreground break-all">Data digest: {result.dataDigest} · Engine: {result.engineVersion} · Strategy: {result.strategyVersion}</div>
            <div className="text-xs text-muted-foreground">Source: {result.dataSource??"Not recorded"} · Fetched: {result.fetchedAt??"Not recorded"} · Last bar age: {result.ageCalendarDays??"Unknown"} calendar days</div>
            <Metrics label="Rule" track={result.rule} /><Metrics label="25% allocation benchmark" track={result.benchmark} />
            <div className="text-sm">Excess return versus benchmark: {metricValue(result.excessReturnPct, "%")}</div>
            {result.shadow ? <div className="space-y-3 rounded-md border p-3" data-testid="paper-shadow">
              <div className="flex flex-wrap gap-2 items-center"><h4 className="font-semibold">Jev shadow</h4><Badge variant={result.shadow.evaluationStatus === "complete" ? "secondary" : "outline"}>{result.shadow.evaluationStatus}</Badge><span className="text-sm">Coverage: {result.shadow.coverage.completed}/{result.shadow.coverage.planned} completed · {result.shadow.coverage.failed} failed · {result.shadow.coverage.lowConfidence} low confidence</span></div>
              <Metrics label="Shadow" track={result.shadow} />
              <p className="text-sm">Direction Brier score: {metricValue(result.shadow.directionBrierScore)} · Direction samples: {result.shadow.directionSamples} · Token usage: {result.shadow.usage.inputTokens} in / {result.shadow.usage.outputTokens} out</p>
              <details><summary className="cursor-pointer text-sm font-medium">Shadow decisions and errors</summary><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Date", "Target", "Probability", "Confidence", "Error"].map(x => <th key={x} className="border-b p-2">{x}</th>)}</tr></thead><tbody>{result.shadow.decisions.map((d, i) => <tr key={`${d.date}-${i}`} className="border-b"><td className="p-2">{d.date}</td><td className="p-2">{d.target}</td><td className="p-2">{metricValue(d.probability)}</td><td className="p-2">{metricValue(d.confidence)}</td><td className="p-2">{d.error || "—"}</td></tr>)}</tbody></table></div></details>
            </div> : null}
            <TrackTables label="Rule" track={result.rule} /><TrackTables label="25% allocation benchmark" track={result.benchmark} />
            {result.shadow ? <TrackTables label="Jev shadow" track={result.shadow} /> : null}
            <section className="space-y-2"><h4 className="font-medium">Limitations</h4><ul className="list-disc space-y-1 pl-5 text-sm" data-testid="paper-limitations">{result.limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}</ul></section>
          </> : null}
          {run.status === "completed" ? <section className="space-y-2 border-t pt-3" data-testid="paper-review">
            <h4 className="font-medium">Optional model review</h4>
            <p className="text-xs text-muted-foreground">A review is interpretation only and follows existing routing policy. A free fallback may be served instead of Muse Spark; the served model is shown below and fallback output is never labeled Spark.</p>
            {run.review ? <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm"><div>Requested model: {run.review.requestedModel} · Served model: {run.review.servedModel} · Interpretation only</div><p className="whitespace-pre-wrap">{run.review.text}</p></div> : null}
            {run.review_error ? <p role="alert" className="text-sm text-destructive">{run.review_error}</p> : null}
            {run.review_attempted_at ? <p className="text-xs text-muted-foreground">Review attempt recorded: {run.review_attempted_at}</p> : null}
            {!run.review_attempted_at && !run.reviewing ? <Button data-testid="paper-review-button" variant="outline" disabled={!enabled || review.isPending} onClick={() => review.mutate(run.id)}>{review.isPending ? "Requesting review…" : reviewRetryId === run.id ? "Retry review request" : "Request optional review"}</Button> : null}
            {review.error && reviewRetryId === run.id ? <p role="alert" className="text-sm text-destructive" data-testid="paper-review-error">Review request failed. Retry is available; the server enforces one attempt per run. {(review.error as Error).message}</p> : null}
          </section> : null}
          <p className="flex gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-4 w-4 shrink-0" />Simulated historical outcomes only. No brokerage connection or real order execution.</p>
        </div> : null}
    </CardContent>
  </Card>;
}
