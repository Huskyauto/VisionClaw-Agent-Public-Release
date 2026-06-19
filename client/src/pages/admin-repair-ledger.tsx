import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Wrench,
  Loader2,
  RefreshCw,
  Undo2,
  ShieldCheck,
  ShieldAlert,
  FileCode2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface VerificationStep {
  name: string;
  ok: boolean;
}
interface FileEdit {
  path: string;
  find: string;
  replace: string;
}
interface NewFile {
  path: string;
  content: string;
}
interface ActionDetail {
  attempts?: number;
  diagnosis?: string;
  rootCause?: string;
  touchedFiles?: string[];
  verification?: { ok?: boolean; steps?: VerificationStep[] };
  reasons?: string[];
  reason?: string;
  revertable?: boolean;
  edits?: FileEdit[];
  newFiles?: NewFile[];
  reverted?: boolean;
  revertedAt?: string;
  revertResult?: { revertedFiles?: string[]; deletedFiles?: string[] };
}
interface Incident {
  id: number;
  source: string;
  signature: string;
  title: string;
  classification: string;
  classification_confidence: number;
  classified_by: string;
  routed_to: string;
  safety_blocked_autofix: boolean;
  jury_verdict: string | null;
  action_taken: string | null;
  action_outcome: string | null;
  action_detail: ActionDetail | null;
  resolved: boolean;
  escalated: boolean;
  human_label: string | null;
  created_at: string;
  resolved_at: string | null;
}
interface LedgerResponse {
  timestamp: string;
  autofixEnabled: boolean;
  stats: {
    total?: number;
    resolved?: number;
    escalated?: number;
    open?: number;
    safety_blocked?: number;
    autofix_disabled?: number;
  };
  incidents: Incident[];
}

const FILTERS = [
  { key: "resolved", label: "Auto-landed" },
  { key: "needs_review", label: "Needs review" },
  { key: "escalated", label: "Escalated" },
  { key: "open", label: "Open" },
  { key: "", label: "All" },
];

function DiffView({ detail }: { detail: ActionDetail }) {
  const edits = detail.edits || [];
  const newFiles = detail.newFiles || [];
  if (!edits.length && !newFiles.length) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No structured diff stored{detail.revertable === false ? " (diff too large to keep for auto-revert)" : ""}.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {edits.map((e, i) => (
        <div key={`e-${i}`} className="rounded-md border border-border/60 overflow-hidden">
          <div className="px-3 py-1.5 bg-muted/50 font-mono text-xs flex items-center gap-2">
            <FileCode2 className="w-3.5 h-3.5" /> {e.path}
          </div>
          <pre className="text-xs overflow-x-auto p-3 leading-relaxed">
            {e.find.split("\n").map((l, j) => (
              <div key={`f-${j}`} className="text-red-600 dark:text-red-400">- {l}</div>
            ))}
            {e.replace.split("\n").map((l, j) => (
              <div key={`r-${j}`} className="text-green-600 dark:text-green-400">+ {l}</div>
            ))}
          </pre>
        </div>
      ))}
      {newFiles.map((f, i) => (
        <div key={`nf-${i}`} className="rounded-md border border-border/60 overflow-hidden">
          <div className="px-3 py-1.5 bg-muted/50 font-mono text-xs flex items-center gap-2">
            <FileCode2 className="w-3.5 h-3.5" /> {f.path} <Badge variant="secondary" className="text-[10px]">new file</Badge>
          </div>
          <pre className="text-xs overflow-x-auto p-3 leading-relaxed">
            {f.content.split("\n").map((l, j) => (
              <div key={`c-${j}`} className="text-green-600 dark:text-green-400">+ {l}</div>
            ))}
          </pre>
        </div>
      ))}
    </div>
  );
}

export default function AdminRepairLedgerPage() {
  const [status, setStatus] = useState("resolved");
  const [reverting, setReverting] = useState<number | null>(null);
  const { toast } = useToast();

  const { data, isLoading, error, refetch, isFetching } = useQuery<LedgerResponse>({
    queryKey: ["/api/admin/repair-incidents", status],
    queryFn: async () => {
      const r = await fetch(`/api/admin/repair-incidents?status=${status}&limit=100`, { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
  });

  const handleRevert = async (id: number) => {
    if (!window.confirm("Undo this automatic fix? The change will be reversed in the working tree.")) return;
    setReverting(id);
    try {
      const res = await apiRequest("POST", `/api/admin/repair-incidents/${id}/revert`);
      const body = await res.json();
      toast({ title: "Fix reverted", description: body.reason || "The change has been undone." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/repair-incidents"] });
    } catch (e: any) {
      let msg = e?.message || "Revert failed";
      try {
        const parsed = JSON.parse(String(msg).replace(/^\d+:\s*/, ""));
        if (parsed?.error) msg = parsed.error;
      } catch {
        /* keep raw message */
      }
      toast({ title: "Revert failed", description: msg, variant: "destructive" });
    } finally {
      setReverting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="ledger-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6" data-testid="ledger-error">
        <p className="text-destructive">Failed to load the repair ledger. Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3" data-testid="text-page-title">
            <Wrench className="w-8 h-8 text-muted-foreground" />
            Self-Repair Ledger
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Every fix the system made to its own code — the diff, how it was verified, and a one-click undo if it looks wrong.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data.autofixEnabled ? (
            <Badge variant="outline" className="gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Auto-fix ON</Badge>
          ) : (
            <Badge variant="secondary" className="gap-1.5"><ShieldAlert className="w-3.5 h-3.5" /> Auto-fix OFF (review only)</Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh">
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {FILTERS.map((f) => (
          <Button
            key={f.key || "all"}
            variant={status === f.key ? "default" : "outline"}
            size="sm"
            onClick={() => setStatus(f.key)}
            data-testid={`button-filter-${f.key || "all"}`}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {data.incidents.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground" data-testid="text-empty">
            No incidents in this view.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.incidents.map((inc) => {
            const detail = inc.action_detail || {};
            const landed = inc.action_taken === "repo_surgeon" && inc.action_outcome === "landed";
            const reverted = detail.reverted === true;
            const canRevert = landed && !reverted && detail.revertable !== false && !!(detail.edits?.length || detail.newFiles?.length);
            const steps = detail.verification?.steps || [];
            return (
              <Card key={inc.id} data-testid={`card-incident-${inc.id}`} className={reverted ? "opacity-70" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <CardTitle className="text-base flex items-center gap-2 flex-wrap" data-testid={`text-title-${inc.id}`}>
                        {landed ? (
                          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                        )}
                        <span className="break-words">{inc.title || inc.signature || `Incident #${inc.id}`}</span>
                      </CardTitle>
                      <CardDescription className="mt-1 flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="text-[10px]">{inc.source}</Badge>
                        <Badge variant="outline" className="text-[10px]">{inc.action_outcome || inc.routed_to}</Badge>
                        {reverted && <Badge variant="destructive" className="text-[10px]" data-testid={`badge-reverted-${inc.id}`}>reverted</Badge>}
                        <span className="text-xs">{new Date(inc.created_at).toLocaleString()}</span>
                      </CardDescription>
                    </div>
                    {landed && (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={!canRevert || reverting === inc.id}
                        onClick={() => handleRevert(inc.id)}
                        data-testid={`button-revert-${inc.id}`}
                      >
                        {reverting === inc.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Undo2 className="w-4 h-4" />
                        )}
                        <span className="ml-1.5">{reverted ? "Reverted" : "Revert"}</span>
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {detail.rootCause && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Root cause</div>
                      <p data-testid={`text-rootcause-${inc.id}`}>{detail.rootCause}</p>
                    </div>
                  )}
                  {!!(detail.touchedFiles?.length) && (
                    <div>
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Touched files</div>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.touchedFiles!.map((f) => (
                          <code key={f} className="text-xs bg-muted px-1.5 py-0.5 rounded">{f}</code>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Diff</div>
                    <DiffView detail={detail} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Verification</div>
                    {steps.length ? (
                      <div className="flex flex-wrap gap-1.5" data-testid={`verification-${inc.id}`}>
                        {steps.map((s, i) => (
                          <Badge key={`${s.name}-${i}`} variant={s.ok ? "outline" : "destructive"} className="text-[10px] gap-1">
                            {s.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                            {s.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">no verification steps recorded</p>
                    )}
                  </div>
                  {reverted && detail.revertedAt && (
                    <p className="text-xs text-muted-foreground" data-testid={`text-revertedat-${inc.id}`}>
                      Reverted {new Date(detail.revertedAt).toLocaleString()}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-6 text-center" data-testid="text-generated-at">
        Generated {new Date(data.timestamp).toLocaleString()}
      </p>
    </div>
  );
}
