import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, DollarSign, Activity, MessageSquare, Clock, TrendingUp } from "lucide-react";

interface PersonaCost {
  id: number;
  name: string;
  role: string;
  emoji: string;
  costTier: string;
  isActive: boolean;
  activityCount: number;
  conversationCount: number;
  completedCount: number;
  failedCount: number;
  successRate: number | null;
  totalMinutes: number;
  estCostUsd: number;
  ratePerMinUsd: number;
  lastActiveAt: string | null;
}

interface PersonaCostResponse {
  tenantId: number;
  windowDays: number;
  computedAt: string;
  rateCard: Record<string, number>;
  totals: { activities: number; conversations: number; minutes: number; estCostUsd: number };
  personas: PersonaCost[];
}

const TIER_COLORS: Record<string, string> = {
  powerful: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-300/40",
  balanced: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-300/40",
  fast: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-300/40",
};

export default function AdminPersonaCostPage() {
  const [windowDays, setWindowDays] = useState(30);
  const { data, isLoading, error } = useQuery<PersonaCostResponse>({
    queryKey: ["/api/admin/persona-cost", windowDays],
    queryFn: async () => {
      const r = await fetch(`/api/admin/persona-cost?windowDays=${windowDays}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-8 text-center text-muted-foreground" data-testid="text-error">
        Failed to load: {(error as any)?.message || "unknown error"}
      </div>
    );
  }

  const sorted = [...data.personas].sort((a, b) => b.estCostUsd - a.estCostUsd);

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Per-Agent Cost Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Cost, usage, and quality across all 16 personas — last {data.windowDays} days.
          </p>
        </div>
        <div className="flex gap-2" data-testid="window-selector">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={windowDays === d ? "default" : "outline"}
              onClick={() => setWindowDays(d)}
              data-testid={`button-window-${d}`}
            >
              {d}d
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-total-cost">
          <CardContent className="pt-5 pb-5 px-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <DollarSign className="w-4 h-4" /> Total est. cost
            </div>
            <div className="text-2xl font-bold" data-testid="text-total-cost">
              ${data.totals.estCostUsd.toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">across all personas</div>
          </CardContent>
        </Card>
        <Card data-testid="card-total-activities">
          <CardContent className="pt-5 pb-5 px-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Activity className="w-4 h-4" /> Activities
            </div>
            <div className="text-2xl font-bold" data-testid="text-total-activities">
              {data.totals.activities.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">agent runs</div>
          </CardContent>
        </Card>
        <Card data-testid="card-total-conversations">
          <CardContent className="pt-5 pb-5 px-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <MessageSquare className="w-4 h-4" /> Conversations
            </div>
            <div className="text-2xl font-bold" data-testid="text-total-conversations">
              {data.totals.conversations.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">distinct threads</div>
          </CardContent>
        </Card>
        <Card data-testid="card-total-minutes">
          <CardContent className="pt-5 pb-5 px-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock className="w-4 h-4" /> Compute minutes
            </div>
            <div className="text-2xl font-bold" data-testid="text-total-minutes">
              {data.totals.minutes.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </div>
            <div className="text-xs text-muted-foreground mt-1">summed wall-clock</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">By persona — sorted by cost</CardTitle>
          <CardDescription>
            Rate card: powerful ${data.rateCard.powerful}/min · balanced ${data.rateCard.balanced}/min · fast ${data.rateCard.fast}/min.
            Estimates based on activity wall-clock × tier rate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-left">
                  <th className="py-2 pr-4 font-medium">Persona</th>
                  <th className="py-2 pr-4 font-medium">Tier</th>
                  <th className="py-2 pr-4 font-medium text-right">Activities</th>
                  <th className="py-2 pr-4 font-medium text-right">Conv.</th>
                  <th className="py-2 pr-4 font-medium text-right">Minutes</th>
                  <th className="py-2 pr-4 font-medium text-right">Success</th>
                  <th className="py-2 pr-4 font-medium text-right">Est. cost</th>
                  <th className="py-2 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => (
                  <tr key={p.id} className="border-b hover:bg-muted/40" data-testid={`row-persona-${p.id}`}>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-lg" aria-hidden>{p.emoji}</span>
                        <div>
                          <div className="font-medium" data-testid={`text-persona-name-${p.id}`}>{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant="outline" className={TIER_COLORS[p.costTier] || ""} data-testid={`badge-tier-${p.id}`}>
                        {p.costTier}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums" data-testid={`text-activity-count-${p.id}`}>
                      {p.activityCount.toLocaleString()}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">{p.conversationCount.toLocaleString()}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{p.totalMinutes.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      {p.successRate == null ? <span className="text-muted-foreground">—</span> : (
                        <span className={p.successRate >= 95 ? "text-green-600 dark:text-green-400" : p.successRate >= 80 ? "" : "text-amber-600 dark:text-amber-400"}>
                          {p.successRate}%
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums font-medium" data-testid={`text-cost-${p.id}`}>
                      ${p.estCostUsd.toFixed(2)}
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">
                      {p.lastActiveAt ? new Date(p.lastActiveAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> A/B & quality
          </CardTitle>
          <CardDescription>
            Active A/B routes are at <a href="/admin/ab-runs" className="underline">/admin/ab-runs</a>.
            Ecosystem health (κ-jury, decline-events, freshness) at <a href="/admin/ecosystem-health" className="underline">/admin/ecosystem-health</a>.
          </CardDescription>
        </CardHeader>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Computed {new Date(data.computedAt).toLocaleTimeString()} · refreshes every 60s
      </p>
    </div>
  );
}
