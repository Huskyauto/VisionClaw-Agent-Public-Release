import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, ShieldCheck, Activity, FileCheck, ShieldAlert,
  Scale, Users, Wrench, Database, Layers, Gavel,
} from "lucide-react";

interface TrustCounts {
  agentRuns30d: number;
  deliverables30d: number;
  declineEvents30d: number;
  declineEventsTotal: number;
  governanceRules: number;
  activePersonas: number;
  registeredTools: number;
  liveTables: number;
  productionIndexes: number;
  safetyProfileCoverage: { total: number; configured: number; ratio: number };
  juryDecisionsLogged: number;
}

interface TrustResponse {
  generatedAt: string;
  counts: TrustCounts;
  invariants: Array<{ id: string; label: string; status: "active" | "degraded" | "off" }>;
}

function StatCard({
  icon: Icon, label, value, sub, testid,
}: { icon: any; label: string; value: string | number; sub?: string; testid: string }) {
  return (
    <Card data-testid={testid}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold" data-testid={`${testid}-value`}>{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1" data-testid={`${testid}-sub`}>{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function TrustPage() {
  const { data, isLoading, error } = useQuery<TrustResponse>({
    queryKey: ["/api/public/trust"],
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center py-16" data-testid="state-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="pt-6 text-destructive" data-testid="state-error">
            Failed to load trust dashboard.
          </CardContent>
        </Card>
      </div>
    );
  }

  const c = data.counts;
  const coveragePct = Math.round(c.safetyProfileCoverage.ratio * 100);

  return (
    <div className="container mx-auto p-6 space-y-8" data-testid="page-trust">
      <div>
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-emerald-500" />
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
            Trust & Transparency
          </h1>
        </div>
        <p className="text-muted-foreground mt-2 max-w-3xl" data-testid="text-page-description">
          What VisionClaw is doing right now, what safety layers are active, and what's been refused.
          All numbers are live from the platform — nothing here is marketing copy.
        </p>
      </div>

      <section data-testid="section-activity">
        <h2 className="text-lg font-semibold mb-3">Activity (last 30 days)</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Activity}
            label="Agent runs completed"
            value={c.agentRuns30d.toLocaleString()}
            sub="successful job executions"
            testid="stat-agent-runs"
          />
          <StatCard
            icon={FileCheck}
            label="Deliverables produced"
            value={c.deliverables30d.toLocaleString()}
            sub="files generated for users"
            testid="stat-deliverables"
          />
          <StatCard
            icon={ShieldAlert}
            label="Requests refused"
            value={c.declineEvents30d.toLocaleString()}
            sub={`${c.declineEventsTotal.toLocaleString()} all-time`}
            testid="stat-declines"
          />
          <StatCard
            icon={Gavel}
            label="Jury decisions logged"
            value={c.juryDecisionsLogged.toLocaleString()}
            sub="3-frontier-model votes on borderline calls"
            testid="stat-jury"
          />
        </div>
      </section>

      <section data-testid="section-platform">
        <h2 className="text-lg font-semibold mb-3">Platform scale</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            icon={Users}
            label="Active personas"
            value={c.activePersonas}
            sub="specialized AI agents"
            testid="stat-personas"
          />
          <StatCard
            icon={Wrench}
            label="Tools exercised"
            value={c.registeredTools}
            sub="distinct tools used in production"
            testid="stat-tools"
          />
          <StatCard
            icon={Scale}
            label="Governance rules"
            value={c.governanceRules}
            sub="enforced platform policies"
            testid="stat-rules"
          />
          <StatCard
            icon={Database}
            label="Database tables"
            value={c.liveTables}
            sub="per-tenant isolation"
            testid="stat-tables"
          />
          <StatCard
            icon={Layers}
            label="Production indexes"
            value={c.productionIndexes}
            sub="query-path coverage"
            testid="stat-indexes"
          />
          <StatCard
            icon={ShieldCheck}
            label="AHB safety coverage"
            value={`${coveragePct}%`}
            sub={`${c.safetyProfileCoverage.configured}/${c.safetyProfileCoverage.total} personas with intent gate`}
            testid="stat-ahb-coverage"
          />
        </div>
      </section>

      <section data-testid="section-invariants">
        <h2 className="text-lg font-semibold mb-3">Always-on safety invariants</h2>
        <Card>
          <CardHeader>
            <CardDescription>
              Every request flows through these layers. None are optional, none are user-tunable.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.invariants.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-start gap-3 py-2 border-b last:border-0"
                  data-testid={`invariant-${inv.id}`}
                >
                  <Badge
                    variant={inv.status === "active" ? "default" : inv.status === "degraded" ? "secondary" : "destructive"}
                    className="mt-0.5"
                    data-testid={`badge-invariant-status-${inv.id}`}
                  >
                    {inv.status}
                  </Badge>
                  <span className="text-sm flex-1" data-testid={`text-invariant-label-${inv.id}`}>
                    {inv.label}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <p className="text-xs text-muted-foreground text-center pt-4" data-testid="text-generated-at">
        Live data as of {new Date(data.generatedAt).toLocaleString()}. Refreshes every 60 seconds.
      </p>
    </div>
  );
}
