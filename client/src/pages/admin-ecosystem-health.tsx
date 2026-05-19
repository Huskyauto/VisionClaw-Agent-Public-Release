import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2, Activity, ShieldAlert, Clock, GitBranch } from "lucide-react";

interface EcosystemHealth {
  tenantId: number;
  computedAt: string;
  diversity: {
    perCategory: Array<{ category: string; distinctFamilies: number; rowCount: number }>;
    averageFamilies: number;
    threshold: number;
    breached: boolean;
  };
  coverage: { totalCategories: number; matureCategories: number; coverageRatio: number; threshold: number; breached: boolean };
  contradiction: { sampleSize: number; lowConcordanceCount: number; contradictionRatio: number; threshold: number; breached: boolean };
  freshness: { sampleSize: number; medianAgeDays: number; threshold: number; breached: boolean };
  anyBreached: boolean;
}

interface DeclineEvent {
  id: number;
  persona_id: number | null;
  conversation_id: number | null;
  source: string;
  reason: string;
  detail: string | null;
  tool_name: string | null;
  flagged_categories: string[] | null;
  created_at: string;
}

function MetricCard({ title, icon: Icon, breached, children, description }: { title: string; icon: any; breached: boolean; description: string; children: React.ReactNode }) {
  return (
    <Card data-testid={`card-metric-${title.toLowerCase().replace(/\s+/g, "-")}`} className={breached ? "border-destructive" : ""}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${breached ? "text-destructive" : "text-primary"}`} />
            <CardTitle>{title}</CardTitle>
          </div>
          {breached ? (
            <Badge variant="destructive" data-testid={`badge-breach-${title.toLowerCase().replace(/\s+/g, "-")}`}>
              <AlertTriangle className="h-3 w-3 mr-1" /> threshold breached
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid={`badge-ok-${title.toLowerCase().replace(/\s+/g, "-")}`}>
              <CheckCircle2 className="h-3 w-3 mr-1" /> within threshold
            </Badge>
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function AdminEcosystemHealthPage() {
  const { data, isLoading, error } = useQuery<EcosystemHealth>({
    queryKey: ["/api/admin/ecosystem-health"],
    refetchInterval: 60_000,
  });
  const { data: declines } = useQuery<{ events: DeclineEvent[]; count: number }>({
    queryKey: ["/api/admin/decline-events"],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center" data-testid="state-loading">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6 text-destructive" data-testid="state-error">
            Failed to load ecosystem health: {(error as Error)?.message || "unknown"}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-ecosystem-health">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Ecosystem Health</h1>
          <p className="text-muted-foreground text-sm" data-testid="text-page-subtitle">
            MNEMA Nugget 6 — diversity, coverage, contradiction density, freshness. Last computed {new Date(data.computedAt).toLocaleString()}.
          </p>
        </div>
        {data.anyBreached ? (
          <Badge variant="destructive" data-testid="badge-overall-breach">
            <AlertTriangle className="h-4 w-4 mr-1" /> 1+ thresholds breached
          </Badge>
        ) : (
          <Badge variant="secondary" data-testid="badge-overall-ok">
            <CheckCircle2 className="h-4 w-4 mr-1" /> all thresholds OK
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <MetricCard
          title="Diversity"
          icon={GitBranch}
          breached={data.diversity.breached}
          description={`Distinct extractor families per memory category. Threshold: ≥ ${data.diversity.threshold} per mature category.`}
        >
          <div className="space-y-2">
            <div className="text-2xl font-bold" data-testid="text-diversity-avg">{data.diversity.averageFamilies}</div>
            <div className="text-sm text-muted-foreground">avg families/category across {data.diversity.perCategory.length} categories</div>
            {data.diversity.perCategory.slice(0, 6).map((c) => (
              <div key={c.category} className="flex items-center justify-between text-xs border-t pt-1" data-testid={`row-diversity-${c.category}`}>
                <span className="truncate max-w-[60%]">{c.category}</span>
                <span className={c.distinctFamilies < data.diversity.threshold && c.rowCount >= 5 ? "text-destructive font-medium" : ""}>
                  {c.distinctFamilies} fam · {c.rowCount} rows
                </span>
              </div>
            ))}
          </div>
        </MetricCard>

        <MetricCard
          title="Coverage"
          icon={Activity}
          breached={data.coverage.breached}
          description={`Fraction of categories with ≥ 5 active rows. Threshold: ≥ ${Math.round(data.coverage.threshold * 100)}%.`}
        >
          <div className="text-2xl font-bold" data-testid="text-coverage-ratio">{Math.round(data.coverage.coverageRatio * 100)}%</div>
          <div className="text-sm text-muted-foreground">
            {data.coverage.matureCategories} of {data.coverage.totalCategories} categories mature
          </div>
        </MetricCard>

        <MetricCard
          title="Contradiction Density"
          icon={ShieldAlert}
          breached={data.contradiction.breached}
          description={`Fraction of recent ensemble votes with κ<0.5. Threshold: ≤ ${Math.round(data.contradiction.threshold * 100)}%.`}
        >
          <div className="text-2xl font-bold" data-testid="text-contradiction-ratio">{Math.round(data.contradiction.contradictionRatio * 100)}%</div>
          <div className="text-sm text-muted-foreground">
            {data.contradiction.lowConcordanceCount} of {data.contradiction.sampleSize} recent ensemble runs (last 100)
          </div>
        </MetricCard>

        <MetricCard
          title="Freshness"
          icon={Clock}
          breached={data.freshness.breached}
          description={`Median age of recent active memory rows. Threshold: ≤ ${data.freshness.threshold} days.`}
        >
          <div className="text-2xl font-bold" data-testid="text-freshness-median">{data.freshness.medianAgeDays} days</div>
          <div className="text-sm text-muted-foreground">
            median age across last {data.freshness.sampleSize} active rows
          </div>
        </MetricCard>
      </div>

      <Card data-testid="card-recent-declines">
        <CardHeader>
          <CardTitle>Recent Decline Events</CardTitle>
          <CardDescription>
            Typed refusal stream (MNEMA Nugget 5). Feeds Nugget 2's restraint-precision counter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!declines || declines.events.length === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-no-declines">No declines recorded yet.</div>
          ) : (
            <div className="space-y-2">
              {declines.events.slice(0, 25).map((d) => (
                <div key={d.id} className="text-xs border-l-2 pl-2 py-1" data-testid={`row-decline-${d.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{d.source}</Badge>
                    <Badge variant="secondary">{d.reason}</Badge>
                    {d.tool_name && <Badge variant="outline">{d.tool_name}</Badge>}
                    <span className="text-muted-foreground ml-auto">{new Date(d.created_at).toLocaleString()}</span>
                  </div>
                  {d.detail && <div className="mt-1 text-muted-foreground line-clamp-2">{d.detail}</div>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
