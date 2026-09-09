import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Bot, MessageSquare, Zap, Clock, TrendingUp, Plus, ArrowRight, Brain, Users,
  BookOpen, Activity, CheckCircle2, XCircle, FileText, Code, Shield,
  AlertTriangle, RefreshCw, Rocket, Globe, Briefcase, ChevronRight,
  Send, Loader2, Trash2, Settings2, FolderOpen, ExternalLink, Crown, Map, Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { safeUrl } from "@/lib/safe-url";
import type { Conversation, Skill, ConversationTemplate } from "@shared/schema";
import { isActiveAttentionEventStatus } from "@shared/attention-status";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { ErrorState } from "@/components/error-state";
import OnboardingWelcome from "@/components/onboarding-welcome";
import UsageDashboard from "@/components/usage-dashboard";
import {
  TEMPLATE_ICONS, PLAYBOOKS, StatusPulse, renderBoldText, BriefingSpeakButton,
  type Stats, type HealthReport, type HeartbeatLogEntry,
} from "@/components/home-widgets";
import { HomeReleaseUpdates } from "@/components/home-release-updates";

export default function HomePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [releaseExpanded, setReleaseExpanded] = useState<Set<string>>(new Set());
  const toggleRelease = (id: string) => setReleaseExpanded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const [playBookInput, setPlaybookInput] = useState<string | null>(null);
  const [playBookPrompt, setPlaybookPrompt] = useState("");
  const [corpReportUrl, setCorpReportUrl] = useState<string | null>(null);

  const corpReportMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/reports/corporation", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error || "Report generation failed");
      return res.json();
    },
    onSuccess: (data) => {
      setCorpReportUrl(data.url || null);
      toast({ title: "Corporation Report Generated", description: data.url ? "PDF uploaded to Google Drive" : "PDF created successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Report Failed", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    const seen = localStorage.getItem("vc_onboarding_seen");
    if (!seen) setShowOnboarding(true);

    const params = new URLSearchParams(window.location.search);
    if (params.get("subscription") === "success") {
      const plan = params.get("plan") || "starter";
      queryClient.invalidateQueries({ queryKey: ["/api/usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      toast({ title: `Payment received for ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan!`, description: "Your plan is being activated." });
      window.history.replaceState({}, "", "/");
    } else if (params.get("subscription") === "cancelled") {
      toast({ title: "Subscription cancelled", description: "No changes were made.", variant: "destructive" });
      window.history.replaceState({}, "", "/");
    }
  }, []);

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    localStorage.setItem("vc_onboarding_seen", "1");
    apiRequest("POST", "/api/onboarding/seen").catch((err) => {
      console.warn("[onboarding] failed to persist seen-flag (non-fatal):", err?.message || err);
    });
  };

  const handleOnboardingChat = async (prompt: string) => {
    dismissOnboarding();
    try {
      const res = await apiRequest("POST", "/api/conversations", { title: "New Chat" });
      const conv = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      navigate(`/chat/${conv.id}?prompt=${encodeURIComponent(prompt)}`);
    } catch {
      toast({ title: "Failed to start chat", variant: "destructive" });
    }
  };

  const retryOpts = { retry: 3, retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 5000) };
  const statsQuery = useQuery<Stats>({ queryKey: ["/api/stats"], ...retryOpts });
  const stats = statsQuery.data;
  const healthQuery = useQuery<HealthReport>({ queryKey: ["/api/health"], refetchInterval: 5 * 60 * 1000, ...retryOpts });
  const health = healthQuery.data;
  const { data: convResult, isLoading: convsLoading } = useQuery<{ data: Conversation[]; total: number }>({ queryKey: ["/api/conversations"], ...retryOpts });
  const conversations = convResult?.data ?? [];
  const { data: settings } = useQuery<{ agentName: string; defaultModel: string }>({ queryKey: ["/api/settings"], ...retryOpts });
  const { data: templates = [] } = useQuery<ConversationTemplate[]>({ queryKey: ["/api/templates"] });
  const { data: recentLogs = [] } = useQuery<HeartbeatLogEntry[]>({ queryKey: ["/api/heartbeat/logs?limit=15"], refetchInterval: 30000 });
  const { data: attentionEvents = [] } = useQuery<Array<{ id: number; event_type: string; source: string; salience_score: string | number | null; salience_meta: any; data: any; created_at: string; status: string }>>({ queryKey: ["/api/events/log?status=active&limit=20"], refetchInterval: 15000 });
  const activeAttentionEvents = attentionEvents.filter((event) => isActiveAttentionEventStatus(event.status));
  const { data: pendingPlans = [] } = useQuery<Array<{ id: number; objective: string; status: string; plan_json: any; version: number; parent_plan_id: number | null; created_at: string }>>({ queryKey: ["/api/plans?status=awaiting_approval&limit=10"], refetchInterval: 15000 });
  const { data: capabilityStats = [] } = useQuery<Array<{ kind: string; active_count: number; total_count: number }>>({ queryKey: ["/api/capabilities/stats"], refetchInterval: 60000 });
  const decidePlanMutation = useMutation({
    mutationFn: async (args: { planId: number; decision: "approve" | "reject" | "revise"; reason: string }) => {
      return apiRequest("POST", `/api/plans/${args.planId}/decide`, { decision: args.decision, reason: args.reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans?status=awaiting_approval&limit=10"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events/log?limit=20"] });
      toast({ title: "Decision recorded", description: "Plan status updated." });
    },
    onError: (err: any) => toast({ title: "Decision failed", description: err?.message ?? "Unknown error", variant: "destructive" }),
  });
  const { data: driveFolder } = useQuery<{ rootUrl: string }>({ queryKey: ["/api/gdrive/folder"] });

  interface BriefingData {
    greeting: string;
    localDate: string;
    localTime: string;
    timezone: string;
    weather: { temp: string; condition: string; icon: string; location: string } | null;
    today: { tasksCompleted: number; tasksFailed: number; conversations: number; topTasks: { name: string; status: string; persona: string | null; time: string }[] };
    yesterday: { tasksCompleted: number };
    activeAgents: { name: string; role: string; icon: string }[];
    memoryCount: number | null;
  }

  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const briefingQueryKey = `/api/briefing?tz=${encodeURIComponent(userTz)}`;
  const { data: briefing } = useQuery<BriefingData>({ queryKey: [briefingQueryKey], refetchInterval: 60000 });

  interface AIBriefing { content: string; model: string; durationMs: number; generatedAt: string; created_at?: string }
  interface BriefingWidget { id: number; label: string; prompt: string; widget_type: string; enabled: boolean; sort_order: number; last_updated_at: string | null }

  const { data: aiBriefing } = useQuery<AIBriefing | null>({ queryKey: ["/api/briefing/latest"] });
  const { data: widgets = [] } = useQuery<BriefingWidget[]>({ queryKey: ["/api/briefing/widgets"] });

  const [showAIBriefing, setShowAIBriefing] = useState(false);
  const [widgetDialogOpen, setWidgetDialogOpen] = useState(false);
  const [newWidgetLabel, setNewWidgetLabel] = useState("");
  const [newWidgetPrompt, setNewWidgetPrompt] = useState("");

  const generateBriefingMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/briefing/generate", {
        tz: userTz,
      }).then(r => r.json()),
    onSuccess: (data: AIBriefing) => {
      queryClient.setQueryData(["/api/briefing/latest"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/briefing/latest"] });
      setShowAIBriefing(true);
      toast({ title: "Briefing generated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate briefing", description: err.message, variant: "destructive" });
    },
  });

  const addWidgetMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/briefing/widgets", {
        label: newWidgetLabel,
        prompt: newWidgetPrompt,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/briefing/widgets"] });
      setNewWidgetLabel("");
      setNewWidgetPrompt("");
      setWidgetDialogOpen(false);
      toast({ title: "Briefing item added" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add", description: err.message, variant: "destructive" });
    },
  });

  const deleteWidgetMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/briefing/widgets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/briefing/widgets"] });
      toast({ title: "Briefing item removed" });
    },
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/conversations", { title: "New Chat" }),
    onSuccess: async (res) => {
      const conv = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      navigate(`/chat/${conv.id}`);
    },
    onError: () => { toast({ title: "Failed to create chat", variant: "destructive" }); },
  });

  const startTemplateMutation = useMutation({
    mutationFn: (templateId: number) => apiRequest("POST", `/api/templates/${templateId}/start`),
    onSuccess: async (res) => {
      const conv = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      navigate(`/chat/${conv.id}`);
    },
    onError: () => { toast({ title: "Failed to start template", variant: "destructive" }); },
  });

  const launchPlaybook = async (basePrompt: string, details: string) => {
    const fullPrompt = `${basePrompt} ${details}`;
    try {
      const res = await apiRequest("POST", "/api/conversations", { title: "New Chat" });
      const conv = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      navigate(`/chat/${conv.id}?prompt=${encodeURIComponent(fullPrompt)}`);
    } catch {
      toast({ title: "Failed to launch", variant: "destructive" });
    }
  };

  const dashboardLoading = statsQuery.isLoading || (statsQuery.isError && statsQuery.failureCount < 3);

  const recentConvs = conversations.slice(0, 5);
  const uptimeHours = stats ? Math.floor(stats.uptime / 3600) : 0;
  const uptimeDays = Math.floor(uptimeHours / 24);
  const uptimeRemH = uptimeHours % 24;
  const successLogs = recentLogs.filter(l => l.status === "success" || l.status === "warning").length;
  const failedLogs = recentLogs.filter(l => l.status === "error").length;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" data-testid="page-command-center">
      {showOnboarding && (
        <OnboardingWelcome onDismiss={dismissOnboarding} onStartChat={handleOnboardingChat} />
      )}

      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">

        {/* Header Row: Agent identity + system pulse */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center text-xl" data-testid="icon-agent">🦞</div>
            <div>
              <h1 className="text-xl font-bold text-foreground" data-testid="text-agent-name">
                {settings?.agentName || "VisionClaw"}
              </h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {stats?.activePersona && (
                  <button onClick={() => navigate("/personas")} className="hover:text-foreground transition-colors" data-testid="link-persona">
                    {stats.activePersona}
                  </button>
                )}
                {stats?.activePersona && <span>·</span>}
                <span data-testid="text-uptime">
                  {uptimeDays > 0 ? `${uptimeDays}d ${uptimeRemH}h` : `${uptimeHours}h`} uptime
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {health && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="status-health">
                <StatusPulse status={health.overall} />
                <span className="hidden sm:inline">
                  {health.overall === "healthy" ? "All systems go" : health.overall === "degraded" ? "Degraded" : "Issues"}
                </span>
              </div>
            )}
            <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending} data-testid="button-new-chat-header">
              <Plus className="w-4 h-4 mr-1" /> New Chat
            </Button>
          </div>
        </div>

        <HomeReleaseUpdates releaseExpanded={releaseExpanded} toggleRelease={toggleRelease} />

        {/* Stats Row: Compact horizontal strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="section-stats">
          {[
            { icon: MessageSquare, label: "Chats", value: stats?.totalConversations ?? 0, hint: "Start a chat to get going" },
            { icon: TrendingUp, label: "Messages", value: stats?.totalMessages ?? 0, hint: "Send your first message" },
            { icon: Brain, label: "Remembered", value: stats?.totalMemories ?? 0, hint: "AI learns as you chat" },
            { icon: Activity, label: "Tasks Run", value: recentLogs.length > 0 ? `${successLogs}/${recentLogs.length}` : 0, hint: "Set up automations" },
          ].map(({ icon: Icon, label, value, hint }) => (
            <div key={label} className="flex items-center gap-2.5 p-3 rounded-lg bg-card border border-border" data-testid={`stat-${label.toLowerCase()}`}>
              <Icon className="w-4 h-4 text-primary shrink-0" />
              <div>
                {dashboardLoading ? (
                  <>
                    <Skeleton className="h-5 w-10 mb-1" />
                    <Skeleton className="h-3 w-14" />
                  </>
                ) : (
                  <>
                    <div className="text-lg font-bold leading-none">{value === 0 ? "—" : value}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{value === 0 ? hint : label}</div>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Daily Briefing */}
        {briefing && (
          <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent" data-testid="card-briefing">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Briefcase className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">{briefing.greeting}</span>
                    {briefing.localTime && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {briefing.localTime}
                      </span>
                    )}
                    {briefing.localDate && (
                      <span className="text-xs text-muted-foreground" data-testid="text-briefing-date">
                        {briefing.localDate}
                      </span>
                    )}
                    {briefing.weather && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-weather">
                        <span>{briefing.weather.icon}</span>
                        <span className="text-foreground font-medium">{briefing.weather.temp}</span>
                        <span>{briefing.weather.condition}</span>
                        {briefing.weather.location && (
                          <span className="text-muted-foreground/60">· {briefing.weather.location}</span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      <span className="text-foreground font-medium">{briefing.today.tasksCompleted}</span> tasks completed today
                      {briefing.today.tasksFailed > 0 && (
                        <span className="text-red-400 ml-1">({briefing.today.tasksFailed} failed)</span>
                      )}
                    </span>
                    <span><span className="text-foreground font-medium">{briefing.today.conversations}</span> conversations</span>
                    {briefing.activeAgents.length > 0 && (
                      <span><span className="text-foreground font-medium">{briefing.activeAgents.length}</span> agents active</span>
                    )}
                    {briefing.yesterday.tasksCompleted > 0 && (
                      <span className="text-muted-foreground/60">Yesterday: {briefing.yesterday.tasksCompleted} tasks</span>
                    )}
                  </div>
                  {briefing.today.topTasks.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {briefing.today.topTasks.slice(0, 3).map((t, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] py-0 h-4 gap-1">
                          {t.status === "success" ? <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" /> : <XCircle className="w-2.5 h-2.5 text-red-500" />}
                          {t.name}
                          {t.persona && <span className="text-muted-foreground/60 ml-0.5">({t.persona})</span>}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  {briefing.activeAgents.length > 0 && (
                    <div className="flex -space-x-1.5" data-testid="agent-avatars">
                      {briefing.activeAgents.slice(0, 5).map((a) => {
                        const IconComp = a.icon ? TEMPLATE_ICONS[a.icon] : null;
                        return (
                          <div
                            key={a.name}
                            className="w-7 h-7 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs font-medium overflow-hidden shrink-0"
                            title={`${a.name} — ${a.role}`}
                            data-testid={`avatar-agent-${a.name}`}
                          >
                            {IconComp ? (
                              <IconComp className="w-3.5 h-3.5" />
                            ) : (
                              <span>{a.name.charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* AI Briefing actions row */}
              <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border/50">
                <Button
                  size="sm"
                  variant={showAIBriefing ? "default" : "outline"}
                  className="h-7 text-xs gap-1"
                  onClick={() => {
                    if (!aiBriefing) {
                      generateBriefingMutation.mutate();
                    } else {
                      setShowAIBriefing(!showAIBriefing);
                    }
                  }}
                  disabled={generateBriefingMutation.isPending}
                  data-testid="button-ai-briefing"
                >
                  {generateBriefingMutation.isPending ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Generating...</>
                  ) : aiBriefing ? (
                    <><Sparkles className="w-3 h-3" /> {showAIBriefing ? "Hide" : "Show"} AI Briefing</>
                  ) : (
                    <><Sparkles className="w-3 h-3" /> Generate AI Briefing</>
                  )}
                </Button>
                {aiBriefing && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1"
                    onClick={() => generateBriefingMutation.mutate()}
                    disabled={generateBriefingMutation.isPending}
                    data-testid="button-refresh-briefing"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </Button>
                )}

                <BriefingSpeakButton text={
                  aiBriefing?.content ||
                  `${briefing.greeting}. ${briefing.weather ? `It's ${briefing.weather.temp} degrees and ${(briefing.weather as any).description} in ${briefing.weather.location || 'your area'}.` : ''} You have ${briefing.today.tasksCompleted} tasks completed today, ${briefing.today.conversations} conversations, and ${briefing.activeAgents.length} agents active.${briefing.today.topTasks.length > 0 ? ` Top tasks: ${briefing.today.topTasks.map(t => t.name).join(', ')}.` : ''}`
                } />

                <Dialog open={widgetDialogOpen} onOpenChange={setWidgetDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 ml-auto" data-testid="button-add-widget">
                      <Settings2 className="w-3 h-3" /> Customize Briefing
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>Customize Your Briefing</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground">
                        Add items you want the AI to research and include in your daily briefing.
                        The AI will use its tools to find fresh data each time you generate a briefing.
                      </p>

                      {widgets.length > 0 && (
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">Your briefing items</label>
                          {widgets.map(w => (
                            <div key={w.id} className="flex items-center justify-between gap-2 p-2 rounded bg-muted/30 text-sm" data-testid={`widget-${w.id}`}>
                              <div className="min-w-0">
                                <div className="font-medium text-xs">{w.label}</div>
                                <div className="text-[10px] text-muted-foreground truncate">{w.prompt}</div>
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 shrink-0"
                                onClick={() => deleteWidgetMutation.mutate(w.id)}
                                data-testid={`button-delete-widget-${w.id}`}
                              >
                                <Trash2 className="w-3 h-3 text-muted-foreground hover:text-red-400" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="space-y-2 border-t border-border pt-3">
                        <label className="text-xs font-medium">Add a new briefing item</label>
                        <Input
                          placeholder="Label — e.g., Stock Prices, Industry News"
                          value={newWidgetLabel}
                          onChange={(e) => setNewWidgetLabel(e.target.value)}
                          data-testid="input-widget-label"
                        />
                        <Input
                          placeholder="What to look up — e.g., Get AAPL, TSLA, MSFT stock prices"
                          value={newWidgetPrompt}
                          onChange={(e) => setNewWidgetPrompt(e.target.value)}
                          data-testid="input-widget-prompt"
                        />
                      </div>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button variant="outline" size="sm">Done</Button>
                        </DialogClose>
                        <Button
                          size="sm"
                          disabled={!newWidgetLabel || !newWidgetPrompt || addWidgetMutation.isPending}
                          onClick={() => addWidgetMutation.mutate()}
                          data-testid="button-save-widget"
                        >
                          {addWidgetMutation.isPending ? "Adding..." : "Add Item"}
                        </Button>
                      </DialogFooter>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              {/* Briefing widget chips */}
              {widgets.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {widgets.map(w => (
                    <Badge key={w.id} variant="outline" className="text-[10px] py-0 h-4 gap-1 bg-primary/5">
                      <Sparkles className="w-2 h-2" />
                      {w.label}
                    </Badge>
                  ))}
                </div>
              )}

              {/* AI-Generated Briefing Content */}
              {showAIBriefing && aiBriefing && (
                <div className="border-t border-border/50 pt-3" data-testid="ai-briefing-content">
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mb-1 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mb-1 [&_h2]:mt-3 [&_h3]:text-xs [&_h3]:font-semibold [&_ul]:my-1 [&_li]:my-0.5 [&_p]:my-1 [&_strong]:text-foreground">
                    {aiBriefing.content.split("\n").map((line, i) => {
                      if (line.startsWith("## ")) return <h2 key={i}>{line.slice(3)}</h2>;
                      if (line.startsWith("### ")) return <h3 key={i}>{line.slice(4)}</h3>;
                      if (line.startsWith("**") && line.endsWith("**")) return <h3 key={i}>{line.slice(2, -2)}</h3>;
                      if (line.startsWith("- ") || line.startsWith("* ")) {
                        return (
                          <div key={i} className="flex items-start gap-1.5 ml-2">
                            <span className="text-primary mt-0.5">•</span>
                            <span>{renderBoldText(line.slice(2))}</span>
                          </div>
                        );
                      }
                      if (!line.trim()) return null;
                      return <p key={i}>{renderBoldText(line)}</p>;
                    })}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                      <span>Generated {aiBriefing.created_at ? formatDistanceToNow(new Date(aiBriefing.created_at), { addSuffix: true }) : "just now"}</span>
                      <span>·</span>
                      <span>{aiBriefing.model}</span>
                      {aiBriefing.durationMs && <><span>·</span><span>{(aiBriefing.durationMs / 1000).toFixed(1)}s</span></>}
                    </div>
                    <BriefingSpeakButton text={aiBriefing.content} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Usage & Plan */}
        <UsageDashboard />

        {/* Main Content: Two-Column Layout */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">

          {/* Left Column: Playbooks + Activity (wider) */}
          <div className="lg:col-span-3 space-y-5 min-w-0">

            {/* Playbooks: One-Click Actions */}
            <Card data-testid="card-playbooks">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Rocket className="w-4 h-4 text-primary" /> Quick Launch
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {PLAYBOOKS.map((pb) => (
                    <button
                      key={pb.id}
                      data-testid={`playbook-${pb.id}`}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border border-border hover:border-primary/30 transition-all text-left group ${playBookInput === pb.id ? "border-primary/50 bg-primary/5" : "bg-card"}`}
                      onClick={() => {
                        if (playBookInput === pb.id) {
                          setPlaybookInput(null);
                        } else {
                          setPlaybookInput(pb.id);
                          setPlaybookPrompt("");
                        }
                      }}
                    >
                      <div className={`w-7 h-7 rounded-md ${pb.bg} flex items-center justify-center shrink-0`}>
                        <pb.icon className={`w-3.5 h-3.5 ${pb.color}`} />
                      </div>
                      <span className="text-xs font-medium">{pb.label}</span>
                    </button>
                  ))}
                </div>

                {/* Playbook detail input */}
                {playBookInput && (
                  <div className="mt-3 flex gap-2" data-testid="playbook-input">
                    <input
                      type="text"
                      className="flex-1 text-sm px-3 py-2 rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder={PLAYBOOKS.find(p => p.id === playBookInput)?.label + "..."}
                      value={playBookPrompt}
                      onChange={(e) => setPlaybookPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && playBookPrompt.trim()) {
                          const pb = PLAYBOOKS.find(p => p.id === playBookInput)!;
                          launchPlaybook(pb.prompt, playBookPrompt.trim());
                        }
                      }}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      disabled={!playBookPrompt.trim()}
                      onClick={() => {
                        const pb = PLAYBOOKS.find(p => p.id === playBookInput)!;
                        launchPlaybook(pb.prompt, playBookPrompt.trim());
                      }}
                      data-testid="button-launch-playbook"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Corporation Report Export — show only when user has some activity */}
            {(stats?.totalConversations ?? 0) > 0 && <Card data-testid="card-corporation-report">
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                    <BookOpen className="w-4 h-4 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Corporation Report</p>
                    <p className="text-[11px] text-muted-foreground">PDF with agents, tasks, memory, and system health — auto-uploaded to Google Drive</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* R125+12+sec (architect HIGH closed 2026-05-24): safeUrl gates the
                      DB-sourced corpReportUrl so a tainted value can't become a
                      `javascript:` / `data:` / private-host anchor. */}
                  {corpReportUrl && safeUrl(corpReportUrl) && (
                    <a href={safeUrl(corpReportUrl)} target="_blank" rel="noopener noreferrer" data-testid="link-corp-report-download">
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                        <ArrowRight className="w-3 h-3" /> Open
                      </Button>
                    </a>
                  )}
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => corpReportMutation.mutate()}
                    disabled={corpReportMutation.isPending}
                    data-testid="button-export-corp-report"
                  >
                    {corpReportMutation.isPending ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Generating...</>
                    ) : (
                      <><FileText className="w-3 h-3" /> Export</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>}

            {driveFolder?.rootUrl && safeUrl(driveFolder.rootUrl) && (
              <Card data-testid="card-drive-folder">
                <CardContent className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <FolderOpen className="w-4 h-4 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Google Drive Files</p>
                      <p className="text-[11px] text-muted-foreground">Browse all presentations, PDFs, and deliverables generated by your agents</p>
                    </div>
                  </div>
                  {/* R125+12+sec (architect HIGH closed 2026-05-24): safeUrl gate. */}
                  <a href={safeUrl(driveFolder.rootUrl)} target="_blank" rel="noopener noreferrer" data-testid="link-drive-folder">
                    <Button size="sm" className="h-7 text-xs gap-1">
                      <FolderOpen className="w-3 h-3" /> Open Drive <ExternalLink className="w-3 h-3" />
                    </Button>
                  </a>
                </CardContent>
              </Card>
            )}

            {/* Plans Awaiting Felix — Minerva planner / Round 24 */}
            {pendingPlans.length > 0 && (
              <Card data-testid="card-plans-awaiting-felix" className="border-primary/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Crown className="w-4 h-4 text-primary" /> Plans Awaiting Felix
                    </span>
                    <Badge variant="default" className="text-[10px] py-0 h-4" data-testid="badge-plans-pending">
                      {pendingPlans.length} pending
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  {pendingPlans.map((p) => {
                    const totalMin = p.plan_json?.total_estimated_minutes ?? 0;
                    const totalCost = p.plan_json?.total_estimated_cost_usd ?? 0;
                    const stepCount = Array.isArray(p.plan_json?.steps) ? p.plan_json.steps.length : 0;
                    const isRevision = p.parent_plan_id != null || p.version > 1;
                    return (
                      <div key={p.id} className="border rounded-md p-3 space-y-2" data-testid={`plan-row-${p.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate" data-testid={`text-plan-objective-${p.id}`}>
                              {p.objective}
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                              <span>Plan #{p.id}{isRevision ? ` (rev ${p.version})` : ""}</span>
                              <span>·</span>
                              <span>{stepCount} steps</span>
                              <span>·</span>
                              <span>~{totalMin} min</span>
                              <span>·</span>
                              <span>~${Number(totalCost).toFixed(2)}</span>
                              <span>·</span>
                              <span>{formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}</span>
                            </div>
                          </div>
                        </div>
                        {Array.isArray(p.plan_json?.steps) && (
                          <div className="text-[11px] text-muted-foreground space-y-0.5 pl-1">
                            {p.plan_json.steps.slice(0, 4).map((s: any) => (
                              <div key={s.n} className="truncate" data-testid={`text-plan-step-${p.id}-${s.n}`}>
                                <span className="font-mono">{s.n}.</span> <span className="font-medium text-foreground/80">{s.agent}</span> — {s.task}
                              </div>
                            ))}
                            {p.plan_json.steps.length > 4 && (
                              <div className="text-muted-foreground/60">+ {p.plan_json.steps.length - 4} more steps</div>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="default"
                            className="h-7 text-xs"
                            disabled={decidePlanMutation.isPending}
                            onClick={() => {
                              const reason = window.prompt("Approval note (Felix's call):", "Looks good — proceed.");
                              if (reason && reason.trim()) decidePlanMutation.mutate({ planId: p.id, decision: "approve", reason: reason.trim() });
                            }}
                            data-testid={`button-approve-plan-${p.id}`}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={decidePlanMutation.isPending}
                            onClick={() => {
                              const reason = window.prompt("What needs to change? Minerva will re-plan with this feedback:");
                              if (reason && reason.trim()) decidePlanMutation.mutate({ planId: p.id, decision: "revise", reason: reason.trim() });
                            }}
                            data-testid={`button-revise-plan-${p.id}`}
                          >
                            Revise
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive"
                            disabled={decidePlanMutation.isPending}
                            onClick={() => {
                              const reason = window.prompt("Reason for rejection:");
                              if (reason && reason.trim()) decidePlanMutation.mutate({ planId: p.id, decision: "reject", reason: reason.trim() });
                            }}
                            data-testid={`button-reject-plan-${p.id}`}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
                    Minerva proposes; Felix decides. Approved plans hand off to assigned agents. Revised plans loop back to Minerva with your feedback.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Capability Map — Round 25 — single source of truth for what the system can do */}
            {capabilityStats.length > 0 && (
              <Card data-testid="card-capability-map" className="border-muted">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Map className="w-4 h-4 text-muted-foreground" /> Capability Map
                    </span>
                    <Badge variant="outline" className="text-[10px] py-0 h-4" data-testid="badge-capability-total">
                      {capabilityStats.reduce((a, s) => a + s.active_count, 0)} active
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {capabilityStats.map((s) => {
                      const labels: Record<string, string> = {
                        agent: "Agents",
                        event: "Events",
                        webhook: "Webhooks",
                        integration: "Integrations",
                        fulfillment: "Fulfillment",
                        tool: "Tools",
                        route: "Routes",
                      };
                      const inactive = s.total_count - s.active_count;
                      return (
                        <div key={s.kind} className="border rounded-md p-2" data-testid={`capability-stat-${s.kind}`}>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{labels[s.kind] ?? s.kind}</div>
                          <div className="text-lg font-semibold leading-tight" data-testid={`text-capability-count-${s.kind}`}>
                            {s.active_count}
                            {inactive > 0 && <span className="text-[11px] text-muted-foreground/70 ml-1 font-normal">+{inactive} retired</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed pt-2">
                    Single source of truth Minerva uses to plan. Anything that exists in the codebase but isn't here is invisible to the planner.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Attention Stream — Attention Bus v0 */}
            {activeAttentionEvents.length > 0 && (() => {
              const sorted = [...activeAttentionEvents].sort((a, b) => {
                const sa = a.salience_score == null ? -1 : Number(a.salience_score);
                const sb = b.salience_score == null ? -1 : Number(b.salience_score);
                if (sb !== sa) return sb - sa;
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              }).slice(0, 8);
              const wakeCount = activeAttentionEvents.filter(e => e.salience_score != null && Number(e.salience_score) >= 70).length;
              return (
                <Card data-testid="card-attention-stream">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Brain className="w-4 h-4 text-primary" /> Attention Stream
                      </span>
                      <div className="flex items-center gap-2">
                        {wakeCount > 0 && (
                          <Badge variant="destructive" className="text-[10px] py-0 h-4" data-testid="badge-attention-wake">
                            {wakeCount} wake
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] py-0 h-4" data-testid="badge-attention-total">
                          {activeAttentionEvents.length} events
                        </Badge>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div className="space-y-1">
                      {sorted.map((ev) => {
                        const score = ev.salience_score == null ? null : Number(ev.salience_score);
                        const isWake = score != null && score >= 70;
                        const isDigest = score != null && score >= 40 && score < 70;
                        const dotClass = isWake ? "bg-red-500" : isDigest ? "bg-amber-500" : "bg-muted";
                        const scoreClass = isWake ? "text-red-500" : isDigest ? "text-amber-500" : "text-muted-foreground";
                        return (
                          <div key={ev.id} className="flex items-center gap-2 py-1 text-xs" data-testid={`attention-event-${ev.id}`}>
                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
                            <span className={`font-mono font-semibold w-8 text-right ${scoreClass}`} data-testid={`text-salience-${ev.id}`}>
                              {score == null ? "—" : score}
                            </span>
                            <span className="font-medium truncate flex-1" data-testid={`text-event-type-${ev.id}`}>{ev.event_type}</span>
                            <Badge variant="outline" className="text-[9px] py-0 h-4 shrink-0">{ev.source}</Badge>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
                      Salience ≥ 70 wakes the owner immediately · 40–69 batches to hourly digest · &lt; 40 logs only
                    </p>
                  </CardContent>
                </Card>
              );
            })()}

            {/* Agent Activity Timeline */}
            {recentLogs.length > 0 && (
              <Card data-testid="card-activity-timeline">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-primary" /> Agent Activity
                    </span>
                    <div className="flex items-center gap-2">
                      {failedLogs > 0 && (
                        <Badge variant="destructive" className="text-[10px] py-0 h-4" data-testid="badge-failed-tasks">
                          {failedLogs} failed
                        </Badge>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate("/heartbeat")} data-testid="link-view-all-activity">
                        View all <ChevronRight className="w-3 h-3 ml-0.5" />
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="relative">
                    <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border" />
                    <div className="space-y-0.5">
                      {recentLogs.slice(0, 8).map((log) => (
                        <div key={log.id} className="flex items-start gap-3 py-1.5 relative" data-testid={`activity-${log.id}`}>
                          <div className="relative z-10 mt-0.5">
                            {log.status === "success" ? (
                              <div className="w-[22px] h-[22px] rounded-full bg-emerald-500/15 flex items-center justify-center">
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                              </div>
                            ) : log.status === "warning" ? (
                              <div className="w-[22px] h-[22px] rounded-full bg-amber-500/15 flex items-center justify-center">
                                <AlertTriangle className="w-3 h-3 text-amber-500" />
                              </div>
                            ) : (
                              <div className="w-[22px] h-[22px] rounded-full bg-red-500/15 flex items-center justify-center">
                                <XCircle className="w-3 h-3 text-red-500" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium truncate">{log.taskName}</span>
                              {log.personaName && (
                                <Badge variant="outline" className="text-[9px] py-0 h-4 shrink-0">{log.personaName}</Badge>
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                              {log.durationMs != null && <span> · {(log.durationMs / 1000).toFixed(1)}s</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Templates */}
            {templates.length > 0 && (
              <Card data-testid="card-templates">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-primary" /> Templates
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {templates.map((tmpl) => {
                      const IconComp = TEMPLATE_ICONS[tmpl.icon] || MessageSquare;
                      return (
                        <button
                          key={tmpl.id}
                          data-testid={`button-template-${tmpl.id}`}
                          className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/20 border border-border hover:border-primary/30 hover:bg-muted/40 transition-all text-left"
                          onClick={() => startTemplateMutation.mutate(tmpl.id)}
                          disabled={startTemplateMutation.isPending}
                        >
                          <IconComp className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{tmpl.name}</div>
                            <div className="text-[10px] text-muted-foreground line-clamp-2">{tmpl.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column: Recent chats + System info */}
          <div className="lg:col-span-2 space-y-5 min-w-0">

            {/* Recent Conversations */}
            <Card data-testid="card-recent-chats">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" /> Recent Chats
                </CardTitle>
              </CardHeader>
              <CardContent>
                {convsLoading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-full" />)}
                  </div>
                ) : recentConvs.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No conversations yet</p>
                ) : (
                  <div className="space-y-0.5">
                    {recentConvs.map((conv) => (
                      <button
                        key={conv.id}
                        data-testid={`link-recent-conversation-${conv.id}`}
                        className="w-full text-left px-2.5 py-2 rounded-md hover:bg-muted/50 transition-colors group"
                        onClick={() => navigate(`/chat/${conv.id}`)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <MessageSquare className="w-3 h-3 shrink-0 text-muted-foreground" />
                            <span className="text-xs truncate">{conv.title}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(conv.updatedAt), { addSuffix: true })}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* System Health Detail */}
            <Card data-testid="card-system-health">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" /> System Health
                </CardTitle>
              </CardHeader>
              <CardContent>
                {health ? (
                  <div className="space-y-1.5">
                    {health.checks.map((check) => (
                      <div key={check.name} className="flex items-center justify-between text-xs" data-testid={`health-check-${check.name}`}>
                        <span className="text-muted-foreground">{check.name}</span>
                        <div className="flex items-center gap-1.5">
                          {check.latencyMs != null && (
                            <span className="text-[10px] text-muted-foreground/60">{check.latencyMs}ms</span>
                          )}
                          {check.status === "healthy" ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          ) : check.status === "degraded" ? (
                            <AlertTriangle className="w-3 h-3 text-amber-500" />
                          ) : (
                            <XCircle className="w-3 h-3 text-red-500" />
                          )}
                        </div>
                      </div>
                    ))}
                    {health.autoRemediations.length > 0 && (
                      <div className="mt-2 text-[10px] text-emerald-500">
                        Auto-fixed: {health.autoRemediations.join(", ")}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 text-xs" data-testid="system-health-unavailable">
                    <span className="text-muted-foreground">
                      {healthQuery.isLoading ? "Checking live system status…" : "Live system status is temporarily unavailable."}
                    </span>
                    {healthQuery.isError && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 text-xs"
                        onClick={() => healthQuery.refetch()}
                        data-testid="button-retry-system-health"
                      >
                        <RefreshCw className="mr-1 h-3 w-3" /> Retry
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Links */}
            <Card data-testid="card-quick-links">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Globe className="w-4 h-4 text-primary" /> Quick Links
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { icon: Users, label: "Personas", path: "/personas" },
                    { icon: Brain, label: "Memory", path: "/memory" },
                    { icon: BookOpen, label: "Knowledge", path: "/knowledge" },
                    { icon: Activity, label: "Heartbeat", path: "/heartbeat" },
                    { icon: Zap, label: "Skills", path: "/skills" },
                    { icon: FileText, label: "Files", path: "/files" },
                  ].map(({ icon: Icon, label, path }) => (
                    <button
                      key={path}
                      data-testid={`link-quick-${label.toLowerCase()}`}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      onClick={() => navigate(path)}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
