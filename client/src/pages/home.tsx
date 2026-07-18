import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { authFetch } from "@/lib/queryClient";
import {
  Bot, MessageSquare, Zap, Clock, TrendingUp, Plus, ArrowRight, Brain, Users,
  BookOpen, Database, Activity, CheckCircle2, XCircle, FileText, Code, Mail,
  Lightbulb, Car, Search, CalendarDays, BarChart3, Wrench, Sparkles, Shield,
  AlertTriangle, RefreshCw, Rocket, Globe, Target, PenTool, Briefcase,
  ChevronRight, ChevronDown, Send, Loader2, Trash2, Settings2, Volume2, VolumeX, FolderOpen, ExternalLink, Crown, Map
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
import { safeUrl } from "@/lib/safe-url";
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
  const { data: attentionEvents = [] } = useQuery<Array<{ id: number; event_type: string; source: string; salience_score: string | number | null; salience_meta: any; data: any; created_at: string; status: string }>>({ queryKey: ["/api/events/log?limit=20"], refetchInterval: 15000 });
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

        {/* R125+137.29 (2026-07-17) — NEW (violet): release window R125+137.26 → +137.29-review — Kimi-K3 frontier reserve; Kimi-K3 external-review triage (owner-email de-hardcode across all server runtime paths); mirror stats fail-closed + any-budget ratchet Pass 14; changelog-as-data updates.json + mirror schema-snapshot.sql + tag-mirror-release; 72h review closed 3 MEDIUMs + 4 regression pins. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_137_29")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/15 via-primary/5 to-transparent border border-violet-500/40 hover:border-violet-500/60 hover:bg-violet-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_137_29"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+137.29 NEW</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_137_29") ? "" : "line-clamp-2"}`}>{"R125+137.29 — **Release window R125+137.26 → +137.29-review: an external frontier-model code review is triaged end-to-end — the hardcoded owner email is purged from every server runtime path, the changelog becomes data, the public mirror gains a DDL schema snapshot, a fail-closed stats refresh, tagged GitHub Releases and an `: any` ratchet gate, Kimi-K3 lands as a frontier reserve, and a 72h review closes 3 MEDIUMs with permanent regression pins.** **R125+137.26 — Kimi-K3 frontier RESERVE:** `moonshotai/kimi-k3` (1M context) registered in all 5 model maps but NOT in the standing proposer set — a new pure `shouldFireFrontierReserve` gate fires at most ONE backfill call, only when a main-round frontier proposer fails on the metered path (never for cheap/mixed/polarity pools, explicit proposer sets, metered-off, total failure, or duplicate ids; 9/9 gate tests). **R125+137.27 — Kimi-K3 external-review triage:** the review ran against the public mirror and every finding was re-verified on main; the hardcoded owner email is now removed from ALL server runtime paths — policy-engine owner-default seeding is env-driven with a loud warn + fail-closed skip when unconfigured, the inbox-quarantine allowlist is env-only, inbox/ideabrowser ingest identity comes from a new `GMAIL_INGEST_ADDRESS` env (fails closed loudly when unset), the security.txt Contact chain is env-driven, and the policy seed script refuses to seed without an owner email. **R125+137.28 — mirror stats fail-closed + `: any` ratchet:** the public-mirror build now refreshes the authoritative platform-totals doc BEFORE the mirror copy and fails closed if it is still dirty (the mirror's count doc can no longer ship stale), and a new ratchet-DOWN-only `: any`/`as any` budget gate (baseline 6,949; fail-closed on malformed config) runs as weekly-maintenance Pass 14. **R125+137.29 — changelog-as-data + mirror DDL snapshot + tagged releases:** the 190-entry / 1,044-highlight changelog extracted to `updates.json` (icons as string names over a 42-icon map — the page shrinks to 197 lines), the mirror build emits a `schema-snapshot.sql` via pg_dump so forkers can diff DDL between snapshots, and a new tag-mirror-release script stamps every mirror push with a `r125.137.x` tag + GitHub Release. **R125+137.29-review — 72h whole-app review (2 architect rounds):** 3 MEDIUM closed fail-closed — the api-v1 conversation-messages query re-anchored on a tenant-scoping JOIN + tenant filter, the tag-mirror-release CLI now rejects unknown flags with exit 1 BEFORE any GitHub tag/release call, and the any-budget gate exits fail-closed on an unreadable scan file with the baseline config byte-untouched — plus 4 permanent regression pin tests registered in the canonical suite (144/144)."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_137_29") ? "" : "truncate"}`}>{"**396 tools**, **129 capabilities**, **43 (.agents) + 62 (db) + 38 (output-skills) = 143 reference surfaces**, **16 personas**, **213 tables**, **627 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+137.26 → +137.29-review ship the Kimi-K3 frontier reserve, the owner-email de-hardcode, the mirror's fail-closed stats refresh + DDL snapshot + tagged releases, changelog-as-data, the `: any` ratchet gate, and a 72h review closing 3 MEDIUMs with 4 regression pins. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_137_29") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+137.25 (2026-07-16) — DEMOTED (rose): release window R125+137.23 → +137.25-review — Tool Eviction/Retirement loop + Tool Forge Phase 2; Claude-Fable PIN-hash consolidation + seed.ts re-downgrade fix; tool-router hard cap (enforceToolCap); AG-UI protocol adapter POST /api/v1/agui/run; 72h review closed 2 MEDIUMs (stripe-checkout log leak + agui-scope-parity test bypass). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_137_25")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/15 via-primary/5 to-transparent border border-rose-500/40 hover:border-rose-500/60 hover:bg-rose-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_137_25"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+137.25</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_137_25") ? "" : "line-clamp-2"}`}>{"R125+137.25 — **Release window R125+137.23 → +137.25-review: the platform learns to retire its own dead tools and forge new ones from unmet demand, the tool-router gains a hard cap, an AG-UI protocol adapter opens the public API to standard agent-UI clients, and a 72h whole-app review closes 2 MEDIUMs.** **R125+137.23 — Tool Eviction/Retirement loop + Tool Forge Phase 2:** a flag-only eviction classifier with HITL approvals — exemptions fail CLOSED via a strict `parseExemptions`, a registry sanity guard, and a ≤10-candidates/run dedupe (20 candidates queued across the first 2 runs of 30 classified) — plus Tool Forge Phase 2: `capability_gaps` demand now drives budget-claimed LLM module proposals into `data/tool-forge/proposals/` (≤1/run, nothing ever auto-lands); both wired as weekly heartbeat crons (Tue 11:00/11:30 UTC). **R125+137.23-fable — Claude-Fable external-review follow-ups:** the admin-drive-upload PIN check consolidated onto the exported peppered `verifyAdminPinPlaintext`, and seed.ts's boot re-stamp switched to the canonical peppered `hashPin` — it had been silently re-downgrading the stored hash to the public static salt on every boot; a static guard test now pins the salt literal to auth.ts only. **R125+137.24 — tool-router hard cap (verified external-review finding):** `routeTools()` could add whole categories with no slice-back past `maxTools`; a new pure `enforceToolCap()` now trims by priority order at BOTH overshoot sites (persona pre-filter + main routed path), never trims ALWAYS_INCLUDE, leaves escape hatches deliberately uncapped, and logs per-turn `capTrim` + a schema-token estimate (invariant tests in the suite). **R125+137.25 — AG-UI protocol adapter:** `POST /api/v1/agui/run` on the public API v1 surface (vc_* Bearer, chat scope) replays a completed chat turn as ordered AG-UI SSE events (RUN_STARTED → TOOL_CALL_* → TEXT_MESSAGE_* → RUN_FINISHED/RUN_ERROR) — pure event builders, fail-closed `vc-conv-<id>` thread parsing, tenant-scoped continuation, 4000-char tool-result cap, keepalives + timeout race + client-disconnect skip (the turn still persists for the poll endpoint); a static scope-parity guard test pins every mounted api-v1 POST to an auth rule. **R125+137.25-review — 72h whole-app review (2 architect rounds):** closed MEDIUM stripe-checkout catch logging raw Stripe error objects (now message+type/status/requestId only) and MEDIUM agui-scope-parity test bypassability (rewritten to a structural comment-stripped SCOPE_RULES parse with first-match-wins semantics mirroring the runtime checker — commented-out rules, stray literals, and shadowing admin rules now all fail the guard). Gates: tsc 0, preflight-stale-strings CLEAN, seamtests 68/68, suite 143/143, wiring audit CLEAN."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_137_25") ? "" : "truncate"}`}>{"**396 tools**, **129 capabilities**, **43 (.agents) + 62 (db) + 38 (output-skills) = 143 reference surfaces**, **16 personas**, **213 tables**, **627 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+137.23 → +137.25-review ship the Tool Eviction loop + Tool Forge Phase 2, PIN-hash consolidation, the tool-router hard cap, the AG-UI protocol adapter, and a clean 72h review closing 2 MEDIUMs. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_137_25") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+137.22 (2026-07-15) — DEMOTED (rose): release window R125+137.20 → +137.22 — Drive connector-lookup fallback fix; Fable-method borrows (seeded-fraud judge fixtures + spec-vs-test authority rule); OpenClaw borrow: 6 native features (commitments miner, summary-quality audit + deterministic fallback, operator-text untrusted wrapping, first-failure-wins rootCause, skill code-safety scanner, egress telemetry); 72h review closed findings + 1 FALSE POSITIVE. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_137_22")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/15 via-primary/5 to-transparent border border-rose-500/40 hover:border-rose-500/60 hover:bg-rose-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_137_22"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+137.22</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_137_22") ? "" : "line-clamp-2"}`}>{"R125+137.22 — **Release window R125+137.20 → +137.22: six OpenClaw-inspired native features land, the deliverable-fraud judge gains seeded adversarial proof, and a Drive connector-lookup bug that broke backups is cured.** **R125+137.20 — Drive connector-lookup fix:** the Google connector lookup now falls back to the unfiltered connection list when the filtered query returns 0 items — curing features-doc 401s, memory-backup upload failures, and drive-backfill reconnect errors (verified live). **R125+137.21 — Fable-method borrows:** seeded-fraud completion fixtures in CI prove the deterministic verification layer fails CLOSED against a deliberately gullible judge (live probe caught 4/4 planted frauds), and a spec-vs-test authority rule in the repo-surgeon forces `cannotFix` on any spec/test conflict — authoritative at the executor, pinned by an adversarial regression test. **R125+137.22 — OpenClaw borrow, 6 native features:** a tenant-guarded, PII-redacted, race-safe commitments/open-loop miner (unique partial index + ON CONFLICT); a summary-quality audit + deterministic fallback (now wired as an identifier-recovery backstop at the compaction chokepoint — a failed compaction can no longer silently lose literal anchors); operator-text-as-untrusted wrapping; first-failure-wins health rootCause ordering in `check_system_status`; a skill code-safety scanner; and a record-only egress telemetry ring buffer. The follow-up 72h post-edit review wired the summary-quality lib into runtime, added Zod `validate()` schemas to the public Stripe checkout POST and tenant profile PATCH routes, resynced stale marketing stats (627 indexes, 396 tools), and logged 1 FALSE POSITIVE (the flagged `check_system_status` cross-tenant reads are already admin-tenant-gated at dispatch)."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_137_22") ? "" : "truncate"}`}>{"**396 tools**, **129 capabilities**, **43 (.agents) + 62 (db) + 38 (output-skills) = 143 reference surfaces**, **16 personas**, **213 tables**, **627 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+137.20 → +137.22 ship six OpenClaw-inspired native features, seeded-fraud judge proof + spec-vs-test authority, the Drive connector-lookup fix, and a clean 72h review with 1 FALSE POSITIVE logged. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_137_22") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+137.19 (2026-07-14) — DEMOTED (rose): release window R125+137.14 → +137.19 — RULER third judge lane + prior-collapse detection in the self-improvement loop; routes Tier-1 split + sandbox blocklist not-load-bearing proof; tools split S34 (295/395); Tool Forge Phase 1 unmet-capability telemetry + health card; 72h review closed 1 MEDIUM (tenant-validated capability-gap writes) + 4 silent-failure fixes, no CRITICAL/HIGH. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_137_19")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/15 via-primary/5 to-transparent border border-rose-500/40 hover:border-rose-500/60 hover:bg-rose-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_137_19"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+137.19</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_137_19") ? "" : "line-clamp-2"}`}>{"R125+137.19 — **Release window R125+137.14 → +137.19: the self-improvement loop gains an anti-rut memory and a third judge lane, unmet demand becomes durable telemetry, two god-file splits land behavior-preserving, and a 72h review closes 1 MEDIUM fail-CLOSED with no CRITICAL/HIGH findings.** **R125+137.14 — RULER group ranking:** a measure-first NON-blocking third judge lane in the skill-optimizer's BINEVAL evaluator A/B — one anonymized, seed-shuffled group-ranking LLM call per case with a tie-excluded win rate; parsing fails CLOSED to null, runtime fails OPEN, never touches the apply decision; kill switch `SKILL_OPT_RULER=off`; 16/16 pure tests. **R125+137.15 — prior-collapse detection** (the one borrow from the Bilevel Autoresearch paper — \"two loops watching each other\"): an embedding-space near-dupe tracker over prior failed/rejected proposals (cosine threshold clamped, FIFO-bounded, kill switch `PRIOR_COLLAPSE=off`), fail-OPEN on every path incl. call-site seam wrappers so even a THROWING injected tracker can't block a loop (pinned by throwing-tracker regression tests in BOTH hosts); wired OPT-IN into the skill-optimizer (semantic near-dupe of a rejected edit skips val-scoring spend + a PRIOR-COLLAPSE perturbation directive rides the next propose) and the repo-surgeon (near-identical re-proposal of a FAILED diff skips apply/verify and escalates on the final attempt); 70/70 targeted tests. **R125+137.16 — routes Tier-1 split + blocklist proof:** auth/tenants/admin endpoints extracted verbatim from `server/routes.ts` (≈7,794 → 7,329 lines, behavior-preserving architect PASS) + a regression proof that keyword-free sandbox-escape probes fail closed WITHOUT the blocklist string — the VM layer is the real control, the regex is defense-in-depth only. **R125+137.17 — tools split S34:** `google_workspace` migrated into `server/tools/domains/google-workspace/` with the IDENTICAL fail-closed tenant guard read from trusted ctx; `tools.ts` 9,785 → 9,668 lines; 295/395 migrated; girth ceiling ratcheted DOWN. **R125+137.18 — Tool Forge Phase 1 (observability only):** unmet-capability demand FOLDED into the existing `capability_gaps` table (atomic `miss_count`+`last_seen_at` bump, insert-race safe) + a tenant-scoped Unmet Capabilities probe and card on /admin/ecosystem-health; architect FAIL→fixed — the probe's terminal-state set now matches the dedup index (`resolved`/`safety_blocked` ONLY) so repeat demand can never be absorbed invisibly; runtime-verified end-to-end. **R125+137.19 — 72h review (3 architect prongs):** 1 MEDIUM fail-CLOSED — autonomous capability-gap writes now pass a tenant-validation helper before ANY insert — plus tenant-isolation-audit unreadable-file accounting wired end-to-end (coverage denominator, degraded banner, exit-cause, double-count fix), prior-collapse degraded fields surfaced, email-flush failures log the full stack. Gates: tsc 0, build 0, seam 68/68, suites green, architect PASS. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_137_19") ? "" : "truncate"}`}>{"**396 tools**, **129 capabilities**, **43 (.agents) + 62 (db) + 38 (output-skills) = 143 reference surfaces**, **16 personas**, **213 tables**, **626 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+137.14 → +137.19 ship RULER group ranking + prior-collapse detection in the self-improvement loop, two behavior-preserving god-file splits, Tool Forge Phase 1 unmet-capability telemetry, and a clean 72h review (1 MEDIUM fail-CLOSED, no CRITICAL/HIGH). _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_137_19") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+137.13 (2026-07-12) — DEMOTED (rose): release window R125+137.4 → +137.13 — Action Ledger S1–S5 shipped end-to-end (action_attempts table, tables 212→213; prepare→dispatch→settle middleware; ALS idempotency keys + Stripe reconciler; S4 abort-signal threading + send_email opt-in; S5 proven-safe timeout retry with kill switch); Claude CLI bridge on the official Agent SDK; Sol mirror-review gaps A+B; BWB weekly recap correct-by-default; 72h review closed 1 MEDIUM + 2 LOW. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_137_13")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/15 via-primary/5 to-transparent border border-rose-500/40 hover:border-rose-500/60 hover:bg-rose-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_137_13"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+137.13</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_137_13") ? "" : "line-clamp-2"}`}>{"R125+137.13 — **Release window R125+137.4 → +137.13: the Action Ledger ships end-to-end (S1–S5) — a durable, tenant-scoped prepare→dispatch→settle ledger for destructive tool actions with unforgeable Stripe idempotency threading, a verify-probe reconciler, and proven-safe timeout retry — plus the Claude CLI bridge migrated to the official Agent SDK, Sol mirror-review gaps closed, and the BWB weekly recap made correct-by-default.** **R125+137.9 — Action Ledger S1 (`action_attempts` table, tables 212 → 213):** state machine prepared→executing→committed/failed/unknown→compensated enforced via guarded UPDATE `state=ANY(from)` so concurrent settlers can't double-settle; deep-sorted sha256 arg hashing + deterministic `vc-al1-` idempotency keys (a retry is a NEW row reusing the SAME key); every DB helper throws on tenantId≤0 BEFORE any query. **R125+137.10 — S2 middleware:** `withActionLedger` at the dispatcher seam — RECORD-ONLY prepare→dispatch→settle for ledger-mandatory destructive tools; prepare fails CLOSED, classification fails OPEN. **R125+137.11 — S3 idempotency + reconciler:** ALS-threaded idempotency keys set ONLY by the middleware after the prepare write (unforgeable) + `withLedgerIdempotency()` Stripe helper (explicit key ALWAYS wins) + a 6-hourly reconciler resolving `unknown` attempts via Stripe verify probes — probe errors stay `unknown`, NEVER `failed`; unresolvable → owner digest; fail-closed static guard: money-movement Stripe mutations (incl. `checkout.sessions`) can NEVER be grandfathered without idempotency keying. **R125+137.12 — S4:** advisory AbortSignal ALS threading (set only by the timeout executor — no caller-supplied channel exists) + sensitive opt-in ledgering for `send_email` + a sent-mail verify probe searching the stamped idempotency-key header. **R125+137.13 — S5 proven-safe timeout retry:** retry RE-ENABLED but ONLY for ledgered+probed tools — reconcile FIRST (grace-poll the ledger row, THEN the provider probe); retry ONLY on proven non-commit; a confirmed commit raises a loud \"commit CONFIRMED — Do NOT retry\" error; unknown/probe-throw escalates to the reconciler, NEVER retries; the retry reuses the SAME idempotency key via an unforgeable ALS retry directive; kill switch `AL_TIMEOUT_RETRY=0`; retry decision-table 16/16 incl. the commit-during-grace no-double-execution case. **R125+137.7 — Claude CLI bridge on the official SDK:** migrated to `@anthropic-ai/claude-agent-sdk` `query()` (same `claude` subprocess + Max-plan billing lane, HTTP surface unchanged); architect blocking finding fixed — empty/error streaming results can no longer end as a success-looking `[DONE]`. **R125+137.8 — Sol mirror-review gaps A+B:** live degrading-trajectory replanning in the plan executor (bounded, fires once/plan, fail-soft) + the completion evaluator now emits `completed_unverified` when the judge is degraded AND consequential tools fired (both subagent and CEO paths). **R125+137.4 → +137.6 — BWB weekly recap correct-by-default:** jobKey window-collision fix (fail-closed on unparseable dates), stale-checkpoint purge knob, and an auto-pinned Sun–Sat window so every run is window-pinned + window-keyed. **72h review:** 1 MEDIUM closed (a swallowed rollback-claim failure in the transactional snapshot now logs loud) + 2 LOW (metrics logging). Gates: ledger 46/46, retry 16/16, middleware 28/28, suite 135/135, seam 68/68, tsc 0, build 0, architect PASS on every slice (the one deferred nit closed same-day). _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_137_13") ? "" : "truncate"}`}>{"**396 tools**, **129 capabilities**, **43 (.agents) + 62 (db) + 38 (output-skills) = 143 reference surfaces**, **16 personas**, **213 tables**, **626 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+137.4 → +137.13 ship the Action Ledger S1–S5 (durable prepare→dispatch→settle for destructive actions, Stripe idempotency + reconciler, proven-safe timeout retry), migrate the Claude CLI bridge to the official Agent SDK, close Sol mirror gaps A+B, and make the BWB weekly recap correct-by-default. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_137_13") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+137.3 (2026-07-11) — DEMOTED (indigo): release window R125+134 → +137.3 — Grok 4.5 wired (additive); pricing-accuracy campaign (drift-guard test + live OpenRouter reconciliation + 2 ledger gaps); PROOF_LOOPS v2 (proof-level L1–L5 + Chronicle precision); full wiring review (smoke catalog 396/396, domain-doc parser fix); full-platform post-edit review — 1 CRITICAL tenant-scoped rollback fix + 1 MEDIUM flagship pricing gap closed. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_137_3")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-indigo-500/15 via-primary/5 to-transparent border border-indigo-500/40 hover:border-indigo-500/60 hover:bg-indigo-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_137_3"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-indigo-600 text-white leading-none shrink-0 mt-0.5">R125+137.3</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_137_3") ? "" : "line-clamp-2"}`}>{"R125+137.3 — **Release window R125+134 → +137.3: Grok 4.5 wired in, a pricing-accuracy campaign (drift guard + live-rate reconciliation), PROOF_LOOPS v2, a full wiring review that un-darked 302 tool docs, and a full-platform post-edit review closing 1 CRITICAL + 1 MEDIUM fail-closed.** **R125+137.3 — full-platform post-edit review (3 architect surface passes + silent-failure-hunter LLM pass + regex hunter + wiring audit CLEAN):** **CRITICAL (tenant isolation, architect-verified)** — the transactional no-regression snapshot's rollback UPDATE was missing `AND tenant_id`: the safety net that undoes a failed irreversible tool action could have written its rollback across tenant boundaries; the rollback is now tenant-scoped like every other write. **MEDIUM** — `gpt-5.6-sol` (the platform default flagship since the Sol promotion) was absent from ALL 3 pricing maps — insights silently billed it at $0 while the cost ledger fell back to a $5/$5 unknown-model rate; flagship-class $2.5/$15 rows added to cost-ledger, resource-predictor, and insights-engine + a presence regression test (cost tests 6/6). FALSE POSITIVE logged: a \"missing persona-contract text\" flag — the block lives in the imported `PLATFORM_TOOLS_CONTRACT` single source of truth. **R125+137.2 — full wiring review:** the smoke-test catalog was silently stale at 395 (`--status` never re-scans) AND the static-doc parser was blind to standalone domain-file `ToolDefinition` consts (302 tools doc-dark after the tools-layer split) → parser fixed, manifest regenerated 396/396, `toolsWithoutStaticDoc` = 0. **R125+137 / +137.1 — PROOF_LOOPS v2 + wiring-gate hardening:** per-run proof-level knob L1–L5 (advisory, default L2 = byte-identical prior behavior) + Chronicle-precision telemetry card on /admin/ecosystem-health; post-edit review now asks a mandatory wiring trigger question (root cause: `proofLevel` shipped with 0/16 persona docs despite audit CLEAN). **R125+136 / +135 — pricing locked to reality:** a drift-guard test static-parses the 3 pricing maps and fails on any NEW cross-map disagreement (KNOWN_DRIFT allowlist with a heal-ratchet); all drift ids then resynced to live OpenRouter rates — 2 real ledger gaps fixed (gpt-5-mini billed at 20×, glm-5.1 at $0) + presence-assertion tests, cost tests 31/31. **R125+134 — Grok 4.5 wired in (additive):** verified live on api.x.ai + OpenRouter (500K ctx, $2/$6, reasoning model) and registered via OpenRouter; deliberately NOT swapped into router defaults — `grok-4.20-multi-agent` stays the orchestration workhorse; the $0 cost policy still substitutes the free lane. Gates: tsc 0, build 0, suite green, wiring CLEAN, architect PASS after fixes. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_137_3") ? "" : "truncate"}`}>{"**396 tools**, **129 capabilities**, **43 (.agents) + 62 (db) + 38 (output-skills) = 143 reference surfaces**, **16 personas**, **212 tables**, **623 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+134 → +137.3 wire Grok 4.5, lock pricing to live rates with a permanent drift guard, ship proof-level L1–L5 + Chronicle-precision telemetry, regenerate the smoke catalog 396/396, and close 1 CRITICAL (tenant-scoped rollback) + 1 MEDIUM (flagship pricing) fail-closed. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_137_3") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+133 (2026-07-10) — DEMOTED (teal): release window R125+131 → +133 — GPT-5.6 Sol flagship promotion; Grok mirror-triage quintet (domain-boundary CI gate, coverage reporting, fail-closed Prometheus /metrics, lite deploy profile, Mermaid architecture diagrams); post-edit security sweep with 6 fail-closed fixes incl. trust-reviewer reserved-category block + tool-learning revert-deletes-row (architect-caught). Architect PASS. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_133")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-teal-500/15 via-primary/5 to-transparent border border-teal-500/40 hover:border-teal-500/60 hover:bg-teal-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_133"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-teal-600 text-white leading-none shrink-0 mt-0.5">R125+133</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_133") ? "" : "line-clamp-2"}`}>{"R125+133 — **Release window R125+131 → +133: GPT-5.6 Sol flagship, five ops/observability hardening items, and a post-edit security sweep with 6 fail-closed fixes.** **R125+133 — post-edit code-review sweep (whole-app + sensitive areas + 72h):** **HIGH #1 (defense-in-depth)** — the trust-reviewer's `clean_memory_op` auto-approve lane could green-light writes into reserved knowledge categories (e.g. `messaging_pairing`), stacking a second approval path on top of the R125+130 storage chokepoint; auto-approve now BLOCKS reserved categories outright. **HIGH #2 (architect-caught in verification)** — `tool-learning`'s `tryAndRevert` had two early \"reverted\" return branches (test-generation failure, zero test cases) that reported reverted but left the just-inserted `custom_tools` row ACTIVE — unvalidated LLM-generated tool code stayed callable; every revert path now deletes the row via a shared `revertToolRow` helper, and unvalidatable tools fail CLOSED. **MEDIUM ×3:** self-heal drops `allowSystemFallback` and requires a positive-integer tenantId (throws otherwise); `IStorage.createKnowledge`/`updateKnowledge` signatures now carry the `allowReservedCategory` opts so the interface can't drift from the enforcing implementation; 6 security test files that existed but were NOT in the canonical suite are now wired into `tests/run.sh` (guard test 8/8). **R125+132 — Grok mirror-triage quintet:** domain-boundary CI gate (static import scan across 219 files / 73 domains, non-literal dynamic import fails closed, wired as a suite preflight); coverage reporting over the canonical suite; Prometheus `/metrics` endpoint that fails CLOSED to 404 when `METRICS_TOKEN` is unset or mismatched (timing-safe compare, per-query try/catch so a broken gauge can never 500 the scrape, 4/4 contract tests incl. mount-order-before-CSRF); lite deploy profile `.env.core.example`; Mermaid architecture diagrams for the Memory V2/MNEMA write path + chunk-and-parallel orchestration. **R125+131 — GPT-5.6 Sol flagship:** verified live against api.openai.com and promoted across ~28 files (MoA proposers/aggregator, auto-router rosters, CEO orchestrator, chat engine); `gpt-5.5` demoted to fallback; $0-cost policy still substitutes the free lane outside the cost-exempt flagship lane. Gates every round: tsc 0, build 0, seam 67/67, wiring CLEAN, suite 126/0, architect FAIL → fixed → PASS. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_133") ? "" : "truncate"}`}>{"**396 tools**, **129 capabilities**, **43 (.agents) + 62 (db) + 38 (output-skills) = 143 reference surfaces**, **16 personas**, **212 tables**, **623 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+131 → +133 promote GPT-5.6 Sol, land 5 ops/observability items (metrics, CI gates, coverage, lite profile, diagrams) and close 2 HIGH + 3 MEDIUM fail-closed. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_133") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+130 (2026-07-09) — DEMOTED (amber): security-hardening window R125+127 → +130 — 4 HIGH closed fail-CLOSED (uploads cross-tenant read/enumeration; agent_knowledge PII-redaction bypass ×8 raw INSERT sites; browser-tool SSRF TOCTOU via CDP request interception; cross-tenant SMS/WhatsApp pairing hijack blocked at the storage chokepoint) + Evidence Docket tool (tools 395→396) + 4 MEDIUM + 3 new CI guards. Architect PASS on every round. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_130")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/15 via-primary/5 to-transparent border border-amber-500/40 hover:border-amber-500/60 hover:bg-amber-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_130"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+130</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_130") ? "" : "line-clamp-2"}`}>{"R125+130 — **Security-hardening window R125+127 → +130: 4 HIGH closed fail-CLOSED + the new portable Evidence Docket (tools 395 → 396).** **R125+130 HIGH — cross-tenant SMS/WhatsApp pairing hijack:** any tenant-agent could plant a `messaging_pairing` agent-knowledge row (mapping an inbound phone/channel → tenantId,conversationId) via `create_knowledge` or a category-PATCH and hijack another tenant's inbound messages. Closed at the storage chokepoint — `storage.createKnowledge` AND `storage.updateKnowledge` now fail closed (throw) on a reserved category unless explicitly allowed; +3 MEDIUM PII-redaction / tenant-guard fixes and an 8-assertion CI guard. **R125+129 — Evidence Docket:** new `generate_evidence_docket` tool bundles goal contracts, completion-verification verdicts, jury κ concordance, intent-gate/tool-block audit rows, delivery record, and a step-ledger replay pointer into one reviewer-facing artifact — tenant-scoped on EVERY query, secrets/SSN/credit-cards scrubbed from every free-text value; 15/15 tests. **R125+128 HIGH — browser-tool SSRF TOCTOU CLOSED:** CDP request interception aborts private-IP hosts / blocked hostnames / non-http(s) schemes on every request and re-runs the full DNS-validated policy check on every navigation (initial goto, each redirect hop, client-side navs), failing CLOSED on guard error; 7-assertion CI guard. **R125+127 HIGH ×2:** uploads cross-tenant read/enumeration (tenant-ownership gate bound to canonical tenant-scoped file records only) + agent-knowledge PII-redaction bypass (8 raw INSERT sites now redact objects BEFORE stringify); + Twilio webhook MessageSid replay dedupe. tsc 0, build 0, seam 67/67, wiring CLEAN, architect PASS on every round. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_130") ? "" : "truncate"}`}>{"**396 tools**, **129 capabilities**, **43 (.agents) + 62 (db) + 38 (output-skills) = 143 reference surfaces**, **16 personas**, **212 tables**, **623 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+127 → +130 close 4 HIGH + 4 MEDIUM fail-closed and add the Evidence Docket tool (395 → 396) + 3 new CI security guards. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_130") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+125 (2026-07-07) — DEMOTED (sky): 72h post-edit security review over the tools-layer-split window (S24–S33); 1 HIGH (list_uploads cross-tenant data/ filename disclosure — admin-gated + explicit source-tag mapping) + 4 MEDIUM fail-closed (background×3 + treasury×2 tenant guards; weekly-maintenance Pass 13 girth-gate catch→RED). Tool count 394→395 (+aeo_score); 294/395 tools migrated into server/tools/ domains. Architect confirming PASS. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_125")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-sky-500/15 via-primary/5 to-transparent border border-sky-500/40 hover:border-sky-500/60 hover:bg-sky-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_125"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-sky-600 text-white leading-none shrink-0 mt-0.5">R125+125</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_125") ? "" : "line-clamp-2"}`}>{"R125+125 — **72h post-edit security review: 1 HIGH + 4 MEDIUM closed fail-CLOSED across the tools-layer-split window (slices S24–S33, ~230 files).** **HIGH — `list_uploads` cross-tenant information disclosure:** the file-listing handler unconditionally enumerated the internal `data/` directory into ANY tenant's listing, and derived path/url by re-probing the filesystem so a name collision between `uploads/` and `data/` could map a file to the wrong location. Fixed: `data/` enumeration is now admin-tenant-only and every entry carries an explicit `source` tag that path/url derivation reads directly — a second confirming architect pass verified the residual collision vector is closed. **MEDIUM ×4:** fail-closed tenant guards (`typeof tenantId !== \"number\" || tenantId <= 0`) added to `run/check/list_background_tasks` and the two treasury handlers (`forecast_ticker`, `analyze_portfolio`); weekly-maintenance Pass 13 now returns RED + a HIGH finding when the god-file girth gate itself throws (was a silent YELLOW). One MEDIUM deferred + logged (browser-replay's direct Browserless fetch — fixed env-configured host, no user-controlled URL). Also lands the tools-layer-split march R125+77 → +124: 294/395 tools migrated out of the legacy `tools.ts` monolith into per-domain modules with the fail-closed tenant seam preserved verbatim; tool count 394 → 395 (+`aeo_score`); girth ceiling ratcheted down every slice. tsc 0, build 0, seam tests 67/67, wiring 0 dead/0 drift, architect confirming PASS. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_125") ? "" : "truncate"}`}>{"**395 tools**, **129 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **212 tables**, **623 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+125 closes 1 HIGH + 4 MEDIUM fail-closed in the migrated tools surface; 294/395 tools now live in per-domain modules. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_125") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+76 (2026-07-01) — DEMOTED (rose): whole-app post-edit review; 2 MEDIUM + 2 LOW closed fail-CLOSED in the deliverable-verifier + storage-redaction + memory-ranking surface. Required-MIME check now fails CLOSED on an undeterminable type; verifier surfaces an auditPersisted flag so a swallowed audit-log write is visible; redaction guard honors its string contract on non-string input; stale memory-ranking default-comment corrected. Architect confirming PASS. No stat change. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_76")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/15 via-primary/5 to-transparent border border-rose-500/40 hover:border-rose-500/60 hover:bg-rose-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_76"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+76</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_76") ? "" : "line-clamp-2"}`}>{"R125+76 — **Whole-app post-edit code review: 2 MEDIUM + 2 LOW closed fail-CLOSED in the deliverable-verifier + storage-redaction + memory-ranking surface.** **MEDIUM #1 — the required-MIME verifier gate silently PASSED an undeterminable type:** `server/deliverable-verifier.ts` only ran the `requiredMimePattern` check when a MIME could be inferred from the file extension, so a MIME-gated deliverable whose extension yielded no MIME slipped through as a PASS. An undeterminable MIME on a MIME-gated contract is now a verification FAILURE. **MEDIUM #2 — a swallowed audit-log write was reported as if durable:** the verifier's audit-log persistence was best-effort and its failure was swallowed while the result still returned as though the check were recorded (a repudiation gap); the result now carries an `auditPersisted` boolean (true on insert, false in the catch) so a persistence failure is visible instead of silently claimed. **LOW #1 — the redaction guard broke its own type contract:** `server/storage-helpers/pii-redaction-guard.ts` returned the raw value on a non-string / empty input, violating the declared string return contract; it now coerces non-string input to a string. **LOW #2 — a stale default-comment:** `server/memory-ranking.ts` described the exploration bonus as OFF by default when the live default is ON (`mode: bonus`); corrected. tsc 0, PII-guard tests 15/15, architect confirming PASS. No new declared tools / tables / personas / capabilities, no stat change. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_76") ? "" : "truncate"}`}>{"**394 tools**, **129 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **212 tables**, **623 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+76 closes 2 MEDIUM + 2 LOW in the deliverable-verifier / storage-redaction / memory-ranking surface fail-closed; no new declared tools / tables / personas / capabilities, no stat change. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_76") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+75 (2026-06-29) — DEMOTED (teal): whole-app + 72h review (agent-wiring audit exit 0, 394 tools, 0 dead/drift/leak/schema-gap), 3 pre-existing MEDIUMs closed fail-CLOSED in the tenant-isolation + silent-failure surface (guarded-tool-executor tenant from ctx only; event-bus event_log status writes tenant-scoped; heartbeat failed-event update logs loud + tenant-scoped); live-stat resync tables 211→212, indexes 620→623. Architect confirming PASS. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_75")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-teal-500/10 via-primary/5 to-transparent border border-teal-500/30 hover:border-teal-500/50 hover:bg-teal-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_75"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-teal-600 text-white leading-none shrink-0 mt-0.5">R125+75</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_75") ? "" : "line-clamp-2"}`}>{"R125+75 — **Whole-app + 72h post-edit code review (agent-wiring audit exit 0: 394 tools, 0 dead/drift/leak/schema-gap): 3 pre-existing MEDIUMs closed fail-CLOSED in the tenant-isolation + silent-failure surface.** **MEDIUM #1 — the central guarded-tool executor could take its tenant scope from a model-authored arg:** server/guarded-tool-executor.ts sourced the tenant from `ctx.tenantId || args._tenantId`, so a model that emitted `_tenantId` in a tool's args could steer the execution's tenant if a caller ever forgot to set `ctx.tenantId`. That fallback is removed — tenant now comes ONLY from the trusted `ctx` (every real caller sets it; lobster / plan-executor / task-planner deliberately don't route through this function). **MEDIUM #2 — event-bus status writes weren't tenant-scoped:** both `UPDATE event_log` status writes in server/event-bus.ts (the no_subscribers and the routed updates) matched on the event id alone, so a status write could touch a row in another tenant; both now carry an explicit tenant scope. **MEDIUM #3 — heartbeat swallowed a failed-event persistence error AND wasn't tenant-scoped:** the failed-event `UPDATE event_log SET status='failed'` in server/heartbeat.ts had a bare empty catch that hid any persistence failure (the event would stay pending and re-fire next tick with a misleading symptom) and matched on id alone; it now logs the failure loud and scopes the update to the event's tenant. Live-stat resync to the database: tables 211→212, indexes 620→623. tsc 0, regression suites green, confirming architect PASS. No new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_75") ? "" : "truncate"}`}>{"**394 tools**, **129 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **212 tables**, **623 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+75 closes 3 tenant-isolation + silent-failure MEDIUMs fail-closed and resyncs the live table/index counts (211→212 / 620→623); no new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_75") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+74 (2026-06-29) — DEMOTED (amber): whole-app + 72h review, 1 MEDIUM closed + owner-jury concurrency overshoot fixed. failure-contract clampLine→mdEscape blocks inline-markdown injection in terminal-failure reports; moa.ts reserve-then-settle stops concurrent owner-jury runs overshooting the daily-$ ceiling. Architect PASS. No stat change. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_74")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_74"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+74</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_74") ? "" : "line-clamp-2"}`}>{"R125+74 — **Whole-app + 72h post-edit code review (4 parallel surface-split architect passes + agent-wiring audit exit 0: 394 tools, 0 dead/drift/leak/schema-gap): 1 MEDIUM closed + an owner-jury concurrency overshoot fixed.** **MEDIUM — inline-markdown injection in the terminal-failure report (R125+73 follow-up):** the R125+73 structured failure contract's `clampLine` HTML-escaped only `<` and `>`, so untrusted approval-note / question / tool-error text could still inject INLINE markdown (links, images, emphasis, code, tables) when the failure block renders. A new `mdEscape()` in `server/agentic/failure-contract.ts` backslash-escapes markdown special chars on every untrusted text field (real artifact URLs pass `mdSafe=false` so they aren't mangled). +1 regression test, suite 9/9, tsc 0. **Also fixed — owner-jury metered daily-ceiling concurrency overshoot:** overlapping owner-initiated jury runs could each pass the daily-$ ceiling pre-check before any of them recorded spend. `server/moa.ts` now accrues a conservative per-run RESERVATION when the metered override is granted (so concurrent runs see in-flight spend) and settles only the excess at the end; additive so a throw mid-run fails SAFE (over-counts, never under) and self-heals on the daily roll. +2 regression tests (7/7), tsc clean. A public-route IP-source STRICT-mode inconsistency was triaged a FALSE POSITIVE (already logged, not a bypass). No new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_74") ? "" : "truncate"}`}>{"**394 tools**, **129 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **211 tables**, **620 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+74 closes an inline-markdown injection in the terminal-failure report and fixes the owner-jury daily-ceiling concurrency overshoot (1 MEDIUM fail-closed); no stat change. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_74") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+72 (2026-06-28) — DEMOTED (violet): closed threat-model gap #1 (gate-1 storage-boundary PII/secret redaction). New central guard strips secrets+Luhn-CC+US-SSN on every durable-store write; 1 HIGH + 2 MEDIUM closed fail-CLOSED. Architect confirming PASS. No stat change. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_72")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_72"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+72</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_72") ? "" : "line-clamp-2"}`}>{"R125+72 — **Closed the #1 open threat-model gap: gate-1 storage-boundary PII/secret redaction.** A new central guard (`server/storage-helpers/pii-redaction-guard.ts`) composes the existing 48-pattern secret scanner and is wired into EVERY durable-store write path — `createMemoryEntry`/`updateMemoryEntry`, `createKnowledge`/`updateKnowledge`, `createConversationFact`, plus the one direct `agent_knowledge` insert in `server/step-ledger.ts` (rg-audited as the only write paths to those 3 tables). It ALWAYS strips credential-shaped secrets, Luhn-validated credit cards, and US SSNs; email/phone are DETECT-only by default (they're frequently legitimate CRM facts — untrusted public-ingest sites opt in via `redactContactInfo:true`). **HIGH — step-ledger direct-insert bypass:** the one knowledge insert outside `storage.ts` skipped the guard entirely → now routed through it. **MEDIUM — unguarded update paths:** the `update*` write paths weren't covered → wired in. **MEDIUM — JSON-blob corruption risk:** string-redacting a JSON blob could mangle it on a numeric credit-card leaf → the guard now redacts the OBJECT before `JSON.stringify` (recursive string + numeric-leaf walk with a Luhn check on numbers). Fresh scans: dependency 0 critical / 12 high (report-only, no bumps), SAST 817 all pre-existing, HoundDog crits dev-only `scripts/` — the new guard triggered ZERO findings. `threat_model.md` AML.T0070 + LLM04 rows moved ◑→✓ (honest scope) and gap-check #1 is closed. 15/15 unit tests, typecheck exit 0, architect confirming pass PASS. No new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_72") ? "" : "truncate"}`}>{"**394 tools**, **129 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **211 tables**, **620 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+72 closes the storage-boundary PII/secret redaction gap (1 HIGH + 2 MEDIUM fail-closed); no stat change. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_72") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+71 (2026-06-28) — DEMOTED (sky): whole-app + 72h review, 2 MEDIUM closed fail-CLOSED — plan-executor autonomous tool-step watchdog upgraded from OBSERVATIONAL to a bounded per-tool timeout (executeToolWithTimeout); bwb-script-runner prod-bundle probe hardened against transient overlayFS EIO. Architect confirming PASS. No stat change. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_71")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-sky-500/10 via-primary/5 to-transparent border border-sky-500/30 hover:border-sky-500/50 hover:bg-sky-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_71"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-sky-600 text-white leading-none shrink-0 mt-0.5">R125+71</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_71") ? "" : "line-clamp-2"}`}>{"R125+71 — **Whole-app + 72h post-edit code review (4 parallel surface-split architect passes + wiring audit exit 0, 394 tools, 0 dead/drift/leak/schema-gap): 2 MEDIUM closed fail-CLOSED.** **MEDIUM #1 — the plan-executor's autonomous tool-step watchdog was OBSERVATIONAL only:** `server/plan-executor.ts` registered a watchdog that returned an `AbortSignal` which was then discarded, and the bare `executeTool()` it guarded is signal-less — so a hung autonomous tool step neither aborted nor bounded the `await`. The step now runs through `executeToolWithTimeout()` (a per-tool `Promise.race` + `AbortController` that also aborts in-flight network tools) for bounded, fail-CLOSED plan progress; the AHB destructive-tool policy still runs BEFORE the call and still fails closed. **MEDIUM #2 — a prod-bundle existence probe degraded on any fault:** `scripts/lib/bwb-script-runner.ts` used a bare `fs.existsSync` inside a catch-all that returned `false` on ANY error, so a transient overlayFS EIO would silently fall back to the known-broken `npx tsx` prod path. It now uses `existsSyncEIO` (retries transient EIO, throws on a persistent fault) and, on throw, PREFERS the prebuilt bundle (`node dist/*.cjs`) since the tsx loader is known-broken in prod. Architect confirming pass PASS (0 new issues); typecheck exit 0, step-executor policy guard exit 0, regression suites green (`plan-executor-tool-step-gate`, `step-executor-policy-guard`, `eio-read`, `failure-taxonomy`). No new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_71") ? "" : "truncate"}`}>{"**394 tools**, **129 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **211 tables**, **620 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+71 bounds the autonomous plan-step watchdog (observational → fail-closed per-tool timeout) and hardens a prod-bundle EIO probe (2 MEDIUM fail-closed); no stat change. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_71") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+70 (2026-06-28) — DEMOTED (emerald): whole-app + 72h review, 2 HIGH + 1 MEDIUM closed fail-CLOSED; closes the self-approval-bypass class at the CENTRAL guarded-tool executor (consumer-side complement to R125+69+sec), agentJobs schema-drift sync, heartbeat self_initiative 12h re-fire floor. Architect PASS. No stat change. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_70")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_70"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+70</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_70") ? "" : "line-clamp-2"}`}>{"R125+70 — **Whole-app + 72h post-edit code review (4 parallel surface-split architect passes + wiring audit exit 0): 2 HIGH + 1 MEDIUM closed fail-CLOSED — the self-approval-bypass class is now closed end-to-end.** **HIGH #1 — the CENTRAL guarded-tool executor trusted a model-authored approval flag:** `server/guarded-tool-executor.ts` still READ `args._approvedByGate` to set BOTH `hasApproval` (the AHB destructive-tool gate) AND the HITL `skipGate` — the consumer-side complement to R125+69+sec, which had only stripped that signal at the producer step executors. Both reads are removed; approval is now sourced ONLY from the trusted `ctx.skipApprovalGate` (main chat's own SSE human-in-the-loop gate) plus `self_heal` context, so even a path that forgets to strip the signal can never self-approve at the chokepoint (verified repo-wide that nothing legitimately produces `_approvedByGate:true`). **HIGH #2 — schema drift:** `shared/schema.ts`'s `agentJobs` lacked the live `failure_class` / `rollback_note` columns + partial index the running code already uses; an additive schema-only sync mirrors the live DB (psql confirmed cols + index already present — no DB change). **MEDIUM — heartbeat `self_initiative` had no cross-process re-fire floor:** added a 12h DB-`lastRunAt` guard before the prod-only skip so cron drift can't double-fire it. Architect confirming pass PASS (0 remaining CRITICAL/HIGH); typecheck + step-executor guard + regression suites green. No new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_70") ? "" : "truncate"}`}>{"**394 tools**, **129 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **211 tables**, **620 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+70 closes the self-approval-bypass class at the central guarded executor (2 HIGH + 1 MEDIUM fail-closed); no stat change. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_70") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+69+sec (2026-06-28) — (cyan): whole-app + 72h review, 1 HIGH + 1 MEDIUM closed fail-CLOSED + platform-wide sweep of the self-approval-bypass class (lobster + task-planner step executors strip model-authored approval signals; new guard invariant 3). Architect PASS. No stat change. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_69sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/15 via-primary/5 to-transparent border border-cyan-500/40 hover:border-cyan-500/60 hover:bg-cyan-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_69sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+69+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_69sec") ? "" : "line-clamp-2"}`}>{"R125+69+sec — **Whole-app + 72h post-edit code review: 1 HIGH + 1 MEDIUM closed fail-CLOSED, plus a platform-wide sweep of the same self-approval-bypass bug class.** **HIGH — a lobster workflow step could self-approve a destructive tool:** an autonomous lobster step could set `_approvedByGate:true` (and spoof `_conversationId`) in its `toolArgs` to self-approve a requiresApproval/destructive tool and bypass the AHB destructive-tool gate; `server/lobster.ts` now strips BOTH signals and hard-sets `hasApproval:false`, so an autonomous step can NEVER self-approve. **MEDIUM — plan-executor identity fail-open:** `server/plan-executor.ts` fell back to the admin tenant on a non-numeric `plan.tenant_id` (a NOT-NULL column, so a corrupt/forged identity); it now fails CLOSED before any stamp. **SWEEP (same bug class, platform-wide):** found + closed a 3rd self-approval sibling in `server/task-planner.ts`'s autonomous step executor, hardened the `server/tools.ts` glued-name recovery to `hasApproval:false`, and added a fail-CLOSED **invariant 3** to the step-executor policy guard so no executor can ever source `hasApproval` off `_approvedByGate` again. Plus 7 landing-page aggregate stat literals resynced 393→394 / 128→129. Architect confirming pass PASS (0 remaining CRITICAL/HIGH); typecheck + agent-wiring audit exit 0. No new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_69sec") ? "" : "truncate"}`}>{"**394 tools**, **129 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **211 tables**, **620 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+69+sec strips model-authored approval signals at the lobster + task-planner step executors (1 HIGH + 1 MEDIUM fail-closed) and adds a guard invariant; no stat change. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_69sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+68 (2026-06-27) — DEMOTED (rose): release-sync round + step-executor guard-coverage HIGH closed (plan-executor.ts registered in the AHB guard's executor allowlist) + whole-platform live-stat resync (tools 393→394, capabilities 128→129). Architect PASS. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_68")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/10 via-primary/5 to-transparent border border-rose-500/30 hover:border-rose-500/50 hover:bg-rose-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_68"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+68</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_68") ? "" : "line-clamp-2"}`}>{"R125+68 — **Release-sync round: a step-executor guard-coverage HIGH closed, plus a whole-platform live-stat resync.** **HIGH — an autonomous step executor sat outside the guard's coverage view:** the task-planner's `plan-executor.ts` ran autonomous plan steps through a dispatch path the AHB destructive-tool-policy AUDIT didn't recognize as a guarded executor, so the coverage check couldn't prove those steps were being policed. It's now registered in the guard's `STEP_EXECUTORS` + `EXECUTETOOL_ALLOWLIST` (`server/safety/guard-step-executor-policy.ts`), so every autonomous step executor on the platform is accounted for; architect PASS, preflight + typecheck + agent-wiring audit all exit 0. **Plus:** a whole-platform live-stat resync — tools 393→394, capabilities 128→129 — propagated to every website surface, the comprehensive features PDF + text file, and both GitHub READMEs (the private README's stale stats table corrected to live values). No new declared tools / tables / personas / capabilities / skills. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_68") ? "" : "truncate"}`}>{"**394 tools**, **129 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **211 tables**, **620 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+68 closes a guard-coverage HIGH and resyncs live stats (tools 393→394, capabilities 128→129) across every surface. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_68") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+67 (2026-06-26) — DEMOTED (violet): whole-app + 72h code review closed 2 multi-tenant HIGH (lobster pause→resume invoker-context loss → privilege escalation; cross-tenant attachment restore) + heartbeat self_initiative prod-only gate + stats resync to live. Architect PASS. No stat change. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_67")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/15 via-primary/5 to-transparent border border-violet-500/40 hover:border-violet-500/60 hover:bg-violet-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_67"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+67</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_67") ? "" : "line-clamp-2"}`}>{"R125+67 — **Whole-app + 72h code review: 2 multi-tenant HIGH closed (lobster pause→resume privilege escalation; cross-tenant attachment restore), plus a heartbeat prod-isolation fix and a stats resync.** **HIGH #1 — lobster pause→resume dropped invoker context:** when an autonomous lobster workflow pauses for approval and later resumes, it lost the original invoker's tenant/persona, so a non-admin launcher's post-approval steps ran as the admin/`system`-trusted identity (lobster's `undefined` invoker fails OPEN to the admin tenant, NOT closed). The fix persists the invoker tenant + persona in the paused state and restores them on resume, so resumed steps run with exactly the launcher's authority. **HIGH #2 — cross-tenant attachment restore:** the attachment DB→disk restore path looked up stored files by a user-derived filename with NO tenant scope, so a crafted name could read another tenant's file; the lookup is now scoped to the conversation's tenant. **Plus:** the heartbeat `self_initiative` task is now prod-only (a shared-DB dev box no longer double-runs the prod-seeded row), and the landing-page + features-doc stats were resynced to the live database. Architect post-fix pass PASS — 0 new CRITICAL / HIGH. No new declared tools / tables / personas / capabilities / skills. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_67") ? "" : "truncate"}`}>{"**393 tools**, **128 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **211 tables**, **620 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+67 is a security + correctness round; 2 multi-tenant HIGH closed fail-closed, no new declared tools / tables / personas / capabilities. No stat change. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_67") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+66 (2026-06-25) — DEMOTED (violet): whole-app + 72h post-edit code review (clean, 0 CRITICAL/HIGH) + a delivery-pipeline tenant-attribution telemetry fix; capabilities stat resynced 126 → 128. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_66")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_66"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+66</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_66") ? "" : "line-clamp-2"}`}>{"R125+66 — **Whole-app + 72h post-edit code review (clean) + a delivery-pipeline tenant-attribution telemetry fix.** Four parallel architect passes (sensitive core / revenue + background / SSRF + delivery / frontend) over the last 72 hours returned PASS with 0 CRITICAL / 0 HIGH. The one delivery-cluster MEDIUM was verified a security FALSE POSITIVE — delivery assets are capability-gated at the `/uploads` middleware, not tenant-gated — and downgraded to a telemetry-accuracy LOW, then fixed: the delivery pipeline was stamping a hardcoded default tenant onto the signed download URL, both delivery-engagement events, and both publish-to-own-server callers; it now threads the real request tenant end-to-end so delivery telemetry and signed-URL scoping reflect the true tenant. Also resynced the live `capabilities` table count (126 → 128). No new declared tools / tables / personas / capabilities / skills / workflows. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_66") ? "" : "truncate"}`}>{"**393 tools**, **128 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **211 tables**, **620 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+66 is a review-clean + telemetry/correctness round; capabilities resynced 126 → 128, no new declared tools / tables / personas; live tables/indexes resynced 210 → 211 / 616 → 620 (2026-06-26). _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_66") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+64 → +65 (2026-06-25) — DEMOTED (violet): whole-app + 72h security review closed 2 HIGH (autonomous plan/lobster step executors bypassed the AHB destructive-tool policy; project-create conversation link wrote cross-tenant), plus a governance round making the loop contracts mechanically checkable + closing an intra-tenant persona-knowledge leak. Architect PASS. No new declared tools/tables/personas/capabilities. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_65")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_65"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+65</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_65") ? "" : "line-clamp-2"}`}>{"R125+64 → +65 — **Whole-app + 72h security review: 2 HIGH closed, plus a governance round that made the autonomous-loop contracts mechanically checkable and closed an intra-tenant persona-knowledge leak.** **HIGH #1 (R125+65) — autonomous plan/lobster step executors bypassed the destructive-tool policy:** the task-planner and lobster step executors ran every plan/workflow step through the RAW tool dispatcher, which skips the AHB policy-enforcement layer (trusted-persona / structured-args / approval / value-cap gates live ONLY on the guarded path). Both executors now enforce the tool policy BEFORE running each step and fail CLOSED; the policy persona resolves from the run's TENANT — internal/autonomous and admin/owner runs act as the trusted `system` persona, while any real non-admin invoker gets no trusted name so trusted-only and approval-required tools fail closed. **HIGH #2 (R125+65) — project-create conversation link wrote cross-tenant:** creating a project linked it to a conversation id with an UNSCOPED UPDATE, and that id (unlike `_tenantId`/`_personaId`) wasn't stripped from model-authored step args, so a step could spoof a victim tenant's conversation; the UPDATE is now tenant-scoped with a `RETURNING` guard and the link INSERT only fires when a row in the caller's OWN tenant actually matched. A new regression test pins the trust contract (4/4). **R125+64 (governance + security):** the 8 autonomous-loop contracts gained `verifier` (independent / self / deterministic — a loop must not grade its own output) and `spend` (capped / bounded / none / unbounded — token-blowout ceiling) fields, and the Loop Doctor now ERRORs on a self-grading loop, an unbounded-spend loop, and any `capped` loop whose source doesn't actually reference the atomic claim-before-spend seam (a verification you can't check is no verification) — which honestly downgraded one mislabeled loop. A capability-recall call that searched agent-knowledge with NO persona scope (returning every persona's private rows within the tenant) now filters to the active persona's own rows plus global rows. Architect PASS — both HIGH closed fail-closed, SQL parameterized, persona leak closed; typecheck + build + Loop Doctor + unit tests green. No new declared tools/tables/personas/capabilities/skills/workflows. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_65") ? "" : "truncate"}`}>{"**393 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **210 tables**, **616 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+64→+65 are a governance + security-hardening cycle; no new declared tools / tables / personas / capabilities (+1 security regression test). _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_65") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+62 → +63 (2026-06-23) — DEMOTED (violet): autonomous-loop contracts (governance) + top-tier model-lineup refresh (removed claude-fable-5, added z-ai/glm-5.2). Architect PASS. No new declared tools/tables/personas/capabilities. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_63")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_63"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+63</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_63") ? "" : "line-clamp-2"}`}>{"R125+62 → +63 — **Autonomous-loop contracts (governance) + a top-tier model-lineup refresh.** **R125+62 — autonomous-loop contracts:** the Forward-Future Loop Library reviewed out as curated prompts + doctrine with zero importable code, so the discipline was implemented natively as a typed, CI-enforced contract registry. All 8 real autonomous loops (CI self-healer, auto-git-push, jury-queue drainer, skill-optimizer, tenant-isolation audit, BWB weekly render, agent-knowledge refresh, heartbeat tasks) now declare an objective / check / feedback / stop-conditions / escalation / authority / fail-mode contract — every mutating or destructive loop fails CLOSED. A new 'Loop Doctor' audit derives the live workflow set and ERRORs on any uncontracted loop (it caught a real umbrella workflow on the first run), with a bidirectional inventory so the in-process loops are checkable even in the prod bundle; 34/34 unit tests. The contracts are indexed into agent_knowledge, added to the capability registry, and harnessed as weekly-maintenance Pass 12 so the personas actually know the loops exist. **R125+63 — top-tier model lineup refresh:** removed `claude-fable-5` entirely (Anthropic's Fable 5 was shut down) and added `z-ai/glm-5.2` as a new top-tier OpenRouter model (verified live: 1M-token context, $0.98/M in · $3.08/M out) across the powerful/reasoning ladders, free-model rotation, resource predictor, context-window guard (1M) and cost ledger; the locked 4-model jury frontier is unchanged. Also folded in a whole-app-review fix correcting a stale `kimi-k2.5` → `k2.6` model id in the resource predictor + max-output map. Architect PASS, typecheck + build green. No new declared tools/tables/personas/capabilities/skills/workflows. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_63") ? "" : "truncate"}`}>{"**393 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **210 tables**, **616 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+62→+63 are a governance + model-roster change; no new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_63") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+60 → +61 (2026-06-22 → 06-23) — DEMOTED (emerald): platform-security hardening sprint — plan/lobster tenant+persona escalation closed (R125+60/+61), SSRF DNS-rebind TOCTOU pinned at 4 more callsites, vc_ API-key admin-confusion closed. Architect PASS, 0 new CRITICAL/HIGH. No new declared tools/tables/personas/capabilities (+2 auth regression tests). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_61")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-slate-500/10 via-primary/5 to-transparent border border-slate-500/30 hover:border-slate-500/50 hover:bg-slate-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_61"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-slate-600 text-white leading-none shrink-0 mt-0.5">R125+61</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_61") ? "" : "line-clamp-2"}`}>{"R125+60 → +61 — **Platform-security hardening sprint: a whole-app + 72h review closed 3 HIGH plus a tenant/persona escalation in the plan & lobster step executors.** **HIGH #1 — plan/lobster tenant+persona escalation (R125+60/+61):** the task-planner and lobster step executors force-stamp the admin tenant on every step but never carried the REAL invoker identity, so a non-admin tenant chatting with a trusted-named persona could run owner-only tenant-1 tools through a plan/lobster step. The fix threads the authenticated invoker tenant and persona end-to-end, strips any model-supplied `_tenantId`/`_personaId` in the step, and force-stamps the real non-admin tenant (fail closed) — only an admin/internal caller gets the admin stamp, giving plan/lobster execution exact parity with a direct tool call. **HIGH #2 — SSRF DNS-rebind TOCTOU:** four more public-fetch callsites (reference-learner content + thumbnail, link-understanding, the delivery-pipeline share-link verifier) validated a URL then fetched it by hostname, leaving a re-resolution window; they now PIN the network dispatcher to the exact IPs already validated, with guaranteed cleanup. **HIGH #3 — `vc_` API-key admin confusion:** an admin-tenant API key could be mistaken for platform-admin when no admin PIN is set; the admin gate now excludes `vc_` keys from both the session lookup and the no-PIN fallback. Architect PASS — all 3 HIGH closed, fail closed, 0 new CRITICAL/HIGH. +2 `vc_` auth regression tests (6/6 green); typecheck + build clean, wiring audit GREEN. No new declared tools/tables/personas/capabilities. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_61") ? "" : "truncate"}`}>{"**393 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **210 tables**, **616 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+60→+61 are security-hardening rounds; no new declared tools / tables / personas / capabilities (+2 auth regression tests). _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_61") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+55 → +59 (2026-06-20 → 06-21) — DEMOTED (slate): planner skill-aware re-decomposition (R125+55, SkillWeaver SAD) + a BWB render-reliability & chat-context-hygiene hardening sprint (R125+56→+59). No new declared tools/tables/personas/capabilities. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_59")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-slate-500/10 via-primary/5 to-transparent border border-slate-500/30 hover:border-slate-500/50 hover:bg-slate-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_59"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-slate-600 text-white leading-none shrink-0 mt-0.5">R125+59</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_59") ? "" : "line-clamp-2"}`}>{"R125+55 → +59 — **Planner skill-aware re-decomposition + a BWB render-reliability & chat-context-hygiene hardening sprint.** **R125+55 (planner feature, SkillWeaver SAD, arXiv:2606.18051):** after the planner decomposes a task it now validates every step's tool against the REAL tool registry BEFORE execution and re-decomposes ONCE with explicit feedback if any step references a blocked or hallucinated tool — instead of only discovering an unusable tool reactively when a step fails mid-run; a single acceptance gate accepts the revision ONLY if it strictly reduces the tool-mismatch count AND is structurally sound (no dangling/cyclic step dependencies via topological sort), so a refine can never hand back a worse plan; bounded to one iteration, fails OPEN. **R125+56 → +59 (reliability + context hygiene):** EIO-resilient reads across the BWB render-farm script path (Replit's Reserved-VM overlayFS intermittently throws EIO on ordinary reads), a bounded auto-retry on TRANSIENT infra faults in the weekly-recap orchestrator (fails closed on real content/config errors, claims the spend governor fresh before each attempt), an AST regression guard that fails CI if an unguarded read-class fs op is reintroduced on a render-path file, and observation masking in the chat round loop that trims stale tool-output bodies (dropping stale images — the biggest token win) while preserving call↔result pairing to cut Lost-in-the-Middle rot on long agentic turns. Every round architect PASS (0 CRIT/HIGH/MED), unit-tested, typecheck clean. No new declared tools/tables/personas/capabilities. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_59") ? "" : "truncate"}`}>{"**393 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **210 tables**, **616 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+55→+59 are a planner-behaviour feature plus reliability/context-hygiene hardening; no new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_59") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+54 (2026-06-20) — DEMOTED (slate): Difficulty-adaptive UP-route — the AUTO path now escalates genuinely-hard requests to the high-end model (the mirror of the existing illusory-productivity down-route guard), tracked by a new upRouteCount metric on the Orchestration Efficiency card; shipped with a whole-app + 72h review (two parallel architect passes, PASS, 0 CRIT/HIGH/MED). No new declared tools/tables/personas/capabilities. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_54")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-slate-500/10 via-primary/5 to-transparent border border-slate-500/30 hover:border-slate-500/50 hover:bg-slate-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_54"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-slate-600 text-white leading-none shrink-0 mt-0.5">R125+54</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_54") ? "" : "line-clamp-2"}`}>{"R125+54 — **Difficulty-adaptive UP-route: the AUTO path now escalates genuinely-hard requests to the high-end model instead of answering cheap-and-shallow — the mirror of the existing illusory-productivity down-route guard.** The orchestration-efficiency guard already down-routed trivial requests away from the expensive heavy loop (arXiv:2605.22687); this round adds the opposite direction — when a request looks genuinely hard (complexity markers / length / cross-domain reasoning) but wouldn't otherwise trip the heavy ensemble, the AUTO path UP-routes it to the high-end model and tags the orchestration `request_class='adaptive-hard-route'`, counted by a new `upRouteCount` metric on the Orchestration Efficiency card on `/admin/ecosystem-health`. ADVISORY + fail-open: it only ever shapes the AUTOMATIC route and never blocks or skips an explicit `ensemble_query` / `jury_triage` call; telemetry is fire-and-forget so it can never slow or throw into the chat hot path; the cost-exempt scoping of the sanctioned up-route is locked by a static regression test. Shipped behind a whole-app + 72h code review — two parallel architect passes (sensitive core + revenue/agentic/jobs), both PASS, 0 CRITICAL/HIGH/MEDIUM. Agent-wiring audit CLEAN (393 tools, 0 dead/drift/leak), tsc + esbuild build green, preflight stale-strings CLEAN. A behaviour layer over the existing AUTO path — no new declared tools/tables/personas/capabilities. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_54") ? "" : "truncate"}`}>{"**393 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **210 tables**, **616 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+54 adds a difficulty-adaptive UP-route as a behaviour layer over the existing AUTO path; no new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_54") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+53 (2026-06-19) — DEMOTED (slate): Actor-Critic Reflection — a second independent LLM coaches the supervisor loop out of a stuck retry (Bob's idea); shipped with a whole-app + 72h review (architect PASS, 0 CRIT/HIGH, 2 MEDIUM closed). No new declared tools/tables/personas/capabilities. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_53")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-slate-500/10 via-primary/5 to-transparent border border-slate-500/30 hover:border-slate-500/50 hover:bg-slate-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_53"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-slate-600 text-white leading-none shrink-0 mt-0.5">R125+53</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_53") ? "" : "line-clamp-2"}`}>{"R125+53 — **Actor-Critic Reflection: a second independent LLM coaches the supervisor loop out of a stuck retry instead of blindly halting or upgrading the model.** Bob's idea (2026-06-19): when an agent tries something, it fails, loops, retries and STILL spins with no success, a SECOND independent LLM (the critic-coach) reads the actual failed output, diagnoses WHY it failed, and hands targeted \"do this / don't repeat that\" guidance back to the SAME primary loop for one more INFORMED retry — paired with a model escalation (the \"Combined\" mode). The critic runs as an ISOLATED chat completion with its own system prompt and a freshly-built messages array (reviewer-independence invariant, shared with the critique agent / ARIS) — the failed output is passed as DATA, never by threading the live conversation history. Fails OPEN: any error or unparseable result falls through to the existing halt behaviour; a single `decideStuckRecovery` gate; escalation clamped at 2 and never downgrades. Shipped with a whole-app + 72h code review — architect PASS, 0 CRITICAL/HIGH — that closed 2 MEDIUM: a session-scoped `pg_advisory_lock` in auto-consolidation is now released in a `finally` (guarded, fail-soft) so it can't outlive the run and starve future tenant consolidation, and a stale \"208 tables\" → \"210\" corrected on the pricing + about pages. Agent-wiring audit CLEAN (393 tools, 0 dead/drift/leak), tsc + esbuild build green, preflight stale-strings CLEAN. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_53") ? "" : "truncate"}`}>{"**393 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **210 tables**, **616 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+53 ships a new actor-critic reflection capability as a behaviour layer over the existing supervisor loop; no new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_53") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.48+sec (2026-06-19) — DEMOTED (slate): whole-app + 72h code review (two parallel architect passes — sensitive core + revenue engines/jobs) + briefings.ts client-error-leak hardening (9 sites). No new declared tools/tables/personas/capabilities. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_48")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-slate-500/10 via-primary/5 to-transparent border border-slate-500/30 hover:border-slate-500/50 hover:bg-slate-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_48"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-slate-600 text-white leading-none shrink-0 mt-0.5">R125+52.48+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_48") ? "" : "line-clamp-2"}`}>{"R125+52.48+sec — **Whole-app + 72h code review (two parallel architect passes — sensitive core + revenue engines/jobs) — architect PASS, 0 CRITICAL/HIGH/MEDIUM.** Closed 1 LOW information-leak finding: the AI Daily Briefing routes were returning raw server `err.message` text to the browser on 500 errors (9 handlers). All nine now log the real error server-side and return a generic \"Internal server error\", so internal database/provider detail can no longer leak to the client. Standing audits all green — agent-wiring audit CLEAN (393 tools, 0 dead/drift/leak), tsc + esbuild build green, preflight stale-strings CLEAN. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_48") ? "" : "truncate"}`}>{"**393 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **210 tables**, **616 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+52.48+sec is a correctness/hardening round; no new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_48") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.47+sec (2026-06-18) — DEMOTED (slate): whole-app + 72h code review (3rd pass), 4 findings closed (cost-cap backstop, tenant-isolation, fail-soft telemetry, stat fix). No new declared tools/tables/personas/capabilities. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_47")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-slate-500/10 via-primary/5 to-transparent border border-slate-500/30 hover:border-slate-500/50 hover:bg-slate-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_47"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-slate-600 text-white leading-none shrink-0 mt-0.5">R125+52.47+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_47") ? "" : "line-clamp-2"}`}>{"R125+52.47+sec — **Whole-app + 72h code review (3rd pass) — 4 findings closed, architect PASS.** (1) **Cost-cap backstop:** the two most expensive autonomous tools (`second_opinion`, `venture_discovery`) were added to the dispatcher's hardcoded expensive-tool set so the per-call spend throttle still fires even if the rate-limiter config ever fails to load. (2) **Tenant isolation:** a projects lookup in the auto-transcript path now scopes its SELECT to the caller's tenant and fails closed, so a poisoned conversation project id can't redirect downstream file writes onto a foreign project. (3) **Fail-soft telemetry:** the Token Efficiency probe import on `/admin/ecosystem-health` moved inside its per-probe try with a full default shape, so a probe-module load error degrades just that one card instead of throwing the whole dashboard request. (4) **Stat fix:** a founder-quote tool count corrected 392 → 393. Wiring audit CLEAN, tsc + esbuild build green. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_47") ? "" : "truncate"}`}>{"**393 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **210 tables**, **616 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+52.47+sec is a correctness/hardening round; no new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_47") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.44 → +52.46 (2026-06-18) — DEMOTED (slate): Token Efficiency telemetry card on /admin/ecosystem-health (3 read-only per-request overhead metrics) + two whole-app + 72h security/correctness reviews (Venture Discovery 2 HIGH + 2 MEDIUM). No new declared tools/tables/personas/capabilities. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_46")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-slate-500/10 via-primary/5 to-transparent border border-slate-500/30 hover:border-slate-500/50 hover:bg-slate-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_46"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-slate-600 text-white leading-none shrink-0 mt-0.5">R125+52.46</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_46") ? "" : "line-clamp-2"}`}>{"R125+52.44 → +52.46 — **Token Efficiency telemetry on `/admin/ecosystem-health` + two whole-app security/correctness reviews.** **R125+52.46 — observability:** a new Token Efficiency card surfaces three READ-ONLY per-request overhead metrics so wasted spend becomes measurable instead of a vibe — (1) cache-hit starvation (cache-hit % on large ≥5000-token prompts over 30 days), (2) instruction bloat (the fixed system-prompt token tax, measured live), and (3) MCP tool bloat (the serialized tool-catalog token tax). Tenant-scoped end to end and fail-soft (it shows \"telemetry unavailable\" rather than faking healthy zeros); purely additive — no writes, no schema change. **R125+52.45+sec — whole-app + 72h review (architect PASS, 0 CRIT/HIGH):** closed 2 MEDIUM — a linked-conversation backfill that was writing NULL project ids back over itself (now joins through `projects` with a tenant guard so a poisoned cross-tenant link row can't stamp a foreign project onto a conversation), plus Zod validation added to the briefings widget/generate routes (which then surfaced and fixed a 0-coordinate truthiness bug that skipped valid equator/prime-meridian locations). **R125+52.44+sec — whole-app + 72h review (architect PASS):** closed 2 HIGH in the Venture Discovery loop — a budget reservation that settled even when the paid call never happened ($0 real spend was still burning a full stage's daily cap) now releases instead of settling, and a non-atomic stage-advance that two concurrent approvals could double-execute now uses an atomic compare-and-set. tsc + build green. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_46") ? "" : "truncate"}`}>{"**393 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **208 tables**, **610 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+52.44 → +52.46 are observability + correctness/security rounds; no new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_46") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.43+sec (2026-06-17) — DEMOTED (slate): tenant-isolation nightly-audit coverage fix (oversized files were silently skipped → now split into overlapping windows) + a 62-finding triage that closed 8 genuine cross-tenant isolation defects (skill-synthesizer writes + skill-library reads now require tenantId, fail-closed). 3 architect passes → PASS. No new declared tools/tables/personas. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_43")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-slate-500/10 via-primary/5 to-transparent border border-slate-500/30 hover:border-slate-500/50 hover:bg-slate-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_43"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-slate-600 text-white leading-none shrink-0 mt-0.5">R125+52.43+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_43") ? "" : "line-clamp-2"}`}>{"R125+52.43+sec — **Tenant-isolation nightly-audit hardening + a 62-finding triage.** The nightly cross-tenant security audit was silently skipping oversized source files — they blew the model's input-token cap, so the green/exit-0 result wasn't actually honest. It now splits large files into overlapping line-windows and only counts a file audited when *every* window passes, so the fail-closed coverage gate tells the truth. A triage of 62 flagged findings closed **8 genuine cross-tenant isolation defects** — the skill-synthesizer's writes and several skill-library reads now require an explicit tenant id and fail closed — with the remaining ~54 verified as false positives (intentional platform-global tables, guards enforced at another layer, stale source-drift). Loop-until-clean across 3 architect passes → PASS, typecheck green. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_43") ? "" : "truncate"}`}>{"**393 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **208 tables**, **610 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — live-verified resync (the live DB count includes runtime + Stripe-mirror tables above the declared schema); R125+52.43+sec adds no new declared tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_43") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.41 → +52.42 (2026-06-17) — DEMOTED (slate): Fusion second-opinion cross-check (`second_opinion`, all 16 personas) — independent multi-model verdict before human escalation, AUTO-fires on low-κ; hard $25/day owner-only cap, hardened in +52.42 against cost-drift overshoot (worst-case clamp + fail-closed cost-drift latch + dynamic reserve floor). Tools 391 → 392; +52.42 no count change. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_42")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-slate-500/10 via-primary/5 to-transparent border border-slate-500/30 hover:border-slate-500/50 hover:bg-slate-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_42"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-slate-600 text-white leading-none shrink-0 mt-0.5">R125+52.42</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_42") ? "" : "line-clamp-2"}`}>{"R125+52.41 → +52.42 — **NEW: Fusion second-opinion cross-check — a new `second_opinion` tool wired to all 16 personas that fetches an independent multi-model verdict before the platform ever escalates to a human (tools 391 → 392).** On-demand, and it AUTO-fires from the native multi-model ensemble whenever an answer is low-confidence (concordance κ < 0.5, or only a single proposer responded) — taking a second read *before* paging an operator. Spend is metered through OpenRouter Fusion (a managed panel → judge → synthesize backend) behind a dedicated **$25/day owner-only cap** enforced by atomic reserve-then-settle: every call reserves an estimated cost under a per-tenant advisory lock BEFORE spending, then settles that same row in place to the real cost — so concurrent low-κ auto-calls can never all read a stale total and overshoot the hard ceiling. Fail-OPEN on a timeout (45s auto / 90s on-demand), fail-CLOSED on a reserve error, non-recursive (cost-exempt lane). R125+52.40 wired Fusion as an OPTIONAL metered deep-research backend reference (NOT a core-path swap for the free native ensemble) + an A/B harness. Whole-app + 72h review: architect PASS (overshoot race closed, 0 security); +9 guard tests, tsc clean. **R125+52.42 — the $25/day cap was then hardened against cost-drift overshoot (architect HIGH → accepted LOW):** every reservation floors at a ×10-pessimistic worst-case estimate, a fail-closed cost-drift latch trips the first time a real bill exceeds what was reserved — disabling BOTH the auto low-κ hook AND on-demand spend (unless the owner explicitly overrides) and paging the owner — and a dynamic reserve floor lifts every later reservation to the highest real cost seen that day, so a drifted price can't be repeatedly under-reserved. +11 guard tests (20/20), tsc clean, architect PASS. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_42") ? "" : "truncate"}`}>{"**392 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **198 tables**, **581 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+52.40 → +52.41 add 1 tool (`second_opinion`, 391 → 392); +52.42 hardens that tool's cost cap, no count change. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_42") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.31 → +52.39 (2026-06-15) — DEMOTED (emerald): a nine-round security + reliability hardening sprint — Harness Health card, new `ponytail` skill (+1 .agents skill → 33), three whole-app + 72h code reviews, budget-adaptive controller, ecosystem-health degraded-probe signal, completion-evaluator model-distinctness, SSRF DNS-rebinding TOCTOU closed, MoA proposer-sanitization fail-open. Skills 32 → 33 .agents; no new tools/tables/personas/capabilities. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_39")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_39"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+52.39</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_39") ? "" : "line-clamp-2"}`}>{"R125+52.31 → +52.39 — **A nine-round security + reliability hardening sprint across the platform's most sensitive internals — all correctness/hardening plus one new engineering-discipline skill.** **OBSERVABILITY (.31, .36):** a new Harness Health card on `/admin/ecosystem-health` surfaces the self-repair land-rate, and every health probe now carries a degraded marker so a failed probe shows an amber \"telemetry unavailable\" banner instead of reading as healthy zeros. **DISCIPLINE (.32):** a new `ponytail` minimalism-gate skill (+1 .agents skill). **CONTROL (.34):** a mid-run budget-adaptive strategy controller. **SECURITY/CORRECTNESS (.33, .35, .37, .38, .39):** three whole-app + 72h post-edit code reviews (architect PASS, wiring audit exit 0); the run-completion judge now runs on a model distinct from the worker set; an SSRF DNS-rebinding TOCTOU was closed by pinning the high-risk public-fetch helper's socket to the already-validated IPs; the multi-model jury's proposer set now fails OPEN to the default pool when caller-supplied ids dedupe to empty (instead of silently running zero proposers); and per-row resilience was added to the stale-approval expiry sweep. Skills 32 → 33 .agents; no new tools/tables/personas/capabilities. tsc clean, tests green, architect PASS. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_39") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **33 (.agents) + 62 (db) + 38 (output-skills) = 133 reference surfaces**, **16 personas**, **198 tables**, **581 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+52.31 → +52.39 add 1 .agents skill (`ponytail`); no new tools / tables / personas / capabilities. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_39") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.26 → +52.30 (2026-06-14) — DEMOTED (slate): two whole-app post-edit code reviews (closed MEDIUMs incl. an operator-script path-traversal regression) + the BWB weekly-recap reliability suite. No count changes. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_30")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-slate-500/10 via-primary/5 to-transparent border border-slate-500/30 hover:border-slate-500/50 hover:bg-slate-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_30"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-slate-600 text-white leading-none shrink-0 mt-0.5">R125+52.30</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_30") ? "" : "line-clamp-2"}`}>{"R125+52.26 → +52.30 — **Two whole-app code-review passes plus a BWB weekly-recap reliability suite — all correctness / hardening, no new counts.** **CODE REVIEW (R125+52.26 / .27):** two whole-app + 72h post-edit reviews closed MEDIUM findings across the unreviewed delta — including an operator-script path-traversal regression where `scripts/fetch-bwb-photo.ts` wrote to an env-supplied `DEST` with no root bound (now `PHOTO_ROOT`-anchored, `..`-escape / absolute rejected, basename-only default), with the agent-wiring audit clean (0 dead / drift / schema-gap). **BWB WEEKLY RECAP RELIABILITY (R125+52.28 → .30):** the weekly recap render pipeline got three fail-safe upgrades — (1) scene-image fingerprint hygiene plus a FAIL-LOUD guard so a declared-but-missing image can never silently bake a generic substitute; (2) named-photo weaving — Felix can now slot any photo dropped in the Drive folder into the recap by name via a new `photos` param, fail-loud if the name isn't found; (3) an up-front narration-time forecast plus a post-delivery scene-image auto-cleanup gated on confirmed delivery success so a prior week can't bleed into the next. No new tools / tables / personas / skills / capabilities; all counts unchanged. tsc clean, unit tests green, architect PASS. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_30") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **32 (.agents) + 62 (db) + 38 (output-skills) = 132 reference surfaces**, **16 personas**, **198 tables**, **581 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+52.26 → +52.30 are correctness + reliability rounds (two whole-app code reviews + the BWB weekly-recap reliability suite); no new tools / tables / personas. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_30") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.25 (2026-06-13) — DEMOTED (rose): whole-app code review closed 2 HIGH (MoA jury spend no longer pollutes the metered-Anthropic breaker; cold-empty completion on the autonomous path now emits a non-empty fallback) + 2 MEDIUM (experiments-run tenant scope, self-improvement tenant guards). No count changes. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_25")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/15 via-primary/5 to-transparent border border-rose-500/40 hover:border-rose-500/60 hover:bg-rose-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_25"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+52.25</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_25") ? "" : "line-clamp-2"}`}>{"R125+52.25 — **A whole-app code review closed two HIGH and two MEDIUM findings — all cost-governance and isolation correctness, no new counts.** **SECURITY/COST (HIGH #1 — jury spend no longer pollutes the metered-Anthropic breaker):** the multi-model jury's Claude spend was being counted toward the daily metered-Anthropic spend ceiling because it was logged under a name the breaker's exempt-lane check didn't recognize — so heavy jury use could trip the breaker early and throttle genuinely-metered everyday work. Jury cost is now flagged exempt at the source while the billing ledger still records the real 5× cost, so the breaker protects only the spend it's meant to. **CORRECTNESS (HIGH #2 — no more blank autonomous turns):** if a model ever returned zero text and zero tool calls on a background/scheduled/webhook turn, the safety net only caught the case where tools had run — a truly-empty completion could persist a blank reply. The final guard now always emits a deterministic non-empty fallback. **MEDIUM ×2:** the admin experiment-runner route now passes its tenant scope (was a 500), and two self-improvement reads tightened their tenant checks to reject zero/negative ids. No new tools/tables/personas/skills/capabilities; all counts unchanged. tsc clean, 26/26 cost-ledger tests, wiring audit exit 0, second architect pass PASS. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_25") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **32 (.agents) + 62 (db) + 38 (output-skills) = 132 reference surfaces**, **16 personas**, **198 tables**, **581 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+52.25 is a code-review hardening round: jury spend no longer pollutes the metered-Anthropic breaker, cold empty completions get a non-empty fallback, + 2 tenant-scope fixes; no new tools/tables/personas. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_25") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.24 (2026-06-13) — DEMOTED (violet): whole-app + 72h security review closed 1 HIGH (metered-Anthropic breaker now fails CLOSED on a guard/import error) + a fail-closed chat workspace-context tenant guard; R125+52.23 ships the tool-output compression-savings dashboard card. Tables 197→198, indexes 579→581 (current state). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_24")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/15 via-primary/5 to-transparent border border-violet-500/40 hover:border-violet-500/60 hover:bg-violet-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_24"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+52.24</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_24") ? "" : "line-clamp-2"}`}>{"R125+52.24 — **A whole-app + 72-hour security review closed one HIGH, and R125+52.23 shipped an honest tool-output compression-savings dashboard card.** **NEW (R125+52.23 — compression-savings card):** the type-aware tool-output compressor now records its REAL bill-impact on live traffic into a new `tool_compression_stats` table, surfaced as a card on `/admin/ecosystem-health`. The savings are reported HONESTLY — measured against the old head-slice baseline the compressor replaced, never against raw uncompressed output — so the figure is a truthful improvement number, not an inflated one (+1 table, +1 index). **SECURITY (R125+52.24 — HIGH: circuit breaker now fails CLOSED):** if the daily metered-Anthropic spend-ceiling guard ever threw on a guard/import error, the breaker previously proceeded UNCAPPED — it now fails CLOSED on any guard/import error so a routing or wiring fault can never silently run up a metered Anthropic bill; the high-value jury and flagship lanes stay exempt and reroute gracefully. Plus a fail-closed tenant guard in the chat workspace-context builder so context can never be assembled without a confirmed tenant. tsc clean, architect PASS. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_24") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **32 (.agents) + 62 (db) + 38 (output-skills) = 132 reference surfaces**, **16 personas**, **198 tables**, **581 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+52.23 adds the tool-output compression-savings card (tables 197→198, indexes 579→581) and R125+52.24 hardens the metered-Anthropic circuit breaker to fail CLOSED + adds a fail-closed chat workspace-context tenant guard; no new tools/personas. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_24") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.19 → +52.22 (2026-06-13) — DEMOTED (cyan): live "Instant AI Readiness Audit" at /audit + DNS-rebinding SSRF hardening + 3 cross-tenant read-leak closures. Tables 195→197, indexes 573→579 (current state). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_22")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/25 hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_22"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+52.22</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_22") ? "" : "line-clamp-2"}`}>{"R125+52.19 → +52.22 — **The /audit wedge became a live \"Instant AI Readiness Audit,\" backed by a security hardening + cross-tenant code-review sprint.** **NEW FEATURE (R125+52.20):** a new public `POST /api/public/audit/run` fetches a visitor-supplied website and returns a real scored report on the spot — scoring /100 across AI Access (35) / Structured Data (20) / Metadata (20) / Social (15) / Technical (10) → an A–F grade with concrete recommendations, persisted to the `audit_reports` table. **SECURITY #1 (R125+52.20 — SSRF / DNS-rebinding TOCTOU):** the SSRF jail validated the resolved IP but `fetch()` re-resolved at connect time — closed by pinning the validated resolved addresses through an undici `Agent` `connect.lookup` override (every redirect hop re-pinned; TLS SNI/Host stay bound to the real hostname), and moving the rate-limit key off `req.ip` onto the raw TCP socket `remoteAddress`; +1 security regression suite. **SECURITY #2 (R125+52.22 — 3 cross-tenant read leaks closed):** `chat-engine` workspace-context was injecting ALL tenants' uploaded filenames and active-project names/customer/description into the prompt context (now tenant-scoped, fail-closed); self-improvement experiments SELECT scoped by category only (now tenant-scoped); and never-mounted chat scaffolding that hardcoded tenant 1 with zero isolation was deleted. **R125+52.21:** reusable verification + stop-condition prompt clauses baked into every deliverable plan. **R125+52.19:** the weekly BWB recap kept on Claude Opus 4.8 + made breaker-safe via a dedicated flagship cost lane. tsc clean, architect PASS. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_22") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **32 (.agents) + 62 (db) + 38 (output-skills) = 132 reference surfaces**, **16 personas**, **197 tables**, **579 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+52.19→+52.22 ships the live Instant AI Readiness Audit at /audit + DNS-rebinding SSRF hardening + 3 cross-tenant read-leak closures (tables 195→197, indexes 573→579 this round). _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_22") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.18 (2026-06-12) — DEMOTED (emerald): closed the metered-Opus cost leak from +52.17 + added a hard daily metered-Anthropic spend ceiling (jury exempt). No new tools/tables/personas; counts unchanged at 391 tools / 195 tables / 573 indexes. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_18")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/25 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_18"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+52.18</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_18") ? "" : "line-clamp-2"}`}>{"R125+52.18 — **Closed the metered-Opus cost leak from +52.17 and added a hard daily spending ceiling on metered Claude — the high-value jury is exempt.** Every remaining everyday, fallback, and autonomous path that could still reach Opus was swept onto free/cheap lanes, leaving Opus in the multi-model jury only. A daily metered-Anthropic spend ceiling now fails closed once the limit is hit, so a routing mistake can never run up a large bill again — and the jury is exempt via a dedicated jury-lane marker, so jury verdicts keep running even if the flat-rate Claude runner is down. A new 6-case regression suite pins this behavior. No new tools/tables/personas/skills; counts unchanged. Verification: tsc + build green, 6/6 ceiling tests pass, architect PASS. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_18") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **32 (.agents) + 62 (db) + 38 (output-skills) = 132 reference surfaces**, **16 personas**, **195 tables**, **573 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+52.18 is a cost-governance patch (Opus leak closed + hard daily metered-Anthropic ceiling, jury exempt); no new tools/tables/personas. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_18") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+52.16+sec (2026-06-11): default-model swap to Claude Opus 4 + whole-app/72h security review closing 1 HIGH + 2 MEDIUM. No new tools/tables/personas; counts unchanged at 391 tools / 195 tables / 573 indexes. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52_16")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-sky-500/10 via-primary/5 to-transparent border border-sky-500/25 hover:border-sky-500/40 hover:bg-sky-500/10 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52_16"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-sky-600 text-white leading-none shrink-0 mt-0.5">R125+52.16+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52_16") ? "" : "line-clamp-2"}`}>{"R125+52.16+sec — **Default reasoning model upgraded to Claude Opus 4, plus a whole-app + 72-hour security review that closed one HIGH and two MEDIUM findings.** **Model default:** `claude-fable-5` is demoted to last-resort only; `claude-opus-4-8` is now the platform's default proposer/solver everywhere. **HIGH #1 (exec deny-floor bypass):** the owner-only shell tool's catastrophic-command floor anchored on a literal `/`, so a quoted or escaped root target (`rm -rf \"/\"`, `'/'`, `\\/`) slipped past it — command normalization now unescapes backslashes and strips quotes BEFORE the safety match, so every quoted root form hits the deny floor (regression cases added; exec suites 4/4 + 12/12 green). **MEDIUM #1 (workspace containment):** three naive prefix checks were replaced with a boundary-safe `isWithinWorkspace()` (exact-root or root+separator), closing a `workspace-evil` sibling-prefix escape. **MEDIUM #2 (cross-tenant archive write):** the conversation-delete archive now JOINs projects and filters by tenant, so it can only write into a same-tenant project — closing the deferred cross-tenant gap. Plus a loud warning on unknown-model fallthrough so silent wrong-model/wrong-cost routing is now visible. 5 parallel architect passes over the ~85-file window + agent-wiring audit exit 0; confirming architect PASS with 0 CRITICAL/HIGH. No new tools/tables/personas/skills; counts unchanged. _(model: anthropic/claude-opus-4)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52_16") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **32 (.agents) + 62 (db) + 38 (output-skills) = 132 reference surfaces**, **16 personas**, **195 tables**, **573 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+52.16+sec swaps the default model to Claude Opus 4 and closes 1 HIGH + 2 MEDIUM security findings (exec deny-floor quoted-root bypass, workspace containment, cross-tenant archive write); no new tools/tables/personas. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52_16") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+48→+52.5 (2026-06-09) — DEMOTED (amber): autonomous cost governance (escalation resolver + jury→implement loop + hard daily spend ceiling) + flat-rate OAuth model routing + shadow-mode jury experience library + full 72h review. +1 table (jury_experiences); tools UNCHANGED at 391. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_52")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_52"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+52.15</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_52") ? "" : "line-clamp-2"}`}>{"R125+48 → +52.15 — **The platform learned to drive its own backlog to done — without ever running up a surprise bill — then spent a full sprint hardening the machinery that does it.** **Autonomous cost governance:** a new Escalation Resolver pushes the stuck `repair_incidents` backlog to terminal states through the jury (R125+49), a jury→implement loop auto-applies approved fixes with a new Climb Tracker telemetry card (R125+48), and a NEW autonomous-spend governor puts a HARD daily cost ceiling on every background loop — owner-only, fail-CLOSED, $25/day default — so self-running work can never silently burn paid LLM budget (R125+50). **Flat-rate model routing:** high-end models now bill Bob's flat-rate OAuth subscriptions instead of metered per-token keys wherever possible (R125+51), including a Claude Runner CLI bridge that routes Anthropic inference through the Max plan (R125+52); the canonical frontier jury is now a declared 4-model top-tier set (R125+52.1/.2). **Jury experience library (SHADOW MODE):** a Training-Free GRPO experience library (arXiv:2510.08191, Tencent/Youtu-Agent) distills a comparative lesson from every divergent jury vote into a NEW `jury_experiences` table — collecting now, NOT yet injected, behind a single grep-able go-live anchor (R125+52.4); the jury vote math also became a dynamic strict-majority so a tie ESCALATEs and auto-apply requires unanimity (R125+52.3). **Full whole-app + 72h code review (R125+52.5): 0 new actionable findings.** **Self-hardening sprint (R125+52.6 → +52.15):** the jury queue that votes on and auto-applies the platform's own code fixes is now replay-proof (HMAC + an out-of-tree `jury_drain_ledger`) and race-proof (a shared advisory-lock writer + a claim-first drainer, including a lost-entry-race fix), and the headless-browser tool re-validates every URL after each action to close an SSRF gap — every fix architect FAIL→FIX→PASS with a clean wiring audit (+1 table `jury_drain_ledger`)."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_52") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **32 (.agents) + 62 (db) + 38 (output-skills) = 132 reference surfaces**, **16 personas**, **195 live tables**, **573 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+48→+52.15 adds the shadow-mode jury experience library, autonomous cost governance, flat-rate model routing, and a self-hardening security sprint (jury-queue replay/race hardening + browser SSRF revalidation, +1 table `jury_drain_ledger`); no new tools/personas (live aggregate resynced — tables → 195, indexes → 573). _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_52") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+47 (2026-06-08) — DEMOTED (emerald): Delivery Funnel telemetry (produce→ship→adopt) + whole-app/sensitive/72h review closing 2 MEDIUMs. +1 table, +2 indexes; live aggregate resynced to 192 tables / 564 indexes. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_47")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_47"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+47</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_47") ? "" : "line-clamp-2"}`}>{"R125+47 — **NEW Delivery Funnel telemetry: the platform now measures its own produce → ship → adopt funnel.** Inspired by 2026 research (SSRN 6859839, MIT) showing AI lifts code *production* far more than shipping or adoption — so the weak links are delivery + uptake, not generation. A new `delivery_engagement` table + a fire-and-forget recorder logs each produced deliverable and, via a hook in the `/uploads` auth middleware, the first confirmed fetch of a delivered file; a tenant-scoped 90-day CTE computes the funnel and surfaces it as a Delivery Funnel card on `/admin/ecosystem-health`. **Honesty-first:** `adopted` counts ONLY confirmed 200/206 initial fetches of `/uploads/delivery-N-*` files (instant-play `/watch` views use unlinked tokens), so it's a documented FLOOR, never a fabricated signal; a `degraded` flag shows an amber 'telemetry unavailable' banner instead of faking healthy zeros. **Whole-app + sensitive-surface + 72h review (3 parallel architect passes): NO CRITICAL/HIGH, wiring audit CLEAN, 2 MEDIUM closed** — the `/uploads` ownership check made deterministic (fetch-all-owners + membership) and ownerless delivery assets now REQUIRE the signed capability URL (closes a bearer-session + guessable-id cross-tenant read); plus the funnel `degraded` flag. Architect FAIL→FIX→PASS (adoption recorded only on the FINAL 200/206 status)."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_47") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **32 (.agents) + 62 (db) + 39 (output-skills) = 133 reference surfaces**, **16 personas**, **192 live tables**, **564 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+47 adds the Delivery Funnel (+1 table `delivery_engagement`, +2 indexes) and resyncs the live aggregate (tables → 192, indexes → 564, output-skills → 39); no new tools/personas. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_47") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+46+sec (2026-06-07) — DEMOTED (blue): Whole-app + all-sensitive + 72h thorough code review. No CRITICAL/HIGH; 3 MEDIUM closed; +1 index (557 → 558). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_46sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-blue-500/15 via-primary/5 to-transparent border border-blue-500/40 hover:border-blue-500/60 hover:bg-blue-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_46sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-blue-600 text-white leading-none shrink-0 mt-0.5">R125+46+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_46sec") ? "" : "line-clamp-2"}`}>{"R125+46+sec — **Whole-app + all-sensitive-surfaces + 72h thorough code review (3 parallel architect passes by surface + agent-wiring audit CLEAN).** NO CRITICAL/HIGH. Core recent work (multi-tenant config-forking, SSRF jail IPv4-mapped-IPv6 fix, public-API tools, BWB preflight, live job-progress card, positional-salience reorder) confirmed correct. **3 MEDIUM closed:** (1) `tenants.forked_from` got an index (`idx_tenants_forked_from`); (2) the BWB recap preflight's binary probes now scrub the spawn environment (loader-hijack hygiene); (3) stale current-state stat strings re-synced on the landing/pricing/SEO surfaces (R-round-tagged snapshots left frozen). The BWB job-progress tenant-scope was triaged ACCEPTED (pins an unguessable job id + tenant-when-known, warns loudly; forcing mandatory-tenant would silently drop the progress card). Architect re-verify PASS. Verified: `tsc` clean, build green, tests 5+11+6+52 pass."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_46sec") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **32 (.agents) + 62 (db) + 37 (output-skills) = 131 reference surfaces**, **16 personas**, **189 live tables**, **558 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+46+sec is a review/hardening round; +1 index (557 → 558), all other stats UNCHANGED. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_46sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+46 (2026-06-07) — Multi-tenant config-forking — atomic, fail-closed tenant on-ramp. 0 new tools/tables/personas (+1 forked_from col). Stats UNCHANGED at 391. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_46")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/15 via-primary/5 to-transparent border border-violet-500/40 hover:border-violet-500/60 hover:bg-violet-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_46"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+46</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_46") ? "" : "line-clamp-2"}`}>{"R125+46 — **Multi-tenant config-forking: spin up a fresh tenant pre-loaded with an existing tenant's curated configuration, in one atomic, fail-closed transaction.** A new tenant inherits a proven tenant's whole config — personas config, trust-tier `tool_policies`, per-persona `autonomy_rules`, voice/skill prefs, and the rest of an explicit 11-table config allowlist — instead of being hand-rebuilt. Surfaced as an admin route (`POST /api/admin/tenants/fork`, Zod-validated) + operator CLI (`scripts/fork-tenant.ts`). **Fail-closed:** only `FORKABLE_CONFIG_TABLES` allowlist tables copy (nothing by default); `custom_tools` deliberately EXCLUDED after architect review because `custom_tools.name` has a GLOBAL unique constraint a blind copy would violate. The whole clone runs in ONE transaction (all-or-nothing — no half-created rows on failure), every INSERT passes the destination `tenantId`, the source tenant is read-only — verified no cross-tenant leakage on a 104-row dev fork. Architect PASS. Verified: `tsc` clean, build green, 6/6 fork tests, e2e on dev DB."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_46") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 38 (output-skills) = 131 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+46 adds a feature (+1 nullable `forked_from` provenance col on `tenants`); all stats UNCHANGED. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_46") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+38+sec (2026-06-06) — DEMOTED (cyan): Full-app + 72h post-edit review — 1 HIGH + 2 MEDIUM closed, 1 FALSE POSITIVE. Stats UNCHANGED at 391. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_38sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/15 via-primary/5 to-transparent border border-cyan-500/40 hover:border-cyan-500/60 hover:bg-cyan-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_38sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+38+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_38sec") ? "" : "line-clamp-2"}`}>{"R125+38+sec — **Full-app + 72h post-edit code review (2 parallel architect passes by surface + agent-wiring audit GREEN at 391 tools, 0 dead/drift/leak/orphan/schema-gap + preflight stale-strings CLEAN) — 1 HIGH + 2 MEDIUM closed; 1 FALSE POSITIVE.** **HIGH (self-repair backtest false-green):** the architect-incident-backtest CLI relied on a never-throwing aggregator, so a DB error returned an empty result and the CLI reported the all-clear 'no incidents' exit instead of failing; an opt-in throwOnError channel now surfaces DB errors to the CLI (exit 1) while preserving never-throw for the dashboard. **MEDIUM #1 (ecosystem-health guard):** the self-improvement metrics entry now rejects a non-positive tenant id before any query. **MEDIUM #2 (public-API SSRF):** the live-data pack's fetch helper replaced redirect-follow + post-hoc host check with a bounded manual-redirect loop that re-validates host + resolved IP + https before every hop (max 4). **FALSE POSITIVE:** the CI self-healer's execSync env inheritance is trusted internal tooling that needs its secrets; the untrusted sandbox path spawns no child processes. Verified: `tsc` clean, public-api + self-improvement tests pass, app boots clean."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_38sec") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+38+sec is a security/review round; all stats UNCHANGED. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_38sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+38 (2026-06-06) — DEMOTED (teal): Self-Improvement Loop metric — self-repair catch-rate made measurable. 0 new tools/tables. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_38")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-teal-500/10 via-primary/5 to-transparent border border-teal-500/30 hover:border-teal-500/50 hover:bg-teal-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_38"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-teal-600 text-white leading-none shrink-0 mt-0.5">R125+38</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_38") ? "" : "line-clamp-2"}`}>{"R125+38 — **New Self-Improvement Loop metric — the platform's self-repair catch-rate is now measurable (Anthropic 'When AI builds itself'-inspired; 0 new tools/tables/personas).** A new read-only, tenant-scoped aggregator computes catch-rate (resolved/total incidents), escalation rate, fail-closed safety-hold count, per-classification blind spots, and a 30-day-vs-prior-30-day trend over the most recent 500 incidents in the real `repair_incidents` ledger, anchored to the essay's ~1/3 automated-catch benchmark. Surfaced as a new **Self-Improvement Loop** card on `/admin/ecosystem-health` (mirrors the Orchestration Efficiency card) plus an operator-runnable backtest script. `tsc` clean; build clean."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_38") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+38 adds 0 tools/tables (read-only metric + dashboard card). _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_38") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+37 (2026-06-06) — DEMOTED (indigo): New generate_design_doc(url) tool — URL → semantic DESIGN.md. Tools 390 → 391. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_37")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-indigo-500/10 via-primary/5 to-transparent border border-indigo-500/30 hover:border-indigo-500/50 hover:bg-indigo-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_37"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-indigo-600 text-white leading-none shrink-0 mt-0.5">R125+37</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_37") ? "" : "line-clamp-2"}`}>{"R125+37 — **New `generate_design_doc(url)` tool — turns any public URL into a semantic DESIGN.md (refero.design-inspired, no external dependency; tools 390 → 391).** Fetches a page's HTML + up to 3 same-origin CSS files through the SSRF jail (https-only, private/metadata/loopback blocked, size + time caps), strips scripts, fences the untrusted payload, then runs one balanced-tier LLM pass that synthesizes a structured design language: color roles + relationships, type scale, spacing rhythm, component patterns, voice, and reuse do/don'ts. Never-throws; optional persist writes `project-assets/design-docs/<host>-DESIGN.md`. Wired across all 5 registration points and surfaced to all 16 personas. New 3-test suite. `tsc` clean; build clean."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_37") ? "" : "truncate"}`}>{"**391 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+37 adds 1 tool (390 → 391). _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_37") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+36+sec (2026-06-05) — DEMOTED (blue): Full-app + 72h post-edit review — 2 HIGH + 2 MEDIUM closed. Stats UNCHANGED at 390. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_36sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-blue-500/10 via-primary/5 to-transparent border border-blue-500/30 hover:border-blue-500/50 hover:bg-blue-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_36sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-blue-600 text-white leading-none shrink-0 mt-0.5">R125+36+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_36sec") ? "" : "line-clamp-2"}`}>{"R125+36+sec — **Full-app + 72h post-edit code review (architect pass + confirming re-pass + agent-wiring audit GREEN at 390 tools, 0 dead/drift/leak/orphan/schema-gap + preflight stale-strings CLEAN) — 2 HIGH + 2 MEDIUM closed.** **HIGH #1 (self-repair ESM break):** the Guarded Repo Surgeon's source-reader used an inline `require('node:fs')` that throws in the ESM build, silently disabling its source-reading path; replaced with a top-level import. **HIGH #2 (public tool-count drift):** R125+35 bumped tools 384 → 390 but left current-state counts at 384 across index.html, seo-head, and the landing/about/pricing/audit pages; all current-state claims resynced to 390 (historical per-round snapshots preserved). **MEDIUM #1 (public-API DNS-rebinding):** the live-data pack host-locked the request but never validated the resolved IP; added a fail-closed resolve-and-check guard pre-fetch and post-redirect. **MEDIUM #2 (silent wrong-model routing):** the model-client resolver missed OpenRouter-style prefixed ids so ~7 callers silently fell through to the Anthropic default; added a guarded prefix-strip re-lookup. Verified: `tsc` clean, preflight CLEAN, public-api 7/7."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_36sec") ? "" : "truncate"}`}>{"**390 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+36+sec is a security/review round; all stats UNCHANGED. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_36sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+35 (2026-06-05) — DEMOTED (fuchsia): Agenvoy-inspired public-API live-data pack — 6 free read-only tools. Tools 384 → 390. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_35")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-fuchsia-500/10 via-primary/5 to-transparent border border-fuchsia-500/30 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_35"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-fuchsia-600 text-white leading-none shrink-0 mt-0.5">R125+35</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_35") ? "" : "line-clamp-2"}`}>{"R125+35 — **Agenvoy-inspired public-API live-data pack — 6 free, no-auth, read-only tools wired to all 16 personas (tools 384 → 390).** A small pack of read-only public-data tools (no API key required) gives every persona live reference data inline, each behind the platform's SSRF guard, per-tool rate ceilings, and host allowlist. `tsc` clean; build clean."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_35") ? "" : "truncate"}`}>{"**390 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+35 adds 6 tools (384 → 390). _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_35") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+34+sec (2026-06-05) — DEMOTED (emerald, no NEW): Full-app + 72h post-edit review — 1 HIGH + 1 LOW closed (heartbeat maintenance-cron spawn env-scrubbed). Stats UNCHANGED. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_34sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_34sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+34+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_34sec") ? "" : "line-clamp-2"}`}>{"R125+34+sec — **Full-app + 72h post-edit review (4 parallel architect passes by surface + a confirming re-pass + agent-wiring audit GREEN at 384 tools, 0 dead/drift/leak/orphan/schema-gap + preflight stale-strings CLEAN) — 1 HIGH + 1 LOW closed.** **HIGH (heartbeat maintenance-cron spawn):** the scheduled maintenance runner spawned its `npx` child with the raw process environment, leaking loader-hijack vars (LD_*/DYLD_*/NODE_OPTIONS/NODE_PATH) and every secret into a privileged cron child whose output is tailed into incident logs; the spawn now strips that env via `sanitizeSpawnEnv`, at parity with the backup-push spawn already hardened in the same file (PATH retained so npx still resolves). **LOW:** stale 'latest sweep' security copy on the landing page resynced. Verified: `tsc` clean, preflight stale-strings CLEAN, agent-wiring audit exit 0."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_34sec") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+34+sec is a security/review round; all stats UNCHANGED. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_34sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+33 (2026-06-05) — DEMOTED (violet, no NEW): Added xAI direct model Grok Build 0.1 (reasoning + agentic coding) to the core model registry, tested-before-register. Curated models 40 → 41. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_33")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/15 via-primary/5 to-transparent border border-violet-500/40 hover:border-violet-500/60 hover:bg-violet-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_33"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+33</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_33") ? "" : "line-clamp-2"}`}>{"R125+33 — **Added a new xAI direct model — Grok Build 0.1 (reasoning + agentic coding) — to the core model registry, tested-before-register.** Confirmed live on xAI's API (present in the model list, returns a 200 chat completion, emits reasoning content) both via the raw API and through the app's own model-client path, then registered in the model registry + max-output map. It routes over the existing xAI direct path (`XAI_API_KEY` \u2192 api.x.ai) and surfaces in the model picker because the xAI provider is already enabled. `tsc` clean."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_33") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **41 curated AI models** (+1000+ daily discovery) \u2014 40 \u2192 41, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 \u2014 R125+33 adds 1 curated model, 0 tools/tables. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_33") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+32+sec (2026-06-05) — (emerald): Full-app + 72h post-edit review — 1 HIGH-class + 2 MEDIUM + 1 LOW closed; loop-until-clean PASS. Stats UNCHANGED. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_32sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/15 via-primary/5 to-transparent border border-emerald-500/40 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_32sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+32+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_32sec") ? "" : "line-clamp-2"}`}>{"R125+32+sec — **Full-app + 72h post-edit review (4 parallel architect passes by surface + a confirming re-pass + agent-wiring audit GREEN at 384 tools, 0 dead/drift/leak/orphan/schema-gap + preflight stale-strings CLEAN) — 1 HIGH-class + 2 MEDIUM + 1 LOW closed; loop-until-clean PASS.** **HIGH (model-catalog cross-tenant dedupe bleed):** the model-watcher's dedupe read of catalog history lacked a tenant filter while its paired write was already tenant-scoped, so one tenant's catalog history could suppress another tenant's new-model alerts; the read is now scoped to the same tenant (parity restored). **MEDIUM #1 (owner-notify fork-safety):** a hardcoded placeholder owner email could page a bogus address on a fork; it now resolves the real owner address and fail-safe skips the send when unset, at parity with the other owner-alert modules. **MEDIUM #2 (test-gate coverage):** four skill-pipeline test suites existed but weren't wired into CI; they now run on every pass. **LOW (type-safety):** removed untyped email casts. `tsc` clean."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_32sec") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 \u2014 R125+32+sec is a security/review round; all stats UNCHANGED. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_32sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+31+sec2 (2026-06-04) — DEMOTED (sky, light): Follow-up full-app + 72h post-edit review (4 architect passes + wiring audit GREEN) — 1 MEDIUM closed (repo-surgeon autofix HITL gate widened to aggregator modules). Stats UNCHANGED. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_31sec2")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-sky-500/10 via-primary/5 to-transparent border border-sky-500/30 hover:border-sky-500/50 hover:bg-sky-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_31sec2"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-sky-600 text-white leading-none shrink-0 mt-0.5">R125+31+sec2</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_31sec2") ? "" : "line-clamp-2"}`}>{"R125+31+sec2 — **Follow-up full-app + 72h post-edit code review (4 parallel architect passes + agent-wiring audit GREEN at 384 tools, 0 dead/drift/leak/orphan/schema-gap) — 1 MEDIUM closed; 0 CRITICAL/HIGH.** **MEDIUM (self-repair autofix HITL gate widened):** the Guarded Repo Surgeon's sensitive-surface detector matched payment/auth/schema/safety files by path token but MISSED the broad aggregator modules that carry auth, payment, session, and tool-routing logic in a single file — so an opt-in autofix touching them could land without owner sign-off. Those modules (server/routes.ts, server/routes/, server/tools.ts, server/chat-engine.ts, server/replitAuth.ts, server/guarded-tool-executor.ts) are now in the gate; the gate is monotonic (it only ever ADDS a pause, so the change is fail-safe). Repo-surgeon suite 22/22 green. Verified: `tsc` clean, preflight stale-strings CLEAN, agent-wiring audit exit 0."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_31sec2") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+31+sec2 is a security/review round; all stats UNCHANGED. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_31sec2") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+31+sec (2026-06-04) — DEMOTED (rose, no NEW): Full-app + 72h post-edit review (5 architect passes + wiring audit + confirming re-pass) — 1 HIGH + 1 MEDIUM closed, loop-until-clean PASS. Stats UNCHANGED. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_31sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/15 via-primary/5 to-transparent border border-rose-500/40 hover:border-rose-500/60 hover:bg-rose-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_31sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+31+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_31sec") ? "" : "line-clamp-2"}`}>{"R125+31+sec — **Full-app + 72h post-edit code review (5 parallel architect passes + agent-wiring audit GREEN at 384 tools, 0 dead/drift/leak/orphan + a confirming re-pass) — 1 HIGH + 1 MEDIUM closed; loop-until-clean PASS; 0 CRITICAL.** **HIGH #1 (autonomous skill build, fail-OPEN on a degraded jury):** the 3-model jury that decides whether an agent-authored skill goes live was counting an ABSTAIN from a juror whose model call had errored toward the quorum — so two BUILD votes plus one errored juror could ship a global skill on a degraded panel. The quorum now counts ONLY jurors who actually returned a verdict, and a panel with fewer than three live votes escalates to the owner before any tally — restoring the fail-CLOSED invariant. **MEDIUM #1 (streaming tool-call merge):** when a model streamed a second tool call whose arguments arrived before its name, right after a call that had no id, the two could merge into one corrupted call; a real incoming id is now authoritative over a prior synthetic slot (new regression test). **Honesty fix:** customer delivery links request a 90-day life but the signer caps them at 7 days — now documented as the real effective window. Verified: confirming architect re-pass PASS (no new regressions), `tsc` clean, accumulator 9/9, jury 19/19."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_31sec") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+31+sec is a security/review round; all stats UNCHANGED. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_31sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+30 (2026-06-03) — DEMOTED (amber, no NEW): Full-app + 72h post-edit review — 2 HIGH + 1 MEDIUM closed, all pre-existing. Stats unchanged. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_30")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_30"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+30</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_30") ? "" : "line-clamp-2"}`}>{"R125+30 — **Full-app + 72h post-edit code review (3+1 parallel architect passes + agent-wiring audit GREEN at 384 tools) — 2 HIGH + 1 MEDIUM closed, all pre-existing (none introduced in the prior 72h); 0 CRITICAL.** **HIGH #1 (delivery email, signed-link corruption):** the customer delivery email appended player/download flags to an already-signed link, pushing a second `?` into the signature and 401-ing customers; fixed to append the flag with the correct separator. **HIGH #2 (skillify trust gap):** the manual skillify path promoted LLM-distilled text into the LIVE global skill registry with no sanitize/length cap — the jury reviewed a separately-defanged copy, so an injection payload in the source conversation could land verbatim in a global skill prompt; it is now sanitized + length-capped BEFORE the jury AND before insert (parity with `propose_skill`). **MEDIUM #1 (browser SSRF guard):** the browser tool's private-IP check blocked only one IPv6 link-local prefix, missing the rest of the link-local range plus multicast; now at parity with the structured-extraction guard (new 5-test SSRF suite). Verified: `tsc` clean, wiring audit GREEN."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_30") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — security/review round; all stats UNCHANGED. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_30") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+29 (2026-06-03) — DEMOTED (emerald, no NEW): Full-app + 72h post-edit code review (4 parallel architect passes + wiring audit GREEN) — illusory-coverage fix + 3 fail-closed hardenings. Indexes resynced 554→557. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_29")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_29"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+29</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_29") ? "" : "line-clamp-2"}`}>{"R125+29 — **Full-app + 72h post-edit code review (4 parallel architect passes + agent-wiring audit GREEN at 384 tools, 0 dead/drift/orphan) — illusory-coverage fix + 3 fail-closed hardenings; 0 true CRITICAL.** **Illusory test coverage closed:** three model-tier unit suites imported `vitest` (not a dependency here), so they silently never ran — a `node:test` matcher shim was added and all three were wired into CI, so 64 assertions now actually execute. **Three fail-closed hardenings:** (1) `propose_skill` now gates on the exported `skillBuildApproved()` predicate instead of a bare string compare (parity with the skillify path); (2) the customer order-page app-play link is now a SIGNED relative `/uploads` capability URL (was unsigned + forwarded-host-derived → 401 for anonymous customers + header trust), with the player/download flags appended without corrupting the signature; (3) the weekly Model Tier Refresh now FAILS CLOSED on a corrupt overlay (was a silent catch that could drop overlay-backed live models). Verified: `tsc` clean, AHB 52/52, redact-args 5/5."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_29") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes** (resynced from 554 against the live count), **41 governance rules**, MCP scopes 5, MCP tools 12. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_29") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+28 (2026-06-03) — DEMOTED (violet, no NEW): every skill-enable path (auto AND manual) behind the same jury gate; no human review queue. Stats unchanged. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_28")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_28"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+28</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_28") ? "" : "line-clamp-2"}`}>{"R125+28 — **Every skill-enable path — automatic capture AND the manual `skillify` tool — is now behind the SAME 3-frontier-model jury gate; no human review queue, no carve-out.** Both paths funnel through a single insert chokepoint: a majority BUILD inserts the skill live and enabled, a majority REJECT drops it, and any no-clear-majority / jury-error / under-quorum outcome fails CLOSED to an owner escalation (the only human touchpoint). A new exported `skillBuildApproved()` predicate makes the 'only a BUILD verdict inserts' rule one tested function shared by both paths (19 unit tests). The architect flagged gating the manual tool as a behavior change and a bypass carve-out was added — but per owner direction the carve-out was removed: everything is gated. Verified: `tsc` clean, app boots clean."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_28") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_28") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+27 (2026-06-03) — DEMOTED (sky, no NEW): jury-gated autonomous skill build (strict 2-of-3 frontier vote, injection-defanged); no human review queue. Stats unchanged. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_27")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-sky-500/10 via-primary/5 to-transparent border border-sky-500/30 hover:border-sky-500/50 hover:bg-sky-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_27"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-sky-600 text-white leading-none shrink-0 mt-0.5">R125+27</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_27") ? "" : "line-clamp-2"}`}>{"R125+27 — **Jury-gated autonomous skill build — agent-authored skill proposals no longer park in a human review queue.** A strict 2-of-3 frontier-model jury (BUILD/REJECT prompt, line-anchored verdict parser) gates every proposal: a majority BUILD inserts the skill live into the global registry with no human in the loop, a majority REJECT drops it, and a 2-2 split / jury-error / too-short body / under-quorum fails CLOSED to an owner escalation. The untrusted proposal body is injection-defanged (role-impersonation / instruction-override / ANSI) before it reaches the jury, and a `proposed_skills` audit row is written either way. 16 unit tests; architect HIGH fixed and retested. Verified: `tsc` clean."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_27") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_27") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+26 (2026-06-03) — DEMOTED (teal, no NEW): ranking-driven model auto-adoption in the weekly Model Tier Refresh (fail-closed matching, never misroutes). Stats unchanged. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_26")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-teal-500/10 via-primary/5 to-transparent border border-teal-500/30 hover:border-teal-500/50 hover:bg-teal-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_26"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-teal-600 text-white leading-none shrink-0 mt-0.5">R125+26</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_26") ? "" : "line-clamp-2"}`}>{"R125+26 — **Ranking-driven model auto-adoption in the weekly Model Tier Refresh.** Each week the refresh now PROMOTES the top-K closed (frontier) AND top-K open-weight LLMs by Artificial Analysis intelligence index into the routable OpenRouter overlay — not just grading the current registry — and RETIRES stale auto-ranked entries no longer in the top set (source + response shape verified live, 529 models). Routing-safety invariants: per-entry fail-CLOSED matching (an ambiguous fuzzy match is skipped, never misrouted), no duplication of registry/overlay incumbents, never touches manual / watchlist / live-tier entries, an atomic overlay write, and fail-OPEN orchestration (ranking source down or overlay corrupt ⇒ no-op). Top-K configurable; owner notified of every add/retire. 20 unit tests; architect HIGH (ambiguity fail-closed) fixed and retested. Verified: `tsc` clean."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_26") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **557 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_26") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+25 (2026-06-02) — DEMOTED (cyan, no NEW): Full-app + 72h post-edit review — credential-exposure in tool-block telemetry closed fail-closed (1 HIGH); 2 HIGH + 2 MEDIUM deferred as tracked dormant known gaps. Stats unchanged (189 tables, 554 indexes). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_25")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_25"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+25</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_25") ? "" : "line-clamp-2"}`}>{"R125+25 — **Full-app + 72h post-edit review (4 parallel architect passes by surface + a confirming pass) — 0 CRITICAL / 3 HIGH / 2 MEDIUM; agent-wiring audit GREEN (384 tools, 0 dead/drift/trusted-leak/orphan/schema-gap).** **1 HIGH fixed fail-closed (credential exposure):** the tool-block telemetry redactor (`redactArgs`) was masking secret-like keys *after* a length-truncation branch, so a long `token`/`apiKey` value could leak its first 60 characters into the `security_tool_blocks` audit row; it now redacts secret keys FIRST, so no secret value can ever reach the truncation path (helper exported + a 5-case regression test added). **2 HIGH deferred — already-tracked, dormant known gaps, NOT new regressions:** the self-repair diff-guard's lexical bypass and the render-farm full-buffer memory risk both live in code whose auto-apply is gated OFF by default with zero production callers (hard gate: close before that flag is ever enabled). **2 MEDIUM deferred → known gaps:** no integration test yet pins that the efficiency guard can't suppress an explicit jury/ensemble call, and the Drive-discovery body-read can stall after headers resolve. Verified: `tsc` clean, AHB 52/52, redact-args 5/5, confirming architect pass PASS."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_25") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **554 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_25") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+24 (2026-06-02) — DEMOTED (sky, no NEW): Agentic efficiency awareness — predicted-vs-actual orchestration telemetry + advisory heavy-loop guard + ecosystem-health card. Stats: +1 table (188→189), +2 indexes (now 554). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_24")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-sky-500/10 via-primary/5 to-transparent border border-sky-500/30 hover:border-sky-500/50 hover:bg-sky-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_24"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-sky-600 text-white leading-none shrink-0 mt-0.5">R125+24</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_24") ? "" : "line-clamp-2"}`}>{"R125+24 — **Agentic efficiency awareness — the platform now measures whether reaching for a heavy AI loop was actually worth it** (inspired by recent research on the 'AI dependence loop', arXiv:2605.22687). Three parts: (1) a new `orchestration_efficiency` table records the *predicted* vs *actual* time and cost of every orchestration, so 'this saved me time' becomes a measured number instead of a vibe — all writes are fire-and-forget and never block the live request; (2) a cheap, no-LLM advisory guard (`assessHeavyLoopWorth`) can down-route a trivially-doable request off the 4-model ensemble onto the direct path — it is advisory + fail-open and NEVER touches an explicit jury/ensemble tool call the user asked for; (3) a new **Orchestration Efficiency** card on the ecosystem-health dashboard shows the median predicted-vs-actual gap, how many heavy loops ran, and how often the guard advised the direct path. Adds 1 table (188 → 189) + 2 indexes (now 554). Verified: `tsc` clean, 9 unit tests, architect PASS."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_24") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **189 live tables**, **554 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_24") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+23 (2026-06-02) — DEMOTED (cyan, no NEW): Full-app + 72h post-edit security review (4 parallel architect passes), 0 CRITICAL / 3 HIGH / 6 MEDIUM, wiring audit GREEN; 3 fixed fail-closed. Stat resync: .agents skills 32→31 (128→127 reference surfaces), indexes 552→553. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_23")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_23"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+23</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_23") ? "" : "line-clamp-2"}`}>{"R125+23 — **Full-app + 72h post-edit security review (4 parallel architect passes by surface + a silent-failure lens + a confirming pass) — 0 CRITICAL / 3 HIGH / 6 MEDIUM; agent-wiring audit GREEN (384 tools, 0 dead/drift/orphan/schema-gap).** Three issues fixed fail-closed in-round: (a) **tenant-isolation** — the `assertProjectInTenant` / `assertConversationInTenant` ownership helpers are now wired at the 3 LLM-reachable project-scoped INSERT sites that had missed them (`create_slides` conversation→project link + both `mpeg-engine` `project_files` writes; skip + step-note on a foreign id), so a caller can never write a row into another tenant's project; (b) the `providers` invalid-prefix warning **no longer logs a decrypted key prefix**; (c) added **`idx_agent_knowledge_tenant_source`** for the paper-ingest idempotency query. **Stale-stat resync:** `.agents` operational-runbook skills corrected **32 → 31** against the live `_registry.json` (reference surfaces **128 → 127**) and indexes **552 → 553** (+1 from the new index). Remaining tenant-audit sites + render-farm OOM + repo-surgeon HITL stay tracked as known gaps. Verified: `tsc` clean, AHB 52/52, upload-callsite lock-in + paper-ingest tests green, confirming architect pass PASS."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_23") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **188 live tables**, **553 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_23") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+22 (2026-06-01) — DEMOTED (violet, no NEW): Autonomous self-repair stack — the platform now repairs itself, with the owner in control. Stats: capabilities 121→126, tables 185→188, indexes 542→552. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_22")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_22"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+22</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_22") ? "" : "line-clamp-2"}`}>{"R125+22 — **Autonomous self-repair stack — the platform now repairs itself, with the owner in control.** **Incident capture + classifier (#51):** on any tool/CI/deliverable failure the platform classifies it (code_defect vs guard/safety vs transient) via heuristic-then-jury, persists it to the `repair_incidents` ledger, and routes it. **Guarded Repo Surgeon code-fix executor (#52):** diagnoses root cause, writes a MINIMAL diff, and verifies for real — typecheck → targeted tests → optional golden-path replay → re-run the failed tool — landing on green or rolling back on red. Three fail-closed invariants: NEVER weakens a guard/test/safety surface; auth/payments/schema/safety changes PAUSE for owner HITL; a durable 2-failed-attempts stop then escalates. Auto-apply is OPT-IN via `REPAIR_AUTOFIX_ENABLED` (default OFF — defects escalate to the owner, not silently rewritten). **Pipeline-checkpoint resume (#53):** long jobs persist each unit's artifact so a retry REUSES finished units and repairs only the first failed one (no duplicate INSERT/email/upload on resume), wired into the BWB weekly render as the proof case. **Owner incident ledger (#54):** `GET /api/admin/repair-incidents` — an owner-visible decision ledger (status/source/action filters); there is NO agent tool to trigger a repair, surfacing a clean failure IS the interface. **Security rounds R125+19/+22 — 10 MEDIUM closed, 0 HIGH/CRITICAL:** silent-failure regressions fixed fail-closed — **MEDIUM (media):** ffprobe sentinels now resolve to NaN/fail-closed instead of a deceptive 0; **MEDIUM (durable stop):** attempt-ledger reads return the cap on a DB error so the durable 2-attempts stop can't silently reset and loop forever; **MEDIUM (render):** render-orchestrator HTTP calls got AbortController timeouts so a hung upstream can't wedge a render. Verified: `tsc` clean, preflight stale-strings CLEAN, architect PASS."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_22") ? "" : "truncate"}`}>{"**384 tools**, **126 capabilities**, **32 (.agents) + 62 (db) + 34 (output-skills) = 128 reference surfaces**, **16 personas**, **188 live tables**, **552 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_22") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+16 (2026-05-31) — DEMOTED (emerald, no NEW): Chief-of-Staff jury access + trusted-tool wiring leak closed (leaks 1→0). Stats UNCHANGED. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_16")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_16"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+16</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_16") ? "" : "line-clamp-2"}`}>{"R125+16 — **Chief-of-Staff jury access + trusted-tool wiring leak closed.** Added a per-tool `extraAllowedPersonas` allowlist so a specific persona can be granted a trusted tool without widening the global trust tier, then used it to wire `jury_triage` (the 3-frontier-model 2-of-3 vote) to the Chief of Staff persona — closing the last trusted-tool wiring leak the agent-wiring audit had been flagging (leaks 1 → 0). Verified: AHB regression 50/50, `tsc` clean, preflight stale-strings CLEAN, agent-wiring audit exit 0, architect PASS. All stats UNCHANGED."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_16") ? "" : "truncate"}`}>{"**384 tools** (+ 4 MCP memory), **121 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **185 live tables**, **542 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+16 is a wiring/safety round; all stats UNCHANGED. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_16") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+15 (2026-05-31) — DEMOTED (teal, no NEW): Blackboard multi-agent coordination, built by extending the parallel findings bus (0 new tools/tables, +1 index 541→542). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_15")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-teal-500/10 via-primary/5 to-transparent border border-teal-500/30 hover:border-teal-500/50 hover:bg-teal-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_15"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-teal-600 text-white leading-none shrink-0 mt-0.5">R125+15</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_15") ? "" : "line-clamp-2"}`}>{"R125+15 — **Blackboard multi-agent coordination — built by EXTENDING the parallel findings bus (0 new tools, 0 new tables).** Two coordination primitives land on `parallel_job_findings`: **keyed shared-state slots** (latest-wins via `DISTINCT ON`) so parallel agents can read each other's most-recent state, and **atomic work-claims** (exactly one winner per tenant + job + slot, enforced by a partial unique index `idx_pjf_claim`) so two agents never grab the same chunk of work. `findings_publish` / `findings_read` gained `slot_key` / `claim` / `mode:\"board\"`; claim rows are excluded from discovery reads so the coordination channel stays clean. Verified: 12/12 blackboard tests (incl. 5 tool-surface), AHB 47/47, `tsc` clean, preflight CLEAN, architect PASS (the one blocking finding fixed)."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_15") ? "" : "truncate"}`}>{"**384 tools** (+ 4 MCP memory), **121 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **185 live tables**, **541 → 542 indexes** (new partial unique index `idx_pjf_claim`), **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+15 adds 0 tools / 0 tables and +1 index. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_15") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+14+sec3/sec4 (2026-05-31) — DEMOTED (indigo, no NEW): BWB brand-voice lock + full-app + 72h + GitHub-system security review (atomic money fail-close, GitHub-push spawn hardening, test-coverage closure, CI + rate-limiter fixes). Stats UNCHANGED. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_14_sec4")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-indigo-500/10 via-primary/5 to-transparent border border-indigo-500/30 hover:border-indigo-500/50 hover:bg-indigo-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_14_sec4"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-indigo-600 text-white leading-none shrink-0 mt-0.5">R125+14+sec4</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_14_sec4") ? "" : "line-clamp-2"}`}>{"R125+14+sec3/sec4 — **Brand-voice lock + full-app + 72h + GitHub-system security/correctness review (PASS).** **sec3 — Built With Bob brand-voice lock:** when a render is flagged as Built With Bob, the narrator voice is now HARD-LOCKED to Bob's own voice clone and any voice override is ignored (escape hatch env-gated for deliberate guest segments); a voice-provider failure now FAILS the render instead of silently shipping in a generic non-brand voice. Weight-stat brand numbers resynced to the confirmed 504 lb start / 236 lb lost / 268 lb current. **sec4 — full-app + 72h + GitHub-system post-edit review (4 parallel architect passes + a focused 2nd pass on the fix delta):** **HIGH→fail-closed (money):** `charge_task_force` is now a single atomic conditional UPDATE — a charge commits only within budget, a would-be breach no longer mutates spend (closes the debit-then-check overspend window + read-then-write race). **MEDIUM (GitHub backup push):** the heartbeat backup git-push moved from a shell string to a no-shell argv spawn + owner/repo regex validation + explicit commit/push exit-code handling. **MEDIUM (test integrity):** the held-out-eval-gate env enforcement moved to proper before/after hooks. **Quality:** closed the three deferred test-coverage gaps (render-farm dispatch SSRF/bound guards, drive-date parsing, task-force budget cap — 31 new unit tests) and cleared two live CI issues (a stale sql-raw baseline entry after a net hardening; rate-limiter coverage for `jury_triage` + `bwb_weekly_build`). Verified: `tsc` clean, AHB 47/47, held-out-eval-gate 14/14, preflight stale-strings CLEAN, architect PASS. All stats UNCHANGED."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_14_sec4") ? "" : "truncate"}`}>{"**384 tools** (+ 4 MCP memory), **121 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **185 live tables**, **541 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — sec3/sec4 are brand-voice/security/correctness/quality rounds; all stats UNCHANGED. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_14_sec4") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+14+sec2 (2026-05-30) — DEMOTED (fuchsia, no NEW): Security/correctness hardening — 1 HIGH + 3 MEDIUM + 1 LOW closed; new tool bwb_weekly_build (383→384). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_14_sec2")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-fuchsia-500/10 via-primary/5 to-transparent border border-fuchsia-500/30 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_14_sec2"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-fuchsia-600 text-white leading-none shrink-0 mt-0.5">R125+14+sec2</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_14_sec2") ? "" : "line-clamp-2"}`}>{"R125+14+sec2 — **Security/correctness hardening — full-app + 72h pre-publish post-edit code review (3 parallel architect passes + a focused 2nd pass on the fix delta, PASS).** **HIGH (regression):** the yt-dlp video-transcript ingestion path (`scripts/lib/youtube-transcript.ts`) was spawning with the raw inherited process environment on a NETWORK-FACING ingestion path; it now spawns with a scrubbed env via `sanitizeSpawnEnv(process.env)`, closing a loader-hijack / code-execution pivot. **MEDIUM #1:** the money-moving governance tools `set_department_budget` (`limitUsd`) and `charge_task_force` (`amountUsd`) now reject negative / non-finite amounts at BOTH the tool-dispatch layer and the module level — kills budget/accounting corruption via malformed args. **MEDIUM #2:** the `plan-executor` stuck-plan sweep stale-interval `sql.raw` was replaced with a parameterized interval, eliminating a raw-interpolation path. **MEDIUM #3:** removed client-facing HTTP 500 internal-error-detail leaks across archive-rescue (×2), the graph route, store-checkout, and the leads routes (server-side logging retained). **LOW:** corrected a stale public tool count in the public README. **New tool:** `bwb_weekly_build` — an approval-first autonomous weekly 'Built With Bob' YouTube recap pipeline that assembles and can publish the weekly recap (384th tool). Verified: `tsc` clean, AHB regression 47/47, held-out-eval-gate 14/14, agent-wiring audit exit 0, app boots clean at 384 tools."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_14_sec2") ? "" : "truncate"}`}>{"**384 tools** (+ 4 MCP memory), **121 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **185 live tables**, **541 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+14+sec2 adds 1 new tool (`bwb_weekly_build`, 383→384) and closes 1 HIGH + 3 MEDIUM + 1 LOW security/correctness findings; all other stats UNCHANGED. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_14_sec2") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+14 / R125+14+sec1 (2026-05-30) — DEMOTED (rose, no NEW): Autonomous Corporate Operations — 12 new tools + 4 new tables; security+correctness pass. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_14")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/10 via-primary/5 to-transparent border border-rose-500/30 hover:border-rose-500/50 hover:bg-rose-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_14"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+14</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_14") ? "" : "line-clamp-2"}`}>{"R125+14 — **Autonomous Corporate Operations (12 new tools + 4 new tables).** Seven genuine self-managing-corporate capabilities shipped: **(1) OKR review cadence** wired to the heartbeat (throttled, `run_okr_review`); **(2) durable sleep/wake sequences** (`schedule_wake` / `cancel_wake` / `list_wakes` + heartbeat wake runner); **(3) departmental budget enforcement** (per-persona/department cost attribution + heartbeat sweep + `set_department_budget` / `check_department_budget`); **(4) continuous mid-plan replanning** (the plan executor re-plans remaining steps up to twice when reality diverges); **(5) an A/B→Stripe→SOP optimization loop** (`create_ab_experiment` / `record_ab_event` + heartbeat experiment runner); **(6) an LLM-free Process Reward Model** scoring every intermediate step heuristically; **(7) scoped task-forces** (`create_task_force` / `list_task_forces` / `charge_task_force` / `sunset_task_force`). Full governance ceremony: 4 tables via psql ALTER (tenant_id NOT NULL, indexed, verified), all 12 tools registered in TOOL_POLICIES + the router registry, the three leadership-only mutators (`run_okr_review`, `set_department_budget`, `charge_task_force`) gated trusted-personas-only, and the shared 'run independently, escalate to Felix only on an issue' contract synced across all 16 personas. **R125+14+sec1 — security + correctness pass:** new fail-closed `assertProjectInTenant` / `assertConversationInTenant` guards wired at every LLM-driven project/conversation insert+read site that previously trusted caller-supplied ids (closes the twice-deferred tenant-ownership audit); a FOR UPDATE row-lock transaction fixes an A/B-event lost-update race that corrupted winner selection; per-department cost attribution now flows real persona ids; the block-path telemetry insert is hardened to no-throw (the fail-closed block still fires). Verified: typecheck clean, AHB 43/43, preflight stale-strings CLEAN, Load Test Layer 1 0.0% err, wiring audit exit 0, app boots at 383 tools; architect post-edit review PASS on both rounds."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_14") ? "" : "truncate"}`}>{"**383 tools** (+ 4 MCP memory), **121 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **185 live tables**, **541 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+14 adds 12 autonomous-corporate tools + 4 tables (tools 371→383, tables 181→185, indexes 531→541); R125+14+sec1 closes the deferred project/conversation tenant-ownership audit + an A/B-event race + a cost-attribution gap. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_14") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+13.25 (2026-05-30) — DEMOTED (cyan, no NEW): full-app + 72h post-edit code review (1 HIGH + 1 LOW closed) — held-out eval gate fails closed on tenant erosion + Veo clamp; 1 HIGH accepted-design, 3 deferred. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_13_25")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_13_25"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+13.25</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_13_25") ? "" : "line-clamp-2"}`}>{"R125+13.25 — **Security hardening — full-app + 72h post-edit code review (3 parallel architect passes split by surface).** **HIGH #1 (security — tenant isolation):** the self-improvement auto-apply gate now fails CLOSED on tenant-filter erosion — any auto-generated diff that nets-out tenant references is blocked from auto-applying and routed to human review (the `tenant-filter-erosion` invariant was promoted warn → block, because tenant isolation is the highest-risk surface). **LOW #1 (correctness):** the Gemini/Veo video clip duration clamp was aligned to the documented 1–10s provider limit (was 15s). **1 HIGH triaged ACCEPTED DESIGN:** the Gmail-direct admin OAuth routes are PIN-only by design (mandatory, timing-safe, throttled, header-only; the OAuth callback is public by necessity with a state-nonce CSRF check) — not a bypass, and it supports the documented headless operator-script access pattern. **3 findings deferred** to the known-gaps ledger (verifier DB tenant-scoping on an internal path, an admin-role gate on the archive-rescue admin routes, and a pending governance-count definitional audit). Closed via 3 parallel architect passes + a focused second pass on the fixes (CLEAN); typecheck clean, gate tests 14/14, wiring audit exit 0."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_13_25") ? "" : "truncate"}`}>{"**371 tools** (+ 4 MCP memory), **121 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **181 live tables**, **531 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+13.25 closes 1 HIGH (held-out eval gate fails closed on tenant erosion) + 1 LOW (Veo duration clamp), triages 1 HIGH as accepted design, defers 3 to the known-gaps ledger; builds on R125+13.24 (SIA held-out eval gate) and R125+13.23 (jury fix-direction concordance guard). Aggregate stats UNCHANGED — hardening round added no new tools/tables/personas/indexes. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_13_25") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+13.22 (2026-05-30) — DEMOTED (teal, no NEW): full-app + 72h security code review (1 HIGH + 2 MEDIUM + 1 LOW closed) + ensemble_query κ-threshold auto-discovery generalized. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_13_22")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-teal-500/10 via-primary/5 to-transparent border border-teal-500/30 hover:border-teal-500/50 hover:bg-teal-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_13_22"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-teal-600 text-white leading-none shrink-0 mt-0.5">R125+13.22</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_13_22") ? "" : "line-clamp-2"}`}>{"R125+13.22 — **Security hardening — full-app + 72h post-edit code review (4 parallel architect passes split by surface).** **HIGH #1 (security — credential exposure):** the heartbeat backup git-push was embedding the GitHub token inline in the push URL, where it could surface in the process list and in error text. Replaced with git's credential-helper reading the token from the environment, so it never appears in the command line or any error output. **MEDIUM #1 & #2 (security — loader-hijack defense):** both child-process spawns of the backup-push script (the heartbeat path and the backup API route) now scrub loader-hijack environment variables (`LD_*` / `DYLD_*` / `NODE_OPTIONS` / `NODE_PATH`) — closing the one spawn site the R125+13.19 sweep had missed. **LOW #1 (observability):** the MoA jury telemetry now reports the trimmed proposer set so what's logged matches what actually ran. **Plus:** the `ensemble_query` κ-escalation threshold auto-discovery was generalized into a reusable offline-discovery core with a readiness gate. Closed via four parallel architect passes split by surface + a second focused pass on the fixes (CLEAN); wiring audit exit 0, typecheck CLEAN, app boots with no runtime errors."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_13_22") ? "" : "truncate"}`}>{"**371 tools** (+ 4 MCP memory), **121 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **181 live tables**, **531 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+13.22 closes 1 HIGH (heartbeat token-in-URL → git credential-helper), 2 MEDIUM (both backup-push spawns scrub loader-hijack env), 1 LOW (MoA proposer-set telemetry) + generalizes the ensemble_query κ-threshold auto-discovery into a reusable readiness-gated core. Aggregate stats UNCHANGED — hardening round added no new tools/tables/personas/indexes. _(model: anthropic/claude-opus-4-8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_13_22") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+13.21 (2026-05-29) — DEMOTED (indigo, no NEW): security hardening post-edit code review (4 MEDIUM + 1 LOW closed, 1 HIGH FALSE POSITIVE). Plus R125+13.20 Claude Opus 4.8 flagship swap. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_13_21")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-indigo-500/10 via-primary/5 to-transparent border border-indigo-500/30 hover:border-indigo-500/50 hover:bg-indigo-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_13_21"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-indigo-600 text-white leading-none shrink-0 mt-0.5">R125+13.21</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_13_21") ? "" : "line-clamp-2"}`}>{"R125+13.21 — **Security hardening — post-edit code review (5 findings closed).** **MEDIUM #1 (security — loader-hijack defense):** the child-process env guard (`sanitizeSpawnEnv()`) now prefix-matches the ENTIRE `LD_*` / `DYLD_*` dynamic-linker namespace instead of an enumerated denylist that could be bypassed by any unlisted key — closes a child-process RCE-class vector at the spawn boundary. **MEDIUM #2 (security — prompt-injection):** the skill-learning excerpt path now wraps untrusted conversation text in `sanitizeUntrusted` before it reaches the LLM that promotes platform-wide skills, so a crafted message can no longer poison what the platform learns and reuses across tenants. **MEDIUM #3 (correctness):** auto-learned FAILURE lessons now dedupe within their own namespace (they were bypassing dedup entirely and accumulating noise). **MEDIUM #4 (correctness):** early-commitment plan-narrowing now preserves a step's explicitly-requested file/deliverable executors — it could previously strip `write_file` / `create_pdf` and leave a plan that silently couldn't produce its file. **LOW #1:** stale model-description string fixed (Opus 4.7 → 4.8). **1 HIGH investigated and classified FALSE POSITIVE** (provider-prefixed model id is the established convention — surfaced for the engineering record only). Closed via a 3-prong 72h post-edit architect review: wiring audit CLEAN, typecheck CLEAN, second architect pass CLEAN. **R125+13.20 — Claude Opus 4.8 new flagship:** wired as the new flagship across the orchestration stack (model registry, MoA aggregator, CEO orchestrator, auto-router coding/agentic chains) with Opus 4.7 retained as fallback everywhere; benchmarked 4.8 vs 4.7 (frozen prompts, blind judge, 3 runs) = statistically equivalent quality, 4.8 marginally faster (~9% pricier/query); two one-off benchmark scripts consolidated into a reusable flagship-regression-gate canary that gates ANY future flagship model swap."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_13_21") ? "" : "truncate"}`}>{"**371 tools** (+ 4 MCP memory), **121 capabilities**, **31 (.agents) + 62 (db) + 34 (output-skills) = 127 reference surfaces**, **16 personas**, **181 live tables**, **531 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+13.21 closes 4 MEDIUMs (loader-hijack namespace prefix-match, skill-learning prompt-injection sanitize, failure-lesson namespace dedup, early-commit deliverable-executor preservation) + 1 LOW (stale Opus 4.8 description), 1 HIGH triaged FALSE POSITIVE; R125+13.20 wires Claude Opus 4.8 as flagship (Opus 4.7 fallback) + flagship-regression-gate canary. Aggregate stats UNCHANGED — hardening + model-swap round added no new tools/tables/personas/indexes. _(model: anthropic/claude-opus-4.8)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_13_21") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+13.19+sec1 (2026-05-28) — DEMOTED (amber, no NEW): ruvnet/ruflo portable security patterns. sanitizeSpawnEnv() wired across every child-process spawn site (loader-hijack denylist + mixed-runtime coverage). Vibevoice audio_url → ssrf-safe fetch. NODE_PATH removed from gate_command allowlist. revertProposal hardened (exec → spawnSync). Omni Flash Veo connector cleanup. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_13_19_sec1")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_13_19_sec1"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+13.19+sec1</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_13_19_sec1") ? "" : "line-clamp-2"}`}>{"R125+13.19+sec1 — **Portable security patterns from ruvnet/ruflo: spawn-env loader-hijack defense across every child-process site.** R125+13.19 lands `server/safety/spawn-env-guard.ts` with `sanitizeSpawnEnv()` — strips loader-hijack env vars (`LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_*`, `NODE_OPTIONS`, `NODE_PATH`) plus mixed-runtime equivalents for Perl (`PERL5OPT`/`PERL5LIB`), Python (`PYTHONPATH`/`PYTHONSTARTUP`), Ruby (`RUBYOPT`/`RUBYLIB`), Lua (`LUA_PATH`/`LUA_CPATH`), Bun (`BUN_RUNTIME_TRANSPILER_CACHE_PATH`), Deno (`DENO_DIR`) before spawning child processes. Setting any of these on a child = functional RCE; sanitizing at the spawn boundary closes a whole class of attack. **+sec1 wires the helper into every remaining spawn site:** `server/research-engine.ts` (proposal-compile tsc spawn), `server/index.ts`, `server/claude-runner.ts`, `server/heartbeat.ts`, `server/routes.ts` — every `child_process.spawn`/`spawnSync` call now passes through the sanitizer. **+sec1 HIGH closures:** (1) Vibevoice `audio_url` was using raw `fetch()` on caller-supplied URLs, allowing attacker-DNS-to-internal-IP exfiltration (169.254.169.254, fc00::/7 ULA, etc.). Swapped to `ssrfSafeFetchBytes()` from the R110.1+sec DNS-resolving SSRF guard with IPv4-mapped IPv6 hex-form coverage. (2) `revertProposal` was using `exec()` with string concatenation on git-revert arguments — shell-injection sink if a proposal title contained backticks. Refactored to `spawnSync()` with array argv (no shell) + `sanitizeSpawnEnv()` on the env. **+sec1 MEDIUM closure:** `NODE_PATH` removed from `gate_command` env-var allowlist — `NODE_PATH` is itself a loader-hijack vector (lets attacker prepend a module-resolution path to import a shim version of any required module). **R125+13.19 codified the 3-gate untrusted-content pattern** in `.agents/skills/security-hardening/SKILL.md`: (Gate 1) pre-storage PII scan + classification, (Gate 2) vault/sanitize before LLM exposure, (Gate 3) pre-LLM injection-pattern scan. **2 ruflo patterns deliberately SKIPPED with rationale:** (a) diff-risk port — VC's `computeDiffImpact` is graph-based (touches → callers-of-callers → tenant-isolation surfaces), strictly richer than ruflo's line-count heuristic; (b) RRF memory-search expansion — large MNEMA surface, unclear win against existing k=5 decorrelated-kin scoring. **Bonus:** Omni Flash Veo connector docs+configs cleaned up — pointed at `gemini-omni-flash` (placeholder model ID Google never shipped) and stale Veo IDs; now targets the 3 verified-working IDs (`veo-3.1-generate-preview` default, `veo-3.1-fast-generate-preview`, `veo-3.0-generate-001`). Fixes silent 404s when callers asked for the default model. **Deferred (logged, not silently dropped):** project_notes/project_files/project_conversations transitive tenant-scoping audit — 13 LLM-driven INSERT sites need an `assertProjectInTenant(projectId, tenantId)` helper before any INSERT; design relies on transitive isolation via `projects.tenant_id` FK today but a dedicated audit is filed."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_13_19_sec1") ? "" : "truncate"}`}>{"**371 tools** (+ 4 MCP memory), **121 capabilities** ⚠️_unverified_, **31 (.agents) + 62 (db) + 33 (output-skills) = 126 reference surfaces**, **16 personas**, **181 live tables**, **532 indexes**, **41 governance rules** ⚠️_unverified — TOOL_POLICIES enumerates 390 entries_, MCP scopes 5, MCP tools 12 — R125+13.19+sec1 wires `sanitizeSpawnEnv()` across every remaining child-process spawn site (research-engine tsc, index, claude-runner, heartbeat, routes), closes 2 HIGHs (vibevoice SSRF, revertProposal shell-injection) + 1 MEDIUM (NODE_PATH removed from gate_command allowlist). Aggregate stats UNCHANGED from R125+13.18+sec — hardening round added no new tools/tables/personas/indexes. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_13_19_sec1") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+13.18+sec (2026-05-27) — DEMOTED to rose: ensemble_query deliberation-quality layer (Council-of-High-Intelligence import) shipped + triple-architect verification pass. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_13_18_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/10 via-primary/5 to-transparent border border-rose-500/30 hover:border-rose-500/50 hover:bg-rose-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_13_18_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+13.18+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_13_18_sec") ? "" : "line-clamp-2"}`}>{"R125+13.18+sec — **ensemble_query deliberation-quality layer (Council-of-High-Intelligence port) + triple-architect verification pass.** R125+13.18 ships three opt-in features wired into `ensemble_query` — all default OFF so `jury_triage` + every existing caller is byte-identical behavior. **(1) Problem Restate Gate** (`restate_gate:true`) — pre-deliberation fast round where each proposer reframes the question in ≤40 words; we embed restatements and check pairwise cosine. Divergence <0.60 surfaces `questionAmbiguous=true` (does NOT short-circuit — caller decides). **(2) Dissent quota / steelman round** (`dissent_quota:true`) — after main round, if κ>0.70 (groupthink suspected) we spawn 2 steelman proposers (claude-opus-4-7 + deepseek-v4-pro, distinct providers to avoid family-mode-collapse) with a system prompt that FORCES them to argue the strongest opposing case against the longest emergent-consensus answer. Aggregator must choose between consensus + steelman rather than rubber-stamp. **(3) Polarity-pair roster** (`proposer_pool:'polarity'`) — 4 frontier models each running a DIFFERENT reasoning-tradition system prompt: Munger inversion, Taleb tail-risk, Kahneman bias-audit, Meadows systems-loops. Forces genuinely different reasoning paths instead of model-flavor diversity over the same chain-of-thought template. **R125+13.18+wire** — persona-sync REASONING section + tool-usage-hints both extended so all 16 personas pick up the three knobs on next sync. **R125+13.18+sec triple-architect pass landed 4 fixes:** (1) `server/moa.ts` HIGH — polarity tradition prompts ('ALWAYS INVERT', 'argue the opposing case') are stylistically adversarial and could be weaponized as a style-jailbreak to override safety alignment. Added `POLARITY_SAFETY_INVARIANT` preamble (mirrors AHB intent-gate categories: medical/drug-dosage/MH-crisis/weapons/illegal/CSAM) prepended to every polarity proposer system prompt AND every steelman system prompt. (2) HIGH — dissent-quota's `consensusSnippet` was selected longest-answer-wins, letting a single hallucinated wall-of-text hijack the position the steelman is forced to argue against. Switched to **centroid-based selection**: embed all successful answers, compute mean embedding, pick the answer with highest cosine to centroid. Best-effort fallback to longest-wins if embeddings unavailable. (3) MEDIUM cost guardrail — `polarity` (4 premium calls) + `dissent_quota` (+2 steelmen) is the documented anti-pattern (polarity already encodes 4 opposing lenses BY DESIGN). Engine now SUPPRESSES dissent-quota when `poolChoice==='polarity'` with tagged log line. Also re-enforces `MAX_PROPOSERS=8` slice AFTER steelmen append. (4) MEDIUM — `consensusAnswer` is proposer-generated text flowing raw into the steelman LLM prompt; defensively capped at 1600 chars BEFORE prompt build (defense-in-depth at the call site too). **5 false-positives logged:** (a) `video-job-runner.ts:134` fsync-swallow CRITICAL — fsync is paranoia; `.tmp→rename` is the real atomicity. (b) `delivery_logs missing tenantId` CRITICAL — schema has NO tenant_id col; table intentionally global by Stripe payment ID. (c) `plan-replay.ts` tenant-scoping vector-query HIGH — `WHERE tenant_id` IS the first filter, verified at line 63. (d) MoA cross-tenant via plan_replay_cache — `consensusSnippet` built from CURRENT-run same-tenant proposers, not from cache. (e) MoA recursive cost blowup — aggregator is a single LLM call, not recursive MoA. **13 deferred with rationale:** setInterval cleanup (dev-time only), ensureMoaTable raw SQL (pre-existing create-if-not-exists pattern), early-commitment hardcoded model (has escape hatch), plan-replay hit_count fire-and-forget (intentional telemetry), destructive-tool default=safe (intentional design), api-v1 timing leak (speculative), intent-gate fallback-pattern drift, polarity skip-rebalance health-check (low-incidence, all frontier-tier), Veo duration cap mismatch (separate work), wiring-audit `uploadToDrive` cosmetic, schema.ts `tsv` column drift, label-suffix regex (speculative), persona tool-sprawl warnings (known backlog). MoA observed running κ=0.884 and κ=0.799 in production logs post-fix. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_13_18_sec") ? "" : "truncate"}`}>{"**371 tools** (+ 4 MCP memory), **121 capabilities**, **31 (.agents) + 62 (db) + 33 (output-skills) = 126 reference surfaces**, **16 personas**, **181 live tables**, **532 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+13.18+sec ships `ensemble_query` deliberation-quality layer (restate_gate / dissent_quota / polarity pool, all default OFF) ported from Council-of-High-Intelligence; +wire propagates to all 16 personas; +sec triple-architect pass closes 4 real fixes (polarity+steelman safety invariant, centroid-based consensus selection, polarity+dissent cost guardrail, defensive consensus cap), logs 5 false-positives, defers 13 with rationale. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_13_18_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+13.17+sec (2026-05-27) — DEMOTED to rose: Orchestrator token-burn layer (Early Commitment + LOOP plan-replay) + verification triple-architect pass. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_13_17_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/10 via-primary/5 to-transparent border border-rose-500/30 hover:border-rose-500/50 hover:bg-rose-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_13_17_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+13.17+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_13_17_sec") ? "" : "line-clamp-2"}`}>{"R125+13.17+sec — **Orchestrator token-burn layer (Early Commitment + LOOP plan-replay) + triple-architect verification pass.** R125+13.17 ships the Vir & Vir 2026 (TDS) two-stage cost optimizer wired into `generateExecutionPlan`. **Early Commitment:** cheap `gpt-4.1-mini` call (≤200 tokens) classifies the objective into 11 classes → `SKILL_TO_TOOLS` mapping → narrows each step's `toolChain` to the intersection. Escape hatch: confidence <0.6 OR class=open-ended → no narrowing; never-empty rule keeps original chain if narrowing would zero a step; `web_search` + `google_drive` always preserved. **LOOP plan-replay:** new `plan_replay_cache` table (vector(1536) HNSW cosine + btree on `(tenant_id, request_class)`). Before the planner LLM call, embedding-similarity lookup against past successful plans for the same `(tenant, class)` — hit ≥0.92 cosine replays the cached plan (skips planner entirely). Cache key suffixed with stable 8-char SHA256 of `CLASS_TO_SKILL_TYPES` so any mapping change auto-invalidates old rows with zero migration. Outcome recording on `status==='complete'` only, non-open-ended only, async/fire-and-forget. **R125+13.17+sec triple-architect pass landed 4 fixes:** (1) `server/skillify.ts:96` HIGH — untrusted message content sliced raw into the distillation LLM prompt; now wrapped in `sanitizeUntrusted({maxBytes:200})` to defang prompt-injection payloads. (2) `server/auto-skillify.ts` HIGH — `captureSkill` had no gate against destructive tool sequences (a failed 'delete my data' could distill into a maladaptive 'Auto: Avoid: Data Deletion' lesson teaching bypass paths); added `involvesDestructiveTool()` gate that consults `getToolRiskClass` and rejects HIGH/CRITICAL toolchains before distillation. (3) `server/plan-replay.ts` MEDIUM — cache-key mapping-version hash (above) closes the 'narrowing-induced hallucination' replay-after-mapping-drift risk. (4) `server/routes/gmail-direct.ts:181` LOW — public status response leaked refresh-token storage backend (`source: 'env' | 'file'`); field removed to narrow attacker's search surface. **5 false-positives logged** (PERSONA_DOCS import correct, `lookup_replayable_plan` internal not agent-callable, `TWILIO_SKIP_SIGNATURE` prod-env-guard already in place, `produce_video`/`create_slideshow_video` exist in TOOL_REGISTRY, archive-rescue path-containment already in place, `skills` table is intentionally GLOBAL by design). **8 deferred with note** (not silently dropped): OAuth concurrent-refresh mutex, ensemble fanout deduction, Veo mux-retry, per-job Veo cost cap at adapter, orchestrator/delivery test gaps, owner-email env var sprawl, server/tools.ts 16.5k bloat split, SEO-head DOM flicker. Final: typecheck CLEAN, `verify-agent-wiring` CLEAN (0 dead / 0 drift / 0 orphan-skill / 0 schema-gap), `agent-knowledge-refresh` GREEN, app boots clean. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_13_17_sec") ? "" : "truncate"}`}>{"**371 tools** (+ 4 MCP memory), **121 capabilities**, **31 (.agents) + 62 (db) + 33 (output-skills) = 126 reference surfaces**, **16 personas**, **181 live tables** (+ `plan_replay_cache`), **532 indexes** (+4 for plan-replay HNSW + btree), **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+13.17 ships Early Commitment + LOOP plan-replay (Vir & Vir 2026, TDS) cost optimizer wired into the planner; +sec triple-architect pass closes 4 real fixes (skillify prompt-injection sanitize, auto-skillify destructive-tool gate, plan-replay cache versioning hash, gmail-direct source-leak removal), logs 5 false-positives, defers 8 with rationale. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_13_17_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+13.16+sec2 (2026-05-27) — DEMOTED to cyan: Triple-architect pass (whole-app + sensitive surfaces + 72h) closed 10 of 10 findings in-round. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_13_16_sec2")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_13_16_sec2"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+13.16+sec2</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_13_16_sec2") ? "" : "line-clamp-2"}`}>{"R125+13.16+sec2 — Triple-architect pass (whole-app + sensitive surfaces + last 72h) — **10 of 10 findings closed in-round, audit CLEAN.** First-pass 8 closures: (a) Felix RUNBOOK + Apollo SMB-FITD persona-specific blocks moved out of shared `tools_doc` into per-persona `tools_doc_addendum` (prevents global cache dedup from wiping persona-specific pointers; tools_doc length range 64759..66223 confirms Felix + Apollo addendums landed); (b) `clampMs()` env-parse helper with NaN guard + min/max bounds wraps timeout reads in `gemini-omni-flash.ts` and OCR_DAILY_CAP in `archive-rescue.ts`; (c) archive-rescue multer temp files + `orderDir` working dir cleanup unified into a single `finally{}` block on EVERY early-return path (no more orphaned uploads on validation reject); (d) **admin PIN now header-only** — `readPin()` helper in `gmail-direct.ts` reads `x-admin-pin` header or POST body only, removed all `?pin=` query reads, plugs the log-leakage path where reverse proxies + access logs captured PINs in query strings; (e) **CSRF allowlist tightened** from broad `/api/auth/` prefix-skip to exact-match Set — `verify-email`, `resend-verification`, and any future cookie-authenticated auth routes are now CSRF-protected (only login/callback/csrf-token/forgot-password/reset-password bypass); (f) `mpeg_produce_parallel` + `create_styled_report` added to schema-pair audit (`scripts/wiring-audit-schema-pairs.ts`) so future engine-field additions that aren't mirrored in the tool schema fail CI; (g) schema-field-coverage walker rewritten from fuzzy `\\b<field>:` regex to proper traversal — depth-0 + string-literal aware `findPropertyValueBody`, brace-stripping `resolveSchemaTarget`, implicit `properties:` auto-descent between named segments, `items` as literal key (eliminates false negatives that were hiding real coverage gaps). **Verification architect HIGH (2 more, applied):** (h) `/api/auth/logout` removed from CSRF allowlist — no such POST route exists (frontend uses GET `/api/logout` via Replit-auth) AND keeping it allowlisted would have enabled CSRF-logout attacks (malicious site force-terminates a victim session); (i) **OCR daily cap no longer counts `ocr_failed` rows** — previously, when Anthropic OCR was down or rate-limiting, every retry incremented the counter as failed and burned the 100/day quota, locking out legit demos for 24h. Cap now reflects *delivered value*, not *system load*. **R125+13.16 series (now archived as a single block in `docs/release-log-archive.md`):** Veo 3.1 fast video clips wired into `mpeg_produce_parallel` via per-scene `videoClipPrompt` opt-in ($0.40-0.75/sec, per-job cap GEMINI_OMNI_FLASH_MAX_SCENES_PER_JOB=12, auto-fallback to still-image on Veo error/quota/wall-budget); full-app + 72h architect triple-pass closed 8 findings + deferred 4 (+sec); agent-context wiring caught Veo schema gap + Apollo missing smb-ai-fitd-outreach pointer (+wire); audit upgraded with ORPHAN_SKILL + SCHEMA_FIELD_COVERAGE checks (+wire2); 2nd schema-pair seeded for `create_styled_report` (+wire3). Final: typecheck CLEAN, `verify-agent-wiring` CLEAN (0 dead / 0 drift / 0 orphan-skill / 0 schema-gap), `agent-knowledge-refresh` GREEN (16 personas synced, 371 tools, 31 + 62 + 32 skills, 121 capabilities), app boots clean. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_13_16_sec2") ? "" : "truncate"}`}>{"**371 tools** (+ 4 MCP memory), **121 capabilities**, **31 (.agents) + 62 (db) + 32 (output-skills) = 125 reference surfaces**, **16 personas**, **180 live tables**, **528 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+13.16+sec2 triple-architect pass closes 10 of 10 findings (CSRF allowlist tightened incl. CSRF-logout fix, OCR cap no longer self-DoS on Anthropic outage, admin PIN header-only, persona addendums, schema-walker rewrite). +sec/+wire1-3 collapsed into `docs/release-log-archive.md § R125+13.16 series`. **R125+13.16+sec3 stale-stat sweep (Bob 2026-05-27):** tools 371→**371** (+6 since R125+6+sec.1 surface snapshot), indexes 511→**528**, governance 43→**41** — drift caught after 4 ships parroting stale aggregates. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_13_16_sec2") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+13.13+sec (2026-05-26) — DEMOTED: 3 MEDIUMs closed (archive-rescue tenant_id defense-in-depth pin; stripe-checkout anon allowlist tightened to audit-only; _registry.json regenerated with feature-contract sha256 pin). 3 systemic gaps deferred + logged. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_13_13_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_13_13_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+13.13+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_13_13_sec") ? "" : "line-clamp-2"}`}>{"R125+13.13+sec — Whole-app + 72h post-edit code review (3 parallel architect passes spanning Safety/Tools/Personas, Routes/Payment/Webhooks/Schema, Scripts/Cron/Lib). **3 MEDIUMs closed in-round:** (a) every `archive_rescue_orders` query in `server/routes/archive-rescue.ts` now includes an explicit `AND tenant_id = ${PLATFORM_OWNER_TENANT_ID}` predicate — background OCR updates, dedup/cap selects, stripe session-id updates, owner-email lookups — defense-in-depth against a future schema-share or single-DB multi-tenant migration; (b) `server/routes/stripe-checkout.ts` anonymous allowlist tightened to ONLY `metadata.kind='audit'` — `archive-rescue` removed, forcing those purchases through the dedicated `/api/public/archive-rescue/checkout` route that creates the order row + session-metadata linkage (eliminates orphan-paid-session state-machine drift); (c) `.agents/skills/_registry.json` regenerated to include the new `feature-contract` skill with sha256+bytes pin (closed weekly-maintenance Pass-8 drift before it could fire). **Memory cleanup:** `wedge-wiring-5-system-rule.md` stripped of R-tag/conversation-local identifiers per the architect's repeated note (memory is for durable principles, not release history). **3 items deferred + logged to `docs/architecture-notes.md § Known defense-in-depth gaps (R125+13.13+sec, deferred)`:** AHB `refusalCopy` coverage backfill across ~15 of the 16 personas (HIGH-flagged but pre-existing — generic refusal still BLOCKS, only copy is generic), heartbeat cron failure → owner-notification escalation (pre-existing systemic gap, hides silent stalls), `upsertProject` race in wire scripts (LOW, operator-initiated never concurrent). **R125+13.13** — NEW skill `feature-contract` imported from claude-code-harness (Chachamaru127, MIT) — durable per-feature `spec.md` + `plan.md` contract for multi-day builds (wedges, personas, refactors), distinct from in-session `session_plan.md`. Architect now grades scope-drift against the contract during `post-edit-code-review`. `replit-md-maintenance` skill gained \"Act, don't ask\" standing order (Bob 2026-05-26) — agent autonomously fixes stale stats, missing R-rounds, missing FALSE POSITIVE logs, and trims oldest rounds to archive when `replit.md` exceeds ~150 lines (no `user_query`, no confirmation). Skill count corrected 29 → 30 (added `cross-session-handoff`, `feature-contract`, `marketing-week-autopilot`, `tdd`, `write-a-skill`, `zoom-out`). Typecheck PASS. _(model: openai/gpt-5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_13_13_sec") ? "" : "truncate"}`}>{"**371 tools** (+ 4 MCP memory), **121 capabilities**, **30 (.agents) + 62 (db) + 32 (output-skills) = 124 reference surfaces**, **16 personas**, **180 live tables**, **511 indexes**, **43 governance rules**, MCP scopes 5, MCP tools 12 — R125+13.13+sec closes 3 MEDIUMs (archive-rescue tenant_id pin, stripe anon allowlist tightened to audit-only, registry pin for feature-contract) + ships new `feature-contract` skill + autonomous `replit-md-maintenance` standing order. Typecheck PASS. _(model: openai/gpt-5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_13_13_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+13.12+sec (2026-05-25) — DEMOTED: Archive Rescue wedge sellable end-to-end + Creator Sponsor Ops + Monid catalog 124→166. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_13_12_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_13_12_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+13.12+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_13_12_sec") ? "" : "line-clamp-2"}`}>{"R125+13.12+sec — Whole-app + 72h post-edit code review (2 parallel architect passes). **2 MEDIUMs closed in-round:** (a) Archive Rescue free-demo race condition — dedup + OCR daily-cap + INSERT now atomic under `pg_advisory_xact_lock(42)` in a single `db.transaction`, so concurrent same-email POSTs can't both pass and burst traffic can't oversubscribe the daily cap; (b) Monid `monid_discover` + `monid_inspect` reclassified `safe/LOW → sensitive/MEDIUM` in `destructive-tool-policy.ts` (outbound paid API + attacker-steerable URL surface now governed at policy level, matching `monid_run`). **2 LOWs deferred + documented** in `docs/architecture-notes.md § Known gaps`: Gmail refresh-token plaintext at-rest (pre-existing, architectural — needs encrypted-at-rest migration), heartbeat cron LLM calls bypass chat-engine intent-gate (pre-existing). **Stale stat fixed:** output-skills 33→32 (matched live `_registry.json`). **R125+13.12** — Creator Sponsor Ops wedge wired CONCIERGE-MODE (project #239, 3 crons: deadline-scan-daily / weekly-digest / pro-brand-discovery-monthly) + Monid catalog 124→166 endpoints + 5-system wedge-wiring backfill (capability-registry rows for `wedge_archive_rescue` + `wedge_creator_sponsor_ops` + felix-brain INTENT_PATTERNS regex). Pricing: $99 audit / $299mo / $499mo Pro w/ Monid brand-discovery. No public landing until 3 paying Standard or 1 Pro (ideabrowser validate-before-build). **R125+13.11+sec** — 1 HIGH closed (Archive Rescue demo: `ARCHIVE_RESCUE_OCR_DAILY_CAP=100` env-cap + email-based 24h dedup), 1 LOW closed (background OCR catch sets `ocr_failed` + owner-email), 2 FALSE POSITIVES (PLATFORM_OWNER_TENANT_ID=1 correct for owned concierge service), 1 systemic MEDIUM deferred (~42 legacy `uploadAndShare` callsites). **R125+13.11** — Archive Rescue wedge sellable end-to-end: public `/archive-rescue` (hero + free 5-page demo + 3-tier Stripe cards) + admin queue `/admin/archive-rescue` + `archive_rescue_orders` table (180 tables) + route file with 4 endpoints + 3 live Stripe products ($99/500pg / $299/2500pg / $999+$49mo). **R125+13.10** — Inbox-ingest auto-cron (`inbox:ingest-daily` 07:00 + `inbox:digest-daily` 07:30) wired for previously-orphan Gmail pipeline; classifier gained 6th kind `money_opportunity`. All invariants PASS. tsc CLEAN. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_13_12_sec") ? "" : "truncate"}`}>{"**371 tools** (+ 4 MCP memory tools), **121 capabilities**, **29 (.agents) + 62 (db) + 32 (output-skills) = 123 reference surfaces**, **16 personas**, **180 live tables**, **511 indexes**, **43 governance rules**, MCP scopes 5, MCP tools 12 — R125+13.12+sec closes 2 MEDIUMs (Archive Rescue race condition → atomic txn under pg_advisory_xact_lock; Monid monid_discover/inspect reclassified to sensitive/MEDIUM), defers 2 LOWs documented in known-gaps, and ships Archive Rescue + Creator Sponsor Ops wedges sellable end-to-end. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_13_12_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+13.7 (2026-05-24) — DEMOTED: closed every deferred finding from R125+13.6+sec (M4 jury FIX-queue sensitive-path denylist + 5 LOWs). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_13_7")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_13_7"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+13.7</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_13_7") ? "" : "line-clamp-2"}`}>{"R125+13.7 — Closed every deferred finding from R125+13.6+sec in one pass. **MEDIUM #4 closure (jury FIX-queue sensitive-path denylist):** added 17-pattern regex denylist in `scripts/jury-triage.ts` covering auth, replitAuth, admin middleware, safety/, safety-guard, external-content-security, stripe routes, coinbase-commerce, webhookHandlers, gmail-direct routes+token, schema.ts, auth models, drizzle, .env, createCsrfMiddleware, secret-name patterns. FIX verdicts touching any sensitive path are routed to owner-notification with `sensitive-path-block` source suffix instead of the implementer queue, even with `JURY_AUTOAPPLY=1`. Mitigates poisoned-fix-proposal injection (e.g. via inbox-ingest classification or capability-gap text) flowing into auto-applied diffs against PIN/CSRF/Stripe/tenant code. **LOW #1 (gmail-direct token single-flight refresh):** added `_refreshInflight` lock in `server/lib/gmail-direct-token.ts` + 10s AbortController timeout on the Google fetch — concurrent callers can no longer trigger N parallel refresh requests, and a hung Google socket can't wedge the lock past 10s. **LOW #2 (classifier model env override):** `INBOX_CLASSIFIER_MODEL` env var in `server/lib/inbox-ingest.ts` for provider hot-swap if Anthropic degrades. **LOW #3 (allowlist sender-shape regex):** defensive RFC-822-ish regex filter on each sender before Gmail-query interpolation + fail-CLOSED throw when zero senders pass validation + caller try/catch surfacing as `allowlist-shape` error in ingest summary. Malformed allowlist row can no longer broaden Gmail query scope via `from:` interpolation. **LOW #4 (SEO canonical cleanup):** `seo-head.tsx` cleanup removes stale `<link rel=\"canonical\">` on unmount — SPA navigation no longer mis-attributes pages to the previous canonical (also bumped stale `177 tables` → `179` in SEO fallback copy). **LOW #5 (PUBLIC_PATH_PREFIXES → exact paths):** `/api/admin/gmail-direct/` prefix in `PUBLIC_PATH_PREFIXES` replaced with three exact paths in `PUBLIC_EXACT_PATHS` (`/auth`, `/callback`, `/status`) — eliminates the foot-gun where future routes under that prefix would silently become public. **replit.md trim:** archived R125+13.5+sec/R125+13.6/R125+13.6+sec full prose to `docs/release-log-archive.md`; recent-rounds block now keeps last 2 + this one. Three architect rounds this turn — initial review caught 2 regressions in my own LOW fixes (L1 wedge on hung socket, L3 still broadens scope on all-invalid allowlist); both regressions fixed (AbortController + try/catch fail-closed), re-verify **CLEAN**. tsc CLEAN throughout. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_13_7") ? "" : "truncate"}`}>{"**371 tools**, **113 capabilities**, **29 (.agents) + 62 (db) + 28 (output-skills) = 119 reference surfaces**, **16 personas**, **179 live tables**, **511 indexes**, **43 governance rules**, MCP scopes 5, MCP tools 12 — R125+13.7 closes 1 MEDIUM (jury FIX-queue sensitive-path denylist mitigates poisoned-fix-proposal injection into auth/payment/schema diffs) + 5 LOWs (gmail single-flight + 10s timeout, INBOX_CLASSIFIER_MODEL hot-swap, allowlist fail-closed regex, SEO canonical cleanup, PUBLIC_EXACT_PATHS foot-gun fix). Three architect rounds, two self-regressions caught + fixed, final CLEAN. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_13_7") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+6+sec.1 (2026-05-24) — DEMOTED: public /gallery + /trust pages with default-private opt-in showcase. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_4_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r125_4_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+6+sec.1</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_4_sec") ? "" : "line-clamp-2"}`}>{"R125+6+sec.1 — NEW public /gallery + /trust pages with default-private opt-in showcase. /trust is the live safety dashboard pulling from agent_runs, agent_jobs, decline_events, personas, governance_rules, pg_indexes, jury_decisions — first deploy shows 495 agent runs/30d, 79 deliverables/30d, 235 declines, 60 tools exercised, 16-of-16 AHB intent-gate coverage, 3 jury decisions logged, 41 governance rules, 177 tables, 336 non-pkey indexes. /gallery is the opt-in deliverables showcase — empty by default until admin runs an UPDATE on file_storage to set is_public=true on specific file ids. Architect across two passes (post-edit code review) returned 1 CRITICAL (gallery initially leaked admin tenant filenames including medical PDFs + named customer projects to public internet), 2 HIGH (storage_key IDOR; open-redirect via drive_url — proxy was 302-ing to any URL in file_storage.drive_url with no host check), 2 MEDIUM (tenant_id nullable in live DB despite schema saying notNull — 10 null rows from auto-gen platform PDF; DoS via unchunked Promise.all counts on /trust), 2 LOW (info disclosure on /trust counts ACCEPTED as feature; file route doesn't re-apply list filters ACCEPTED — is_public IS the explicit opt-in gate). All CRITICAL/HIGH/MEDIUM closed inline: CRITICAL closure via psql ALTER TABLE file_storage ADD COLUMN is_public boolean NOT NULL DEFAULT false (R120 RLS already on table); gallery query filters AND is_public=true. HIGH IDOR closure — dropped storage_key from API; replaced with proxied /api/public/gallery/file/:id that re-checks is_public, sanitizes storage_key via regex strip, path-traversal guard via resolved.startsWith uploadsRoot. HIGH open-redirect closure (R125+6+sec.1) — NEW safeDriveUrl helper requires https plus host in drive.google.com/docs.google.com allowlist; applied at BOTH egress points (list payload driveUrl nulled, redirect handler falls through to 404). Smoke-verified: attacker.example/phish → 404 (not 302). MEDIUM tenant drift closure (R125+6+sec.1) — psql UPDATE backfilled 10 null rows to tenant=1 + ALTER COLUMN SET NOT NULL applied live; 0 nulls/127 total. MEDIUM cache DoS closure — 60s in-memory TTL cache on both endpoints with X-Cache HIT/MISS headers, kills DB-hammer surface. R120 RLS policy r120_tenant_isolation on file_storage CONFIRMED ACTIVE in live DB. Typecheck clean. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_4_sec") ? "" : "truncate"}`}>{"**368 tools**, **113 capabilities**, 29+62+26=117 reference surfaces, 16 personas, **177 live tables** (+1 column R125+6+sec `file_storage.is_public` opt-in gate, default-false), **511 indexes**, **43 governance rules** — R125+6+sec.1 ships public /gallery + /trust pages (default-private opt-in showcase + live safety dashboard) and closes 1 CRITICAL + 2 HIGH + 2 MEDIUM across two architect passes. Public APIs at /api/public/gallery + /api/public/trust with 60s in-memory cache + X-Cache headers. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_4_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+3.6+sec.1 (2026-05-23) — DEMOTED: Public-mirror liability lockdown on jury auto-apply seam. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_3_6_sec_1")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/15 via-primary/5 to-transparent border border-emerald-500/40 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_3_6_sec_1"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+3.6+sec.1</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_3_6_sec_1") ? "" : "line-clamp-2"}`}>{"R125+3.6+sec.1 — Public-mirror liability lockdown on the jury auto-apply seam. NEW env-var gate `JURY_AUTOAPPLY=1` (default OFF) controls whether the queue.json write happens — placed at both auto-apply sites (`scripts/jury-triage.ts` CLI path and `scripts/agentic-ci-self-heal.ts` notifyUnfixable CI healer path). When gate OFF (fork default): jury still runs full 3-model vote, full cost, full latency; per-decision markdown still written to `data/jury-decisions/YYYY-MM-DD-<slug>.md` for human review; CI healer owner-email includes verdict as ADVISORY text — but the machine-readable queue.json (implementer-pickup seam) stays untouched. When gate ON (private setup via Replit shared-env): today's full auto-apply behavior preserved. Public README (`README-PUBLIC.md`) gets a NEW prominent ⚠️ Autonomous Pipelines Disclaimer block: (a) auto-apply OFF by default, (b) opt-in via JURY_AUTOAPPLY=1 with risk-acknowledgement, (c) AS-IS / no-warranty / maintainers-and-Replit-not-responsible clause, (d) responsible-disclosure email + GitHub-issue path. CI-healer owner-email footer notes `(Auto-apply gate: JURY_AUTOAPPLY is not set to \"1\" — verdict shown above is advisory only; no queue entry written.)` so fork operators know exactly which lever to flip. Failure mode for forks: even if a public-mirror user runs the CI healer with their own GitHub PAT, no queue entry is written, no implementer is triggered, no code mutation happens — jury read is advisory only. Test suite still GREEN (22/22 jury-triage unit tests); typecheck clean on both modified callers. No tools/tables/capabilities/governance/personas/MCP scopes/skills changes — pure runtime gate + doc surface. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_3_6_sec_1") ? "" : "truncate"}`}>{"**362 tools** (+1 R125+3.6 jury_triage), 29+62+26=117 reference surfaces, 16 personas, **177 live tables**, **511 indexes**, **43 governance rules**, **113 active capabilities** (+1 multi_model_jury_triage) — R125+3.6+sec.1 ships env-var gate JURY_AUTOAPPLY (default OFF) on the jury auto-apply seam + public-README disclaimer + CI-healer email footer; private setup unchanged; forks get advisory-only behavior. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_3_6_sec_1") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+3.6 (2026-05-23) — Multi-model jury triage primitive + full wiring; +sec closed 4 architect findings (A/B/C/G). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_3_6")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/15 via-primary/5 to-transparent border border-emerald-500/40 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_3_6"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+3.6 (+sec)</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_3_6") ? "" : "line-clamp-2"}`}>{"R125+3.6 — Multi-model jury triage primitive + full wiring (issues/architect/CI). NEW `server/lib/jury-triage.ts` wraps `executeMoA` (frontier pool — deepseek-v4-pro + gpt-5.5 + gemini-3.1-pro-preview, aggregator claude-opus-4-7) with structured `VERDICT: FIX|ACCEPT|REJECT\\nRATIONALE\\n[FIX_PROPOSAL]` prompt, parses each proposer answer, tallies 2-of-3 majority; ties or unparseable → ESCALATE. ACCEPT/REJECT auto-apply (doc-only mutations safe); FIX queues NL proposal to `data/jury-decisions/queue.json` for separate implementer pass (NL → diff would be loop-of-doom). NEW tool `jury_triage` (sensitive/MEDIUM/trustedPersonasOnly: true), NEW capability `multi_model_jury_triage`, NEW CLI `scripts/jury-triage.ts` (three modes: --source=gaps walks docs/architecture-notes.md, --issue=TEXT ad-hoc, --issue-file=PATH). Full wiring: (1) CLI for gap triage, (2) `.agents/skills/architect-finding-triage/SKILL.md` jury section + bypass cases, (3) CI self-healer notifyUnfixable() patched to call jury before email + append verdict to body + persist to queue.json. R125+3.6+sec closed 4 architect findings: A (MEDIUM-HIGH prompt-injection on parser → line-anchored regex + sanitizeForPrompt), G (HIGH zero-test-coverage → NEW tests/unit/jury-triage.test.ts 22 tests), B (MEDIUM policy scope → safe→sensitive + trustedPersonasOnly), C (MEDIUM doc/code drift → SKILL.md softened on auto-apply semantics). Closure-pass architect re-run confirmed B/C/G fully closed and A partially closed with fail-safe-to-ESCALATE locked by 2 additional tests. Smoke test: jury on gap #1 ACCEPT 3-0, κ=0.815, 20.9s. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_3_6") ? "" : "truncate"}`}>{"**362 tools** (+1 jury_triage), **113 capabilities** (+1 multi_model_jury_triage), **29 .agents skills**, 177 tables, 511 indexes, 43 governance, 16 personas — R125+3.6 ships jury_triage primitive + full wiring (issues CLI / architect skill / CI healer); +sec closed 4 findings (parser-injection, zero-tests, policy scope, doc drift) with 22 jury-triage unit tests + fail-safe-to-ESCALATE locked. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_3_6") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+1.1 (2026-05-22) — DEMOTED: whole-app post-edit code-review pass; 1 MEDIUM closed inline, 1 HIGH systemic logged. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_1_1")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/15 via-primary/5 to-transparent border border-cyan-500/40 hover:border-cyan-500/60 hover:bg-cyan-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_1_1"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+1.1</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_1_1") ? "" : "line-clamp-2"}`}>{"R125+1.1 — Whole-app + last-72h post-edit code-review pass. Architect returned 1 HIGH (systemic, pre-existing) + 1 MEDIUM (recent surface). MEDIUM FIXED inline: `client/src/pages/jobs.tsx:154` rendered `href={job.finalDriveUrl}` with no scheme allow-list — a tainted DB value could become a `javascript:` URL sink. Extracted the `safeUrl()` protocol allow-list (R124 inlined in video-jobs-banner.tsx) to NEW `client/src/lib/safe-url.ts` (http/https + site-relative only; rejects `javascript:`/`data:`/`vbscript:`/`blob:`/`file:`), imported in both jobs.tsx (anchor only renders when URL passes validation) and video-jobs-banner.tsx (de-duplicated). HIGH DEFERRED + LOGGED: ~42 executable callsites to `uploadAndShare()`/`uploadToDrive()` outside server/delivery-pipeline.ts/google-drive.ts bypass the replit.md HARD RULE + the R110 +sec pre-delivery secret-scan gate (anchors: server/video-job-runner.ts:678-687 customer video finalization, server/routes.ts:1844, server/tools.ts:8508, server/mpeg-engine.ts:937, server/research-engine.ts:1865). Pre-existing systemic — NOT regressed by R125+1. Documented as a known defense-in-depth gap in docs/architecture-notes.md with a concrete R-round migration shape (top customer-facing sites first → CI regression guard → leave internal scratch writes on direct upload). Single-user blast radius = LOW today; reopens to HIGH on any second-human consumer. Architect CLEAN on: tenant isolation (video-jobs routes), AHB (tests/security/ahb-regression.test.ts non-empty, intent-gate fails-open + destructive policy fails-closed, R125+1 `proposer_pool` confirmed safe/LOW), SQL parameterization (MoA pool-tag write parameterized via Drizzle template), CSRF (new video-jobs routes not skip-listed), R123 +sec memory-backup fix intact, prompt-injection/CoVe (aggregator prompt unchanged by proposer_pool; CoVe keeps draft as user content not system instructions), SSRF/jsdom/ESM (no new regressions in last-72h surfaces), stale-strings preflight CLEAN. `tsc --noEmit` CLEAN. No tools/tables/capabilities/governance/personas/MCP changes. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_1_1") ? "" : "truncate"}`}>{"**361 tools** (unchanged R125+1 → R125+1.1 — pure security review), 28+62+25=115 reference surfaces, 16 personas, **177 live tables**, **511 indexes**, **43 governance rules**, **112 active capabilities** — R125+1.1 closes 1 MEDIUM (`jobs.tsx` `javascript:`-URL sink — shared `safeUrl()` extracted to `client/src/lib/safe-url.ts`) and DEFERS + LOGS 1 HIGH systemic gap (~42 direct `uploadAndShare()`/`uploadToDrive()` callsites bypass the delivery pipeline; pre-existing, single-user LOW blast radius today). _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_1_1") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+1 (2026-05-22) — DEMOTED to amber per website-surface-sync skill. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_1")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/15 via-primary/5 to-transparent border border-amber-500/40 hover:border-amber-500/60 hover:bg-amber-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r125_1"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+1</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_1") ? "" : "line-clamp-2"}`}>{"R125+1 — OpenRouter `ensemble_query` proposer-pool A/B infrastructure — OPT-IN, no default flip. `server/moa.ts`: introduced FRONTIER_PROPOSERS (alias of old DEFAULT_PROPOSERS — deepseek-v4-pro / gpt-5.5 / gemini-3.1-pro-preview, unchanged 3-model default), CHEAP_PROPOSERS (5 lineage-diverse OpenRouter cheap models: meta-llama/llama-4-maverick, inclusionai/ling-2.6-1t:free, xiaomi/mimo-v2-flash, google/gemma-4-31b-it, z-ai/glm-4.7-flash), MIXED_PROPOSERS (3 frontier + 3 cheap). Bumped MAX_PROPOSERS 5 → 8. Exported `resolveProposerPool(name)` + `ProposerPool` type. Added `pool?: \"frontier\"|\"cheap\"|\"mixed\"` to MoAOptions. Selection priority: explicit proposerIds > pool > FRONTIER_PROPOSERS. Encoded pool choice in moa_responses.invoked_via as `tool|pool=cheap` suffix — telemetry without a schema change. `server/tools.ts`: added optional `proposer_pool` enum param to ensemble_query schema; dispatcher validates and silently drops invalid values to undefined (fail-safe to frontier default). NEW `scripts/ensemble-query-ab.ts`: one-line agent-runnable A/B harness (`AB_TENANT_ID=1 AB_REPEATS=3 npx tsx scripts/ensemble-query-ab.ts`). Sweeps N prompts × 3 pools, emits CSV + per-pool roll-up (ok_rate / κ_mean / latency_ms / answer_len / escalate_rate), per-run try/catch so one failed run never sinks the sweep, exit 2 if ≥50% runs have zero ok proposers. No API-key value logging (presence-only). NEW `tests/lib/moa-pool.test.ts`: 5 node:test units on resolveProposerPool — frontier=3, cheap=5 with 5 distinct vendors, mixed=6 = frontier + 3 cheap, precedence contract, returns fresh arrays. Post-edit architect review PASS with 1 LOW (invoked_via mistagged when explicit proposerIds co-supplied with pool — telemetry only). FIXED inline at server/moa.ts:333 — invokedViaTagged appends `|pool=...` only when `!explicitProposerIds`; precedence-contract test added. Architect-verified CLEAN on sensitive surfaces. No tools/tables/capabilities/governance/MCP scopes/personas changes. `tsc --noEmit` CLEAN. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_1") ? "" : "truncate"}`}>{"**361 tools** (unchanged — extending existing ensemble_query signature), 28+62+25=115 reference surfaces, 16 personas, **177 live tables**, **511 indexes**, **43 governance rules**, **112 active capabilities** — R125+1 ships OpenRouter cheap-jury A/B infrastructure for ensemble_query (frontier/cheap/mixed pools, MAX_PROPOSERS 5→8, telemetry via invoked_via, agent-runnable A/B harness, 5 node:test units); OPT-IN — default stays frontier until A/B proves otherwise. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_1") ? "rotate-180" : ""}`} />
        </button>

        {/* R123 +sec (2026-05-21) — DEMOTED to amber accent per website-surface-sync skill. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r123_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/15 via-primary/5 to-transparent border border-amber-500/40 hover:border-amber-500/60 hover:bg-amber-500/20 transition-colors text-left group"
          data-testid="banner-whats-new-r123_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R123+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r123_sec") ? "" : "line-clamp-2"}`}>{"R123 +sec — Post-edit code-review HIGH fix. Architect flagged `POST /api/memory/backup-to-drive` (server/routes/memory.ts:356-365) calling `uploadAndShare()` directly — bypassed both the replit.md file-delivery HARD RULE and the R110 +sec pre-delivery secret-scan gate (48 patterns, fail-CLOSED on CRITICAL/HIGH). Refactored the route to stage backup JSON under `uploads/` then route through `deliverDigitalProduct({customerName: tenantName, productName, filePath, fileName, mimeType:\"application/json\", sendEmail:false, metadata:{kind:\"memory_backup\",tenantId,stats}})`; response now returns `deliveryId` + `shareableLink`/`folderLink`/`downloadLink` and 500s cleanly on `delivery.success===false`. NEW `tests/security/memory-backup-uses-delivery-pipeline.test.ts` regression strips line + block comments from `server/routes/memory.ts` then asserts no executable `uploadAndShare(` / `uploadToDrive(` call AND presence of `deliverDigitalProduct(` (2/2 pass). Whole-app post-edit code-review pass across last-72h surfaces (R123 CoVe + R122 Unified Memory + R120.1+sec AHB safety_profile + R120 RLS + R121 skill imports) AND app-wide sensitive-surface invariants (tenant isolation via withTenantTx, AHB intent-gate + destructive-tool policy, SQL parameterization, CSRF, secrets/file-delivery, prompt injection on new CoVe surface, SSRF, jsdom, ESM, OAuth) → architect verdict CLEAN; the one HIGH is now closed and re-verified. Filename uses `tenantName.replace(/[^a-zA-Z0-9]/g,\"-\")` + ISO timestamp → no path-traversal vector. `tsc --noEmit` CLEAN. No tools / tables / capabilities / governance changes. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r123_sec") ? "" : "truncate"}`}>{"**361 tools** (unchanged R123 → R123+sec — pure security hardening), 28+62+25=115 reference surfaces, 16 personas, **177 live tables**, **511 indexes**, **43 governance rules**, **112 active capabilities** — R123+sec closes the HIGH post-edit-code-review finding: memory-backup route routed through `deliverDigitalProduct()` (instead of bypassing the pipeline + secret-scan gate); regression test pinned that strips comments and asserts no executable `uploadAndShare`/`uploadToDrive` call plus presence of `deliverDigitalProduct`. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r123_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R123 (2026-05-21) — DEMOTED to muted accent per website-surface-sync skill. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r123")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/40 via-primary/5 to-transparent border border-muted hover:border-muted-foreground/40 hover:bg-muted/60 transition-colors text-left group"
          data-testid="banner-whats-new-r123"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R123</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r123") ? "" : "line-clamp-2"}`}>{"R123 — Chain-of-Verification (CoVe) factuality-hardening pass for longform outputs (Dhuliawala et al., Meta FAIR, arXiv:2309.11495). NEW `server/lib/cove-verifier.ts` runs a 4-step pipeline: (1) PLAN — extract atomic factual claims from the draft + rewrite each as a standalone verification question (JSON, max-clamped 1..15 default 8); (2) EXECUTE INDEPENDENTLY — answer each question in PARALLEL via `Promise.allSettled`, each call in a FRESH context with NO draft visible (the trick — single-model independence ≈ ensemble for narrative claims since the model can't repeat its own bias if it can't see what it wrote, 30s timeout per question via AbortController); (3) REVISE — show draft + Q/A pairs, ask for JSON revision that softens UNCERTAIN claims and replaces contradictions; (4) return `{revised, unchanged, claimsExtracted, questionsAsked, contradictions[], qa[], modelUsed, durationMs, warning?}`. NEVER throws — fail-safe wraps every step and falls back to original draft + warning. 16k char draft cap; drafts <80 chars returned unchanged. NEW agent tool `verify_with_cove` registered in tool-registry (categories: system/quality/research, slow, isNetworkTool:true), destructive-tool-policy (safe / LOW / requiresStructuredArgs), capability-registry (`chain_of_verification`), tools.ts schema + dispatch case. NEW capability `chain_of_verification` documenting the four-step pipeline + Dhuliawala citation + Cassandra integration + the explicit \"~5-25% factuality lift not 94%\" caveat so future agents don't oversell it. WIRED into `server/research-report-fulfillment.ts` as opt-in `verify?: boolean` flag on `ResearchReportIntake` (default off; AUTO-ON for `depth: \"deep\"` since deep reports are the high-stakes surface). Per-section pass with `maxQuestions:6`, `modelTier:\"balanced\"`, skips bookend sections (intro/disclaimer/sources) and bodies <200 chars or starting with \"(\" (error fallbacks). Fail-open at the call site (try/catch ignores errors, logs warning) so a bad CoVe pass never sinks a paid $49 report. NEW `tests/lib/cove-verifier.test.ts` — 4 unit tests covering the fail-safe surface. Tools 360 → 361, capabilities 111 → 112. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r123") ? "" : "truncate"}`}>{"**361 tools** (was 360 — +1 verify_with_cove), 28+62+25=115 reference surfaces, 16 personas, **177 live tables**, **511 indexes**, **43 governance rules**, **112 active capabilities** (was 111 — +1 chain_of_verification) — R123 ships a 4-step CoVe pipeline (plan → execute independently in PARALLEL with FRESH context → revise → return revised draft + telemetry; NEVER throws) + agent tool `verify_with_cove` + capability + wired into the research-report fulfillment pipeline as opt-in (AUTO-ON for depth:deep). _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r123") ? "rotate-180" : ""}`} />
        </button>

        {/* R122 (2026-05-20) — Unified Memory Context. DEMOTED to muted accent per website-surface-sync skill. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r122")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r122"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R122</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r122") ? "" : "line-clamp-2"}`}>{"R122 — Unified Memory Context. NEW `server/memory/unified-context.ts` aggregator returns a normalized, sorted-by-recency timeline across 11 memory-adjacent tables (memory_entries, agent_knowledge, conversation_facts, mind_tickets, procedure_edits, agent_runs, agent_trace_spans, graph_memory, knowledge_triples, mind_events, conversations) with per-source totals + per-source filtered counts. Read-only, tenant-isolated via R120 withTenantTx (RLS context applies to every fetch), per-source fail-OPEN so one wonky table doesn't take down the view. Three surfaces: NEW agent tool `get_unified_memory_context` (safe / LOW / requiresStructuredArgs / categories memory+conversations+knowledge), NEW HTTP `GET /api/memory/unified`, NEW CLI `npx tsx scripts/memory-find.ts \"keyword\"`. NEW /memory page \"Unified\" tab as FIRST tab with cross-source timeline, 11-color source-pill filter, debounced ILIKE search, sinceDays selector (7/30/90/365/all), per-source filtered/total counts, deep links to /memory#entry-N, /knowledge#entry-N, /chat/N, /jobs?run=N, /code-proposals?id=N, /graph-explorer?path=. Capability `unified_memory_context` registered in capability-registry. Tools 359 → 360, capabilities 110 → 111. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r122") ? "" : "truncate"}`}>{"**360 tools** (was 359 — +1 get_unified_memory_context), 28+62+25=115 reference surfaces, 16 personas, **177 live tables**, **511 indexes**, **43 governance rules**, **111 active capabilities** (was 110 — +1 unified_memory_context) — R122 ships the single read surface across 11 memory tables so nothing a tenant stored ever gets lost in a corner. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r122") ? "rotate-180" : ""}`} />
        </button>

        {/* R121 (2026-05-20) — DEMOTED to muted accent. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r121")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r121"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R121</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r121") ? "" : "line-clamp-2"}`}>{"R121 — Engineering-Discipline Skill Imports From mattpocock/skills (MIT, ~48-77k stars, Diff-Merged With VisionClaw Conventions). NEW `.agents/skills/tdd/` enforces strict RED-first red-green-refactor with a VisionClaw-specific sensitive-surface invariant table — every change touching AHB persona profiles, TOOL_POLICIES, tenant-RLS, CSRF, or Drive admin-marker gets a mandatory pre-implementation invariant test (referencing existing `persona-safety-profile-coverage` / `rls-isolation` test patterns). NEW `.agents/skills/cross-session-handoff/` distinct from intra-turn `.local/session_plan.md` — produces `.local/handoffs/YYYY-MM-DD-topic.md` briefing for the next agent/task-agent/tomorrow-Bob with Suggested-Skills + Sensitive-Surface-Invariants-Touched sections, gitignored, redacts secrets. NEW `.agents/skills/zoom-out/` is the missing pre-edit orientation primitive (architect/post-edit-code-review only run AFTER edits) — produces a callers map + module map in VisionClaw domain vocabulary with sensitive-surface invariant checklist before editing unfamiliar code. NEW `.agents/skills/write-a-skill/` is a diff-merge with the platform's existing `.local/skills/skill-authoring/` — adopts Matt's sharper \"description-is-what-future-agent-sees\" framing + scripts criteria + review checklist on top of VisionClaw R-N-import-attribution + sensitive-surface flag table + .agents/skills/ vs DB-backed data/output-skills/ distinction. NEW `docs/future-integration-bookmarks.md` lightweight living index of external repos worth remembering — bookmarks mattpocock/skills + HKUDS/AI-Trader with what/why-not-today/when-to-revisit/concrete-integration-shape/anti-goals per entry. Skill count 24 → 28 .agents/ skills (+4). NO new tools / tables / indexes / personas / governance / capabilities / MCP scopes — pure engineering-discipline surface. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r121") ? "" : "truncate"}`}>{"**359 tools** (unchanged R120.1+sec → R121 — pure skill-imports), **28 .agents/ + 62 db + 25 output-skills = 115 reference surfaces** (was 24+62+25=111), 16 personas, **177 live tables**, **511 indexes**, **43 governance rules**, **110 active capabilities** — R121 imports 4 sharp engineering-discipline primitives from Matt Pocock's public Claude skills repo, each VisionClaw-adapted with platform-specific invariant tables and distinct from existing skills. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r121") ? "rotate-180" : ""}`} />
        </button>

        {/* R120.1+sec (2026-05-20) — DEMOTED to muted accent per website-surface-sync skill. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r120_1_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r120_1_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R120.1+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r120_1_sec") ? "" : "line-clamp-2"}`}>{"R120.1+sec — AHB Safety_Profile Coverage Gap Closed (User-Requested Whole-App + 72h Thorough Architect Sweep, \"Fix All Defer Nothing\"). **HIGH (architect)**: 10 of 16 active personas had `safety_profile = '{}'::jsonb` in the live DB — `server/safety/intent-gate.ts:154` defaults mode to \"off\" and bypasses entirely when `restrictedCategories` is empty, so adversarially-styled requests routed to those personas got ZERO AHB screening. The 4 highest-risk consumer-facing personas (Felix, Teagan, Apollo, Robert) were already populated; the gap was on VisionClaw + 9 back-office roles (Forge, Chief of Staff, Agent Blueprint, Scribe, Proof, Radar, Neptune, Atlas, Cassandra, Luna, Minerva). **Fix**: NEW `scripts/migrations/R120.1-persona-safety-profile-backfill.sql` — idempotent `UPDATE ... WHERE safety_profile = '{}'::jsonb` per-persona with role-appropriate `intentGate` (strict for Cassandra/Luna; moderate for the rest), `restrictedCategories[]`, `refusalCopy`, `destructiveToolPolicy: \"require_structured_intent\"`, and `ahbRegression: true`. Applied to dev DB; verified 0 empty / 16 populated post-apply. **NEW runtime backfill block at `server/seed.ts:3981-4022`** — same per-persona UPDATEs re-applied at every startup so a fresh DB (or any future persona inserted without a profile) self-heals. **NEW CI invariant test `tests/security/persona-safety-profile-coverage.test.ts`** — fails CI if any active persona has missing intentGate (must be \"strict\"|\"moderate\") or empty restrictedCategories[]. 1/1 PASS on dev. **MEDIUM (architect) FALSE POSITIVE — closed without code change**: claim was that CSRF middleware fails open when `getCsrfSessionKey()` returns null with a valid tenantId. Verified at `server/validation.ts:188-198` — when `tenantId != null`, `getCsrfSessionKey` returns `\"tnt:\" + tenantId` unconditionally (line 198). The `!sessionKey` branch at line 274-276 is dead defensive code that cannot trigger in the post-line-268 flow. Logged as FALSE POSITIVE. **Architect verdict re-confirmed CLEAN**: R119.2+sec Drive admin guard intact; R120 RLS migration + test asserts ENABLED + FORCE off + policy existence (no Phase 3 over-claim); `withTenantTx` readback hardening intact; no jsdom `runScripts:'dangerously'`; no `.default(1)` on `tenant_id`; `.replit` not tracked; tenant isolation invariants intact on all touched surfaces. No new tools / tables / indexes / personas / governance / capabilities / MCP scopes — pure security hardening (aggregate stats unchanged R120 → R120.1+sec). `tsc --noEmit` CLEAN, preflight CLEAN (7 rules), AHB coverage test 1/1 PASS, RLS Phase 1 test 2/2 PASS, Start application healthy on restart (16/16 personas with populated intentGate, 359 tools, tool-registry GREEN). _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r120_1_sec") ? "" : "truncate"}`}>{"**359 tools** (unchanged R120 → R120.1+sec — pure security hardening), 24 + 62 + 25 output-skills = 111 reference surfaces, 16 personas (now 16/16 with populated intentGate, up from 6/16), **177 live tables**, **511 indexes**, **43 governance rules**, **110 active capabilities** — R120.1+sec closes the HIGH AHB safety_profile coverage gap on 10 of 16 active personas via idempotent SQL migration + runtime self-heal in seed.ts + CI invariant test; MEDIUM CSRF claim verified dead defensive code (logged FALSE POSITIVE, no fix needed). _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r120_1_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R120 (2026-05-20) — DEMOTED to muted accent per website-surface-sync skill. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r120")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r120"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R120</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r120") ? "" : "line-clamp-2"}`}>{"R120 — Architectural Hardening (Gemini-3.5-Flash-Extended Review Adopted). Postgres Row-Level Security as second line of defense on 12 highest-sensitivity tenant tables (memory_entries, messages, conversations, file_storage, message_feedback, customers, invoices, contracts, agent_trace_spans, mind_tickets, agent_runs, procedure_edits) — audit-mode policy fails OPEN when no tenant context is set, fails CLOSED when context is set via NEW `withTenantTx(tenantId, fn)` helper in server/db.ts that wraps a transaction with `SELECT set_config('app.current_tenant', N, true)`. NEW `tests/security/rls-isolation.test.ts` proves cross-tenant SELECT returns only the bound tenant's rows. NEW `scripts/index-usage-audit.ts` queries `pg_stat_user_indexes` and reports never-used / rarely-used indexes — first run on dev DB found 251 never-used non-PK/UQ indexes burning 55.91 MB (68.9% reclaimable from drops). NEW `docker-compose.dev.yml` with pgvector/pg16 + Ollama service pre-wired for local LLM + embedding inference (cost-conscious contributors). NEW `scripts/preflight-tsc.ts` local hard-gate equivalent of the CI typecheck job. Design docs: `docs/rls-rollout-plan.md` (Phase 1 audit → Phase 4 FORCE on all 116 tenant tables) + `docs/microsandbox-design.md` (clarifies Gemini's mistaken regex-deny-list premise: actual guardrails are TOOL_POLICIES + AHB intent gate + trustedPersonasOnly, not string matching; deferred sandbox phases A→D scoped at ~7 engineer-weeks)."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r120") ? "" : "truncate"}`}>{"**359 tools** (unchanged R120 — pure hardening + tooling), 24 + 62 + 25 output-skills = 111 reference surfaces, 16 personas, **177 live tables**, **511 indexes** (audit found 251 droppable; not dropped this round — awaiting prod replay), **43 governance rules**, **110 active capabilities** — R120 adds Postgres RLS audit-mode (12 tables) + withTenantTx() helper + cross-tenant RLS test + 55.91 MB index-bloat audit + docker-compose.dev.yml with Ollama + local tsc preflight + 2 design docs for RLS phased rollout and microsandbox triage. Closes Gemini-3.5-Flash-Extended review items #1 (DB-engine defense-in-depth), #2 (RLS implementation), #4 (tsc local gate equivalent of CI), #5 (local Ollama/pgvector dev compose); items #3 (MCP modularization) already shipped in R113.7+sec; #6 (microsandbox) design-doc-only this round. _(model: anthropic/claude-sonnet-4.5)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r120") ? "rotate-180" : ""}`} />
        </button>

        {/* R119.2+sec (2026-05-20) — DEMOTED to muted accent per website-surface-sync skill. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r119_2_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r119_2_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R119.2+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r119_2_sec") ? "" : "line-clamp-2"}`}>{"R119.2+sec — Cross-Tenant Nightly Memory-Backup Hardened (User-Requested Whole-App + 72h Thorough Architect Sweep, 3 Architect Passes Loop-Until-Clean, \"Fix All Defer Nothing\"). **CRITICAL #1 (HIGH)**: `scripts/nightly-memory-backup.ts` dumps ALL tenants' `memory_entries` to a single JSON in Drive (cross-tenant aggregate by design — only the owner should see it), AND the `google_drive` agent tool's `list/download/delete/share` cases had no tenant/authz gate → any persona could enumerate, pull, delete, or mint a shareable link for the aggregate backup if it knew (or guessed) the file. **Fix**: backup folder renamed `__VisionClaw-Admin-Backups__/` with filename prefix `__admin-memory-backup-`; NEW `ADMIN_DRIVE_ARTIFACT_RE = /^__(admin[-_]|VisionClaw-Admin[-_])/i` filters list results (returns `adminArtifactsHidden` count) AND fail-CLOSED metadata preflight on download/delete/share via `driveJson(/drive/v3/files/<fileId>?fields=id,name,mimeType)` — refuses operation if name empty, `meta.error` truthy, regex matches admin marker, or the metadata lookup itself throws. **MEDIUM #1**: `server/seed.ts` Manjaro→wellness-program normalizer was unconditional cross-tenant; could corrupt valid \"Manjaro Linux\" distro references → WHERE clause narrowed to exclude Linux ecosystem terms (case-insensitive guard on `linux|distro|kernel|arch|pacman|aur`). **MEDIUM #2**: R118 `message_feedback.comment` had no DB-level length CHECK (API-only enforcement bypassable by direct SQL / scripts) → idempotent `check_message_feedback_comment_len CHECK (char_length(comment)<=2000)` added to `scripts/migrations/R118-message-feedback.sql`, applied to dev DB, pg_constraint verified. **Round 2 architect FAIL**: round-1 download guard checked nonexistent `r.fileName`, delete preflight unused `meta` variable — both no-ops. **Round 2 fix**: imported `driveJson` from `server/google-drive.ts`, replaced both with real fail-CLOSED metadata-by-fileId preflight; extended same guard to `share` so admin artifacts can't be made link-shareable either. **Round 3 architect PASS**: all three rejection conditions return error objects, `encodeURIComponent(fileId)` belt-and-suspenders path-segment safety, `tsc --noEmit` CLEAN, preflight CLEAN, Start application healthy on restart (359 tools, tool-registry GREEN). Auto Git Push autonomous (90s quiet timer); fix commit a76d905 pushed to GitHub. Includes R119 (2026-05-19) — Context-Window Expansion exploits 1M-token frontier models (Gemini 3.5 Flash, GPT-5.5, Claude 4.7, DeepSeek V4 family, Grok 4.20) by raising per-model context budgets, memory recall k, self-reflection truncation, and history-slice caps. `server/context-window-guard.ts:13` adds gpt-5.5 / gemini-3.5-flash @ 1M + corrects DeepSeek V4 family 200K/128K→1M; `server/compaction.ts` `shouldPreemptivelyCompact(messages, contextBudgetOrModelId)` accepts a modelId string (static ESM import, NOT dynamic `require()` — would fail-silently under \"type\":\"module\" and skip the model-aware path entirely, which was the architect's MEDIUM #1 from round 1); returns final trigger budget directly as `max(64_000, floor((win − 64_000) × 0.75))` (earlier draft also multiplied by 0.75 outside, producing an effective 45% trigger STRICTER than the legacy default for 200K models — architect's MEDIUM #2). Trigger points: 128K→64K floor, 200K→102K, 1M→702K, 2M→~1.45M. `truncateToolResults` default 2000→8000; `server/chat-engine.ts:2717` passes `model` so budget scales with the live model; `server/self-reflection.ts:62,63,131` user-msg slice 500→4000, assistant-response 2000→20000, refinement-original 3000→30000 (10×); `server/agent-channels.ts:239,242` messages slice(0,10)→slice(0,30) + content substring 200→500 (3× cross-persona awareness); `server/orchestrator-ledger.ts` facts/plan 2000→8000, saveLedgerState history.slice(-20)→slice(-50); `server/agentic/executor.ts:258` self-heal recentSteps slice(-3)→slice(-10); `server/tools.ts:7056` vectorSearchKnowledge topK 10→25. Tenant isolation invariants verified intact on all touched sensitive surfaces. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r119_2_sec") ? "" : "truncate"}`}>{"**359 tools** (unchanged R119/R119.2+sec — pure security hardening + context-window tuning), 24 + 62 + 25 output-skills = 111 reference surfaces, 16 personas, **177 live tables**, **511 indexes**, **43 governance rules**, **110 active capabilities** — R119.2+sec closes a HIGH cross-tenant exposure on the nightly memory-backup + 2 MEDIUM (seed.ts Manjaro/Linux false-positive, R118 message_feedback.comment DB CHECK) via 3 architect passes loop-until-clean (round 2 caught my own fix being a no-op; round 3 PASS); driveJson fail-CLOSED metadata preflight on download/delete/share + ADMIN_DRIVE_ARTIFACT_RE list filter + admin folder/filename markers. Bundled with R119 1M-token context-window expansion across Gemini 3.5 Flash / GPT-5.5 / Claude 4.7 / DeepSeek V4 / Grok 4.20 — full prior history below"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r119_2_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R118 (2026-05-19) — DEMOTED to muted accent per website-surface-sync skill. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r118")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r118"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R118</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r118") ? "" : "line-clamp-2"}`}>{"R118 — Per-Message Thumbs Feedback (Tigrimos Nugget #1 Of 5) Becomes The 4th AEvo Evidence Dimension Alongside Skill-Lookups / Delivery-Failures / Near-Miss-Grades. NEW `message_feedback` Table (tenantId notNull NO DEFAULT, rating int CHECK (-1, 1), optional comment max 2000, optional topic_hint, UPSERT on (tenant, msg, COALESCE(user_id, 0)) — User Changing Vote Replaces Rather Than Stacks). 4 NEW Indexes (partial idx_message_feedback_tenant_topic WHERE topic_hint IS NOT NULL, idx_message_feedback_tenant_msg, idx_message_feedback_tenant_rating_created, uq_message_feedback_tenant_msg_user UNIQUE expression-form). Fail-CLOSED Tenant Invariants: storage method JOINs `messages` to verify tenantId AND conversationId match the message owner BEFORE INSERT, throws on mismatch; route layer also explicit-tenant-cross-checks BEFORE calling storage (defense-in-depth). Server-Side Topic-Hint Resolution: best-effort join to most-recent `lookup_output_skill` agent_trace_span on the same conversationId within ±10 min of message createdAt — stamps `topic_hint` so AEvo `gatherEvidence` can attribute the feedback to a specific output-skill (fails OPEN to null — feedback still recorded, just not skill-attributed). AEvo `gatherEvidence` Extended: 4th query pulls `rating = -1 AND topic_hint = ${targetId}` via the partial index, top-100, fed through the same `compactFailureNotes` Top-K (k=8) + diversity-0.7 sparsifier as `recentFailureNotes` so a single duplicate complaint can't flood the proposer prompt. **Positive ratings deliberately NOT used** as evidence — we don't lower the bar on a skill that's already working. NEW `ThumbsFeedback` React Component (`client/src/pages/chat.tsx:832`) — ThumbsUp/ThumbsDown lucide icons, opacity-0 group-hover:opacity-100 on assistant message bubbles only (not user, not streaming), optional comment input revealed after thumbs-down (1-tap → save -1 immediately + show comment box; press Enter to attach), uses `apiRequest` for auto-CSRF + auth, data-testid `button-thumbs-{up,down}-${messageId}`. NEW Route `POST /api/messages/:id/feedback` with `validate(messageFeedbackSchema)` Zod + auto-CSRF + auth gate via `getTenantFromRequest` (401/403/404 fail-closed on missing tenant / cross-tenant / missing-message). **Same-Round +sec Architect Pass Closed (\"fix all, defer nothing\"):** (HIGH pre-existing R115.3-era) `gatherEvidence` queries referenced columns that don't exist (`name`/`input`/`output`) silently fail-OPEN to zero, masking the AEvo evidence dimension entirely → fixed to `tool_name = 'lookup_output_skill'` + `(metadata::jsonb ->> 'topic')` AND `tool_name = 'grade_deliverable'` + `(summary ILIKE '%nearMissDimension%' OR metadata::text ILIKE '%nearMissDimension%')`. (HIGH new) `lookup_output_skill` spans were opened by generic `withSpanOrRoot` wrapper but metadata payload was only `{paramKeys}` — values weren't being captured, so the now-correct AEvo queries had nothing to join on → `server/tools.ts:8038-8068` span-metadata enrichment allowlist (safe scalar params `topic`/`department`/`persona` length-capped at 200; `_conversationId`/`conversationId` numbers folded into metadata; underscore-prefixed runtime keys still stripped — no credential leakage). (MEDIUM) UPSERT key + rating CHECK only in dev DB via psql ALTER, not codified → NEW `scripts/migrations/R118-message-feedback.sql` idempotent migration (CREATE TABLE IF NOT EXISTS, DO $$ NOT EXISTS guards on CHECK, CREATE INDEX IF NOT EXISTS incl. expression-form UNIQUE on `(tenant_id, message_id, COALESCE(user_id, 0))`) — replays cleanly. (LOW) R117 tools (`read_output_blob`, `code_slice`) registered in TOOL_DEFINITIONS but missing from agent-discovery surfaces → `server/tools-reference.ts` adds both to Files category + extends Forge's persona focus with explicit R117 usage guidance (prefer code_slice over read_file for large source files; use read_output_blob with mode='grep'/'sliceLines' when prior tool returns {truncated:true, sandboxLabel:'...'}). Sanity import-test of shared/schema.ts + server/storage.ts PASS, preflight CLEAN (7 rules), idempotent migration replay CLEAN (all 5 NOTICEs say \"already exists, skipping\"), Start application healthy on restart (359 tools loaded, tool-registry/wiring-audit GREEN, no new warnings). _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r118") ? "" : "truncate"}`}>{"**359 tools** (unchanged R118 — purely additive UX dimension), 24 + 62 + 25 output-skills = 111 reference surfaces, 16 personas, **177 live tables** (+1 message_feedback), **511 indexes** (+4 R118 partial/unique), **43 governance rules**, **110 active capabilities** — R118 ships per-message ThumbsUp/ThumbsDown on assistant bubbles + new `message_feedback` table (fail-CLOSED tenant invariants + JOIN-verified message ownership + UPSERT on (tenant, msg, COALESCE(user_id, 0))) + server-side topic-hint resolution via lookup_output_skill agent_trace_spans (±10 min) + AEvo `gatherEvidence` extended to a 4th evidence dimension (rating=-1 + topic_hint Top-K=8 diversity-0.7 sparsifier; positive ratings deliberately NOT used as evidence); same-round +sec architect pass closes pre-existing R115.3-era HIGH on AEvo column-name mismatch + new HIGH on span-metadata enrichment in tools.ts:8038-8068 so lookup_output_skill calls actually populate metadata.topic + metadata.conversationId + MEDIUM migration codification + LOW R117 tools-reference wiring for Forge — full prior history below"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r118") ? "rotate-180" : ""}`} />
        </button>

        {/* R117.1+sec (2026-05-19) — Cross-tenant file_storage overwrite hardened in server/pdf-create.ts. DEMOTED to muted accent per website-surface-sync skill. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r117_1_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r117_1_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R117.1+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r117_1_sec") ? "" : "line-clamp-2"}`}>{"R117.1+sec — Cross-Tenant pdf-create Hardening + R117 Token-Optimization Tools. **R117.1+sec** (user-requested whole-app thorough code review, architect-finding-triage \"fix all, defer nothing\"): closed 1 HIGH (cross-tenant `file_storage` overwrite via `server/pdf-create.ts:persistToDb` SELECT/UPDATE by filename only + INSERT missing `tenantId` → schema `.notNull()` violation for any caller that ran). Imported `and` from drizzle-orm, added `PDF_ADMIN_TENANT_ID=1` constant + `resolveTenantOrAdmin(tenantId, caller)` helper that fail-warns when defaulting. `persistToDb(filename, originalName, pdfBytes, tenantId: number)` now (a) fail-closed validates `Number.isInteger && >0` at entry, (b) scopes SELECT/UPDATE with `and(eq(filename), eq(tenantId))`, (c) INSERT includes `tenantId`. Threaded optional `tenantId?: number` through `CreatePdfParams`/`FillPdfParams`/`EditPdfParams`/`StyledPdfOptions` + 4 tool dispatch cases (`create_pdf`, `create_styled_report`, `fill_pdf`, `edit_pdf`) + 2 `htmlToPdfAndUpload` call sites + `server/routes/briefings.ts:468` + `server/research-report-fulfillment.ts:147` (minor follow-up). All 3 other `db.insert(fileStorage)` sites verified CLEAN. ~30 admin-tier `scripts/*` callers default to `ADMIN_TENANT_ID=1` with per-call `console.warn` audit trail (architect approved). **R117** (token-optimization import from 10-repo external review): two new agent tools sharing a symbol-graph layer. NEW `server/lib/blob-reader.ts` — partial-read API for `wrapLargeResult` sandbox blobs (head/slice_lines/grep modes); `LABEL_RE` enforces `[A-Za-z0-9_][A-Za-z0-9_\\-]{0,63}` (path-jail), `resolveBlobPath` prefix-matches against sandbox dir, `DEFAULT_MAX_BYTES=16KB`, `HARD_MAX_BYTES=64KB` ceiling, grep caps at 200 matches + ±contextLines. NEW `server/lib/code-symbol-slicer.ts` — TS Compiler API AST extraction for .ts/.tsx/.js/.jsx + regex fallback for .py/.go/.rs/.java/.rb; overlap-merge collapses adjacent slices; path-jail; reports `compressionRatio`. Two new agent tools `read_output_blob` + `code_slice` registered in TOOL_DEFINITIONS + tool-registry (categories files/system, safe LOW). **ReDoS hardening (architect rounds 3–7):** `isDangerousRegexShape()` is token-aware structural scanner — handles `\\\\` escapes + `[...]` char classes, tracks group nesting via frame stack, rejects lookarounds, backreferences, shallow nested-quantifier `(...+)+`, any quantified group whose subtree contains alternation (bubbles `hasAlternation` up across wrapping groups — closes `((a|aa))+$` round-5 bypass), and malformed patterns with unbalanced parens (round-6 stack-underflow fix). 28/28 tests PASS via `npx tsx --test`. **Counts:** tools 357→359 (+2), tables 176, indexes 507, capabilities 110, governance 43, personas 16, skills 24+62+25. tsc CLEAN, preflight CLEAN (7 rules), Start application healthy on restart. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r117_1_sec") ? "" : "truncate"}`}>{"**359 tools** (+2 R117: `read_output_blob` + `code_slice`), 24 + 62 + 25 output-skills = 111 reference surfaces, 16 personas, **176 live tables**, **507 indexes**, **43 governance rules**, **110 active capabilities** — R117.1+sec closes cross-tenant `file_storage` overwrite HIGH via `resolveTenantOrAdmin` helper + scoped SELECT/UPDATE/INSERT in server/pdf-create.ts (all 5 exported functions + 6 callers threaded with tenantId; ~30 admin scripts default to tenant 1 with per-call warn audit trail); R117 ships two token-optimization tools on shared symbol-graph layer with token-aware ReDoS structural scanner (28/28 tests PASS) — full prior history below"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r117_1_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R116 (2026-05-18) — agentmemory Tier-A bundle. DEMOTED to muted accent per website-surface-sync skill. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r116")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r116"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R116</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r116") ? "" : "line-clamp-2"}`}>{"R116 — agentmemory Tier-A Bundle (Five Nuggets In One Round). N2 Per-Category Ebbinghaus Decay (memory_entries.last_reinforced_at + memory_categories.half_life_days; architecture decisions decay over 90d, transient bugs over 3d on the same ranker). N6 Active Contradiction Resolver (NEW server/lib/contradiction-resolver.ts scoring 0.45×authority + 0.30×recency (20d e-fold) + 0.25×log-normalized support × confidence; hooked into MoA κ-low escalation as fail-OPEN belt-and-suspenders). N7 Heuristic quality_score Gate (NEW server/lib/quality-score.ts grades every queue-routed memory write 0..1 on length+token+terminator+repetition+printable+source-class+confidence-cap; folded multiplicatively into ranker so malformed-but-confident facts get down-ranked; partial index for ops review queue). N9 MCP Memory Scope (4 NEW MCP tools `memory_smart_search` / `memory_save` / `memory_supersede` / `memory_list_recent` + 2 NEW scopes `memory:read` / `memory:write`, all fail-CLOSED on missing scope). N14 Typed Edge Taxonomy (memory_links.confidence + source_count + DB CHECK enforcing link_type ∈ {uses, depends_on, contradicts, caused, fixed, supersedes, related} + coerceLinkType fallback guard). Schema deltas via psql ALTER: tables 174→176, indexes 454→507, MCP scopes 3→5, MCP tools 8→12 (external surface only — internal TOOL_DEFINITIONS unchanged at 357). Architect round 1 caught a memory_supersede orphan bug → fixed same round, 5-test pin added. Architect round 2 (cross-app sweep) found 2 MEDIUMs + 1 LOW, all closed same round: memoryEntrySafeCols projection now includes lastReinforcedAt + qualityScore (M1 fix), MoA resolver inert-here-useful-elsewhere documented inline (M2 ack), getLinkedMemories now tenant-parameterized REQUIRED (L1 fix). verify-agent-wiring CLEAN (0 dead / 0 drift / 0 trusted-leaks). 26/26 R116 tests PASS, tsc CLEAN, preflight CLEAN. Previous R115.5+sec round 3 (\"Fix All Issues, Defer Nothing\") — Three Defense-In-Depth Gaps From R115.5 Rounds 1-2 Now CLOSED. (1) TOOL_POLICIES Full Backfill: `scripts/backfill-tool-policies.ts` emitted explicit rows for the remaining ~250 unregistered tools so every one of the 357 `TOOL_DEFINITIONS` now has an explicit `TOOL_POLICIES` entry (380 total incl. 23 pre-registered). 8 destructive tools that were missing one of `requiresApproval`/`trustedPersonasOnly` hardened to require BOTH: `stripe_create_payout`, `stripe_create_transfer`, `schedule_cross_platform_post`, `apply_procedure_edit`, `rollback_procedure_edit`, `slash_command`, `run_command`, `x_delete_tweet`. Pinned by 2-subtest invariant `tests/security/tool-policy-coverage.test.ts` (TOOL_DEFINITIONS ⊆ TOOL_POLICIES membership + no destructive row defaults to `safe` AND every destructive row carries BOTH approval+trusted flags). (2) Storage Tenant Scope Required: `getConversation`/`updateConversation`/`deleteConversation`/`getMessages`/`getMessagesPaginated` in `server/storage.ts` now require `tenantId` on the public path; new explicit escape hatch `getConversationUnscoped(id)` for the single `processMessage` entrypoint which immediately threads the resolved `tenantId` through every subsequent call. ~25 call sites updated; new zero-import `server/tenant-constants.ts` exports `ADMIN_TENANT_ID=1` so `discord.ts`/`telegram.ts`/`whatsapp.ts`/`webhook-triggers.ts` can statically reference it without re-introducing the circular `./auth` import. (3) `/deliverables` Allowlist: open `express.static` replaced with an explicit-allowlist handler (404 by default unless path matches approved Cascadia landing-page variants OR `project-N/` numerically-namespaced subdirs); explicit pre-check rejects `..`, `\\0`, leading `/`. Plus R115.5 — Sprint Contract / pre-flight done-condition pin (NEW table `sprint_contracts`, 3 NEW tools `pin_done_condition` / `get_done_condition` / `evaluate_against_contract` — tools 354→357, tables 173→174, indexes 452→454), generalized large-output offloader, MCP description audit script. Plus R115.4 — content repurposer (1 NEW tool `repurpose_content`) + native Threads + Pinterest publishers (now 7 platforms in scheduled-posts). Architect re-verify PASS on all 4 review areas: destructive-policy kill-switch invariant, storage tenant scope, /deliverables allowlist, tenant-constants de-shadowed. No new tools / tables / indexes / personas / governance / capabilities in round 3 — pure defense-in-depth closure of three open gaps. tsc CLEAN, preflight CLEAN, tool-policy-coverage 2/2 subtests PASS. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r116") ? "" : "truncate"}`}>{"**357 tools** + **4 new MCP memory tools** (external surface), 24 + 62 + 25 output-skills, 16 personas, **176 live tables** (+2 R116), **507 indexes** (+2 R116 partial: idx_memory_entries_last_reinforced, idx_memory_entries_quality_below), **43 governance rules**, **110 active capabilities** — R116 ships rohitg00/agentmemory Tier-A bundle (Ebbinghaus decay + contradiction resolver + quality-score gate + MCP memory scope + typed memory edges); previous R115.5+sec round 3 closes three open defense-in-depth gaps — full prior history below"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r116") ? "rotate-180" : ""}`} />
        </button>

        {/* R114 — AEvo Meta-Editing of Procedure Context (Zhang et al., arXiv:2605.13821). Tools 347→357 (+6), tables 171→173 (+2), indexes 449→452 (+3), governance 42→43, capabilities 109→110. DEMOTED to muted accent — kept visible for context per website-surface-sync skill. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r114")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r114"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R114</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r114") ? "" : "line-clamp-2"}`}>{"AEvo Meta-Editing of Procedure Context (Zhang et al., arXiv:2605.13821) — Meta-Agent Now Edits Output-Skill Playbooks Based On Accumulated Evidence. HITL-gated, CAS-pinned, rollback-capable. The meta-agent reads (a) the current playbook markdown, (b) ≥3 evidence rows from agent_trace_spans + delivery_verifications + grade_deliverable, and proposes a MINIMAL surgical edit — never a rewrite. Edit surface allowlist is HARDCODED-type-level: `targetKind` must be `'output_skill'` at launch (the only allowed surface). Safety surfaces are HARDCODED-forbidden: frontmatter `name` change, `safety_profile`, `intentGate`, `restrictedCategories`, `destructiveToolPolicy`, `refusalCopy`, any AHB regression test, any `.agents/skills/` path, `TOOL_POLICIES`, doctrine markers, persona souls. Validator fails CLOSED on any forbidden pattern, frontmatter-name drift, or size outside 50%–200% of original. CAS pin = sha256 of beforeContent captured at proposal time; apply re-reads the file and rejects if changed. Two NEW tables: `procedure_edits` (tenantId notNull, status check `proposed`|`approved`|`rejected`|`applied`|`rolled_back`, before/after content, evidenceSummary jsonb, contentSha256Before+After, +2 indexes) and `procedure_evolution_runs` (telemetry, +1 index) — tables 171→173, indexes 449→452. Six NEW tools (tools 347→357): `propose_procedure_edit` (sensitive MEDIUM — gathers evidence + asks LLM for revised markdown + validates + writes proposed row), `list_procedure_edits` (safe LOW — read-only queue), `approve_procedure_edit` (sensitive MEDIUM — proposed→approved), `reject_procedure_edit` (sensitive MEDIUM — proposed→rejected), `apply_procedure_edit` (destructive HIGH + requiresApproval — re-validates against CAS pin + invariants + atomically writes file + updates registry sha256), `rollback_procedure_edit` (destructive HIGH + requiresApproval — atomically restores beforeContent). All 6 wired in `TOOL_POLICIES` + `TOOL_REGISTRY` (governance/system categories). NEW `/api/procedure-edits` router with GET / GET/:id / POST /propose / PATCH /:id / POST /:id/apply / POST /:id/rollback — all behind `authMiddleware` + tenantId from session (never body). NEW `/procedure-edits` admin UI page (queue + diff viewer + approve/reject/apply/rollback) wired into sidebar with FlaskConical icon. New governance rule `procedure_edit_governance` enforces HITL approval on every apply/rollback (governance 42→43). New capability `aevo_meta_editing` registered (capabilities 109→110). Persona Doctrine #13 added documenting the edit-surface allowlist, the forbidden-pattern catalog, and the 'propose-not-apply' agent posture. 27-test invariant suite (`tests/lib/aevo-meta-editor.test.ts`) covers EDITABLE_SURFACES=['output_skill'] only, every forbidden surface rejected with explicit reason code, size bounds 0.5x–2.0x, MIN_EVIDENCE_COUNT=3, sha256 CAS pin behavior, full TOOL_POLICIES registration (apply+rollback destructive+requiresApproval, list safe/LOW), all passing. tsc PASS, preflight-stale-strings CLEAN. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r114") ? "" : "truncate"}`}>{"**357 tools** (+6 R114 AEvo: propose_procedure_edit + list_procedure_edits + approve_procedure_edit + reject_procedure_edit + apply_procedure_edit + rollback_procedure_edit), 24 + 62 + 25 output-skills = 111 reference surfaces, 16 personas, **174 live tables** (+1 procedure_edits, +1 procedure_evolution_runs), **454 indexes** (+3), **43 governance rules** (+1 procedure_edit_governance HITL-on-apply), **110 active capabilities** (+1 aevo_meta_editing) — meta-agent edits output-skill playbooks based on accumulated evidence, HITL-gated, CAS sha256-pinned, rollback-capable, edit-surface allowlist (output_skill only), forbidden-pattern catalog (safety_profile / intentGate / doctrine / persona souls / .agents/skills/ / TOOL_POLICIES) — full prior history below"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r114") ? "rotate-180" : ""}`} />
        </button>

        {/* R113.7+sec — Multi-platform social-post scheduler (R113.5 foundation + R113.6 FB/YT platform fill) + MCP-server expose (R113.7 + same-round +sec scope enforcement + vc_-rejection). Tools 344→347, tables 169→171, indexes 445→449. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r113_7_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r113_7_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R113.7+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r113_7_sec") ? "" : "line-clamp-2"}`}>{"Multi-Platform Social-Post Scheduler (Rounds A+B) + MCP-Server Expose (Round C +sec) — Three Rounds On Top Of R113.4+sec. R113.5 (Round A — foundation): self-hosted multi-platform social-post scheduler (NO third-party relay). NEW table `scheduled_posts` (tenantId notNull, platforms text[], status check pending|publishing|sent|partial|failed|cancelled, locked_at/locked_by, next_attempt_at, jsonb per_platform_results, +2 indexes incl. partial `idx_scheduled_posts_due`). NEW `server/lib/scheduled-post-runner.ts` — atomic CTE `FOR UPDATE SKIP LOCKED` poll + flip to `publishing` (no double-publish across heartbeat ticks), per-platform idempotent retry (skip already-succeeded platforms on attempt N+1), partial-success = terminal (no retry), exponential backoff 60s→1h cap, bounded `max_attempts=3`. Three NEW tools: `schedule_cross_platform_post` (destructive HIGH, requiresApproval), `cancel_scheduled_post` (sensitive MEDIUM), `list_scheduled_posts` (safe LOW) — all in `TOOL_POLICIES`. API routes `/api/scheduled-posts` GET/POST/DELETE behind `authMiddleware`, tenantId pulled from session (never body). NEW `/social-calendar` UI page. Personas 2/4/11 (Felix/Teagan/Apollo) wired with `intentGate=moderate` + AHB safety_profile. **R113.5 in-round HIGH closed**: runner allowlist included youtube/facebook but `publishPost` only handled x/linkedin/instagram → tightened SUPPORTED_PLATFORMS + tool-JSON-schema enum + UI PLATFORMS to the three actually-wired (YT/FB deferred to Round B). R113.6 (Round B — platform fill): Facebook Page publisher + YouTube video-bridge wired natively. NEW column `scheduled_posts.video_url`. `publishToFacebook` (Graph v18 `/me/accounts` → page access_token → `/{pageId}/feed` for text or `/{pageId}/photos` for image+caption; warns + records selected page in metadata when Bob manages multiple Pages). `publishToYouTube` (https-only `videoUrl` OR `driveFileId`; 256MB cap; reuses proven resumable-upload pattern; defaults `privacyStatus=private`). **R113.6 in-round HIGH closed**: `publishToYouTube` SSRF/memory-exhaustion — `arrayBuffer()` was buffering the entire response BEFORE the 256MB check, so a malicious server could OOM the runner → replaced with upfront `Content-Length` check + streaming `getReader()` loop with running byte counter + `AbortController` cancel on cap-exceed. **R113.6 MEDIUM closed**: Facebook auto-picked `pages[0]` silently when Bob manages multiple Pages → now logs warn + surfaces `{pageId, pageName, totalManagedPages}` in `PublishResult.metadata`. R113.7 (Round C — MCP-server expose): VCA now speaks MCP to external clients (Claude Desktop, Cursor, custom agents) via Streamable HTTP at `POST /mcp` (stateless: per-request transport + per-request `McpServer` instance, cleanup on `res.close`), with unauthenticated `GET /mcp/health`. NEW table `mcp_api_keys` (tenantId notNull, key_prefix unique idx, sha256 key_hash, scopes `text[]`, +2 indexes — tables 170→171, indexes 447→449). Key format `mcp_<8-char-prefix>_<32-char-secret>` (base64url, 240-bit entropy), sha256-hashed at rest, constant-time compare via `timingSafeEqual`, plaintext shown EXACTLY ONCE on create. Per-tenant create/list/revoke at `server/lib/mcp-api-keys.ts`. Curated 8-tool MCP surface (NO money-movement, NO mass-comms): `schedule_cross_platform_post`, `cancel_scheduled_post`, `list_scheduled_posts`, `get_scheduled_post`, `list_personas`, `lookup_output_skill`, `list_output_skills`, `get_platform_info` — all re-use existing internal tool implementations. NEW `/mcp-keys` UI page wired into sidebar. **R113.7+sec architect first pass closed 1 HIGH + 1 MEDIUM in-round** (the `+sec` suffix): HIGH-1 — MCP key `scopes` field was stored but NEVER enforced; any valid key could call destructive `schedule_cross_platform_post`. Defined `MCP_SCOPES` registry (`scheduler:write` for schedule/cancel, `scheduler:read` for list/get, `catalog:read` for personas/skills/info, `*` wildcard superscope) + `TOOL_SCOPE_REQUIREMENTS` mapping; every tool handler in `buildMcpServer()` now opens with `if(!hasScope(auth.scopes, TOOL_SCOPE_REQUIREMENTS.X)) return denyForScope(...)` (fail-CLOSED for empty/null/undefined scopes; read-scope does NOT cover write-scope); POST `/api/mcp-keys` validates scopes against registry (unknown→400) and defaults empty input to `[\"catalog:read\"]` (never destructive); UI surfaces explicit scope checkboxes with destructive flag on `scheduler:write`. MED-2 — `/api/mcp-keys` CRUD accepted `Bearer vc_*` API-key auth; a leaked vc_ key could mint unlimited MCP keys. New `requireSessionAuth()` helper on all 3 CRUD routes rejects `Bearer vc_*` with explicit 403 + still requires session cookie / Replit OIDC via `getTenantFromRequest`. **Post-edit code review closed 5 more findings in-session**: (1) HIGH `videoUrl` was dropped in POST /api/scheduled-posts → forwarded; (2) MED-HIGH scheduled-post-runner catch republished already-succeeded platforms → hoisted perResults/okCount, fail-CLOSED to 'partial' when okCount>0; (3) HIGH output-skills loaded markdown without runtime hash check → sha256+bytes pin, fail-CLOSED on mismatch OR missing pin metadata; (4) HIGH 5 missing tool-registry entries → registered ingest_paper, lookup_output_skill, schedule_cross_platform_post, cancel_scheduled_post, list_scheduled_posts; (5) LOW mcp-api-keys.ts \"salted SHA-256\" comment corrected. Verification: tsc PASS; tests scheduled-post-runner 42/42, mcp-api-keys 31/31, output-skills 17/17. Counts: tools 344→347, tables 169→171, indexes 445→449, governance 42 unchanged, capabilities 109 unchanged, skills 24 + 62 + 25 unchanged, personas 16 unchanged. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r113_7_sec") ? "" : "truncate"}`}>{"**347 tools** (+3 R113.5 scheduler trio: schedule_cross_platform_post + cancel_scheduled_post + list_scheduled_posts), 24 + 62 + 25 output-skills = 111 reference surfaces, 16 personas, **171 live tables** (+1 scheduled_posts R113.5, +1 mcp_api_keys R113.7), **449 indexes**, 42 governance rules, 109 active capabilities — R113.7+sec MCP-server expose (POST /mcp Streamable HTTP, 8-tool curated surface, scope model catalog:read/scheduler:read/scheduler:write/* with fail-CLOSED hasScope guard; closed 1 HIGH scope-enforcement + 1 MEDIUM vc_-key auth bypass) + R113.6 native Facebook + YouTube publishers with streaming 256MB cap + multi-Page metadata (closed 1 HIGH SSRF/memory-exhaustion + 1 MEDIUM auto-pick warning) + R113.5 scheduled-posts foundation with atomic CTE FOR UPDATE SKIP LOCKED + partial-success-terminal + exponential backoff + AHB safety_profile on Felix/Teagan/Apollo + 5 in-session post-edit fixes (videoUrl forwarding, runner catch fail-CLOSED, output-skills sha256 runtime pin, 5 missing TOOL_REGISTRY entries registered, mcp-api-keys hash-comment corrected) — full prior history below"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r113_7_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R113.4+sec — Output Skills Library (25 templates) + dispatcher hardening + 14/16 persona wiring (DEMOTED to muted accent — kept visible for context per website-surface-sync skill). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r113_4_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r113_4_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R113.4+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r113_4_sec") ? "" : "line-clamp-2"}`}>{"Output Skills Library — 25 On-Demand Structured-Deliverable Scaffolding Templates Across 8 Departments (Product / Strategy / Communications / Sales / Marketing / Legal / HR / Operations) + Dispatcher Hardening + 14/16 Persona Wiring. R113.4: adapted from github.com/mohitagw15856/pm-claude-skills (MIT, attribution in data/output-skills/NOTICE.md). New surface data/output-skills/<topic>.md + _registry.json (SHA-256-pinned, license/version/import-date metadata). New server/lib/output-skills.ts: loadRegistry(), listOutputSkills({department,persona}), lookupOutputSkill(topic) with path-jail (realpathSync containment under SKILLS_DIR), NUL-byte rejection, ^[a-z0-9-]+$ topic regex, case-insensitive trim. NEW `lookup_output_skill` tool (safe / LOW / requiresStructuredArgs, registered in TOOL_POLICIES) — two modes: {topic} returns scaffolding markdown, {department} or {persona} returns filtered topic list. Personas pull templates BEFORE producing structured deliverables (PRD, OKR, board deck narrative, investor update, contract review, NDA analysis, compliance checklist, sales battlecard, GTM, pricing strategy, content calendar, press release, email campaign, JD, performance review, onboarding plan, incident postmortem, runbook, SOP, vendor eval, exec summary, meeting notes, RICE, roadmap narrative). Architectural split is explicit: this is the OUTPUT-TEMPLATE layer (reference scaffolding for deliverables), distinct from .agents/skills/ which remains the OPERATIONAL-RUNBOOK layer. 15-test suite in tests/lib/output-skills.test.ts (path-jail, NUL, case-insensitivity, dept/persona filters, SHA-256 drift guard, dispatcher-level wiring + traversal at tool boundary). R113.4+sec: persona wiring + dispatcher hardening. (1) Wired `lookup_output_skill` into PERSONA_TOOL_FOCUS for fourteen of the sixteen personas in server/persona-sync.ts (persona 5/Sculptor intentionally excluded — skill-mgmt, not deliverable production). (2) New `R113.4 — OUTPUT SKILLS LIBRARY` section appended to PLATFORM_TOOLS_CONTRACT — every persona sees the 25-template catalog by department, an explicit OUTPUT SKILLS MANDATE (call lookup_output_skill BEFORE producing structured deliverables), a discovery hint ({department} / {persona} list modes), and explicit not-for guardrails (chat replies, code, debugging). (3) Architect-flagged LOW: dispatcher accepted ambiguous mixed args — patched server/tools.ts `lookup_output_skill` case with strict XOR contract (`topic` XOR (`department` OR `persona`)); mixed args and empty args now return {ok:false, error} with helpful copy. (4) Two new dispatcher tests added (tests/lib/output-skills.test.ts now 17 tests, all passing): mixed-mode rejection + empty-args rejection. Architect second pass: PASS. Tools 343→344. _(model: anthropic/claude-sonnet-4.5)_"}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r113_4_sec") ? "" : "truncate"}`}>{"**344 tools** (+1 R113.4 `lookup_output_skill`), 24 + 62 + **25 output-skills** = 111 total reference surfaces, 16 personas (14 wired for lookup_output_skill), 169 live tables, 445 indexes, 42 governance rules (+1 Reviewer Independence + Passive Skill Pattern Detection), 109 active capabilities — R113.4+sec persona wiring + XOR dispatcher contract + 17 dispatcher tests pass + architect second pass PASS, R113.4 NEW lookup_output_skill tool (safe/LOW/requiresStructuredArgs) surfaces 25 on-demand structured-deliverable templates across 8 departments (Product/Strategy/Comms/Sales/Marketing/Legal/HR/Ops), R113.3+sec closed 2 HIGH + 1 MEDIUM (ingest_paper filesystem-read jail, kill_switch SQL-injection sink hardened, paper-ingest race wrapped in pg_advisory_xact_lock) — full prior history below"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r113_4_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R112.18 — Tool Selection Discipline System (DEMOTED to muted accent — kept visible for context per website-surface-sync skill). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r112_18")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r112_18"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R112.18</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r112_18") ? "" : "line-clamp-2"}`}>{"Tool Selection Discipline System — Three-Layer Belt+Suspenders That Forces Every Agent To Consider The Best Tool BEFORE Acting Across The 342-Tool Inventory + R112.17 Tier 1 Bot-Wall Bypass. Bob's pain, named: 'agents have to peck and search to find the right tool or they just be lazy and don't find it at all.' Real problem: routing infra existed (semanticRank over 342-tool embedding cache, per-tenant performance scoring, dormancy nudges, Tool Sommelier) but never elevated the sharpest pick in front of the agent at the moment of decision. R112.18 fixes that with three independent layers. LAYER 1 — TOP-PICKS HEADER (passive, always on). NEW server/lib/top-picks-header.ts (~100 lines). Every chat turn pulls the last user message, runs semanticRank against the 342-tool embedding cache (cosine ≥0.30), pulls per-tenant getPerformanceScore for each candidate, combines 0.7 × semantic + 0.3 × performance, picks top 5. Formatted as ★ TOP TOOL PICKS FOR THIS REQUEST ★ block with name + STRONG/GOOD/PLAUSIBLE confidence + 'proven reliable' / 'historically flaky' perf tag + 240-char description, appended to finalSystemPrompt in chat-engine.ts:2707. ~250 tokens/turn, no extra LLM round. Env-disable TOOL_TOP_PICKS_DISABLE=1. LAYER 2 — recommend_best_tool tool (gated, active). NEW tool: server/tools.ts:3004-3019 (definition) + 12701-12750 (handler), registered in tool-registry.ts:186. Takes intent (full-sentence string, min 6 chars) plus optional excludeTools and topK (default 3, max 8). Returns picks + confidence (high/medium/low) + advice. Auto-extracts 'use when / use before / use for' triggers via regex. Under 50ms, pure embedding lookup, no LLM call. MANDATORY before 3+ step plans, paid-API calls, irreversible writes, customer-facing deliverables. LAYER 3 — POST-CALL VALIDATOR (reactive, automatic). NEW server/lib/tool-pick-validator.ts (~110 lines). After the FIRST executed tool call in any (conversation, persona) session, fires embedding-only re-rank: if a measurably better tool exists (gap ≥0.08 cosine vs picked) AND picked tool isn't already #1, pushes a ★ TOOL SELECTION HINT ★ SYSTEM-role message into the next round naming the better pick. Fires ONCE per session (in-memory Map, 60-min TTL, auto-prunes at 1000 entries). Wired chat-engine.ts:3701-3735 right after the tool-result push loop. Env-disable TOOL_PICK_VALIDATOR_DISABLE=1. Wiring. PLATFORM_TOOLS_CONTRACT extended with ★ TOOL SELECTION DISCIPLINE SYSTEM (R112.18) ★ section + doctrine rule: 'with 342 tools, your training-data instincts are the WRONG default — semantic-embedding match beats human-pattern matching.' Re-ran agent-knowledge-refresh: 16/16 personas have R112.18 doctrine + recommend_best_tool in their DB tools_doc. R112.17 — Tier 1 web-access bot-wall bypass. Imported Apify header-generator (MIT, ~30KB, zero native deps, Bayesian-network-trained from real browser samples). NEW server/lib/realistic-headers.ts (76 lines) lazy-init singleton wraps HeaderGenerator for chrome ≥118 / firefox ≥119 / safari ≥16 on desktop. Three-layer fail-safe: env flag WEB_ACCESS_TIER1_REALISTIC_HEADERS=0 disables, init failure logs once and disables, per-call failure falls back to prior static UA. Wired into Tier 1 webFetch (server/tools.ts:6964-6972, the 'basic' path that runs after Jina + Firecrawl have both failed — exactly where bot-walls live). Defense-in-depth preserved: isUrlSafe async DNS re-validation still runs ahead of every fetch, wrapExternalContent prompt-injection fence still wraps the response, Camofox Tier 3 fallback-hint logic UNCHANGED. Counts: tools 340→342 (+1 R112.17 internal, +1 R112.18 recommend_best_tool), governance 40→41 (+1 Tool Selection Discipline System). No schema change, no new persona, no new capability. Three new files, one new tool, four files edited."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r112_18") ? "" : "truncate"}`}>{"342 tools (+1 R112.17 internal, +1 R112.18 recommend_best_tool), 24 + 62 skills, 16 personas, 169 live tables, 445 indexes, 41 governance rules (+1 Tool Selection Discipline System), 109 active capabilities — R112.18 three-layer Tool Selection Discipline System (Layer 1 Top-Picks Header passive always-on, Layer 2 NEW recommend_best_tool gated/active sub-50ms embedding lookup MANDATORY for 3+ step plans / paid APIs / irreversible writes / customer-facing deliverables, Layer 3 post-call validator reactive/automatic fires once per session if gap ≥0.08 cosine) + R112.17 Tier 1 web-access bot-wall bypass via Apify header-generator (Bayesian-network-trained realistic browser headers, default ON, three-layer fail-safe, defense-in-depth SSRF/prompt-injection preserved) — full prior history below"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r112_18") ? "rotate-180" : ""}`} />
        </button>

        {/* R112.16 +sec — One-shot video tool + legacy-path delivery gap closure + architect re-review of same-day patch (DEMOTED to muted accent — kept visible for context per website-surface-sync skill). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r112_16_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r112_16_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R112.16 +sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r112_16_sec") ? "" : "line-clamp-2"}`}>One-Shot Video Tool + Legacy-Path Delivery Gap Closure + Architect Re-Review of Same-Day Patch — 3 sub-rounds (R112 → R112.16 → R112.16 +sec) on top of R110.15. **R112** `build_video_from_brief` (NEW tool, 339→**340**): ONE call replaces Felix's 6-step video orchestration (director → produce_video/start_video_job/mpeg_produce_parallel → poll → finalize → deliver). Plans chapters+scenes via runLlmTask (gemini-2.5-flash, JSON-strict), fires `startVideoJob` with `autoFinalize: true` + `autoDeliver: !!customerEmail`, returns `(job_id, watch_progress_url, total_chapters, total_scenes, plan_summary, estimated_duration_sec)` immediately. Runner end-of-loop auto-finalizes + auto-delivers (streaming URL + email). Legacy `produce_video`, `mpeg_produce`, `mpeg_produce_parallel`, `start_video_job`, `check_video_job`, `finalize_video` re-marked LEGACY in Felix's `tools_doc` with explicit "do NOT use for new requests" guidance. **R112.16** closed the legacy-path delivery gap that bit Bob the same afternoon: Felix shipped a BWB video that finalized correctly but bypassed `deliverDigitalProduct()` — no `delivery_logs` row, no `/uploads/` streaming file, no email. Root cause: R112's spec flags set `autoFinalize`/`autoDeliver`, but the *legacy* `start_video_job` tool dispatch handler in `server/tools.ts` never forwarded those flags. Fix: `case "start_video_job"` now explicitly extracts `autoFinalize`, `autoDeliver`, `customerName`, `customerEmail` (with `emailTo` fallback) and forwards them. Extended `StartVideoJobInput` + `VideoJobState.spec` types so the R112 one-shot delivery guard is compiler-enforced rather than `as any`-cast. **NEW `scripts/resend-delivery-email.ts`** one-shot rescue — reads any `delivery_logs` row that shipped without email, generates a 60-day signed streaming URL, composes a four-link HTML+text body (stream / force-download / Drive view / Drive direct-dl), fires `sendEmail`, marks `email_sent=true`. Used to recover delivery #127. **R112.16 +sec** Architect re-review caught **1 HIGH + 1 MEDIUM** — both closed in-round. **HIGH**: `scripts/resend-delivery-email.ts` SELECT omitted the `metadata` column while the tenant resolver read `row.metadata.tenantId` — every rescue silently fell back to hardcoded tenant 8, masking a cross-tenant signing footgun. Fix: SELECT now includes `metadata`; tenant resolution requires explicit `TENANT_ID` env OR `metadata.tenantId`; falling back to owner-tenant 8 now requires explicit `ALLOW_DEFAULT_OWNER=1`; new `DRY_RUN=1` mode prints the four-link body without sending or DB-writing. Verified: `DELIVERY_ID=127 DRY_RUN=1` (no flags) → exit 6 with loud "no resolvable tenant" message; with `TENANT_ID=8` → composes correct streaming URL + email. **MEDIUM**: `start_video_job` tool *dispatch* forwarded the new flags correctly but the tool *schema* didn't expose them — planner-discoverability hole. Fix: schema now declares all four optional fields with R112.16-tagged descriptions; tool description re-marked LEGACY with explicit "prefer `build_video_from_brief` OR set `autoFinalize`+`autoDeliver`+`customerEmail`" guidance. LOW (autoDeliveryAttempted one-shot guard blocks transient retry) explicitly accepted as BY DESIGN. Counts: tools 339→**340**, tables 168→**169**, indexes 443→**445**, governance 40, capabilities 109, skills 24 + 62, personas 16. TS clean; both fixes end-to-end verified.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r112_16_sec") ? "" : "truncate"}`}>**340 tools** (+1 `build_video_from_brief`), 24 + 62 skills, 16 personas, **169 live tables**, **445 indexes**, 40 governance rules, **109 active capabilities** — R112.16 +sec architect re-review closed 1 HIGH (rescue-script cross-tenant signing footgun: explicit TENANT_ID or metadata.tenantId required, owner-8 fallback requires ALLOW_DEFAULT_OWNER=1, new DRY_RUN=1 mode) + 1 MEDIUM (start_video_job schema exposes new flags with LEGACY guidance to prefer build_video_from_brief) + R112.16 closed the legacy-path delivery gap (start_video_job dispatch forwards autoFinalize/autoDeliver/customerName/customerEmail; compiler-enforced via extended types; new resend-delivery-email.ts rescue script with 60-day signed URLs + four-link body) + R112 NEW `build_video_from_brief` collapses Felix's 6-step video orchestration into ONE call (plan + finalize + deliver auto) — full prior history below</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r112_16_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R110.15 — Whole-app architect sweep + self-compacting replit.md (DEMOTED to muted accent — kept visible for context per website-surface-sync skill). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r110_15")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r110_15"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R110.15</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r110_15") ? "" : "line-clamp-2"}`}>Whole-App Architect Sweep + Self-Compacting replit.md — 4 sub-rounds (R110.12 → R110.15) on top of R110.11.5 +sec. **R110.15** Architect PASS WITH NITS on R110.7→R110.14 72h diff + sensitive surfaces (multi-tenant isolation, AHB safety, SSRF, prompt injection, file delivery, silent-failure hunt). **1 MEDIUM closed same-round**: `server/minds-engine.ts:523` `parseFloat(parsed.confidence) || 0.5` swallowed BOTH NaN AND a legitimate 0 — verifier disagreement collapsed to 0.5 silently, hiding parser drift. Replaced with explicit `Number.isFinite()` gate + loud warn on parse failure. **R110.14 budget-cap hardened**: `server/agentic/executor.ts` explicit tenantId guard added — if `maxLoopUsdBudget` is set but `tenantId` is undefined/0/non-positive, the `WHERE tenant_id = NULL` query would silently yield 0 spend and the cap would never trip. Now fails LOUD: `[executor] budget_cap configured but tenantId is invalid` + skips. **NEW `scripts/replit-md-compact.ts`** — idempotent, threshold-based replit.md auto-compactor. Keeps the 8 newest `Recent rounds` one-liners, moves older entries to `docs/release-log-archive.md` as stub prose entries (`### R-NNN — title (YYYY-MM-DD)` + body + `_(auto-compacted)_` marker), updates the `Full prose RX → RY` pointer, atomic writes both files. Wired into `scripts/git-auto-push.sh` BEFORE `git add -A` — runs every commit cycle, fail-OPEN, no-op when under threshold. Demoed: moved 7 entries (R110.11.2 → R110.7) on first real run. Tunable via `REPLIT_MD_KEEP_RECENT_ROUNDS` env. **R110.14** Two final Barry Zhang nuggets: **(1) Per-loop USD budget cap** in `server/agentic/executor.ts runSupervisor` — new optional `maxLoopUsdBudget` opt (default `undefined` = no cap, full back-compat). At top of every turn, snapshots per-tenant `llm_usage.cost_usd` since the run's `startedAt`; loud abort with `abortedReason: "budget_cap"` + `spentUsd` when exceeded. Fails OPEN on DB error (transient DB hiccup must not kill working agents). Recommended values inlined: Felix BWB pipeline $3.00, generic supervisor $1.00, heartbeat $0.50. **(2) Trajectory-based eval** in `scripts/golden-path-replay.ts` — new optional `expected_tools_subset?: string[]` + `forbidden_tools?: string[]` on `GoldenPath`. After producer succeeds, queries `agent_trace_spans WHERE tenant_id=1 AND kind='tool' AND started_at ≥ runStartMs` to enumerate every tool that fired during the replay; validates expected-subset + forbidden-list. WARN-ONLY for week 1 — trajectory drift does NOT push to `drifts`, so a tool-sequence regression alone does NOT freeze the pipeline; promotes to hard-fail after warm-up. Demoed on `bwb_video_2scene_fish_smoke` (subset=`["produce_video"]`, forbidden=`["mpeg_produce_legacy_v1","produce_video_v1"]`). **R110.13** Barry Zhang (Anthropic) "Building Effective Agents" seminar audit; 5 actionable gaps closed: **wall-clock circuit breaker** (`maxWallClockMs` default 10 min — agents that hang on a stuck tool can't burn dollars indefinitely), **consecutive-failure circuit breaker** (`maxConsecutiveSpecialistFailures` default 3 — only TRUE handler success resets, self-heal:bypass does not, so a broken specialist can't infinite-loop the supervisor), **tool-design hygiene linter** in `server/tool-registry.ts` (description under 30 chars + non-object schema — 0 violations on 339 tools, future tool authors get a CI gate), **per-persona tool sprawl audit** (Check 3.5 in `scripts/verify-agent-wiring.ts`, warn over 30), NEW **`scripts/agent-perspective.ts`** "think like your agent" trace-tree printer with `--upto N` mental drill mode (lets a human SEE the reasoning chain a single specialist saw). Architect PASS WITH NITS, 1 MEDIUM closed same-round. **R110.12** IJFW nuggets imported (gitlab.com/therealseandonahoe/ijfw): NEW skill `critique` (#24, structured Steelman→Counter-args stress-test for plans/refactors/architectural choices BEFORE execution — use for "should I", "is this right", "poke holes" prompts); NEW preflight `scripts/preflight-stale-strings.ts` (catches stale tool/table/skill counts + BWB weight numbers + "8 platforms" claims before deploy — config in `data/preflight-stale-strings.json`); weekly-maintenance Pass 9 (memory/rule pruning); 3 workflow rules captured in replit.md (2-failed-corrections-stop, AskUserQuestion Score Rule with degree-vs-kind distinction, session_plan format/lifecycle). Skills 23→**24**.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r110_15") ? "" : "truncate"}`}>**339 tools**, **24** + 62 skills (+1 critique), 16 personas (+ unlimited imports), 168 live tables, 443 indexes, 40 governance rules, **109 active capabilities** — R110.15 whole-app architect sweep PASS WITH NITS (1 MEDIUM closed same-round: minds-engine confidence parser silent-failure) + executor budget-cap hardened with explicit tenantId guard + NEW `scripts/replit-md-compact.ts` self-compacts replit.md every commit cycle (fail-OPEN, threshold 8) + R110.14 per-loop USD budget cap + trajectory-based golden-path eval (warn-only week 1) + R110.13 Barry Zhang seminar audit (5 gaps closed: wall-clock + consecutive-failure circuit breakers, tool-design hygiene linter, per-persona tool sprawl audit, NEW agent-perspective trace-tree printer) + R110.12 IJFW nuggets (NEW `critique` skill #24, stale-string preflight gate, weekly-maintenance Pass 9, 3 workflow rules) — full prior history below</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r110_15") ? "rotate-180" : ""}`} />
        </button>

        {/* R110.11.5 +sec — Felix render hardening + Codeflow card + 72h architect sweep rollup (DEMOTED to muted accent — kept visible for context per website-surface-sync skill). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r110_11_5")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/30 via-transparent to-transparent border border-border hover:border-muted-foreground/40 hover:bg-muted/40 transition-colors text-left group"
          data-testid="banner-whats-new-r110_11_5"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R110.11.5 +sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r110_11_5") ? "" : "line-clamp-2"}`}>Felix Render Hardening + Public Mirror Polish + 72h Architect Sweep — 11 sub-rounds (R110.2 → R110.11.5) on top of R110 +sec Pre-Delivery Secret Scan. **Felix YouTube pipeline survives broken container libdrm** (R110.7-R110.10): `probeDuration` THROWS with stderr capture instead of returning a hardcoded 5.0s, `probeAudioStreamDuration` returns `null` on non-finite parse instead of an indistinguishable `0`, audio-completeness gate distinguishes `null` vs `0`, ffmpeg/ffprobe preflight fails CLOSED with `container_environment_corrupted` envelope. **Fish Audio promoted to PRIMARY TTS** with multi-tier cascade Fish → OpenAI → Edge across `mpeg_produce` + `mpeg_produce_parallel`; rate limits relaxed for legitimate burst (`generate_audio` 2/10/30 → 60/600/2000, `create_slideshow_video` 1/5/15 → 10/60/200) with structured error envelopes at 4 sites. **Felix anti-fraud rules** (6 non-negotiable prompt rules) added to persona. **NEW SKILL `silent-failure-hunter`** (#23) wired as a focused second-pass after the main architect pass — caught canonical bugs the main pass missed twice. **R110.11 +sec** multi-pass architect closure: `tools.ts:7533` rate-limit gate fail-OPEN → fail-CLOSED for expensive tools with 40-tool hardcoded backstop, 2 more `probeDuration()` sibling sites → THROWS, `brand_voice_drift` logic flip, `video-job-runner.readJobState` distinguishes ENOENT vs corrupt JSON, monid + refund bare-catches → loud logs. **R110.11.1** TS gate green-up — `error_envelope` optional shape declared on `MpegJobResult`. **R110.11.2** Model registry auto-add overlay — `MODEL_AUTOADD_WATCHLIST` will auto-promote ERNIE 5.x the instant Baidu publishes on OpenRouter; atomic write-to-tmp+rename with `OverlayReadResult` discriminated union (corrupt ABORTS, never silent-overwrites). **R110.11.3** Split liveness/readiness probe — new unauthenticated `/healthz/deep` (info-leak-stripped, 5s response cache + 60s staleness + in-flight Promise coalescing) for external monitors. **R110.11.4** CodeFlow Card on public mirror — pinned to commit SHA `b44ab39f` (not `@v1`, supply-chain immutable), `contents: write` only, `paths-ignore` breaks self-trigger loop, monthly cron, `show-grade/score/receipts: false`. **R110.11.5 +sec** thorough 72h architect review (main + silent-failure-hunter prongs in parallel): **MEDIUM #1** `/healthz/deep` freshness math — cache stamped with request-arrival `now` not probe-completion, worst-case ~65-70s under coalescing → `probeNow = Date.now()` moved inside inflight async, cache stamp at completion. **LOW #2** `/healthz/deep` catch returned off-contract status+error shape → strict shape with status, empty checks, generatedAt only. **MEDIUM #3** `mpeg-engine.ts:35` `probeAudioStreamDuration` returned `0` on non-finite parse, indistinguishable from real-zero, masked by downstream "no audio stream" misleading error (canonical R110.10 bug class, sibling site missed twice) → returns `null` + loud log. **MEDIUM #4** `golden-path-replay.ts:86` `loadFingerprints` silent catch returning empty-object masked corruption AND silently wiped history on next save → distinguishes ENOENT from read/parse errors (`process.exit(2)` w/ fatal log, refuses overwrite). **Bonus tightening:** `monid-catalog-survey.ts` added `MONID_MAX_QUERIES` env guard (default 200) so paid Monid spend can't quietly balloon. Architect re-verified all 4 + bonus PASS, no new issues introduced. `npm run check` clean. No tool / table / capability / persona count change; `+1 skill` (silent-failure-hunter). Aggregate counts: tools 339, capabilities 109, tables 168, skills 23 (.agents/skills/) + 62 (skills table), personas 16.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r110_11_5") ? "" : "truncate"}`}>**339 tools**, 23 + 62 skills, 16 personas (+ unlimited imports), 168 live tables, 443 indexes, 40 governance rules, **109 active capabilities** — R110.11.5 +sec 72h thorough architect sweep (4 findings closed in same round per architect-finding-triage rules: /healthz/deep freshness + strict catch shape, mpeg-engine probeAudio null contract, golden-path-replay corrupt-JSON exit-2; bonus monid spend cap) + R110.11.4 CodeFlow Card on public mirror (pinned SHA, paths-ignore loop break, monthly cron) + R110.11.3 split liveness/readiness `/healthz/deep` (info-leak-stripped, 60s staleness, in-flight coalescing) + R110.11.2 Baidu ERNIE 5.x auto-promote overlay + R110.11.1 TS gate green-up + R110.11 +sec rate-limit fail-CLOSED for expensive tools + sibling probeDuration sites + R110.10 silent-failure pass + R110.9 NEW skill silent-failure-hunter + Felix anti-fraud rules + R110.7-R110.8 Felix YouTube pipeline survives broken container libdrm with structured error envelopes + R110.3-R110.6 Fish Audio PRIMARY TTS with multi-tier cascade + tightened rate limits + R110.1 +sec Gold-Review Hardening (4 HIGH + 3 MEDIUM closed) + R110 +sec Pre-Delivery Secret Scan — full prior history below</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r110_11_5") ? "rotate-180" : ""}`} />
        </button>

        {/* R110.1 +sec — Gold-review hardening (demoted). Closed 4 HIGH + 3 MEDIUM across 3 architect passes, verified CLEAN at pass 6. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r110_1")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/50 via-transparent to-transparent border border-border hover:border-primary/40 hover:bg-muted/70 transition-colors text-left group"
          data-testid="banner-whats-new-r110_1"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R110.1 +sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r110_1") ? "" : "line-clamp-2"}`}>Gold-Review Hardening on top of R110 +sec — 4 HIGH + 3 MEDIUM architect findings closed across passes 3-5, verified CLEAN at pass 6. **HIGH #1**: `routes.validateUploadedFile` extract/scan-infra failures now FAIL-CLOSED with 503 `UPLOAD_SECRET_SCAN_UNAVAILABLE` — was fail-OPEN, malformed PDF/DOCX could bypass the scanner. **HIGH #2**: `delivery-pipeline.scanDeliverablesForSecrets` synthesizes a `SCANNER_UNAVAILABLE` high-severity blocking hit on any scanner throw — was log-and-continue, scanner-DOS could bypass the gate. **HIGH #3 + #4**: `html-app-builder.smokeTestHtml` AND `deliverable-grader` jsdom switched to `runScripts: undefined` — LLM-authored JavaScript no longer executes server-side, was an RCE sink via prompt injection. **MEDIUM #1 + #2**: `tools.isUrlSafe` + `pdf-tool.isUrlSafe` rewritten async with full DNS re-validation via `dns.promises.lookup` with all+verbatim — rejects if ANY A/AAAA falls in private/loopback/metadata range; literal IPs (v4 + v6) routed through canonical `isPrivateIp` covering `::1`, `fc00::/7` ULA, `fe80::/10` link-local, `100.64/10` CGNAT, `224/4` multicast, IPv4-mapped IPv6 in BOTH dotted (`::ffff:127.0.0.1`) AND Node-canonicalized hex form (`::ffff:7f00:1`); fail-CLOSED on DNS failure. Was hostname-only — attacker-controlled DNS could resolve a public name to `169.254.169.254` and the platform would fetch AWS cloud metadata. **MEDIUM #3**: `tools.write_file` pre-Drive secret-scan added before `uploadAndShare` with BLOCK reason propagated to `upload_error` / `upload_blocked_reason` / `message` so the agent sees actionable remediation (replace literal with `process.env.X` and retry). Pinned by new `tests/security/ssrf-ip-mapped.test.ts` — 11 cases, all green via `npx tsx --test`. No tool / table / capability / persona / skill count change; aggregate counts: tools 339, capabilities 109, tables 168, skills 22 (.agents/skills/) + 62 (skills table), personas 16.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r110_1") ? "" : "truncate"}`}>**339 tools**, 62 skills, 16 personas (+ unlimited imports), 168 live tables, 443 indexes, 40 governance rules, **109 active capabilities** — R110.1 +sec Gold-Review Hardening (4 HIGH + 3 MEDIUM closed: upload-scan FAIL-CLOSED, delivery-scanner-throw synthesizes blocking hit, jsdom RCE sink removed in html-app-builder + deliverable-grader, full DNS-resolving SSRF guard with IPv4-mapped IPv6 hex-form coverage in tools + pdf-tool, write_file pre-Drive secret scan with reason propagation; pinned by 11-case ssrf-ip-mapped regression test) + R110 +sec Pre-Delivery Secret Scan (48-pattern catalog, fail-CLOSED gate in delivery + ingest, agent-callable `scan_for_secrets`, all 16 personas wired) + R109.4 +sec Dockerfile data/ allowlist + R109.3-fix self-healer no-op-heal gate + R109.2.3 Monid agent-UX clarity + R109/.1/.2/.2.1 +sec Monid integration with prompt-injection fence + per-tool rate ceilings + cost ledger + SSRF guard + R108.1 +sec fail-CLOSED chat-ingress + R108 adaptive plan-node maxSteps + R107 regime-aware memory consolidation + R106 LuaN1aoAgent five-nugget reflexive primitives — full prior history below</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r110_1") ? "rotate-180" : ""}`} />
        </button>

        {/* R110 +sec — Pre-Delivery Secret Scan (demoted). 48-pattern catalog, fail-CLOSED gate, all 16 personas wired. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r110")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/50 via-transparent to-transparent border border-border hover:border-primary/40 hover:bg-muted/70 transition-colors text-left group"
          data-testid="banner-whats-new-r110"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R110 +sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r110") ? "" : "line-clamp-2"}`}>Pre-Delivery Secret Scan — 48-pattern credential-regex catalog (elementalsouls/Claude-OSINT, MIT) ported into `server/lib/secret-scan.ts` covering AWS / GCP / GitHub PATs / Stripe live / Anthropic sk-ant / OpenAI sk- / ElevenLabs / Slack / SendGrid / Twilio / Discord / Telegram / npm / PyPI / Docker / all PEM private-key armor / JWT / Basic-Auth URLs / generic api_key=. Wired as fail-CLOSED structural gate in TWO places: (1) `delivery-pipeline.attemptUpload()` scans every primary + bundle file BEFORE Drive upload — CRITICAL/HIGH aborts the upload, alerts Bob via sendAdminAlert, flips the delivery row to failed; (2) `routes.validateUploadedFile()` scans customer uploads (text files directly, PDF/DOCX/XLSX through extractTextFromFile) so leaked keys can't poison Felix's reasoning context. New tool `scan_for_secrets` (safe/LOW, structured args) lets all 16 personas explicitly scan BEFORE `deliver_product` so a leak can be FIXED in-place (replace literal with `process.env.X`) instead of nuking the whole delivery. PLATFORM_TOOLS_CONTRACT R110 section explains the gate, the fix-on-fire workflow, and the narrow redact-and-ship exception (docs only — never customer code). Closes the longstanding gap that env-driven `redactSecrets()` cannot match — it only masks values present in `process.env`, so a hardcoded key Felix invents on the fly slipped through invisibly. Pure-stdlib regex, sub-second, no LLM cost, no network. New: 1 tool (`scan_for_secrets`), 1 capability (`pre_delivery_secret_scan`); tables / personas / skills unchanged. Aggregate counts: tools 339, capabilities 109, tables 168, skills 22 (.agents/skills/) + 62 (skills table), personas 16.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r110") ? "" : "truncate"}`}>**339 tools**, 62 skills, 16 personas (+ unlimited imports), 168 live tables, 443 indexes, 40 governance rules, **109 active capabilities** — R110 +sec Pre-Delivery Secret Scan (48-pattern catalog, fail-CLOSED gate in delivery + ingest, agent-callable `scan_for_secrets`, all 16 personas wired) + R109.4 +sec Dockerfile data/ allowlist (closed HIGH PII/customer-artifact image-embed risk) + model-freshness slug fix + stale-stat refresh + R109.3-fix self-healer no-op-heal gate + R109.2.3 Monid agent-UX clarity pass + R109/.1/.2/.2.1 +sec Monid integration with prompt-injection fence + per-tool rate ceilings + cost ledger + SSRF guard + R108.1 +sec fail-CLOSED chat-ingress hardening + R108 adaptive plan-node maxSteps + causal evidence edges + cold-start hypothesis nudge + R107 regime-aware memory consolidation + R106 LuaN1aoAgent five-nugget reflexive primitives — full prior history below</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r110") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R109.4 +sec — Hardening + stat-drift sweep. Closed a HIGH I introduced same-session via 3-pass architect. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r109_4")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-muted/50 via-transparent to-transparent border border-border hover:border-primary/40 hover:bg-muted/70 transition-colors text-left group"
          data-testid="banner-whats-new-r109_4"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-muted-foreground/80 text-white leading-none shrink-0 mt-0.5">R109.4 +sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r109_4") ? "" : "line-clamp-2"}`}>Hardening + Stat-Drift Sweep — closed a HIGH I introduced same-session, plus surfaced 11 backlogged R-rounds. **HIGH #1 (introduced + closed same-session)** — Dockerfile broad `COPY /app/data ./data` would have embedded `data/owner-email-digest*.json` (PII), `data/task-workspaces/**` (customer artifacts), and `data/browser-config.json` (sensitive config) into the runtime container image. Replaced with an explicit 6-asset allowlist: `qr-code-agenticcorporation.png`, `visionclaw-logo.png`, `ARCHITECTURE.md`, `Felix-Presentation-Instructions.txt`, `VisionClaw-Comprehensive-Features.txt`, `monid/catalog-curated.json` — then `mkdir -p /app/data/task-workspaces && chown -R visionclaw:visionclaw /app/data` so writable runtime dirs exist with correct ownership before USER-drop. `.dockerignore` adds belt-and-suspenders denies for the same sensitive paths so even if the COPY allowlist is later expanded, the build context can't include PII. **MEDIUM #1** — `server/providers.ts:955` `FRESHNESS_EXEMPT` set held the slug `n-2.6-1t:free` which could never match `MODEL_REGISTRY` id `inclusionai/ling-2.6-1t:free` (the Set lookup uses raw `ours.id`, no normalization). Fixed to byte-for-byte match; weekly maintenance no longer surfaces both Ling + the grok-4 test-path as stale RED. Comment added: future entries to this set MUST match registry id byte-for-byte. **MEDIUM #2 (deferred)** — direct-test coverage gap for 4 R106 libs (`failure-attribution`, `parallel-findings-bus`, `plan-graph`, `ssrf-jail`) — currently exercised only indirectly through chat-engine + html-app-builder. Documented in `docs/architecture-notes.md` Known gaps with concrete "add-when-next-touching" guidance. Not a release blocker. **LOW #1** — `README-PUBLIC.md` 3 stale 154/166 → 168 stat refs corrected. **3-pass architect** loop until clean: Pass 1 found 3 MED + 1 LOW; Pass 2 caught the NEW HIGH that my Pass-1 broad-COPY fix introduced; Pass 3 CLEAN after switching to allowlist. Aggregate counts unchanged: tools 338, tables 168, capabilities 108, skills 22 (.agents/skills/) + 62 (skills table), personas 16.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r109_4") ? "" : "truncate"}`}>**339 tools**, 62 skills, 16 personas (+ unlimited imports), 168 live tables, 443 indexes, 40 governance rules, **108 active capabilities** — R109.4 +sec Dockerfile data/ allowlist (closed HIGH PII/customer-artifact image-embed risk) + model-freshness slug fix + stale-stat refresh + 3-pass architect (Pass 1: 3 MED + 1 LOW; Pass 2: 1 NEW HIGH from broad COPY; Pass 3: CLEAN) + R109.3-fix self-healer no-op-heal gate (breaks false-heal CI loop) + R109.2.3 Monid agent-UX clarity pass + R109/.1/.2/.2.1 +sec Monid integration with prompt-injection fence + per-tool rate ceilings + cost ledger + SSRF guard + R108.1 +sec fail-CLOSED chat-ingress hardening + R108 adaptive plan-node maxSteps + causal evidence edges + cold-start hypothesis nudge + R107 regime-aware memory consolidation + R106 LuaN1aoAgent five-nugget reflexive primitives — full prior history below</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r109_4") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R106 + R106.1/.2 +sec — Five-nugget LuaN1aoAgent cherry-pick (REFLEXIVE OPERATING PRIMITIVES wired into all 16 personas) + architect closes HIGH plan-graph race / HIGH pinned-hypothesis prompt-injection / MEDIUM filter-count + AHB safe-tool fast-path bypass closure (demoted from latest) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r106")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r106"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R106.2 +sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r106") ? "" : "line-clamp-2"}`}>Five-Nugget Cherry-Pick from LuaN1aoAgent (Apache-2.0) — REFLEXIVE OPERATING PRIMITIVES wired across all 16 personas. **(N1) L0–L5 failure attribution** — new `failure_attributions` table + `attribute_failure` tool with strict-progressive levels (L0 OBSERVATION → L1 TOOL_FAILURE → L2 PREREQUISITE → L3 ENVIRONMENT → L4 HYPOTHESIS → L5 STRATEGY); auto-promotes ≥3 consecutive L4s into a strategic L5 with `recommended_action` + `promoted_to_strategic` flag. **(N2) Parallel findings bus** — new `parallel_job_findings` table + 2 tools (`findings_publish` / `findings_read`); sibling chunk-and-parallel subtasks share high-confidence discoveries mid-flight (0.6 confidence floor, callers auto-excluded from their own postings, since_id cursor). **(N3) Near-miss grading** — `gradeDeliverable()` now uniformly surfaces `nearMissDimension` + `nearMissNote` across all 6 grader formats (video / audio / pdf / slides / html_app / image) when a failed deliverable scored within 7 points of bar — steers auto-revise to highest-leverage fix. **(N4) Pinned hypotheses** — new `pinned_hypotheses` table + 2 tools (`hypothesis_pin` / `hypothesis_list_pinned`); chat-engine injects `renderPinnedBlock()` into the system prompt so load-bearing assumptions (4h TTL, max 24h) survive context compression. **(N5) Plan-on-Graph DAG editing** — new `plan_nodes` table + 2 tools (`plan_graph_edit` / `plan_graph_query`) with auto cycle-check after every batch and topological partition (ready / blocked / completed / failed). **R106.2 +sec architect closed three findings same-session across 6 architect rounds.** **HIGH plan-graph race** — `applyPlanEdits()` could persist a cyclic DAG when two writers each passed the in-memory pre-check then together committed conflicting deps. Fixed with `db.transaction()` + `pg_advisory_xact_lock(0x506c6e47, hash(tenantId,planId))` + tx-scoped rollback-on-cycle THROW. **HIGH SECURITY pinned-hypothesis prompt-injection** — `pinHypothesis()` was persisting raw user text that `renderPinnedBlock()` injected verbatim into `finalSystemPrompt` every turn. New `sanitizeHypothesisText()` strips control chars + alternating leading-scaffold + instruction-prefix regexes up to 10 fixpoint iterations (covers `[system]:`, `[[system]]:`, `from now on`, `henceforth`, standalone leak verbs). Hard-cap 240 chars + reject empty-after-sanitize + `MAX_ACTIVE_PINS_PER_TENANT=50` + 4000-char total injected block cap. New regression suite `tests/security/pinned-hypothesis-sanitizer.test.ts` (node:test, no extra deps); 20/20 pin all 6 architect-discovered bypass classes. **MEDIUM generate-public-docs filter count** — script reported policy-set size (19) instead of intersection (11); refactored to thread the count as an explicit param. **R106.1 +sec also closed an AHB safe-tool fast-path bypass** that had been silently letting safe+gated tools (`workspace_*`, `codebase_*`, R99 portraits, R104 commitment_*, R106 reflexive primitives, `query_trace`, `system_load_status`, `inbox_quarantine_list`, `inbox_allowlist_list`) skip `requiresStructuredArgs` + `trustedPersonasOnly` checks. New `hasAnyGate` guard restores defense-in-depth across ~10 tools. Aggregate counts: tools 324 → **331** (+7), tables 162 → **166** (+4), capabilities 92 → **97** (+5). Audit GREEN: 0 dead, 0 drift, 0 orphans.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r106") ? "" : "truncate"}`}>**339 tools**, 62 skills, 16 personas (+ unlimited imports), 168 live tables, 443 indexes, 40 governance rules, **108 active capabilities** — R109.2.3 Monid external-endpoint catalog (browse → discover → inspect → run; 4 new tools: monid_discover/inspect/run/catalog_browse; 124 endpoints harvested, 52 curated across 9 categories) + R109.1/.2/.2.1 +sec hardening (prompt-injection fence, per-tool rate ceilings, cost ledger, SSRF guard) + R108.1 +sec fail-CLOSED chat-ingress hardening + R108 adaptive plan-node maxSteps + causal evidence edges + cold-start hypothesis nudge + R107 regime-aware memory consolidation + R106 LuaN1aoAgent five-nugget cherry-pick (L0–L5 failure attribution + parallel findings bus + near-miss grading + pinned hypotheses + Plan-on-Graph DAG editing — 7 new platform-wide reflexive primitives wired into all 16 personas) + R106.2 +sec architect (HIGH plan-graph race → advisory-lock + tx rollback-on-cycle; HIGH pinned-hypothesis prompt-injection → fixpoint sanitizer + 50-pin/tenant cap + 4000-char block cap; MEDIUM generate-public-docs filter consistency; 20/20 sanitizer regression tests pass) + R106.1 +sec architect (plan-graph cycle pre-check via simulateBatch; failure-attribution contiguous-prefix counter; AHB safe-tool fast-path bypass closed for ~10 safe+gated tools) + R105 PageIndex hierarchical doc nav + R104 openclaw four-nugget cherry-pick + R103 owner email digest gate + R102 admission control + R101 causality graphs + R100 transactional no-regression / undo_last_action + R98.27.9 weekly maintenance + R98.27.8-sec whole-app architect sweep + R98.27.7 per-task workspace artifacts + R98.27.6 universal operating contract + R98.27.2+sec RAG quality lift + R98.27 Anthropic Contextual Retrieval + Cohere rerank + R98.26 hyperagent parity + R98.25.1+sec MNEMA + R98.22+sec HyperAgent Hardening + R98.19+sec require()-under-ESM sweep + R98.19 Memory v2 + R98.18+sec Self-Healing Maintenance + R98.16 IJFW + R98.14 Felix Reliability + R98.7+sec2 Self-Thinking Loop + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r106") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R105 + R105.1 +sec — PageIndex three-nugget cherry-pick (demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r105")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r105"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R105.1</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r105") ? "" : "line-clamp-2"}`}>Three-Nugget Cherry-Pick from VectifyAI/PageIndex (MIT) into the Knowledge Library + R105.1 +sec Architect Post-Edit Pass — pure additive shipping. **(1) Hierarchical heading-tree at PDF ingest** — new `doc_heading_trees` table (unique on `collection_id+doc_path+tenant_id`) populated by `server/doc-heading-tree.ts` during `addDocument()`. Pure regex parsing of markdown headings into a nested jsonb tree — zero LLM cost. Skipped silently for docs with `&lt;3` headings; capped at 5000 headings. Fail-open: build failure NEVER blocks ingest. **(2) New `knowledge_navigate` tool** — two modes: `list` (return matching docs&apos; heading trees) and `read` (return body text under a `heading_path`, reassembled from `doc_chunks`, capped at 6000 chars). Tenant-scoped, default-`safe` policy (same risk profile as `search_knowledge`). Substring-tolerant case-insensitive heading matching. Registered in `tool-registry.ts` under `[&quot;knowledge&quot;,&quot;research&quot;]`. **(3) Low-κ HITL fallback hint** — when `moa.shouldEscalate` is true AND `tenantHasHeadingTrees(tenantId)`, the HITL-escalation note now appends a hint to try `knowledge_navigate` (mode=&apos;list&apos; then &apos;read&apos;) before escalating. Cheap pre-check (single `SELECT 1 … LIMIT 1`); fail-open. Honest framing — does NOT auto-execute the tree walk. **R105.1 +sec architect post-edit pass closed two same-pass findings.** **HIGH (regression-from-this-session)** — `commitments.scanAndEscalate()` was fanning across all tenants and emitting `tenant_id` + raw `description` into the owner-digest body, a cross-tenant content disclosure to the singleton owner mailbox. The scanner intentionally fans-in for platform-admin visibility, so the fix is to redact: subject + body now contain only the commitment id and `due_at`; operator pulls full record via tenant-scoped `commitment_list` tool. **MEDIUM** — `owner-email-digest.ts` plain `writeFileSync` for queue/state files could corrupt JSON on crash/race. New `atomicWriteFile()` helper does tmp + `fsync` + atomic `rename`. One MEDIUM (stale R104→R105 stat numbers on UI/docs) deferred to next `website-surface-sync` pass. Aggregate counts: tools 323 → **324** (+1: `knowledge_navigate`), tables 40 → **41** (+1: `doc_heading_trees`), capabilities 106 → **107** (+1: hierarchical doc nav). New files: `server/doc-heading-tree.ts`, `docs/pageindex-nuggets-log.md`. Existing chunk-vector retrieval is unchanged — purely additive.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r105") ? "" : "truncate"}`}>**339 tools**, 62 skills, 16 personas (+ unlimited imports), 155 live tables, 443 indexes, 40 governance rules, **107 active capabilities** — R105 PageIndex three-nugget cherry-pick (hierarchical heading-tree at ingest + `knowledge_navigate` tool + low-κ HITL fallback hint) + R105.1 +sec same-pass architect closes (HIGH commitments cross-tenant disclosure → redacted owner-digest; MEDIUM atomicWriteFile for digest persistence) + R104 four-nugget openclaw cherry-pick (image-gen SSRF audit + bounded-spawn helper + inbox quarantine gate + commitments primitive: 8 new tools) + R103 owner email digest gate + R102 admission control + per-tenant 60 req/min token-bucket rate limit + R101 causality graphs + R100 transactional no-regression / undo_last_action + R98.27.9 weekly maintenance + R98.27.8-sec whole-app architect sweep + R98.27.8 codebase self-knowledge graph + diff-impact + R98.27.7-sec workspace tools + R98.27.7 per-task workspace artifacts + R98.27.6 universal operating contract + persona-sync hot-reload + AbortSignal leaf timeouts + R98.27.2+sec RAG quality lift + Slack user-level ACL + R98.27 Anthropic Contextual Retrieval + Cohere rerank + R98.26 hyperagent parity + R98.25.1+sec MNEMA + R98.22+sec HyperAgent Hardening + R98.19+sec require()-under-ESM sweep + R98.19 Memory v2 + R98.18+sec Self-Healing Maintenance + R98.16 IJFW + R98.14 Felix Reliability + R98.7+sec2 Self-Thinking Loop + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r105") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R104 — Four-nugget openclaw cherry-pick + cross-app architect sweep (demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r104")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r104"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R104</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r104") ? "" : "line-clamp-2"}`}>Four-Nugget Cherry-Pick from openclaw/openclaw + Cross-App Architect Sweep — pure additive shipping. **(1) Image-gen SSRF audit** codified in `server/lib/ssrf-jail.ts` header — every image-bearing surface (grade_deliverable thumbnail_paths, generate_image, mpeg scenes, Mermaid render, file_url) is local-path-only, fixed-allowlist, or routes through `ssrfSafeFetchBytes`. New tools must extend the audit comment. **(2) Bounded subprocess output** — new `scripts/lib/bounded-spawn.ts` wraps `child_process.spawn` with a rolling 4MB stdout/stderr ring buffer + max wallclock + SIGTERM→SIGKILL escalation so long-running spawns can&apos;t OOM the supervisor. **(3) Unknown-sender inbox quarantine** — new `inbox_sender_allowlist` table + `quarantined boolean` on `inbox_messages`; inbound messages are now consulted against `isSenderApproved()` (owner addresses, prior correspondents we replied to, or explicit allowlist entries auto-approve; everything else is quarantined fail-closed) so unknown-sender content can&apos;t auto-feed personas as a prompt-injection vector. New trusted-only tools: `inbox_sender_approve` / `inbox_sender_block` / `inbox_quarantine_list` / `inbox_allowlist_list`. **(4) Commitments primitive** — new `commitments` table + 5 tools (`commitment_create`/`list`/`heartbeat`/`complete`/`cancel`); 30-min scanner watches active commitments past `due_at` without recent heartbeats and escalates via the R103 owner-email-digest. **Architect cross-app sweep:** Two HIGH regressions same-pass-fixed. **HIGH #1:** R102 per-tenant chat rate limit was unwired — wired `checkTenantRate()` into POST `/api/conversations/:id/messages` ingress with 429 + Retry-After / X-RateLimit headers. **HIGH #2:** R104 quarantine bypassable — `check_inbox` returned quarantined inbound to persona LLM context; added `direction != &apos;inbound&apos; OR quarantined = FALSE` filter so quarantined content only visible via trusted-only `inbox_quarantine_list`. **MEDIUM:** AHB safety_profile coverage logged as known gap (only 2 of 16 personas declare a non-empty profile; the other 14 are internal-only). Aggregate counts: tools 315 → **323** (+8), tables 38 → **40** (+2: `commitments`, `inbox_sender_allowlist`), capabilities 104 → **106** (+2: inbox-quarantine gate, commitment-tracking primitive).</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r104") ? "" : "truncate"}`}>**323 tools**, 62 skills, 16 personas (+ unlimited imports), 155 live tables, 443 indexes, 40 governance rules, **106 active capabilities** — R104 four-nugget openclaw cherry-pick (image-gen SSRF audit + bounded-spawn helper + inbox quarantine gate + commitments primitive: 8 new tools) + R103 owner email digest gate (sendEmail() batches owner-only sends into one daily summary; customer-facing transactional emails pass through unchanged) + R102.1 +sec public-mirror docs sweep (15 trustedPersonasOnly tools no longer leak into public docs) + R102 +sec admission control (priority pool foreground_chat &gt; customer_background &gt; internal_maintenance + per-tenant 60 req/min token-bucket rate limit, system_load_status tool) + R101 +sec causality graphs (per-turn span tree, agent_trace_spans table, query_trace tool) + R100 +sec TNR transactional no-regression (typed snapshot before destructive tool calls, undo_last_action tool) + R98.27.9 weekly maintenance + R98.27.8-sec whole-app architect sweep + R98.27.8 codebase self-knowledge graph + diff-impact + R98.27.7-sec workspace tools + R98.27.7 per-task workspace artifacts + R98.27.6 universal operating contract for all 16 personas + persona-sync hot-reload + AbortSignal leaf timeouts + R98.27.2+sec RAG quality lift + Slack user-level ACL + R98.27 Anthropic Contextual Retrieval + Cohere rerank + R98.26 hyperagent parity + R98.25.1+sec MNEMA + R98.22+sec HyperAgent Hardening + R98.19+sec require()-under-ESM sweep + R98.19 Memory v2 + R98.18+sec Self-Healing Maintenance + R98.16 IJFW + R98.14 Felix Reliability + R98.7+sec2 Self-Thinking Loop + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r104") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98.27.8 + R98.27.8-sec — Codebase self-knowledge graph + diff-impact (previous release, demoted) */}

        {/* R98.27.7-sec — Per-task workspace artifacts + universal operating contract for all 16 personas + AbortSignal leaf timeouts + whole-app architect sweep (previous release, demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98-27-7-sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98-27-7-sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R98.27.7-sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98-27-7-sec") ? "" : "line-clamp-2"}`}>Per-Task Workspace Artifacts + Universal Operating Contract + Whole-App Architect Sweep — three R-rounds compressed. **R98.27.6 — Universal operating-loop contract for all 16 personas.** Architect orchestration audit found 14/16 personas (everyone except Felix and Minerva) lacked a stated chunk-and-parallel rule, structured failure-reporting schema, and verify-before-done gate. Added a `UNIVERSAL_OPERATING_CONTRACT` constant codifying five rules every persona inherits regardless of specialty: timeout budget (single-shot &lt;5min, longer must chunk-and-parallel via `startAsyncSubagent`); explicit delegate-vs-DIY domain map (Felix=executive synth, Forge=code, Teagan=campaign, etc.); sibling-handoff synthesis ownership; never-quit-silently structured failure schema (failed_tool / error_message / attempted_fallback / blocker_to_user); verify-before-declare-done gate calling `recall_failure_patterns` + `quality_baseline_check` + `verify_delivery_proof`. **Persona-sync hot-reload** for `operating_loop` — pre-fix `persona-sync.ts` only refreshed `tools_doc` and `agents_doc`, so edits to the source-of-truth file silently failed to land on the live DB until someone manually re-ran the seed. Now the composed loop writes on every refresh, custom personas are left untouched. **AbortSignal leaf timeouts** wired into 14 hot-path Drive / Browserless / ElevenLabs / x.ai sites (new `server/lib/fetch-with-timeout.ts`) — pre-fix a stuck upstream could hold a chat-engine turn open until Replit Temporal StartToClose killed it ~10-15 min later, losing the work. **R98.27.7 — Per-task workspace artifacts** (Anthropic long-running-agent pattern). New `data/task-workspaces/&lt;tenant&gt;/&lt;job_id&gt;/` per-task scratchpad + 6 tools (`workspace_init` / `_update_status` / `_log_artifact` / `_read` / `_finalize` / `_list`). Filesystem-only, tenant-scoped, hard-quota 200 files / 256 KiB per workspace, sanitized job ids with path-traversal defense + `path.relative()` containment. Architect post-edit-review caught and closed 4 hardening gaps (bare `..` survival, missing per-tenant cap, orphaned `.tmp` cleanup, status-file race) in a same-pass second sub-edit. Wired into the universal operating contract as **Rule 6 (PERSISTENT TASK WORKSPACE)** so jobs survive chat-turn boundaries and resume cleanly. **R98.27.7-sec — Whole-app architect sweep.** Four parallel architect explorers covering 24h delta + tenant/auth/secrets/SSRF/SQL/CSRF/OAuth + production health/drift + AHB safety + persona governance + TOOL_POLICIES coverage. Three same-pass HIGH fixes: 6 workspace tools registered in `destructive-tool-policy` with `requiresStructuredArgs:true` (closes the AHB stylistic-jailbreak vector even on filesystem-only ops); `build_html_app` LLM-call timeout 90s → 180s to drop the 32% fail rate; `workspace_read` content wrapped in per-call random-nonce delimiters with literal-marker escape (closes a same-tenant prompt-injection vector). Architect re-review caught two HIGH issues with the first cut and both were closed in a same-pass second sub-edit.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98-27-7-sec") ? "" : "truncate"}`}>**304 tools** (+6 workspace_*), 62 skills, 16 personas (+ unlimited imports), 155 live tables, 443 indexes, 40 governance rules, **100 active capabilities** (+1 per-task workspace artifacts), ~180k LOC — R98.27.7-sec whole-app architect sweep (workspace tools in TOOL_POLICIES + build_html_app timeout 90s→180s + workspace_read random-nonce delimiter) + R98.27.7 per-task workspace artifacts (6 tools, filesystem-only, tenant-scoped, wired into universal contract Rule 6) + R98.27.6 universal operating contract for all 16 personas + persona-sync hot-reload + AbortSignal leaf timeouts (14 Drive/Browserless/ElevenLabs/x.ai sites) + R98.27.2+sec RAG quality lift + Slack user-level ACL + R98.27.3 CI hard-gate green + R98.27 Anthropic Contextual Retrieval + Cohere rerank cross-encoder + R98.26.6 hardening pass + R98.26 hyperagent parity (Slack invocation + per-agent cost dashboard) + R98.25.1+sec MNEMA + R98.22+sec HyperAgent Surface Hardening + R98.19+sec require()-under-ESM sweep + R98.19 Memory v2 + R98.18+sec Self-Healing Maintenance + R98.17 Cairo + R98.16 IJFW + R98.14 Felix Reliability + R98.7+sec2 Self-Thinking Loop + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98-27-7-sec") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98.27.2+sec — RAG quality lift (Anthropic Contextual Retrieval auto-contextualize + Cohere rerank cross-encoder) + Slack user-level ACL HIGH + tenant-aware persona resolution MEDIUM + Cohere rerank partial-valid backfill MEDIUM + R98.27.3 CI hard-gate green (previous release, demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98-27-2-sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98-27-2-sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R98.27.2+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98-27-2-sec") ? "" : "line-clamp-2"}`}>RAG Quality Lift + Slack User-Level ACL + Tenant-Aware Persona Resolution + CI Hard-Gate Green — four R-rounds compressed. **R98.27 — Anthropic Contextual Retrieval + Cohere Rerank.** Two complementary upgrades to the doc-search and knowledge-recall pipeline lifted from Anthropic's published benchmark (-49% top-20 retrieval failure on its own, -67% combined with rerank). (1) **Index-time auto-contextualize** — `addDocument` with the new `autoContextualize` flag runs `gpt-5-mini` per chunk in batches of 4 to write 1-2 sentences situating each chunk inside the full document, stored in the existing `doc_chunks.context` column so the hybrid retriever picks it up at query time. Cost guardrail `DOC_AUTOCONTEXT_MAX_CHUNKS=500`; fail-open with warn log. (2) **Query-time Cohere rerank cross-encoder** — `cohereRerank` activates when `COHERE_API_KEY` is set, takes the top of the RRF-fused candidates (window of `max(15, topK*3)`), sends to `rerank-v3.5` with a 6s abort timeout, returns rerank-ordered top K. Fails OPEN to RRF ordering on any error. **R98.27.1** wired the rerank into `searchDocuments` (was only in `vectorSearchKnowledge`) so the `doc_search` tool path gets the lift; `doc_search` description + usage hints expanded; persona prompts for VisionClaw default + Radar + Neptune + Luna re-seeded with an explicit DOC INGEST rule. **R98.27.2+sec — Whole-project security review.** **HIGH — Slack user-level authorization** (`server/routes/slack.ts`). The R98.26.6 workspace allowlist confirmed *which workspace* the request came from, but every authenticated user in that workspace (incl. shared-channel guests) could trigger tool-enabled runs against `ADMIN_TENANT_ID`. New `verifySlackUser` consults `SLACK_ALLOWED_USER_ID` (comma-separated Slack U… ids), fails CLOSED when configured, fails OPEN with one-shot warning when unset. Wired into both `/api/slack/commands` (returns "not authorized") and `/api/slack/events` (silent drop after 200 OK to prevent retry amplification, rejected `user_id` logged). **MEDIUM — Tenant-aware persona resolution.** `resolveFirstWordPersona` was querying global `personas` only, ignoring `tenant_persona_names` overrides; warn-list path enumerated every persona globally regardless of tenant. Both queries now LEFT JOIN `tenant_persona_names` filtered by `tenantId`. Routing now respects per-tenant renames (Felix → "CEO" etc.); warn-list no longer leaks other tenants' overrides. **MEDIUM — Cohere rerank partial-valid backfill.** Previous fail-open only handled "all indices invalid" → null. Partial-valid responses (3 valid + 7 garbage indices) silently truncated the result set. Now fills out to `topN` from the original RRF order, deduped via `seen` set across the entire reordered array, hard `slice(0, topN)` cap. **R98.27.3 — CI hard-gate green.** `tests/fixtures/seed-test-personas.sql` seeds the 16 canonical persona rows so security/safety tests can INSERT into FK-bound `agent_knowledge.persona_id` and `security_intent_checks.persona_id`; `decline_events.flagged_categories text[]` insert path fixed (Drizzle SQL template binds JS arrays as a single scalar — pre-stringify the Postgres `text[]` array literal first).</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98-27-2-sec") ? "" : "truncate"}`}>302 tools, 62 skills, 16 personas (+ unlimited imports), 155 live tables, 443 indexes, 40 governance rules, **99 active capabilities** (+1 RAG quality lift: contextual retrieval + cross-encoder rerank), ~180k LOC — R98.27.2+sec whole-project security review (HIGH Slack user-level ACL via SLACK_ALLOWED_USER_ID + MEDIUM tenant-aware persona resolution honoring tenant_persona_names overrides + MEDIUM Cohere rerank partial-valid backfill) + R98.27.3 CI hard-gate green (persona FK seed fixture + decline_events array literal fix) + R98.27.1 rerank wired into searchDocuments + doc_search description + usage hints expanded + R98.27 Anthropic Contextual Retrieval auto-contextualize at index time + Cohere rerank cross-encoder at query time (-49% to -67% top-20 retrieval failure on Anthropic's benchmark) + R98.26.6 hardening pass (HIGH Slack workspace allowlist + HIGH gpt-5.1 sweep) + R98.26 hyperagent parity (Slack invocation surface + per-agent cost dashboard /admin/persona-cost + invocation-channels strip on landing) + R98.25.1+sec MNEMA + R98.22+sec HyperAgent Surface Hardening + R98.19+sec require()-under-ESM sweep + R98.19 Memory v2 + R98.18+sec Self-Healing Maintenance + R98.17 Cairo + R98.16 IJFW + R98.14 Felix Reliability + R98.7+sec2 Self-Thinking Loop + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98-27-2-sec") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98.26.6 — Hyperagent parity sweep (Slack invocation + per-agent cost dashboard + agents gallery) + 6 sub-rounds of hardening (workspace allowlist + gpt-5.1 sweep + sanitizer expansion + mirror allowlist tighten) (previous release, demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98-26-6")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-sky-500/10 via-primary/5 to-transparent border border-sky-500/30 hover:border-sky-500/50 hover:bg-sky-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98-26-6"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-sky-600 text-white leading-none shrink-0 mt-0.5">R98.26.6</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98-26-6") ? "" : "line-clamp-2"}`}>Hyperagent Parity Sweep + Six-Round Hardening Pass — seven R-rounds compressed in one day. **R98.26 — Three visible-gap closures vs hyperagent.com:** (1) **Slack invocation surface** — `POST /api/slack/commands` (slash command), `POST /api/slack/events` (URL verification + `app_mention` + `message.im` DM + `mpim` group DM), `GET /api/slack/health`. HMAC-SHA256 v0 signature verify (5-min window, `timingSafeEqual`). Persona resolution: first token matches known set → routes there; else default Felix. Replies truncated to 3500 chars, threaded for channel mentions, un-threaded for DMs. (2) **Per-agent cost dashboard** at `/admin/persona-cost` — 7/30/90d aggregates over `agent_activity` grouped by `persona_id`: activity counts, conversation counts, success rate, total wall-clock minutes, est. cost (powerful $0.030/min, balanced $0.010/min, fast $0.005/min). Admin-gated, tenant-scoped, 60s refetch — closes Bob's "which agent is burning the budget" question. (3) **Agents gallery enrichment** on landing — invocation-channels strip (Chat · Slack · Email · MCP · Scheduled/cron · REST API). **R98.26.1 hotfix:** first prod `@mention` surfaced empty `[slack] dispatch error {}` — log shipper serialized `Error` to `{}`. Replaced with explicit `e?.message / e?.code / e?.stack[0..5]` unwrap. Real cause: `conversations.model` schema default `gpt-5.1` is NOT in `MODEL_REGISTRY`. Fix: pin Slack-created conversations to a registered model (`gpt-5-mini`, later upgraded to `gpt-5.5`). **R98.26.2 deployment migration:** original Autoscale was killing `setImmediate` background dispatch after `res.send()` — ack returned 200 but the LLM call was terminated mid-flight. Migrated to **Reserved VM (gce)**. Initial Reserved VM crash-looped because ~50s of synchronous seeding ran before port 5000 opened → Replit health check killed the container. Fix in `server/index.ts`: in production only, bind port 5000 immediately after `setupAuth`, then continue async seeding. Also re-attached `agenticcorporation.net` after the deployment-type swap (custom domains don't auto-migrate). **R98.26.3 DM Chat-tab support** — `message` event handler with `channel_type === 'im'` filter (excludes bot-authored messages and message subtypes to prevent reply loops). Channel `@mention` ✓ and DM in the VisionClaw Agent Chat tab ✓ both reply within ~10s. **R98.26.4 cleanup batch:** stale `gpt-5.1` schema defaults swept across `conversations` + `agent_settings`, in-process per-channel rate limiter (6/min, 60/hour) on `/api/slack/commands` + `/api/slack/events`, mpim group DM accepted, `runLlmTask`/`runLlmTextTask` error sanitizer (`sanitizeLlmError()`) strips URLs, API keys (sk-, sk-ant-, GitHub PAT, Slack xox*, Google AIza, AWS AKIA, Stripe sk_/rk_, Bearer), IPv4+port, IPv6, absolute filesystem paths (Linux/macOS/Windows), length-caps to 500. **R98.26.5 public-mirror CI all-green sweep:** 4 of 5 hard gates were RED — fixed wellness→wellness file rename (CONTENTS scrub didn't rename the JSON file), TypeScript noImplicitAny on the new inline arrow callback, missing `lookupProduct`/`listSkus`/`getPublicCatalog` stubs, `seed-catalog-files.ts` exit-2 on empty CATALOG, two stub SKUs the mirror tests assert exist, my own explanatory comment containing a proprietary SKU literal that the leak verifier caught. Result: CI run 25490224844 — all 5 jobs green. **R98.26.6 post-edit code-review hardening pass — 2 HIGH + 4 MEDIUM + 1 LOW closed (pass-2 architect ran clean).** **HIGH #1 — Slack workspace allowlist:** signature verify alone gated ingress, so if `SLACK_SIGNING_SECRET` ever leaked, ANY workspace where the app was installed could pivot into `ADMIN_TENANT_ID` and execute tools. Added `verifySlackWorkspace()` reading `SLACK_ALLOWED_TEAM_ID`/`_ENTERPRISE_ID`/`_APP_ID` (comma-separated). Called AFTER signature verify in BOTH routes, BEFORE rate-limit/ack/dispatch. Fails CLOSED on mismatch (403); fails OPEN with one-time warning when unset (existing single-workspace deploys keep working). `url_verification` handshake bypass preserved. **HIGH #2 — `gpt-5.1` still hardcoded in 5 live LLM callsites in `server/tools.ts`** (`run_supervisor` writer/analyst/critic/router + `commit_decision`). Same Unknown-model class as R98.26.1 hotfix would have surfaced if these tool paths fired. All 5 → `gpt-5-mini`. Sweep confirmed no remaining live `gpt-5.1` literals in `server/` or `client/src/`. **MEDIUM #1 — Frontend `gpt-5.1` defaults:** `settings.tsx` + `chat.tsx` (3 sites) → `gpt-5-mini`. **MEDIUM #2 — `sanitizeLlmError` coverage gaps:** added Slack `xapp-` (app-level token), Stripe `whsec_` (webhook secret), and SDK shapes `err.response.data.message` + `err.error.details`. Length cap applied LAST so secrets are redacted before truncation. **MEDIUM #3 — the tenant-namespace prefix mirror leak-verifier exemption too broad** (the previous broad pattern the previous broad tenant-namespace pattern would silently exempt accidental non-numeric literal forms) — tightened to strict numeric tenant-ID format with optional persona segment. **LOW — replit.md doc drift:** R98.26.1 entry said Slack pins `gpt-5-mini`; code actually pins `gpt-5.5` (Bob's later flagship upgrade). Updated to acknowledge progression. **Still deferred:** per-tool model allowlist for `build_html_app` (open since R98.25.1); MEDIUM early-port-bind ordering in `server/index.ts:351-373` (hasn't fired since R98.26.2 deploy, OIDC discovery has been stable).</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98-26-6") ? "" : "truncate"}`}>298 tools, 66 skills, 16 personas (+ unlimited imports), 154 live tables, 280 indexes, 40 governance rules, **98 active capabilities** (+1 Slack invocation surface, +1 per-agent cost dashboard), ~180k LOC — R98.26.6 hardening pass (HIGH Slack workspace allowlist + HIGH gpt-5.1 sweep across 5 server tools + 3 frontend defaults + MEDIUM sanitizeLlmError xapp-/whsec_/nested-SDK shapes + MEDIUM tenant-namespace allowlist tightening to strict numeric) + R98.26.5 public mirror CI all-green (5/5 jobs) + R98.26.4 cleanup (stale gpt-5.1 schema defaults swept + per-channel Slack rate limiter 6/min,60/hour + mpim DM + sanitizeLlmError) + R98.26.3 DM Chat-tab support + R98.26.2 Autoscale → Reserved VM migration + early port-bind fix + R98.26.1 Slack model-pin hotfix + R98.26 hyperagent parity (Slack /commands + /events + per-agent cost dashboard /admin/persona-cost + invocation-channels strip on landing) + R98.25.1+sec MNEMA + Wiring-Audit + R98.22+sec HyperAgent Surface Hardening + R98.19+sec require()-under-ESM sweep + R98.19 Memory v2 + R98.18+sec Self-Healing Maintenance + R98.17 Cairo + R98.16 IJFW + R98.14 Felix Reliability + R98.7+sec2 Self-Thinking Loop + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98-26-6") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98.25.1+sec — MNEMA Nuggets 1-6 (phantom memory + two-channel reputation tensor + jury concordance κ + decorrelated kin redundancy + decline-events telemetry + ecosystem-health dashboard) + Wiring-Audit Fix Pack (send_email blocklist + build_html_app + dormant-tools INFO gating) + Whole-App Architect Sweep (previous release, demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98-25-1-sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-teal-500/10 via-primary/5 to-transparent border border-teal-500/30 hover:border-teal-500/50 hover:bg-teal-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98-25-1-sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-teal-600 text-white leading-none shrink-0 mt-0.5">R98.25.1+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98-25-1-sec") ? "" : "line-clamp-2"}`}>MNEMA Memory + Trust Tensor + Concordance + Wiring-Audit Fix Pack + Whole-App Architect Sweep — four R-rounds compressed. **R98.24 — MNEMA Nuggets 1-3** lifted from Smith (Gentic Lab) EUMAS 2026: (1) **Phantom-stage memory + skills** — `memory_entries` and `skills` gain `succeeded_by_id` + `valid_until`; superseded rows linger in a "phantom" state so causal lineage is preserved while live recall only sees the current row (closes the "we keep losing why we changed our mind" gap). (2) **Two-channel reputation tensor** — `trust_scores` gains `action_alpha/beta` AND `restraint_alpha/beta`; `effectiveTrust = min(actionPrec, restraintPrec)` so an agent that ALWAYS acts AND an agent that NEVER acts both score low. (3) **Jury concordance κ on `ensemble_query`** — `MoAResult` now carries `concordance` (mean pairwise embedding cosine of proposer answers) + `shouldEscalate` (true when κ &lt; 0.5 OR single proposer); chat-engine routes low-κ to HITL. We took the ideas, skipped the witness-lattice machinery. **R98.25 — MNEMA Nuggets 4-6:** (4) **Decorrelated kin redundancy** — `memory_entries` gains `kin_group_id` + `provenance_triple jsonb`; recall picks k=5 from the most decorrelated kin group so we don't pay for 5 nearly-identical chunks. (5) **Typed decline events** — new `decline_events` table + `server/lib/decline-events.ts` with a 6×6 source/reason taxonomy; wired into intent-gate, destructive-tool-policy, and chat-engine low-κ refusals so refusal data finally has structure. (6) **Ecosystem-health dashboard** — `server/lib/ecosystem-health.ts` + `/admin/ecosystem-health` (4 indicators, 60s refresh): jury-κ trend, decline-event mix, restraint/action precision balance, kin-redundancy savings. **R98.25.1 — Wiring-Audit Fix Pack:** **HIGH #1:** `send_email` 86% fail rate — 24/24 failures bouncing on `admin@visionclaw.ai` (stale Felix HVAC test target on SES hard-bounce list). Pre-flight blocklist gate in `server/email.ts` checks `to+cc+bcc+replyTo` against `BOUNCED_DEFAULT ∪ EMAIL_BOUNCED_RECIPIENTS` (architect HIGH closed at write time — was `to`-only); removed the address from `getOwnerEmails()` HITL fallback in `server/policy-engine.ts`; cleared stale `tool_performance.fail_count`. **HIGH #2:** `build_html_app` empty output / golden paths frozen — `runLlmTask` is JSON-mode (`&#123;json&#125;`) but the builder read `.text/.output`; dispatcher silently dropped `params.model` + `params.timeoutMs`. New `runLlmTextTask` text-mode sibling; builder switched; dispatcher passes through; golden-path pin moved gemini-2.5-flash → gpt-5-mini (tenant 1 = OpenAI-only). All 3 golden paths green (first since R98.21). **MEDIUM #1:** Dormant-tools INFO noise — `wiring-invariants.checkDormantTools` always emitted "248 of 296 dormant" INFO; gated behind `ENABLE_DORMANT_AUTO_DEPRECATION`; critical/warning paths preserved. Boot now: 0 critical, 1 warning, 4 info. **R98.25.1+sec — Whole-App Architect Sweep:** **HIGH #1 closed:** `propose_skill` had no per-tenant rate limit. Added to `EXPENSIVE_TOOLS` at 5/min, 20/hr, 60/day. **MEDIUM #1 closed:** `enforceToolPolicy.block()` decline-events telemetry could fail-OPEN if a sync throw escaped before `.catch` attached. Wrapped entire `Promise.all` in outer `try/catch` + coerced `reason` to string before slice. tsc clean; app healthy; capability count 95 → **96** (+1 ecosystem-health dashboard).</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98-25-1-sec") ? "" : "truncate"}`}>298 tools, 66 skills, 16 personas (+ unlimited imports), 150 tables, 50 indexes, 40 governance rules, **96 active capabilities** (+1 ecosystem-health dashboard), ~180k LOC — R98.25.1+sec Whole-App Architect Sweep (HIGH propose_skill rate limit + MEDIUM decline-events fail-OPEN guard) + R98.25.1 Wiring-Audit Fix Pack (send_email cc/bcc/replyTo blocklist + build_html_app text-mode + dormant-tools INFO gating) + R98.25 MNEMA Nuggets 4-6 (decorrelated kin redundancy + typed decline_events + ecosystem-health dashboard /admin/ecosystem-health) + R98.24 MNEMA Nuggets 1-3 (phantom-stage memory + two-channel reputation tensor + jury concordance κ on ensemble_query) + R98.22+sec HyperAgent Surface Hardening (7 HIGH closed) + R98.21 HyperAgent Cross-Pollination (Recipe Gallery + plan_deliverable estimates + propose_skill review queue + run_ab_eval) + R98.19+sec require()-under-ESM sweep (6 silent-bypass primitives restored) + R98.19 Memory v2 + R98.18+sec Self-Healing Maintenance + R98.17 Cairo + R98.16 IJFW + R98.14 Felix Deliverable Reliability Plan + R98.7+sec2 Self-Thinking Loop + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98-25-1-sec") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98.22+sec — HyperAgent Cross-Pollination (Recipe Gallery + plan_deliverable cost+duration estimate + propose_skill review queue + run_ab_eval cross-run A/B) + Public Mirror Sanitization + Architect Sweep (7 HIGH findings closed) (previous release, demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98-22")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98-22"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R98.22+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98-22") ? "" : "line-clamp-2"}`}>HyperAgent Cross-Pollination + Public Mirror Sanitization + Architect Hardening Sweep — Three rounds shipped same day. **R98.21 HyperAgent items 1-4:** (1) Landing-page **Recipe Gallery** — 5 example prompts (Brand Audit, Competitor Brief, Sales Outreach, HVAC Quote PDF, Weekly Status) with `est. time` + `est. cost` chips, served from a public `/api/public/recipes` endpoint so anyone hitting the marketing page sees concrete "what can I actually ask for" examples. (2) **Upfront cost + duration estimate on `plan_deliverable`** — every plan now returns `estimatedDurationMinutes` + `estimatedCostUsd` as a low/median/high band so Felix can quote the user BEFORE starting the work and the user can approve or scope down. (3) **Skill auto-emission with review queue** — new `proposed_skills` table + `propose_skill` tool that any persona can call when it notices a reusable pattern; new `/admin/proposed-skills` review UI lets the owner accept (promotes to a real skill) or reject (drops with rationale). Closes the "agents keep re-discovering the same trick and the platform never learns" gap. (4) **Cross-run A/B with configurable rubrics** — new `ab_runs` table + `run_ab_eval` tool fans out N parallel runs across multiple agent configs against the same prompt, scores each artifact with a configurable rubric LLM-as-judge (same rubric across every run so configs are comparable; separate from `grade_deliverable`'s deliverable-contract gate), and returns a ranked diff so we can compare model/prompt variants empirically; results visible at `/admin/ab-runs`. **R98.22 Public Mirror Sanitization:** the public GitHub mirror (Huskyauto/VisionClaw-Agent-Public-Release) hardened against the HyperAgent review — CI badge wired in, count source-of-truth file (`docs/CURRENT_PLATFORM_TOTALS.md`) added so the public README pulls from one place, Baileys/self-push docs cleaned, repo cleanup of stale dev artifacts. **R98.22+sec architect sweep (4 parallel passes):** **HIGH #1** cross-tenant write in `proposed-skills/accept` — the UPDATE that marked a proposal "accepted" was scoped by `id` only, so an admin in tenant A could promote a pending proposal from tenant B by guessing the id. Now scoped `(id AND tenantId)`. **HIGH #2** cross-tenant memory soft-delete — `deleteMemoryEntry(memId)` on `/api/memory/:id` was called without a tenant scope; storage layer fell back to id-only. Now passes the resolved scope. **HIGH #3** tenant fail-OPEN on hyperagent routes — `?? 1` resolver silently used admin tenant 1 when context was missing. Now returns null and the route 401s. **HIGH #4** `propose_skill` stored unsanitized agent text — name/description/body now pass through `sanitizeUntrusted` BEFORE insert, since the body becomes a future skill prompt and an injection payload there would persist into a later trusted-context execution. **HIGH #5** new tools unclassified in destructive-tool policy — `propose_skill` (MEDIUM) and `run_ab_eval` (HIGH, trustedPersonasOnly) added to `TOOL_POLICIES` so the cost-fanout tool never runs unguarded. **HIGH #6** SSRF in `delivery-pipeline.ts` `verifyShareLink` — was a raw `fetch(url)` with `redirect:'follow'`; now jails through `ssrfSafeUrl()` with `redirect:'error'` so a redirect to an internal IP can't bypass the jail. **HIGH #7** unsigned-URL fail-OPEN in delivery-pipeline — when the signing call threw, the path was falling back to an unsigned `/uploads/PUBLIC_NAME` URL and bypassing the auth gate. Now fails closed: returns null and the delivery layer can retry/alert. tsc clean (exit 0); app restarted clean; `GET /api/public/recipes` 200. Tool count stays **296** (`propose_skill` + `run_ab_eval` already in registry); skills 66 unchanged; capabilities **93 → 95** (+1 Recipe Gallery, +1 Proposed-Skills review queue / A/B Runs results page).</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98-22") ? "" : "truncate"}`}>296 tools, 66 skills, 16 personas (+ unlimited imports), 119 declared / 154 live tables, 280 indexes, 40 governance rules, **95 active capabilities** — R98.22+sec HyperAgent (Recipe Gallery + plan_deliverable cost/duration estimate + propose_skill review queue + run_ab_eval cross-run A/B) + Public Mirror Sanitization + 7 HIGH architect findings closed (cross-tenant promote, memory delete scope, tenant fail-open, propose_skill prompt-injection, run_ab_eval policy, delivery SSRF, unsigned-URL fail-closed) + R98.19+sec Memory v2 + R98.18+sec Self-Healing Maintenance + R98.17 Cairo + R98.16 IJFW + R98.14 Felix Reliability Plan + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer + R94 Tenant Cost-Attribution Integrity</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98-22") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98.19+sec — Memory v2 (deer-flow nuggets 1-4) + Whole-App Code Review Sweep (6 require()-under-ESM bugs closed) (previous release, demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98-19")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98-19"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R98.19+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98-19") ? "" : "line-clamp-2"}`}>Memory v2 (deer-flow nuggets 1-4) + Whole-App Code Review Sweep — Two rounds shipped same day. **R98.19 Memory v2:** four complementary mechanics layered onto the agent memory subsystem (additive, backward-compatible, 1 new column + 1 new background queue, no schema break). (1) Confidence-scored facts — every memory write now carries a 0.0-1.0 `confidence` plus a `confidence_source` enum (`vision_extracted`, `tool_verified`, `inferred_from_context`, `user_stated`, `auto_detected`); recall ranks by confidence × recency × access-frequency so a high-confidence fact from a verified tool result beats a low-confidence one inferred from chat. (2) Debounced write queue — dedupes identical writes within a 30s window so a 5-tool-call burst that all want to remember the same thing only persists ONE row instead of five. (3) Synthesis-time dedup — checks for substring + Jaccard match against existing facts in the same scope before writing, so "Bob prefers brevity" doesn't land alongside "user prefers brief responses". (4) Token cap on synthesis context — hard caps at 8K tokens so memory recall never blows out the chat budget on long sessions. All 16 personas re-seeded with the new Memory v2 doctrine. **R98.19+sec Code Review Sweep:** Bob asked for a thorough review across the whole app + 24h-touched areas. Three architect rounds, six real bugs closed. The big finding: a recurring bug class showed up across five separate hardening passes — historical code used `require()` inside `try/catch` blocks, but `package.json` declares `"type":"module"`, so every one of those `require()` calls threw "require is not defined" at runtime and the catch silently swallowed it. Net effect: five different security primitives were quietly degraded for as long as those files have been deployed. **HIGH #1:** provider-error secret redaction was passing through unredacted. **HIGH #2:** `gate_command` untrusted-stdout fence was silently degrading. **HIGH #3:** untrusted-content fence builder (`wrapAsData`) — same crash. **HIGH #4:** presenter constant-time HMAC compare was hard-blocking every legitimate presenter call with 403 (also caught a TDZ shadow on the very next line). **HIGH #5:** Claude-agent GitHub importer prompt-injection scanner was being skipped entirely — imported agents could carry "ignore previous instructions" + exfil-curl payloads straight into a durable VisionClaw persona. Fixed with static import AND tightened the catch from "false fail-closed" (the comment claimed fail-closed, the code was actually fail-open) to true fail-closed quarantine. **MEDIUM #1:** `setBackgroundHalted` now surfaces disk-write failures to the admin instead of silently keeping in-memory-only state. **MEDIUM #2:** sandbox writer no longer falls back to inline-only summaries. **MEDIUM #3:** `as any` casts on the new memory writes are gone — type safety enforced. tsc clean across all three rounds, app healthy across three restarts, capability count 92 → 93.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98-19") ? "" : "truncate"}`}>296 tools, 66 skills, 16 personas (+ unlimited imports), 149 tables, 47 indexes, 40 governance rules, **93 active capabilities** (+1 confidence-scored Memory v2), ~180k LOC — R98.19+sec Whole-App Code Review Sweep (6 require()-under-ESM bugs closed: secret redaction + gate fence + wrapAsData fence + presenter timingSafeEqual + claude-importer prompt-injection scanner + sandbox writer; scanner catch tightened to true fail-closed) + R98.19 Memory v2 (confidence-scored facts + debounced queue + synthesis dedup + 8K token cap on recall) + R98.18+sec Self-Healing Maintenance Sweep + R98.17 Cairo Cross-Pollination + R98.16 IJFW Cross-Pollination + R98.14 Felix Deliverable Reliability Plan Complete + R98.13 plan_deliverable + grade_deliverable + R98.12 verify_delivery_proof + build_html_app + record_strategic_win + R98.11+sec2 Six-Round Hardening Day + R98.7+sec2 Self-Thinking Loop + R98.6 Profile-Photo Auto-Attach + R98.5 Production URL Fix + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer + R94 Tenant Cost-Attribution Integrity</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98-19") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98.18+sec — Self-Healing Maintenance Sweep: drizzle HIGH CVE closed + xlsx HIGH removed + health-monitor alert threshold tuned (previous release, demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98-18")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-indigo-500/10 via-primary/5 to-transparent border border-indigo-500/30 hover:border-indigo-500/50 hover:bg-indigo-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98-18"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-indigo-600 text-white leading-none shrink-0 mt-0.5">R98.18+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98-18") ? "" : "line-clamp-2"}`}>Self-Healing Maintenance Sweep — Bob asked the platform to fix three alert emails on its own and it did. **Triage receipts:** GitHub CI failure was already auto-resolved by the Agentic CI Self-Healer (`latest run 25366309648 green — nothing to do`); System DOWN was a transient Neon connection blip that self-recovered with the existing 30-min cooldown gate doing exactly what it was designed to do (one email, then quiet); Weekly Maintenance RED was the real signal pointing at two HIGH CVEs that needed code changes. **HIGH #1 (closed):** `drizzle-orm` 0.39.3 → 0.45.2 — SQL-injection identifier-escape CVE GHSA-gpj5-g38j-94v9 (CVSS 7.5). Semver-major bump. Compatibility decision documented: kept `drizzle-zod` pinned at `^0.7.1` (peer range allows the new drizzle-orm + Zod v3) instead of jumping to 0.8.x which forces Zod v4 and would have triggered an app-wide schema migration in the same session. Per the dependency-upgrade skill rule: don't bundle multiple MAJORs same session. tsc clean across all ~150 db.* call sites. **HIGH #2 (closed):** `xlsx` removed entirely — Prototype Pollution + ReDoS, no upstream fix because SheetJS distributes via CDN-only model so npm has no patched version available. Single runtime call site in `server/routes.ts` (`extractTextFromBuffer`) migrated to the already-installed `exceljs` dependency. New implementation: proper RFC 4180 CSV escaping for cells with commas/quotes/newlines, formula-result + Date (ISO) + hyperlink + richText cell handling, throws explicit error on parse failure instead of silently returning garbled utf-8. Behavior change: legacy `.xls` (binary BIFF) files now throw "please re-save as .xlsx and re-upload" — `exceljs` doesn't read .xls. **Noise tuning:** `server/health-monitor.ts` `ALERT_THRESHOLD` 2 → 3, so System DOWN now requires ~15 min of sustained downtime (was ~10) before emailing — transient Neon blips that recover within the window stop waking Bob up; the 30-min cooldown + threshold-suppress + off-hours skip logic stays. **Architect post-edit catch:** initial xlsx swap had a real regression — `.xls` files would silently fall back to garbled utf-8, AND `values.join(',')` didn't CSV-escape commas/quotes/newlines so output fidelity changed vs the prior `XLSX.utils.sheet_to_csv()`. Both fixed in-session before commit (explicit error on .xls + RFC 4180 escaper added). **npm audit dropped from 2 HIGH → 0 HIGH / 0 CRITICAL.** 9 moderate + 2 low remain — all known transitive `uuid` chain through `@google-cloud/storage` / `googleapis` / `exceljs`, blocked on upstream, documented as a deferred Known gap. Stats unchanged: 296 tools, 66 skills, 16 personas, 149 tables, 47 indexes, 40 governance rules, 92 capabilities. Files modified: `server/routes.ts`, `server/health-monitor.ts`, `package.json`, `package-lock.json`, `replit.md`, `client/src/pages/updates.tsx`.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98-18") ? "" : "truncate"}`}>296 tools, 66 skills, 16 personas (+ unlimited imports), 149 tables, ~180k LOC — R98.18+sec Self-Healing Maintenance Sweep (drizzle HIGH CVE closed + xlsx HIGH removed + alert threshold tuned, npm audit 2 HIGH → 0) + R98.17 Cairo Cross-Pollination (kill switch + risk taxonomy + chat-slot reservation) + R98.16 IJFW Cross-Pollination + R98.14 Felix Deliverable Reliability Plan Complete + R98.13 plan_deliverable + grade_deliverable + R98.12 verify_delivery_proof + build_html_app + record_strategic_win + R98.11+sec2 Six-Round Hardening Day + R98.7+sec2 Self-Thinking Loop + R98.6 Profile-Photo Auto-Attach + R98.5 Production URL Fix + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer + R94 Tenant Cost-Attribution Integrity</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98-18") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98.16 — IJFW Cross-Pollination: 8 features lifted from gitlab.com/therealseandonahoe/ijfw + 2 architect security passes (previous release, demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98-16")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/10 via-primary/5 to-transparent border border-rose-500/30 hover:border-rose-500/50 hover:bg-rose-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98-16"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R98.16</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98-16") ? "" : "line-clamp-2"}`}>IJFW Cross-Pollination — Bob asked us to scan the IJFW project on GitLab and lift every nugget that fits VisionClaw without creating system havoc. Eight items shipped, all additive / backward-compatible, then a +sec patch hardening run_command's auth gate, then a +wiring patch teaching Felix and Forge how to use everything, then a +sec-2 whole-app architect sweep that closed 6 more findings in one pass. Tool count 295 → **296**. **(1) `run_command` (#296) — large-output sandbox** — ad-hoc shell that auto-summarizes test runners (pass/fail counts + failing names), tsc errors (count + first 20), build output, and grep matches (top files + count). Inline if ≤40 lines AND ≤50KB; larger output streams to `data/run-sandbox/&lt;label&gt;.txt` (mode 0o600, 24h auto-purge) with a domain-aware summary + last 10 raw lines. Closes the "Felix burns 4-8K context every time he runs npm test even though 99% is ✓ pass lines" problem. Same RCE gate as `slash_command` (owner-tenant + Felix(2)/Forge(3) personas). **(2) Wave Table on `plan_deliverable`** — `PipelineStep` gained optional `wave?` + `dependsOn?[]`; every step in DELIVERABLE_PIPELINES across all 9 formats tagged with the right wave; new top-level `wave_table` array surfaced. Felix's prompt now mandates "execute by WAVE: dispatch all steps inside the same wave in PARALLEL via single-response multi-tool-calls". PDF wave 3 grade+verify in parallel; html_app wave 3 grade+deliver in parallel; research wave 1 deep+web in parallel; slides wave 1 orchestrate+create in parallel. **(3) `translateLlmError`** — pattern-matches 13 LLM-error families (401/403, 429, billing, ENOTFOUND, ECONN*, spawn ENOENT, missing API keys, model-not-found, JSON-validation, etc.) into ONE actionable line. Failover throws now carry `.friendly` and `.translated:&#123;category, friendly, suggestedAction, raw&#125;` so users see "Auth rejected (401/403). Rotate the key in Replit Secrets." instead of `codex_models_manager::manager: failed to refre…`. Original `.message` preserved untouched for forensics. **(4) DeepSeek-as-architect lineage + `runMultiLineageReview()` helper** — DeepSeek 1.6T-param non-Western training data catches blind spots the big-three share. Helper fans out a prompt to up to 4 lineages (OpenAI / Anthropic / Google / DeepSeek — the "Trident" pattern) in parallel; failed/timed-out auditors do NOT count toward minResponses early-exit (productive-only counting closes the "two failed calls falsely satisfy minResponses=2" bug). Building block for a future multi-architect code-review round. **(5) `sanitizeUntrusted()`** — heading + system-tag defang. Captured oEmbed titles / curl responses containing "# IGNORE PREVIOUS INSTRUCTIONS" no longer render as a real H1; pseudo-system XML tags (`&lt;system&gt;`, `&lt;assistant&gt;`, `&lt;user&gt;`, `&lt;prompt&gt;`, `&lt;tool&gt;`, `&lt;function&gt;`, `&lt;developer&gt;`) zero-width-defanged so they land as literal text not control structure; IM-format tokens (`&lt;|im_start|&gt;`, `&lt;|endoftext|&gt;`, fim_*) defanged. Also strips ANSI escapes + per-line truncation at 2000 chars. **(6) `atomicWrite` fsync audit** — 6 sites patched with inline fsync-before-rename: `server/job-spool.ts`, `dormant-deprecation.ts`, `code-health.ts`, `research-engine.ts`, `video-job-runner.ts`, both atomic-write sites in `scripts/skills-registry.ts`. New `atomicWriteFileSync()` / `atomicWriteFile()` helpers also fsync the parent dir for true power-loss durability — without this, a crash between rename and pagecache-flush leaves an EMPTY file because the rename hits the directory inode but the data blocks for the .tmp never made it out of pagecache. **(7) Gemini `?key=` URL leak audit:** verified clean — our only Gemini caller authenticates via Authorization header on the OpenAI-compat endpoint, no `?key=` query param. **(8) `minResponsesFanOut` productive-only counting:** implemented inside `runMultiLineageReview()`. **+sec patch (same round): HIGH** — broken access control on `run_command` read actions. `list_outputs` and `get_output` had ZERO authorization, meaning any persona on any tenant could enumerate the global sandbox namespace and read its full contents — including the persisted command line (cleartext header on each sandbox file), so any sensitive literal Bob ever passed as a CLI argument would leak cross-tenant. Fix: hoisted the auth gate ABOVE the action-dispatch switch so all three actions (run/list_outputs/get_output) require the same owner-tenant + Felix/Forge gate. **+wiring patch (same round) — agent-context-wiring per Bob's standing rule "ship a tool → tell the agent it exists":** R98.16 sections appended to Felix(2) + Forge(3) `operating_loop` in `seed-persona-prompts.ts`, all 16 personas re-seeded, persona-sync confirms 296 tools in tools_doc. **+sec-2 patch (whole-app + sensitive-surface sweep — 2 parallel architect passes, 16 findings, 6 closed in-session, 4 FALSE POSITIVE / already-fixed, 6 deferred as defense-in-depth gaps):** **CRITICAL #1** — `translateLlmError` raw-secret leak: provider error strings can echo request headers containing API keys (some HTTP clients put the auth header into the thrown 401 message). Now redacts via `redactSecrets()` BEFORE embedding raw into either `friendly` or `.raw` — closes the by-far-most-likely leak path (our own keys round-tripping through a provider error). **HIGH #1** — SSRF jail extended IP coverage: added 100.64.0.0/10 (CGNAT, used by container/cloud platforms incl. some metadata fronts), 0.0.0.0/8 (this-network), IPv4 multicast 224-239/4, IPv6 multicast `ff::/8`, `::ffff:` IPv4-mapped form for ALL the above blocks, plus suffix-blocklist for `.internal`, `.cluster.local`, `.svc` (covers `*.railway.internal`, `*.replit.internal`, `kubernetes.default.svc.*`). Hostname allowlist also extended with K8s in-cluster API + AWS metadata variants. **HIGH #2** — output-sandbox non-atomic write: the new `run_command` sandbox was using `fs.writeFileSync` — exactly the bug `atomic-write.ts` was created to fix elsewhere in this same round. Replaced with `atomicWriteFileSync` + mode 0o600 preserved. **MEDIUM #1** — `retrieve_hint` absolute-path leak: was emitting full `data/run-sandbox/&lt;label&gt;_&lt;ts&gt;.txt` path into the model context. Now omits the path (label alone is sufficient) and strips `sandboxPath` from the spread response object. **LOW #1** — atomic-write tmp-file leak on rename failure: best-effort `unlinkSync`/`unlink` in catch on both sync + async variants, then re-throws original error. tsc clean (0 errors). Followups: 4 architect findings re-verified as FALSE POSITIVE / already-fixed (mpeg-engine SSRF was R98.14+sec-2; run_command gate verified; reference-learner tenant-scoped; wave_table generator at tools.ts L15549). 6 defense-in-depth gaps documented in replit.md as deferred (DNS rebinding double-check, sanitizer per-line UTF-16 truncation, sanitizer control-token vocab, deliverable-grader dispatcher mismatch validation, mpeg-engine caller-side allowlist, golden-path SHA256 fingerprint).</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98-16") ? "" : "truncate"}`}>296 tools, 66 skills, 16 personas (+ unlimited imports), 149 tables, ~180k LOC — R98.18+sec Self-Healing Maintenance Sweep (drizzle HIGH CVE closed + xlsx HIGH removed + alert tuning, npm audit 2 HIGH → 0) + R98.17 Cairo Cross-Pollination (kill switch + risk taxonomy + chat-slot reservation) + R98.16 IJFW Cross-Pollination + R98.14 Felix Deliverable Reliability Plan Complete + R98.13 plan_deliverable + grade_deliverable + R98.12 verify_delivery_proof + build_html_app + record_strategic_win + R98.11+sec2 Six-Round Hardening Day + R98.7+sec2 Self-Thinking Loop + R98.6 Profile-Photo Auto-Attach + R98.5 Production URL Fix + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer + R94 Tenant Cost-Attribution Integrity</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98-16") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98.14 — Felix Deliverable Reliability Plan COMPLETE: durable resumable long-video jobs + nightly golden-path regression net + reference learner + quality-instinct cards (previous release, demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98-14")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-fuchsia-500/10 via-primary/5 to-transparent border border-fuchsia-500/30 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98-14"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-fuchsia-600 text-white leading-none shrink-0 mt-0.5">R98.14</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98-14") ? "" : "line-clamp-2"}`}>Felix Deliverable Reliability Plan COMPLETE — final batch of the 7-workstream plan plus the two Bob-requested additions ("learn from real-world references on the internet" + "give Felix Replit-Agent-style instinct as written rules"). Five new tools (290→295) + a regression net + style-transfer + the canonical "what good looks like" map. **(W1.3+W1.4) Durable resumable long-video jobs** — `start_video_job` returns a job_id IMMEDIATELY (chat turn closes cleanly even on 12+ min videos), `check_video_job` polls per-chapter status, `finalize_video` is idempotent + resumable (concat fail → next call retries JUST concat, never re-renders the cheap-but-failed step). Atomic .tmp+rename writes; owner-tenant scoping; 7-day TTL sweeper; traversal-jail on job IDs. Closes the entire "12-min render dies because the chat turn ended after 10" failure class. **(W6) Golden-path nightly replay** — new `Golden Path Replay` workflow + `scripts/golden-path-replay.ts` runs canonical prompts (HTML apps, PDFs), grades each artifact via `grade_deliverable`, fingerprints to disk, on regression writes a freeze marker AND emails the owner; drift bars duration ±5%, page count exact, file size ±20%; soft cost cap $1/run via the llm_usage ledger. **Reference Learner** — `learn_from_reference` SSRF-jails the URL (https only, blocked private/link-local IPs, blocked metadata hostnames, DNS-rebinding-defended via post-resolution recheck, redirect:'error' to close redirect-bypass), fetches ≤2MB / 15s timeout, YouTube oEmbed pulls title/author/thumbnail + base64-encoded maxres thumbnail as vision input, vision LLM extracts 3-8 SPECIFIC copyable patterns (concrete + checkable: "opens with 2-second close-up of product" not "good opening"). `recall_references` filters by deliverable_type and/or style_tags. **Quality-Instinct Cards** — new `server/quality-cards.ts` exports `QUALITY_CARDS` map (8 formats × 8-11 concrete checkable rules each: video hook in first 3s + narration breathes 1-2s pauses + music ducks under voice -12 to -18 dB + LUFS -16 to -14 / peaks ≤ -1 dBFS; slides ONE idea per slide + 36pt+ headlines / 24pt+ body / NEVER below 18pt + photo on first-person slides; html_app sub-1s load + single primary action above fold + keyboard accessible + works offline) baked DIRECTLY into Felix's persona prompt as R98.14 (G)(H)(I) sections. **R98.14 +sec / +sec-2 / +sec-2 round 2 architect hardening (3 passes)** — **CRITICAL #1**: eval-sink in `html-app-builder.ts` smoke_assertion (LLM-authored expressions evaluated in `new Function`) replaced with a structured DSL (selectors_exist/absent, text_includes, min_count, attr_equals, title_includes; allowlist regex; DOM-read-only). **HIGH #1**: SSRF in `mpeg-engine.generateImageForScene` fetch(remoteUrl) routed through new shared `server/lib/ssrf-jail.ts` (rejects 169.254.169.254, RFC1918, localhost, *.railway.internal, IPv6 link-local/ULA, non-http/https schemes). **CRITICAL #2**: `redirect:'follow'` SSRF-bypass in `reference-learner.ts` closed — both `fetchTextWithCap` and YouTube oEmbed switched to `redirect:'error'` so a hostile https URL can't 302 to an attacker-controlled metadata IP after passing the pre-fetch SSRF check. All three architect re-verify passes returned DEPLOY SAFE. **R98.13 (W3+W4)** — `plan_deliverable` (#289, prompt→contract router with typed PipelineStep[] for 10 formats: video, audio, pdf, slides, spreadsheet, document, html_app, image, research, none; gemini-2.5-flash + JSON schema enforcement) + `grade_deliverable` (#290, vision/audio quality grader 0-100 with bounded auto-revise: ffprobe + ffmpeg blackdetect + volumedetect + jsdom + vision LLM; score&lt;85 auto-revises ONCE using the critique field, still &lt;85 escalates to Bob via owner-notification and refuses to ship). **R98.12 (W2+W5+W7)** — `verify_delivery_proof` (chat-engine refuse-to-declare-done gate now inspects the tool RESULT for ok:true not just call presence, closes the placeholder-args bypass the architect caught) + `build_html_app` (single-file HTML utilities, jsdom smoke-test before disk write, structured DSL replacing eval) + `record_strategic_win`/`recall_strategic_wins` (positive-exemplar mirror of R98.7 failure-pattern memory).</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98-14") ? "" : "truncate"}`}>296 tools, 66 skills, 16 personas (+ unlimited imports), 149 tables, ~180k LOC — R98.18+sec Self-Healing Maintenance Sweep (drizzle HIGH CVE closed + xlsx HIGH removed + alert tuning, npm audit 2 HIGH → 0) + R98.17 Cairo Cross-Pollination (kill switch + risk taxonomy + chat-slot reservation) + R98.16 IJFW Cross-Pollination + R98.14 Felix Deliverable Reliability Plan Complete + R98.11+sec2 Six-Round Hardening Day + R98.7+sec2 Self-Thinking Loop + R98.6 Profile-Photo Auto-Attach + R98.5 Production URL Fix + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer + R94 Tenant Cost-Attribution Integrity</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98-14") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98.11+sec2 — Six-Round Hardening Day: supply-chain discipline + slash commands + exit-77 + 3 security passes closing 3 HIGH findings (previous release, demoted) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98-11")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-sky-500/10 via-primary/5 to-transparent border border-sky-500/30 hover:border-sky-500/50 hover:bg-sky-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98-11"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-sky-600 text-white leading-none shrink-0 mt-0.5">R98.11+sec2</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98-11") ? "" : "line-clamp-2"}`}>Six-Round Hardening Day — six R-rounds shipped in one day capped by a whole-app architect sweep that closed 3 HIGH-severity findings. (1) R98.9 Supply-Chain Discipline: AGENTS.md `vc-supply-chain` block + SHA-256 skill manifest + LLM-driven dependency auditor that reads the manifest and reports drift. (2) R98.10 Project Slash Commands: `/check` (tsc --noEmit + npm-audit + skills-registry validate, the full pre-commit / pre-suggest_deploy quality gate), `/registry` (regenerate then validate after any `.agents/skills/` edit), `/commit-all` (Node-spawn git since bash git is sandbox-blocked); plus AGENT_FOLDER_MAP (`.agents/skills/_folder-map.json`) declaring per-skill destination folders for claude/cursor/codex/opencode/replit so the public mirror can pull a clean curated subset; plus new `slash_command` tool (the 284th — actions list/describe/run with frontmatter parsing, name validation `/^[a-z0-9][a-z0-9_-]&#123;0,63&#125;/i`, 8KB output cap per stream). (3) R98.11 exit-77 + gate_command on delegate_task: clean-skip pattern routes "no work needed" through a sentinel exit code so a no-op turn never burns LLM tokens. (4) R98.10+sec / R98.11+sec hardening: fail-CLOSED persona gate on `slash_command` action='run' (requires `_tenantId === 1` AND when `_personaId` is present `[Felix(2), Forge(3)]` only — list/describe stay open for discovery without RCE risk); install `--dest` containment-checked under project root or `/tmp` (rejects `/etc/foo` and `../../../etc/foo` exit 2); prompt-injection sanitization on slash command bodies; symlink rejection on skills-registry install + `.bob/commands` loader matching the `read_file`/`write_file` pattern. (5) R98.11+sec2 whole-app architect sweep — HIGH #1 strict env allowlist + secret redaction at both shell-exec sites (slash_command body + delegate_task gate, prevents env-leak via process inheritance and prevents API keys appearing in stdout); HIGH #2 `slash_command` added to HIGH_RISK_TOOLS + destructive-tool TOOL_POLICIES (this caught a quiet drift — Forge wasn't in TRUSTED_PERSONA_NAMES, fixed in the same edit); HIGH #3 symlink jails on skills-registry install + `.bob/commands` loader (defense in depth across the new ergonomic surfaces). Tool count 283 → 284. Two MEDIUMs deferred and recorded as known gaps in replit.md (execSync event-loop blocking refactor; owner-override expiry SLA on `_registry.json`). Public Mirror Push pipeline also fixed today — externalized `vc-*` allowlist into `scripts/public-mirror-public-mirror allowlist.txt` so future legitimate runtime/infra `vc-*` namespaces are a one-line config add instead of a brittle script edit.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98-11") ? "" : "truncate"}`}>296 tools, 66 skills, 16 personas (+ unlimited imports), 149 tables, ~180k LOC — R98.18+sec Self-Healing Maintenance Sweep (drizzle HIGH CVE closed + xlsx HIGH removed + alert tuning, npm audit 2 HIGH → 0) + R98.17 Cairo Cross-Pollination (kill switch + risk taxonomy + chat-slot reservation) + R98.16 IJFW Cross-Pollination + R98.14 Felix Deliverable Reliability Plan Complete + R98.13 plan_deliverable + grade_deliverable + R98.12 verify_delivery_proof + build_html_app + record_strategic_win + R98.11+sec2 Six-Round Hardening Day + R98.7+sec2 Self-Thinking Loop + R98.6 Profile-Photo Auto-Attach + R98.5 Production URL Fix + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer + R94 Tenant Cost-Attribution Integrity</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98-11") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98.7 + R98.7+sec + R98.7+sec2 — Felix Self-Thinking Loop: failure-pattern memory + structural quality sensor + voluntary self-check loop (previous release, kept visible) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98-7")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98-7"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R98.7</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98-7") ? "" : "line-clamp-2"}`}>Felix Self-Thinking Loop — direct response to Bob's frustration after R98.6: even with profile-photo auto-attach + validators, Felix kept regressing on the SAME class of strategic mistakes (planning-prose narration, meta-videos, silent-quit on tool errors, forgot-the-photo on slide 5) because persona-prompt fixes don't stick across long multi-tool conversations. Five coordinated additions, inspired by the open-source `sentrux` Rust architectural-signal sensor (5 metrics → 0-10000 score) but reimplemented pure-TS for VC's stack, layered on the existing `self-reflection` lesson infrastructure (no new tables, no schema change). (1) Static failure-pattern doc `data/personas/felix/known-failure-patterns.md` (P001-P010) distills R98.1 → R98.6+sec regressions into pattern→trigger→fix→self-check format in Felix's own voice. (2) Two memory tools — `record_failure_pattern` writes to `memory_entries` with new `category='strategic_lesson'`, dedup-by-pattern-name, per-tenant + per-persona; `recall_failure_patterns` returns parsed structured rows and bumps `last_accessed` so frequently-recalled lessons don't expire. (3) Structural quality sensor (`server/sensors/structural-signal.ts`) — pure-TS scan of `server/`, `shared/`, `client/src/`, `scripts/`: file count, total LOC, god-files (&gt;1000 LOC, sorted by size with paths), top 10 fan-in (most-imported via `@/`, `@shared/`, relative-path resolver), top 10 fan-out, optional madge cycles. Single 0-10000 score with explicit per-signal breakdown. Scan completes in 1.18s on the full repo (548 files, 180802 LOC); current score 6000/10000 — top god files: tools.ts:14480, routes.ts:5514, seed.ts:4305 — exactly as expected. (4) Two baseline tools — `quality_baseline_save` snapshots to sidecar JSON `.local/structural-baselines.json` (per replit.md transient-state preference, no new DB table); `quality_baseline_check` re-scans, returns `regressed: boolean` (true if score dropped &gt;100 OR a NEW god file appeared OR existing god files grew &gt;50 LOC), score_delta, file_count_delta, total_loc_delta, new_god_files, god_files_grown. (5) Felix + Forge `operating_loop` SELF-THINKING LOOP section: at task start call `recall_failure_patterns` (and `quality_baseline_save` for code work); during work when a validator catches a planning failure call `record_failure_pattern` BEFORE retrying; before declaring done re-recall and run `quality_baseline_check`; when Bob points out a regression call `record_failure_pattern` FIRST, apologize SECOND. The loop is prompt-driven (no chat-engine.ts edit) so it's voluntary — Felix CHOOSES to self-check, which is the "totally agentic and self-thinking" Bob asked for, not a forced inline check that would feel like a leash. R98.7+sec hardening — architect post-edit review returned FAIL with one HIGH and one MEDIUM both same-release fixable. (a) HIGH — `record_failure_pattern` deduped via `LIKE '%' || pattern.slice(0,80) || '%'` had two corruption surfaces: raw `%` and `_` in user pattern text became SQL wildcards that could match-and-overwrite other rows; prefix-substring matching meant two semantically-different patterns sharing an 80-char prefix would stomp each other. Fix: normalize pattern to `normKey = lowercase + replace([^a-z0-9]+,'-')` (controlled charset, zero wildcard surface), embed as `STRATEGIC_LESSON_V2:&lt;normKey&gt;|...` prefix, exact-equal-key dedup via `LIKE 'STRATEGIC_LESSON_V2:&lt;normKey&gt;|%'` where the wildcard is a safe constant we control. (b) MEDIUM — V2 fact format = `STRATEGIC_LESSON_V2:&lt;normKey&gt;|&lt;json-encoded pattern + trigger + fix + self_check + severity + tags&gt;`. Recall now `f.startsWith('STRATEGIC_LESSON_V2:')` → parse JSON; legacy V1 regex parser kept as fallback. R98.7+sec2 — owner-requested full-app architect sweep across three parallel passes (today's R98.7 files; auth + tenant isolation + safety; web/SSRF + signed URLs + path + payment) closed two findings introduced by R98.7: HIGH wrong relative import path on the sensor (`./lib/silent-catch` → `../lib/silent-catch`, would have crashed `quality_baseline_save`/`quality_baseline_check` at first use because the original smoke test only exercised `scanStructure()` directly, not the tool dispatch path) and MEDIUM stale headline stat (279 → 283). Live-verified full sensor cycle (scanStructure → saveBaseline → compareToBaseline → deleteBaseline) in 2089ms with no errors. Tool count 279 → 283 (+4); skills + personas unchanged.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98-7") ? "" : "truncate"}`}>296 tools, 66 skills, 16 personas (+ unlimited imports), 149 tables, ~180k LOC — R98.18+sec Self-Healing Maintenance Sweep (drizzle HIGH CVE closed + xlsx HIGH removed + alert tuning, npm audit 2 HIGH → 0) + R98.17 Cairo Cross-Pollination (kill switch + risk taxonomy + chat-slot reservation) + R98.16 IJFW Cross-Pollination + R98.14 Felix Deliverable Reliability Plan Complete + R98.13 plan_deliverable + grade_deliverable + R98.12 verify_delivery_proof + build_html_app + record_strategic_win + R98.11+sec2 Six-Round Hardening Day + R98.7+sec2 Self-Thinking Loop + R98.6 Profile-Photo Auto-Attach + R98.5 Production URL Fix + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R75.A AHB Defense Layer + R94 Tenant Cost-Attribution Integrity</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98-7") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R98 — Felix Can Actually Deliver: project-folder-aware Drive upload + lost-file recovery + never-quit-silently rule (previous release, kept visible) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r98")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r98"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R98</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r98") ? "" : "line-clamp-2"}`}>Felix Can Actually Deliver — fix to a real production incident where Felix uploaded Bob's "Real_Weight_Loss" MP4 to a generic timestamped Drive subfolder (not the named "[Your Product]" folder Bob saw on his phone), never registered it in `project_files`, then silently quit when asked for the link because `read_file` won't open binaries. Five coordinated fixes: (1) `uploadAndShare` now takes `projectId` and routes the file DIRECTLY into the project's named Drive folder via `ensureProjectFolder` (no more hidden auto-subfolder); (2) `project_files` row is auto-INSERTed on every successful upload with projectId — physically impossible to lose the link again; (3) new `google_drive` `command:"search"` sub-tool with two-pass lookup (project_files DB first, Drive API name search second, project-folder-scoped when projectId given) — smoke-tested live and instantly recovered Bob's lost video; (4) Felix + Forge persona docs gain a hard never-quit-silently rule (P0): tell the user EXACTLY which file failed, what you tried, what the error said, what they can do next; (5) customer-delivery skill gains the new project-folder routing + recovery section as the documented default. Tool count unchanged (search is a sub-command); skill count unchanged (customer-delivery enhanced in place).</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r98") ? "" : "truncate"}`}>296 tools, 66 skills, 16 personas (+ unlimited imports), 149 tables, ~180k LOC — R98.18+sec Self-Healing Maintenance Sweep (drizzle HIGH CVE closed + xlsx HIGH removed + alert tuning, npm audit 2 HIGH → 0) + R98.17 Cairo Cross-Pollination (kill switch + risk taxonomy + chat-slot reservation) + R98.16 IJFW Cross-Pollination + R98.14 Felix Deliverable Reliability Plan Complete + R98.13 plan_deliverable + grade_deliverable + R98.12 verify_delivery_proof + build_html_app + record_strategic_win + R98.11+sec2 Six-Round Hardening Day + R98.7+sec2 Self-Thinking Loop + R98.6 Profile-Photo Auto-Attach + R98.5 Production URL Fix + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R96.1 Universal Recall + R75.A AHB Defense Layer + R94 Tenant Cost-Attribution Integrity + R83-R93 24h Security Sweep</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r98") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R97 — Self-Maintaining Platform: Weekly Auto-Maintenance Cron + Agent-Context-Wiring Skill (previous release, kept visible) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r97")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r97"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R97</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r97") ? "" : "line-clamp-2"}`}>Self-Maintaining Platform — new in-process scheduler runs an 8-pass weekly maintenance sweep (npm audit + outdated, integrations currency, SAST hooks, prod schema parity, prod log scan, Railway microservice health, model SDK currency, skill index drift) every 7 days and emails Bob a GREEN/YELLOW/🔴-URGENT summary automatically. Two new HTTP routes (public status + Bearer-gated trigger) for external cron pings. Two new agent skills shipped: `agent-context-wiring` (closes the gap where new tools EXIST in the registry but no persona's allowed_tools / system_prompt actually uses them — 8-step checklist over 9 context surfaces) and `weekly-maintenance-review` (the executable cron's narrative twin — per-pass triage rules, GREEN/YELLOW/RED protocol, auto-trigger of dependency-upgrade for CRITICAL/HIGH findings).</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r97") ? "" : "truncate"}`}>296 tools, 66 skills, 16 personas (+ unlimited imports), 149 tables, ~180k LOC — R98.18+sec Self-Healing Maintenance Sweep (drizzle HIGH CVE closed + xlsx HIGH removed + alert tuning, npm audit 2 HIGH → 0) + R98.17 Cairo Cross-Pollination (kill switch + risk taxonomy + chat-slot reservation) + R98.16 IJFW Cross-Pollination + R98.14 Felix Deliverable Reliability Plan Complete + R98.13 plan_deliverable + grade_deliverable + R98.12 verify_delivery_proof + build_html_app + record_strategic_win + R98.11+sec2 Six-Round Hardening Day + R98.7+sec2 Self-Thinking Loop + R98.6 Profile-Photo Auto-Attach + R98.5 Production URL Fix + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R96.1 Universal Recall + R75.A AHB Defense Layer + R94 Tenant Cost-Attribution Integrity + R83-R93 24h Security Sweep + R80 Claude Code Importer + R79 MarTech Bundle + R77.5 KisMATH + R76 Trust-Tier Policy Engine + R75 GraphRAG Five</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r97") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R96 + R96.1 — Camofox Stealth Microservice + Universal-Recall Escalation Ladder (previous release, kept visible) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r96")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r96"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R96</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r96") ? "" : "line-clamp-2"}`}>Camofox Stealth-Browser Microservice + Universal-Recall Escalation Ladder — `jo-inc/camofox-browser` (MIT, Camoufox-based stealth browser, 3961★) deployed as its own Railway service (camofox-production-d61e.up.railway.app), exposed as new tool `stealth_browse_camofox` (full WebGL/canvas/font/WebRTC spoofing, per-(tenant, persona) persisted cookies + storage_state). Universal recall: all four web tiers (web_fetch / browser / stealth_browse / stealth_browse_camofox) added to ALWAYS_INCLUDE in the tool router so every persona sees the full ladder on every routed turn — not only when the user types "browser". Auto-detection: blocked-page payloads (Cloudflare, hCaptcha, DataDome, Akamai, 401/403/407/429/451 status, "are you a robot" interstitials) get a top-of-result `fallbackHint` + `fallbackTool` injected into the tool return so the model literally sees the escalation instruction inline — survives chat-engine 1500-char truncation AND the underscore-prefix prompt-injection key strip. Doctrine #3 in PLATFORM_TOOLS_CONTRACT updated with the explicit four-tier ladder; all 16 personas read it. Hardening pass after architect 2-CRITICAL/2-HIGH/2-MEDIUM review: HITL gate on click/type/navigate/extract/open (action-only matching in isHighRiskSubAction now correctly fires for tools that don't multiplex by service); SSRF guard reuses isSafeUrl + isSafeDns (rejects metadata IP, RFC1918, localhost, *.railway.internal, IPv6 link-local, non-http/https schemes — verified against 11 attack URLs); per-persona cookie isolation closes Robert-medical / Felix-CEO session bleed inside tenant 1; firecrawl success-path annotation closes the interstitial-as-success bypass; softened hint wording closes the indirect-prompt-injection vector where a hostile page could trigger the annotator and use it to suppress legitimate failure messages; non-underscore key names survive the chat-engine prompt-injection strip. 52/52 regression tests + live two-persona Camofox round-trip verified.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r96") ? "" : "truncate"}`}>296 tools, 66 skills, 16 personas (+ unlimited imports), 149 tables, ~180k LOC — R98.18+sec Self-Healing Maintenance Sweep (drizzle HIGH CVE closed + xlsx HIGH removed + alert tuning, npm audit 2 HIGH → 0) + R98.17 Cairo Cross-Pollination (kill switch + risk taxonomy + chat-slot reservation) + R98.16 IJFW Cross-Pollination + R98.14 Felix Deliverable Reliability Plan Complete + R98.13 plan_deliverable + grade_deliverable + R98.12 verify_delivery_proof + build_html_app + record_strategic_win + R98.11+sec2 Six-Round Hardening Day + R98.7+sec2 Self-Thinking Loop + R98.6 Profile-Photo Auto-Attach + R98.5 Production URL Fix + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R96.1 Universal Recall + R75.A AHB Defense Layer + R94 Tenant Cost-Attribution Integrity + R83-R93 24h Security Sweep + R80 Claude Code Importer + R79 MarTech Bundle + R77.5 KisMATH Reasoning Audit + R76 Trust-Tier Policy Engine + R75 GraphRAG Five</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r96") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

        {/* R75.A — Adversarial Humanities Benchmark (AHB) Defense Layer (previous release, kept visible) */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r75a")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r75a"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R75.A</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r75a") ? "" : "line-clamp-2"}`}>Adversarial Humanities Benchmark (AHB) Defense Layer — defense-in-depth against stylistic-obfuscation jailbreaks (poetry, allegory, hermeneutics, role-play) that lift frontier-model attack success from 3.84% to 55.75% per Galisai et al. 2026. Two new layers on top of the crisis classifier and prompt-injection scanner: (1) INTENT GATE — every message is destyled by a fast classifier into its literal intent, then matched against a per-persona safety profile (strict / moderate / off) with restricted categories. Robert seeded with 8 medical categories (drug dosage, diagnosis, prescription change, eating-disorder validation, off-label use, supplement stacking, self-harm facilitation, medical advice); Felix seeded with 5 destructive categories (production data destruction, money movement without approval, credential exposure, mass email unapproved, tenant isolation bypass). Runs for direct user input AND subagent traffic so a jailbroken outer agent cannot poetry-attack Robert via spawn_subagent. (2) DESTRUCTIVE-TOOL POLICY — registry of money-moving / data-deleting / credential-touching tools requires typed object args, trusted persona, fresh approval row, and value caps. Unregistered tools whose names match suspicious patterns (delete_*, exec_sql, payout, reveal_secret, sudo_*) auto-classified destructive and fail closed. Audit log on every block decision is awaited (1.5s timeout) so the security trail survives a post-refusal process crash. 19/19 AHB regression suite (4 Robert poetic attacks + 6 Robert benign protocol questions + 3 Felix lateral attacks + 6 destructive-tool structural tests) gates CI. Eight code-review findings closed in same release: subagent-traffic enforcement, suspicious-name fail-closed default, awaited audit log, PII-minimized literal_intent, cache key invalidates on profile change, distinct-category signal counting, generic refusal copy that doesn't echo categories to attackers, snake_case/camelCase consistency.</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r75a") ? "" : "truncate"}`}>296 tools, 66 skills, 16+ personas (+ unlimited imports), 149 tables, ~180k LOC — R98.18+sec Self-Healing Maintenance Sweep (drizzle HIGH CVE closed + xlsx HIGH removed + alert tuning, npm audit 2 HIGH → 0) + R98.17 Cairo Cross-Pollination (kill switch + risk taxonomy + chat-slot reservation) + R98.16 IJFW Cross-Pollination + R98.14 Felix Deliverable Reliability Plan Complete + R98.13 + R98.12 + R98.11+sec2 + R98.7+sec2 Self-Thinking Loop + R98.6 Profile-Photo Auto-Attach + R98.5 Production URL Fix + R98 Felix Can Actually Deliver + R97 Self-Maintaining Platform + R96 Camofox + R96.1 Universal Recall + R75.A AHB Defense Layer + R94 Tenant Cost-Attribution Integrity + R83-R93 24h Security Sweep + R80 Claude Code Importer + R79 MarTech Bundle + R78.1 A2A v0.3 Agent Card + R77.5 KisMATH Reasoning Audit + R76 Trust-Tier Policy Engine + Deliverable Contract Verification + R75 GraphRAG Five + R74.13z-quat Operating Doctrine</div>
          </div>
          <span className="text-xs text-primary font-medium opacity-70 group-hover:opacity-100 shrink-0 mt-0.5">{releaseExpanded.has("banner-whats-new-r75a") ? "Collapse ↑" : "Open ↓"}</span>
        </button>

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
            {attentionEvents.length > 0 && (() => {
              const sorted = [...attentionEvents].sort((a, b) => {
                const sa = a.salience_score == null ? -1 : Number(a.salience_score);
                const sb = b.salience_score == null ? -1 : Number(b.salience_score);
                if (sb !== sa) return sb - sa;
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              }).slice(0, 8);
              const wakeCount = attentionEvents.filter(e => e.salience_score != null && Number(e.salience_score) >= 70).length;
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
                          {attentionEvents.length} events
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
