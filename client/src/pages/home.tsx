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

        {/* R117.1+sec (2026-05-19) — Cross-tenant file_storage overwrite hardened in server/pdf-create.ts (resolveTenantOrAdmin helper + ADMIN_TENANT_ID + scoped SELECT/UPDATE/INSERT). R117 — two NEW token-optimization tools (read_output_blob + code_slice, tools 357→359) on shared symbol-graph layer with token-aware ReDoS structural scanner. Architect-verified PASS. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r117_1_sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors text-left group"
          data-testid="banner-whats-new-r117_1_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R117.1+sec</span>
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
