import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Network, Users, AlertTriangle, ScrollText, Zap, Filter, X, RefreshCw } from "lucide-react";

type GraphNode = {
  id: string;
  kind: "persona" | "tension" | "adr" | "proposal";
  label: string;
  status?: string;
  role?: string;
  emoji?: string;
  isActive?: boolean;
  sourceKind?: string;
  surpriseBand?: string;
  tags?: string[] | null;
  createdAt?: string;
};

type GraphEdge = { from: string; to: string; kind: string };

type GraphPayload = {
  tenantId: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  generatedAt: string;
};

const KIND_COLOR: Record<string, string> = {
  persona: "#3b82f6",
  tension: "#ef4444",
  adr: "#a855f7",
  proposal: "#10b981",
};

const KIND_ICON = {
  persona: Users,
  tension: AlertTriangle,
  adr: ScrollText,
  proposal: Zap,
};

const STATUS_TINT: Record<string, string> = {
  open: "#ef4444",
  investigating: "#f59e0b",
  resolved: "#10b981",
  superseded: "#94a3b8",
  wontfix: "#6b7280",
  proposed: "#06b6d4",
  accepted: "#10b981",
  deprecated: "#94a3b8",
};

const SURPRISE_TINT: Record<string, string> = {
  green: "#10b981",
  yellow: "#f59e0b",
  red: "#ef4444",
  error: "#dc2626",
  no_history: "#94a3b8",
};

export default function GraphExplorerPage() {
  const [filters, setFilters] = useState({
    persona: true,
    tension: true,
    adr: true,
    proposal: true,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<GraphPayload>({
    queryKey: ["/api/graph-explorer"],
  });

  const filteredNodes = useMemo(
    () => (data?.nodes || []).filter((n) => filters[n.kind]),
    [data, filters],
  );
  const filteredEdges = useMemo(() => {
    const ids = new Set(filteredNodes.map((n) => n.id));
    return (data?.edges || []).filter((e) => ids.has(e.from) && ids.has(e.to));
  }, [data, filteredNodes]);

  // Concentric-ring layout: each kind gets its own ring around the center.
  // Angles are deterministic so the picture is stable across renders.
  const layout = useMemo(() => {
    const W = 1100;
    const H = 720;
    const cx = W / 2;
    const cy = H / 2;
    const RING_RADIUS: Record<string, number> = {
      persona: 130,
      adr: 240,
      tension: 320,
      proposal: 280,
    };
    const positions = new Map<string, { x: number; y: number }>();
    const byKind: Record<string, GraphNode[]> = { persona: [], tension: [], adr: [], proposal: [] };
    for (const n of filteredNodes) byKind[n.kind].push(n);
    (["persona", "adr", "tension", "proposal"] as const).forEach((kind) => {
      const list = byKind[kind];
      const r = RING_RADIUS[kind];
      const phaseShift = kind === "persona" ? -Math.PI / 2 : kind === "adr" ? 0 : kind === "tension" ? Math.PI / 4 : Math.PI;
      list.forEach((n, i) => {
        const angle = phaseShift + (2 * Math.PI * i) / Math.max(1, list.length);
        positions.set(n.id, {
          x: cx + r * Math.cos(angle),
          y: cy + r * Math.sin(angle),
        });
      });
    });
    return { W, H, cx, cy, positions };
  }, [filteredNodes]);

  const selectedNode = useMemo(
    () => (selectedId ? filteredNodes.find((n) => n.id === selectedId) : null),
    [selectedId, filteredNodes],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { persona: 0, tension: 0, adr: 0, proposal: 0 };
    for (const n of data?.nodes || []) c[n.kind]++;
    return c;
  }, [data]);

  return (
    <div className="container mx-auto py-6 space-y-4" data-testid="page-graph-explorer">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Network className="h-7 w-7 text-primary" />
            Graph Explorer
          </h1>
          <p className="text-muted-foreground mt-1 max-w-3xl">
            Personas, architecture decisions, open tensions, and recent Felix proposals as one connected picture.
            Click any node to see its details. Edges show ownership, supersession, and the surprise → tension chain.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh-graph">
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="h-4 w-4" /> Show:
          </div>
          {(Object.keys(filters) as (keyof typeof filters)[]).map((kind) => {
            const Icon = KIND_ICON[kind];
            const active = filters[kind];
            return (
              <button
                key={kind}
                onClick={() => setFilters({ ...filters, [kind]: !active })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors ${
                  active ? "bg-primary/10 border-primary/40 text-primary" : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                }`}
                data-testid={`filter-${kind}`}
              >
                <Icon className="h-3.5 w-3.5" style={active ? { color: KIND_COLOR[kind] } : undefined} />
                <span className="capitalize">{kind}s</span>
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">{counts[kind] ?? 0}</Badge>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <Card className="p-2 overflow-hidden">
          {isLoading ? (
            <Skeleton className="w-full h-[720px]" />
          ) : (
            <svg
              viewBox={`0 0 ${layout.W} ${layout.H}`}
              className="w-full h-auto bg-card rounded-md"
              style={{ maxHeight: "720px" }}
              data-testid="svg-graph-canvas"
            >
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity="0.5" />
                </marker>
              </defs>

              {/* Edges first so nodes render on top */}
              {filteredEdges.map((e, i) => {
                const a = layout.positions.get(e.from);
                const b = layout.positions.get(e.to);
                if (!a || !b) return null;
                const stroke = e.kind === "supersedes" ? "#a855f7" : e.kind === "owns" ? "#3b82f6" : e.kind === "authored" ? "#8b5cf6" : "#94a3b8";
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={stroke}
                    strokeWidth={1.2}
                    opacity={0.45}
                    markerEnd="url(#arrow)"
                  />
                );
              })}

              {/* Center label */}
              <g>
                <circle cx={layout.cx} cy={layout.cy} r={48} fill="hsl(var(--background))" stroke="hsl(var(--primary))" strokeWidth={1.5} strokeDasharray="3 3" />
                <text x={layout.cx} y={layout.cy - 4} textAnchor="middle" fontSize="13" fontWeight="600" fill="hsl(var(--foreground))">
                  Tenant
                </text>
                <text x={layout.cx} y={layout.cy + 12} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">
                  #{data?.tenantId ?? "—"}
                </text>
              </g>

              {filteredNodes.map((n) => {
                const pos = layout.positions.get(n.id);
                if (!pos) return null;
                const tint =
                  n.kind === "tension"
                    ? STATUS_TINT[n.status || "open"] ?? KIND_COLOR.tension
                    : n.kind === "adr"
                      ? STATUS_TINT[n.status || "accepted"] ?? KIND_COLOR.adr
                      : n.kind === "proposal"
                        ? SURPRISE_TINT[n.surpriseBand || "no_history"] ?? KIND_COLOR.proposal
                        : KIND_COLOR.persona;
                const radius = n.kind === "persona" ? 22 : n.kind === "adr" ? 14 : 12;
                const isSelected = selectedId === n.id;
                return (
                  <g
                    key={n.id}
                    onClick={() => setSelectedId(n.id)}
                    style={{ cursor: "pointer" }}
                    data-testid={`node-${n.kind}-${n.id}`}
                  >
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={radius + (isSelected ? 4 : 0)}
                      fill={tint}
                      opacity={isSelected ? 0.95 : 0.78}
                      stroke={isSelected ? "hsl(var(--foreground))" : "rgba(255,255,255,0.4)"}
                      strokeWidth={isSelected ? 2.5 : 1}
                    />
                    {n.kind === "persona" && n.emoji && (
                      <text x={pos.x} y={pos.y + 6} textAnchor="middle" fontSize="18">
                        {n.emoji}
                      </text>
                    )}
                    <text
                      x={pos.x}
                      y={pos.y + radius + 14}
                      textAnchor="middle"
                      fontSize="10"
                      fill="hsl(var(--foreground))"
                      style={{ pointerEvents: "none" }}
                    >
                      {n.label.length > 28 ? n.label.slice(0, 26) + "…" : n.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </Card>

        <Card className="p-4 max-h-[720px] overflow-hidden flex flex-col" data-testid="panel-node-details">
          {selectedNode ? (
            <>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge style={{ background: KIND_COLOR[selectedNode.kind], color: "white" }}>
                    {selectedNode.kind}
                  </Badge>
                  {selectedNode.status && (
                    <Badge variant="outline" data-testid={`badge-status-${selectedNode.id}`}>{selectedNode.status}</Badge>
                  )}
                  {selectedNode.surpriseBand && (
                    <Badge variant="outline" style={{ borderColor: SURPRISE_TINT[selectedNode.surpriseBand], color: SURPRISE_TINT[selectedNode.surpriseBand] }}>
                      {selectedNode.surpriseBand}
                    </Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)} data-testid="button-close-details">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <h3 className="text-lg font-semibold mb-2" data-testid="text-node-title">
                {selectedNode.kind === "persona" && selectedNode.emoji ? `${selectedNode.emoji} ` : ""}
                {selectedNode.label}
              </h3>
              <ScrollArea className="flex-1 pr-2">
                <dl className="text-sm space-y-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">ID</dt>
                    <dd className="font-mono">{selectedNode.id}</dd>
                  </div>
                  {selectedNode.role && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Role</dt>
                      <dd>{selectedNode.role}</dd>
                    </div>
                  )}
                  {selectedNode.sourceKind && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Source</dt>
                      <dd>{selectedNode.sourceKind}</dd>
                    </div>
                  )}
                  {selectedNode.tags && selectedNode.tags.length > 0 && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Tags</dt>
                      <dd className="flex flex-wrap gap-1 mt-1">
                        {selectedNode.tags.map((t) => (
                          <Badge key={t} variant="secondary">{t}</Badge>
                        ))}
                      </dd>
                    </div>
                  )}
                  {selectedNode.createdAt && (
                    <div>
                      <dt className="text-xs text-muted-foreground">Created</dt>
                      <dd>{new Date(selectedNode.createdAt).toLocaleString()}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground mt-3">Connections</dt>
                    <dd className="space-y-1 mt-1">
                      {filteredEdges
                        .filter((e) => e.from === selectedNode.id || e.to === selectedNode.id)
                        .slice(0, 30)
                        .map((e, i) => {
                          const otherId = e.from === selectedNode.id ? e.to : e.from;
                          const direction = e.from === selectedNode.id ? "→" : "←";
                          const other = filteredNodes.find((n) => n.id === otherId);
                          return (
                            <button
                              key={i}
                              onClick={() => other && setSelectedId(other.id)}
                              className="block w-full text-left text-xs px-2 py-1 rounded hover:bg-muted transition-colors"
                              data-testid={`link-edge-${i}`}
                            >
                              <span className="text-muted-foreground">{e.kind}</span> {direction}{" "}
                              <span className="font-medium">{other?.label ?? otherId}</span>
                            </button>
                          );
                        })}
                      {filteredEdges.filter((e) => e.from === selectedNode.id || e.to === selectedNode.id).length === 0 && (
                        <span className="text-xs text-muted-foreground italic">No connections in current filter</span>
                      )}
                    </dd>
                  </div>
                  {selectedNode.kind === "tension" && (
                    <div className="pt-2 mt-2 border-t">
                      <a
                        href={`/agent-board?proposal=${selectedNode.id.replace("tension:", "")}`}
                        className="text-xs text-primary hover:underline"
                        data-testid="link-jump-source"
                      >
                        Open this tension in the API →
                      </a>
                    </div>
                  )}
                </dl>
              </ScrollArea>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-12">
              <Network className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">Click any node on the graph to see details and its connections.</p>
              <p className="text-xs mt-2">Personas in the inner ring, ADRs and tensions branch outward.</p>
            </div>
          )}
        </Card>
      </div>

      {data && (
        <p className="text-xs text-muted-foreground text-right" data-testid="text-graph-meta">
          Tenant {data.tenantId} • {data.nodes.length} nodes, {data.edges.length} edges • generated {new Date(data.generatedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
