import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  RefreshCw,
  DollarSign,
  AlertTriangle,
  Cloud,
  Trash2,
  Cpu,
  Shield,
  Settings2,
  RotateCcw,
} from "lucide-react";

// ───────────────────────────────────────────────────────────────────────────
// Section: Claude Runner status
// ───────────────────────────────────────────────────────────────────────────
function ClaudeRunnerCard() {
  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/admin/claude-runner"],
  });
  return (
    <Card data-testid="card-claude-runner">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-primary" />
            <CardTitle>Claude Runner (CLI proxy)</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-claude-runner">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <CardDescription>
          Routes Anthropic requests through the local Claude Code CLI so they consume your Pro/Max quota instead of per-token API spend.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking...
          </div>
        ) : data ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span>Status:</span>
              {data.available ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30" data-testid="badge-runner-available">
                  Available
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400" data-testid="badge-runner-unavailable">
                  Unavailable
                </Badge>
              )}
            </div>
            {typeof data.requestsServed === "number" && (
              <div data-testid="text-runner-requests">Requests served: {data.requestsServed}</div>
            )}
            {data.cliVersion && <div data-testid="text-runner-version">CLI version: {data.cliVersion}</div>}
            {data.bridgeUrl && <div className="text-muted-foreground" data-testid="text-runner-bridge">Bridge: {data.bridgeUrl}</div>}
            <p className="text-xs text-muted-foreground pt-1">{data.description}</p>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No data.</div>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Section: Cost vs Revenue audit
// ───────────────────────────────────────────────────────────────────────────
function CostAuditCard() {
  const [days, setDays] = useState(7);
  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/admin/cost-audit", days],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/cost-audit?days=${days}`);
      return res.json();
    },
  });

  const fmt = (n: number | undefined) =>
    typeof n === "number" ? `$${n.toFixed(n >= 100 ? 0 : 2)}` : "—";

  return (
    <Card data-testid="card-cost-audit">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <CardTitle>Cost vs Revenue</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="cost-days" className="text-xs text-muted-foreground">Days</Label>
            <Input
              id="cost-days"
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 7)))}
              className="w-20 h-8"
              data-testid="input-cost-days"
            />
            <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-cost">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        <CardDescription>
          Estimated LLM spend (per-token list pricing) versus product revenue. CLI/OAuth lanes show non-zero estimated cost but bill $0.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : data ? (
          (() => {
            const costTotal = data.costs?.totalCostUsd as number | undefined;
            const revenueTotal = data.revenue?.revenue?.total as number | undefined;
            const net = data.revenue?.net as number | undefined;
            const burnRatio = data.revenue?.burnRatio as number | undefined;
            const verdict = data.revenue?.verdict as string | undefined;
            const verdictColor =
              verdict === "UNPROFITABLE" ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30"
              : verdict === "WARNING" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
              : verdict === "HEALTHY" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
              : "";
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Est. cost</div>
                    <div className="text-lg font-semibold" data-testid="text-cost-total">{fmt(costTotal)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Revenue</div>
                    <div className="text-lg font-semibold" data-testid="text-revenue-total">{fmt(revenueTotal)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Net</div>
                    <div className={`text-lg font-semibold ${(net ?? 0) < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`} data-testid="text-net">
                      {fmt(net)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Burn ratio</div>
                    <div className="text-lg font-semibold" data-testid="text-burn-ratio">
                      {typeof burnRatio === "number" ? `${(burnRatio * 100).toFixed(0)}%` : "—"}
                    </div>
                  </div>
                </div>
                <Separator />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {verdict && (
                    <Badge variant="outline" className={verdictColor} data-testid="badge-verdict">{verdict}</Badge>
                  )}
                  <Badge variant="outline" data-testid="badge-free-tier">
                    Free-tier-only background: {data.backgroundFreeTierOnly ? "ON" : "OFF"}
                  </Badge>
                  <Badge variant="outline" data-testid="badge-runner-status">
                    Claude Runner: {data.claudeRunner ? "available" : "unavailable"}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground italic">{data.notice}</p>
              </div>
            );
          })()
        ) : (
          <div className="text-sm text-muted-foreground">No data.</div>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Section: Stuck-agent diagnostics
// ───────────────────────────────────────────────────────────────────────────
function StuckDiagnosticsCard() {
  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/admin/diagnostics/stuck"],
  });

  return (
    <Card data-testid="card-stuck-diagnostics">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <CardTitle>Stuck-agent diagnostics</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-stuck">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <CardDescription>
          Snapshot of agent loops that have stalled, plus recent stuck patterns from the last 30 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : data ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Active tasks" value={(data.activeTasks || []).length} testId="stat-active" />
              <Stat label="Stalled delegations" value={(data.stalledDelegations || []).length} testId="stat-stuck" />
              <Stat label="Tool-loop warnings" value={(data.toolLoopWarnings || []).length} testId="stat-loops" />
              <Stat label="Recent patterns" value={(data.recentPatterns || []).length} testId="stat-patterns" />
            </div>
            {Array.isArray(data.stalledDelegations) && data.stalledDelegations.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Stalled delegations</div>
                <div className="space-y-1 max-h-48 overflow-auto pr-1">
                  {data.stalledDelegations.slice(0, 20).map((d: any, i: number) => (
                    <div key={i} className="text-xs font-mono bg-muted/40 rounded px-2 py-1" data-testid={`row-stalled-${i}`}>
                      conv {d.conversationId} · {d.agentName} · idle {d.lastEventAge}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray(data.recentPatterns) && data.recentPatterns.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Recent patterns (last 30 min)</div>
                <div className="space-y-1 max-h-48 overflow-auto pr-1">
                  {data.recentPatterns.slice(0, 20).map((p: any, i: number) => (
                    <div key={i} className="text-xs font-mono bg-muted/40 rounded px-2 py-1" data-testid={`row-pattern-${i}`}>
                      {typeof p === "string" ? p : (p.kind || p.type || JSON.stringify(p))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {typeof data.trackedHttpRequests === "number" && (
              <p className="text-[11px] text-muted-foreground">Tracked HTTP requests in flight: {data.trackedHttpRequests}</p>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No data.</div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, testId }: { label: string; value: any; testId: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold" data-testid={testId}>{String(value)}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Section: Auto-ship policies
// ───────────────────────────────────────────────────────────────────────────
interface PolicyRow {
  sku: string;
  productName: string;
  stats: {
    cleanShipsSinceReset?: number;
    brokenShipsSinceReset?: number;
    cleanShipsLifetime?: number;
    brokenShipsLifetime?: number;
  };
  policy: {
    enabled: boolean;
    threshold: number;
  };
}

function AutoShipPoliciesCard() {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useQuery<{ policies: PolicyRow[] }>({
    queryKey: ["/api/admin/service-orders/policy"],
  });

  const update = useMutation({
    mutationFn: async ({ sku, body }: { sku: string; body: any }) => {
      const res = await apiRequest("POST", `/api/admin/service-orders/policy/${encodeURIComponent(sku)}`, body);
      return res.json();
    },
    onSuccess: (_d, vars) => {
      toast({ title: "Policy updated", description: vars.sku });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/service-orders/policy"] });
    },
    onError: (err: any) => {
      toast({ title: "Update rejected", description: err?.message || "See logs", variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-policies">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            <CardTitle>Auto-ship policies</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} data-testid="button-refresh-policies">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription>
          Per-SKU rules. A SKU can only be enabled once it has accumulated enough clean ships since the last reset and zero broken ships.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : data && data.policies.length > 0 ? (
          <div className="space-y-3">
            {data.policies.map((p) => (
              <PolicyRowView key={p.sku} row={p} onUpdate={(body) => update.mutate({ sku: p.sku, body })} pending={update.isPending} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No service-product SKUs configured.</div>
        )}
      </CardContent>
    </Card>
  );
}

function PolicyRowView({ row, onUpdate, pending }: { row: PolicyRow; onUpdate: (body: any) => void; pending: boolean }) {
  const [threshold, setThreshold] = useState(row.policy.threshold);
  const clean = row.stats?.cleanShipsSinceReset ?? 0;
  const broken = row.stats?.brokenShipsSinceReset ?? 0;
  const canEnable = clean >= threshold && broken === 0;

  return (
    <div className="border rounded-lg p-3 space-y-2" data-testid={`row-policy-${row.sku}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate" data-testid={`text-policy-name-${row.sku}`}>{row.productName}</div>
          <div className="text-xs text-muted-foreground font-mono truncate">{row.sku}</div>
        </div>
        <Switch
          checked={row.policy.enabled}
          disabled={pending || (!row.policy.enabled && !canEnable)}
          onCheckedChange={(checked) => onUpdate({ enabled: checked, threshold })}
          data-testid={`switch-policy-${row.sku}`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span>Clean since reset: <strong data-testid={`text-clean-${row.sku}`}>{clean}</strong></span>
        <span>Broken since reset: <strong className={broken > 0 ? "text-red-600 dark:text-red-400" : ""} data-testid={`text-broken-${row.sku}`}>{broken}</strong></span>
        <div className="flex items-center gap-1 ml-auto">
          <Label htmlFor={`th-${row.sku}`} className="text-xs">Threshold</Label>
          <Input
            id={`th-${row.sku}`}
            type="number"
            min={1}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-16 h-7"
            data-testid={`input-threshold-${row.sku}`}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={pending || threshold === row.policy.threshold}
            onClick={() => onUpdate({ enabled: row.policy.enabled, threshold })}
            data-testid={`button-save-threshold-${row.sku}`}
          >
            Save
          </Button>
        </div>
      </div>
      {!row.policy.enabled && !canEnable && (
        <div className="text-[11px] text-amber-600 dark:text-amber-400">
          Cannot enable: needs {threshold} clean ships ({clean} so far) and 0 broken ({broken}).
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Section: Replay research findings
// ───────────────────────────────────────────────────────────────────────────
function ReplayResearchCard() {
  const { toast } = useToast();
  const [minScore, setMinScore] = useState(8);
  const [limit, setLimit] = useState(200);
  const [dryRun, setDryRun] = useState(true);
  const [lastResult, setLastResult] = useState<any>(null);

  const replay = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({
        min_score: String(minScore),
        limit: String(limit),
        dry_run: dryRun ? "1" : "0",
      });
      const res = await apiRequest("POST", `/api/admin/replay-research-proposals?${params}`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      setLastResult(data);
      toast({
        title: dryRun ? "Dry run complete" : "Replay complete",
        description: `Scanned ${data.scanned}, created ${data.proposalsCreated} proposal(s)`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Replay failed", description: err?.message || "See logs", variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-replay">
      <CardHeader>
        <div className="flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-primary" />
          <CardTitle>Replay research findings</CardTitle>
        </div>
        <CardDescription>
          Re-runs high-scoring research experiments through the code-proposal generator. Idempotent — already-replayed rows are skipped via <code>research_experiments.replayed_at</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="replay-score">Min score (1-10)</Label>
            <Input
              id="replay-score"
              type="number"
              min={1}
              max={10}
              value={minScore}
              onChange={(e) => setMinScore(Math.max(1, Math.min(10, parseInt(e.target.value) || 8)))}
              data-testid="input-replay-score"
            />
          </div>
          <div>
            <Label htmlFor="replay-limit">Limit</Label>
            <Input
              id="replay-limit"
              type="number"
              min={1}
              max={500}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(500, parseInt(e.target.value) || 200)))}
              data-testid="input-replay-limit"
            />
          </div>
          <div className="flex items-end gap-2">
            <Switch checked={dryRun} onCheckedChange={setDryRun} data-testid="switch-replay-dry" />
            <Label className="mb-1.5">Dry run</Label>
          </div>
        </div>
        <Button
          onClick={() => replay.mutate()}
          disabled={replay.isPending}
          data-testid="button-replay-run"
        >
          {replay.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
          {dryRun ? "Run dry preview" : "Replay for real"}
        </Button>
        {lastResult && (
          <div className="border rounded-lg p-3 bg-muted/40 text-xs space-y-1" data-testid="text-replay-result">
            <div>Scanned: <strong>{lastResult.scanned}</strong></div>
            <div>Attempted: <strong>{lastResult.attempted}</strong></div>
            <div>Proposals created: <strong>{lastResult.proposalsCreated}</strong></div>
            <div>Skipped (no mapping): <strong>{lastResult.skippedNoMapping}</strong></div>
            <div>Skipped (no code): <strong>{lastResult.skippedNoCode}</strong></div>
            <div>Errors: <strong>{lastResult.errors?.length ?? 0}</strong></div>
            <div className="text-muted-foreground">Took {lastResult.durationMs}ms</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Section: Maintenance — backups + purge
// ───────────────────────────────────────────────────────────────────────────
function MaintenanceCard() {
  const { toast } = useToast();
  const [tenantId, setTenantId] = useState("1");
  const [convId, setConvId] = useState("");

  const backupTenant = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/backup-tenant", { tenantId: parseInt(tenantId) });
      return res.json();
    },
    onSuccess: (d: any) => toast({ title: "Tenant backup queued", description: d?.message || "See Drive for files" }),
    onError: (err: any) => toast({ title: "Backup failed", description: err?.message || "See logs", variant: "destructive" }),
  });

  const backupConversation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/backup-conversation", {
        tenantId: parseInt(tenantId),
        conversationId: parseInt(convId),
      });
      return res.json();
    },
    onSuccess: (d: any) => toast({ title: "Conversation backed up", description: d?.message || "See Drive" }),
    onError: (err: any) => toast({ title: "Backup failed", description: err?.message || "See logs", variant: "destructive" }),
  });

  const purge = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/purge-expired", {});
      return res.json();
    },
    onSuccess: (d: any) =>
      toast({
        title: "Purge complete",
        description: `Permanently removed ${d?.purged ?? 0} record(s).`,
      }),
    onError: (err: any) => toast({ title: "Purge failed", description: err?.message || "See logs", variant: "destructive" }),
  });

  return (
    <Card data-testid="card-maintenance">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Cloud className="h-5 w-5 text-primary" />
          <CardTitle>Maintenance</CardTitle>
        </div>
        <CardDescription>Manual backup triggers and destructive cleanup actions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <Label htmlFor="backup-tenant-id">Tenant ID</Label>
            <Input
              id="backup-tenant-id"
              type="number"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              data-testid="input-tenant-id"
            />
          </div>
          <div>
            <Label htmlFor="backup-conv-id">Conversation ID (optional)</Label>
            <Input
              id="backup-conv-id"
              type="number"
              value={convId}
              onChange={(e) => setConvId(e.target.value)}
              placeholder="e.g. 42"
              data-testid="input-conv-id"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              onClick={() => backupTenant.mutate()}
              disabled={backupTenant.isPending || !tenantId}
              data-testid="button-backup-tenant"
            >
              {backupTenant.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Cloud className="h-4 w-4 mr-2" />}
              Back up tenant
            </Button>
            <Button
              variant="outline"
              onClick={() => backupConversation.mutate()}
              disabled={backupConversation.isPending || !tenantId || !convId}
              data-testid="button-backup-conversation"
            >
              {backupConversation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Cloud className="h-4 w-4 mr-2" />}
              Back up conversation
            </Button>
          </div>
        </div>

        <Separator />

        <div className="flex items-start gap-3 p-3 border border-red-500/30 bg-red-500/5 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-1">
            <div className="text-sm font-medium">Permanently purge soft-deleted records</div>
            <div className="text-xs text-muted-foreground">
              This deletes everything currently in soft-deleted state across all tables. There is no undo. Make sure recent Drive backups exist first.
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" data-testid="button-purge">
                <Trash2 className="h-4 w-4 mr-2" /> Purge now
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Permanently purge soft-deleted records?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. All records currently marked as soft-deleted will be permanently removed from the database.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-purge-cancel">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700"
                  onClick={() => purge.mutate()}
                  data-testid="button-purge-confirm"
                >
                  Yes, purge permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────────
export default function AdminToolsPage() {
  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-5xl space-y-6" data-testid="page-admin-tools">
      <div className="flex items-center gap-3">
        <Shield className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Admin tools</h1>
          <p className="text-sm text-muted-foreground">
            Operational utilities that don't fit anywhere else: cost audit, stuck-agent diagnostics, auto-ship policies, research replay, and manual backup/purge.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ClaudeRunnerCard />
        <CostAuditCard />
      </div>

      <StuckDiagnosticsCard />
      <AutoShipPoliciesCard />
      <ReplayResearchCard />
      <MaintenanceCard />
    </div>
  );
}
