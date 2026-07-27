import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CheckCircle2, XCircle, AlertTriangle, Clock, FileCode, RotateCcw, Play, ChevronRight } from "lucide-react";
import { Link } from "wouter";

type Proposal = {
  id: number;
  title: string;
  description: string;
  target_file: string;
  code_diff: string;
  rationale: string;
  source: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_at: string | null;
  created_at: string;
  verification_status: string | null;
  verification_details: string | null;
  verified_at: string | null;
};

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "secondary" },
  ready: { label: "Ready", variant: "outline" },
  needs_review: { label: "Needs Review", variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  applied: { label: "Applied", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  reverted: { label: "Reverted", variant: "destructive" },
  failed: { label: "Failed", variant: "destructive" },
};

function VerificationBadge({ status }: { status: string | null }) {
  const s = status || "unverified";
  const config: Record<string, { icon: any; label: string; cls: string }> = {
    passed: { icon: CheckCircle2, label: "Verified", cls: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" },
    failed: { icon: XCircle, label: "Failed", cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
    pending: { icon: Clock, label: "Verifying…", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30" },
    unverified: { icon: AlertTriangle, label: "Unverified", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  };
  const c = config[s] || config.unverified;
  const Icon = c.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${c.cls}`}
      data-testid={`badge-verification-${s}`}
    >
      <Icon className="w-3 h-3" />
      {c.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_LABELS[status] || { label: status, variant: "outline" as const };
  return (
    <Badge variant={cfg.variant} data-testid={`badge-status-${status}`}>
      {cfg.label}
    </Badge>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/research/code-proposals"] });

  const approveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/research/code-proposals/${proposal.id}`, { status: "approved", reviewed_by: "admin" }),
    onSuccess: () => {
      toast({ title: "Proposal approved", description: "Apply is now available." });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });

  const applyMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/research/code-proposals/${proposal.id}/apply`, {}),
    onSuccess: () => {
      toast({ title: "Proposal applied", description: "Code changes written to disk." });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  const revertMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/research/code-proposals/${proposal.id}/revert`, {}),
    onSuccess: () => {
      toast({ title: "Proposal reverted", description: "Original file restored from snapshot." });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Revert failed", description: e.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/research/code-proposals/${proposal.id}`, { status: "rejected", reviewed_by: "admin" }),
    onSuccess: () => {
      toast({ title: "Proposal rejected" });
      invalidate();
    },
    onError: (e: any) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  // Lifecycle alignment with backend (server/research-engine.ts safeApplyProposal):
  //   - Approve is offered for review-stage proposals once the verifier has passed.
  //   - Apply is only valid when status === "approved" AND verification_status === "passed".
  //   - Revert is only valid for applied proposals.
  //   - Reject is valid for any non-terminal state.
  const isVerified = proposal.verification_status === "passed";
  const reviewable = ["pending", "ready", "needs_review"].includes(proposal.status);
  const canApprove = reviewable && isVerified;
  const canApply = proposal.status === "approved" && isVerified;
  const canRevert = proposal.status === "applied";
  const canReject = !["applied", "rejected", "reverted"].includes(proposal.status);

  return (
    <Card className="hover-elevate" data-testid={`card-proposal-${proposal.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <FileCode className="w-4 h-4 shrink-0 text-muted-foreground" />
              <span data-testid={`text-title-${proposal.id}`}>{proposal.title}</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 truncate" data-testid={`text-target-${proposal.id}`}>
              {proposal.target_file}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <StatusBadge status={proposal.status} />
            <VerificationBadge status={proposal.verification_status} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground" data-testid={`text-description-${proposal.id}`}>
          {proposal.description}
        </p>

        {proposal.verification_details && (
          <div className="text-xs bg-muted/50 rounded p-2 font-mono whitespace-pre-wrap" data-testid={`text-verification-${proposal.id}`}>
            {proposal.verification_details.slice(0, 500)}
            {proposal.verification_details.length > 500 && "…"}
          </div>
        )}

        {expanded && (
          <>
            <div>
              <p className="text-xs font-semibold mb-1 text-muted-foreground">Rationale</p>
              <p className="text-sm">{proposal.rationale}</p>
            </div>
            <div>
              <p className="text-xs font-semibold mb-1 text-muted-foreground">Diff</p>
              <pre className="text-xs bg-muted/50 rounded p-3 overflow-x-auto max-h-96 font-mono" data-testid={`text-diff-${proposal.id}`}>
                {proposal.code_diff}
              </pre>
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setExpanded((v) => !v)}
            data-testid={`button-toggle-${proposal.id}`}
          >
            <ChevronRight className={`w-3.5 h-3.5 mr-1 transition-transform ${expanded ? "rotate-90" : ""}`} />
            {expanded ? "Hide details" : "Show details"}
          </Button>
          <div className="flex items-center gap-2">
            {canReject && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={rejectMutation.isPending}
                onClick={() => rejectMutation.mutate()}
                data-testid={`button-reject-${proposal.id}`}
              >
                Reject
              </Button>
            )}
            {canRevert && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                disabled={revertMutation.isPending}
                onClick={() => revertMutation.mutate()}
                data-testid={`button-revert-${proposal.id}`}
              >
                <RotateCcw className="w-3 h-3" />
                Revert
              </Button>
            )}
            {canApprove && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={approveMutation.isPending}
                onClick={() => approveMutation.mutate()}
                data-testid={`button-approve-${proposal.id}`}
              >
                Approve
              </Button>
            )}
            {canApply && (
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={applyMutation.isPending}
                onClick={() => applyMutation.mutate()}
                data-testid={`button-apply-${proposal.id}`}
              >
                <Play className="w-3 h-3" />
                Apply
              </Button>
            )}
            {reviewable && !isVerified && (
              <span className="text-xs text-muted-foreground" title="Approve and Apply are blocked until verification passes">
                Awaiting verification
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CodeProposalsPage() {
  const [filter, setFilter] = useState<string>("all");

  // Architect-flagged (Round 25.2): the default queryFn joins keys with "/" — so
  // ["/api/research/code-proposals", "pending"] would hit `/code-proposals/pending`
  // (which matches the GET-by-id route). Use a custom queryFn that maps the second
  // key segment to a `?status=` query param when present.
  // R74.3 — Use apiRequest so JWT bearer tokens are injected for token-only
  // sessions. Raw fetch() bypassed getAuthHeaders() and 401'd in those flows.
  const { data: proposals, isLoading, isError, error, refetch } = useQuery<Proposal[]>({
    queryKey: ["/api/research/code-proposals", filter === "all" ? "all" : filter],
    queryFn: async () => {
      const url =
        filter === "all"
          ? "/api/research/code-proposals"
          : `/api/research/code-proposals?status=${encodeURIComponent(filter)}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const counts = (proposals || []).reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  const filtered = proposals || [];

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-5xl space-y-4" data-testid="page-code-proposals">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Code Proposals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-research patches awaiting human review. Apply is blocked unless the verifier passed (worktree shadow apply + tsc).
          </p>
        </div>
        <Link href="/research">
          <Button variant="outline" size="sm" data-testid="link-research">Back to Research</Button>
        </Link>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {["all", "pending", "ready", "needs_review", "applied", "rejected", "reverted", "failed"].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={filter === s ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setFilter(s)}
            data-testid={`button-filter-${s}`}
          >
            {s === "all" ? "All" : STATUS_LABELS[s]?.label || s}
            {s !== "all" && counts[s] != null && (
              <span className="ml-1.5 opacity-70">{counts[s]}</span>
            )}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="p-8 text-center" data-testid="text-error">
            <p className="text-sm text-destructive mb-2">
              Failed to load proposals: {(error as Error)?.message || "Unknown error"}.
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()} data-testid="button-retry">Retry</Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-empty">
            <FileCode className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No proposals {filter !== "all" && `with status "${filter}"`}.</p>
            <p className="text-xs mt-1">Auto-research generates these from research sessions.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => <ProposalCard key={p.id} proposal={p} />)}
        </div>
      )}
    </div>
  );
}
