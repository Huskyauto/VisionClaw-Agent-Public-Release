import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { authFetch } from "@/lib/queryClient";
import {
  Bot, MessageSquare, Zap, Clock, TrendingUp, Plus, ArrowRight, Brain, Users,
  BookOpen, Database, Activity, CheckCircle2, XCircle, FileText, Code, Mail,
  Lightbulb, Car, Search, CalendarDays, BarChart3, Wrench, Sparkles, Shield,
  AlertTriangle, RefreshCw, Rocket, Globe, Target, PenTool, Briefcase,
  ChevronRight, Send, Loader2, Trash2, Settings2, Volume2, VolumeX, FolderOpen, ExternalLink
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Conversation, Skill, ConversationTemplate } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { ErrorState } from "@/components/error-state";
import OnboardingWelcome from "@/components/onboarding-welcome";
import UsageDashboard from "@/components/usage-dashboard";

const TEMPLATE_ICONS: Record<string, any> = {
  FileText, Code, Mail, Lightbulb, Car, Search, CalendarDays, BarChart3, Wrench, Sparkles, Bot, Brain, MessageSquare, BookOpen, Users,
};

interface Stats {
  totalConversations: number;
  totalMessages: number;
  totalMemories: number;
  activePersona: string | null;
  status: string;
  uptime: number;
}

interface HealthReport {
  overall: "healthy" | "degraded" | "down";
  checks: { name: string; category: string; status: string; message: string; latencyMs?: number }[];
  generatedAt: string;
  autoRemediations: string[];
}

interface HeartbeatLogEntry {
  id: number;
  taskName: string;
  status: string;
  personaName: string | null;
  durationMs: number | null;
  output: string | null;
  createdAt: string;
}

const PLAYBOOKS = [
  { id: "research", icon: Search, label: "Research a Topic", prompt: "Research the following topic and give me a comprehensive analysis:", color: "text-blue-500", bg: "bg-blue-500/10" },
  { id: "email", icon: Mail, label: "Draft an Email", prompt: "Help me draft a professional email:", color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { id: "social", icon: PenTool, label: "Social Media Post", prompt: "Create an engaging social media post for:", color: "text-violet-500", bg: "bg-violet-500/10" },
  { id: "analyze", icon: BarChart3, label: "Analyze Data", prompt: "Analyze the following data and provide insights:", color: "text-amber-500", bg: "bg-amber-500/10" },
  { id: "code", icon: Code, label: "Write Code", prompt: "Help me write code for:", color: "text-cyan-500", bg: "bg-cyan-500/10" },
  { id: "plan", icon: Target, label: "Create a Plan", prompt: "Create a detailed action plan for:", color: "text-rose-500", bg: "bg-rose-500/10" },
];

function StatusPulse({ status }: { status: "healthy" | "degraded" | "down" }) {
  const colors = {
    healthy: "bg-emerald-500",
    degraded: "bg-amber-500",
    down: "bg-red-500",
  };
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colors[status]} opacity-75`} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${colors[status]}`} />
    </span>
  );
}

function renderBoldText(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-foreground">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

function BriefingSpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const speak = useCallback(async () => {
    if (speaking) {
      abortRef.current?.abort();
      if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current = null; }
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    abortRef.current = new AbortController();
    let audioCtx: AudioContext | null = null;
    let worklet: AudioWorkletNode | null = null;
    try {
      const cleanText = text.replace(/[#*_~`]/g, "").replace(/\n{2,}/g, ". ").replace(/\n/g, " ");
      const res = await authFetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error("TTS failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "audio_mp3" && data.data) {
              const audio = new Audio(`data:audio/mpeg;base64,${data.data}`);
              audioElRef.current = audio;
              await audio.play();
              await new Promise<void>(r => { audio.onended = () => r(); });
            }
            if (data.type === "audio" && data.data) {
              if (!audioCtx) {
                audioCtx = new AudioContext({ sampleRate: 24000 });
                await audioCtx.audioWorklet.addModule("/audio-playback-worklet.js");
                worklet = new AudioWorkletNode(audioCtx, "audio-playback-processor");
                worklet.connect(audioCtx.destination);
              }
              const raw = atob(data.data);
              const int16 = new Int16Array(raw.length / 2);
              for (let i = 0; i < int16.length; i++) {
                int16[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
              }
              const float32 = new Float32Array(int16.length);
              for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
              worklet?.port.postMessage({ type: "audio", samples: float32 });
            }
            if (data.type === "done") {
              if (worklet) worklet.port.postMessage({ type: "streamComplete" });
            }
          } catch {}
        }
      }
      if (worklet) await new Promise(r => setTimeout(r, 2000));
      if (audioCtx) audioCtx.close();
    } catch (err: any) {
      if (err.name !== "AbortError") console.error("Briefing speak error:", err);
    } finally {
      setSpeaking(false);
    }
  }, [text, speaking]);

  return (
    <Button
      size="sm"
      variant={speaking ? "default" : "ghost"}
      className="h-7 text-xs gap-1"
      onClick={speak}
      data-testid="button-speak-briefing"
    >
      {speaking ? (
        <><VolumeX className="w-3 h-3" /> Stop</>
      ) : (
        <><Volume2 className="w-3 h-3" /> Listen</>
      )}
    </Button>
  );
}

export default function HomePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [showOnboarding, setShowOnboarding] = useState(false);
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
    apiRequest("POST", "/api/onboarding/seen").catch(() => {});
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
  const { data: health } = useQuery<HealthReport>({ queryKey: ["/api/health"], refetchInterval: 5 * 60 * 1000, ...retryOpts });
  const { data: convResult, isLoading: convsLoading } = useQuery<{ data: Conversation[]; total: number }>({ queryKey: ["/api/conversations"], ...retryOpts });
  const conversations = convResult?.data ?? [];
  const { data: settings } = useQuery<{ agentName: string; defaultModel: string }>({ queryKey: ["/api/settings"], ...retryOpts });
  const { data: templates = [] } = useQuery<ConversationTemplate[]>({ queryKey: ["/api/templates"] });
  const { data: recentLogs = [] } = useQuery<HeartbeatLogEntry[]>({ queryKey: ["/api/heartbeat/logs?limit=15"], refetchInterval: 30000 });
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
    <div className="h-full overflow-y-auto" data-testid="page-command-center">
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
                      {briefing.activeAgents.slice(0, 5).map((a) => (
                        <div
                          key={a.name}
                          className="w-7 h-7 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs"
                          title={`${a.name} — ${a.role}`}
                        >
                          {a.icon || a.name.charAt(0)}
                        </div>
                      ))}
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
                  `${briefing.greeting}. ${briefing.weather ? `It's ${briefing.weather.temp} degrees and ${briefing.weather.description} in ${briefing.weather.location || 'your area'}.` : ''} You have ${briefing.today.tasksCompleted} tasks completed today, ${briefing.today.conversations} conversations, and ${briefing.activeAgents.length} agents active.${briefing.today.topTasks.length > 0 ? ` Top tasks: ${briefing.today.topTasks.map(t => t.name).join(', ')}.` : ''}`
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
        <div className="grid gap-5 lg:grid-cols-5">

          {/* Left Column: Playbooks + Activity (wider) */}
          <div className="lg:col-span-3 space-y-5">

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
                  {corpReportUrl && (
                    <a href={corpReportUrl} target="_blank" rel="noopener noreferrer" data-testid="link-corp-report-download">
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

            {driveFolder?.rootUrl && (
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
                  <a href={driveFolder.rootUrl} target="_blank" rel="noopener noreferrer" data-testid="link-drive-folder">
                    <Button size="sm" className="h-7 text-xs gap-1">
                      <FolderOpen className="w-3 h-3" /> Open Drive <ExternalLink className="w-3 h-3" />
                    </Button>
                  </a>
                </CardContent>
              </Card>
            )}

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
          <div className="lg:col-span-2 space-y-5">

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
            {health && (
              <Card data-testid="card-system-health">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" /> System Health
                  </CardTitle>
                </CardHeader>
                <CardContent>
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
                  </div>
                  {health.autoRemediations.length > 0 && (
                    <div className="mt-2 text-[10px] text-emerald-500">
                      Auto-fixed: {health.autoRemediations.join(", ")}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

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
