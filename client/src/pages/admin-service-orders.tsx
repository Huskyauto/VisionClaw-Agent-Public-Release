import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, CheckCircle2, XCircle, FileText, AlertTriangle, ExternalLink, RefreshCw, Zap, Shield } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface QaResult {
  passed: boolean;
  issues: string[];
  pageCount?: number;
  fileSizeBytes?: number;
  totalChars?: number;
  perSection?: { heading: string; chars: number; flagged: boolean }[];
}

interface ReviewItem {
  id: string;
  sessionId: string;
  sku: string;
  productName: string;
  customerEmail: string;
  customerName: string;
  intake: Record<string, string | undefined>;
  filePath: string;
  fileName: string;
  qa: QaResult;
  status: "pending" | "approved" | "rejected" | "shipped" | "failed";
  createdAt: string;
  reviewedAt?: string;
  rejectedReason?: string;
  deliveryId?: number;
  deliveryLinkVerified?: boolean;
  modelUsed?: string;
  pages?: number;
}

function statusBadge(status: ReviewItem["status"]) {
  const map: Record<ReviewItem["status"], { label: string; cls: string }> = {
    pending: { label: "Pending review", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
    shipped: { label: "Shipped", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" },
    rejected: { label: "Rejected", cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
    failed: { label: "Generation failed", cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
    approved: { label: "Approved", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30" },
  };
  const m = map[status] || map.pending;
  return <Badge variant="outline" className={m.cls} data-testid={`badge-status-${status}`}>{m.label}</Badge>;
}

function ReviewCard({ item, onChange }: { item: ReviewItem; onChange: () => void }) {
  const { toast } = useToast();
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const approve = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/admin/service-orders/${item.id}/approve`, {});
    },
    onSuccess: async (res: any) => {
      const data = await res.json();
      const verified = data?.delivery?.linkVerified;
      toast({
        title: "Shipped",
        description: verified
          ? `Delivery email sent and download link verified.`
          : `Delivery sent — link verification ${verified === false ? "FAILED, please check Drive manually" : "skipped"}.`,
        variant: verified === false ? "destructive" : "default",
      });
      onChange();
    },
    onError: (err: any) => {
      toast({ title: "Approval failed", description: err.message || "See server logs", variant: "destructive" });
    },
  });

  const reject = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/admin/service-orders/${item.id}/reject`, { reason: rejectReason });
    },
    onSuccess: () => {
      toast({ title: "Order rejected", description: "Customer NOT emailed automatically — handle refund manually." });
      setShowReject(false);
      setRejectReason("");
      onChange();
    },
    onError: (err: any) => {
      toast({ title: "Reject failed", description: err.message || "See server logs", variant: "destructive" });
    },
  });

  const intakeEntries = Object.entries(item.intake || {}).filter(([, v]) => v != null && String(v).trim().length > 0);
  const canAct = item.status === "pending";
  const fileUrl = `/api/admin/service-orders/${item.id}/file`;

  return (
    <Card data-testid={`card-review-${item.id}`} className={item.qa && !item.qa.passed && item.status === "pending" ? "border-amber-500/50" : ""}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base" data-testid={`text-product-${item.id}`}>{item.productName}</CardTitle>
            <CardDescription className="mt-1" data-testid={`text-customer-${item.id}`}>
              {item.customerEmail} · {new Date(item.createdAt).toLocaleString()}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge(item.status)}
            {item.qa?.passed === false && item.status === "pending" && (
              <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
                <AlertTriangle className="h-3 w-3 mr-1" /> QA flagged
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div><span className="text-muted-foreground">Pages:</span> <span data-testid={`text-pages-${item.id}`}>{item.pages ?? "?"}</span></div>
          <div><span className="text-muted-foreground">File size:</span> {item.qa?.fileSizeBytes != null ? `${Math.round(item.qa.fileSizeBytes / 1024)} KB` : "?"}</div>
          <div><span className="text-muted-foreground">Total chars:</span> {item.qa?.totalChars ?? "?"}</div>
          <div><span className="text-muted-foreground">Model:</span> <span className="font-mono text-[10px]">{item.modelUsed || "?"}</span></div>
        </div>

        {intakeEntries.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Customer intake</div>
            {intakeEntries.map(([k, v]) => (
              <div key={k} className="text-xs"><span className="text-muted-foreground">{k}:</span> {v}</div>
            ))}
          </div>
        )}

        {item.qa?.issues?.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-1">
            <div className="font-semibold text-amber-700 dark:text-amber-400">Auto-QA issues:</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {item.qa.issues.map((i, idx) => <li key={idx}>{i}</li>)}
            </ul>
          </div>
        )}

        {item.qa?.perSection && item.qa.perSection.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Section lengths ({item.qa.perSection.length})</summary>
            <div className="mt-2 space-y-1 pl-2">
              {item.qa.perSection.map((s, idx) => (
                <div key={idx} className={s.flagged ? "text-amber-600 dark:text-amber-400" : ""}>
                  {s.heading}: {s.chars} chars{s.flagged ? " (flagged)" : ""}
                </div>
              ))}
            </div>
          </details>
        )}

        {item.status === "shipped" && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
            <div>Delivery ID: {item.deliveryId}</div>
            <div>Download link verified: {item.deliveryLinkVerified === true ? "Yes" : item.deliveryLinkVerified === false ? "NO — check Drive!" : "Not checked"}</div>
            <div>Shipped: {item.reviewedAt ? new Date(item.reviewedAt).toLocaleString() : "?"}</div>
          </div>
        )}

        {item.status === "rejected" && item.rejectedReason && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs">
            Rejected: {item.rejectedReason}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <a href={fileUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" data-testid={`button-preview-${item.id}`}>
              <FileText className="h-4 w-4 mr-2" /> Open PDF for proofread
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </a>
          {canAct && !showReject && (
            <>
              <Button
                size="sm"
                onClick={() => approve.mutate()}
                disabled={approve.isPending}
                data-testid={`button-approve-${item.id}`}
              >
                {approve.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Approve & ship
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowReject(true)}
                disabled={approve.isPending}
                data-testid={`button-reject-open-${item.id}`}
              >
                <XCircle className="h-4 w-4 mr-2" /> Reject
              </Button>
            </>
          )}
        </div>

        {showReject && (
          <div className="space-y-2 pt-2 border-t">
            <Label htmlFor={`reject-${item.id}`} className="text-xs">Reason (internal — not emailed to customer)</Label>
            <Textarea
              id={`reject-${item.id}`}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
              placeholder="e.g. Hallucinated source citations in section 3 — regenerate manually"
              data-testid={`textarea-reject-reason-${item.id}`}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => reject.mutate()}
                disabled={reject.isPending || !rejectReason.trim()}
                data-testid={`button-reject-confirm-${item.id}`}
              >
                {reject.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Confirm reject
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowReject(false); setRejectReason(""); }}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface SkuStats {
  sku: string;
  cleanShips: number;
  brokenShips: number;
  rejected: number;
  failed: number;
  pending: number;
  totalOrders: number;
  cleanShipsSinceReset: number;
  brokenShipsSinceReset: number;
  recent: string;
}

interface AutoShipPolicy {
  sku: string;
  enabled: boolean;
  threshold: number;
  enabledAt?: string;
  disabledAt?: string;
  lastAutoDisableReason?: string;
  policyResetAt?: string;
}

interface PolicyEntry {
  sku: string;
  productName: string;
  stats: SkuStats;
  policy: AutoShipPolicy;
}

function PolicyRow({ entry, onChange }: { entry: PolicyEntry; onChange: () => void }) {
  const { toast } = useToast();
  // Mirror the server-side gate: count only ships since the last policy
  // reset (after a broken ship, the SKU has to earn a fresh streak).
  const eligible = entry.stats.cleanShipsSinceReset >= entry.policy.threshold && entry.stats.brokenShipsSinceReset === 0;
  const progress = Math.min(100, Math.round((entry.stats.cleanShipsSinceReset / Math.max(1, entry.policy.threshold)) * 100));

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      return await apiRequest("POST", `/api/admin/service-orders/policy/${entry.sku}`, { enabled });
    },
    onSuccess: async (res: any) => {
      const data = await res.json().catch(() => ({}));
      toast({
        title: data?.policy?.enabled ? "Auto-ship enabled" : "Auto-ship disabled",
        description: data?.policy?.enabled
          ? `New orders for ${entry.productName} will ship automatically when QA passes.`
          : `New orders for ${entry.productName} will be held for manual review.`,
      });
      onChange();
    },
    onError: async (err: any) => {
      toast({ title: "Couldn't update policy", description: err.message || "Server refused the change.", variant: "destructive" });
    },
  });

  return (
    <div className="rounded-md border p-3 space-y-2" data-testid={`policy-row-${entry.sku}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium text-sm flex items-center gap-2">
            {entry.policy.enabled ? <Zap className="h-4 w-4 text-emerald-500" /> : <Shield className="h-4 w-4 text-muted-foreground" />}
            {entry.productName}
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">{entry.sku}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" data-testid={`policy-mode-${entry.sku}`}>
            {entry.policy.enabled ? "Auto-ship" : "Manual review"}
          </span>
          <Switch
            checked={entry.policy.enabled}
            onCheckedChange={(v) => toggle.mutate(v)}
            disabled={toggle.isPending || (!entry.policy.enabled && !eligible)}
            data-testid={`switch-autoship-${entry.sku}`}
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between items-center text-xs">
          <span className="text-muted-foreground">
            {entry.policy.policyResetAt ? "Clean ships since reset" : "Clean manual ships"}
          </span>
          <span className="font-mono">
            {entry.stats.cleanShipsSinceReset} / {entry.policy.threshold}
            {entry.policy.policyResetAt && entry.stats.cleanShips !== entry.stats.cleanShipsSinceReset && (
              <span className="text-muted-foreground ml-1">(lifetime: {entry.stats.cleanShips})</span>
            )}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full transition-all ${eligible ? "bg-emerald-500" : "bg-blue-500"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>Pending: <span className="text-foreground">{entry.stats.pending}</span></span>
        <span>Shipped: <span className="text-foreground">{entry.stats.cleanShips}</span></span>
        {entry.stats.brokenShips > 0 && <span className="text-red-500">Broken: {entry.stats.brokenShips}</span>}
        {entry.stats.rejected > 0 && <span>Rejected: {entry.stats.rejected}</span>}
        {entry.stats.failed > 0 && <span>Failed: {entry.stats.failed}</span>}
        {entry.stats.recent && (
          <span title="Most recent 10 outcomes (left = newest). C=clean, B=broken, R=rejected, F=failed, P=pending">
            Recent: <span className="font-mono">{entry.stats.recent}</span>
          </span>
        )}
      </div>

      {!entry.policy.enabled && !eligible && (
        <div className="text-xs text-muted-foreground italic">
          {entry.stats.brokenShipsSinceReset > 0
            ? `Cannot enable while ${entry.stats.brokenShipsSinceReset} broken ship(s) are on file since last reset.`
            : `Need ${entry.policy.threshold - entry.stats.cleanShipsSinceReset} more clean manual ship${entry.policy.threshold - entry.stats.cleanShipsSinceReset === 1 ? "" : "s"} to unlock auto-ship.`}
        </div>
      )}
      {entry.policy.lastAutoDisableReason && !entry.policy.enabled && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          {entry.policy.lastAutoDisableReason}
        </div>
      )}
    </div>
  );
}

function PolicyPanel() {
  // R74.3 — Use apiRequest so JWT bearer tokens are injected for token-only
  // sessions. Raw fetch() bypassed getAuthHeaders() and 401'd in those flows.
  const { data, refetch, isLoading, isError, error } = useQuery<{ policies: PolicyEntry[] }>({
    queryKey: ["/api/admin/service-orders/policy"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/service-orders/policy");
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const onChange = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/service-orders/policy"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/service-orders"] });
    refetch();
  };
  const policies = data?.policies || [];

  return (
    <Card className="mb-6" data-testid="card-policy-panel">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4" /> Auto-ship policy per product
        </CardTitle>
        <CardDescription>
          Once a product has a clean track record of manual ships, you can flip auto-ship on. New orders skip the review queue and deliver immediately when automated quality checks pass. If any auto-shipped delivery ever fails link verification, auto-ship snaps back off until you investigate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="py-4 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : isError ? (
          <div className="text-sm text-destructive" data-testid="text-policy-error">
            Failed to load auto-ship policy: {(error as Error)?.message || "Unknown error"}.
            <button
              className="ml-2 underline"
              onClick={() => refetch()}
              data-testid="button-retry-policy"
            >Retry</button>
          </div>
        ) : policies.length === 0 ? (
          <div className="text-sm text-muted-foreground">No service products in the catalog.</div>
        ) : (
          policies.map(p => <PolicyRow key={p.sku} entry={p} onChange={onChange} />)
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminServiceOrdersPage() {
  const [filter, setFilter] = useState<"all" | "pending" | "shipped" | "rejected" | "failed">("pending");

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<{ items: ReviewItem[] }>({
    queryKey: ["/api/admin/service-orders", filter],
    queryFn: async () => {
      const url = filter === "all" ? "/api/admin/service-orders" : `/api/admin/service-orders?status=${filter}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
    refetchInterval: 30_000,
  });

  // Highlight the item linked from a token URL (?token=xxx) by scrolling to it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("token")) return;
    setTimeout(() => {
      const first = document.querySelector('[data-testid^="card-review-"]');
      first?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 500);
  }, [data]);

  const items = data?.items || [];
  const onChange = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/service-orders"] });
    refetch();
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Service order review queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every service-product order pauses here so you can proofread the PDF and verify the download link before anything ships to the customer.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh">
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <PolicyPanel />

      <div className="flex gap-2 mb-6 flex-wrap">
        {(["pending", "shipped", "rejected", "failed", "all"] as const).map(f => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
            data-testid={`button-filter-${f}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
      ) : isError ? (
        <Card>
          <CardContent className="py-12 text-center" data-testid="text-error">
            <p className="text-sm text-destructive mb-3">
              Failed to load service orders: {(error as Error)?.message || "Unknown error"}.
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-retry">
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-empty">
            No {filter === "all" ? "" : filter} orders in the queue.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map(item => <ReviewCard key={item.id} item={item} onChange={onChange} />)}
        </div>
      )}
    </div>
  );
}
