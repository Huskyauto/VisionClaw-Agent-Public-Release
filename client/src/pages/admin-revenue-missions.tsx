import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Target, DollarSign, MessageSquare, Skull, CheckCircle2, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PortfolioReview {
  generatedAt: string;
  missions: Array<{
    missionId: number;
    name: string;
    verdict: string;
    realizedMarginUsdCents: number;
    reasons: string[];
  }>;
  portfolio: {
    activeUnproven: number;
    maxActiveUnproven: number;
    overCapacity: boolean;
    totalRealizedMarginUsdCents: number;
    recommendations: string[];
  };
}

interface Mission {
  id: number;
  name: string;
  hypothesis: string;
  ideal_customer: string;
  offer: string;
  price_usd: number;
  acquisition_channel: string;
  stage: string;
  killed_reason: string | null;
  leads_contacted: number;
  positive_replies: number;
  negative_replies: number;
  calls_booked: number;
  payments_received: number;
  revenue_usd_cents: number;
  refunds_usd_cents: number;
  spend_usd_cents: number;
  max_cash_at_risk_usd: number | string | null;
  autonomy_level: number;
  created_at: string;
}

// Autonomy ladder (S5c) — level changes are HITL-only: this selector (owner
// session) is the ONLY way to change them; there is no agent tool for it.
const AUTONOMY_LABELS: Record<number, string> = {
  0: "0 — propose only",
  1: "1 — create assets",
  2: "2 — run approved experiment",
  3: "3 — contact prospects (capped)",
  4: "4 — auto fulfillment kickoff on payment",
  5: "5 — reinvest ≤10% realized margin",
  6: "6 — scale (always human approval)",
};

const STAGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  hypothesis: "outline",
  evidence_gathering: "outline",
  offer_defined: "secondary",
  experiment_draft: "secondary",
  experiment_awaiting_approval: "default",
  experiment_live: "default",
  evaluating: "secondary",
  presell: "default",
  scale_ready: "default",
  killed: "destructive",
};

const HARD_SPEND_CAP_CENTS = 2500; // contract ceiling; mission rows may tighten, never raise

function usd(cents: number): string {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
}

function doneChecks(m: Mission) {
  const contacted = Number(m.leads_contacted) || 0;
  const positive = Number(m.positive_replies) || 0;
  const revenue = Number(m.revenue_usd_cents) || 0;
  const refunds = Number(m.refunds_usd_cents) || 0;
  const spend = Number(m.spend_usd_cents) || 0;
  return {
    validationComplete: contacted >= 10 && positive >= 3,
    firstDollarComplete: revenue - refunds > 0 && revenue - refunds > spend,
  };
}

function spendCapCents(m: Mission): number {
  const n = Math.floor(Number(m.max_cash_at_risk_usd) * 100);
  if (!Number.isFinite(n) || n <= 0) return HARD_SPEND_CAP_CENTS;
  return Math.min(n, HARD_SPEND_CAP_CENTS);
}

function MissionCard({ m }: { m: Mission }) {
  const { toast } = useToast();
  const [killing, setKilling] = useState(false);
  const checks = doneChecks(m);
  const cap = spendCapCents(m);
  const spend = Number(m.spend_usd_cents) || 0;
  const net = (Number(m.revenue_usd_cents) || 0) - (Number(m.refunds_usd_cents) || 0);

  const autonomyMutation = useMutation({
    mutationFn: async (level: number) =>
      apiRequest("POST", `/api/revenue-missions/${m.id}/autonomy`, { level }),
    onSuccess: (_res, level) => {
      queryClient.invalidateQueries({ queryKey: ["/api/revenue-missions"] });
      toast({ title: `Autonomy set to level ${level}`, description: AUTONOMY_LABELS[level] });
    },
    onError: (err: any) => toast({ title: "Autonomy change failed", description: String(err?.message || err), variant: "destructive" }),
  });

  const killMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/revenue-missions/${m.id}/kill`, { reason: "killed from admin UI" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/revenue-missions"] });
      toast({ title: `Mission "${m.name}" killed`, description: "Live enrollments paused." });
    },
    onError: (err: any) => toast({ title: "Kill failed", description: String(err?.message || err), variant: "destructive" }),
    onSettled: () => setKilling(false),
  });

  return (
    <Card data-testid={`card-mission-${m.id}`} className={m.stage === "killed" ? "opacity-60" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-lg truncate" data-testid={`text-mission-name-${m.id}`}>{m.name}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2">{m.offer} — {usd((Number(m.price_usd) || 0) * 100)} via {m.acquisition_channel}</CardDescription>
          </div>
          <Badge variant={STAGE_VARIANT[m.stage] ?? "outline"} data-testid={`badge-mission-stage-${m.id}`}>
            {m.stage.replace(/_/g, " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground line-clamp-2">{m.hypothesis}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div className="rounded-md border p-2" data-testid={`stat-contacted-${m.id}`}>
            <div className="text-muted-foreground text-xs flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Contacted</div>
            <div className="font-semibold">{m.leads_contacted}</div>
          </div>
          <div className="rounded-md border p-2" data-testid={`stat-replies-${m.id}`}>
            <div className="text-muted-foreground text-xs">Replies +/−</div>
            <div className="font-semibold">{m.positive_replies} / {m.negative_replies}</div>
          </div>
          <div className="rounded-md border p-2" data-testid={`stat-payments-${m.id}`}>
            <div className="text-muted-foreground text-xs flex items-center gap-1"><DollarSign className="h-3 w-3" /> Payments</div>
            <div className="font-semibold">{m.payments_received} · {usd(net)} net</div>
          </div>
          <div className="rounded-md border p-2" data-testid={`stat-spend-${m.id}`}>
            <div className="text-muted-foreground text-xs">Spend vs cap</div>
            <div className={`font-semibold ${spend >= cap ? "text-destructive" : ""}`}>{usd(spend)} / {usd(cap)}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={checks.validationComplete ? "default" : "outline"} data-testid={`badge-validation-${m.id}`}>
            <ShieldCheck className="h-3 w-3 mr-1" />
            {checks.validationComplete ? "validation complete" : "validating (10 contacted + 3 positive)"}
          </Badge>
          <Badge variant={checks.firstDollarComplete ? "default" : "outline"} data-testid={`badge-first-dollar-${m.id}`}>
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {checks.firstDollarComplete ? "first dollar (net > spend)" : "no verified profit yet"}
          </Badge>
          {m.stage === "killed" && m.killed_reason && (
            <span className="text-xs text-muted-foreground">reason: {m.killed_reason}</span>
          )}
        </div>

        {m.stage !== "killed" && (
          <div className="flex items-center gap-2 text-sm" data-testid={`autonomy-row-${m.id}`}>
            <span className="text-muted-foreground text-xs whitespace-nowrap">Autonomy</span>
            <select
              className="border rounded-md px-2 py-1 bg-background text-sm flex-1 min-w-0"
              value={Number(m.autonomy_level) || 0}
              disabled={autonomyMutation.isPending}
              onChange={(e) => autonomyMutation.mutate(Number(e.target.value))}
              data-testid={`select-autonomy-${m.id}`}
            >
              {Object.entries(AUTONOMY_LABELS).map(([lvl, label]) => (
                <option key={lvl} value={lvl}>{label}</option>
              ))}
            </select>
            {autonomyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
        )}

        {m.stage !== "killed" && (
          <div className="flex justify-end">
            {killing ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setKilling(false)} data-testid={`button-kill-cancel-${m.id}`}>Cancel</Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={killMutation.isPending}
                  onClick={() => killMutation.mutate()}
                  data-testid={`button-kill-confirm-${m.id}`}
                >
                  {killMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Skull className="h-4 w-4 mr-1" />}
                  Confirm kill
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setKilling(true)} data-testid={`button-kill-${m.id}`}>
                <Skull className="h-4 w-4 mr-1" /> Kill mission
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminRevenueMissionsPage() {
  const { data, isLoading, error } = useQuery<{ missions: Mission[] }>({
    queryKey: ["/api/revenue-missions"],
  });
  const { data: review } = useQuery<PortfolioReview>({
    queryKey: ["/api/revenue-missions/portfolio/review"],
    enabled: (data?.missions?.length ?? 0) > 0,
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Target className="h-6 w-6" /> Revenue Missions
        </h1>
        <p className="text-muted-foreground mt-1">
          Verified business experiments — judged by external evidence (replies, payments), never model output.
          Hard caps per experiment: 25 prospects · 3 contacts · $25. Nothing sends without owner approval.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground" data-testid="status-loading">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading missions…
        </div>
      )}
      {error != null && (
        <div className="text-destructive text-sm" data-testid="status-error">
          Failed to load missions: {String((error as any)?.message || error)}
        </div>
      )}
      {!isLoading && !error && (data?.missions?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground" data-testid="status-empty">
            No missions yet. Create one via <code className="text-xs">POST /api/revenue-missions</code> or ask the agent to draft a mission from a wedge offer.
          </CardContent>
        </Card>
      )}

      {review && (
        <Card data-testid="card-portfolio-review">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Portfolio review (advisory)
              {review.portfolio.overCapacity && (
                <Badge variant="destructive" data-testid="badge-over-capacity">over capacity</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="text-muted-foreground text-xs">
              {review.portfolio.activeUnproven}/{review.portfolio.maxActiveUnproven} active unproven missions ·
              realized margin ${(review.portfolio.totalRealizedMarginUsdCents / 100).toFixed(2)} ·
              generated {new Date(review.generatedAt).toLocaleString()}
            </div>
            <ul className="list-disc pl-5 space-y-1">
              {review.portfolio.recommendations.map((r, i) => (
                <li key={i} data-testid={`text-recommendation-${i}`}>{r}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Advisory only — kill, approve, and autonomy changes are always your call.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {(data?.missions ?? []).map((m) => <MissionCard key={m.id} m={m} />)}
      </div>
    </div>
  );
}
