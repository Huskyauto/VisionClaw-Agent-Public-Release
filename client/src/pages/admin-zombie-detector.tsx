import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skull, Loader2, Wrench, Users, Boxes, RefreshCw } from "lucide-react";

interface ZombieTool {
  name: string;
  description: string | null;
  category: string | null;
  lastUsed: string | null;
  daysSince: number | null;
  calls: number;
  isZombie: boolean;
}
interface ZombiePersona {
  id: number;
  name: string;
  role: string | null;
  lastUsed: string | null;
  daysSince: number | null;
  conversations: number;
  isZombie: boolean;
}
interface ZombieCapability {
  kind: string;
  name: string;
  description: string | null;
  category: string | null;
  lastSeen: string | null;
}
interface ZombieResponse {
  generatedAt: string;
  windowDays: number;
  summary: {
    totalTools: number; zombieTools: number;
    totalPersonas: number; zombiePersonas: number;
    totalCapabilities: number;
  };
  tools: ZombieTool[];
  personas: ZombiePersona[];
  capabilities: ZombieCapability[];
}

function formatDaysSince(d: number | null) {
  if (d === null) return "never";
  if (d === 0) return "today";
  if (d === 1) return "1 day ago";
  return `${d} days ago`;
}

export default function AdminZombieDetectorPage() {
  const [windowDays, setWindowDays] = useState(30);
  const { data, isLoading, error, refetch, isFetching } = useQuery<ZombieResponse>({
    queryKey: ["/api/admin/zombie-detector", windowDays],
    queryFn: async () => {
      const r = await fetch(`/api/admin/zombie-detector?windowDays=${windowDays}`, { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="zombie-loading">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6" data-testid="zombie-error">
        <p className="text-destructive">Failed to load zombie report. Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3" data-testid="text-page-title">
            <Skull className="w-8 h-8 text-muted-foreground" />
            Zombie Agent Detector
          </h1>
          <p className="text-muted-foreground mt-2">
            Tools, personas, and capabilities that ship but never get called. The unloved corners of the platform.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <Button
              key={d}
              variant={windowDays === d ? "default" : "outline"}
              size="sm"
              onClick={() => setWindowDays(d)}
              data-testid={`button-window-${d}`}
            >
              {d}d
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh">
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card data-testid="card-summary-tools">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Wrench className="w-4 h-4" /> Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-zombie-tools-count">
              {data.summary.zombieTools}
              <span className="text-muted-foreground text-lg font-normal"> / {data.summary.totalTools}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">zombie in last {data.windowDays}d</p>
          </CardContent>
        </Card>
        <Card data-testid="card-summary-personas">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4" /> Personas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-zombie-personas-count">
              {data.summary.zombiePersonas}
              <span className="text-muted-foreground text-lg font-normal"> / {data.summary.totalPersonas}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">zombie in last {data.windowDays}d</p>
          </CardContent>
        </Card>
        <Card data-testid="card-summary-capabilities">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Boxes className="w-4 h-4" /> Other Capabilities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold" data-testid="text-capabilities-count">{data.summary.totalCapabilities}</div>
            <p className="text-xs text-muted-foreground mt-1">webhooks, events, fulfillments, integrations</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wrench className="w-5 h-5" /> Tool Usage</CardTitle>
          <CardDescription>Tools registered in the capability registry vs invocations in <code>agent_trace_spans</code>.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">Last Used</th>
                  <th className="py-2 pr-4 text-right">Calls</th>
                </tr>
              </thead>
              <tbody>
                {data.tools.map((t) => (
                  <tr key={t.name} className="border-b border-border/50" data-testid={`row-tool-${t.name}`}>
                    <td className="py-2 pr-4 font-mono">
                      {t.isZombie && <Badge variant="outline" className="mr-2 text-muted-foreground">zombie</Badge>}
                      {t.name}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{t.category || "—"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{formatDaysSince(t.daysSince)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{t.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" /> Persona Usage</CardTitle>
          <CardDescription>Personas declared in the team vs conversations addressed to them.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Last Used</th>
                  <th className="py-2 pr-4 text-right">Conversations</th>
                </tr>
              </thead>
              <tbody>
                {data.personas.map((p) => (
                  <tr key={p.id} className="border-b border-border/50" data-testid={`row-persona-${p.name}`}>
                    <td className="py-2 pr-4 font-semibold">
                      {p.isZombie && <Badge variant="outline" className="mr-2 text-muted-foreground">zombie</Badge>}
                      {p.name}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{p.role || "—"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{formatDaysSince(p.daysSince)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{p.conversations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Boxes className="w-5 h-5" /> Other Capabilities</CardTitle>
          <CardDescription>Webhooks, events, fulfillments, integrations (no per-invocation tracking yet).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-4">Kind</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Description</th>
                </tr>
              </thead>
              <tbody>
                {data.capabilities.map((c) => (
                  <tr key={`${c.kind}-${c.name}`} className="border-b border-border/50" data-testid={`row-capability-${c.name}`}>
                    <td className="py-2 pr-4"><Badge variant="secondary">{c.kind}</Badge></td>
                    <td className="py-2 pr-4 font-mono">{c.name}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{c.description || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground mt-6 text-center" data-testid="text-generated-at">
        Generated {new Date(data.generatedAt).toLocaleString()} · 60s cache · Window {data.windowDays}d
      </p>
    </div>
  );
}
