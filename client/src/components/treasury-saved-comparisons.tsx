import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaperRun } from "@shared/treasury-paper-contract";
import { PAPER_STRATEGIES } from "@shared/treasury-paper-presets";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface ComparisonsResponse {
  runs: PaperRun[];
  available: number;
}

interface ImportResponse {
  imported: number;
  existing: number;
  total: 12;
}

type Asset = {
  key: "bitcoin" | "ethereum" | "solana";
  symbol: "BTC-USD" | "ETH-USD" | "SOL-USD";
  name: string;
  ticker: string;
};

const ASSETS: Asset[] = [
  { key: "bitcoin", symbol: "BTC-USD", name: "Bitcoin", ticker: "BTC" },
  { key: "ethereum", symbol: "ETH-USD", name: "Ethereum", ticker: "ETH" },
  { key: "solana", symbol: "SOL-USD", name: "Solana", ticker: "SOL" },
];

function strategyLabel(strategy: string) {
  return PAPER_STRATEGIES.find(item => item.id === strategy)?.label ?? strategy;
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function number(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not recorded";
  return value.slice(0, 10);
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="min-w-0 rounded-md border bg-background/70 px-3 py-2">
    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="mt-1 break-words font-mono text-sm font-semibold tabular-nums">{value}</dd>
    {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div> : null}
  </div>;
}

function TrackMetrics({ run, benchmark = false, testId }: { run: PaperRun; benchmark?: boolean; testId: string }) {
  const result = run.result;
  const track = benchmark ? result?.benchmark : result?.rule;
  if (!track) return <p className="text-sm text-muted-foreground">Saved result metrics are unavailable for this run.</p>;
  const metrics = track.metrics;
  return <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid={testId}>
    <Metric label="P&L" value={money(metrics.pnlUsd)} />
    <Metric label="Net return" value={`${number(metrics.netReturnPct)}%`} />
    <Metric label="Max drawdown" value={`${number(metrics.maxDrawdownPct)}%`} />
    <Metric label="Trading costs" value={money(metrics.costsUsd)} hint={`Turnover ${money(metrics.turnoverUsd)}`} />
    <Metric label="Open position" value={`${number(metrics.openPositionShares, 6)} shares`} />
    <Metric label="Closed trades" value={number(metrics.closedTrades, 0)} hint={`Win rate ${metrics.winRatePct === null ? "—" : `${number(metrics.winRatePct)}%`}`} />
  </dl>;
}

function StrategySummary({ asset, runs }: { asset: Asset; runs: PaperRun[] }) {
  return <div className="grid gap-2 sm:grid-cols-2" aria-label={`${asset.name} strategy summaries`}>
    {PAPER_STRATEGIES.map(strategy => {
      const run = runs.find(item => item.options.strategy === strategy.id);
      const metrics = run?.result?.rule.metrics;
      return <div key={strategy.id} className="rounded-md border bg-muted/20 p-3" data-testid={`saved-${asset.key}-strategy-${strategy.id}`}>
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium">{strategy.label}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{strategy.description}</div>
          </div>
          <Badge variant={run ? "secondary" : "outline"} className="shrink-0">{run ? "Saved" : "Not imported"}</Badge>
        </div>
        {run?.result ? <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2 text-xs">
          <span className="text-muted-foreground">Window</span><span className="text-right font-mono">{shortDate(run.result.startDate)} – {shortDate(run.result.endDate)}</span>
          <span className="text-muted-foreground">P&amp;L</span><span className="text-right font-mono">{money(metrics?.pnlUsd)}</span>
          <span className="text-muted-foreground">Return</span><span className="text-right font-mono">{number(metrics?.netReturnPct)}%</span>
          <span className="text-muted-foreground">Drawdown</span><span className="text-right font-mono">{number(metrics?.maxDrawdownPct)}%</span>
        </div> : null}
      </div>;
    })}
  </div>;
}

function AssetSection({
  asset,
  runs,
  loading,
  error,
  onRetry,
}: {
  asset: Asset;
  runs: PaperRun[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const assetRuns = useMemo(() => runs.filter(run => run.options.symbol === asset.symbol), [runs, asset.symbol]);
  // Resolve the selected record from this asset's current UUID-filtered options.
  // A stale selection from another asset is never rendered as this section's detail.
  const selectedRun = assetRuns.find(run => run.id === selectedId) ?? assetRuns[0];
  const benchmark = selectedRun?.result?.benchmark.metrics;
  const rule = selectedRun?.result?.rule.metrics;

  return <Card data-testid={`saved-${asset.key}-section`} className="overflow-hidden">
    <CardHeader className="space-y-3 border-b bg-muted/20 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">{asset.name} saved comparisons</CardTitle>
        <Badge variant="outline">{assetRuns.length} of 4 stored</Badge>
      </div>
      <div className="grid gap-1 sm:max-w-xl">
        <label htmlFor={`saved-${asset.key}-select`} className="text-xs font-medium text-muted-foreground">Choose a saved {asset.name} run</label>
        <select
          id={`saved-${asset.key}-select`}
          data-testid={`saved-${asset.key}-dropdown`}
          className="h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
          value={selectedRun?.id ?? ""}
          onChange={event => setSelectedId(event.target.value)}
          disabled={assetRuns.length === 0}
        >
          {assetRuns.length === 0 ? <option value="">No persisted {asset.name} comparisons yet</option> : null}
          {assetRuns.map(run => <option key={run.id} value={run.id}>
            {strategyLabel(run.options.strategy)} · {shortDate(run.result?.startDate)}–{shortDate(run.result?.endDate)}
          </option>)}
        </select>
      </div>
    </CardHeader>
    <CardContent className="space-y-5 pt-4">
      {loading ? <div className="space-y-2" aria-label={`Loading ${asset.name} saved comparisons`}>
        <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-20 animate-pulse rounded bg-muted" />
      </div> : error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p>{(error as Error).message || `Could not load ${asset.name} saved results.`}</p>
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onRetry}>Retry saved results</Button>
      </div> : <>
        <StrategySummary asset={asset} runs={assetRuns} />
        {selectedRun ? <div className="space-y-4 border-t pt-4" data-testid={`saved-${asset.key}-detail`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">{strategyLabel(selectedRun.options.strategy)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Original window: {shortDate(selectedRun.result?.startDate)} – {shortDate(selectedRun.result?.endDate)}
              </p>
            </div>
            <Badge variant="secondary">{selectedRun.options.mode === "rules" ? "Rules replay" : "Jev shadow replay"}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <Metric label="Starting capital" value={money(selectedRun.options.capital)} />
            <Metric label="Fees" value={`${number(selectedRun.options.feeBps)} bps / fill`} />
            <Metric label="Adverse slippage" value={`${number(selectedRun.options.slippageBps)} bps / fill`} />
          </div>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Strategy result</h4>
            <TrackMetrics run={selectedRun} testId={`saved-${asset.key}-metrics`} />
          </section>
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">Matched 25% allocation benchmark</h4>
            <TrackMetrics run={selectedRun} benchmark testId={`saved-${asset.key}-benchmark-metrics`} />
            <p className="text-xs text-muted-foreground">
              Benchmark P&amp;L {money(benchmark?.pnlUsd)} · return {number(benchmark?.netReturnPct)}% · max drawdown {number(benchmark?.maxDrawdownPct)}%.
              {rule && benchmark ? <> Strategy excess return: {number(selectedRun.result?.excessReturnPct)} percentage points.</> : null}
            </p>
          </section>
          <details className="group rounded-md border">
            <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">Original fills and equity ledger</summary>
            {selectedRun.result ? <div className="space-y-4 border-t p-3">
              {[["Strategy", selectedRun.result.rule], ["25% allocation benchmark", selectedRun.result.benchmark]].map(([label, track]) => {
                const item = track as NonNullable<PaperRun["result"]>["rule"];
                return <section key={label as string} className="space-y-2">
                  <h5 className="text-sm font-medium">{label as string} fills ({item.fills.length})</h5>
                  {item.fills.length ? <div className="overflow-x-auto rounded border">
                    <table className="w-full min-w-[680px] text-left text-xs">
                      <thead className="bg-muted/40"><tr>{["Signal date", "Fill date", "Side", "Shares", "Reference", "Fill price", "Fee", "Slippage"].map(label => <th key={label} className="whitespace-nowrap p-2 font-medium">{label}</th>)}</tr></thead>
                      <tbody>{item.fills.map((fill, index) => <tr key={`${fill.fillDate}-${index}`} className="border-t">
                        <td className="whitespace-nowrap p-2">{fill.signalDate}</td><td className="whitespace-nowrap p-2">{fill.fillDate}</td>
                        <td className="p-2 capitalize">{fill.side}</td><td className="p-2 font-mono">{number(fill.shares, 6)}</td>
                        <td className="p-2 font-mono">{money(fill.referencePrice)}</td><td className="p-2 font-mono">{money(fill.price)}</td>
                        <td className="p-2 font-mono">{money(fill.feeUsd)}</td><td className="p-2 font-mono">{money(fill.slippageUsd)}</td>
                      </tr>)}</tbody>
                    </table>
                  </div> : <p className="text-xs text-muted-foreground">No fills recorded.</p>}
                  <details>
                    <summary className="cursor-pointer text-xs text-muted-foreground">Equity ledger ({item.equity.length} points)</summary>
                    <div className="mt-2 max-h-48 overflow-auto rounded border">
                      <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-muted/70"><tr><th className="p-2">Date</th><th className="p-2">Equity (USD)</th></tr></thead>
                        <tbody>{item.equity.map((point, index) => <tr key={`${point.date}-${index}`} className="border-t"><td className="p-2">{point.date}</td><td className="p-2 font-mono">{money(point.equityUsd)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </details>
                </section>;
              })}
            </div> : <p className="border-t p-3 text-sm text-muted-foreground">Ledger details are unavailable.</p>}
          </details>
        </div> : null}
      </>}
    </CardContent>
  </Card>;
}

export function TreasurySavedComparisons() {
  const tenant = useAuth().tenant;
  const isOwner = tenant?.isAdmin === true;
  const queryClient = useQueryClient();
  const comparisonsKey = ["/api/treasury/paper/comparisons", tenant?.id];
  const paperRunsKey = ["/api/treasury/paper/runs", tenant?.id];
  const comparisonsQuery = useQuery({
    queryKey: comparisonsKey,
    enabled: isOwner,
    queryFn: async (): Promise<ComparisonsResponse> => {
      const response = await apiRequest("GET", "/api/treasury/paper/comparisons");
      return response.json() as Promise<ComparisonsResponse>;
    },
  });
  const importMutation = useMutation({
    mutationFn: async (): Promise<ImportResponse> => {
      const response = await apiRequest("POST", "/api/treasury/paper/comparisons/import");
      return response.json() as Promise<ImportResponse>;
    },
    retry: false,
  });
  const [operationPending, setOperationPending] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [receipt, setReceipt] = useState<{ imported: number; existing: number; total: number; visible: boolean } | null>(null);
  if (!isOwner) return null;

  const runs = comparisonsQuery.data?.runs ?? [];
  const available = comparisonsQuery.data?.available ?? 12;
  const importComparisons = async () => {
    if (!isOwner || operationPending || runs.length >= available) return;
    setOperationError("");
    setReceipt(null);
    setOperationPending(true);
    try {
      const result = await importMutation.mutateAsync();
      setReceipt({ ...result, visible: false });
      const refreshed = await comparisonsQuery.refetch({ throwOnError: true });
      if (refreshed.data?.runs.length !== result.total || refreshed.data.available !== result.total) {
        throw new Error("The server returned an import receipt, but all 12 saved results are not yet visible. Refresh the saved results to confirm.");
      }
      await queryClient.invalidateQueries({ queryKey: paperRunsKey });
      setReceipt({ ...result, visible: true });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "The import could not be confirmed.");
    } finally {
      setOperationPending(false);
    }
  };

  return <section className="space-y-4" data-testid="treasury-saved-comparisons">
    <div className="flex flex-col gap-3 border-l-2 border-primary/40 pl-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Owner-approved archive</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Saved crypto comparisons</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Original, persisted Bitcoin, Ethereum, and Solana research runs. These records are copied as-is; they are not rerun.</p>
      </div>
      {runs.length < available ? <Button
        type="button"
        data-testid="saved-comparisons-import"
        onClick={importComparisons}
        disabled={operationPending || importMutation.isPending || comparisonsQuery.isLoading || !!comparisonsQuery.error}
      >
        {operationPending || importMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
        {operationPending ? "Importing and confirming…" : "Import approved comparisons"}
      </Button> : <Badge variant="secondary" className="w-fit">Archive complete · {runs.length}/{available}</Badge>}
    </div>

    <Card className="border-primary/15 bg-muted/10">
      <CardContent className="space-y-3 pt-4">
        <p className="text-sm"><strong>Research boundaries.</strong> Separate $10,000 accounts per strategy, not a combined portfolio; benchmark uses 25% allocation. These are short historical daily-close samples, not live trades or advice.</p>
        <p className="text-xs text-muted-foreground">Fees and adverse slippage are recorded in each original result. Dates, costs, fills, and equity ledgers below are preserved from the approved archive.</p>
      </CardContent>
    </Card>

    {comparisonsQuery.isLoading ? <div className="space-y-3" aria-label="Loading saved comparisons">
      <div className="h-7 w-48 animate-pulse rounded bg-muted" />
      <div className="h-36 animate-pulse rounded bg-muted" />
      <div className="h-36 animate-pulse rounded bg-muted" />
    </div> : null}
    {comparisonsQuery.error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm" data-testid="saved-comparisons-load-error">
      <p>Saved comparisons could not be loaded. No empty-state conclusion is shown.</p>
      <p className="mt-1 text-muted-foreground">{(comparisonsQuery.error as Error).message}</p>
      <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => comparisonsQuery.refetch()}>Retry loading saved results</Button>
    </div> : null}

    {operationError ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="saved-comparisons-operation-error">
      <strong>Import/refresh not confirmed.</strong> {operationError}
      {receipt ? <span> Server receipt: {receipt.imported} imported, {receipt.existing} already present, {receipt.total} total. Refresh the saved results before considering them visible.</span> : null}
    </div> : null}
    {receipt?.visible ? <div role="status" className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm" data-testid="saved-comparisons-import-receipt">
      Import confirmed: {receipt.imported} copied, {receipt.existing} already present, {receipt.total} total. The saved comparison list was refreshed before this confirmation.
    </div> : null}
    {!comparisonsQuery.isLoading && !comparisonsQuery.error && runs.length === 0 ? <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="saved-comparisons-empty">
      No approved comparisons are persisted for this owner yet. Use the import button to copy the fixed archive; nothing is imported automatically.
    </div> : null}

    {ASSETS.map(asset => <AssetSection
      key={asset.symbol}
      asset={asset}
      runs={runs}
      loading={comparisonsQuery.isLoading}
      error={comparisonsQuery.error}
      onRetry={() => { void comparisonsQuery.refetch(); }}
    />)}

    <p className="flex gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-4 w-4 shrink-0" />Archived historical results only. No model calls, new data fetches, or live orders are part of this import.</p>
  </section>;
}
