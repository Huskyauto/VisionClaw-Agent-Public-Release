import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Bot, MessageSquare, Zap, Clock, TrendingUp, Plus, ArrowRight, Brain, Users,
  BookOpen, Activity, CheckCircle2, XCircle, FileText, Code, Shield,
  AlertTriangle, RefreshCw, Rocket, Globe, Briefcase, ChevronRight, ChevronDown,
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
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { ErrorState } from "@/components/error-state";
import OnboardingWelcome from "@/components/onboarding-welcome";
import UsageDashboard from "@/components/usage-dashboard";
import {
  TEMPLATE_ICONS, PLAYBOOKS, StatusPulse, renderBoldText, BriefingSpeakButton,
  type Stats, type HealthReport, type HeartbeatLogEntry,
} from "@/components/home-widgets";
import { HomeReleaseArchive } from "@/components/home-release-archive";

export default function HomePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [releaseExpanded, setReleaseExpanded] = useState<Set<string>>(new Set());
  const [showAllUpdates, setShowAllUpdates] = useState(false);
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

        {/* R125+146+sec (2026-08-02) — NEW (rose): 72h whole-app security review — 3 HIGH + 2 MEDIUM closed, second architect pass PASS. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_146sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/15 via-primary/5 to-transparent border border-rose-500/40 hover:border-rose-500/60 hover:bg-rose-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_146sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+146+sec NEW</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_146sec") ? "" : "line-clamp-2"}`}>{"R125+146+sec — **72h whole-app security review: 3 HIGH + 2 MEDIUM closed, second architect pass PASS.** **HIGH #1 (capability-map policy-edge leak):** /api/agent-insights/capability-map answered any authenticated tenant without tenant resolution and included every agent's blocked-tool policy edges — a map of exactly what each role is forbidden to do; the endpoint now requires resolveTenantId and returns blocked-tool edges ONLY to platform admins (personas/capabilities stay visible to all). **HIGH #2 (prefix-shadowing mispricing, caught twice):** DeepSeek V4 Flash 0731 was billed at a generic family prefix rate ($0.14/$0.28 vs the real $0.09/$0.18); an exact pricing row was added plus a NEW prefix-shadowing order guard in the pricing-drift suite — which immediately caught a second live bug: gpt-4.1-mini shadowed by gpt-4.1 ($2/$8 vs $0.4/$1.6), also fixed. **HIGH #3 (pre-existing — email-reply ownership):** /api/email/reply never verified the messageId belonged to the requesting tenant (shared provider inbox → cross-tenant thread replies); replies now require a tenant-scoped inbox_messages ownership match with 404 on mismatch, pinned by a source-scan regression test. **MEDIUMs (2):** scratchpad reads fail CLOSED without tenant ctx; all 3 per-row scheduled-post status UPDATEs pin AND tenant_id. Second architect pass on the fixes: PASS, no new findings. Gates: tsc 0, seamtests 85/85, suite 173/173, wiring audit CLEAN (408 tools)."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_146sec") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **18 personas**, **226 tables** — R125+146+sec closes 3 HIGH (capability-map policy-edge leak, prefix-shadowed model mispricing ×2, email-reply cross-tenant ownership) + 2 MEDIUMs in a 72h whole-app review; second architect pass PASS. _(model: claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_146sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+146 (2026-08-01) — DEMOTED (emerald): Agent Insights — scorecards, capability map, workflow replay (Tasks #126/#127/#128). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_146")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/15 via-primary/5 to-transparent border border-emerald-500/40 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_146"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+146</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_146") ? "" : "line-clamp-2"}`}>{"R125+146 — **Agent Insights: every agent's real track record, a live capability map, and step-by-step workflow replay.** **Agent Scorecards (/agent-scorecards):** each active agent's REAL numbers over a 7/30/90-day window — tasks completed + success rate from the activity ledger, actual spend + cost-per-task from the cost ledger, average quality /100 from the step grader, and your team's human-approval rate. **Capability Map (/capability-map):** a searchable goals → capabilities → agents → tools map from the live capability registry, including per-agent blocked-tool edges so you see what each agent deliberately CANNOT do. **Workflow Replay (/replay):** replay any finished run step by step — which agent, which tools, duration, output, grader score and rationale, plus planned-but-never-executed steps; strictly read-only. **Architect-hardened before ship:** lifecycle log events filtered out of replay (no phantom steps), per-step grades joined EXACTLY on the step number (off-by-one fixed), and replay text passes a widened redaction layer (emails, phones, Bearer/Authorization headers, cookies, connection-string credentials, password/api-key assignments, long opaque tokens) pinned by 14 dedicated tests. Gates: tsc 0, seamtests 85/85, suite 170/170, route census 714→718. Tasks #126/#127/#128 delivered."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_146") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **18 personas**, **226 tables** — R125+146 ships three tenant-facing observability surfaces: agent scorecards, the capability map, and workflow replay. _(model: claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_146") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+145 (2026-08-01) — DEMOTED (cyan): admin-rights consistency across both auth paths + owner-binding takeover guard + 72h whole-app security review (1 HIGH email-reply redaction gate + 5 MEDIUMs closed, second architect pass PASS). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_145")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/15 via-primary/5 to-transparent border border-cyan-500/40 hover:border-cyan-500/60 hover:bg-cyan-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_145"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+145</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_145") ? "" : "line-clamp-2"}`}>{"R125+145 — **Admin rights made consistent + whole-app 72h security review: 1 HIGH and 5 MEDIUMs closed, second architect pass PASS.** **Admin-auth fixes:** /api/auth/user now returns isAdmin for flagged admins (admin tenant OR tenant.is_admin), matching /api/tenants/me — no more missing admin sidebar after a Replit-auth login; isAdminRequest honors is_admin consistently across the Replit-auth AND token paths (Task #124 merged); owner-email detection merges the real OWNER_EMAIL secret with legacy OWNER_EMAILS and gains a takeover guard — admin tenant #1 can never be silently rebound to a DIFFERENT Replit subject (binds only on empty or exact replitUserId match). **HIGH #1 (fixed):** replyToEmail bypassed the R95 enforceOutbound secret-redaction gate that every regular outbound email passes — a prompt-influenced reply could have leaked credential-shaped content to an external correspondent; fail-closed text+html gates added (email:reply:text / email:reply:html) and pinned by a static source-scan regression test. **MEDIUM #1:** the internal event resolver could finalize customer-scoped events without a tenant check on two branches — tenant now resolved once at entry, fails CLOSED on missing tenant. **MEDIUM #2:** the usage-insights pricing map missed the z-ai/glm-5.2 and moonshotai/kimi-k2.6 price refresh (cost reports would show wrong numbers) — synced above their generic prefixes. **MEDIUM #3:** voice conversations ignored the tenant when picking an AI provider — now routed through getClientForModel(model, tenantId) so tenant provider keys and subscription lanes apply. **MEDIUMs #4–5:** two wedge-wiring scripts updated heartbeat/project rows by bare id — now tenant-scoped. **Deferred (documented):** set JURY_QUEUE_HMAC_SECRET wherever jury auto-apply is enabled. Second architect pass on the fixes: PASS, no new findings. Gates: tsc 0, seamtests 69/69, suite 169/169, wiring audit CLEAN."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_145") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **146 reference surfaces**, **18 personas**, **226 tables**, **667 indexes**, **41 governance rules** — R125+145 closes 1 HIGH (email-reply redaction gate) + 5 MEDIUMs in a 72h whole-app review and makes admin rights consistent across both sign-in paths with an owner-binding takeover guard. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_145") ? "rotate-180" : ""}`} />
        </button>

        <button
          onClick={() => setShowAllUpdates(v => !v)}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-border/60 hover:border-border hover:bg-muted/40 transition-colors text-xs text-muted-foreground"
          data-testid="button-toggle-all-updates"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAllUpdates ? "rotate-180" : ""}`} />
          {showAllUpdates ? "Hide older updates" : "Show all older updates"}
        </button>

        {showAllUpdates && (<>
        {/* R125+143 (2026-08-01) — DEMOTED (rose): all 18 agents fully wired — expanded scopes for 7 personas (agency-agents market validation, reauthored natively), capability registry completed (Echo/Hermes/Robert), universal 408-tool awareness, 5-layer persona-drift defense line, 72h review (0 security findings, 1 HIGH correctness fixed). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_143")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/15 via-primary/5 to-transparent border border-rose-500/40 hover:border-rose-500/60 hover:bg-rose-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_143"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+143</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_143") ? "" : "line-clamp-2"}`}>{"R125+143 — **All 18 agents are now fully wired: seven personas gain market-validated expanded scopes, every agent knows the full 408-tool registry, and a five-layer persona-drift defense line locks agent identities to their source of truth.** **Expanded scopes (reauthored natively from the market-validated 137k★ agency-agents roster — never copied):** Teagan adds AEO/GEO and AI-citation optimization so content ranks in AI answers, not just search; Hermes adds paid-media operations under Felix's budget gate ($0 spend without CEO approval, unchanged); Apollo adds discovery-call prep, proposal drafting, and pipeline hygiene; Echo adds cross-channel feedback synthesis with an ethical-nudge review lens; Cassandra adds FP&A/controller duties, investment memos, and tax-flag spotting; Luna adds DPO-grade compliance and vendor review; Proof adds accessibility checks, reality checks, and performance sanity passes — every block preserves the explicit spend/approval and privacy boundaries and is written byte-identical to BOTH identity source files AND the live DB. **Capability registry completed:** Hermes, Echo, and Robert were missing from the agent capability registry (invisible to cross-agent routing); all 18 are now registered, and Robert's stale 'Security' role is corrected to Wellness Coach ([Your Product]). **Universal tool awareness:** all 18 personas re-synced against the full 408-tool registry; wiring audit fully CLEAN — 0 dead tools, 0 drift, 0 schema gaps, 0 orphan tables. **Persona-drift defense line (5 merged tasks):** identity drift (DB vs source-of-truth, both directions), operating-loop drift, tools-doc drift, unified persona-doc writers, and a curated-doc staleness gate wired fail-closed into the public-mirror build — an agent's identity, operating loops, or tool docs can no longer silently diverge from code. **72h review (3 parallel architect passes over all 127 code files changed in 72h + the sensitive core): 0 security findings; 1 HIGH correctness fixed** — the orphan-table introspector had generated duplicate Drizzle declarations for 4 live self-repair tables (the audit never scanned the self-repair schema module; now it does, and the generated schema is regenerated clean) — plus the curated-doc staleness test promoted into the canonical suite with its flaky teardown fixed, gate scripts normalized to their documented fail-closed exit code, and the drift test's subprocess/DB timeouts bounded under the harness limit. Gates: tsc 0, seamtests 71/71, wiring audit CLEAN."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_143") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **146 reference surfaces**, **18 personas**, **226 tables**, **667 indexes**, **41 governance rules** — R125+143 wires all 18 agents end-to-end: expanded scopes for 7 personas, universal 408-tool awareness, and a 5-layer persona-drift defense line. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_143") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+141/+142 (2026-07-30) — DEMOTED (amber): speculative read-only tool prefetch on plan-replay hits (guarded, fail-open, single-use cache) + LLM-Wiki borrows: compile-on-ingest concept distillation in the knowledge refresh (update-not-append, fail-open, hard-clamped spend) and weekly cross-store knowledge lint Pass 19 (advisory). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_142")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/15 via-primary/5 to-transparent border border-amber-500/40 hover:border-amber-500/60 hover:bg-amber-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_142"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+142</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_142") ? "" : "line-clamp-2"}`}>{"R125+141/+142 — **The platform compiles what it learns, lints its own knowledge weekly, and pre-fetches tool results on replayed plans.** **Compile-on-ingest (R125+142, Karpathy LLM-Wiki borrow):** the nightly Agent Knowledge Refresh now distills every CHANGED source into ≤5 concept summaries that UPDATE existing `concept:` entries instead of appending raw chunks — a maintained wiki, not an append-only log. Fast-tier model, fail-open 90s timeout, per-run cap hard-clamped at 16 (env can only lower it), kill switch KNOWLEDGE_COMPILE_DISABLED=1, source and existing text delimited as untrusted data against prompt injection; concepts join the embedding backfill and are immediately retrievable. **Cross-store knowledge lint (R125+142):** new read-only weekly-maintenance Pass 19 catches duplicate active triples (supersession races), superseded memories missing succeeded_by links, stale-active memories, retrieval-dead knowledge rows (missing embeddings, scoped to embedded sources only), and compiled concepts lagging a fresher triple on the same subject — advisory YELLOW, never RED; first live run clean. **Architect findings closed pre-ship:** admin-tenant+persona predicates on the backfill selects, same-tenant lint join, hard spend clamp + 4000-token ceiling — pinned by tests (13/13 lib, suite 166/166, tsc 0). **Speculative prefetch (R125+141):** on a plan-replay cache hit the tool chain is known upfront, so 8 allowlisted read-only tools pre-execute through the FULL guard path (same tenant, policy re-checked fail-closed at consume); 45s single-use cache, error envelopes never cached, trust params stripped from keys, kill switch SPEC_PREFETCH_DISABLED=1 (15/15 targeted tests)."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_142") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **146 reference surfaces**, **18 personas**, **226 tables**, **667 indexes**, **41 governance rules** — R125+141/+142 adds compile-on-ingest concept distillation, weekly cross-store knowledge lint (Pass 19), and guarded speculative tool prefetch on plan-replay hits. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_142") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+140+sec (2026-07-30) — (violet): repo-surgeon plan-vs-diff conformance gate (undeclared touches roll back + count toward stop budget), video-finalize corruption gate (corrupt render can never ship), outbound quality-gate degraded telemetry, 72h review closing 2 HIGH (fail-closed operator-script flag gates; ErrorBoundary raw-error redaction) + MEDIUM sweep + glm-5.2 pricing sync. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_140")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/15 via-primary/5 to-transparent border border-violet-500/40 hover:border-violet-500/60 hover:bg-violet-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_140"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+140+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_140") ? "" : "line-clamp-2"}`}>{"R125+140+sec — **Self-repair conformance gate, corrupt-render delivery block, and a 72h review closing 2 HIGH fail-closed.** **Plan-vs-diff conformance gate (Harness Handbook adoption):** the guarded repo-surgeon now compares its DECLARED edit scope against the ACTUAL working-tree delta after every fix attempt — any undeclared touched file triggers an automatic rollback, conformance is recorded per attempt, and a rollback counts toward the durable stop budget (repo-surgeon-conformance suite pins the fail-closed rollback). **Corrupt-render delivery block:** final video artifacts are verified BEFORE being marked done or uploaded; invalid output fails CLOSED back to retryable state with an incident report (video-finalize-gate suite) — a corrupt render can never reach a customer. **Outbound degraded telemetry:** email send, email reply, and scheduled-post all report outbound_quality_gate_degraded when the content scanner fails open (static wiring tests pin the coverage). **72h review (3 parallel architect passes + wiring audit exit 0 — 408 tools / 18 personas):** server pass PASS 0 CRITICAL / 0 HIGH (Stripe signature-before-side-effect, livemode parity, replay dedupe, paid-state gating all re-verified). **HIGH #1 (scripts):** build-public-mirror.sh accepted unknown argv flags and proceeded to a LIVE force-push of the public repo — a --dryrun typo was a real push; a strict allowlist (only --dry-run) now refuses with exit 2 before any side effect, and the same unknown-flags-run-live class was swept into resolve-escalations.ts and drain-jury-queue.ts. **HIGH #2 (client):** the ErrorBoundary rendered raw error.message to end users (internal paths / integration detail could leak); replaced with safe generic copy. **MEDIUMs:** two silent catches made observable (onboarding-seen POST now warns; resend-verification warns + shows a user-facing retry message); stale stats fixed (onboarding persona roster 16→18 verified against the live DB; governance fallback 40→41). **Also:** z-ai/glm-5.2 pricing drift fixed in BOTH pricing maps (model-pricing-drift suite green) and the stale-string preflight gate itself cured of a glob@7 ESM-import break — the drift safety net was silently down."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_140") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **146 reference surfaces**, **18 personas**, **226 tables**, **667 indexes**, **41 governance rules** — R125+140+sec adds the plan-vs-diff conformance gate, blocks corrupt-render delivery, and closes 2 HIGH (fail-closed operator scripts + client error redaction). _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_140") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+139 (2026-07-28) — (emerald): majority-rule autonomous repair — the 3-frontier-model jury auto-applies FIX on a strict majority (was unanimous), majority ACCEPT/REJECT terminally closes, all safety gates intact; all three self-repair autonomy flags ON; fail-closed public-mirror persona/tool doc guards (Tasks 84/85). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_139")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/15 via-primary/5 to-transparent border border-emerald-500/40 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_139"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+139</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_139") ? "" : "line-clamp-2"}`}>{"R125+139 — **Majority-rule autonomous repair: the three-frontier-model jury now auto-applies fixes on a strict majority vote, and full self-repair autonomy is switched ON.** **Policy change (owner-directed):** `mapJuryDecision`'s auto-fix gate moved from UNANIMOUS to STRICT MAJORITY — a 2/3 (or 3/4, 3/5…) FIX now routes to the guarded repo-surgeon instead of parking in the owner's inbox, and a majority ACCEPT/REJECT terminally closes the incident on the ledger with votes + rationale (denied and done, never lingering). **Every guard intact and pinned by tests:** the jury's own escalation flag and the fix-direction concordance floor (0.45) still override any majority; enforceSafetyRouting still forces protected surfaces (tests/guards/safety layers) away from auto-fix; the repo-surgeon still typechecks/tests and lands-or-rolls-back; prod code edits still refused; REPAIR_AUTOFIX_ENABLED still the opt-in master switch. **New invariants from the architect round:** even jury sizes (2-of-4 must NOT act, 3-of-4 acts), malformed vote cardinality (empty votes ⇒ legacy 3-seat default, sub-majority never closes or fixes) — 66/66 unit tests green, tsc 0. **Autonomy flags:** REPAIR_AUTOFIX_ENABLED + JURY_AUTOAPPLY + TENANT_AUDIT_ENQUEUE_FIXES all =1 in the owner environment — the detect → jury → auto-apply loop is live end-to-end. **Public mirror hardening (Tasks 84/85):** fail-closed persona-count (stage 0.1) and tool-count (stage 0.2) guards abort the mirror build on docs drift vs the live registry/DB; comparison logic extracted into a pure lib with a DB-free test suite (missing doc, header/row drift, dropped/rogue rows, vacuous parse, empty registry) wired into tests/run.sh. **Post-edit 72h review (2 parallel architect passes):** server pass PASS (0 CRITICAL/0 HIGH); client pass caught two stale public stats — signup SEO (296→408 tools) and compare page (263→408) — both fixed."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_139") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **145 reference surfaces**, **18 personas**, **225 tables**, **663 indexes**, **41 governance rules** — R125+139 flips the jury to majority-rule auto-apply with all safety gates intact, turns on full self-repair autonomy, and adds fail-closed public-mirror doc guards."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_139") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+138 (2026-07-28) — (cyan): two new personas onboarded (16 → 18) — Hermes (Growth Hacker) + Echo (UX Researcher) — with intent-gate fallback/hint coverage added for 3 previously under-covered restricted categories and 16 new AHB fixtures (68/68, ASR 0%). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_138")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/15 via-primary/5 to-transparent border border-cyan-500/40 hover:border-cyan-500/60 hover:bg-cyan-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_138"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+138</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_138") ? "" : "line-clamp-2"}`}>{"R125+138 — **The AI team grows from 16 to 18: Hermes (Growth Hacker) and Echo (UX Researcher) join, and the jailbreak gate gains coverage for three previously under-covered restricted categories.** **Hermes 🚀 — Growth Hacker (Acquisition & Experiments):** owns the growth-experiment loop — pre-registered hypotheses with success metrics and kill criteria written BEFORE launch, weekly Monday-launch/Friday-readout cycle, fully-loaded CAC math, organic-before-paid doctrine, and $0 spend without CEO approval; feeds validated channels into the marketing autopilot and routes every lead to Apollo same-day. **Echo 👂 — UX Researcher (Voice of the User):** decision-question-first studies, mines existing signals (support threads, churn, analytics) before new interviews, anonymize-at-capture PII rule (P-labels, never names), one-page readouts with evidence + severity, blocker findings escalate to the CEO same day. Both roles mirror the market-validated agency-agents roster (137k★) but are reauthored natively — never copied. **Safety onboarding per the 9-step checklist:** both run the moderate intent gate with persona-voice refusals (Hermes: mass-email/public-post/money-movement/credential/tenant categories; Echo: mass-email/public-post/credential/tenant). **Intent-gate hardening shipped alongside:** `public_post_unapproved` had ZERO hint-tier coverage and 3 categories (mass_email_unapproved, public_post_unapproved, tenant_isolation_bypass) had ZERO fallback-regex coverage — meaning moderate-gate personas (Felix, Scribe, Chief of Staff, Proof…) could never accumulate the 2nd blocking signal for those categories when the LLM destyler is unavailable; one pattern per category added. **Verification:** AHB adversarial suite extended with 10 attack + 6 benign fixtures for the two personas — 68/68 pass, ASR 0%; tools_doc synced live for both (push-persona-sync); emoji/catchphrase seeded; tsc 0."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_138") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **45 (.agents) + 62 (db) + 38 (output-skills) = 145 reference surfaces**, **18 personas**, **225 tables**, **663 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+138 onboards Hermes (Growth Hacker) + Echo (UX Researcher) per the 9-step persona checklist and closes the intent-gate coverage gap for 3 restricted categories. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_138") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+137.94 (2026-07-27) — DEMOTED (emerald): AI Fix Kit for the $1,997 done-for-you audit tier (generate_audit_fix_kit, tools 407→408) + 72h sweep closing 1 HIGH — DFY orders could auto-ship past the review queue; canAuto hard-gated manual-only. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_137_94")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/15 via-primary/5 to-transparent border border-emerald-500/40 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_137_94"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+137.94</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_137_94") ? "" : "line-clamp-2"}`}>{"R125+137.94 — **The AI Fix Kit ships for the $1,997 done-for-you audit tier (tools 407 → 408), and a 72h full-platform sweep hard-locks done-for-you orders to human review — they can never auto-ship.** **AI Fix Kit:** new Felix tool `generate_audit_fix_kit` re-audits the customer's site through the SSRF-jailed fetcher and generates a ready-to-apply kit — 3 LLM files grounded ONLY on the fetched content + audit findings, each fail-closed validated with domain-grounding checks (generated JSON-LD/meta URLs must match the audited domain; 14/14 validator tests), plus deterministic robots additions + README, zipped with post-write verification and attached to the order's HITL review item; kit failure holds the order for manual review, never blocks the audit PDF. **3 feature-round architect findings closed:** HIGH — collision-prone flat zip name could cross-deliver same-day kits (now orderId slug + random hex); MEDIUM — fetched page text now wrapped in a <<<UNTRUSTED_PAGE_CONTENT>>> data-never-instructions prompt-injection boundary; MEDIUM — domain-grounding validators added. **72h full-platform sweep (3 parallel architect passes over all 87 files touched in 72h + the sensitive core): 1 HIGH fixed** — `server/webhookHandlers.ts` could auto-ship a DFY order if the SKU was auto-ship-graduated and QA passed, bypassing the human review queue; `canAuto` is now hard-gated with `!isDfyManualOnly` (done-for-you = manual-only, always); fix-pass confirmed closed, no new CRITICAL/HIGH. **1 MEDIUM fixed** — `generate_audit_fix_kit` had no explicit TOOL_POLICIES row (permissive fallback); now sensitive/MEDIUM/structured-args/trustedPersonasOnly. Known gap (deferred, documented): end-to-end webhook harness for the DFY fix-kit path. Gates: tsc 0, suite 155/155, seamtests 69/69, wiring audit CLEAN — 408 tools, 0 dead/drift/leaks."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_137_94") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **44 (.agents) + 62 (db) + 38 (output-skills) = 144 reference surfaces**, **16 personas**, **225 tables**, **663 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+137.94 lands the AI Fix Kit for the done-for-you audit tier and closes 1 HIGH (DFY orders hard manual-only) in a 72h full-platform sweep. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_137_94") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+137.93 (2026-07-26) — DEMOTED (indigo): release window R125+137.89+sec → +137.93 — nightly-audit FP wave 2 (77/77 FALSE POSITIVE); SEED behavior-shift pre-jury filter; gstack review-rubric borrow; Google Vertex AI express provider lane; 72h full-platform sweep closing 1 HIGH — cost-tracking wrapper mutated the shared cached client (N-fold ledger recording + tenant attribution race) → request-local Proxy facade. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_137_93")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-indigo-500/15 via-primary/5 to-transparent border border-indigo-500/40 hover:border-indigo-500/60 hover:bg-indigo-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_137_93"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-indigo-600 text-white leading-none shrink-0 mt-0.5">R125+137.93</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_137_93") ? "" : "line-clamp-2"}`}>{"R125+137.93 — **Release window R125+137.89+sec → +137.93: the AI-spend meter is hardened against multi-counting, a Google Vertex AI express provider lane goes live, the nightly audit's 77 kept severe findings all verdict FALSE POSITIVE, and the skill optimizer gains a behavior-shift pre-jury filter.** **.89+sec — nightly-audit FP wave 2:** the 2026-07-25 nightly tenant-isolation audit kept 77 CRITICAL/HIGH findings — all 77 verdicted FALSE POSITIVE by 8 parallel read-only subagent passes (no code change required); plus a CI docs fix. **.90 — SEED behavior-shift pre-jury filter (arXiv:2607.14777 borrow):** `server/lib/behavior-shift.ts` replays ≤4 eval cases with seed-vs-candidate doc between the strict-improvement gate and the 3-LLM jury in the nightly skill optimizer; behaviorally-inert candidates (0 shifted of ≥2 clean probes, word-Jaccard ≥0.88) are culled before the paid jury call — quality filter, fails OPEN everywhere, can only SKIP a jury call, never force an apply; kill switch `SKILL_OPT_SHIFT=off`; 15 hermetic tests. **.91 — gstack review-rubric borrow (MIT):** 6 portable rubric items folded into the post-edit-code-review skill — scope-drift check, enum/value-completeness grep, QUOTE-OR-DOWNGRADE finding hygiene, and a UI-change design addendum; doc-only. **.92 — Google Vertex AI express lane:** a new Gemini provider lane in getClientForModel — x-goog-api-key auth with the SDK Bearer header stripped, OpenAI-compat aiplatform endpoint, google/-prefixed model ids, bare-id cost tracking; sits after tenant/DB/env google keys, before the metered integration fallback; the $0 cost-safety policy untouched; verified live end-to-end. **.93 — 72h full-platform sweep (3 parallel architect passes + wiring audit CLEAN): 1 HIGH fixed** — `wrapClientWithCostTracking` mutated the shared cached SDK client per request, so stacked wrappers recorded ONE API call N times in the cost ledger (probe: 3 inserts after 3 wraps) and raced tenant billing attribution; rewritten as a request-local Proxy facade (probe after: exactly 1 insert/call, per-facade tenant closures); second architect pass on the fix PASS. Gates: tsc 0, suite 153/153, wiring audit CLEAN."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_137_93") ? "" : "truncate"}`}>{"**407 tools**, **131 capabilities**, **44 (.agents) + 62 (db) + 38 (output-skills) = 144 reference surfaces**, **16 personas**, **225 tables**, **663 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+137.89+sec → +137.93 land the Vertex AI express lane + behavior-shift pre-jury filter and close 1 HIGH (N-fold cost-ledger recording) in a 72h full-platform sweep; 77/77 nightly findings FALSE POSITIVE. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_137_93") ? "rotate-180" : ""}`} />
        </button>

        <HomeReleaseArchive releaseExpanded={releaseExpanded} toggleRelease={toggleRelease} />
        </>)}

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
