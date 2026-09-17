import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Network } from "lucide-react";

interface Capability {
  id: number;
  kind: string;
  name: string;
  category: string | null;
  description: string;
  lastSeenAt: string | null;
}

interface PersonaEdge {
  id: number;
  name: string;
  role: string;
  emoji: string;
  blockedTools: string[];
}

interface CapabilityMapResponse {
  computedAt: string;
  capabilityCount: number;
  capabilities: Capability[];
  personas: PersonaEdge[];
}

const KIND_LABELS: Record<string, string> = {
  agent: "Agents",
  tool: "Tool Capabilities",
  fulfillment: "Fulfillment Paths",
  integration: "Integrations",
  webhook: "Webhooks",
  event: "Events",
  route: "Routes",
};

const KIND_ORDER = ["agent", "fulfillment", "tool", "integration", "webhook", "event", "route"];

const KIND_COLORS: Record<string, string> = {
  agent: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-300/40",
  tool: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-300/40",
  fulfillment: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-300/40",
  integration: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-300/40",
  webhook: "bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-300/40",
  event: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-300/40",
  route: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-300/40",
};

export default function CapabilityMapPage() {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<CapabilityMapResponse>({
    queryKey: ["/api/agent-insights/capability-map"],
    queryFn: async () => {
      const r = await fetch("/api/agent-insights/capability-map", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.capabilities.filter(c => {
      if (kindFilter && c.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        (c.category || "").toLowerCase().includes(q)
      );
    });
  }, [data, query, kindFilter]);

  const grouped = useMemo(() => {
    const byKind = new Map<string, Capability[]>();
    for (const c of filtered) {
      if (!byKind.has(c.kind)) byKind.set(c.kind, []);
      byKind.get(c.kind)!.push(c);
    }
    return KIND_ORDER.filter(k => byKind.has(k)).map(k => ({ kind: k, items: byKind.get(k)! }));
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-8 text-center text-muted-foreground" data-testid="text-capmap-error">
        Failed to load the capability map.
      </div>
    );
  }

  const kinds = Array.from(new Set(data.capabilities.map(c => c.kind)));

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto p-6 space-y-6 max-w-7xl">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2" data-testid="text-capmap-title">
            <Network className="w-7 h-7" /> Capability Map
          </h1>
          <p className="text-muted-foreground mt-1">
            The live operating map of the platform — {data.capabilityCount} active capabilities across{" "}
            {data.personas.length} agents. Start from what you want done; drill into who and what delivers it.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Search — e.g. "invoice", "video", "research", "outreach"…'
              className="pl-9"
              data-testid="input-capmap-search"
            />
          </div>
          <Button size="sm" variant={kindFilter === null ? "default" : "outline"} onClick={() => setKindFilter(null)}>
            All
          </Button>
          {KIND_ORDER.filter(k => kinds.includes(k)).map(k => (
            <Button key={k} size="sm" variant={kindFilter === k ? "default" : "outline"} onClick={() => setKindFilter(kindFilter === k ? null : k)}>
              {KIND_LABELS[k] || k}
            </Button>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Agents</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {data.personas.map(p => (
              <Badge key={p.id} variant="outline" className="py-1 px-2 gap-1" data-testid={`badge-capmap-persona-${p.id}`}>
                <span>{p.emoji}</span>
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground font-normal hidden sm:inline">· {p.role}</span>
              </Badge>
            ))}
          </CardContent>
        </Card>

        {grouped.length === 0 && (
          <div className="p-8 text-center text-muted-foreground">No capabilities match "{query}".</div>
        )}

        {grouped.map(group => (
          <div key={group.kind} className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              {KIND_LABELS[group.kind] || group.kind}
              <Badge variant="secondary">{group.items.length}</Badge>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {group.items.map(c => (
                <Card key={c.id} className="h-full">
                  <CardContent className="pt-4 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{c.name}</span>
                      <Badge variant="outline" className={`ml-auto shrink-0 text-[10px] ${KIND_COLORS[c.kind] || ""}`}>
                        {c.category || c.kind}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{c.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}

        <p className="text-xs text-muted-foreground">
          This map reads the live capability registry — the same source agents use for cross-agent routing — so it can
          never drift from what the platform actually does.
        </p>
      </div>
    </div>
  );
}
