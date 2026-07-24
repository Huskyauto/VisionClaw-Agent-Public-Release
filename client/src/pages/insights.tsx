import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Brain, TrendingUp, Settings2, Loader2, Lightbulb, Target,
  BarChart3, Zap, CheckCircle2, XCircle, Clock, ArrowRight,
  Play, RefreshCw, ChevronDown, ChevronUp, Sparkles,
  Activity, DollarSign, MessageSquare, Wrench,
} from "lucide-react";

// R88 — Per-tenant usage analytics tab
function UsageTab() {
  const [days, setDays] = useState(30);
  const usageQuery = useQuery<any>({
    queryKey: ["/api/insights/usage", days],
    queryFn: async () => {
      const r = await fetch(`/api/insights/usage?days=${days}`, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 60000,
  });

  const data = usageQuery.data;
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-4 mt-4" data-testid="tab-usage-content">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Window:</span>
        {[7, 30, 90, 365].map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? "default" : "outline"}
            onClick={() => setDays(d)}
            data-testid={`button-usage-window-${d}`}
            className="h-7 text-xs"
          >
            {d}d
          </Button>
        ))}
        {usageQuery.isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {usageQuery.isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {usageQuery.error && (
        <Card><CardContent className="py-6 text-sm text-red-500" data-testid="text-usage-error">
          Failed to load usage: {String((usageQuery.error as any)?.message || usageQuery.error)}
        </CardContent></Card>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <MessageSquare className="w-3 h-3" /> Sessions
              </div>
              <div className="text-2xl font-semibold" data-testid="stat-sessions">{data.overview.totalSessions.toLocaleString()}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Activity className="w-3 h-3" /> Messages
              </div>
              <div className="text-2xl font-semibold" data-testid="stat-messages">{data.overview.totalMessages.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {data.overview.totalUserMessages.toLocaleString()} in / {data.overview.totalAssistantMessages.toLocaleString()} out
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <BarChart3 className="w-3 h-3" /> Tokens (est)
              </div>
              <div className="text-2xl font-semibold" data-testid="stat-tokens">
                {(data.overview.estTokensIn + data.overview.estTokensOut).toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {data.overview.estTokensIn.toLocaleString()} in / {data.overview.estTokensOut.toLocaleString()} out
              </div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <DollarSign className="w-3 h-3" /> Est. Cost
              </div>
              <div className="text-2xl font-semibold" data-testid="stat-cost">${data.overview.estCostUsd.toFixed(2)}</div>
            </CardContent></Card>
          </div>

          {data.models?.length > 0 && (
            <Card><CardContent className="pt-4 pb-4">
              <h3 className="font-medium text-sm mb-3 flex items-center gap-1.5">
                <Brain className="w-4 h-4" /> By model
              </h3>
              <div className="space-y-1.5">
                {data.models.slice(0, 12).map((m: any) => {
                  const max = data.models[0]?.estTokens || 1;
                  const pct = Math.max(2, Math.round((m.estTokens / max) * 100));
                  return (
                    <div key={m.model} className="text-xs" data-testid={`row-model-${m.model}`}>
                      <div className="flex justify-between gap-2 mb-0.5">
                        <span className="font-mono truncate">{m.model}</span>
                        <span className="text-muted-foreground tabular-nums shrink-0">
                          {m.messages.toLocaleString()} msgs · {m.estTokens.toLocaleString()} tok · ${m.estCostUsd.toFixed(4)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent></Card>
          )}

          {data.tools?.length > 0 && (
            <Card><CardContent className="pt-4 pb-4">
              <h3 className="font-medium text-sm mb-3 flex items-center gap-1.5">
                <Wrench className="w-4 h-4" /> Tool usage
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {data.tools.map((t: any) => (
                  <Badge key={t.tool} variant="outline" className="text-xs" data-testid={`badge-tool-${t.tool}`}>
                    {t.tool} <span className="ml-1 text-muted-foreground">{t.uses}</span>
                  </Badge>
                ))}
              </div>
            </CardContent></Card>
          )}

          <div className="grid md:grid-cols-2 gap-3">
            <Card><CardContent className="pt-4 pb-4">
              <h3 className="font-medium text-sm mb-3">Activity by hour (UTC)</h3>
              <div className="flex items-end gap-0.5 h-20">
                {data.activityByHour.map((c: number, i: number) => {
                  const max = Math.max(...data.activityByHour, 1);
                  const h = Math.max(2, Math.round((c / max) * 100));
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-blue-500/70 hover:bg-blue-500 rounded-t"
                      style={{ height: `${h}%` }}
                      title={`${i}:00 — ${c}`}
                      data-testid={`bar-hour-${i}`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
              </div>
            </CardContent></Card>

            <Card><CardContent className="pt-4 pb-4">
              <h3 className="font-medium text-sm mb-3">Activity by day of week</h3>
              <div className="flex items-end gap-1 h-20">
                {data.activityByDow.map((c: number, i: number) => {
                  const max = Math.max(...data.activityByDow, 1);
                  const h = Math.max(2, Math.round((c / max) * 100));
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full bg-emerald-500/70 hover:bg-emerald-500 rounded-t" style={{ height: `${h}%` }} title={`${DOW[i]} — ${c}`} data-testid={`bar-dow-${i}`} />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                {DOW.map((d) => <span key={d}>{d}</span>)}
              </div>
            </CardContent></Card>
          </div>

          {data.topSessions?.length > 0 && (
            <Card><CardContent className="pt-4 pb-4">
              <h3 className="font-medium text-sm mb-3">Top sessions</h3>
              <div className="space-y-1.5 text-xs">
                {data.topSessions.map((s: any) => (
                  <div key={s.conversationId} className="flex justify-between gap-2 py-1 border-b last:border-0" data-testid={`row-top-session-${s.conversationId}`}>
                    <div className="truncate flex-1">
                      <span className="font-medium">{s.title}</span>
                      <span className="text-muted-foreground ml-2 font-mono text-[10px]">{s.model}</span>
                    </div>
                    <span className="text-muted-foreground tabular-nums shrink-0">
                      {s.turns} turns · {s.estTokens.toLocaleString()} tok
                    </span>
                  </div>
                ))}
              </div>
            </CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}

const ENGINE_CONFIG = {
  decision: {
    label: "Decision Making",
    icon: Brain,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    description: "Strategic recommendations for resource allocation and marketing",
  },
  prediction: {
    label: "Predictive Analytics",
    icon: TrendingUp,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
    description: "Trend forecasting and opportunity detection",
  },
  optimization: {
    label: "Process Optimization",
    icon: Settings2,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    description: "Workflow efficiency improvements for email and social",
  },
};

const PRIORITY_CONFIG: Record<string, { color: string; label: string }> = {
  high: { color: "text-red-500 border-red-500/30 bg-red-500/10", label: "High" },
  medium: { color: "text-amber-500 border-amber-500/30 bg-amber-500/10", label: "Medium" },
  low: { color: "text-blue-500 border-blue-500/30 bg-blue-500/10", label: "Low" },
};

const STATUS_CONFIG: Record<string, { icon: any; label: string; variant: "default" | "secondary" | "outline" }> = {
  new: { icon: Sparkles, label: "New", variant: "default" },
  applied: { icon: CheckCircle2, label: "Applied", variant: "secondary" },
  dismissed: { icon: XCircle, label: "Dismissed", variant: "outline" },
};

const CATEGORY_LABELS: Record<string, string> = {
  resource_allocation: "Resource Allocation",
  marketing_strategy: "Marketing Strategy",
  agent_optimization: "Agent Optimization",
  cost_reduction: "Cost Reduction",
  growth_opportunity: "Growth Opportunity",
  market_trend: "Market Trend",
  product_opportunity: "Product Opportunity",
  growth_forecast: "Growth Forecast",
  risk_alert: "Risk Alert",
  competitive_insight: "Competitive Insight",
  email_optimization: "Email Optimization",
  social_optimization: "Social Optimization",
  scheduling_optimization: "Scheduling",
  resource_optimization: "Resource Optimization",
  workflow_automation: "Workflow Automation",
  general: "General",
};

function InsightCard({
  insight, onApply, onDismiss,
}: {
  insight: any;
  onApply: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const priority = PRIORITY_CONFIG[insight.priority] || PRIORITY_CONFIG.medium;
  const status = STATUS_CONFIG[insight.status] || STATUS_CONFIG.new;
  const StatusIcon = status.icon;
  const engineConfig = ENGINE_CONFIG[insight.engine_type as keyof typeof ENGINE_CONFIG];
  const EngineIcon = engineConfig?.icon || Lightbulb;

  return (
    <Card
      className={`transition-all hover:shadow-md ${insight.status === "dismissed" ? "opacity-50" : ""}`}
      data-testid={`card-insight-${insight.id}`}
    >
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`w-8 h-8 rounded-lg ${engineConfig?.bgColor || "bg-muted"} flex items-center justify-center shrink-0 mt-0.5`}>
              <EngineIcon className={`w-4 h-4 ${engineConfig?.color || "text-muted-foreground"}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm leading-tight" data-testid={`text-insight-title-${insight.id}`}>
                {insight.title}
              </h3>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <Badge variant="outline" className={`text-xs ${priority.color}`}>
                  {priority.label}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {CATEGORY_LABELS[insight.category] || insight.category}
                </Badge>
                <Badge variant={status.variant} className="text-xs gap-1">
                  <StatusIcon className="w-3 h-3" />
                  {status.label}
                </Badge>
              </div>
            </div>
          </div>
          {insight.status === "new" && (
            <div className="flex gap-1 shrink-0">
              <Button
                size="sm"
                variant="default"
                onClick={() => onApply(insight.id)}
                className="text-xs h-7"
                data-testid={`button-apply-insight-${insight.id}`}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" /> Apply
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDismiss(insight.id)}
                className="text-xs h-7"
                data-testid={`button-dismiss-insight-${insight.id}`}
              >
                <XCircle className="w-3 h-3" />
              </Button>
            </div>
          )}
        </div>

        <p className="text-sm text-muted-foreground ml-11 mb-2">{insight.summary}</p>

        {insight.details && (
          <div className="ml-11">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-6 px-2"
              onClick={() => setExpanded(!expanded)}
              data-testid={`button-expand-insight-${insight.id}`}
            >
              {expanded ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
              {expanded ? "Hide" : "Show"} Details
            </Button>
            {expanded && (
              <div className="mt-2 p-3 bg-muted/50 rounded-lg text-sm whitespace-pre-wrap">
                {insight.details}
              </div>
            )}
          </div>
        )}

        {insight.action_taken && (
          <div className="ml-11 mt-2 text-xs text-green-500 flex items-start gap-1" data-testid={`text-action-taken-${insight.id}`}>
            <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              {insight.action_taken.startsWith("Auto-applied") && (
                <Badge variant="outline" className="text-[10px] mr-1 px-1 py-0 border-green-500/40 text-green-500">
                  AUTO
                </Badge>
              )}
              {insight.action_taken}
            </span>
          </div>
        )}

        <div className="ml-11 mt-2 text-xs text-muted-foreground">
          {new Date(insight.created_at).toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}

function EngineStatsCard({
  engine, stats, onRun, isRunning,
}: {
  engine: keyof typeof ENGINE_CONFIG;
  stats: any;
  onRun: () => void;
  isRunning: boolean;
}) {
  const config = ENGINE_CONFIG[engine];
  const Icon = config.icon;

  return (
    <Card data-testid={`card-engine-${engine}`}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg ${config.bgColor} flex items-center justify-center`}>
              <Icon className={`w-4 h-4 ${config.color}`} />
            </div>
            <div>
              <p className="text-sm font-medium">{config.label}</p>
              <p className="text-xs text-muted-foreground">{config.description}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onRun}
            disabled={isRunning}
            data-testid={`button-run-engine-${engine}`}
          >
            {isRunning ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Play className="w-3 h-3 mr-1" />
            )}
            Run Now
          </Button>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground mt-2">
          <span className="flex items-center gap-1">
            <Lightbulb className="w-3 h-3" /> {stats?.total || 0} total
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-blue-500" /> {stats?.new_count || 0} new
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-green-500" /> {stats?.applied_count || 0} applied
          </span>
          {(stats?.high_priority || 0) > 0 && (
            <span className="flex items-center gap-1 text-red-500">
              <Target className="w-3 h-3" /> {stats.high_priority} high priority
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function InsightsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState("all");

  const insightsQuery = useQuery({
    queryKey: ["/api/insights"],
    refetchInterval: 30000,
  });
  const statsQuery = useQuery({
    queryKey: ["/api/insights/stats"],
    refetchInterval: 30000,
  });

  const insights = (insightsQuery.data || []) as any[];
  const statsData = (statsQuery.data || []) as any[];

  const getStatsForEngine = (engine: string) => statsData.find((s: any) => s.engine_type === engine) || {};

  const runEngine = useMutation({
    mutationFn: (engine: string) => apiRequest("POST", `/api/insights/run/${engine}`),
    onSuccess: (_data: any, engine: string) => {
      queryClient.invalidateQueries({ queryKey: ["/api/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insights/stats"] });
      const label = engine === "all" ? "All Engines" : ENGINE_CONFIG[engine as keyof typeof ENGINE_CONFIG]?.label || engine;
      toast({ title: `${label} complete`, description: "New insights have been generated." });
    },
    onError: (err: any) => {
      toast({ title: "Engine run failed", description: err.message, variant: "destructive" });
    },
  });

  const applyInsight = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/insights/${id}/apply`, { actionTaken: "Applied by user" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insights/stats"] });
      toast({ title: "Insight marked as applied" });
    },
  });

  const dismissInsight = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/insights/${id}/dismiss`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insights/stats"] });
    },
  });

  const filteredInsights = tab === "all"
    ? insights
    : insights.filter((i: any) => i.engine_type === tab);

  const totalNew = insights.filter((i: any) => i.status === "new").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-emerald-500/20 flex items-center justify-center">
              <Lightbulb className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Agentic Intelligence</h1>
              <p className="text-sm text-muted-foreground">
                Autonomous decision-making, predictive analytics, and process optimization
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {totalNew > 0 && (
              <Badge variant="outline" className="gap-1.5 py-1.5 px-3 text-blue-500 border-blue-500/30">
                <Sparkles className="w-3 h-3" />
                {totalNew} new insight{totalNew > 1 ? "s" : ""}
              </Badge>
            )}
            <Button
              onClick={() => runEngine.mutate("all")}
              disabled={runEngine.isPending}
              className="bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700"
              data-testid="button-run-all-engines"
            >
              {runEngine.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Zap className="w-4 h-4 mr-1" />
              )}
              Run All Engines
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(Object.keys(ENGINE_CONFIG) as Array<keyof typeof ENGINE_CONFIG>).map((engine) => (
            <EngineStatsCard
              key={engine}
              engine={engine}
              stats={getStatsForEngine(engine)}
              onRun={() => runEngine.mutate(engine)}
              isRunning={runEngine.isPending}
            />
          ))}
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList data-testid="tabs-insights">
            <TabsTrigger value="all" data-testid="tab-all-insights">
              <Lightbulb className="w-4 h-4 mr-1" /> All Insights
              {totalNew > 0 && (
                <Badge variant="default" className="ml-1 text-xs h-5 px-1.5">{totalNew}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="decision" data-testid="tab-decision">
              <Brain className="w-4 h-4 mr-1" /> Decisions
            </TabsTrigger>
            <TabsTrigger value="prediction" data-testid="tab-prediction">
              <TrendingUp className="w-4 h-4 mr-1" /> Predictions
            </TabsTrigger>
            <TabsTrigger value="optimization" data-testid="tab-optimization">
              <Settings2 className="w-4 h-4 mr-1" /> Optimizations
            </TabsTrigger>
            <TabsTrigger value="usage" data-testid="tab-usage">
              <BarChart3 className="w-4 h-4 mr-1" /> Usage
            </TabsTrigger>
          </TabsList>

          {tab === "usage" && (
            <TabsContent value="usage" forceMount>
              <UsageTab />
            </TabsContent>
          )}

          {tab !== "usage" && (
          <TabsContent value={tab} className="space-y-3 mt-4">
            {insightsQuery.isLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {filteredInsights.length === 0 && !insightsQuery.isLoading && (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Lightbulb className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                  <h3 className="font-medium mb-1">No insights yet</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Run the agentic engines to generate strategic recommendations, predictions, and optimizations.
                  </p>
                  <Button
                    onClick={() => runEngine.mutate("all")}
                    disabled={runEngine.isPending}
                    data-testid="button-run-first-analysis"
                  >
                    {runEngine.isPending ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4 mr-1" />
                    )}
                    Run First Analysis
                  </Button>
                </CardContent>
              </Card>
            )}

            {filteredInsights.map((insight: any) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                onApply={(id) => applyInsight.mutate(id)}
                onDismiss={(id) => dismissInsight.mutate(id)}
              />
            ))}
          </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}
