// Simulation Sandbox (S5) — /admin/sandbox. Launch a replay run against the
// safety / conversation / orchestration corpus under an override bundle,
// watch progress (list polls while a run is in-flight), and inspect the
// side-by-side report. Contract: data/feature-contracts/simulation-sandbox.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, FlaskConical, AlertTriangle, CheckCircle2, ShieldAlert, Play } from "lucide-react";

interface SandboxRunRow {
  id: number;
  corpus: string;
  status: string;
  overrides: Record<string, any>;
  sample_size: number;
  report: Record<string, any> | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

interface SandboxResultRow {
  id: number;
  item_ref: string;
  baseline: Record<string, any>;
  simulated: Record<string, any>;
  flip: string;
  severity: string;
  created_at: string;
}

function verdictBadge(verdict: string | null | undefined, status: string) {
  if (status === "running") return <Badge variant="secondary" data-testid="badge-status-running"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> running</Badge>;
  if (status === "failed") return <Badge variant="destructive" data-testid="badge-status-failed"><AlertTriangle className="h-3 w-3 mr-1" /> failed</Badge>;
  if (verdict === "CRITICAL") return <Badge variant="destructive" data-testid="badge-verdict-critical"><ShieldAlert className="h-3 w-3 mr-1" /> CRITICAL</Badge>;
  if (verdict === "CHANGES" || verdict === "DRIFT") return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40" variant="outline" data-testid="badge-verdict-changes">{verdict}</Badge>;
  return <Badge variant="secondary" data-testid="badge-verdict-ok"><CheckCircle2 className="h-3 w-3 mr-1" /> {verdict || "complete"}</Badge>;
}

function ReportView({ run }: { run: SandboxRunRow }) {
  const r = run.report;
  if (run.status === "failed") {
    return <div className="text-sm text-destructive" data-testid="text-run-error">{run.error || "run failed"}</div>;
  }
  if (!r) return <div className="text-sm text-muted-foreground" data-testid="text-report-pending">Report not available yet.</div>;
  if (run.corpus === "safety") {
    return (
      <div className="space-y-2 text-sm" data-testid="report-safety">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div><span className="text-muted-foreground">Replayed</span><div className="font-semibold" data-testid="text-report-total">{r.totals?.replayed ?? "—"}{r.totals?.requested != null ? ` / ${r.totals.requested}` : ""}</div></div>
          <div><span className="text-muted-foreground">block → allow</span><div className={`font-semibold ${(r.flips?.block_to_allow ?? 0) > 0 ? "text-destructive" : ""}`} data-testid="text-flips-block-to-allow">{r.flips?.block_to_allow ?? 0}</div></div>
          <div><span className="text-muted-foreground">allow → block</span><div className="font-semibold" data-testid="text-flips-allow-to-block">{r.flips?.allow_to_block ?? 0}</div></div>
          <div><span className="text-muted-foreground">Stubbed calls</span><div className="font-semibold" data-testid="text-stubbed-calls">{r.stubbedToolCalls ?? 0}</div></div>
        </div>
        {Array.isArray(r.criticalFlips) && r.criticalFlips.length > 0 && (
          <div className="border border-destructive/40 rounded-md p-2 space-y-1">
            <div className="font-medium text-destructive">Critical flips (was blocked, now allowed)</div>
            {r.criticalFlips.slice(0, 10).map((f: any, i: number) => (
              <div key={i} className="text-xs text-muted-foreground truncate" data-testid={`row-critical-flip-${i}`}>{f.itemRef || f.item_ref || JSON.stringify(f).slice(0, 160)}</div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2 text-sm" data-testid="report-modelswap">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div><span className="text-muted-foreground">Replayed</span><div className="font-semibold" data-testid="text-report-total">{r.totals?.replayed ?? "—"}{r.totals?.requested != null ? ` / ${r.totals.requested}` : ""}</div></div>
        <div><span className="text-muted-foreground">Mean similarity</span><div className="font-semibold" data-testid="text-mean-similarity">{r.similarity?.mean ?? "—"}</div></div>
        <div><span className="text-muted-foreground">Est. cost</span><div className="font-semibold" data-testid="text-cost">${r.cost?.totalCostUsd ?? "—"}</div></div>
        <div><span className="text-muted-foreground">Mean latency</span><div className="font-semibold" data-testid="text-latency">{r.cost?.meanLatencyMs != null ? `${r.cost.meanLatencyMs} ms` : "—"}</div></div>
      </div>
      {r.totals?.capStopped ? <div className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-cap-stopped">{r.totals.capStopped} item(s) skipped after hitting the per-run spend cap.</div> : null}
    </div>
  );
}

export default function AdminSandboxPage() {
  const { toast } = useToast();
  const [corpus, setCorpus] = useState<"safety" | "conversation" | "orchestration">("safety");
  const [sampleSize, setSampleSize] = useState("50");
  const [intentGateMode, setIntentGateMode] = useState<"off" | "moderate" | "strict">("moderate");
  const [model, setModel] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const { data: runsData, isLoading } = useQuery<{ runs: SandboxRunRow[] }>({
    queryKey: ["/api/admin/sandbox/runs"],
    refetchInterval: (q) => (q.state.data?.runs?.some((r) => r.status === "running") ? 5_000 : 30_000),
  });

  const { data: detail } = useQuery<{ run: SandboxRunRow; results: SandboxResultRow[] }>({
    queryKey: ["/api/admin/sandbox/runs", selectedRunId],
    enabled: selectedRunId != null,
    refetchInterval: (q) => (q.state.data?.run?.status === "running" ? 5_000 : false),
  });

  const launch = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = { corpus, sampleSize: Number(sampleSize) };
      if (corpus === "safety") body.intentGateMode = intentGateMode;
      else body.model = model.trim();
      const res = await apiRequest("POST", "/api/admin/sandbox/runs", body);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sandbox/runs"] });
      if (data.status === "complete") {
        setSelectedRunId(data.runId);
        toast({ title: "Run complete", description: `Run #${data.runId} finished — verdict ${data.report?.verdict ?? "n/a"}.` });
      } else {
        toast({ title: "Run launched", description: "Replay continues in the background; the list below polls for the verdict." });
      }
    },
    onError: (err: any) => {
      toast({ title: "Launch failed", description: err?.message || "unknown error", variant: "destructive" });
    },
  });

  const sampleNum = Number(sampleSize);
  const launchDisabled =
    launch.isPending ||
    !Number.isInteger(sampleNum) || sampleNum < 1 || sampleNum > 200 ||
    (corpus !== "safety" && !model.trim());

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-admin-sandbox">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <FlaskConical className="h-7 w-7 text-primary" /> Simulation Sandbox
        </h1>
        <p className="text-muted-foreground text-sm" data-testid="text-page-subtitle">
          Replay real historical workloads against a modified configuration inside the side-effect firewall — verdict flips, quality and cost deltas, before anything touches production.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Launch a replay run</CardTitle>
          <CardDescription>
            Safety corpus re-evaluates recorded attacks under a different intent-gate level ($0). Conversation/orchestration corpora re-run history under a model override (budget-claimed, capped at $5/run, sample ceiling 200).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-1">
              <Label>Corpus</Label>
              <Select value={corpus} onValueChange={(v) => setCorpus(v as any)}>
                <SelectTrigger data-testid="select-corpus"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="safety">Safety (intent-gate replay)</SelectItem>
                  <SelectItem value="conversation">Conversation (model swap)</SelectItem>
                  <SelectItem value="orchestration">Orchestration (model swap)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Sample size (1–200)</Label>
              <Input type="number" min={1} max={200} value={sampleSize} onChange={(e) => setSampleSize(e.target.value)} data-testid="input-sample-size" />
            </div>
            {corpus === "safety" ? (
              <div className="space-y-1">
                <Label>Intent-gate mode override</Label>
                <Select value={intentGateMode} onValueChange={(v) => setIntentGateMode(v as any)}>
                  <SelectTrigger data-testid="select-intent-gate-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">off</SelectItem>
                    <SelectItem value="moderate">moderate</SelectItem>
                    <SelectItem value="strict">strict</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Model override</Label>
                <Input placeholder="e.g. gpt-5-mini" value={model} onChange={(e) => setModel(e.target.value)} data-testid="input-model" />
              </div>
            )}
            <Button onClick={() => launch.mutate()} disabled={launchDisabled} data-testid="button-launch-run">
              {launch.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Launch run
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
          <CardDescription>Most recent 30 runs. Running rows refresh every 5 seconds.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-6" data-testid="state-runs-loading"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : !runsData?.runs?.length ? (
            <div className="text-sm text-muted-foreground" data-testid="text-no-runs">No sandbox runs yet — launch one above.</div>
          ) : (
            <div className="space-y-1">
              {runsData.runs.map((run) => (
                <button
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className={`w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover-elevate ${selectedRunId === run.id ? "border-primary" : ""}`}
                  data-testid={`row-run-${run.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs text-muted-foreground">#{run.id}</span>
                    <span className="font-medium">{run.corpus}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {run.sample_size} items · {run.corpus === "safety" ? `gate: ${run.overrides?.intentGateMode ?? "?"}` : `model: ${run.overrides?.model ?? "?"}`} · {new Date(run.started_at).toLocaleString()}
                    </span>
                  </div>
                  {verdictBadge(run.report?.verdict, run.status)}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedRunId != null && detail?.run && (
        <Card data-testid="card-run-detail">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Run #{detail.run.id} — {detail.run.corpus}</CardTitle>
              {verdictBadge(detail.run.report?.verdict, detail.run.status)}
            </div>
            <CardDescription>
              Overrides: <span className="font-mono text-xs">{JSON.stringify(detail.run.overrides)}</span>
              {detail.run.completed_at ? ` · completed ${new Date(detail.run.completed_at).toLocaleString()}` : " · still running"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ReportView run={detail.run} />
            {detail.results.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium">Per-item results ({detail.results.length} shown, worst first)</div>
                <div className="max-h-80 overflow-y-auto space-y-1">
                  {detail.results.map((it) => (
                    <div key={it.id} className="flex items-center justify-between gap-2 border rounded-md px-2 py-1 text-xs" data-testid={`row-result-${it.id}`}>
                      <span className="font-mono truncate">{it.item_ref}</span>
                      <span className="flex items-center gap-2 shrink-0">
                        {it.flip !== "none" && <span className={it.severity === "critical" ? "text-destructive font-semibold" : "text-amber-600 dark:text-amber-400"}>{it.flip}</span>}
                        <Badge variant={it.severity === "critical" ? "destructive" : "secondary"}>{it.severity}</Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
