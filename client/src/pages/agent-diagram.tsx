import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  Brain,
  Cpu,
  Hammer,
  LineChart,
  Megaphone,
  Radar,
  ScrollText,
  Sparkles,
  Telescope,
  Crown,
  Pause,
  Play,
  CheckCircle2,
  Scale,
  DollarSign,
  TrendingUp,
} from "lucide-react";

type LiveAgent = {
  personaId: number;
  personaName: string;
  emoji: string;
  catchphrase: string;
  status: "active" | "complete" | "failed" | "idle" | "blocked" | string;
  activityType: string;
  summary: string;
  conversationId?: number;
  elapsedMs: number;
};

type ActivityRow = {
  id: number;
  personaName: string | null;
  status: string;
  activityType: string;
  summary: string | null;
  metadata: any;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
};

// Canonical persona roster — kept in sync with server/ceo-orchestrator.ts.
// NOTE: 11 worker personas shown here (Felix is rendered separately as the hub).
// VisionClaw (general catch-all) and Agent Blueprint (system architect) are
// system-level entities and intentionally not rendered as department nodes.
const PERSONAS: Array<{
  name: string;
  role: string;
  icon: any;
  accent: string;
}> = [
  { name: "Forge", role: "Engineering", icon: Hammer, accent: "#f97316" },
  { name: "Teagan", role: "Marketing", icon: TrendingUp, accent: "#ec4899" },
  { name: "Scribe", role: "Content", icon: ScrollText, accent: "#a855f7" },
  { name: "Proof", role: "Quality Review", icon: CheckCircle2, accent: "#14b8a6" },
  { name: "Radar", role: "Research", icon: Radar, accent: "#06b6d4" },
  { name: "Neptune", role: "Deep Research / Media", icon: Telescope, accent: "#3b82f6" },
  { name: "Apollo", role: "Sales", icon: Megaphone, accent: "#eab308" },
  { name: "Atlas", role: "Analytics", icon: LineChart, accent: "#10b981" },
  { name: "Cassandra", role: "Finance", icon: DollarSign, accent: "#84cc16" },
  { name: "Luna", role: "Legal", icon: Scale, accent: "#8b5cf6" },
  { name: "Chief of Staff", role: "Ops", icon: Cpu, accent: "#64748b" },
];

const STATUS_COLOR: Record<string, string> = {
  active: "#3b82f6",
  complete: "#10b981",
  failed: "#ef4444",
  blocked: "#f59e0b",
  idle: "#94a3b8",
};

// ─── Topology Picker ─────────────────────────────────────────────────────────
// Educational reference for the 7 named orchestration patterns Felix can run.
// The live graph below this section uses STAR by default (hub-and-spoke).
type TopologyKey = "mesh" | "pipeline" | "star" | "swarm" | "broadcast" | "hierarchical" | "hybrid";

const TOPOLOGIES: Array<{
  key: TopologyKey;
  name: string;
  tagline: string;
  bestFor: string;
  description: string;
}> = [
  { key: "star",         name: "Star",         tagline: "Central hub delegates to all workers",   bestFor: "Most business workflows • Today's default",  description: "Felix sits in the middle and fans work out to specialists. Simple to debug, easy to scale, no worker-to-worker chatter." },
  { key: "pipeline",     name: "Pipeline",     tagline: "One route: A → B → C → D",                bestFor: "Sequential pipelines (research → write → review → ship)", description: "Each stage hands its output to the next. Predictable, ideal for content production and code review chains." },
  { key: "mesh",         name: "Mesh",         tagline: "Every agent can ask any other for help", bestFor: "Collaborative problem-solving with shared context",      description: "Full peer-to-peer connectivity. No bottleneck, full redundancy — but harder to reason about cost and order." },
  { key: "swarm",        name: "P2P Swarm",    tagline: "Agents bid on tasks — best fit wins",    bestFor: "Open-ended tasks where capability isn't pre-known",      description: "Tasks are auctioned. Each persona scores its own fit and the highest-confidence (or cheapest) agent takes it." },
  { key: "broadcast",    name: "Broadcast",    tagline: "One sender → all listeners get the same task", bestFor: "Parallel exploration — many drafts, one winner",   description: "Same task to N personas simultaneously. Use for ideation rounds, A/B drafts, or cross-checking." },
  { key: "hierarchical", name: "Hierarchical", tagline: "CEO → Lead → Workers (manager layers)",   bestFor: "Large multi-team initiatives with sub-leads",            description: "Felix delegates to leads (e.g. Chief of Staff, Atlas), who in turn delegate to their own workers. Mirrors a real org chart." },
  { key: "hybrid",       name: "Hybrid",       tagline: "Mix Star + Mesh + Pipeline in one run",   bestFor: "Real production work — most jobs combine 2–3 patterns",  description: "Star for delegation, pipeline inside each lane, mesh for cross-checks. The actual shape Felix uses on long jobs." },
];

function MiniTopology({ kind }: { kind: TopologyKey }) {
  const stroke = "currentColor";
  const accent = "#3b82f6";
  const dot = (cx: number, cy: number, r = 4, fill = stroke, op = 0.7) => (
    <circle cx={cx} cy={cy} r={r} fill={fill} opacity={op} />
  );
  const line = (x1: number, y1: number, x2: number, y2: number, op = 0.35) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={1} opacity={op} />
  );
  const W = 100, H = 60;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14 text-foreground" aria-hidden>
      {kind === "star" && (
        <>
          {[15, 40, 65, 85].map((x, i) => line(50, 30, x, i % 2 ? 10 : 50))}
          {[15, 40, 65, 85].map((x, i) => dot(x, i % 2 ? 10 : 50))}
          {dot(50, 30, 6, accent, 1)}
        </>
      )}
      {kind === "pipeline" && (
        <>
          {[15, 38, 62, 85].slice(0, -1).map((x, i) => line(x + 4, 30, [15, 38, 62, 85][i + 1] - 4, 30, 0.6))}
          {[15, 38, 62, 85].map((x, i) => dot(x, 30, 5, i === 0 ? accent : stroke, i === 0 ? 1 : 0.7))}
        </>
      )}
      {kind === "mesh" && (
        <>
          {[[20,15],[80,15],[20,45],[80,45],[50,30]].flatMap((a, i, arr) =>
            arr.slice(i + 1).map((b, j) => line(a[0], a[1], b[0], b[1], 0.25))
          )}
          {[[20,15],[80,15],[20,45],[80,45],[50,30]].map(([x,y], i) => dot(x, y, 4))}
        </>
      )}
      {kind === "swarm" && (
        <>
          {[20, 40, 60, 80].map((x) => line(x, 50, 50, 12, 0.3))}
          {[20, 40, 60, 80].map((x, i) => dot(x, 50, 4, i === 2 ? accent : stroke, i === 2 ? 1 : 0.7))}
          <text x={50} y={10} textAnchor="middle" fontSize={7} fill={stroke} opacity={0.7}>TASK</text>
        </>
      )}
      {kind === "broadcast" && (
        <>
          {[15, 40, 60, 85].map((x) => line(50, 12, x, 48, 0.4))}
          {dot(50, 12, 5, accent, 1)}
          {[15, 40, 60, 85].map((x) => dot(x, 48, 4))}
        </>
      )}
      {kind === "hierarchical" && (
        <>
          {[[50,10,30,30],[50,10,70,30],[30,30,18,50],[30,30,42,50],[70,30,58,50],[70,30,82,50]].map(([a,b,c,d], i) => (
            <line key={i} x1={a} y1={b} x2={c} y2={d} stroke={stroke} strokeWidth={1} opacity={0.35} />
          ))}
          {dot(50, 10, 5, accent, 1)}
          {[[30,30],[70,30]].map(([x,y], i) => <circle key={`m${i}`} cx={x} cy={y} r={4} fill={stroke} opacity={0.7} />)}
          {[[18,50],[42,50],[58,50],[82,50]].map(([x,y], i) => <circle key={`w${i}`} cx={x} cy={y} r={3} fill={stroke} opacity={0.7} />)}
        </>
      )}
      {kind === "hybrid" && (
        <>
          {[[50,30,22,14,0.4],[50,30,78,14,0.4],[50,30,50,50,0.4],[22,14,78,14,0.25],[50,50,22,14,0.2],[50,50,78,14,0.2]].map(([a,b,c,d,o], i) => (
            <line key={i} x1={a} y1={b} x2={c} y2={d} stroke={stroke} strokeWidth={1} opacity={o as number} />
          ))}
          {dot(50, 30, 5, accent, 1)}
          {[[22,14],[78,14],[50,50]].map(([x,y], i) => <circle key={i} cx={x} cy={y} r={4} fill={stroke} opacity={0.7} />)}
        </>
      )}
    </svg>
  );
}

function TopologyPickerSection() {
  const [selected, setSelected] = useState<TopologyKey>("star");
  const sel = TOPOLOGIES.find((t) => t.key === selected)!;
  return (
    <Card data-testid="card-topology-picker">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> 7 Ways Felix Can Orchestrate
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Click a pattern to see how the agents connect. The live graph below is currently running <strong>Star</strong>.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {TOPOLOGIES.map((t) => {
            const isSel = t.key === selected;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSelected(t.key)}
                className={`rounded-lg border p-2 text-left transition-colors hover-elevate active-elevate-2 ${
                  isSel ? "border-primary bg-primary/5" : "border-border"
                }`}
                data-testid={`button-topology-${t.key}`}
                aria-pressed={isSel}
              >
                <MiniTopology kind={t.key} />
                <div className="text-xs font-semibold mt-1">{t.name}</div>
              </button>
            );
          })}
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-3" data-testid={`text-topology-detail-${sel.key}`}>
          <div className="flex items-baseline gap-2 flex-wrap">
            <div className="text-sm font-semibold">{sel.name}</div>
            <div className="text-xs text-muted-foreground">— {sel.tagline}</div>
          </div>
          <p className="text-sm mt-1.5">{sel.description}</p>
          <p className="text-xs text-muted-foreground mt-1.5">
            <strong className="text-foreground">Best for:</strong> {sel.bestFor}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return "now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  return formatElapsed(ms) + " ago";
}

export default function AgentDiagramPage() {
  const [paused, setPaused] = useState(false);
  const refetchInterval = paused ? false : 2000;

  const { data: live = [] } = useQuery<LiveAgent[]>({
    queryKey: ["/api/agent-activity/live"],
    refetchInterval,
  });

  // Recent feed updates less frequently — historical view doesn't need 2s cadence
  const { data: recent = [] } = useQuery<ActivityRow[]>({
    queryKey: ["/api/agent-activity"],
    refetchInterval: paused ? false : 10000,
  });

  // Map liveAgents by personaName (lower-cased) for quick lookup
  const liveByName = useMemo(() => {
    const m = new Map<string, LiveAgent>();
    for (const a of live) m.set(a.personaName.toLowerCase(), a);
    return m;
  }, [live]);

  // Felix is the orchestrator — also pulled from live map if active
  const felix = liveByName.get("felix");
  const activeCount = live.filter((a) => a.status === "active").length;

  // Hub-and-spoke layout
  const SIZE = 640;
  const C = SIZE / 2;
  const RING = 240;
  const NODE_R = 42;
  const HUB_R = 60;

  const nodes = PERSONAS.map((p, i) => {
    const angle = (i / PERSONAS.length) * Math.PI * 2 - Math.PI / 2;
    const x = C + Math.cos(angle) * RING;
    const y = C + Math.sin(angle) * RING;
    const live = liveByName.get(p.name.toLowerCase());
    const status = live?.status ?? "idle";
    return { ...p, angle, x, y, live, status };
  });

  // Bubble layout — placed radially outward from each active worker node
  const BUBBLE_OUTWARD = 90; // viewBox units beyond node center
  const activeBubbleNodes = nodes.filter((n) => n.status === "active" && n.live);
  const felixActive = felix?.status === "active";

  return (
    <div className="h-full overflow-y-auto container mx-auto p-6 space-y-4" data-testid="page-agent-diagram">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-7 w-7 text-primary" />
            Live Agent Diagram
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time view of Felix's agent team — orchestrator, workers, and what each is doing right now.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className="text-sm"
            data-testid="badge-active-count"
          >
            <Activity className="h-3 w-3 mr-1" />
            {activeCount} active
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaused((p) => !p)}
            data-testid="button-toggle-polling"
          >
            {paused ? <Play className="h-4 w-4 mr-1" /> : <Pause className="h-4 w-4 mr-1" />}
            {paused ? "Resume" : "Pause"}
          </Button>
        </div>
      </div>

      <TopologyPickerSection />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Diagram */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Orchestrator graph
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center" data-testid="diagram-container">
              <div className="relative w-full max-w-[560px]" style={{ aspectRatio: "1 / 1" }}>
              <svg
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                className="absolute inset-0 w-full h-full"
                style={{ overflow: "visible" }}
                role="img"
                aria-label="Agent orchestrator diagram"
              >
                <defs>
                  <radialGradient id="hubGlow">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id="activeGlow">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                  </radialGradient>
                </defs>

                {/* Edges Felix → each worker */}
                {nodes.map((n) => {
                  const isActive = n.status === "active";
                  return (
                    <line
                      key={`edge-${n.name}`}
                      x1={C}
                      y1={C}
                      x2={n.x}
                      y2={n.y}
                      stroke={isActive ? "#3b82f6" : "currentColor"}
                      strokeOpacity={isActive ? 0.85 : 0.18}
                      strokeWidth={isActive ? 2.5 : 1}
                      strokeDasharray={isActive ? "6 6" : undefined}
                      className={isActive ? "animate-pulse" : ""}
                    />
                  );
                })}

                {/* Hub glow */}
                <circle cx={C} cy={C} r={120} fill="url(#hubGlow)" />

                {/* Felix hub */}
                <g data-testid="node-felix">
                  <circle
                    cx={C}
                    cy={C}
                    r={HUB_R}
                    fill="hsl(var(--card))"
                    stroke="#6366f1"
                    strokeWidth={3}
                  />
                  <foreignObject
                    x={C - HUB_R}
                    y={C - HUB_R}
                    width={HUB_R * 2}
                    height={HUB_R * 2}
                  >
                    <div className="w-full h-full flex flex-col items-center justify-center text-center">
                      <Crown className="h-7 w-7 text-indigo-500" />
                      <div className="text-sm font-bold mt-0.5">Felix</div>
                      <div className="text-[10px] text-muted-foreground leading-tight">
                        CEO
                      </div>
                    </div>
                  </foreignObject>
                </g>

                {/* Worker nodes */}
                {nodes.map((n) => {
                  const Icon = n.icon;
                  const color = STATUS_COLOR[n.status] ?? STATUS_COLOR.idle;
                  const isActive = n.status === "active";
                  return (
                    <g key={n.name} data-testid={`node-${n.name.toLowerCase().replace(/\s+/g, "-")}`}>
                      {isActive && (
                        <circle cx={n.x} cy={n.y} r={NODE_R + 18} fill="url(#activeGlow)" />
                      )}
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={NODE_R}
                        fill="hsl(var(--card))"
                        stroke={color}
                        strokeWidth={isActive ? 3 : 2}
                        className={isActive ? "animate-pulse" : ""}
                      />
                      <foreignObject
                        x={n.x - NODE_R}
                        y={n.y - NODE_R}
                        width={NODE_R * 2}
                        height={NODE_R * 2}
                      >
                        <div className="w-full h-full flex flex-col items-center justify-center text-center px-1">
                          <Icon className="h-5 w-5" style={{ color: n.accent }} />
                          <div className="text-[11px] font-semibold mt-0.5 leading-tight">
                            {n.name}
                          </div>
                          <div className="text-[9px] text-muted-foreground leading-tight">
                            {n.role}
                          </div>
                        </div>
                      </foreignObject>
                      {/* Status dot */}
                      <circle
                        cx={n.x + NODE_R - 8}
                        cy={n.y - NODE_R + 8}
                        r={6}
                        fill={color}
                        stroke="hsl(var(--background))"
                        strokeWidth={2}
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Thought bubbles overlay — absolutely positioned over the SVG so they
                  can extend beyond the viewBox without clipping. Each bubble shows what
                  that agent is currently working on. */}
              <AnimatePresence>
                {felixActive && felix && (
                  <motion.div
                    key="bubble-felix"
                    initial={{ opacity: 0, scale: 0.85, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: 0.25 }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-indigo-500 bg-card shadow-xl p-2 pointer-events-none z-10"
                    style={{
                      left: `${(C / SIZE) * 100}%`,
                      top: `${((C - HUB_R - 60) / SIZE) * 100}%`,
                      width: "clamp(130px, 32%, 190px)",
                    }}
                    data-testid="bubble-felix"
                  >
                    <div className="text-[10px] font-semibold text-indigo-500 flex items-center gap-1">
                      <Crown className="h-3 w-3" /> Felix is orchestrating…
                    </div>
                    <div className="text-[11px] text-foreground line-clamp-3 mt-0.5">
                      {felix.summary || felix.activityType}
                    </div>
                    {/* Tail pointing down to hub */}
                    <div
                      className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-3 h-3 rotate-45 border-r-2 border-b-2 border-indigo-500 bg-card"
                    />
                  </motion.div>
                )}

                {activeBubbleNodes.map((n) => {
                  const dx = Math.cos(n.angle);
                  const dy = Math.sin(n.angle);
                  const bx = n.x + dx * BUBBLE_OUTWARD;
                  const by = n.y + dy * BUBBLE_OUTWARD;
                  // Center-anchored placement (-translate-x/y-1/2). Clamp so the
                  // bubble's CENTER stays within an inset that accounts for half
                  // the bubble's max footprint (~80px wide, ~50px tall on a
                  // 640-logical container ≈ 12.5% / 8%). Guarantees no overflow
                  // for any of the 11 worker positions.
                  const leftPct = Math.max(13, Math.min(87, (bx / SIZE) * 100));
                  const topPct = Math.max(10, Math.min(90, (by / SIZE) * 100));
                  return (
                    <motion.div
                      key={`bubble-${n.name}`}
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{ duration: 0.25 }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 bg-card shadow-xl p-2 pointer-events-none z-10"
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        borderColor: n.accent,
                        width: "clamp(110px, 27%, 160px)",
                      }}
                      data-testid={`bubble-${n.name.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <div
                        className="text-[10px] font-semibold flex items-center gap-1"
                        style={{ color: n.accent }}
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: n.accent }} />
                        {n.name} thinking…
                      </div>
                      <div className="text-[11px] text-foreground line-clamp-3 mt-0.5">
                        {n.live!.summary || n.live!.activityType}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 justify-center mt-2 text-xs">
              {Object.entries(STATUS_COLOR).map(([s, c]) => (
                <div key={s} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: c }}
                  />
                  <span className="capitalize text-muted-foreground">{s}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Right side: live agents + recent feed */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Active right now</CardTitle>
            </CardHeader>
            <CardContent>
              {live.length === 0 ? (
                <div
                  className="text-sm text-muted-foreground text-center py-6"
                  data-testid="text-no-active"
                >
                  No agents are currently active. The diagram will light up as soon as Felix dispatches work.
                </div>
              ) : (
                <ul className="space-y-2">
                  {live.map((a) => (
                    <li
                      key={a.personaId}
                      className="flex items-start gap-2 text-sm border rounded-md p-2 bg-muted/30"
                      data-testid={`live-row-${a.personaName.toLowerCase()}`}
                    >
                      <div className="text-xl leading-none">{a.emoji || "🤖"}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold truncate">{a.personaName}</span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatElapsed(a.elapsedMs)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-2">
                          {a.summary || a.activityType}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent activity</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[320px]">
                <ul className="divide-y" data-testid="list-recent-activity">
                  {recent.length === 0 ? (
                    <li className="text-sm text-muted-foreground text-center py-6 px-3">
                      No activity yet.
                    </li>
                  ) : (
                    recent.slice(0, 30).map((r) => {
                      const color = STATUS_COLOR[r.status] ?? STATUS_COLOR.idle;
                      return (
                        <li key={r.id} className="px-3 py-2 text-xs" data-testid={`activity-row-${r.id}`}>
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <span className="font-semibold">{r.personaName || "VisionClaw"}</span>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-muted-foreground">{r.activityType}</span>
                            <span className="ml-auto text-muted-foreground whitespace-nowrap">
                              {formatTimeAgo(r.createdAt)}
                            </span>
                          </div>
                          {r.summary && (
                            <div className="text-muted-foreground mt-0.5 line-clamp-2 pl-4">
                              {r.summary}
                            </div>
                          )}
                        </li>
                      );
                    })
                  )}
                </ul>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
