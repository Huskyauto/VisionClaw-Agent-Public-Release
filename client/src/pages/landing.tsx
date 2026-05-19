import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { SeoHead } from "@/components/seo-head";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSiteConfig } from "@/hooks/use-site-config";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import {
  Bot, Crown, Wrench, PenTool, Shield, Search, BarChart3,
  Brain, Mic, CreditCard, Activity, Users, Zap,
  MessageSquare, Database, ArrowRight, Check, Cpu,
  Clock, Globe, Layers, DollarSign, TrendingUp,
  CheckCircle2, ArrowRightLeft, Sparkles, Key, Scale, Gavel,
  Image, Share2, FileText, Code, Mail, Workflow,
  Eye, Palette, ShieldCheck, Target, Rocket, ChevronRight,
  Monitor, Smartphone, HeadphonesIcon, BookOpen, Lightbulb,
  Terminal, Briefcase, HelpCircle, ChevronDown, Phone, Network,
  FileCode, GitBranch, RotateCcw, Gauge, ShieldAlert, Lock,
} from "lucide-react";
const vcLogoPath = "/visionclaw-logo-full.jpg";


// R98.21 — Hyperagent recipe gallery. Pulls live cost+duration estimates from
// the canonical DELIVERABLE_PIPELINES so the landing page never drifts from the
// estimates Felix actually quotes the customer.
type Recipe = {
  id: string;
  label: string;
  format: string;
  prompt: string;
  tagline: string;
  description: string;
  estimate: string;
  durationMinutes: { low: number; median: number; high: number };
  costUsd: { low: number; median: number; high: number };
  passingGradeBar: number;
};

function RecipeGallery() {
  const [, navigate] = useLocation();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, isLoading } = useQuery<{ recipes: Recipe[] }>({
    queryKey: ["/api/public/recipes"],
  });
  const recipes = data?.recipes || [];

  const handleRun = (r: Recipe) => {
    try {
      sessionStorage.setItem("vc.prefilledPrompt", r.prompt);
    } catch { /* no-op */ }
    navigate("/chat");
  };

  return (
    <section id="section-recipes" className="py-20 px-6 border-t border-border" data-testid="section-recipes">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-4">Try it · No setup</Badge>
          <h2 className="text-3xl font-bold mb-3">One-Click Recipes</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Real, cost-quoted deliverables Felix can run end-to-end. Every recipe shows the
            up-front time and cost band — no surprises.
          </p>
        </div>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="recipes-loading">
            {[1, 2, 3, 4, 5].map((i) => (
              <Card key={i} className="border-border/60 animate-pulse h-44" />
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recipes.map((r) => {
              const expanded = expandedId === r.id;
              return (
                <Card
                  key={r.id}
                  className="border-border/60 hover-elevate active-elevate-2 transition-shadow"
                  data-testid={`card-recipe-${r.id}`}
                >
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-base font-semibold leading-snug" data-testid={`text-recipe-label-${r.id}`}>
                        {r.label}
                      </h3>
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide shrink-0">
                        {r.format}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground" data-testid={`text-recipe-tagline-${r.id}`}>
                      {r.tagline}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground border-t border-border/40 pt-3">
                      <div className="flex items-center gap-1" data-testid={`text-recipe-estimate-${r.id}`}>
                        <Clock className="w-3.5 h-3.5" />
                        <span>{r.estimate || "instant"}</span>
                      </div>
                      <div className="flex items-center gap-1 ml-auto">
                        <Gauge className="w-3.5 h-3.5" />
                        <span>{r.passingGradeBar > 0 ? `≥${r.passingGradeBar}/100 graded` : "no grading"}</span>
                      </div>
                    </div>
                    {expanded && (
                      <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground border border-border/40" data-testid={`text-recipe-prompt-${r.id}`}>
                        <div className="font-medium text-foreground mb-1">Prompt sent to Felix:</div>
                        {r.prompt}
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setExpandedId(expanded ? null : r.id)}
                        data-testid={`button-recipe-expand-${r.id}`}
                      >
                        {expanded ? "Hide" : "Show prompt"}
                      </Button>
                      <Button
                        size="sm"
                        className="ml-auto"
                        onClick={() => handleRun(r)}
                        data-testid={`button-recipe-run-${r.id}`}
                      >
                        Run this <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

function useCountUp(end: number, duration: number = 2000, trigger: boolean = true) {
  const [count, setCount] = useState(0);
  const rafRef = useRef<number>(0);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (!trigger || end === 0) return;
    if (reduced) { setCount(end); return; }
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * end));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [end, duration, trigger, reduced]);
  return count;
}

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function TypewriterHero() {
  const PHRASES = [
    "builds financial models in Excel",
    "creates styled PDF reports",
    "drafts contracts in Word",
    "designs 17-layout slide decks",
    "researches competitors overnight",
    "evolves its own capabilities",
    "delegates across 16 specialists",
    "generates AI images & parallel video",
    "manages email, Slack, X/Twitter",
    "learns from every interaction",
    "runs multi-agent crews on demand",
    "tracks invoices, KPIs & cash flow",
    "audits compliance across 9 frameworks",
    "orchestrates sequential flow pipelines",
    "completes deliverables in one ask",
    "captures skills from every success",
    "shows live agent status on the board",
    "runs structured ideation with 6 frameworks",
    "halts execution on systemic errors automatically",
    "scans platform security against OWASP standards",
    "renders premium product photos with gpt-image-2",
    "signs every customer download with HMAC URLs",
    "ranks 359 tools by per-tenant performance",
    "writes in your brand voice with build_voice_profile + score_post (R79 MarTech)",
    "drafts hooks across 6 angles and post formats (PAS/AIDA/STAR/4Ps) for any platform",
    "audits its own reasoning chains for causal validity (KisMATH R77.5)",
    "deterministically re-executes math chains for finance work",
    "isolates every tenant — no cross-account leakage",
    "summarizes memory clusters via Louvain communities (R75)",
    "answers why-questions with extracted causal chains (R75)",
    "scores every memory by PageRank importance (R75)",
  ];
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const phrase = PHRASES[phraseIdx];
    if (!deleting && charIdx < phrase.length) {
      const t = setTimeout(() => setCharIdx(c => c + 1), 45 + Math.random() * 25);
      return () => clearTimeout(t);
    }
    if (!deleting && charIdx === phrase.length) {
      const t = setTimeout(() => setDeleting(true), 2200);
      return () => clearTimeout(t);
    }
    if (deleting && charIdx > 0) {
      const t = setTimeout(() => setCharIdx(c => c - 1), 22);
      return () => clearTimeout(t);
    }
    if (deleting && charIdx === 0) {
      setDeleting(false);
      setPhraseIdx(i => (i + 1) % PHRASES.length);
    }
  }, [charIdx, deleting, phraseIdx, reduced]);

  if (reduced) {
    return <span className="text-primary">{PHRASES[0]}</span>;
  }

  return (
    <span className="text-primary">
      {PHRASES[phraseIdx].slice(0, charIdx)}
      <span className="inline-block w-[3px] h-[1em] bg-primary ml-0.5 animate-pulse align-text-bottom" />
    </span>
  );
}

function RevealOnScroll({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useInView(0.1);
  const reduced = usePrefersReducedMotion();
  const show = reduced || visible;
  return (
    <div
      ref={ref}
      className={`transition-all ${reduced ? "duration-0" : "duration-700"} ${show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} ${className}`}
      style={reduced ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

const PERSONA_LIST = [
  { name: "VisionClaw", role: "Personal AI Assistant", icon: Bot, description: "Your always-on personal assistant. Handles any task, remembers everything, and knows when to call in specialists." },
  { name: "Felix", role: "CEO & Orchestrator", icon: Crown, description: "Decomposes complex requests, delegates to specialists, and delivers results in any format — PDF reports, Word docs, Excel models, slide decks." },
  { name: "Forge", role: "CTO & Staff Engineer", icon: Wrench, description: "Writes code, deploys integrations, debugs systems, reviews architecture, and builds technical solutions on demand." },
  { name: "Teagan", role: "CMO & Content Marketing", icon: PenTool, description: "Plans campaigns, creates email sequences, generates AI images, and drives marketing strategy across channels." },
  { name: "Blueprint", role: "VP Engineering", icon: Workflow, description: "Designs system architecture, plans engineering workflows, and manages multi-agent technical projects." },
  { name: "Chief of Staff", role: "Operations Director", icon: Crown, description: "Optimizes workflows, balances agent workloads, and ensures the entire corporate team runs smoothly." },
  { name: "Scribe", role: "Content Director", icon: PenTool, description: "Writes blog posts, newsletters, documentation, reports, presentations, and any long-form content." },
  { name: "Proof", role: "QA Director", icon: Shield, description: "Automatically reviews every deliverable for quality, accuracy, and completeness. Scores outputs on a 10-point scale." },
  { name: "Radar", role: "Intelligence Analyst", icon: Search, description: "Monitors competitors, scans for market opportunities, and delivers real-time intelligence briefings." },
  { name: "Neptune", role: "Deep Research Specialist", icon: Globe, description: "Deep research specialist for complex multi-source investigations, wellness guidance, companion messaging, and structured analysis." },
  { name: "Apollo", role: "Strategy & Revenue", icon: BarChart3, description: "Business strategy, revenue optimization, pricing analysis, and financial pipeline management." },
  { name: "Atlas", role: "Finance & Analytics", icon: Activity, description: "Financial analysis, KPI dashboards, trend analysis, and data-driven business recommendations." },
  { name: "Cassandra", role: "Risk & Forecasting", icon: Scale, description: "Risk assessment, financial modeling, predictive analytics, and budget governance." },
  { name: "Luna", role: "Legal & Compliance", icon: Gavel, description: "Contract safety scoring (0-100), regulatory compliance audits (9 frameworks), legal document generation (12 templates), and governance framework management." },
  { name: "Robert", role: "Late-Night Companion", icon: Bot, description: "Always-on conversational companion with a softer voice profile — for casual chat, late-night sessions, journaling, and emotional check-ins. Tenant-isolated, fully memory-aware." },
  { name: "Wellness Coach", role: "wellness & Health Coach", icon: Activity, description: "wellness journey companion — wellness-program/Wegovy/Ozempic education, side-effect triage protocols, food/protein logging, weekly weigh-in tracking, and motivational accountability messaging." },
];

const CAPABILITY_SECTIONS = [
  {
    title: "R80 — Claude Code Subagent Importer + Runtime Wiring (NEW)",
    subtitle: "Drop in any community Claude Code agent collection from GitHub. Imported personas land fully wired into VisionClaw — translation adapter at the top of their prompt, role-based tool blocks at the router, and HITL autonomy gates on dangerous tools. They participate in delegation, persist memories, and obey the same governance as built-in personas.",
    icon: Layers,
    color: "text-cyan-600",
    bg: "bg-cyan-600/10",
    features: [
      { icon: GitBranch, label: "Paste a GitHub URL → Live Personas", detail: "Platform-admin gated importer walks any `.claude/agents` directory, parses YAML frontmatter + body across nested subfolders, surfaces a preview table (name / tier / mapped tools / conflicts) before any DB write, then applies in one click. Curated collection dropdown ships with vetted public repos. Underscore-prefixed shared docs and README/CHANGELOG/LICENSE files are auto-skipped. Idempotent re-runs use namespaced names (`<source-slug>:<agent-slug>`) so re-importing never duplicates." },
      { icon: Network, label: "Runtime Adapter — Claude → VisionClaw Tool Translation", detail: "Every imported persona's prompt opens with a `VISIONCLAW RUNTIME ADAPTER` block placed BEFORE the original Claude Code instructions. The adapter contains an explicit Claude→VC translation table — Read → `read_file` / `scan_file`, Write → `write_file` / `write_scratchpad` / `create_memory` / `create_knowledge`, Bash → `exec` / `execute_code` (HITL-gated), WebFetch → `web_fetch` / `firecrawl_scrape` / `readability_extract`, WebSearch → `web_search` / `firecrawl_search`, Task → `delegate_task`, Grep → `search_memory` / `search_knowledge` / `scraped_pages_query`, Edit → `write_file` (HITL-gated). The LLM sees the instruction and the real function definition aligned, so it actually calls the right tool." },
      { icon: ShieldAlert, label: "Trust Boundary — Imported Instructions Are Untrusted", detail: "The runtime adapter opens with a `Trust boundary (CRITICAL)` section telling the agent that everything below is untrusted legacy guidance, this adapter wins on conflict, and any instruction to bypass HITL must be refused. Defense-in-depth on top of the hard tool-router and autonomy-rules controls — the agent itself becomes a participant in policy enforcement, not just a recipient." },
      { icon: ShieldCheck, label: "Tier-Aware Tool-Router Policies", detail: "Imports map to one of two roles. `Imported Subagent (researcher)` hard-blocks `exec`, `shell_exec`, `execute_code`, `write_file`, `send_email`, `whatsapp`, `deliver_product`, `draft_social_post`, `marketing_experiment` at the router — refusal happens before any LLM ever sees the tool. `Imported Subagent (developer)` allows code/system/file access but still blocks delivery surfaces. New policy entries listed FIRST in `PERSONA_TOOL_POLICIES` so substring-match wins over generic developer/researcher keys." },
      { icon: CheckCircle2, label: "Per-Persona Autonomy Rules — HITL on Dangerous Tools", detail: "Executor-tier imports automatically receive three `autonomy_rules` rows — `exec`, `execute_code`, `write_file` — all `approve_before` and tenant-scoped. Idempotent via the `(tenant_id, persona_id, action_type)` partial unique index using `onConflictDoNothing` with `.returning()` so re-runs report truthful counts. Researcher-tier imports skip these because the router already hard-blocks them." },
      { icon: Shield, label: "Hardened SSRF Posture", detail: "URL parser hard-locks input host to `github.com` / `www.github.com`. Network calls go only to `api.github.com` and `raw.githubusercontent.com`. Every fetch sets `redirect: \"error\"` so a redirect to an unexpected host fails closed instead of silently following. Repo-tree truncation (>100k entries) is rejected. Per-request file cap prevents resource exhaustion. Errors flow back to admin only — no server-internal paths or secrets in the response." },
      { icon: Bot, label: "Genuine Ecosystem Membership", detail: "Imported personas show up in `/api/personas`, can be set as a conversation persona via the AI Team page, can be `delegate_task`'d to by Felix and other built-ins, and their findings persist via `create_memory` / `create_knowledge`. They run the standard 7-step VisionClaw operating loop (recall context, plan, verbalize destructive ops, persist findings) — not a bolted-on shim, full first-class citizens." },
    ],
  },
  {
    title: "R79 MarTech Bundle — Brand-Voice & Social Content",
    subtitle: "Six per-tenant content tools that learn your voice, draft hooks across 6 angles, format posts in PAS / AIDA / STAR / 4Ps, plan a full content matrix, and score every post against your own brand",
    icon: Sparkles,
    color: "text-pink-500",
    bg: "bg-pink-500/10",
    features: [
      { icon: Brain, label: "Build Voice Profile", detail: "`build_voice_profile` synthesizes about-me + voice rules + topic pillars + audience from interview answers and 1–10 raw writing samples. Stored per-tenant with version bumping on rebuild — your AI keeps writing more like you over time, not less." },
      { icon: Wrench, label: "Hook Generator (6 Angles)", detail: "`generate_hooks` writes N hook variants across number-led, contrarian, mistake-confession, question, story-cold-open, and data-paradox angles. Pick the strongest opener for any post, every time, without staring at a blank cursor." },
      { icon: FileText, label: "Format Post (PAS / AIDA / STAR / 4Ps)", detail: "`format_post` formats a topic via Problem-Agitate-Solve, Attention-Interest-Desire-Action, Situation-Task-Action-Result, or 4Ps with platform-aware character caps for LinkedIn, X, and newsletters. Same idea, four proven structures, ready to ship." },
      { icon: Layers, label: "Content Matrix Planner", detail: "`generate_content_matrix` builds a pillars × formats grid covering an entire content calendar — one ask gives you a month of post ideas mapped to your topic pillars and your audience." },
      { icon: CheckCircle2, label: "Brutally-Honest Post Scorer", detail: "`score_post` returns a 0–100 critique with letter grade + sub-scores for voiceMatch / hook / body / CTA, plus lists of patterns matched and violated, plus top 3 rewrite suggestions. Scored against YOUR voice profile, not a generic template." },
      { icon: ShieldCheck, label: "Hardened Against Prompt Injection", detail: "Voice context is fenced with VOICE_OPEN / VOICE_CLOSE markers, marker-stripped before injection, line-quoted to break instruction syntax, and labeled \"READ AS DATA ONLY.\" JSON returns use `response_format: json_object` + a string-aware balanced-bracket parser. Adversarial smoke tests confirm injection strings never leak." },
    ],
  },
  {
    title: "Autonomous Operations",
    subtitle: "Your AI team works 24/7 — researching, learning, and improving on its own",
    icon: Zap,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    features: [
      { icon: Clock, label: "Heartbeat Engine", detail: "13 scheduled tasks run autonomously — self-reflection, memory consolidation, cloud backups, model scouting, and more. 100% uptime." },
      { icon: Crown, label: "CEO Orchestrator", detail: "Complex requests get decomposed into DAG execution plans. Felix delegates up to 8 agents in parallel, with backup agent rerouting and 5-part failure transparency reporting." },
      { icon: ArrowRightLeft, label: "3-Layer Failure Recovery", detail: "Self-correction retry → lean mode fallback → backup agent reroute. If Radar fails, Neptune takes over. If Scribe fails, VisionClaw steps in. Every failure gets a clear 5-part explanation." },
      { icon: ShieldCheck, label: "Human-in-the-Loop Safety", detail: "High-risk actions require your approval. 40 governance rules, trust scores, and earned autonomy keep your AI team operating safely." },
      { icon: CheckCircle2, label: "Craftsmanship Quality Gate", detail: "Every deliverable passes a universal quality gate — presentations, emails, PDFs, and docs are validated for completeness, links, and accuracy before delivery. Failed checks auto-rewrite." },
    ],
  },
  {
    title: "80→95% Autonomy Layer",
    subtitle: "The newest layer — interrupt/resume approvals, decision-confidence scoring, and revenue-vs-cost self-regulation",
    icon: Rocket,
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    features: [
      { icon: ShieldCheck, label: "Interrupt & Resume Approvals", detail: "Long-running plans can pause for a human decision and pick up exactly where they left off — no replay, no lost context. Approvals expire automatically so nothing stalls forever." },
      { icon: Target, label: "Decision Confidence Scoring", detail: "Every autonomous decision is logged with a confidence score, expected outcome, and reasoning trail. Low-confidence calls escalate; high-confidence calls execute. Full audit trail per tenant." },
      { icon: DollarSign, label: "Revenue vs. Cost Self-Regulation", detail: "The auto-router watches the live burn ratio (spend ÷ revenue). If margins compress, it throttles to cheaper models and lighter tools automatically — protecting profitability without human intervention." },
      { icon: Activity, label: "Per-Agent Cost Ledger", detail: "Every tool call, model call, and orchestration is recorded against the responsible agent. Real-time `agent_cost_summary` shows who's expensive, who's efficient, and where the spend is going." },
      { icon: Shield, label: "Hardened Webhook Security", detail: "Coinbase Commerce webhooks now hard-reject unsigned requests — no payment spoofing. JSONB-concat merges in run-state updates eliminate lost-update race conditions under parallel writes." },
      { icon: CheckCircle2, label: "Strict Tool-Alias Allowlist", detail: "Fuzzy substring tool matching replaced with an explicit alias allowlist. Agents can only invoke tools by exact name or pre-approved alias — no accidental tool misfires." },
    ],
  },
  {
    title: "Self-Improving Codebase — Verifier-Gated Code Proposals",
    subtitle: "Nightly research generates real code edits, a shadow verifier compiles them in an isolated git worktree, and only verified changes are eligible to apply",
    icon: FileCode,
    color: "text-amber-600",
    bg: "bg-amber-600/10",
    features: [
      { icon: GitBranch, label: "Shadow-Verified in a Git Worktree", detail: "Every proposed code edit is applied to a throwaway git worktree, type-checked with `tsc --noEmit`, and either marked `verification_status='passed'` or rejected — without touching the live codebase. Failed verifications never reach a human reviewer." },
      { icon: ShieldCheck, label: "Strict Apply Gate", detail: "The Apply button is locked unless the proposal carries `status='approved'` AND `verification_status='passed'`. A four-stage governance flow (pending → approved → applied) is enforced server-side — UI lockouts cannot be bypassed by direct API calls." },
      { icon: Gauge, label: "Numeric Metrics + Baseline Δ%", detail: "Each research experiment now records a numeric metric (cost, latency, judge score) plus a percentage delta vs. baseline. The /research dashboard renders ±% badges so improvements and regressions are obvious at a glance." },
      { icon: RotateCcw, label: "One-Click Revert from Snapshot", detail: "Every applied proposal saves a pre-change snapshot. If something breaks downstream, an admin reverts from the /code-proposals page and the original file is restored byte-for-byte." },
    ],
  },
  {
    title: "Mixture of Agents (MoA) — Ensemble Reasoning",
    subtitle: "Hard problems get answered by a panel — 4 frontier models propose in parallel, a Claude Opus aggregator synthesizes the best answer",
    icon: Users,
    color: "text-purple-600",
    bg: "bg-purple-600/10",
    features: [
      { icon: Workflow, label: "4 Parallel Proposers", detail: "Claude Sonnet, GPT-4.1, Gemini 2.5 Pro, and DeepSeek Reasoner each draft a candidate answer simultaneously. Different reasoning styles, different blind spots — together they cover ground no single model can." },
      { icon: Crown, label: "Opus Aggregator", detail: "Claude Opus reads all 4 candidates (wrapped in injection-safe `<candidate_N>` tags) and synthesizes a single best answer — keeping correct facts, resolving disagreements, and discarding hallucinations." },
      { icon: ShieldCheck, label: "Hardened Against Failure", detail: "Per-tenant rate limit, prompt-injection isolation between candidates, graceful single-proposer fallback if the aggregator fails, and retry-storm protection on schema setup." },
      { icon: DollarSign, label: "Cost-Ledger Visible", detail: "Every proposer call and aggregator call records its own cost entry against the responsible agent. The auto-router's revenue-vs-cost throttle sees ensemble spend in real time and can downgrade automatically if margins compress." },
    ],
  },
  {
    title: "Proactive Self-Healing Engine",
    subtitle: "The agentic loop closes itself — low-risk insights auto-apply, HIGH-priority items draft a Minerva plan, dead-lettered tasks self-remediate, and Felix only sees what truly needs human judgment",
    icon: Sparkles,
    color: "text-violet-600",
    bg: "bg-violet-600/10",
    features: [
      { icon: Zap, label: "Auto-Apply Pipeline (R63)", detail: "Eight low-risk insight categories — agent_optimization, cost_reduction, resource_allocation, resource_optimization, scheduling_optimization, workflow_automation, email_optimization, social_optimization — auto-apply on every engine run with a descriptive `action_taken` audit trail. Strategic categories (marketing_strategy, growth_opportunity, risk_alert, market_trend, competitive_insight) stay manual on purpose." },
      { icon: Workflow, label: "Auto-Routing to Minerva", detail: "When a HIGH-priority insight auto-applies, the engine immediately drafts a strategic plan in Minerva's queue (`source='agentic-engine.auto-apply'`), emits `plan.proposed`, and lands the plan in Felix's approval queue. The card UI shows 'Auto-applied + drafted Minerva plan #N' so the chain of custody is visible end-to-end." },
      { icon: ShieldCheck, label: "Self-Healing Dead-Letter", detail: "When a scheduled task hits 5 consecutive failures, the heartbeat dead-letters it AND auto-creates a HIGH-priority `workflow_automation` insight + Minerva plan proposing a fix. Tasks no longer rot silently — every dead-letter becomes a remediation proposal in Felix's queue within seconds." },
      { icon: CheckCircle2, label: "Idempotent Felix Queue", detail: "Plan creation is guarded by a `(source, source_ref)` idempotency check before insert, so retries and re-runs cannot spam Felix's queue with duplicates. A periodic durability sweep (boot+30s, then every 10 min) retries any insights stuck in the `PENDING_PLAN_MARKER` state, so transient routing failures heal themselves." },
      { icon: Activity, label: "Hardened Heartbeat (R63)", detail: "Heavy engines (Decision Analysis, Process Optimization, Code-Health Scan, Model-Scout) raised to a 600-second budget with the inner failover cap propagated through. Cloud Backup fails fast on Drive auth hangs (30s ceiling). Dream Memory Consolidation skip path now returns `skipped: ...` so it stops looking like a recurring failure." },
    ],
  },
  {
    title: "Treasury & Market Intelligence",
    subtitle: "On-demand ticker forecasts and portfolio analysis — structural insight, never personalized buy/sell advice",
    icon: TrendingUp,
    color: "text-emerald-600",
    bg: "bg-emerald-600/10",
    features: [
      { icon: Activity, label: "Ticker Forecasts", detail: "Pull live OHLC daily bars (free Stooq data, 5-min cached), compute SMA20 / SMA50 / annualized volatility, and have an LLM analyst produce a strict-JSON directional view (bullish/bearish/neutral) with confidence and reasoning." },
      { icon: BarChart3, label: "Portfolio Analyzer", detail: "Paste up to 50 holdings (SYMBOL,SHARES per line); platform live-prices each position, computes total value, HHI diversification score, and concentration risk — then returns 3-5 structural recommendations focused on rebalancing and sector exposure." },
      { icon: ShieldCheck, label: "Compliance-First Persona", detail: "Cassandra (Risk & Forecasting) is hard-blocked from giving personalized buy/sell advice. The /treasury page shows an explicit 'educational analysis only' disclaimer, and the persona is denied destructive financial tools at the router level." },
      { icon: Mic, label: "Voice-Safe Ticker Lookup", detail: "`forecast_ticker` is on the Glasses Gateway voice-safe allowlist (20 of 359 tools) — ask 'what's AAPL doing?' through your Ray-Ban and hear the directional analysis hands-free." },
    ],
  },
  {
    title: "Unified Tool Governance",
    subtitle: "Every tool call across every entry point flows through one guarded executor — rate-limited, persona-checked, cost-tracked",
    icon: Shield,
    color: "text-slate-700",
    bg: "bg-slate-700/10",
    features: [
      { icon: Network, label: "Single Choke Point", detail: "Main chat, public chat, the chat-engine inner loop, the glasses gateway, and the self-heal auto-fixer all execute tools through one `executeGuardedTool()` function. No bypass paths, no 'forgot to add the rate limit here' regressions." },
      { icon: DollarSign, label: "Strict Cost Tagging", detail: "Every tool call writes a cost-ledger entry tagged with its origin (`main_chat`, `public_chat`, `glasses_gateway`, `self_heal`, `chat_engine`, `treasury_route`, `system`). Per-tenant spend visibility is exact, not approximate." },
      { icon: Key, label: "Tenant Fallback Lockdown", detail: "Missing tenant context now hard-rejects tool execution unless the invoker explicitly opts in (system tasks, self-heal, anonymous public chat). No more silent admin-tenant billing for buggy auth paths." },
      { icon: CheckCircle2, label: "Boot-Time Drift Detection", detail: "Startup audits the tool registry against the rate-limiter's expensive-tool list. If any `very_slow` tool falls through to default limits, you see it in the boot log — drift surfaces immediately, not in production." },
    ],
  },
  {
    title: "Glasses Gateway — Meta Ray-Ban + Gemini Live",
    subtitle: "Wear your AI corporation. Smart glasses stream live video and audio to a dedicated gateway with sub-second voice replies",
    icon: Eye,
    color: "text-indigo-600",
    bg: "bg-indigo-600/10",
    features: [
      { icon: Eye, label: "Live Vision Streaming", detail: "Meta Ray-Ban glasses stream point-of-view video frames over a tenant-isolated gateway. Felix and the specialist agents see what you see — read signs, identify products, analyze environments in real time." },
      { icon: Mic, label: "Sub-Second Voice Replies", detail: "Gemini Live handles bidirectional audio with conversational latency. Ask a question while walking; get an answer before you finish the next step. Full conversation history persists into your tenant memory." },
      { icon: Key, label: "Per-Tenant Glasses Keys", detail: "Each pair of glasses authenticates with its own scoped key (`vc_glasses_*`). Gateway enforces tenant isolation, rate limits, and revocation — no cross-tenant data leakage even on shared hardware." },
      { icon: Smartphone, label: "Hands-Free Workflow", detail: "Trigger any of the 359 tools by voice: 'log this expense', 'add to project notes', 'remind me at 3pm'. The glasses become a thin client to your full AI corporation." },
    ],
  },
  {
    title: "Per-Tenant Personalization",
    subtitle: "Every tenant gets a customized AI corporation — personal context, disabled-skill controls, and self-recovering conversations",
    icon: Brain,
    color: "text-fuchsia-600",
    bg: "bg-fuchsia-600/10",
    features: [
      { icon: BookOpen, label: "User Profile Notes", detail: "Each tenant maintains a `userNotesMarkdown` doc that auto-injects into every conversation under '## CURRENT USER'. Bob's preferences, Sarah's project context, and your team's terminology — the AI knows your world without re-prompting." },
      { icon: ShieldCheck, label: "Trust-Tier Policy Engine (R76)", detail: "Per-tenant `tool_policies` table — write rules like \"allow send_email when recipient matches *@example.com\", \"deny crypto_withdraw above $500\", \"require approval for any new GitHub push\". Specificity-ranked matching (recipient_pattern > tool_action > tool; deny beats allow in the top tier; amount-cap bypasses force require_approval). 7 owner defaults seeded; full audit log in `policy_audit`. NEVER_AUTO_APPROVE veto on `set_policy`/`create_tool`/`delete_custom_tool`/`manage_skills`/`lobster` — even a self-issued allow rule cannot bypass HITL on these meta-tools." },
      { icon: ShieldCheck, label: "Per-Tenant Skill Disable", detail: "Don't want WhatsApp tools loaded for your tenant? Add the skill name to `disabledSkillNames` and it disappears from the agent's toolbox — without touching the global skill library or affecting other tenants." },
      { icon: CheckCircle2, label: "Deliverable Contract Verification (R76)", detail: "Before any persona is allowed to claim a customer-facing deliverable is COMPLETE — HTML page, PDF, slide deck, video, audio, image, CSV, or JSON file — the supervisor calls `verify_deliverable` against an 8-contract registry (extension allowlist + magic-byte MIME sniff for pdf/png/jpg/gif/webp/mp4 + render check: HTML must contain `<html>`/doctype, JSON must parse, PDF must start with `%PDF`). Failed verification injects `DELIVERABLE_VERIFICATION_FAILED` into the supervisor's correction loop and the persona must re-render. Live Felix HVAC run on first deployment caught a real PDF-vs-HTML hallucination. Doctrine #12 carried by all 16 personas." },
      { icon: Sparkles, label: "Tool Sommelier + Self-Correcting Loop (R74.13z-quint+3)", detail: "An async curator boots 5 minutes after server start, runs every 24h, reads each tenant's tool-usage telemetry + dormant-tool list, calls gpt-5-mini, and writes up to 5 short ADR playbooks per cycle (\"when X, use Y because Z\") that auto-inject into every persona's system prompt. A flounder detector then files a tension whenever a response promises action without using a single tool — closing the loop so tomorrow's playbook covers what today's missed. Built on the new tensions + ADRs + graph-explorer primitives shipped in R74.13z-quint+2. Plus R74.13z-quat 1M-context auto-escalation chain (Gemini 3.1 Pro → Claude Opus 4.7 → Nemotron 3 Super → Grok 4.1 Fast)." },
      { icon: Database, label: "Dream Diary per Tenant", detail: "REM-phase narrative summaries are stored per tenant as `dream_diary` memory entries. Each tenant's AI has its own emerging themes, recurring priorities, and journaled reflections — visible on demand." },
    ],
  },
  {
    title: "Document & Media Production",
    subtitle: "Professional documents, cinematic videos, and AI-generated media — auto-delivered to Google Drive",
    icon: FileText,
    color: "text-indigo-500",
    bg: "bg-indigo-500/10",
    features: [
      { icon: FileText, label: "Styled PDF Reports", detail: "Executive cover pages with dark gradients, stats grids, branded section headers, data tables, highlight boxes, and two-column layouts. Fortune 500 quality." },
      { icon: BookOpen, label: "Word Documents", detail: "Professional .docx with styled headings, data tables, bullet lists, headers/footers with page numbers. Contracts, proposals, SOWs, memos." },
      { icon: BarChart3, label: "Excel Spreadsheets", detail: "Formatted .xlsx with formulas, auto-filters, frozen headers, alternating row colors, multi-sheet workbooks. Financial models, budgets, KPI trackers." },
      { icon: Monitor, label: "Slide Presentations", detail: "17 visual layouts including flowcharts, timelines, architecture diagrams, and metrics dashboards. 5 built-in themes. Native Google Slides with live TTS narration." },
      { icon: Eye, label: "Presentation Self-Correction", detail: "Vision-based QA scores every slide 1-10. If quality drops below 6, the system autonomously rebuilds — fixing layout, text overflow, and design issues without human intervention." },
      { icon: Mic, label: "Parallel MPEG Video Engine", detail: "Scene-based MP4 production: parallel chapter workers (up to 6 concurrent), each with own TTS + image pipeline. Ken Burns motion effects, crossfade transitions, background music mixing, auto-upload to Drive. 3-6x faster than sequential." },
      { icon: Image, label: "Multi-Tier Image Cascade (R64.D)", detail: "Three image providers in a smart cascade: Gemini 2.5 Flash Image (fast/cheap default, ~7s) → OpenAI gpt-image-2 (premium quality fallback, ~16s) → DALL-E 3 (final fallback). Callers can flip to high-quality mode for hero shots and product photography, or force a specific model for A/B testing. Cache namespaced per quality tier so fast and high never cross-pollute." },
    ],
  },
  {
    title: "Nightly Autoresearch",
    subtitle: "Your AI team researches while you sleep — and injects what it learns",
    icon: Search,
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
    features: [
      { icon: Globe, label: "11 Research Programs", detail: "Nightly programs covering AI models, security, competitive analysis, architecture, and your specific business domain." },
      { icon: Lightbulb, label: "Smart Keep/Discard Loop", detail: "Each session runs 5-15 experiments. Findings scoring 6+ auto-inject into the knowledge base with vector embeddings." },
      { icon: Brain, label: "Self-Improving Knowledge", detail: "Hundreds of experiments run, scores of findings kept, knowledge entries auto-created. Your AI gets smarter every night." },
      { icon: Target, label: "Cross-Persona Intelligence", detail: "Research findings route to the right specialist. Legal research goes to Luna, competitive intel goes to Radar — automatically." },
    ],
  },
  {
    title: "359 Enterprise AI Tools (R117.1+sec — Cross-Tenant file_storage Overwrite Hardened In server/pdf-create.ts: resolveTenantOrAdmin Helper + ADMIN_TENANT_ID Constant + Scoped SELECT/UPDATE/INSERT With tenantId Validation — Architect-Verified PASS, All ~30 Admin-Tier scripts/* Callers Default To Tenant 1 With Per-Call console.warn Audit Trail; R117 — Two NEW Token-Optimization Tools (read_output_blob + code_slice) On A Shared Symbol-Graph Layer With Token-Aware ReDoS Structural Scanner Rejecting Lookarounds, Backreferences, Nested-Quantifier Shapes, And Quantified-Group-With-Alternation; R116 — agentmemory Tier-A (R115.5+sec round 3 — Thorough 3-Pass Architect Review On The R113.5→R114 Ship Closed 1 HIGH (Legacy MCP `/api/mcp/sse` SSE Surface Gated Behind LEGACY_MCP_ENABLED=1, Default OFF — Scope-Restricted R113.7+sec `/mcp` Streamable HTTP Is The Supported Integration) + 1 MEDIUM (AEvo Forbidden-Pattern Catalog Hardened Against Confusable / Zero-Width / NFKC Bypasses Via `normalizeForPatternCheck` — Soft Hyphen, Fullwidth Latin, ZWSP All Fail-CLOSED) + 4 LOWs (`emptyBodySchema = z.object({}).strict()` Wired Across Procedure-Edits Apply, Council-Verdicts Request, Scheduled-Posts Delete, MCP-Keys Delete — Body-Smuggling Rejected At The Gate); 30/30 AEvo Invariants Pass With 3 New Unicode Regression Tests; SSRF Rebinding MEDIUM Deferred (Pre-Existing, Requires undici Dispatcher Refactor); R114 — AEvo Meta-Editing Of Procedure Context (Zhang et al., arXiv:2605.13821): HITL-Gated Meta-Agent Proposes Minimal Surgical Edits To `data/output-skills/` Playbooks Based On Accumulated Evidence (≥3 agent_trace_spans + delivery_verifications + grade_deliverable Rows), CAS sha256-Pinned, Rollback-Capable; Edit-Surface Allowlist Is HARDCODED Type-Level (targetKind='output_skill' ONLY — NOT .agents/skills/, NOT persona souls, NOT doctrine, NOT safety_profile, NOT TOOL_POLICIES); Forbidden-Pattern Catalog Validator Fails CLOSED (Frontmatter name: Change, safety_profile, intentGate, restrictedCategories, destructiveToolPolicy, refusalCopy, AHB Regression, .agents/skills/ Paths, TOOL_POLICIES Literal, Doctrine #N Markers, persona_soul); Tables 171→173→174 (R115.5 sprint_contracts) (procedure_edits + procedure_evolution_runs), Indexes 449→452, Governance 42→43, Capabilities 109→110 (aevo_meta_editing), Tools 347→357 (propose_procedure_edit, list_procedure_edits, approve_procedure_edit, reject_procedure_edit, apply_procedure_edit, rollback_procedure_edit); NEW `/procedure-edits` Admin UI; Persona Doctrine #13 Added — Every Persona Sees The Edit-Surface Allowlist + Forbidden-Pattern Catalog + Propose-Not-Apply Posture; R113.7+sec — MCP-Server Expose: VCA Now Speaks MCP To External Clients (Claude Desktop, Cursor, Custom Agents) Via Streamable HTTP At POST /mcp With Per-Request Transport + Per-Request McpServer Instance + Cleanup On res.close; NEW Table mcp_api_keys (tenantId notNull, sha256 key_hash, scopes text[], +2 Indexes); Curated 8-Tool MCP Surface (NO Money-Movement, NO Mass-Comms) — schedule_cross_platform_post, cancel_scheduled_post, list_scheduled_posts, get_scheduled_post, list_personas, lookup_output_skill, list_output_skills, get_platform_info; Architect Closed 1 HIGH (Scopes Stored But Never Enforced — Defined MCP_SCOPES Registry With scheduler:write / scheduler:read / catalog:read / * Wildcard + Fail-CLOSED hasScope Guard In Every Tool Handler) + 1 MEDIUM (/api/mcp-keys CRUD Accepted Bearer vc_* — New requireSessionAuth Helper Rejects vc_ With 403); R113.6 — Facebook Page Publisher + YouTube Video-Bridge Wired Natively, NO Third-Party Relay (Closed HIGH SSRF/Memory-Exhaustion: arrayBuffer Was Buffering Before 256MB Cap Check — Replaced With Streaming Content-Length Check + AbortController Cancel); R113.5 — Self-Hosted Multi-Platform Social-Post Scheduler Foundation; R112.18 — Tool Selection Discipline System: Three-Layer Belt+Suspenders Forces Every Agent To Consider The Best Tool BEFORE Acting Across The 342-Tool Inventory — LAYER 1 Top-Picks Header (passive, always-on; semanticRank + per-tenant performance, top 5 per turn, ~250 tokens, env-disable `TOOL_TOP_PICKS_DISABLE=1`); LAYER 2 NEW `recommend_best_tool` Tool (gated, active; <50ms embedding lookup, MANDATORY before 3+ step plans / paid APIs / irreversible writes / customer-facing deliverables); LAYER 3 Post-Call Validator (reactive, automatic; embedding-only re-rank after FIRST tool call, fires `★ TOOL SELECTION HINT ★` once per session if gap ≥0.08 cosine); tools 340→342, governance 40→41 (+1 Tool Selection Discipline System); R112.17 — Tier 1 Web-Access Bot-Wall Bypass via Apify `header-generator` Nugget (Bayesian-Network-Trained Realistic Browser Headers behind env flag `WEB_ACCESS_TIER1_REALISTIC_HEADERS`, default ON, three-layer fail-safe, defense-in-depth SSRF/prompt-injection preserved); R112.16 +sec — One-Shot Video Tool `build_video_from_brief` Collapses Felix's 6-Step Orchestration Into ONE Call (Plan + Finalize + Deliver Auto); R112.16 — Legacy-Path Delivery Gap Closure (start_video_job Dispatch Forwards autoFinalize/autoDeliver/customerName/customerEmail; Compiler-Enforced via Extended Types; NEW scripts/resend-delivery-email.ts Rescue with 60-Day Signed URLs + Four-Link Body); R112.16 +sec — Architect Re-Review Closed 1 HIGH (Rescue-Script Cross-Tenant Signing Footgun Hardened — Explicit TENANT_ID or metadata.tenantId Required, Owner-8 Fallback Requires ALLOW_DEFAULT_OWNER=1, NEW DRY_RUN=1 Mode) + 1 MEDIUM (start_video_job Schema Exposes New Flags with LEGACY Guidance to Prefer build_video_from_brief); R110.15 — Whole-App Architect Sweep + Self-Compacting replit.md (NEW `scripts/replit-md-compact.ts` runs every commit cycle, fail-OPEN, threshold-based — solves the recurring \"replit.md is getting large\" nag without manual intervention) + Executor Budget-Cap Hardened (Explicit tenantId Guard); R110.14 — Two Final Barry Zhang Nuggets: Per-Loop USD Budget Cap + Trajectory-Based Golden-Path Eval (warn-only week 1); R110.13 — Barry Zhang Anthropic \"Building Effective Agents\" Seminar Audit, 5 Actionable Gaps Closed (Wall-Clock Circuit Breaker, Consecutive-Failure Circuit Breaker, Tool-Design Hygiene Linter, Per-Persona Tool Sprawl Audit, NEW `scripts/agent-perspective.ts` Trace-Tree Printer); R110.12 — IJFW Nuggets: NEW `critique` Skill (#24, Structured Steelman→Counter-Args), Stale-String Preflight Gate, Weekly-Maintenance Pass 9, Three Workflow Rules (2-Failed-Corrections-Stop, AskUserQuestion Score Rule, session_plan Format); R110.11.5 +sec — 11 Sub-Rounds R110.2 → R110.11.5 of Felix Render Hardening + Fish Audio Primary TTS Cascade + Public Mirror CodeFlow Card + Split Liveness/Readiness Probe + Baidu ERNIE Auto-Promote Overlay + 72h Architect Sweep Closing 4 Findings In Same Round; R110.1 +sec — Gold-Review Hardening: 4 HIGH + 3 MEDIUM Architect Findings Closed Across 3 Passes Verified CLEAN at Pass 6 — Upload-Scan FAIL-CLOSED, Delivery-Scanner-Throw Synthesizes Blocking Hit, jsdom RCE Sink Removed in html-app-builder + deliverable-grader, Full DNS-Resolving SSRF Guard with IPv4-Mapped IPv6 Hex-Form Coverage, write_file Pre-Drive Secret Scan with Reason Propagation; R110 +sec — Pre-Delivery Secret Scan: 48-Pattern Credential-Regex Catalog Wired as Fail-CLOSED Gate in Delivery + Ingest, Agent-Callable `scan_for_secrets`, All 16 Personas Wired; R109.4 +sec Hardening + Stat-Drift Sweep with Dockerfile data/ Allowlist; R109.3-fix Self-Healer No-Op-Heal Gate; R109.2.3 Monid Agent-UX Clarity Pass; R109/R109.1/R109.2 +sec discover-first integration with prompt-injection fence, per-tool rate ceilings, cost ledger, SSRF guard; R108.1 +sec Fail-CLOSED Hardening; R108 Adaptive Plan-Node maxSteps + Causal Evidence Edges + Cold-Start Hypothesis Nudge; R107 Regime-Aware Memory Consolidation)",
    subtitle: "Everything a modern business needs, powered by 36 curated AI models (plus 1000+ discovered daily via OpenRouter) across 22 tool categories. R98.19 Memory v2 layered four complementary mechanics onto the agent memory subsystem (confidence-scored facts ranking recall by `confidence × recency × access-frequency`, debounced 30s write queue, synthesis-time dedup against existing facts, and an 8K token cap on recall context so memory never blows out the chat budget). **R98.19+sec** is the immediately-following whole-app architect sweep Bob requested — three review rounds, six real bugs closed. The big finding: a recurring bug class showed up across five separate hardening passes — historical code used `require()` inside `try/catch` blocks, but the project runs in ESM mode, so every one of those `require()` calls threw 'require is not defined' at runtime and the catch silently swallowed it. Net effect: five different security primitives were quietly degraded for as long as those files have been deployed. All five fixed in one session: provider-error secret redaction (was passing through unredacted), gate_command untrusted-stdout fence (was silently degrading), wrapAsData fence builder, presenter constant-time HMAC compare (was hard-blocking every legitimate call with 403), and the Claude-agent GitHub-importer prompt-injection scanner (the most serious — imported agents could carry 'ignore previous instructions' payloads straight into a durable persona). The scanner catch was also tightened from 'false fail-closed' to true fail-closed quarantine. R98.18+sec was the self-healing maintenance round closing two HIGH dependency CVEs (drizzle-orm 0.39 → 0.45 + xlsx removed entirely). R98.17 added a 4-tier risk-class taxonomy + hard kill switch + Cairo's MC-1 Gate reserving chat slots. R98.16 shipped the 296th tool, `run_command`, with a large-output sandbox that auto-summarizes test/build/grep output.",
    icon: Layers,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    features: [
      { icon: Search, label: "RAG Quality Lift — Contextual Retrieval + Cross-Encoder Rerank (R98.27 / R98.27.1)", detail: "Two complementary upgrades to the doc-search and knowledge-recall pipeline, both lifted from Anthropic's published Contextual Retrieval benchmark (-49% top-20 retrieval failure on its own, -67% combined with rerank). (1) **Index-time auto-contextualize** (`server/doc-collections.ts addDocument({ autoContextualize: true })`): an LLM (`gpt-5-mini`, batches of 4) writes 1-2 sentences per chunk situating it inside the full document, stored in the existing `doc_chunks.context` column so the hybrid retriever picks it up at query time. Document body truncated to 6k chars to bound latency; per-chunk reply capped at 80 tokens / 600 chars; cost guardrail `DOC_AUTOCONTEXT_MAX_CHUNKS=500` so a runaway upload can't burn budget; fail-open with warn log on any LLM error. Wired through both `doc_search` and the three HTTP ingestion routes (`POST /api/doc-collections/:id/documents` + `/upload` + `/upload-chunked`) so UI uploads can opt in. (2) **Query-time Cohere rerank cross-encoder** (`server/embeddings.ts cohereRerank()`): activates when `COHERE_API_KEY` is set, takes the top `Math.max(15, topK*3)` of the RRF-fused candidates (after local BM25 + vector hybrid fuse), sends `title\\ncontent` (4k char cap each) to `rerank-v3.5` with a 6s abort timeout, returns rerank-ordered top K. Fails OPEN: missing key / HTTP non-2xx / abort / any throw → falls back to RRF ordering. R98.27.1 wired the rerank into `searchDocuments` so the `doc_search` tool path gets the lift too (was originally only in `vectorSearchKnowledge`); response now carries `reranked: boolean` so callers can observe whether the cross-encoder ran. Persona prompts for VisionClaw default + Radar + Neptune + Luna re-seeded with an explicit `DOC INGEST` rule telling them to set `auto_contextualize:true` on long noisy ingests." },
      { icon: FileText, label: "Full Document Suite", detail: "PDFs, Word docs, Excel spreadsheets, Google Slides, Mermaid diagrams, charts, dashboards — all auto-uploaded to Google Drive." },
      { icon: Code, label: "Code & Execution", detail: "Write code, execute it in a sandbox, review architecture, generate code proposals, and manage technical projects." },
      { icon: Globe, label: "Four-Tier Web Access Ladder (R96)", detail: "`web_fetch` → `firecrawl_scrape` → `stealth_browse` → `stealth_browse_camofox`. Every persona sees all four on every turn (ALWAYS_INCLUDE). Auto-detection of bot-block payloads (Cloudflare, hCaptcha, DataDome, Akamai, 401/403/407/429/451) injects an inline `fallbackHint` + `fallbackTool` into the next tool return so the agent climbs the ladder mechanically instead of giving up. Hint placement survives chat-engine truncation AND the underscore-prefix prompt-injection key strip." },
      { icon: Shield, label: "Camofox Stealth Microservice (R96)", detail: "`jo-inc/camofox-browser` (MIT, Camoufox-based, 3961★) deployed as its own Railway service so the heavy stealth-Firefox runtime never bloats the main process. Full WebGL/canvas/font/WebRTC fingerprint spoofing. Per-(tenant, persona) cookies + storage_state — Robert-medical and Felix-CEO under tenant 1 each get their own the per-persona namespaced form jar. HITL gate on `click`/`type`/`navigate`/`extract`/`open`. SSRF guard rejects metadata IP, RFC1918, localhost, *.railway.internal, IPv6 link-local, non-http/https schemes (verified against 11 attack URLs)." },
      { icon: Mail, label: "Multi-Channel Comms", detail: "Email (AgentMail), WhatsApp, Discord, Telegram, X/Twitter (10 tools) — your AI team communicates across every channel." },
    ],
  },
  {
    title: "Trust & Continuity (R64 → R98.27.8-sec Hardening)",
    subtitle: "Multiple rounds of security work + cross-AI critique panels — the platform critiques itself, isolates every tenant, and protects every customer download. Latest sweep: R98.27.8-sec ran four parallel architect explorers (delta + tenant/SSRF/CSRF/SQL/OAuth/validation + production-health + AHB-coverage) against the new R98.27.8 codebase-graph surface. Two same-pass fixes shipped: (1) `loadGraph` now uses `lstat` + `isSymbolicLink()` reject + `isFile()` confirm so a hostile pre-existing symlink at `data/codebase-graph.json` cannot redirect the read; (2) dead silent-catch removed from the graph builder. Six architect findings verified as FALSE POSITIVE (the proposed `HEAD^{/!cmd}` git-revision injection fails the validator's `[A-Za-z0-9._/^~@-]` charset at the first `{`; perplexity-search `AbortSignal.timeout(30000)` was already present; Forge/Blueprint codebase-tool prose schema-matches the registry). Earlier sweep: R98.27.7-sec ran four parallel architect explorers (24h delta + tenant/auth/secrets/SSRF/SQL/CSRF/OAuth + production health/drift + AHB safety + persona governance + TOOL_POLICIES coverage). Three same-pass HIGH fixes shipped: (1) all 6 new `workspace_*` tools registered in `TOOL_POLICIES` with `requiresStructuredArgs:true` so the AHB stylistic-jailbreak vector is closed even on filesystem-only ops; (2) `build_html_app` LLM-call timeout 90s → 180s to drop the 32% fail rate; (3) `workspace_read` content-return wrapped in per-call random-nonce delimiters with literal-marker escape — a same-tenant attacker can no longer smuggle a closing marker. Architect re-review caught two HIGH issues with the first cut of those fixes (static delimiters bypassable + maxTokens reduction would truncate legit complex HTML); both closed in a same-pass second sub-edit (random-nonce + revert maxTokens to 16k). Clean bills of health: tenant isolation, auth, secrets, SSRF, SQL injection, CSRF, OAuth refresh, schema parity, decline-events telemetry, intent-gate fail-OPEN + tool-policy fail-CLOSED asymmetry. Earlier: R98.27.2+sec closed Slack user-level ACL HIGH; R98.26.6 closed 2 HIGH + 4 MEDIUM + 1 LOW against the Slack invocation surface; R98.22+sec closed 7 HIGH HyperAgent-surface findings before the code reached the public mirror.",
    icon: ShieldCheck,
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    features: [
      { icon: Lock, label: "Slack User-Level ACL + Tenant-Aware Persona Resolution + Rerank Backfill (R98.27.2+sec)", detail: "Whole-project security review against the last 24h of work + AHB-relevant high-sensitivity surfaces. One HIGH access-control gap and two MEDIUM correctness issues found and closed in the same pass; owner notified per the architect-finding-triage runbook (HIGH ⇒ +sec suffix + owner-notification). **HIGH — Slack user-level authorization (`server/routes/slack.ts`).** The R98.26.6 workspace allowlist confirmed *which workspace* the request came from, but every authenticated user in that workspace (including shared-channel guests) could trigger tool-enabled runs against `ADMIN_TENANT_ID`. New `verifySlackUser()` consults `SLACK_ALLOWED_USER_ID` (comma-separated Slack U… ids) and fails CLOSED when configured, fails OPEN with a one-shot loud warning when unset (preserves the current single-operator deploy without forcing a config change). Wired into both `/api/slack/commands` (returns 'not authorized' to caller) and `/api/slack/events` (silent drop after 200 OK to prevent Slack-retry amplification, but the rejected `user_id` is logged for audit). **MEDIUM — Tenant-aware persona resolution.** `resolveFirstWordPersona()` was querying global `personas` only and ignoring the `tenant_persona_names` display-name overrides; the warn-list path was enumerating every persona globally regardless of tenant. Both queries now LEFT JOIN `tenant_persona_names` filtered by `tenantId`, matching either the canonical persona name OR the tenant's display-name override. Routing now respects per-tenant renames (Felix → 'CEO' etc.) and the warn-list no longer leaks other tenants' overrides. **MEDIUM — Cohere rerank partial-valid backfill (`server/embeddings.ts`).** Previous fail-open only handled 'all indices invalid' → null. A partial-valid response (Cohere returns 3 valid + 7 garbage indices when caller asked for 10) silently truncated the result set. Now after applying valid rerank indices, fills out to `topN` from the original RRF order, deduped via `seen` set across the entire reordered array (covers Cohere returning duplicate indices in malformed responses), with a hard `slice(0, topN)` cap so callers can never receive more than they asked for. **R98.27.3 CI hard-gate green pass:** new `tests/fixtures/seed-test-personas.sql` seeds the 16 canonical persona rows in CI so security/safety tests can INSERT into FK-bound `agent_knowledge.persona_id` and `security_intent_checks.persona_id`; `decline_events.flagged_categories text[]` insert path fixed (Drizzle `sql\`\`` template binds JS arrays as a single scalar — pre-stringify the `{...}` Postgres array literal first, same pattern projects.tags uses)." },
      { icon: Lock, label: "Slack Workspace Allowlist + Live-Callsite Model Sweep (R98.26.6)", detail: "Two-prong architect pass on the new R98.26 Slack ingress + per-agent cost dashboard returned 2 HIGH + 4 MEDIUM + 1 LOW. All 7 closed in one session; pass-2 ran clean. **HIGH #1 — Slack workspace allowlist (`server/routes/slack.ts`).** Pre-fix, HMAC-SHA256 signature verify alone gated ingress — if `SLACK_SIGNING_SECRET` ever leaked, ANY workspace where the app was installed could pivot into `ADMIN_TENANT_ID` and execute tools. Added `verifySlackWorkspace()` reading `SLACK_ALLOWED_TEAM_ID` / `SLACK_ALLOWED_ENTERPRISE_ID` / `SLACK_ALLOWED_APP_ID` (comma-separated). Called AFTER `verifySlackSignature` in BOTH `/api/slack/commands` and `/api/slack/events`, BEFORE rate-limit / ack / dispatch. **Fails CLOSED on mismatch (403), fails OPEN with one-time warning when unset** so existing single-workspace deploys keep working without forcing a config change. `url_verification` handshake bypass preserved (pre-install — no team_id available). **HIGH #2 — `gpt-5.1` still hardcoded in 5 live LLM callsites in `server/tools.ts`** (`run_supervisor` writer/analyst/critic/router + `commit_decision`). Same Unknown-model class as the R98.26.1 production hotfix would have surfaced if these tool paths fired. All 5 → `gpt-5-mini`. Sweep confirmed no remaining live `gpt-5.1` literals in `server/` or `client/src/` (the 2 left are intentional: cost-ledger pricing entry for the historical 84 conversations still on it, and an explanatory comment). **MEDIUM #1 — Frontend `gpt-5.1` defaults:** `client/src/pages/settings.tsx` (defaultModel) + `client/src/pages/chat.tsx` (model-badge fallback, 2 occurrences) → `gpt-5-mini`. **MEDIUM #2 — `sanitizeLlmError` coverage gaps:** added Slack `xapp-` (app-level token), Stripe `whsec_` (webhook secret), and SDK shapes `err.response.data.message` + `err.error.details`. Length cap (`.slice(0, 500)`) applied LAST so any matched secret is already replaced before truncation — no guessable-prefix risk. **MEDIUM #3 — the tenant-namespace prefix mirror leak-verifier exemption too broad:** the previous broad pattern would silently exempt accidental non-numeric literal forms. Tightened to a strict numeric tenant-ID format with optional persona segment. **LOW — replit.md doc drift:** R98.26.1 said Slack pins `gpt-5-mini`; code actually pins `gpt-5.5`. Updated. Pass-2 architect verdict: PASS — no remaining CRITICAL/HIGH/MEDIUM in the diff." },
      { icon: Activity, label: "Slack Ingress Hardening Stack (R98.26 → R98.26.4)", detail: "The new Slack invocation surface (slash commands + `app_mention` + DM + mpim group DM) shipped with a defense-in-depth ingress stack: (1) HMAC-SHA256 v0 signature verify with 5-minute replay window and `crypto.timingSafeEqual`, fails CLOSED with 503 if `SLACK_SIGNING_SECRET`+`SLACK_BOT_TOKEN` unset; (2) workspace allowlist (R98.26.6, see above); (3) in-process per-channel sliding-window rate limiter (R98.26.4): 6/min, 60/hour. Both `/api/slack/commands` (slash) and `/api/slack/events` (mention + DM) gated. Slash returns user-visible 'slow down' 200; events drop silently on purpose (200 OK already sent, retrying a rate-limited event would amplify abuse). Empty `channel_id` falls back to a shared `__no_channel__` bucket so the limit can't be bypassed. (4) `runLlmTask`/`runLlmTextTask` error sanitization (R98.26.4): new `sanitizeLlmError()` strips URLs (with + without scheme), API-key shapes (OpenAI `sk-`, Anthropic `sk-ant-`, GitHub PAT classic+fine-grained, Slack `xox*` + R98.26.6 `xapp-`, Google `AIza`, AWS `AKIA`, Stripe `sk_`/`rk_` live+test + R98.26.6 `whsec_`, Bearer), IPv4+port, IPv6, absolute filesystem paths (Linux home/var/workspace/tmp/opt/etc, macOS /Users, Windows `C:\\…`), length-cap to 500 chars. Closes the leak vector where chat surfaces / golden-path reports were echoing raw provider stack fragments. (5) Catch block sanitization — pre-fix was echoing `e.message` into the channel, leaking provider URLs / stack fragments; replaced with fixed generic message, full diagnostics in `console.error`. (6) `postSlackMessage` now inspects Slack `ok:false` so `channel_not_found`/`not_in_channel`/`invalid_auth` land in the log instead of the void. (7) Belt-and-suspenders against bot-message reply loops: `app_mention` `!ev?.subtype` filter + DM `channel_type` filter excludes bot-authored messages." },
      { icon: ShieldCheck, label: "HyperAgent Surface Hardening Sweep (R98.22+sec)", detail: "Four parallel architect passes against R98.21's new HyperAgent surfaces (recipe gallery, plan_deliverable estimates, proposed_skills review queue, ab_runs cross-run A/B) closed 7 HIGH findings before the code reached the public mirror. **HIGH #1 — cross-tenant promotion:** the `accept` UPDATE on `proposed_skills` was scoped by `id` only, so an admin in tenant A could promote a pending proposal originating from tenant B by guessing the id. Fix: `(id AND tenantId)`. **HIGH #2 — cross-tenant memory delete:** `DELETE /api/memory/:id` was calling `deleteMemoryEntry(memId)` without the resolved tenant scope; storage fell back to id-only. Now passes the scope. **HIGH #3 — tenant fail-OPEN:** the hyperagent route resolver used `?? 1` and silently treated missing tenant context as admin tenant 1. Now `?? null` + `resolveTenant` 401s the request. **HIGH #4 — prompt-injection on store:** `propose_skill` was inserting agent-supplied name/description/body verbatim into a row that becomes a future skill prompt; now sanitized via `sanitizeUntrusted` before insert (heading + system-tag + IM-token defang). **HIGH #5 — destructive-tool policy gap:** the new `propose_skill` (MEDIUM) and `run_ab_eval` (HIGH, trustedPersonasOnly) had no entry in `TOOL_POLICIES`, so the cost-fanout A/B tool ran unguarded. Both now classified. **HIGH #6 — SSRF in delivery verifier:** `delivery-pipeline.ts verifyShareLink` did a raw `fetch(url)` with `redirect:'follow'`; now jails through `ssrfSafeUrl()` with `redirect:'error'` so a redirect to an internal IP can't bypass the jail. **HIGH #7 — unsigned-URL fail-OPEN:** when the signing call threw, the delivery path was falling back to an unsigned `/uploads/<publicName>` URL and bypassing the auth gate; now fails CLOSED (returns null, delivery layer retries/alerts). Closed under tsc exit 0; app restarted clean; `GET /api/public/recipes` 200." },
      { icon: Sparkles, label: "HyperAgent Cross-Pollination — Items 1-4 (R98.21)", detail: "Lifted four patterns from the HyperAgent review and shipped them clean. (1) **Landing-page Recipe Gallery** — five example prompts (Brand Audit, Competitor Brief, Sales Outreach, HVAC Quote PDF, Weekly Status) with `est. time` + `est. cost` chips, served from a public `/api/public/recipes` endpoint so visitors see concrete 'what can I actually ask for' examples before signing up. (2) **Upfront cost + duration estimate on `plan_deliverable`** — every plan now returns `estimatedDurationMinutes` + `estimatedCostUsd` as a low/median/high band so Felix can quote the user BEFORE starting the work; the user can approve or scope down before any tokens are burned. (3) **Skill auto-emission with review queue** — new `proposed_skills` table + `propose_skill` tool any persona can call when it notices a reusable pattern; `/admin/proposed-skills` review UI lets the owner accept (promotes to a real skill row) or reject with rationale. Closes the 'agents keep re-discovering the same trick and the platform never learns' gap. (4) **Cross-run A/B with configurable rubrics** — new `ab_runs` table + `run_ab_eval` tool fans out N parallel runs across multiple agent configs against the same prompt, grades each artifact via the existing `grade_deliverable`, returns a ranked diff. Results visible at `/admin/ab-runs`. Tool count stays 296 (both new tools were already in the registry from R98.21 work); capabilities 93 → 95." },
      { icon: ShieldCheck, label: "Silent-Bypass Security-Primitive Sweep (R98.19+sec)", detail: "Three architect rounds caught a recurring bug class across five historical hardening passes: code used `require()` inside `try/catch` blocks under ESM module mode — every `require()` threw 'require is not defined' at runtime and the catch silently swallowed it, leaving the security primitive non-functional. **HIGH #1** `translate-llm-error.ts` — provider-error secret redaction never ran (LLM 401s containing our own env-var values would pass through unredacted). **HIGH #2** `tools.ts:8567` — `gate_command` untrusted-stdout fenceTag generation failed; the random fence around shell output in delegated tasks silently degraded. **HIGH #3** `sanitize-untrusted.ts:81 wrapAsData()` — same in the untrusted-content fence builder. **HIGH #4** `routes.ts:1770/1796` — `crypto.timingSafeEqual` in `/api/presenter` constant-time HMAC compare threw and returned false, hard-blocking every legitimate presenter request with 403; also caught a TDZ shadow on the line above. **HIGH #5** `claude-subagent-importer.ts:249` — Claude-agent GitHub importer's prompt-injection scanner was being skipped entirely, allowing imported personas to carry 'ignore previous instructions' + exfil-curl payloads into the durable system prompt; fixed with static import AND tightened the surrounding catch from 'false fail-closed' (comment claimed fail-closed, code was fail-open) to TRUE fail-closed quarantine that replaces the body with a 'BLOCKED IMPORT — scanner failed' marker on any scanner exception. **MEDIUMs** rolled up: `setBackgroundHalted` now surfaces disk-write failures via 500 instead of silent in-memory-only state; `output-sandbox.ts` writer fixed; `as any` casts dropped on the new `createMemoryEntry` calls. Closed under tsc exit 0 across all three rounds." },
      { icon: Brain, label: "Memory v2 — Confidence-Scored Recall (R98.19)", detail: "Lifted items 1-4 from the bytedance/deer-flow nugget triage and rebuilt VisionClaw-native. (1) Every memory write carries a 0.0-1.0 `confidence` plus `confidence_source` enum (`vision_extracted` / `tool_verified` / `inferred_from_context` / `user_stated` / `auto_detected`); recall ranks by `confidence × recency × access-frequency`. (2) 30-second debounced write queue dedupes identical writes within the window so a 5-tool-call burst persists ONE row not five; flushes on SIGTERM. (3) Synthesis-time dedup uses substring + Jaccard ≥0.8 against existing facts in the same tenant + persona scope before write — higher-confidence write wins, lower drops. (4) Recall context hard-capped at 8K tokens so memory never blows out the chat budget on long sessions. All 16 personas re-seeded with the new doctrine via `seed-persona-prompts.ts`. 1 new column + 1 new background queue, no schema break, additive and backward-compatible." },
      { icon: Network, label: "Donahoe-Trident Cross-AI Critique Panel", detail: "Before any high-stakes decision ships — code change, customer email, pricing tweak, brand-voice update — three different model families (Claude, OpenAI, Gemini) attack it in parallel through three lenses (UX/empathy, technical precision, strategic holism). Findings ranked by 'rebuttal survival score'; consensus issues flagged when 2+ panelists agree. Never trust a single model on something that matters." },
      { icon: Brain, label: "Auto-Memory Synthesis Loop", detail: "Every six hours the heartbeat scans recent conversations, extracts durable lessons (preferences, decisions, error patterns), de-duplicates against existing memory, and stores survivors. The platform gets smarter while you sleep — no manual capture required." },
      { icon: ShieldCheck, label: "BRAND.md Voice Contract", detail: "A single source-of-truth file every persona reads on session start: voice rules, banned phrases, channel-specific length caps (SMS ≤160, Telegram ≤500, email subject ≤60), and visual identity. Brand drift is the #1 silent killer of trust — this stops it cold. Voice changes auto-route through the critique panel." },
      { icon: MessageSquare, label: "Hermes Multi-Channel Gateway", detail: "Every persona — all 16 of them — knows how to deliver work over SMS, WhatsApp, Telegram, email, or in-app, plus schedule recurring deliveries by natural language ('every weekday 7am') with persona-fresh content generated at delivery time. Audience picks the channel; the platform picks the words." },
      { icon: Key, label: "Signed Customer Downloads (R64.C)", detail: "Every customer-facing download URL is HMAC-SHA256 signed with a 30-minute expiry tied to the tenant ID. Bearer-token auth still works for in-app use, but raw `?token=<session>` query auth — which used to leak via referrers and access logs — is gone. The static `/uploads` mount is now gated at the middleware boundary with cross-tenant filename ownership checks." },
      { icon: Shield, label: "MIME Magic-Byte Validation (R64.C)", detail: "The admin upload endpoint no longer trusts the client's claimed MIME type. We sniff the actual file bytes — PDF/PNG/JPEG/GIF/WEBP/MP3/WAV/MP4/ZIP-family — and reject anything without a recognized binary signature. Closes HTML/SVG/XML/JSON smuggling vectors that would otherwise let an attacker host phishing pages from our Drive folder." },
      { icon: Network, label: "Per-Tenant MCP Keys (R64.C)", detail: "Every tenant gets their own derived MCP key (HMAC of the global key). SSE sessions are bound to the tenant they authenticated as, and POST messages on those sessions verify the requester matches the session owner — so even if a sessionId leaks, another valid MCP key cannot hijack it." },
      { icon: ShieldCheck, label: "Prompt-Injection Hardening (R64.B)", detail: "Tool outputs and chain-of-thought scratchpads are wrapped in untrusted-data fences before being shown to downstream models. Reserved-key prefix strip with null-prototype normalization closes prototype-pollution and underscore-prefix bypass vectors. Backup-agent error messages are fenced as data, not instructions." },
    ],
  },
  {
    title: "Zero-Cost Web Extraction",
    subtitle: "Article-quality reading and self-graduating template scrapers — costs collapse to near-zero after the third use",
    icon: Sparkles,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    features: [
      { icon: BookOpen, label: "Mozilla Readability", detail: "Strips ads, nav, and chrome from any article URL using the same engine that powers Firefox Reader View. Zero LLM cost — just clean title, byline, and body text in under a second." },
      { icon: Sparkles, label: "LLM-Scraper Recipes", detail: "First call asks an LLM to write a CSS-selector recipe for your schema. The recipe is cached per domain + schema and reused on every subsequent visit — no LLM call needed." },
      { icon: TrendingUp, label: "Auto-Graduation at Run 3", detail: "After three successful runs, recipes graduate to deterministic cheerio parsers. Pure pattern-matching, no AI tokens — the scraper has effectively been compiled." },
      { icon: Shield, label: "Self-Healing Snap-Back", detail: "When site layouts change and field coverage drops below 50%, the recipe is invalidated and regenerated automatically. SSRF guard, 5MB cap, tenant-isolated cache, async mutex — production-hardened." },
    ],
  },
  {
    title: "Multi-Agent Orchestration",
    subtitle: "Crews, Flows, and Minds — three powerful systems for coordinating AI teams",
    icon: Workflow,
    color: "text-teal-500",
    bg: "bg-teal-500/10",
    features: [
      { icon: Users, label: "Crews Engine", detail: "Create multi-agent teams with defined roles and task dependencies. Agents work in parallel on complex projects — research, write, review, publish — with automatic coordination." },
      { icon: ArrowRightLeft, label: "Flows Engine", detail: "Sequential multi-step pipelines where each step runs a specific specialist. Results flow step-to-step with timeouts and failure handling. Perfect for repeatable processes." },
      { icon: Brain, label: "Minds Engine", detail: "Autonomous reasoning entities with 4 roles — visionary, architect, critic, executor. Minds deliberate on tickets through structured multi-role analysis." },
      { icon: Crown, label: "CEO Orchestrator", detail: "Ad-hoc DAG planner that auto-decomposes complex requests into parallel and sequential steps, assigning the right specialist persona to each task." },
    ],
  },
  {
    title: "Business Operations Suite",
    subtitle: "Full CRM, invoicing, expenses, contracts, KPIs, and financial reporting",
    icon: DollarSign,
    color: "text-green-500",
    bg: "bg-green-500/10",
    features: [
      { icon: Users, label: "CRM & Pipeline", detail: "Add customers, track deals through pipeline stages, log interactions, and manage the full sales lifecycle. Built-in customer pipeline visualization." },
      { icon: CreditCard, label: "Invoicing & Expenses", detail: "Create invoices, track aging reports, log expenses, generate expense reports. Complete accounts receivable and payable management." },
      { icon: TrendingUp, label: "KPI Dashboard", detail: "Record KPIs, view dashboards, track trends over time. Set targets and monitor business performance with automated scoring." },
      { icon: BarChart3, label: "Financial Snapshot", detail: "One-call complete period summary — revenue, expenses, P&L, KPIs, and health score. Monthly, quarterly, or annual views." },
    ],
  },
  {
    title: "Self-Evolution Engine",
    subtitle: "Your AI platform detects its own gaps and teaches itself new capabilities",
    icon: Rocket,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    features: [
      { icon: Search, label: "Skill Seeker", detail: "Autonomous capability gap detection — when agents can't do something, the system researches solutions on GitHub/npm and builds new tools." },
      { icon: ShieldCheck, label: "5-Layer Safety System", detail: "Trusted domain allowlist, code scanner (25+ patterns), prompt injection scanner, LLM security assessment, and three-tier trust gating." },
      { icon: Lightbulb, label: "Instinct Learning", detail: "Agents extract reusable patterns from successful tasks. After 3+ uses, patterns graduate to permanent knowledge." },
      { icon: Sparkles, label: "Auto-Tool Creation", detail: "High-trust solutions auto-create tools. Medium-trust gets logged. Low-trust flags for admin review. Blocked solutions are rejected." },
    ],
  },
  {
    title: "Memory & Intelligence",
    subtitle: "An AI that remembers, learns from experience, and self-improves",
    icon: Brain,
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    features: [
      { icon: Database, label: "Three-Tier Memory", detail: "Episodic, semantic, and procedural memory with pgvector search. Your AI never forgets important details." },
      { icon: Sparkles, label: "3-Phase Dreaming (Light/Deep/REM)", detail: "Cooperative consolidation cycles inspired by human sleep stages. Light dedupes and stages candidates; Deep scores and promotes winners to permanent memory; REM (rare, narrative) writes a Dream Diary entry capturing dominant themes — your AI literally journals what it's been thinking about." },
      { icon: Eye, label: "LLM-Judged Relevance", detail: "GPT-4.1 Mini picks the most relevant knowledge for each query in real-time. Not just similar — actually relevant to what you need." },
      { icon: BookOpen, label: "Graph Memory", detail: "Hierarchical path-based memory with triggers, rollback, and cross-references. Complex knowledge structures that agents traverse intelligently." },
    ],
  },
  {
    title: "AI-Powered Content & Media",
    subtitle: "Create professional content across every format",
    icon: Share2,
    color: "text-pink-500",
    bg: "bg-pink-500/10",
    features: [
      { icon: Image, label: "AI + Stock Media", detail: "Generate AI graphics or search millions of free stock photos and videos. Platform-optimized sizing for social, slides, and marketing." },
      { icon: Mic, label: "Voice & Audio", detail: "Text-to-speech with OpenAI and ElevenLabs (23 voices). Speech-to-text with speaker diarization. Real-time voice narration." },
      { icon: Monitor, label: "Cinematic Video", detail: "End-to-end video production with Ken Burns motion effects, 25+ transition styles, background music mixing, per-slide narration sync, and auto-upload to Drive." },
      { icon: Palette, label: "36 Curated AI Models + 1000+ Daily Discovery", detail: "36-model curated registry across OpenAI, Anthropic, Google, xAI, DeepSeek and more, plus a daily OpenRouter probe that auto-discovers 1000+ additional models the day they ship. Subscription-First Routing (BYOS) prefers your ChatGPT Plus / Gemini OAuth tokens for $0/token primary inference. Claude Runner bridge active for $0/token Anthropic when Max plan authenticated. Cost-aware routing always tries free → cheap → paid in that order." },
    ],
  },
  {
    title: "Legal & Compliance Suite",
    subtitle: "AI-powered contract review, regulatory audits, and legal document generation",
    icon: Gavel,
    color: "text-rose-500",
    bg: "bg-rose-500/10",
    features: [
      { icon: Scale, label: "Contract Safety Scoring", detail: "Upload any contract and get a 0-100 safety score with clause-by-clause analysis, 20 risk patterns, missing protections, and negotiation recommendations." },
      { icon: ShieldCheck, label: "Compliance Gap Analysis", detail: "Audit against 9 regulatory frameworks — GDPR, CCPA, HIPAA, PCI-DSS, CAN-SPAM, COPPA, ADA, SOC2, FERPA. Per-framework scores with remediation steps." },
      { icon: FileText, label: "12 Legal Templates", detail: "Generate NDAs, TOS, privacy policies, freelancer agreements, partnership agreements, SOWs, MSAs, cease & desist, consulting, and licensing agreements." },
      { icon: Eye, label: "Risk Detection", detail: "Identifies unlimited liability, perpetual license grants, one-sided termination rights, IP assignment risks, and 16 more patterns automatically." },
    ],
  },
  {
    title: "Security & Governance",
    subtitle: "Enterprise-grade safety with earned autonomy and full audit trails",
    icon: Shield,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    features: [
      { icon: ShieldCheck, label: "40 Governance Rules", detail: "Based on NIST, OWASP, and Singapore IMDA standards. 7 categories covering data, comms, finance, code, and behavior." },
      { icon: Users, label: "Trust Score System", detail: "9 trust categories per agent. Earned autonomy progression — agents prove they can be trusted before getting independence." },
      { icon: Key, label: "Multi-Tenant Isolation", detail: "Complete data isolation between tenants. Admin PIN auth, timing-safe crypto, rate limiting, and circuit breakers." },
      { icon: CheckCircle2, label: "Auto-QA Pipeline", detail: "Every deliverable is automatically reviewed by Proof for quality. Color-coded scores on completeness, accuracy, and clarity." },
    ],
  },
  {
    title: "Agent Board — Live Status Dashboard",
    subtitle: "Real-time visibility into every agent's activity, status, and workload",
    icon: Monitor,
    color: "text-sky-500",
    bg: "bg-sky-500/10",
    features: [
      { icon: Activity, label: "Live Agent Status", detail: "See which agents are working, idle, or waiting. Real-time heartbeat updates with auto-clear after 10 minutes of inactivity." },
      { icon: Eye, label: "Activity Timeline", detail: "Scrollable timeline of every agent action — tool calls, delegations, completions, and errors — with timestamps and cost tracking." },
      { icon: Users, label: "Multi-Agent Overview", detail: "All 16 agents on one board. Filter by status, persona, or activity type. Instantly see who's doing what across your AI corporation." },
      { icon: Sparkles, label: "Auto-Broadcast", detail: "Agents automatically broadcast their status to the board as they work. No manual tracking — the system stays current by design." },
    ],
  },
  {
    title: "Auto-Skill Capture",
    subtitle: "Agents learn from success and build reusable skills automatically",
    icon: Lightbulb,
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    features: [
      { icon: Brain, label: "Pattern Recognition", detail: "After successful multi-tool task completions, the system extracts the tool sequence, context, and outcome as a reusable skill pattern." },
      { icon: Target, label: "Confidence Scoring", detail: "Each captured skill starts at low confidence. After 3+ successful reuses, patterns graduate to permanent knowledge with high trust." },
      { icon: Sparkles, label: "Auto-Apply on Match", detail: "When a new request matches a captured skill pattern, agents automatically apply the proven approach — faster execution, higher quality." },
      { icon: Database, label: "Skill Library", detail: "Growing library of learned patterns stored in vector memory. Skills are persona-tagged so the right specialist inherits the right knowledge." },
    ],
  },
  {
    title: "Agent Channels — Inter-Agent Messaging",
    subtitle: "Persistent communication channels let agents share context and hand off work without re-prompting",
    icon: ArrowRightLeft,
    color: "text-fuchsia-500",
    bg: "bg-fuchsia-500/10",
    features: [
      { icon: Workflow, label: "Named Channels", detail: "Create persistent communication channels between agents. Research results, partial drafts, and context flow through named channels with message history." },
      { icon: Crown, label: "CEO-Managed Routing", detail: "Felix orchestrates which agents subscribe to which channels. DAG-based task decomposition coordinates the right agents for each workflow step." },
      { icon: Shield, label: "Isolated Data Flow", detail: "Each channel is tenant-isolated and scoped to a specific workflow. No data leaks between projects, conversations, or tenants." },
      { icon: Zap, label: "Zero-Prompt Handoffs", detail: "When one agent finishes a step, results post to the channel for the next agent to pick up — no user intervention needed." },
    ],
  },
  {
    title: "Outcome Completion Gate",
    subtitle: "Ask once, get a complete deliverable — the system self-corrects until done",
    icon: CheckCircle2,
    color: "text-lime-500",
    bg: "bg-lime-500/10",
    features: [
      { icon: Target, label: "Incomplete Detection", detail: "Automatic detection of research-without-document, tool usage without output, and formal deliverable requests that ended without a file." },
      { icon: ArrowRightLeft, label: "Self-Correction Loop", detail: "When an incomplete outcome is detected, the system automatically continues — adding missing steps, generating documents, and completing the full workflow." },
      { icon: ShieldCheck, label: "25-Tool Deep Execution", detail: "Up to 25 tool calls across 7 rounds per request. The system keeps working through complex multi-step tasks without hitting artificial limits." },
      { icon: FileText, label: "Deliverable-First Routing", detail: "When you ask for a report, analysis, or summary, the tool router automatically includes document generation tools — ensuring a real file, not just text." },
    ],
  },
  {
    title: "Ideation Session Engine",
    subtitle: "Structured brainstorming with 6 innovation frameworks — from SCAMPER to Blue Ocean",
    icon: Lightbulb,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    features: [
      { icon: Brain, label: "6 Innovation Frameworks", detail: "SCAMPER, Design Thinking, Blue Ocean, TRIZ, Lateral Thinking, and First Principles — each applied systematically to your challenge." },
      { icon: Target, label: "Auto-Framework Selection", detail: "Describe your challenge and the engine selects the best framework. Or pick one manually for targeted ideation sessions." },
      { icon: Sparkles, label: "Scored & Ranked Ideas", detail: "Every idea gets feasibility, impact, and novelty scores. Top ideas surface automatically with implementation roadmaps." },
      { icon: FileText, label: "Session Deliverables", detail: "Full ideation reports with framework analysis, ranked ideas, and next-step recommendations — exportable as PDF or injected into agent memory." },
    ],
  },
  {
    title: "Stop-the-Line Error Triage",
    subtitle: "Hard enforcement that halts tool execution when error patterns indicate systemic failure",
    icon: ShieldCheck,
    color: "text-red-500",
    bg: "bg-red-500/10",
    features: [
      { icon: Shield, label: "Conversation Error Accumulator", detail: "Tracks every error across the full conversation. When patterns indicate systemic failure, tool execution stops automatically — no advisory, hard enforcement." },
      { icon: Target, label: "Pattern Detection", detail: "Detects repeated auth failures, cascade errors, rate limit storms, and resource exhaustion. Distinguishes transient blips from real problems." },
      { icon: Eye, label: "Root Cause Analysis", detail: "When stop-the-line triggers, the system analyzes accumulated errors, identifies the root cause, and provides actionable remediation steps." },
      { icon: CheckCircle2, label: "Safe Recovery", detail: "After triage, tools re-enable only when the root cause is addressed. Prevents the common AI pattern of retrying broken operations endlessly." },
    ],
  },
  {
    title: "OWASP Security Scanner",
    subtitle: "Automated security audits across your entire agent platform — tenant-scoped and admin-gated",
    icon: Shield,
    color: "text-rose-600",
    bg: "bg-rose-600/10",
    features: [
      { icon: Key, label: "API Key Hygiene", detail: "Scans for expired, weak, or overly-permissioned API keys. Detects keys without rotation policies and flags shared credentials." },
      { icon: ShieldCheck, label: "Governance Rule Audit", detail: "Validates all 40 governance rules are active and correctly configured. Flags disabled rules, missing categories, and coverage gaps." },
      { icon: Users, label: "Tenant Isolation Check", detail: "Verifies complete data isolation between tenants. All queries tenant-scoped, admin operations gated, no cross-tenant data leakage." },
      { icon: Activity, label: "Trust Score Validation", detail: "Audits agent trust scores across 9 categories. Flags anomalous trust levels, validates earned autonomy progression, and checks safety boundaries." },
    ],
  },
  {
    title: "Infrastructure Resilience",
    subtitle: "Production-grade uptime with automatic recovery, traffic isolation, and zero-downtime token management",
    icon: Activity,
    color: "text-cyan-600",
    bg: "bg-cyan-600/10",
    features: [
      { icon: Layers, label: "Virtual Port Channels", detail: "6 independent traffic lanes (chat, webhook, API, upload, SSE, static) with per-channel concurrency limits and queue depths. Heavy orchestrations never starve lightweight API calls." },
      { icon: Zap, label: "Port Recovery Engine", detail: "5-retry startup with exponential backoff, stale process detection, aggressive port clearing, and graceful 7-step shutdown sequence. Server self-heals after crashes." },
      { icon: Key, label: "OAuth Token Lifecycle", detail: "4-source cascade (Connector → OAuth → Database → Env), 3 overlapping refresh loops (5/10/30 min), in-flight dedupe, demo mode with shortened intervals, and email alerts after 2+ failures." },
      { icon: Database, label: "Centralized Tool Registry", detail: "Single source of truth for all 359 tools — categories, speed class, product output, network tracking. Bidirectional startup audit ensures no tool is invisible. 359 tools across 22 categories." },
    ],
  },
];

type PricingTier = {
  name: string;
  price: number;
  priceLabel?: string;
  description: string;
  features: string[];
  byokBonus?: string;
  cta: string;
  highlighted: boolean;
  trial?: boolean;
  payPerTask?: boolean;
};

const CREDIT_PACKS = [
  { credits: 25, price: 10, perCredit: "$0.40" },
  { credits: 75, price: 25, perCredit: "$0.33" },
  { credits: 175, price: 50, perCredit: "$0.29" },
  { credits: 400, price: 100, perCredit: "$0.25" },
];

const TASK_COSTS = [
  { task: "Quick tasks", detail: "Chat, lookups, simple tools", credits: 1 },
  { task: "Standard tasks", detail: "Research, analysis, drafts", credits: 3 },
  { task: "Deliverables", detail: "PDF, Word, Excel, Slides", credits: 5 },
  { task: "Orchestrations", detail: "Multi-agent complex workflows", credits: 10 },
];

const PRICING_TIERS: PricingTier[] = [
  {
    name: "Free Trial",
    price: 0,
    description: "Experience the full platform",
    features: [
      "5 free conversations",
      "All 16 AI agents",
      "Voice, tools & memory",
      "Full feature access",
    ],
    cta: "Try Free — No Credit Card",
    highlighted: false,
    trial: true,
  },
  {
    name: "Pay-Per-Task",
    price: 0,
    priceLabel: "From $0.25",
    description: "Only pay for completed work",
    features: [
      "No monthly commitment",
      "All 16 AI agents",
      "Full tool & memory access",
      "PDF, Word, Excel, Slides",
      "Credits never expire",
      "Buy more anytime",
    ],
    cta: "Buy Credits",
    highlighted: false,
    payPerTask: true,
  },
  {
    name: "Starter",
    price: 29,
    description: "For individuals getting started",
    features: [
      "3 AI personas",
      "200 messages/day",
      "100 conversations/mo",
      "Basic memory",
      "Email support",
    ],
    byokBonus: "BYOK: 1,000 msgs/day, unlimited convos",
    cta: "Get Started",
    highlighted: false,
  },
  {
    name: "Pro",
    price: 99,
    description: "Full AI toolkit for professionals",
    features: [
      "5 AI personas",
      "1,000 messages/day",
      "Unlimited conversations",
      "Full memory + knowledge",
      "PDF, Word, Excel, Slides",
      "Voice conversations",
      "Priority support",
    ],
    byokBonus: "BYOK: 5,000 msgs/day, unlimited tools",
    cta: "Start Pro",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: 299,
    description: "Full autonomous AI operations",
    features: [
      "Full 16-agent team",
      "5,000 messages/day",
      "Autonomous heartbeat",
      "Full document pipeline",
      "Self-evolution engine",
      "Custom integrations",
      "Dedicated onboarding",
    ],
    byokBonus: "BYOK: Unlimited everything",
    cta: "Contact Sales",
    highlighted: false,
  },
];

type LandingMode = "business" | "technical";

function ViewToggle({ mode, setMode }: { mode: LandingMode; setMode: (m: LandingMode) => void }) {
  return (
    <div className="flex items-center bg-muted/60 dark:bg-white/[0.06] rounded-full p-0.5 border border-border/60" data-testid="view-mode-toggle">
      <button
        onClick={() => setMode("business")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${mode === "business" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        data-testid="toggle-business-view"
      >
        <Briefcase className="w-3 h-3" />
        <span className="hidden sm:inline">Business</span>
      </button>
      <button
        onClick={() => setMode("technical")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${mode === "technical" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        data-testid="toggle-technical-view"
      >
        <Terminal className="w-3 h-3" />
        <span className="hidden sm:inline">Technical</span>
      </button>
    </div>
  );
}

function BusinessHero({ navigate }: { navigate: (path: string) => void }) {
  const { config } = useSiteConfig();
  const pn = config.platformName;
  return (
    <section className="relative overflow-hidden py-20 sm:py-28 px-6">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.06] via-transparent to-violet-500/[0.04] dark:from-blue-500/[0.12] dark:via-transparent dark:to-violet-500/[0.08]" />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-[10%] w-72 h-72 bg-blue-400/10 rounded-full blur-[100px] animate-pulse motion-reduce:animate-none" style={{ animationDuration: "4s" }} />
        <div className="absolute bottom-20 right-[10%] w-96 h-96 bg-violet-400/8 rounded-full blur-[120px] animate-pulse motion-reduce:animate-none" style={{ animationDuration: "6s", animationDelay: "1s" }} />
      </div>
      <div className="relative max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <div className="space-y-6">
            <RevealOnScroll>
              <img src={vcLogoPath} alt={pn} className="h-14 sm:h-16 w-auto mb-2 dark:brightness-[1.15] dark:contrast-[1.1]" data-testid="img-business-hero-logo" />
            </RevealOnScroll>
            <RevealOnScroll>
              <Badge variant="secondary" className="gap-1.5" data-testid="badge-business-hero">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Autonomous AI operations, built for real work
              </Badge>
            </RevealOnScroll>
            <RevealOnScroll delay={100}>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[0.98]" data-testid="text-business-hero-title">
                Hire an AI corporation, not another chatbot.
              </h1>
            </RevealOnScroll>
            <RevealOnScroll delay={200}>
              <p className="text-lg text-muted-foreground max-w-xl leading-relaxed" data-testid="text-business-hero-subtitle">
                {pn} runs research, reporting, documents, outreach, content, monitoring, and internal ops through a coordinated AI team. You stay in control. The busywork disappears.
              </p>
            </RevealOnScroll>
            <RevealOnScroll delay={300}>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" onClick={() => navigate("/signup")} className="gap-2 shadow-lg shadow-primary/25" data-testid="button-business-signup">
                  Start Free — No Credit Card <ArrowRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="lg" onClick={() => navigate("/store")} className="gap-2" data-testid="button-business-shop">
                  Shop Bob's Store <ArrowRight className="w-4 h-4" />
                </Button>
                <Button variant="outline" size="lg" onClick={() => document.getElementById("biz-workflows")?.scrollIntoView({ behavior: "smooth" })} data-testid="button-business-workflows">
                  See Example Workflows
                </Button>
              </div>
            </RevealOnScroll>
            <RevealOnScroll delay={400}>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> Real agents with defined roles</span>
                <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> Tool-driven execution</span>
                <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> Human approval on high-risk actions</span>
              </div>
            </RevealOnScroll>
          </div>
          <RevealOnScroll delay={200}>
            <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm shadow-2xl overflow-hidden" data-testid="business-command-preview">
              <div className="px-5 py-3.5 border-b border-border/60 flex items-center justify-between">
                <span className="text-sm font-medium">{pn} Command Center</span>
                <span className="text-xs font-bold text-emerald-500 flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> System live
                </span>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[{ l: "Specialist agents", v: "16" }, { l: "Connected tools", v: "359" }, { l: "Active capabilities", v: "110" }, { l: "Database tables", v: "176" }, { l: "Governance rules", v: "43" }, { l: "Model routes", v: "36+1000" }].map(s => (
                    <div key={s.l} className="bg-muted/40 dark:bg-white/[0.04] rounded-xl p-3.5 border border-border/40">
                      <div className="text-[11px] text-muted-foreground mb-1">{s.l}</div>
                      <div className="text-2xl font-bold">{s.v}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2.5">
                  {[
                    { title: "Weekly ops report generated", sub: "Research gathered, memo drafted, PDF delivered", tag: "Complete" },
                    { title: "Sales follow-up queued", sub: "Known contact email drafted, approval gate held", tag: "Ready" },
                    { title: "Homepage analysis finished", sub: "Trust gaps, messaging issues, and fixes identified", tag: "Reviewed" },
                  ].map(s => (
                    <div key={s.title} className="flex items-center justify-between bg-muted/30 dark:bg-white/[0.03] rounded-xl px-4 py-3 border border-border/40">
                      <div>
                        <div className="text-sm font-medium">{s.title}</div>
                        <div className="text-xs text-muted-foreground">{s.sub}</div>
                      </div>
                      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[11px] shrink-0">{s.tag}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </RevealOnScroll>
        </div>
        <RevealOnScroll delay={500}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-10">
            {["Research", "Documents", "Outreach", "Monitoring", "Execution"].map(p => (
              <div key={p} className="text-center py-3 rounded-xl border border-border/50 bg-muted/20 dark:bg-white/[0.03] text-sm font-medium text-muted-foreground">{p}</div>
            ))}
          </div>
        </RevealOnScroll>
      </div>
    </section>
  );
}

function BusinessPainPointsSection() {
  const pains: Array<{ icon: LucideIcon; pain: string; solution: string }> = [
    {
      icon: Shield,
      pain: "Compliance blocks generic cloud AI",
      solution: "Per-tenant data isolation, SOC2-aligned audit trails, and revocable credential vault. Your data never leaks across tenants.",
    },
    {
      icon: DollarSign,
      pain: "API bills that spike without warning",
      solution: "One predictable monthly tier. Mix premium models for orchestration with cheaper models for execution — you keep the savings.",
    },
    {
      icon: ArrowRightLeft,
      pain: "Locked into a single AI vendor",
      solution: "Assign any provider per persona — OpenAI, Claude, xAI, Gemini, OpenRouter. Swap anytime, no workflow rewrite.",
    },
    {
      icon: Workflow,
      pain: "Stitching together 10 disconnected tools",
      solution: "16 specialist agents and 359 tools sit in one workspace — research, write, design, ship, follow up. One inbox, one bill.",
    },
    {
      icon: Eye,
      pain: "AI that can't show what it's doing",
      solution: "Live Agent Diagram shows every active agent, what they're working on, and which provider they're using — in real time.",
    },
    {
      icon: Target,
      pain: "Hard to prove ROI to leadership",
      solution: "Built-in dashboards report tasks completed, hours saved, and revenue moved per agent. Bring receipts to your next budget review.",
    },
  ];
  return (
    <section
      id="section-biz-pains"
      className="py-20 px-6 border-t border-border"
      data-testid="section-biz-pains"
    >
      <div className="max-w-6xl mx-auto">
        <RevealOnScroll>
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-3 gap-1.5">
              <HelpCircle className="w-3.5 h-3.5" /> Sound Familiar?
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight" data-testid="text-biz-pains-title">
              The problems you face every day
            </h2>
            <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">
              Cloud AI is powerful — until it hits the wall of cost, control, and visibility. Here's how an autonomous AI corporation closes the gap.
            </p>
          </div>
        </RevealOnScroll>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pains.map((p) => {
            const Icon = p.icon;
            const slug = p.pain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            return (
              <Card
                key={p.pain}
                className="h-full"
                data-testid={`card-biz-pain-${slug}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-destructive/10 p-2 shrink-0">
                      <Icon className="w-5 h-5 text-destructive" />
                    </div>
                    <CardTitle className="text-base leading-snug" data-testid={`text-biz-pain-${slug}`}>
                      {p.pain}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                    <span data-testid={`text-biz-solution-${slug}`}>{p.solution}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BusinessWhoSection() {
  const { config } = useSiteConfig();
  const pn = config.platformName;
  const cards = [
    { icon: Zap, title: "Founders", desc: "Turn scattered tasks into one operating system for research, follow-up, reporting, and execution." },
    { icon: TrendingUp, title: "Revenue Teams", desc: "Keep pipeline movement consistent with briefs, summaries, outreach prep, and deal support that actually gets done." },
    { icon: Wrench, title: "Operators", desc: "Automate the glue work across notes, docs, status updates, internal checks, and recurring business routines." },
  ];
  return (
    <section id="section-biz-who" className="py-20 px-6 border-t border-border" data-testid="section-biz-who">
      <div className="max-w-6xl mx-auto">
        <RevealOnScroll>
          <div className="mb-12">
            <Badge variant="secondary" className="mb-4">Who It's For</Badge>
            <h2 className="text-3xl font-bold mb-3">Built for founders and teams drowning in repetitive work.</h2>
            <p className="text-muted-foreground max-w-2xl">{pn} is strongest when the work is valuable, recurring, and too fragmented for one person to keep up with manually.</p>
          </div>
        </RevealOnScroll>
        <div className="grid sm:grid-cols-3 gap-5">
          {cards.map((c, i) => (
            <RevealOnScroll key={c.title} delay={i * 80}>
              <Card className="h-full" data-testid={`card-biz-who-${c.title.toLowerCase().replace(/\s+/g, "-")}`}>
                <CardContent className="pt-6 pb-6 px-5 space-y-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 flex items-center justify-center">
                    <c.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">{c.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{c.desc}</p>
                </CardContent>
              </Card>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}

function BusinessPlatformSection() {
  const { config } = useSiteConfig();
  const pn = config.platformName;
  const features = [
    { icon: Brain, title: "Specialist Agents", desc: "Strategy, research, writing, build, sales, analytics, finance, legal, and operations roles work as one coordinated system." },
    { icon: Wrench, title: "Real Tool Use", desc: "Create PDFs, write files, browse sites, send emails, query memory, upload assets, and run workflows inside the same system — 359 tools total, managed by a centralized Tool Registry." },
    { icon: Database, title: "Project Continuity", desc: "Every conversation, asset, note, and file lives inside a retrievable project record so work survives across sessions." },
    { icon: ShieldCheck, title: "Approval Controls", desc: "Low-risk work runs immediately. Higher-risk actions, like new outreach or irreversible changes, stop for human sign-off." },
    { icon: CheckCircle2, title: "Ask Once, Get It Done", desc: "The Outcome Completion Gate detects incomplete work and self-corrects — research becomes a report, analysis becomes a PDF, without re-prompting." },
    { icon: Monitor, title: "Live Agent Board", desc: "Watch your AI team work in real-time. See which agents are active, what they're doing, and track every tool call on a live dashboard." },
    { icon: Eye, title: "Craftsmanship Standard", desc: "Every deliverable passes a universal quality gate. Presentations, emails, PDFs, and docs are validated for links, completeness, and accuracy — auto-rewritten if they fall short." },
    { icon: Lightbulb, title: "Ideation Engine", desc: "Structured brainstorming with 6 innovation frameworks — SCAMPER, Design Thinking, Blue Ocean, TRIZ, Lateral Thinking, and First Principles. Scored and ranked ideas." },
    { icon: Shield, title: "Self-Healing Operations", desc: "If an agent hits a problem, the system automatically recovers — rerouting to a backup specialist, retrying with a lighter workload, and explaining exactly what happened and why. Your work never stops midstream." },
    { icon: Palette, title: "Presentation Self-Correction", desc: "Vision-based QA scores every slide. If quality drops below threshold, the system autonomously rebuilds layouts, fixes text overflow, and re-delivers polished results." },
    { icon: Mic, title: "Parallel Video Production", desc: "Request a promotional video, explainer, or demo reel and get a finished MP4 — built with parallel chapter workers (up to 6x faster), narrated, with transitions, motion effects, and background music — automatically delivered to your Google Drive." },
    { icon: Rocket, title: "Always-On Infrastructure", desc: "Six independent traffic lanes keep your AI team responsive even under heavy load. Automatic crash recovery, token refresh, and health monitoring mean zero downtime during critical work." },
    { icon: Layers, title: "Tool Registry System", desc: "Every tool is cataloged in a centralized registry with categories, speed class, and product tracking. Startup audits ensure nothing is invisible. 359 tools across 22 categories with bidirectional integrity checks." },
    { icon: ShieldCheck, title: "Pause for Approval, Resume Where It Stopped", desc: "Long-running plans can pause for your sign-off and pick up exactly where they left off — no replay, no lost context. Stale approvals expire automatically so nothing stalls forever." },
    { icon: DollarSign, title: "Revenue-vs-Cost Self-Regulation", desc: "Your AI watches its own profit margins. When spend rises faster than revenue, it automatically downgrades to cheaper models and lighter tools — protecting profitability without you lifting a finger." },
    { icon: Activity, title: "Per-Agent Spending Visibility", desc: "Every tool call, model call, and orchestration is recorded against the agent that ran it. See in real time who's expensive, who's efficient, and where the spend is going." },
    { icon: Users, title: "Panel-of-Experts Mode", desc: "For high-stakes questions, your AI doesn't ask one model — it asks four in parallel and has a senior model (Claude Opus) synthesize the best answer. You get ensemble-quality reasoning at a transparent, ledgered cost." },
    { icon: Eye, title: "Wearable AI (Smart Glasses)", desc: "Pair Meta Ray-Ban smart glasses with your tenant. Your AI team sees what you see, hears what you hear, and replies with sub-second voice — all 359 tools available hands-free, from logging expenses to capturing project notes." },
    { icon: Brain, title: "Knows You Personally", desc: "Each tenant has a personal profile that the AI reads into every conversation — preferences, context, terminology, current projects. No more re-explaining who you are or what you're working on." },
    { icon: Sparkles, title: "Self-Healing Conversations", desc: "Long sessions never die mid-thought. When context fills up, the system automatically trims oversized tool results and continues — and 3-phase dreaming consolidates important threads into permanent memory while you sleep." },
    { icon: FileCode, title: "Self-Improving Codebase", desc: "Nightly research can propose real code improvements — but every proposal is shadow-compiled in an isolated workspace and reviewed before it can touch the live system. You see the diff, the verifier verdict, and click Approve. One-click revert restores the original if anything misbehaves." },
    { icon: Sparkles, title: "Brand-Voice MarTech Bundle (R79)", desc: "Six per-tenant content tools — your AI learns your voice from sample posts, drafts hooks across 6 angles, formats posts in PAS / AIDA / STAR / 4Ps with platform-aware caps for LinkedIn / X / newsletter, plans a full content matrix, and scores any post against YOUR voice profile with a 0–100 critique. Hardened against prompt injection so customer-supplied samples can't hijack the AI." },
    { icon: Layers, title: "Plug In Any Claude Code Agent (R80, NEW)", desc: "Found a great open-source AI agent on GitHub? Paste the URL — your VisionClaw inherits it as a fully-wired persona in seconds. A translation adapter teaches the imported agent how to use VisionClaw's real tools, role-based blocks stop it from running anything risky, and dangerous actions still require your approval. Curated collections of vetted public agents are one click away." },
  ];
  return (
    <section id="section-biz-platform" className="py-20 px-6 bg-muted/30 border-t border-border" data-testid="section-biz-platform">
      <div className="max-w-6xl mx-auto">
        <RevealOnScroll>
          <div className="mb-12">
            <Badge variant="secondary" className="mb-4">What {pn} Does</Badge>
            <h2 className="text-3xl font-bold mb-3">An AI team that can actually do the work, not just talk about it.</h2>
            <p className="text-muted-foreground max-w-2xl">Each department has a role. Research agents gather facts. Writing agents draft assets. Build agents create files. Control rules decide what can run automatically and what waits for approval.</p>
          </div>
        </RevealOnScroll>
        <div className="grid sm:grid-cols-2 gap-5">
          {features.map((f, i) => (
            <RevealOnScroll key={f.title} delay={i * 80}>
              <Card className="h-full" data-testid={`card-biz-feature-${f.title.toLowerCase().replace(/\s+/g, "-")}`}>
                <CardContent className="pt-6 pb-6 px-5 space-y-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 flex items-center justify-center">
                    <f.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}

function BusinessWorkflowsSection() {
  const { config } = useSiteConfig();
  const pn = config.platformName;
  const workflows = [
    { icon: Search, title: "Research to Decision Memo", desc: "Gather sources, compare findings, draft the recommendation, save the document, and keep the source trail attached.", steps: ["Search and synthesize the market", "Draft a short executive memo", "Save and file the deliverable"] },
    { icon: FileText, title: "Notes to Customer-Ready PDF", desc: "Turn rough inputs into a polished report, proposal, guide, or internal brief with a shareable asset link.", steps: ["Structure the content", "Generate the document", "Upload and deliver the file"] },
    { icon: Mail, title: "Ops Follow-Up Without Dropped Balls", desc: "Track what changed, monitor inboxes, prep replies, and keep important work moving without relying on memory alone.", steps: ["Check status and history", "Draft the next action", "Hold risky sends for approval"] },
    { icon: Scale, title: "Contract Review & Compliance", desc: "Upload any contract and get a safety score, clause-by-clause risk analysis, missing protections, and compliance gaps across 9 regulatory frameworks.", steps: ["Analyze contract with 20 risk patterns", "Score compliance against applicable frameworks", "Generate negotiation recommendations"] },
  ];
  return (
    <section id="biz-workflows" className="py-20 px-6 border-t border-border" data-testid="section-biz-workflows">
      <div className="max-w-6xl mx-auto">
        <RevealOnScroll>
          <div className="mb-12">
            <Badge variant="secondary" className="mb-4">Real Workflows</Badge>
            <h2 className="text-3xl font-bold mb-3">End-to-end workflows, not just answers.</h2>
            <p className="text-muted-foreground max-w-2xl">{pn} doesn't stop at suggestions. It completes the full loop — research, draft, build, deliver — with real tools and real outputs.</p>
          </div>
        </RevealOnScroll>
        <div className="grid sm:grid-cols-2 gap-5">
          {workflows.map((w, i) => (
            <RevealOnScroll key={w.title} delay={i * 80}>
              <Card className="h-full" data-testid={`card-biz-workflow-${i}`}>
                <CardContent className="pt-6 pb-6 px-5 space-y-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 flex items-center justify-center">
                    <w.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">{w.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{w.desc}</p>
                  <ol className="space-y-1.5 pt-1">
                    {w.steps.map((s, si) => (
                      <li key={si} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{si + 1}</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}

function BusinessCompareSection() {
  const { config } = useSiteConfig();
  const pn = config.platformName;
  return (
    <section className="py-20 px-6 bg-muted/30 border-t border-border" data-testid="section-biz-compare">
      <div className="max-w-5xl mx-auto">
        <RevealOnScroll>
          <div className="mb-12">
            <Badge variant="secondary" className="mb-4">Why Teams Switch</Badge>
            <h2 className="text-3xl font-bold mb-3">Most AI products stop at ideas. {pn} finishes the loop.</h2>
            <p className="text-muted-foreground max-w-2xl">The difference is not intelligence alone. It is execution, memory, control, and reliability in one place.</p>
          </div>
        </RevealOnScroll>
        <div className="grid sm:grid-cols-2 gap-5">
          <RevealOnScroll>
            <Card className="h-full border-red-500/20 bg-red-500/[0.02] dark:bg-red-500/[0.04]" data-testid="card-compare-typical">
              <CardContent className="pt-6 pb-6 px-5 space-y-4">
                <h3 className="text-lg font-semibold">Typical AI Assistant</h3>
                <ul className="space-y-3">
                  {["Answers questions, but rarely completes the workflow", "Loses context between sessions", "Needs constant prompting and manual follow-up", "Feels impressive in demos, weak in operations"].map(item => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <div className="w-2 h-2 rounded-full bg-red-400/60 shrink-0 mt-1.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </RevealOnScroll>
          <RevealOnScroll delay={100}>
            <Card className="h-full border-emerald-500/20 bg-emerald-500/[0.02] dark:bg-emerald-500/[0.04]" data-testid="card-compare-visionclaw">
              <CardContent className="pt-6 pb-6 px-5 space-y-4">
                <h3 className="text-lg font-semibold">{pn}</h3>
                <ul className="space-y-3">
                  {["Executes tasks through 359 connected tools and 16 agent roles", "Stores project memory, notes, and assets for continuity", "Self-corrects incomplete work — ask once, get a complete deliverable", "Uses approval gates where business risk is real", "Auto-recovers from failures with backup agents and clear explanations", "Designed for repeatable operating leverage"].map(item => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <div className="w-2 h-2 rounded-full bg-emerald-400/80 shrink-0 mt-1.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </RevealOnScroll>
        </div>
      </div>
    </section>
  );
}

function BusinessTrustSection() {
  const { config } = useSiteConfig();
  const pn = config.platformName;
  return (
    <section id="section-biz-trust" className="py-20 px-6 border-t border-border" data-testid="section-biz-trust">
      <div className="max-w-6xl mx-auto">
        <RevealOnScroll>
          <div className="mb-12">
            <Badge variant="secondary" className="mb-4">Control & Trust</Badge>
            <h2 className="text-3xl font-bold mb-3">Autonomy without blind risk.</h2>
            <p className="text-muted-foreground max-w-2xl">Every action is governed by trust scores, approval gates, and operational rules. You set the boundaries. {pn} works within them.</p>
          </div>
        </RevealOnScroll>
        <div className="grid sm:grid-cols-2 gap-5">
          <RevealOnScroll>
            <Card className="h-full" data-testid="card-trust-rules">
              <CardContent className="pt-6 pb-6 px-5 space-y-4">
                <h3 className="text-lg font-semibold">Execution rules you can understand</h3>
                <ul className="space-y-3">
                  {[
                    "Routine research, file creation, and internal organization can run immediately.",
                    "External outreach to new contacts waits for explicit approval.",
                    "Financial, legal, public, and irreversible actions stay behind human sign-off.",
                    "Projects keep an audit trail of outputs, notes, and delivered assets.",
                  ].map(item => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </RevealOnScroll>
          <RevealOnScroll delay={100}>
            <Card className="h-full" data-testid="card-trust-safety">
              <CardContent className="pt-6 pb-6 px-5 space-y-4">
                <h3 className="text-lg font-semibold">Built-in safety architecture</h3>
                <ul className="space-y-3">
                  {[
                    "Five silently-degraded security primitives caught and restored in the R98.19+sec whole-app review (architect rounds 1 + 2 + 3). The pattern: legacy hardening code used the wrong import style, so the security check would crash invisibly and pass the request through. Among the closed gaps — provider error messages flowing to agents now scrub our own API keys before display; shell-command output handed to delegated agents now lands inside a fresh random fence so a hostile string can't pretend to be instructions; and the GitHub-imported-agent pipeline now actually runs its prompt-injection scanner on every imported persona body (it had been quietly skipping the scan). When the scanner itself fails for any reason, the import is now hard-quarantined — never passed through unscanned.",
                    "Long-session memory now ranks recalled facts by confidence × recency × access-frequency, dedupes near-duplicate writes inside a 30-second window, and caps the recall context at 8K tokens so a long thread never starves the live conversation budget — the system gets sharper over weeks instead of louder (R98.19 Memory v2).",
                    "Dependency supply chain hardened — two HIGH-severity CVEs closed in the R98.18+sec self-healing round: a SQL-injection identifier-escape bug in our database layer (drizzle-orm 0.39 → 0.45, GHSA-gpj5-g38j-94v9) and the prototype-pollution + regex-DoS issues in the `xlsx` library, which had no upstream patch available. We migrated our one runtime spreadsheet call to the already-installed `exceljs` instead of waiting on a fix that wasn't coming. npm audit went from 2 HIGH to zero overnight.",
                    "Provider error messages are scrubbed of secrets before any agent sees them — even our own API keys round-tripping through a 401 from a third-party model now land redacted, and the same scrubber masks anything resembling a credential before it can be quoted into a chat reply (R98.16+sec-2 CRITICAL closed).",
                    "Web fetches blocked from reaching cloud-metadata IPs, private networks, internal cluster TLDs (`.internal`, `.cluster.local`, `.svc`), multicast addresses, IPv6 link-local, and CGNAT — closes the path where a model-controlled URL could pivot from one of our hosted browsers into private infrastructure (R98.16+sec-2 HIGH closed, building on R96 SSRF jail).",
                    "Critical state files (job spool, code-health snapshots, video render state, research findings, skill manifest) survive a power-loss mid-write — every atomic save fsyncs both the file AND the parent directory, so a crash between rename and pagecache-flush no longer leaves an empty file (R98.16).",
                    "Adversarial Humanities Benchmark (AHB) defense — every message is destyled to its literal intent before the AI sees it, catching jailbreaks dressed up in poetry, allegory, or role-play. Captured page titles, oEmbed responses, and shell output are now also defanged of fake markdown headings and pseudo-system XML tags (`<system>`, `<assistant>`, `<|im_start|>`) before they reach a model prompt (R98.16).",
                    "Destructive-tool firewall — payments, deletes, credential-touching tools, and shell-execution tools require typed arguments, trusted personas, approvals, and dollar caps. Unknown tools fail closed.",
                    "Four-tier web access ladder with auto-escalation — web_fetch → firecrawl → stealth_browse → Camofox stealth microservice. Blocked-page detection injects a fallback hint into the next turn so the agent climbs the ladder instead of giving up. Per-(tenant, persona) cookie isolation; SSRF guard on every URL.",
                    "40 governance rules enforce operational boundaries across every agent.",
                    "Trust scores track each agent's reliability and adjust autonomy dynamically.",
                    "Multi-model failover ensures no single provider outage stops work.",
                    "Full audit trail on every tool call, decision, and refusal — including the security tables that survive a process crash.",
                  ].map(item => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </RevealOnScroll>
        </div>
      </div>
    </section>
  );
}

function BusinessFaqSection() {
  const { config: _faqConfig } = useSiteConfig();
  const [open, setOpen] = useState<number | null>(0);
  const faqs = [
    { q: "Is this just another AI chatbot?", a: `No. ${_faqConfig.platformName} is an operating system for AI work. It uses specialist roles, connected tools, stored project memory, and execution rules to complete business tasks end to end — not just answer questions.` },
    { q: "What kinds of work fit best?", a: "Research, reporting, recurring documentation, internal operations, deliverable creation, monitoring, and structured follow-up work are the strongest fits." },
    { q: "How do we stay in control?", a: "The system can act autonomously on low-risk work. Higher-risk actions, like sending to new external contacts or making irreversible changes, pause for your approval before proceeding." },
    { q: "Who is this best for right now?", a: "Founders, lean teams, operators, and service businesses that want more throughput without hiring a larger support layer for repetitive work." },
  ];
  return (
    <section id="section-biz-faq" className="py-20 px-6 bg-muted/30 border-t border-border" data-testid="section-biz-faq">
      <div className="max-w-3xl mx-auto">
        <RevealOnScroll>
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-4">FAQ</Badge>
            <h2 className="text-3xl font-bold mb-3">Common Questions</h2>
            <p className="text-muted-foreground">Answers to the things business owners and evaluators ask most.</p>
          </div>
        </RevealOnScroll>
        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <RevealOnScroll key={i} delay={i * 60}>
              <Card className="overflow-hidden" data-testid={`faq-item-${i}`}>
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="w-full text-left px-5 py-4 flex items-center justify-between gap-3"
                >
                  <span className="font-semibold text-sm">{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${open === i ? "rotate-180" : ""}`} />
                </button>
                {open === i && (
                  <div className="px-5 pb-4">
                    <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </Card>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}

function BusinessCtaSection({ navigate }: { navigate: (path: string) => void }) {
  const { config } = useSiteConfig();
  const pn = config.platformName;
  return (
    <section className="relative py-24 px-6 border-t border-border overflow-hidden" data-testid="section-biz-cta">
      <div className="absolute inset-0 bg-gradient-to-t from-primary/[0.04] via-transparent to-transparent" />
      <RevealOnScroll>
        <div className="relative max-w-4xl mx-auto">
          <Card className="bg-gradient-to-br from-blue-500/[0.06] to-violet-500/[0.06] dark:from-blue-500/[0.1] dark:to-violet-500/[0.1] border-primary/20 shadow-xl">
            <CardContent className="p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div className="space-y-3">
                <Badge variant="secondary" className="mb-1">Next Step</Badge>
                <h2 className="text-2xl sm:text-3xl font-bold">Ready to put your operations on autopilot?</h2>
                <p className="text-muted-foreground max-w-lg">See how {pn} handles your real workflows — research, reporting, outreach, and ops — with a live walkthrough tailored to your business.</p>
              </div>
              <div className="flex flex-wrap gap-3 shrink-0">
                <Button size="lg" onClick={() => navigate("/signup")} className="gap-2 shadow-lg shadow-primary/25" data-testid="button-biz-cta-signup">
                  Start Free Now <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </RevealOnScroll>
    </section>
  );
}

interface PublicStats {
  totalConversations: number;
  totalMessages: number;
  totalAutonomousTasks: number;
  totalMemories: number;
  uptime: number;
}

type ActivityEvent = {
  id: number;
  agent: string;
  icon: LucideIcon;
  action: string;
  detail: string;
  type: "task" | "revenue" | "delegation" | "memory" | "analysis" | "social";
  value?: string;
};

const ACTIVITY_EVENTS: Omit<ActivityEvent, "id">[] = [
  { agent: "Felix", icon: Crown, action: "Orchestration complete", detail: "Decomposed complex request into 5-step DAG — delegated to Radar, Scribe, and Proof", type: "delegation" },
  { agent: "Radar", icon: Search, action: "Nightly research complete", detail: "15 experiments run, 5 findings kept — competitive analysis knowledge auto-injected", type: "analysis", value: "+5 findings" },
  { agent: "Proof", icon: Shield, action: "Auto-QA review scored 9.2", detail: "Reviewed Scribe's deliverable — completeness: 10, accuracy: 9, clarity: 9, professionalism: 9", type: "delegation", value: "9.2/10" },
  { agent: "VisionClaw", icon: Bot, action: "Dream consolidation complete", detail: "Merged 8 duplicate memories, archived 12 stale entries, promoted 3 findings to permanent knowledge", type: "memory" },
  { agent: "Forge", icon: Wrench, action: "Code proposal generated", detail: "Research finding auto-generated code proposal for new agent architecture pattern", type: "task" },
  { agent: "Felix", icon: Crown, action: "Styled PDF delivered", detail: "Executive report with cover page, stats grid, branded sections — auto-uploaded to Google Drive", type: "task", value: "PDF Ready" },
  { agent: "Scribe", icon: PenTool, action: "Word document created", detail: "SOW with styled headings, data tables, bullet lists, headers/footers — .docx uploaded to Drive", type: "task" },
  { agent: "Cassandra", icon: Scale, action: "Excel model built", detail: "Financial model: 3 sheets, 42 formulas, auto-filters, frozen headers — .xlsx uploaded to Drive", type: "task", value: "Model Ready" },
  { agent: "Luna", icon: Gavel, action: "Compliance scan complete", detail: "All 40 governance rules validated — zero violations. NIST/OWASP frameworks current", type: "task" },
  { agent: "Neptune", icon: Globe, action: "Deep research delivered", detail: "48-page wellness intervention analysis with crisis response scripts — 10 findings kept", type: "analysis", value: "+10 findings" },
  { agent: "VisionClaw", icon: Bot, action: "Skill Seeker activated", detail: "Detected capability gap, researched GitHub/npm, built new tool — 5-layer safety scan passed", type: "task", value: "New Tool" },
  { agent: "Apollo", icon: BarChart3, action: "Revenue analysis complete", detail: "Pricing strategy with styled PDF report and Excel budget model — both auto-delivered to Drive", type: "analysis", value: "+4 insights" },
  { agent: "Atlas", icon: Activity, action: "Model routing optimized", detail: "Smart routing saved $2,342 this month — OAuth-first routing cut API costs 41%", type: "analysis", value: "-$2.3K cost" },
  { agent: "Apollo", icon: DollarSign, action: "New deal closed", detail: "Enterprise client signed 12-month contract — AI-generated proposal and financial model sealed the deal", type: "revenue", value: "$4.2K" },
  { agent: "Chief of Staff", icon: Crown, action: "Heartbeat 100% healthy", detail: "93/93 autonomous tasks completed successfully — self-reflection, backups, model scout all green", type: "delegation" },
  { agent: "Teagan", icon: PenTool, action: "Campaign created", detail: "Complete LinkedIn post with AI-generated image, hashtags, and CTA — ready to publish", type: "social", value: "Post Ready" },
  { agent: "Cassandra", icon: DollarSign, action: "Invoice processed", detail: "Quarterly billing cycle complete — 3 invoices generated and delivered, revenue tracking updated", type: "revenue", value: "$2.8K" },
  { agent: "Apollo", icon: DollarSign, action: "Upsell opportunity found", detail: "Existing client expanded to Enterprise tier after AI-driven ROI analysis presentation", type: "revenue", value: "$1.5K" },
  { agent: "Blueprint", icon: Workflow, action: "Architecture research", detail: "Nightly agent architecture scan found 3 new patterns — instinct learning updated", type: "analysis", value: "+3 patterns" },
  { agent: "VisionClaw", icon: Bot, action: "Instinct graduated", detail: "Multi-tool pattern reached 70%+ confidence after 3 observations — promoted to permanent knowledge", type: "memory" },
  { agent: "Radar", icon: Search, action: "Security intelligence", detail: "Nightly security scan complete — 6 findings auto-injected into Luna's knowledge base", type: "analysis", value: "+6 alerts" },
  { agent: "Felix", icon: Crown, action: "Crew deployed", detail: "Created 3-agent content crew — Radar researching, Scribe writing, Proof reviewing — running in parallel", type: "delegation", value: "Crew Active" },
  { agent: "Atlas", icon: Activity, action: "Financial snapshot delivered", detail: "Q1 2026 summary: revenue $47.2K, expenses $23.1K, net profit $24.1K, health score 87/100", type: "analysis", value: "$24.1K profit" },
  { agent: "Felix", icon: Crown, action: "Flow pipeline complete", detail: "Weekly report pipeline: 4 steps executed — research → write → review → deliver — all passed QA", type: "delegation", value: "Flow Done" },
  { agent: "Luna", icon: Gavel, action: "Contract reviewed", detail: "SaaS agreement scored 72/100 safety — flagged unlimited liability clause, missing IP protections, one-sided termination", type: "task", value: "72/100" },
];

const TYPE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  task: { color: "text-blue-500", bg: "bg-blue-500/10", label: "Task" },
  revenue: { color: "text-emerald-500", bg: "bg-emerald-500/10", label: "Revenue" },
  delegation: { color: "text-amber-500", bg: "bg-amber-500/10", label: "Delegation" },
  memory: { color: "text-purple-500", bg: "bg-purple-500/10", label: "Memory" },
  analysis: { color: "text-cyan-500", bg: "bg-cyan-500/10", label: "Intel" },
  social: { color: "text-pink-500", bg: "bg-pink-500/10", label: "Social" },
};

function LiveActivityDemo() {
  const { config } = useSiteConfig();
  const pn = config.platformName;
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [revenue, setRevenue] = useState(0);
  const [tasksComplete, setTasksComplete] = useState(0);
  const nextIdRef = useRef(0);
  const eventIndexRef = useRef(0);

  useEffect(() => {
    const initial: ActivityEvent[] = [];
    for (let i = 0; i < 4; i++) {
      initial.push({ ...ACTIVITY_EVENTS[i], id: nextIdRef.current++ });
    }
    eventIndexRef.current = 4;
    setEvents(initial);
    setTasksComplete(4);
    setRevenue(18400);

    const interval = setInterval(() => {
      const idx = eventIndexRef.current % ACTIVITY_EVENTS.length;
      const evt = ACTIVITY_EVENTS[idx];
      eventIndexRef.current++;

      setEvents((prev) => {
        const next = [{ ...evt, id: nextIdRef.current++ }, ...prev];
        return next.slice(0, 8);
      });
      setTasksComplete((p) => p + 1);
      if (evt.type === "revenue") {
        const match = evt.value?.match(/[\d,.]+/);
        if (match) {
          const num = parseFloat(match[0].replace(",", "")) * 1000;
          setRevenue((p) => p + (evt.value?.includes("-") ? 0 : num));
        }
      }
    }, 3200);

    return () => clearInterval(interval);
  }, []);

  return (
    <section id="section-demo" className="py-20 px-6 bg-muted/30 border-t border-border" data-testid="section-demo">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-4 gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Live Simulation
          </Badge>
          <h2 className="text-3xl font-bold mb-3" data-testid="text-demo-title">Watch Your AI Corporation Work</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            This is what {pn} looks like in action — agents completing tasks, delegating to specialists, 
            running research, and managing operations, all without human intervention.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4 h-[540px] overflow-hidden" style={{ contain: "strict" }}>
          <div className="grid lg:grid-cols-3 gap-4 h-full">
            <div className="lg:col-span-2 h-full">
              <Card className="h-full flex flex-col">
                <CardHeader className="pb-3 shrink-0">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Agent Activity Feed
                    </CardTitle>
                    <Badge variant="outline" className="text-xs gap-1">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                      </span>
                      Running
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden">
                  <div className="space-y-2 h-full overflow-hidden" role="log" aria-live="polite" aria-relevant="additions" data-testid="demo-activity-feed">
                    {events.map((event, i) => {
                      const Icon = event.icon;
                      const typeStyle = TYPE_CONFIG[event.type];
                      return (
                        <div
                          key={event.id}
                          className={`flex items-start gap-3 p-3 rounded-lg border border-border/50 transition-all duration-500 ${
                            i === 0 ? "animate-in slide-in-from-top-2 motion-reduce:animate-none bg-primary/[0.03]" : "opacity-80"
                          }`}
                          data-testid={`demo-event-${event.id}`}
                        >
                          <div className={`w-8 h-8 rounded-md ${typeStyle.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                            <Icon className={`w-4 h-4 ${typeStyle.color}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{event.agent}</span>
                              <span className="text-xs text-muted-foreground">&middot;</span>
                              <span className="text-sm text-muted-foreground">{event.action}</span>
                              {event.value && (
                                <Badge variant="secondary" className={`text-xs ${typeStyle.color}`}>
                                  {event.value}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.detail}</p>
                          </div>
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-1" />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4 overflow-hidden">
              <Card>
                <CardContent className="pt-5 pb-5 px-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-emerald-500" />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Revenue Generated</div>
                      <div className="text-2xl font-bold text-emerald-500" data-testid="text-demo-revenue">
                        ${revenue.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-emerald-600">
                    <TrendingUp className="w-3 h-3" />
                    <span>+23% this quarter</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5 pb-5 px-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <CheckCircle2 className="w-5 h-5 text-blue-500" />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Tasks Completed</div>
                      <div className="text-2xl font-bold" data-testid="text-demo-tasks">{tasksComplete}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Zap className="w-3 h-3" />
                    <span>Fully autonomous</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5 pb-5 px-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-pink-500/10 flex items-center justify-center">
                      <Share2 className="w-5 h-5 text-pink-500" />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Social Posts Created</div>
                      <div className="text-2xl font-bold" data-testid="text-demo-social">
                        {Math.floor(tasksComplete * 0.25)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-pink-500">
                    <Image className="w-3 h-3" />
                    <span>With AI-generated images</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5 pb-5 px-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                      <Brain className="w-5 h-5 text-purple-500" />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Memories Stored</div>
                      <div className="text-2xl font-bold" data-testid="text-demo-memories">
                        {Math.floor(tasksComplete * 1.8)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Sparkles className="w-3 h-3" />
                    <span>Learns from every task</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      number: "01",
      title: "Sign Up & Meet Your Team",
      description: "Create your account and get instant access to all 16 AI agents. Each one is already trained with specialized expertise.",
      icon: Users,
    },
    {
      number: "02",
      title: "Give Instructions or Let Them Work",
      description: "Chat naturally, use voice, or set up autonomous tasks. Your AI team understands context and collaborates to get things done.",
      icon: MessageSquare,
    },
    {
      number: "03",
      title: "Review & Approve",
      description: "High-impact actions need your approval. Everything else runs autonomously. You stay in control without micromanaging.",
      icon: ShieldCheck,
    },
    {
      number: "04",
      title: "Scale Your Operations",
      description: "As your AI team learns your preferences, they work faster and smarter. Add your own API keys for unlimited capacity.",
      icon: Rocket,
    },
  ];

  return (
    <section className="py-20 px-6 border-t border-border" data-testid="section-how-it-works">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <Badge variant="secondary" className="mb-4">4 Simple Steps</Badge>
          <h2 className="text-3xl font-bold mb-3">How It Works</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            From sign-up to fully autonomous AI operations in minutes, not months.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.number} className="relative" data-testid={`step-${step.number}`}>
                <div className="text-5xl font-bold text-primary/10 mb-3">{step.number}</div>
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function UseCases() {
  const { config } = useSiteConfig();
  const pn = config.platformName;
  const cases = [
    {
      title: "Startup Founder",
      description: "Let your AI team handle marketing, content, research, and operations while you focus on product and customers.",
      agents: ["Felix", "Scribe", "Radar", "Apollo"],
      result: "Save 40+ hours/week on operational work",
    },
    {
      title: "Marketing Agency",
      description: "Generate social media content with AI images, manage content calendars, run A/B tests, and track performance.",
      agents: ["Teagan", "Neptune", "Atlas", "Proof"],
      result: "10x content output with consistent brand voice",
    },
    {
      title: "Freelancer / Consultant",
      description: "Auto-generate proposals (Word), financial models (Excel), styled reports (PDF), and slide decks — all branded and delivered to Google Drive.",
      agents: ["Felix", "Scribe", "Cassandra", "Apollo"],
      result: "Handle 3x more clients with the same hours",
    },
    {
      title: "Small Business Owner",
      description: "Customer support chatbot, automated bookkeeping insights, competitive monitoring, and compliance tracking.",
      agents: ["VisionClaw", "Cassandra", "Radar", "Luna"],
      result: "Run a leaner operation with AI-powered efficiency",
    },
  ];

  return (
    <section id="section-use-cases" className="py-20 px-6 bg-muted/30 border-t border-border" data-testid="section-use-cases">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-4">Use Cases</Badge>
          <h2 className="text-3xl font-bold mb-3">Built for How You Work</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Whether you're a solo founder or a growing team, {pn} adapts to your workflow.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-5">
          {cases.map((uc) => (
            <Card key={uc.title} data-testid={`card-usecase-${uc.title.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardContent className="pt-6 pb-6 px-6 space-y-4">
                <h3 className="font-semibold text-lg">{uc.title}</h3>
                <p className="text-sm text-muted-foreground">{uc.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  {uc.agents.map((a) => (
                    <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-sm text-emerald-500 font-medium">
                  <TrendingUp className="w-4 h-4" />
                  <span>{uc.result}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function CommandCenterStats({ stats }: { stats?: PublicStats }) {
  const { ref, visible } = useInView(0.2);
  const reduced = usePrefersReducedMotion();
  const uptimeHours = Math.floor((Date.now() - new Date("2025-10-01").getTime()) / 3600000);
  const agents = useCountUp(16, 1500, visible);
  const tools = useCountUp(359, 2000, visible);
  // R115.5+sec round 3 — surface counters synced to live SoT in replit.md aggregate.
  const models = useCountUp(36, 1800, visible);
  const skills = useCountUp(62, 1600, visible);
  const tables = useCountUp(173, 2200, visible);
  const govRules = useCountUp(43, 1800, visible);
  const capabilities = useCountUp(110, 2100, visible);
  void capabilities;
  const STAT_ITEMS = [
    { label: "AI Agents", value: agents, suffix: "", icon: Users, color: "text-blue-400" },
    { label: "Tools", value: tools, suffix: "", icon: Wrench, color: "text-emerald-400" },
    { label: "AI Skills", value: skills, suffix: "", icon: Lightbulb, color: "text-amber-400" },
    { label: "AI Models", value: models, suffix: "+", icon: Cpu, color: "text-violet-400" },
    { label: "DB Tables", value: tables, suffix: "", icon: Database, color: "text-cyan-400" },
    { label: "Gov Rules", value: govRules, suffix: "", icon: Shield, color: "text-rose-400" },
  ];
  const show = reduced || visible;
  return (
    <div ref={ref} className="relative bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 border-y border-white/10 py-8 px-6 overflow-hidden" data-testid="section-command-center">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/[0.06] via-transparent to-transparent" />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      </div>
      <div className="relative max-w-5xl mx-auto">
        <div className="flex items-center justify-center gap-2 mb-6">
          <Terminal className="w-4 h-4 text-primary/70" />
          <span className="text-xs font-mono text-primary/70 tracking-wider uppercase">Command Center — Live Metrics</span>
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse motion-reduce:animate-none" />
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-4 md:gap-6">
          {STAT_ITEMS.map((item, i) => (
            <div
              key={item.label}
              className={`text-center transition-all ${reduced ? "duration-0" : "duration-700"} ${show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
              style={reduced ? undefined : { transitionDelay: `${i * 100}ms` }}
            >
              <item.icon className={`w-5 h-5 mx-auto mb-1.5 ${item.color}`} />
              <div className="text-2xl md:text-3xl font-bold text-white font-mono tabular-nums">
                {item.value}{item.suffix}
              </div>
              <div className="text-[11px] text-gray-400 mt-1 tracking-wide uppercase">{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [, navigate] = useLocation();
  const { config } = useSiteConfig();
  const pn = config.platformName;
  const [viewMode, setViewMode] = useState<LandingMode>(() => {
    try { return (localStorage.getItem("vc_landing_mode") as LandingMode) || "business"; } catch { return "business"; }
  });

  const handleModeChange = (m: LandingMode) => {
    setViewMode(m);
    try { localStorage.setItem("vc_landing_mode", m); } catch {}
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const { data: stats } = useQuery<PublicStats>({
    queryKey: ["/api/public/stats"],
    refetchInterval: 30000,
  });

  const uptimeHours = Math.floor((Date.now() - new Date("2025-10-01").getTime()) / 3600000);

  const techNavTabs = [
    { id: "section-demo", label: "Demo" },
    { id: "section-capabilities", label: "Features" },
    { id: "section-agents", label: "Agents" },
    { id: "section-use-cases", label: "Use Cases" },
    { id: "section-pricing", label: "Pricing" },
  ];
  const bizNavTabs = [
    { id: "section-biz-who", label: "Who It's For" },
    { id: "section-biz-pains", label: "Pain Points" },
    { id: "section-biz-platform", label: "Platform" },
    { id: "biz-workflows", label: "Workflows" },
    { id: "section-biz-trust", label: "Trust" },
    { id: "section-biz-faq", label: "FAQ" },
  ];
  const navTabs = viewMode === "business" ? bizNavTabs : techNavTabs;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SeoHead
        title={`${pn} — Autonomous AI Corporation for Business`}
        description={"Deploy a 16-agent AI team with 359 tools (+4 MCP memory tools external surface), 110 active capabilities, 176 database tables, 507 indexes, 24 + 62 + 25 skills, and 43 governance rules. Latest: R116 — rohitg00/agentmemory Tier-A bundle (five nuggets in one round). N2 per-category Ebbinghaus decay (memory_entries.last_reinforced_at + memory_categories.half_life_days; ranker decays facts at per-category rates — architecture decisions 90d, transient bugs 3d). N6 active contradiction resolver scoring authority+recency+support×confidence, hooked into MoA κ-low escalation as fail-OPEN belt-and-suspenders. N7 heuristic quality_score gate grading every queue-routed memory write 0..1 on structural signals; folded multiplicatively into the ranker. N9 MCP memory scope: 4 NEW MCP tools (`memory_smart_search` / `memory_save` / `memory_supersede` / `memory_list_recent`) + 2 NEW scopes (`memory:read` / `memory:write`), all fail-CLOSED on missing scope. N14 typed edge taxonomy on memory_links (link_type ∈ {uses, depends_on, contradicts, caused, fixed, supersedes, related}, DB CHECK constraint + coerceLinkType guard). Schema deltas via psql ALTER: tables 174→176, indexes 454→507. Architect round 1 caught a memory_supersede orphan bug → fixed same round; round 2 (cross-app sweep) found 2 MEDIUMs + 1 LOW, all closed: memoryEntrySafeCols projection now includes lastReinforcedAt + qualityScore (M1 fix), MoA resolver inert-here-useful-elsewhere documented (M2 ack), getLinkedMemories now tenant-parameterized REQUIRED (L1 fix). verify-agent-wiring CLEAN. 26/26 tests PASS. R115.5+sec round 3 (\"Fix All Issues, Defer Nothing\") closed three defense-in-depth gaps: TOOL_POLICIES full backfill (every one of 359 tools has explicit policy row, 8 destructive hardened to require BOTH approval+trusted), storage tenant-scope required, /deliverables explicit allowlist. R113.7+sec — MCP-server expose (NEW `POST /mcp` Streamable HTTP endpoint with stateless per-request transport + per-request `McpServer` instance + cleanup on `res.close`, plus unauthenticated `GET /mcp/health`). NEW table `mcp_api_keys` (tenantId notNull, key_prefix unique idx, sha256 key_hash, scopes `text[]`; tables 170→171, indexes 447→449). Key format `mcp_<8-char-prefix>_<32-char-secret>` (base64url, 240-bit entropy), sha256-hashed at rest, constant-time compare via `timingSafeEqual`, plaintext shown EXACTLY ONCE on create. Curated 8-tool MCP surface (NO money-movement, NO mass-comms): `schedule_cross_platform_post`, `cancel_scheduled_post`, `list_scheduled_posts`, `get_scheduled_post`, `list_personas`, `lookup_output_skill`, `list_output_skills`, `get_platform_info` — all re-use existing internal tool implementations (no new TOOL_REGISTRY entries). NEW `/mcp-keys` UI page wired into sidebar. **In-round architect fixes (the `+sec` suffix)**: (HIGH-1) scopes were stored but NEVER enforced — defined `MCP_SCOPES` registry (`scheduler:write`, `scheduler:read`, `catalog:read`, `*` wildcard) + `TOOL_SCOPE_REQUIREMENTS` mapping; every tool handler in `buildMcpServer()` now opens with `if(!hasScope(...)) return denyForScope(...)` (fail-CLOSED for empty/null scopes; read-scope does NOT cover write-scope); POST `/api/mcp-keys` validates scopes against registry (unknown→400) and defaults empty input to `[\"catalog:read\"]` (never destructive); UI surfaces explicit scope checkboxes with destructive flag on `scheduler:write`. (MED-2) `/api/mcp-keys` CRUD accepted `Bearer vc_*` API-key auth — a leaked vc_ key could mint unlimited MCP keys → new `requireSessionAuth()` helper on all 3 CRUD routes rejects `Bearer vc_*` with explicit 403 + still requires session cookie / Replit OIDC. 31-test suite (22 first cut + 9 scope-enforcement + vc_-rejection invariants), all passing. R113.6 — Facebook Page publisher + YouTube video-bridge wired natively (NO third-party relay). NEW column `scheduled_posts.video_url`. `publishToFacebook` (Graph v18 `/me/accounts` → page access_token → `/{pageId}/feed` for text or `/{pageId}/photos` for image+caption; warns + records selected page in metadata when Bob manages multiple Pages). `publishToYouTube` (https-only `videoUrl` OR `driveFileId`; 256MB cap; reuses proven resumable-upload pattern). **In-round HIGH closed**: `publishToYouTube` SSRF/memory-exhaustion — `arrayBuffer()` was buffering the entire response BEFORE the 256MB check → replaced with upfront `Content-Length` check + streaming `getReader()` loop with running byte counter + `AbortController` cancel on cap-exceed. 42-test suite, all passing. R113.5 — Self-hosted multi-platform social-post scheduler (foundation; NO third-party relay). NEW table `scheduled_posts` (tenantId notNull, platforms text[], status check pending|publishing|sent|partial|failed|cancelled, locked_at/locked_by, next_attempt_at, jsonb per_platform_results, +2 indexes incl. partial `idx_scheduled_posts_due`). NEW `server/lib/scheduled-post-runner.ts` — atomic CTE `FOR UPDATE SKIP LOCKED` poll + flip to `publishing` (no double-publish across heartbeat ticks), per-platform idempotent retry (skip already-succeeded platforms on attempt N+1), partial-success = terminal (no retry), exponential backoff 60s→1h cap, bounded `max_attempts=3`. Three NEW tools (tools 344→347): `schedule_cross_platform_post` (destructive HIGH, requiresApproval), `cancel_scheduled_post` (sensitive MEDIUM), `list_scheduled_posts` (safe LOW) — all in `TOOL_POLICIES`. API routes `/api/scheduled-posts` GET/POST/DELETE behind `authMiddleware`, tenantId pulled from session (never body). NEW `/social-calendar` UI page. Personas 2/4/11 (Felix/Teagan/Apollo) wired with `intentGate=moderate` + AHB safety_profile. R113.4+sec — Tool Selection Discipline System: three-layer belt+suspenders forces every agent to consider the best tool BEFORE acting across the 347-tool inventory. LAYER 1 Top-Picks Header (passive, always-on; semanticRank + per-tenant performance, top 5 per turn, ~250 tokens). LAYER 2 NEW `recommend_best_tool` tool (gated, active; <50ms embedding lookup; MANDATORY before 3+ step plans / paid APIs / irreversible writes / customer-facing deliverables). LAYER 3 post-call validator (reactive, automatic; embedding-only re-rank after FIRST tool call; fires `★ TOOL SELECTION HINT ★` once per session if gap ≥0.08 cosine). Tools 340→342, governance 40→41 (+1 Tool Selection Discipline System). R112.17 — Tier 1 web-access bot-wall bypass via Apify `header-generator` nugget (Bayesian-network-trained realistic browser headers behind env flag, default ON, three-layer fail-safe, defense-in-depth SSRF + prompt-injection preserved). R112.16 +sec — Architect re-review of the same-day R112.16 patch closed 1 HIGH + 1 MEDIUM in-round. HIGH: rescue script (`scripts/resend-delivery-email.ts`) SELECT omitted the `metadata` column while the tenant resolver read `row.metadata.tenantId` — every rescue silently fell back to hardcoded tenant 8, masking a cross-tenant signing footgun. Fix: SELECT now includes `metadata`; tenant resolution requires explicit `TENANT_ID` env OR `metadata.tenantId`; falling back to owner-tenant 8 now requires explicit `ALLOW_DEFAULT_OWNER=1`; new `DRY_RUN=1` mode prints the four-link body without sending or DB-writing. MEDIUM: `start_video_job` tool dispatch forwarded the new R112.16 flags correctly but the tool schema didn't expose them — planner-discoverability hole. Fix: schema now declares `autoFinalize`/`autoDeliver`/`customerName`/`customerEmail` with R112.16-tagged descriptions; tool description re-marked LEGACY with explicit \"prefer `build_video_from_brief`\" guidance. R112.16 — Closed the R112 legacy-path delivery gap that bit Bob the same afternoon. Felix shipped a BWB video that finalized correctly but bypassed `deliverDigitalProduct()` — no `delivery_logs` row, no `/uploads/` streaming file, no email. Root cause: R112's `build_video_from_brief` sets `autoFinalize`/`autoDeliver` on the spec, but the *legacy* `start_video_job` tool dispatch handler never forwarded those flags. Fix: `case \"start_video_job\"` now explicitly extracts the four flags (with `emailTo` fallback) and forwards them; extended `StartVideoJobInput` + `VideoJobState.spec` types so the R112 one-shot delivery guard is compiler-enforced. NEW `scripts/resend-delivery-email.ts` one-shot rescue — reads any `delivery_logs` row that shipped without email, generates a 60-day signed streaming URL, composes a four-link HTML+text body, fires `sendEmail`, marks `email_sent=true`. Used to recover delivery #127. R112 — NEW `build_video_from_brief` (tools 339→342): ONE call replaces Felix's 6-step video orchestration. Plans chapters+scenes via runLlmTask (gemini-2.5-flash, JSON-strict), fires `startVideoJob` with `autoFinalize: true` + `autoDeliver: !!customerEmail`, returns `{job_id, watch_progress_url, total_chapters, total_scenes, plan_summary, estimated_duration_sec}` immediately. Runner end-of-loop auto-finalizes + auto-delivers (streaming URL + email). Legacy `produce_video`, `mpeg_produce`, `mpeg_produce_parallel`, `start_video_job`, `check_video_job`, `finalize_video` re-marked LEGACY in Felix's `tools_doc` with explicit \"do NOT use for new requests\" guidance. R110.15 — Whole-app architect sweep (PASS WITH NITS) on R110.7→R110.14 72h diff + sensitive surfaces (multi-tenant isolation, AHB safety, SSRF, prompt injection, file delivery, silent-failure hunt). 1 MEDIUM closed same-round: minds-engine confidence parser (`parseFloat() || 0.5` swallowed both NaN and a legitimate 0 — verifier disagreement collapsed to 0.5 silently; replaced with explicit `Number.isFinite()` gate + loud warn). R110.14 budget-cap hardened with explicit tenantId guard (a misconfigured caller can no longer silently bypass the circuit breaker via `WHERE tenant_id = NULL`). NEW `scripts/replit-md-compact.ts` — idempotent threshold-based auto-compactor for replit.md; keeps the 8 newest \"Recent rounds\" one-liners, moves older entries to `docs/release-log-archive.md` as stub prose entries, atomic writes both files; wired into the Auto Git Push cycle BEFORE staging — fail-OPEN, no-op when under threshold; solves the recurring \"replit.md is getting large\" nag without manual intervention. R110.14 — Two final Barry Zhang nuggets: per-loop USD budget cap (new optional `maxLoopUsdBudget` snapshot per turn, loud abort with `abortedReason: \"budget_cap\"` when exceeded; recommended Felix BWB pipeline $3.00, generic supervisor $1.00, heartbeat $0.50) + trajectory-based golden-path eval (new optional `expected_tools_subset` + `forbidden_tools` validates the actual tool sequence against `agent_trace_spans`; warn-only for week 1, promotes to hard-fail after warm-up). R110.13 — Barry Zhang Anthropic \"Building Effective Agents\" seminar audit; 5 actionable gaps closed: wall-clock circuit breaker (default 10 min), consecutive-failure circuit breaker (default 3 — only TRUE handler success resets), tool-design hygiene linter (description under 30 chars + non-object schema; 0 violations on 359 tools), per-persona tool sprawl audit (warn over 30), NEW `scripts/agent-perspective.ts` trace-tree printer with `--upto` mental-drill mode. R110.12 — IJFW nuggets imported (gitlab.com/therealseandonahoe/ijfw): NEW skill `critique` (#24, structured Steelman→Counter-args stress-test), NEW preflight `scripts/preflight-stale-strings.ts` (catches stale tool/table/skill counts before deploy), weekly-maintenance Pass 9 (memory/rule pruning), 3 workflow rules (2-failed-corrections-stop, AskUserQuestion Score Rule, session_plan format/lifecycle). R110.11.5 +sec — 72h thorough architect sweep across R110.7→R110.11.4 + sensitive surfaces (auth, tenant isolation, AHB safety, secret/SSRF/HITL, signed URLs, tool registry, public mirror sanitizer, rate limiters, OAuth, webhooks). Two-prong main + silent-failure-hunter prongs caught 4 findings (2 MEDIUM + 1 LOW main + 2 MEDIUM SFH) all closed in same round per architect-finding-triage rules: /healthz/deep freshness math fix (probeNow inside inflight, cache stamped at completion), /healthz/deep strict catch shape, mpeg-engine probeAudioStreamDuration returns null not 0 on non-finite parse (canonical R110.10 bug-class sibling site finally cleaned), golden-path-replay distinguishes ENOENT from corrupt JSON (exit 2 refuses overwrite). Bonus: monid-catalog-survey MONID_MAX_QUERIES guard so paid Monid spend can't quietly balloon. R110.11.4 — CodeFlow Card on public mirror only (pinned to commit SHA, contents:write only, paths-ignore breaks self-trigger loop, monthly cron). R110.11.3 — split liveness/readiness probe with new unauthenticated /healthz/deep (info-leak-stripped, 5s response cache + 60s staleness + in-flight Promise coalescing) for external monitors. R110.11.2 — model registry auto-add overlay; MODEL_AUTOADD_WATCHLIST will auto-promote Baidu ERNIE 5.x the instant it lands on OpenRouter; atomic write-to-tmp+rename with corrupt-overlay ABORTS (never silent-overwrites). R110.11.1 — TS gate green-up. R110.11 +sec — rate-limit gate fail-CLOSED for expensive tools with 40-tool hardcoded backstop, 2 more probeDuration sibling sites THROWS, brand_voice_drift logic flip, video-job-runner readJobState distinguishes ENOENT vs corrupt JSON. R110.7-R110.10 — Felix YouTube pipeline survives broken container libdrm via probeDurationStrict THROWS with stderr capture, file-size TTS fallback, ffmpeg/ffprobe preflight fails CLOSED with container_environment_corrupted envelope; probeAudioStreamDuration returns null on non-finite parse. R110.3-R110.6 — Fish Audio promoted to PRIMARY TTS with multi-tier cascade Fish → OpenAI → Edge; generate_audio rate limit 2/10/30 → 60/600/2000; create_slideshow_video 1/5/15 → 10/60/200. R110.9 — NEW silent-failure-hunter skill wired as focused second-pass after main architect; Felix anti-fraud rules (6 non-negotiable prompt rules). R110.1 +sec Gold-Review Hardening — 4 HIGH + 3 MEDIUM architect findings closed across 3 passes (verified CLEAN at pass 6). Upload secret-scan now FAIL-CLOSED with 503 UPLOAD_SECRET_SCAN_UNAVAILABLE on any extract/scan-infra throw (was fail-OPEN, malformed-PDF bypass). Delivery-pipeline scanner-throw synthesizes SCANNER_UNAVAILABLE high-severity blocking hit (was log-and-continue scanner-DOS bypass). html-app-builder + deliverable-grader jsdom switched to runScripts:undefined — LLM-authored JavaScript no longer executes server-side (was RCE sink via prompt injection). tools.isUrlSafe + pdf-tool.isUrlSafe rewritten async with full DNS re-validation; literal IPs (v4 + v6) routed through canonical isPrivateIp covering ::1, fc00::/7 ULA, fe80::/10 link-local, 100.64/10 CGNAT, 224/4 multicast, IPv4-mapped IPv6 in BOTH dotted AND Node-canonical hex form (::ffff:7f00:1); fail-CLOSED on DNS failure (was hostname-only attacker-DNS-to-169.254.169.254 bypass). tools.write_file pre-Drive secret scan with BLOCK reason propagated to upload_error / upload_blocked_reason / message. Pinned by new tests/security/ssrf-ip-mapped.test.ts — 11 cases, all green via npx tsx --test. R110 +sec Pre-Delivery Secret Scan — 48-pattern credential-regex catalog (AWS/GCP/GitHub/Stripe live/Anthropic/OpenAI/ElevenLabs/Slack/SendGrid/Twilio/Discord/Telegram/all PEM private-key armor/JWT/Basic-Auth URLs/generic api_key) wired as fail-CLOSED structural gate in delivery-pipeline + customer-upload validator; CRITICAL/HIGH aborts upload + alerts owner; agent-callable scan_for_secrets (1 new tool, 1 new capability) lets all 16 personas fix leaks before they trip the gate. R109.4 +sec hardening + stat-drift sweep — Dockerfile data/ allowlist closes a HIGH (PII + customer-artifact image-embed risk) by replacing broad data/ COPY with an explicit 6-asset allowlist + writable-dir ownership setup; model-freshness exempt-set slug fix silences 2 stale weekly-maintenance RED warnings; README + docs stat refresh; 3-pass architect (Pass 1: 3 MED + 1 LOW; Pass 2: 1 NEW HIGH from broad COPY; Pass 3: CLEAN). R109.3-fix self-healer no-op-heal gate (CI now routes 0-touched-files runs to notifyUnfixable instead of recording them as healed, breaking the false-heal infinite-loop). R109.2.3 Monid external-endpoint catalog integration with agent-UX clarity pass — discover-first thin HTTP wrapper around api.monid.ai/v1/* (browse → discover → inspect → run workflow), 4 new tools (monid_discover, monid_inspect, monid_run, monid_catalog_browse), 124-endpoint catalog harvested via 64-query VCA-domain fan-out and curated to 52 high-fit endpoints across 9 categories, wired into PLATFORM_TOOLS_CONTRACT so all 16 personas discover-first BEFORE writing custom scrapers. R109.1/R109.2/R109.2.1 +sec architect hardening: prompt-injection fence on all monid output via wrapExternalContent; per-tool rate ceilings (monid_run 2/min·10/hr·50/day, discover 5/30/150, inspect 8/40/200) so a runaway tenant can't drain the org-shared key; cost ledger on every monid_run; SSRF guard on MONID_API_BASE env override; error-body trim 600 chars. R109.2.2 +fix corrected two pre-existing R109 wrapper bugs surfaced by live BWB test (splitId helper for {provider,endpoint} fields; queryParams/pathParams field-name mapping). R109.2.3 +agent-ux added monid_inspect 1:1 mapping doc, worked-example block in monid_run, and self-correcting auto-hint when upstream returns Missing required fields. R108.1 +sec fail-CLOSED hardening across rate-limit, usage-metering, and upload-validator chat-ingress gates. R108 adaptive per-node maxSteps budgets + causal evidence edges + cold-start hypothesis nudge. R107 regime-aware memory consolidation (geometry probe + memory_geometry_scan tool). R106 LuaN1aoAgent five-nugget reflexive operating primitives. R105 PageIndex hierarchical doc nav. R104 inbox quarantine + commitments. R102 admission control. R101 causality graphs. R100 transactional no-regression. R98.x Felix deliverable reliability + Camofox stealth browser + AHB defense layer. Start free — no credit card."}
        ogTitle={`${pn} — Your Autonomous AI Corporation`}
        ogDescription="An AI team that researches, writes, builds, and delivers. 16 specialist agents, 359 tools, 109 capabilities, 169 database tables, 24 + 62 + 25 skills, 42 governance rules. Latest R113.4+sec — Output Skills Library: 25 on-demand structured-deliverable scaffolding templates across 8 departments (Product / Strategy / Communications / Sales / Marketing / Legal / HR / Operations) callable via the NEW `lookup_output_skill` tool (safe / LOW / requiresStructuredArgs; XOR contract); wired into 14 of 16 personas; 17 dispatcher tests pass; architect second pass: PASS. R113.3+sec closed 2 HIGH + 1 MEDIUM (ingest_paper filesystem-read jail, kill_switch SQL-injection sink hardened, paper-ingest race wrapped in pg_advisory_xact_lock). R112.18 — Tool Selection Discipline System (three-layer belt+suspenders forces every agent to consider the best tool BEFORE acting across the 347-tool inventory: Layer 1 Top-Picks Header passive always-on, Layer 2 NEW `recommend_best_tool` tool gated/active, Layer 3 post-call validator reactive/automatic). R112.17 — Tier 1 Web-Access Bot-Wall Bypass via Apify `header-generator` (Bayesian-network-trained realistic browser headers, default ON, three-layer fail-safe). R112.16 +sec — Architect re-review closed 1 HIGH (rescue-script cross-tenant signing footgun: explicit TENANT_ID or metadata.tenantId required, owner-8 fallback requires ALLOW_DEFAULT_OWNER=1, new DRY_RUN=1 mode) + 1 MEDIUM (start_video_job schema exposes the new R112.16 flags with LEGACY guidance to prefer build_video_from_brief). R112.16 — Closed the legacy-path delivery gap (start_video_job dispatch forwards autoFinalize/autoDeliver/customerName/customerEmail; compiler-enforced via extended types; NEW resend-delivery-email.ts rescue script with 60-day signed URLs + four-link body). R112 — NEW build_video_from_brief collapses Felix's 6-step video orchestration into ONE call (plan + finalize + deliver auto). R110.15 — Whole-app architect sweep (PASS WITH NITS); 1 MEDIUM closed same-round (minds-engine confidence parser silent-failure); R110.14 budget-cap hardened with explicit tenantId guard; NEW `scripts/replit-md-compact.ts` self-compacts replit.md every commit cycle. R110.14 — Per-loop USD budget cap + trajectory-based golden-path eval (warn-only week 1). R110.13 — Barry Zhang seminar audit; 5 gaps closed (wall-clock + consecutive-failure circuit breakers, tool-design hygiene linter, per-persona tool sprawl audit, NEW agent-perspective trace-tree printer). R110.12 — IJFW nuggets: NEW `critique` skill #24 + stale-string preflight gate + weekly-maintenance Pass 9 + 3 workflow rules. R110.11.5 +sec — 72h thorough architect sweep across R110.7→R110.11.4 + sensitive surfaces; 4 findings closed in same round (/healthz/deep freshness + strict catch shape, mpeg-engine probeAudio null contract, golden-path-replay corrupt-JSON exit-2) + monid spend-cap bonus. R110.11.4 CodeFlow Card on public mirror (pinned SHA). R110.11.3 split liveness/readiness /healthz/deep. R110.11.2 Baidu ERNIE 5.x auto-promote overlay. R110.7-R110.10 Felix YouTube pipeline survives broken container libdrm. R110.3-R110.6 Fish Audio PRIMARY TTS with multi-tier cascade. R110.9 NEW silent-failure-hunter skill + Felix anti-fraud rules. R110.1 +sec Gold-Review Hardening — 4 HIGH + 3 MEDIUM architect findings closed across 3 passes (verified CLEAN at pass 6): upload-scan FAIL-CLOSED, delivery-scanner-throw synthesizes blocking hit, jsdom RCE sink removed, full DNS-resolving SSRF with IPv4-mapped IPv6 hex-form coverage, write_file pre-Drive secret scan. Pinned by 11-case regression test. R110 +sec Pre-Delivery Secret Scan (48-pattern catalog, fail-CLOSED gate in delivery + ingest, agent-callable scan_for_secrets across all 16 personas). R109.4 +sec — Dockerfile data/ allowlist (closed HIGH PII/customer-artifact image-embed risk) + model-freshness slug fix + stat refresh. R109.2.3 Monid external-endpoint catalog integration with browse → discover → inspect → run workflow + agent-UX clarity pass + R109.1/.2/.2.1 +sec hardening (prompt-injection fence, per-tool rate ceilings, cost ledger, SSRF guard). 124 endpoints harvested, 52 curated across 9 categories. R108 adaptive plan-node maxSteps + causal evidence edges + cold-start hypothesis nudge. R107 regime-aware memory consolidation. Start free."
        canonical=""
      />
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
          <a href="/landing" className="flex items-center gap-2 hover:opacity-80 transition-opacity" data-testid="link-landing-logo">
            <img src={vcLogoPath} alt={pn} className="h-8 w-auto dark:brightness-[1.15] dark:contrast-[1.1]" data-testid="img-landing-logo" />
          </a>
          <div className="hidden md:flex items-center gap-1">
            {navTabs.map((tab) => (
              <Button
                key={tab.id}
                variant="ghost"
                size="sm"
                onClick={() => document.getElementById(tab.id)?.scrollIntoView({ behavior: "smooth" })}
                data-testid={`nav-tab-${tab.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {tab.label}
              </Button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/pricing")}
              data-testid="nav-tab-pricing"
            >
              Pricing
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/store")}
              data-testid="nav-tab-shop"
            >
              Shop
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <ViewToggle mode={viewMode} setMode={handleModeChange} />
            <ThemeToggle />
            <Button
              variant="ghost"
              onClick={() => navigate("/login")}
              data-testid="button-landing-signin"
            >
              Sign In
            </Button>
            <Button
              onClick={() => navigate("/signup")}
              data-testid="button-landing-signup"
            >
              Sign Up Free
            </Button>
          </div>
        </div>
      </nav>

      {viewMode === "business" ? (
        <>
          <BusinessHero navigate={navigate} />

          <div className="relative py-16 px-6 bg-gradient-to-b from-primary/[0.04] to-transparent dark:from-primary/[0.08] border-t border-border/50" data-testid="section-mission-biz">
            <div className="max-w-3xl mx-auto text-center">
              <RevealOnScroll>
                <Badge variant="secondary" className="mb-4 gap-1.5">
                  <Target className="w-3.5 h-3.5" /> Our Mission
                </Badge>
                <blockquote className="text-lg sm:text-xl md:text-2xl font-medium leading-relaxed text-foreground/90 italic" data-testid="text-mission-biz">
                  "To democratize business operations by giving every entrepreneur, creator, and professional access to an autonomous AI workforce that turns ideas into executed results — empowering individuals to build, scale, and compete like enterprises without the overhead."
                </blockquote>
              </RevealOnScroll>
            </div>
          </div>

          <section className="py-14 px-6 border-t border-border" data-testid="section-founder-note">
            <div className="max-w-3xl mx-auto">
              <RevealOnScroll>
                <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.04] via-transparent to-emerald-500/[0.04] dark:from-primary/[0.08] dark:to-emerald-500/[0.08]">
                  <CardContent className="p-6 sm:p-8">
                    <div className="flex items-center gap-2 mb-3">
                      <Badge variant="secondary" className="gap-1.5" data-testid="badge-founder-note">
                        <Activity className="w-3.5 h-3.5 text-emerald-500" /> A note from the founder
                      </Badge>
                    </div>
                    <h3 className="text-xl sm:text-2xl font-semibold mb-3 leading-snug" data-testid="text-founder-headline">
                      I'm Bob — and I'm building this while losing weight on wellness-program.
                    </h3>
                    <p className="text-muted-foreground leading-relaxed mb-3" data-testid="text-founder-body-1">
                      VisionClaw started as the autonomous AI corporation you see above — research, reporting, documents, outreach, the whole stack. It still is all of that. But somewhere along the way it also became the quiet companion that keeps me on track through the wellness journey: the late-night urges, the protein math, the mood dips, the "did I really lose anything this week?" spiral.
                    </p>
                    <p className="text-muted-foreground leading-relaxed mb-5" data-testid="text-founder-body-2">
                      A wellness companion membership is on the way — built around the same agents, plus a dedicated late-night coach, a side-effects coping kit, and weekly check-ins that actually remember you. If you're on wellness-program, Wegovy, Zepbound, or thinking about starting, the YouTube channel below is where I document what works, what doesn't, and what the AI is learning from real days.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <a
                        href="https://www.youtube.com/@BobOnwellness-program"
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid="link-founder-youtube"
                      >
                        <Button variant="default" size="sm" className="gap-1.5">
                          <Activity className="w-4 h-4" />
                          Watch "Founder Channel"
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </a>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => navigate("/signup")}
                        data-testid="button-founder-waitlist"
                      >
                        <Sparkles className="w-4 h-4 text-emerald-500" />
                        Join the wellness companion waitlist
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </RevealOnScroll>
            </div>
          </section>

          <BusinessWhoSection />
          <BusinessPainPointsSection />
          <BusinessPlatformSection />
          <BusinessWorkflowsSection />
          <BusinessCompareSection />
          <BusinessTrustSection />
          <BusinessFaqSection />
          <BusinessCtaSection navigate={navigate} />
        </>
      ) : (
        <>
      <section className="relative overflow-hidden py-28 px-6">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/3 dark:from-primary/10 dark:via-transparent dark:to-primary/5" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/[0.07] via-transparent to-transparent" />
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-[10%] w-72 h-72 bg-primary/10 rounded-full blur-[100px] animate-pulse motion-reduce:animate-none" style={{ animationDuration: "4s" }} />
          <div className="absolute bottom-20 right-[10%] w-96 h-96 bg-violet-500/8 rounded-full blur-[120px] animate-pulse motion-reduce:animate-none" style={{ animationDuration: "6s", animationDelay: "1s" }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/[0.03] rounded-full blur-[80px]" />
        </div>
        <div className="relative max-w-4xl mx-auto text-center space-y-6">
          <RevealOnScroll>
            <img src={vcLogoPath} alt={pn} className="h-16 sm:h-20 w-auto mx-auto mb-4 dark:brightness-[1.15] dark:contrast-[1.1]" data-testid="img-tech-hero-logo" />
          </RevealOnScroll>
          <RevealOnScroll>
            <Badge variant="secondary" className="gap-1.5 animate-[fadeIn_0.6s_ease-out]" data-testid="badge-hero-status">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Platform Online — 16 Agents, 342 Tools, 169 Tables, 445 Indexes, 109 Capabilities, 24 + 62 Skills, 40 Governance Rules. R112.16 +sec — Architect re-review of the same-day R112.16 patch closed 1 HIGH + 1 MEDIUM in-round. HIGH: rescue script (`scripts/resend-delivery-email.ts`) SELECT omitted the `metadata` column while the tenant resolver read `row.metadata.tenantId` — every rescue silently fell back to hardcoded tenant 8, masking a cross-tenant signing footgun (fix: SELECT includes `metadata`; tenant resolution requires explicit TENANT_ID env OR metadata.tenantId; owner-tenant fallback requires explicit ALLOW_DEFAULT_OWNER=1; new DRY_RUN=1 mode prints the four-link body without sending or DB-writing). MEDIUM: `start_video_job` tool dispatch forwarded the new R112.16 flags correctly but the tool schema didn't expose them — planner-discoverability hole (fix: schema declares `autoFinalize`/`autoDeliver`/`customerName`/`customerEmail` with R112.16-tagged descriptions; LEGACY label points planners to `build_video_from_brief`). R112.16 — Closed the R112 legacy-path delivery gap: `start_video_job` dispatch handler now forwards autoFinalize/autoDeliver/customerName/customerEmail to startVideoJob; extended StartVideoJobInput + VideoJobState.spec types so the one-shot delivery guard is compiler-enforced; NEW `scripts/resend-delivery-email.ts` rescue script (60-day signed streaming URL + four-link HTML+text body, used to recover delivery #127). R112 — NEW `build_video_from_brief` (tools 339→342): ONE call replaces Felix's 6-step video orchestration. Plans chapters+scenes via runLlmTask (gemini-2.5-flash, JSON-strict), fires `startVideoJob` with `autoFinalize: true` + `autoDeliver: !!customerEmail`, returns the watch_progress_url immediately so the chat turn closes cleanly. Runner end-of-loop auto-finalizes + auto-delivers (streaming URL + email). Legacy produce_video/mpeg_produce/mpeg_produce_parallel/start_video_job/check_video_job/finalize_video re-marked LEGACY in Felix's `tools_doc` with explicit "do NOT use for new requests" guidance. R110.15 — Whole-app architect sweep (PASS WITH NITS); 1 MEDIUM closed same-round (minds-engine confidence parser silent-failure). R110.14 budget-cap hardened + stat-drift sweep: Dockerfile data/ allowlist (closed HIGH PII/customer-artifact image-embed risk via explicit 6-asset COPY replacing broad data/ tree COPY) + model-freshness exempt-set slug byte-for-byte fix + stale-stat refresh; 3-pass architect (Pass 1: 3 MED + 1 LOW; Pass 2: 1 NEW HIGH from broad COPY; Pass 3: CLEAN). R109.3-fix self-healer no-op-heal gate (CI now routes 0-touched-files runs to notifyUnfixable instead of recording them as healed). R109.2.3 — Monid External-Endpoint Catalog (browse → discover → inspect → run, 4 new tools, 124 endpoints harvested / 52 curated across 9 categories) + R109.1/.2/.2.1 +sec architect hardening (prompt-injection fence on all monid output, per-tool rate ceilings, cost ledger, SSRF guard on env override). R108.1 +sec — whole-app post-edit code review across the 24h diff plus always-on sensitive surfaces. Four architect rounds, five MEDIUMs closed, two clean passes. Closures: `plan_graph_edit` JSON schema gained the `maxSteps` op (personas were told to use it but the schema didn't expose it); the `/api/conversations/:id/messages` rate-limit and usage-metering catches now fail CLOSED with explicit gate-error codes (the warning-email side-effect is split into a fail-OPEN second phase to prevent retry-induced double-counting); `validateUploadedFile()` detector errors now fail CLOSED with `UPLOAD_VALIDATOR_GATE_ERROR`; the R108 smoke test passes a real `ttlMinutes` and asserts the actual `expires_at` window (catches future regressions to silent-default 240min). R98.27.7-sec — Per-Task Workspace Artifacts + Universal Operating Contract + Whole-App Architect Sweep. Per-task scratchpad (`workspace_init` / `_update_status` / `_log_artifact` / `_read` / `_finalize` / `_list`) layered into every persona's operating contract as Rule 6 (PERSISTENT TASK WORKSPACE) so jobs survive chat-turn boundaries and resume cleanly. Universal operating-loop contract added to all 16 personas (chunk-and-parallel rule, delegate-vs-DIY map, structured failure schema, verify-before-done gate). AbortSignal leaf timeouts wired into 14 hot-path Drive/Browserless/ElevenLabs/x.ai sites so a stuck upstream can no longer hold a chat turn open until Replit Temporal kills it. Persona-sync hot-reload now refreshes `operating_loop` on every Agent Knowledge Refresh (was set ONLY at first seed and silently failed to land). Whole-app architect sweep: 6 workspace tools registered in `TOOL_POLICIES`, `build_html_app` timeout 90s → 180s, `workspace_read` per-call random-nonce delimiter against prompt-injection. R98.16 IJFW Cross-Pollination — Bob asked us to scan the IJFW project on GitLab and lift every nugget that fits VisionClaw without creating system havoc. Eight items shipped, all additive: (1) `run_command` (#296, ad-hoc shell with large-output sandbox + auto-summary so Felix stops burning context on ✓ pass lines, owner-tenant + Felix/Forge gated); (2) wave-table parallelism on `plan_deliverable` (sibling steps inside a wave dispatch in parallel via single-response multi-tool-calls — PDF/html_app wave 3 grade+verify, research wave 1 deep+web, slides wave 1 orchestrate+create); (3) `translateLlmError` actionable error UX on every failover throw; (4) DeepSeek as fourth architect lineage + `runMultiLineageReview()` helper with productive-only `minResponses` counting; (5) `sanitizeUntrusted()` heading + system-tag defang (`# IGNORE PREVIOUS INSTRUCTIONS`, pseudo-`&lt;system&gt;`/`&lt;assistant&gt;`/`&lt;tool&gt;` tags, `&lt;|im_start|&gt;`/`&lt;|endoftext|&gt;` IM-format tokens) against prompt-injection-via-captured-content; (6) `atomicWriteFileSync` + parent-dir fsync at 6 critical persistence sites (job-spool, dormant-deprecation, code-health, research-engine, video-job-runner, skills-registry) for true power-loss durability; (7) Gemini `?key=` URL audit verified clean; (8) productive-only fan-out counting. Plus +sec patch hoisting `run_command`'s auth gate above `list_outputs`/`get_output` (closes HIGH cross-tenant enumeration of the global sandbox namespace), +wiring patch teaching Felix and Forge how to use everything via re-seeded `operating_loop` sections across all 16 personas, and +sec-2 whole-app architect sweep that closed 6 of 16 findings in one pass: CRITICAL secret-redaction in `translateLlmError` (provider error strings can echo Authorization headers — now `redactSecrets()`'d before embedding into `friendly`/`raw`); HIGH SSRF jail extended for 100.64.0.0/10 CGNAT + 0.0.0.0/8 + IPv4/IPv6 multicast + `::ffff:` IPv4-mapped form + suffix-blocklist for `.internal`/`.cluster.local`/`.svc` (covers `*.railway.internal`, `*.replit.internal`, K8s in-cluster); HIGH output-sandbox switched from `writeFileSync` to `atomicWriteFileSync` (mode 0o600 preserved); MEDIUM `retrieve_hint` absolute-path leak removed (label alone is sufficient for `get_output`); LOW atomic-write tmp-file cleanup on rename failure (best-effort `unlinkSync`/`unlink` then re-throw). 4 findings re-verified as FALSE POSITIVE / already-fixed (mpeg-engine SSRF was R98.14+sec-2; run_command gate verified hoisted; reference-learner tenant-scoped; wave_table generator at tools.ts L15549). 6 defense-in-depth gaps documented in replit.md as deferred. R98.14 (previous release, demoted) Felix Deliverable Reliability Plan COMPLETE — final batch of the 7-workstream plan plus the two Bob-requested additions (learn from real-world references + Replit-Agent-style instinct as written rules). Five new tools (290→295) + a regression net + style-transfer + the canonical 'what good looks like' map. (W1.3+W1.4) Durable resumable long-video jobs — `start_video_job` returns a job_id IMMEDIATELY (chat turn closes cleanly even on 12+ min videos), `check_video_job` polls per-chapter status, `finalize_video` is idempotent + resumable (concat fail → next call retries JUST concat, never re-renders the cheap-but-failed step). Atomic .tmp+rename writes; owner-tenant scoping; 7-day TTL sweeper; traversal-jail on job IDs. (W6) Golden-path nightly replay — new `Golden Path Replay` workflow runs canonical prompts, grades each artifact via `grade_deliverable`, fingerprints to disk, on regression writes a freeze marker AND emails the owner; drift bars duration ±5%, page count exact, file size ±20%; soft cost cap $1/run via the llm_usage ledger. Reference Learner — `learn_from_reference` SSRF-jails the URL (https only, blocked private/link-local IPs, blocked metadata hostnames, DNS-rebinding-defended via post-resolution recheck, redirect:'error' to close redirect-bypass), fetches ≤2MB / 15s timeout, YouTube oEmbed pulls title/author/thumbnail + base64-encoded maxres thumbnail as vision input, vision LLM extracts 3-8 SPECIFIC copyable patterns (concrete + checkable). `recall_references` filters by deliverable_type and/or style_tags. Quality-Instinct Cards — new `server/quality-cards.ts` exports `QUALITY_CARDS` map (8 formats × 8-11 concrete checkable rules each: video hook in first 3s + narration breathes 1-2s pauses + music ducks under voice -12 to -18 dB + LUFS -16 to -14 / peaks ≤ -1 dBFS; slides ONE idea per slide + 36pt+ headlines / 24pt+ body / NEVER below 18pt + photo on first-person slides; html_app sub-1s load + single primary action above fold + keyboard accessible + works offline) baked DIRECTLY into Felix's persona prompt as R98.14 (G)(H)(I) sections. R98.14 +sec / +sec-2 / +sec-2 round 2 — three architect passes closed: CRITICAL eval-sink in html-app-builder smoke_assertion replaced with structured DSL (selectors_exist/absent, text_includes, min_count, attr_equals, title_includes, allowlist regex, DOM-read-only); HIGH SSRF in mpeg-engine.generateImageForScene fetch routed through new shared `server/lib/ssrf-jail.ts`; CRITICAL redirect:'follow' SSRF-bypass in reference-learner closed via redirect:'error' on both fetchTextWithCap and YouTube oEmbed. All three architect re-verify passes returned DEPLOY SAFE. R98.13 — `plan_deliverable` (#289, prompt→contract router with typed PipelineStep[] for 10 formats, gemini-2.5-flash + JSON schema enforcement) + `grade_deliverable` (#290, vision/audio quality grader 0-100 with bounded auto-revise: ffprobe + ffmpeg blackdetect + volumedetect + jsdom + vision LLM, score under 85 auto-revises ONCE using the critique field, still under 85 escalates to Bob via owner-notification and refuses to ship). R98.12 — `verify_delivery_proof` chat-engine refuse-to-declare-done gate now inspects the tool RESULT for ok:true not just call presence (closes placeholder-args bypass) + `build_html_app` single-file HTML utilities (jsdom smoke-test before disk write, structured DSL replacing eval) + `record_strategic_win` & `recall_strategic_wins` positive-exemplar memory. R98.11+sec2 Six-Round Hardening Day — six R-rounds shipped in one day capped by a whole-app architect sweep that closed 3 HIGH-severity findings. (1) R98.9 Supply-Chain Discipline: AGENTS.md `vc-supply-chain` block + SHA-256 skill manifest + LLM-driven dependency auditor that reads the manifest and reports drift. (2) R98.10 Project Slash Commands: `/check` (tsc --noEmit + npm-audit + skills-registry validate), `/registry` (regenerate then validate after any `.agents/skills/` edit), `/commit-all` (Node-spawn git since bash git is sandbox-blocked); plus AGENT_FOLDER_MAP (`.agents/skills/_folder-map.json`) declaring per-skill destination folders for claude/cursor/codex/opencode/replit so the public mirror can pull a clean curated subset; plus new `slash_command` tool (the 284th — actions list/describe/run with frontmatter parsing, name validation `/^[a-z0-9][a-z0-9_-]&#123;0,63&#125;$/i`, 8KB output cap per stream). (3) R98.11 exit-77 + gate_command on delegate_task: clean-skip pattern routes "no work needed" through a sentinel exit code so a no-op turn never burns LLM tokens. (4) R98.10+sec / R98.11+sec hardening: fail-CLOSED persona gate on `slash_command` action='run' (requires `_tenantId === 1` AND when `_personaId` is present `[Felix(2), Forge(3)]` only — list/describe stay open for discovery without RCE risk); install `--dest` containment-checked under project root or `/tmp` (rejects `/etc/foo` and `../../../etc/foo` exit 2); prompt-injection sanitization on slash command bodies; symlink rejection on skills-registry install + `.bob/commands` loader matching the `read_file`/`write_file` pattern. (5) R98.11+sec2 whole-app architect sweep — HIGH #1 strict env allowlist + secret redaction at both shell-exec sites (slash_command body + delegate_task gate, prevents env-leak via process inheritance and prevents API keys appearing in stdout); HIGH #2 `slash_command` added to HIGH_RISK_TOOLS + destructive-tool TOOL_POLICIES (this caught a quiet drift — Forge wasn't in TRUSTED_PERSONA_NAMES, fixed in the same edit); HIGH #3 symlink jails on skills-registry install + `.bob/commands` loader (defense in depth across the new ergonomic surfaces). Tool count 283 → 284. Two MEDIUMs deferred and recorded as known gaps in replit.md (execSync event-loop blocking refactor; owner-override expiry SLA on `_registry.json`). Public Mirror Push pipeline also fixed today — externalized `vc-*` allowlist into `scripts/public-mirror-public-mirror allowlist.txt` so future legitimate runtime/infra `vc-*` namespaces are a one-line config add instead of a brittle script edit. R98.7 + R98.7+sec + R98.7+sec2 Felix Self-Thinking Loop — even with R98.6 profile-photo auto-attach + validators, Felix kept regressing on the SAME class of strategic mistakes (planning-prose narration, meta-videos, silent-quit, forgot-the-photo) because persona-prompt fixes don't stick across long multi-tool conversations; R98.7 closes the gap with five coordinated additions inspired by the open-source `sentrux` Rust architectural-signal sensor: (1) static failure-pattern doc `data/personas/felix/known-failure-patterns.md` (P001-P010) distills R98.1 → R98.6+sec regressions into pattern→trigger→fix→self-check format; (2) two memory tools — `record_failure_pattern` writes to `memory_entries` with new `category='strategic_lesson'` (no schema change), dedup-by-normalized-pattern-name with V2 JSON storage that survives SQL wildcard injection + 80-char prefix-substring stomp + recall regex misparse on `|`/`[tags:` (R98.7+sec hardening, V1 regex fallback for legacy rows); `recall_failure_patterns` returns parsed structured rows and bumps `last_accessed`; (3) structural quality sensor `server/sensors/structural-signal.ts` — pure-TS scan: file count, total LOC, god-files &gt;1000 LOC, top fan-in/fan-out via `@/`/`@shared/`/relative-path resolver, optional madge cycles, single 0-10000 score with explicit per-signal breakdown, scan completes in 1.18s on the full repo (548 files, 180802 LOC); (4) two baseline tools — `quality_baseline_save` snapshots to sidecar JSON (no new DB table), `quality_baseline_check` returns `regressed:true` if score dropped &gt;100 OR new god file appeared OR existing god files grew &gt;50 LOC; (5) Felix + Forge SELF-THINKING LOOP section: at task start call `recall_failure_patterns`; before declaring done re-recall + run `quality_baseline_check`; when Bob points out a regression call `record_failure_pattern` FIRST, apologize SECOND. Voluntary, prompt-driven. R98.7+sec2 — owner-requested full-app architect sweep across three parallel passes closed two findings introduced by R98.7: HIGH wrong relative import path on the sensor (`./lib/silent-catch` → `../lib/silent-catch`, would have crashed `quality_baseline_save`/`quality_baseline_check` at first use because the original smoke test only exercised `scanStructure()` directly, not the tool dispatch path) and MEDIUM stale headline stat (279 → 283). Live-verified full sensor cycle in 2089ms with no errors. Tool count 279 → 283 (+4); skills + personas unchanged. R98.6 + R98.6+sec Profile-Photo Auto-Attach — tenant-scoped face photo stored ONCE via new `set_my_profile_photo` tool (path-traversal + MIME hardened: rejects `..`, root-jails to `&lt;workspace&gt;/uploads/` + `&lt;workspace&gt;/attached_assets/`, whitelists image extensions, length-caps 500 chars), auto-attached on every first-person slide that lacks an image_path BEFORE the validator runs — closes the structural 'Felix forgot the photo on slide 5' failure that prompt-only fixes never stuck. R98.5 + R98.5+sec + R98.5+rl Production URL Fix + Pre-TTS Validators — `getBaseUrl()` was always picking the dev domain in production deploys (the dev domain is offline for end users); same release added pre-TTS planning-prose validator + half-silent video guard + first-person self-image rule (rejects faceless first-person slides BEFORE TTS spend) plus +sec narrowing of regex + division-by-zero guard + opt-out schema declarations and +rl rate-limit refund (validator failures no longer burn an hourly slot). R98 Felix Can Actually Deliver — project-folder-aware Drive uploads route every project deliverable directly into the project's named Drive folder, `project_files` row auto-INSERTed on every successful upload, new `google_drive search` sub-tool with two-pass lookup recovers lost files, never-quit-silently rule (P0) added to Felix + Forge requiring exact failure-mode reporting. R97 Self-Maintaining Platform — in-process scheduler runs an 8-pass weekly maintenance sweep (npm audit + outdated, integrations currency, SAST hooks, prod schema parity, prod log scan, Railway microservice health, model SDK currency, skill index drift) every 7 days and auto-emails the owner a GREEN/YELLOW/🔴-URGENT summary; two new HTTP routes (public /api/cron/weekly-maintenance/status + Bearer-gated POST trigger) for external pings; new agent-context-wiring skill closes the new-tool-EXISTS-but-no-persona-USES-it gap with an 8-step checklist over 9 context surfaces; new weekly-maintenance-review skill is the cron's narrative twin (per-pass triage rules, GREEN/YELLOW/RED protocol, auto-trigger of dependency-upgrade for CRITICAL/HIGH findings). Skill count 64 → 66. R96 + R96.1 Camofox Stealth Microservice & Universal-Recall Escalation Ladder — `jo-inc/camofox-browser` (MIT, Camoufox-based) deployed as its own Railway service, exposed as new tool `stealth_browse_camofox` (the 277th tool), plus router-level always-include of all four web tiers (web_fetch / browser / stealth_browse / stealth_browse_camofox) so every persona discovers the ladder on every turn. Auto-detection of bot-block payloads (Cloudflare, hCaptcha, DataDome, Akamai, 401/403/407/429/451) injects a top-of-result `fallbackHint` + `fallbackTool` into tool returns so the model climbs the ladder mechanically instead of giving up — survives chat-engine truncation and the prompt-injection key strip. Hardening pass after architect 2-CRITICAL/2-HIGH/2-MEDIUM review: HITL gate on click/type/navigate/extract/open (action-only matching now correctly fires for stealth_browse_camofox); SSRF guard reuses isSafeUrl + isSafeDns from structured-extraction (rejects 169.254.169.254, RFC1918, localhost, *.railway.internal, IPv6 link-local/ULA, non-http/https schemes); per-(tenant, persona) cookie + storage_state isolation prevents Robert-medical / Felix-CEO session bleed inside tenant 1; firecrawl success-path now annotated (catches Cloudflare interstitials returned as success:true); softened hint wording closes indirect-prompt-injection vector. 52/52 regression tests + live two-persona round-trip verified. R75.A Adversarial Humanities Benchmark (AHB) Defense Layer — every message destyled to literal intent before the model sees it (catches stylistic-obfuscation jailbreaks via poetry, allegory, hermeneutics, role-play that lift frontier ASR from 3.84% → 55.75%), per-persona safety profile with strict/moderate modes, fail-CLOSED destructive-tool registry with structured-args + trusted-persona + approval + value-cap gates, suspicious-name auto-classification for unregistered tools, audit log on every block decision (await-on-block so trail survives crash), 19/19 AHB regression tests in CI. R94 Tenant Cost-Attribution Integrity (AsyncLocalStorage tenant context end-to-end — auth, glasses, MCP, jobs, cron all bill the right tenant; static-import fix that closed a silent ADMIN-fallback bug; persona+mind soul scanned for prompt injection on save; scan_file symlink-pivot defense; ESM `require` landmines swept), R83-R93 Comprehensive 24h Security Sweep (write_file shared blocklist + symlink rejection, claude-import injection scan, escalation per-tenant hourly quota, SHA256 cache keys, system→user role on history summaries, &lt;tool_call&gt; tag stripping, disconnect persistence guard), R80 Claude Code Subagent Importer, R79 MarTech Bundle, KisMATH Reasoning Audit Rail (R77.5), Doctrine #12 Trust Tiers + Deliverable Contracts (R76), Operating Doctrine on Every Persona, 1M-Context Auto-Escalation, Felix Loop Verification Rail, MCP Plugin Marketplaces, Cross-AI Critique Panel
            </Badge>
          </RevealOnScroll>
          <RevealOnScroll delay={100}>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-tight" data-testid="text-hero-title">
              Your Autonomous
              <br />
              <span className="text-primary">AI Corporation</span>
            </h1>
          </RevealOnScroll>
          <RevealOnScroll delay={200}>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed min-h-[3.5rem]">
              An AI team that <TypewriterHero />
            </p>
          </RevealOnScroll>
          <RevealOnScroll delay={300}>
            <div className="flex flex-wrap justify-center gap-3 pt-3">
              <Button
                size="lg"
                onClick={() => navigate("/signup")}
                className="gap-2 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-shadow"
                data-testid="button-hero-get-started"
              >
                Start Free — No Credit Card
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => navigate("/store")}
                className="gap-2"
                data-testid="button-hero-shop"
              >
                Shop Bob's Store
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => document.getElementById("section-demo")?.scrollIntoView({ behavior: "smooth" })}
                data-testid="button-hero-view-demo"
              >
                Watch Live Demo
              </Button>
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={400}>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 pt-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> 359 built-in AI tools + 4 MCP memory tools (R117)</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> 16 specialist agents</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> PDF, Word, Excel, Slides, Video</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> 110 active capabilities</span>
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={500}>
            <p className="text-xs text-muted-foreground/70 max-w-md mx-auto pt-2 italic">
              Note: this is the AI agent platform. Not affiliated with the unrelated AR/wearable "VisionClaw" project.
            </p>
          </RevealOnScroll>
        </div>
      </section>

      <div className="relative py-16 px-6 bg-gradient-to-b from-primary/[0.04] to-transparent dark:from-primary/[0.08] border-t border-border/50" data-testid="section-mission">
        <div className="max-w-3xl mx-auto text-center">
          <RevealOnScroll>
            <Badge variant="secondary" className="mb-4 gap-1.5">
              <Target className="w-3.5 h-3.5" /> Our Mission
            </Badge>
            <blockquote className="text-lg sm:text-xl md:text-2xl font-medium leading-relaxed text-foreground/90 italic" data-testid="text-mission-statement">
              "To democratize business operations by giving every entrepreneur, creator, and professional access to an autonomous AI workforce that turns ideas into executed results — empowering individuals to build, scale, and compete like enterprises without the overhead."
            </blockquote>
          </RevealOnScroll>
        </div>
      </div>

      <CommandCenterStats stats={stats} />

      <LiveActivityDemo />

      <RecipeGallery />

      <section id="section-capabilities" className="py-20 px-6 border-t border-border" data-testid="section-capabilities">
        <div className="max-w-6xl mx-auto">
          <RevealOnScroll>
            <div className="text-center mb-14">
              <Badge variant="secondary" className="mb-4">Platform Capabilities</Badge>
              <h2 className="text-3xl font-bold mb-3">Everything Your Business Needs</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Not just a chatbot — a self-evolving AI corporation with 359 tools across 22 categories (R98.16 cross-pollinated 8 features from the IJFW project: a new `run_command` shell tool with large-output auto-summarization, wave-table parallelism on plan_deliverable so deliverable pipelines actually run in parallel, an actionable `translateLlmError` helper that turns provider stack traces into one-line user fixes, a `sanitizeUntrusted` heading + system-tag defang against prompt-injection-via-captured-content, atomicWriteFileSync with parent-dir fsync at 6 critical persistence sites for true power-loss durability, plus a +sec-2 architect sweep that closed 6 findings — CRITICAL secret-redaction in the error translator, HIGH SSRF jail extended for CGNAT/multicast/IPv6/internal cluster TLDs, output-sandbox switched to atomic write, retrieve_hint absolute-path leak removed, and tmp-file cleanup on rename failure; R98.14 completed the 7-workstream Felix Deliverable Reliability Plan with durable resumable long-video jobs that survive chat-turn boundaries, a nightly golden-path regression net, a reference learner that studies real-world exemplars from a YouTube/web URL and absorbs their style, and quality-instinct cards baked into Felix's persona prompt as concrete checkable rules per format; R98.13 added a deterministic plan→pipeline router and a vision/audio quality grader with bounded auto-revise; R98.7 added the Felix self-thinking loop with failure-pattern memory + a sentrux-inspired structural quality sensor + a voluntary self-check loop; R96 added the Camofox stealth-browser microservice plus a four-tier web-access ladder with auto-escalation), multi-agent orchestration (Crews, Flows, Minds),
                full business operations suite, document and video production, parallel MPEG engine, nightly autoresearch, 3-layer failure recovery, and production-grade infrastructure.
              </p>
            </div>
          </RevealOnScroll>

          <div className="space-y-16">
            {CAPABILITY_SECTIONS.map((section, sIdx) => {
              const SectionIcon = section.icon;
              return (
                <RevealOnScroll key={section.title} delay={sIdx * 80}>
                <div data-testid={`capability-section-${sIdx}`}>
                  <div className="flex items-center gap-3 mb-6">
                    <div className={`w-10 h-10 rounded-lg ${section.bg} flex items-center justify-center`}>
                      <SectionIcon className={`w-5 h-5 ${section.color}`} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">{section.title}</h3>
                      <p className="text-sm text-muted-foreground">{section.subtitle}</p>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {section.features.map((feature) => {
                      const FeatureIcon = feature.icon;
                      return (
                        <Card key={feature.label} className="border-border/60" data-testid={`card-capability-${feature.label.toLowerCase().replace(/\s+/g, "-")}`}>
                          <CardContent className="pt-5 pb-5 px-4 space-y-2">
                            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                              <FeatureIcon className="w-4 h-4 text-primary" />
                            </div>
                            <h4 className="font-semibold text-sm">{feature.label}</h4>
                            <p className="text-xs text-muted-foreground leading-relaxed">{feature.detail}</p>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
                </RevealOnScroll>
              );
            })}
          </div>
        </div>
      </section>

      <section id="section-agents" className="py-20 px-6 bg-muted/30 border-t border-border" data-testid="section-agents">
        <div className="max-w-6xl mx-auto">
          <RevealOnScroll>
            <div className="text-center mb-12">
              <Badge variant="secondary" className="mb-4">Meet the Team</Badge>
              <h2 className="text-3xl font-bold mb-3">16 Specialized AI Agents</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Each agent has unique expertise, personality, and tools. They collaborate as a coordinated team —
                delegating tasks, sharing knowledge, and escalating when needed.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs" data-testid="agent-invocation-channels">
                <span className="text-muted-foreground">Invoke from:</span>
                <Badge variant="outline" data-testid="badge-channel-chat">Chat</Badge>
                <Badge variant="outline" data-testid="badge-channel-slack">Slack <span className="ml-1 text-[10px] opacity-70">R98.26</span></Badge>
                <Badge variant="outline" data-testid="badge-channel-email">Email</Badge>
                <Badge variant="outline" data-testid="badge-channel-mcp">MCP (Claude / Cursor / Codex)</Badge>
                <Badge variant="outline" data-testid="badge-channel-cron">Scheduled / cron</Badge>
                <Badge variant="outline" data-testid="badge-channel-api">REST API</Badge>
              </div>
            </div>
          </RevealOnScroll>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {PERSONA_LIST.map((persona, pIdx) => {
              const Icon = persona.icon;
              return (
                <RevealOnScroll key={persona.name} delay={pIdx * 50}>
                <Card className="group hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300" data-testid={`card-persona-${persona.name.toLowerCase().replace(/\s+/g, "-")}`}>
                  <CardContent className="pt-5 pb-5 px-4 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300">
                        <Icon className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium text-sm">{persona.name}</div>
                        <div className="text-xs text-muted-foreground">{persona.role}</div>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{persona.description}</p>
                  </CardContent>
                </Card>
                </RevealOnScroll>
              );
            })}
          </div>
        </div>
      </section>

      <HowItWorks />

      <UseCases />

      <section className="py-20 px-6 border-t border-border" data-testid="section-live-stats">
        <div className="max-w-4xl mx-auto">
          <RevealOnScroll>
            <div className="text-center mb-12">
              <Badge variant="secondary" className="mb-4">Real Numbers</Badge>
              <h2 className="text-3xl font-bold mb-3">Live Platform Stats</h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Real data from a production system. Updated in real time.
              </p>
            </div>
          </RevealOnScroll>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { icon: MessageSquare, label: "Conversations", value: stats?.totalConversations ?? "—" },
              { icon: Layers, label: "Messages Processed", value: stats?.totalMessages ?? "—" },
              { icon: Activity, label: "Autonomous Tasks", value: stats?.totalAutonomousTasks ?? "—" },
              { icon: Database, label: "Memories Stored", value: stats?.totalMemories ?? "—" },
            ].map(({ icon: Icon, label, value }) => (
              <Card key={label} data-testid={`card-live-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                <CardContent className="pt-5 pb-5 px-4 text-center space-y-2">
                  <Icon className="w-5 h-5 text-primary mx-auto" />
                  <div className="text-2xl sm:text-3xl font-bold">{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="text-center mt-6">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span data-testid="text-uptime">In development since Oct 2025 — {uptimeHours.toLocaleString()}+ engineering hours</span>
            </div>
          </div>
        </div>
      </section>

      <section id="section-agentic-edge" className="py-20 px-6 border-t border-border" data-testid="section-agentic-edge">
        <div className="max-w-5xl mx-auto">
          <RevealOnScroll>
            <div className="text-center mb-12">
              <Badge variant="secondary" className="mb-4">The Agentic Edge</Badge>
              <h2 className="text-3xl font-bold mb-3">Why VisionClaw is the most agentic platform shipping today</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Most AI products are wrappers around one model with one mode. VisionClaw is a 16-persona corporation with a self-improving skill registry, hybrid retrieval, and a tool surface that's portable to any MCP-compatible host.
              </p>
            </div>
          </RevealOnScroll>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {[
              { icon: Users, value: "16", label: "Specialist personas", sub: "CEO, engineer, writer, sales, data, finance, legal, and 9 more — each with their own tool set, brand voice, and operating loop." },
              { icon: Wrench, value: "359", label: "Production tools", sub: "R115.5+sec round 3 — three-pass architect review on the R113.5→R114 ship closed 1 HIGH (legacy MCP `/api/mcp/sse` SSE surface now gated behind `LEGACY_MCP_ENABLED=1`, default OFF — the scope-restricted R113.7+sec `/mcp` Streamable HTTP surface is the supported integration) + 1 MEDIUM (AEvo meta-editor forbidden-pattern catalog hardened against confusable / zero-width / NFKC bypasses via `normalizeForPatternCheck` — soft hyphen, fullwidth Latin, ZWSP all fail-CLOSED) + 4 LOWs (`emptyBodySchema = z.object({}).strict()` wired across procedure-edits apply, council-verdicts request, scheduled-posts delete, mcp-keys delete — body-smuggling rejected at the gate). 30/30 AEvo invariants pass with 3 new unicode regression tests. SSRF rebinding MEDIUM deferred (pre-existing, requires undici dispatcher refactor). R114 — AEvo meta-editing of procedure context (Zhang et al., arXiv:2605.13821): HITL-gated meta-agent proposes minimal surgical edits to `data/output-skills/` playbooks based on accumulated evidence (≥3 agent_trace_spans + delivery_verifications + grade_deliverable rows), CAS sha256-pinned, rollback-capable. Edit-surface allowlist is HARDCODED type-level: `targetKind='output_skill'` ONLY (NOT .agents/skills/, NOT persona souls, NOT doctrine, NOT safety_profile, NOT TOOL_POLICIES). Tables 171→173→174 (R115.5 sprint_contracts) (`procedure_edits` + `procedure_evolution_runs`), indexes 449→452→454 (R115.5 +2), governance 42→43 (procedure_edit_governance HITL-on-apply), capabilities 109→110 (aevo_meta_editing), tools 347→357 (`propose_procedure_edit`, `list_procedure_edits`, `approve_procedure_edit`, `reject_procedure_edit`, `apply_procedure_edit`, `rollback_procedure_edit`). NEW `/procedure-edits` admin UI. Persona Doctrine #13 added — every persona sees the edit-surface allowlist + forbidden-pattern catalog + propose-not-apply posture. R98.27.8 codebase self-knowledge graph + diff-impact blast-radius (`codebase_graph_query` + `codebase_diff_impact` — 586 files, 1598 edges, layer-tagged, Prong A.5 of post-edit-code-review). Drive, email, calendar, web, code execution, scheduler, Stripe, marketing automation, code-health scan, recursive language model synthesis, tensions/ADRs/graph-explorer (R74.13z-quint+2), self-curating Tool Sommelier playbook (R74.13z-quint+3), four-tier web-access ladder with auto-escalation + Camofox stealth-browser microservice (R96), Felix self-thinking loop with failure-pattern memory + sentrux-inspired structural quality sensor (R98.7), project slash commands (/check, /registry, /commit-all) + AGENT_FOLDER_MAP cross-IDE skill mirroring + new slash_command tool (R98.10, the 284th), exit-77 + gate_command clean-skip pattern on delegate_task (R98.11), R98.13 plan_deliverable (prompt→pipeline router for 10 formats) + grade_deliverable (vision/audio quality grader 0-100 with bounded auto-revise), R98.14 durable resumable long-video jobs (start_video_job/check_video_job/finalize_video — chat turn closes cleanly even on 12+ min jobs, idempotent concat retry never re-renders the cheap-but-failed step) + nightly golden-path regression net + reference learner (learn_from_reference/recall_references — SSRF-jailed YouTube/web exemplar study, vision LLM extracts 3-8 concrete copyable patterns) + quality-instinct cards baked into Felix's persona, and R98.16 IJFW cross-pollination: `run_command` (#296, ad-hoc shell with large-output sandbox + domain-aware auto-summary so test runners / tsc / build / grep don't burn 8KB of context on ✓ lines, owner-tenant + Felix/Forge gated) + wave-table parallelism on plan_deliverable (sibling steps inside a wave dispatch in parallel via single-response multi-tool-calls — PDF wave 3 grade+verify, html_app wave 3 grade+deliver, research wave 1 deep+web, slides wave 1 orchestrate+create) + translateLlmError actionable error UX + sanitizeUntrusted heading/system-tag defang + atomicWriteFileSync parent-dir-fsync at 6 critical persistence sites + extended SSRF jail (CGNAT/multicast/IPv6/internal cluster TLDs)." },
              { icon: Network, value: "MCP", label: "Portable everywhere", sub: "Same tools available in Claude Code, Cursor, OpenAI Codex CLI, VS Code Copilot, Zed, and any MCP host. Per-tenant API keys, multi-tenant isolation." },
              { icon: Brain, value: "<100ms", label: "Hybrid Skill-RAG", sub: "BM25 + pgvector with reciprocal-rank fusion + LLM-as-judge fallback. Personas search before they read, every time." },
            ].map(({ icon: Icon, value, label, sub }) => (
              <Card key={label} data-testid={`card-edge-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                <CardContent className="pt-5 pb-5 px-4 space-y-2">
                  <Icon className="w-5 h-5 text-primary" />
                  <div className="text-2xl font-bold">{value}</div>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground leading-relaxed">{sub}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <RevealOnScroll>
            <Card className="bg-muted/30">
              <CardContent className="pt-6 pb-6 px-6">
                <div className="grid sm:grid-cols-3 gap-6 text-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-semibold">
                      <Zap className="w-4 h-4 text-primary" /> Self-improving skill loop
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      After every successful non-trivial task, the agent synthesises a reusable playbook into a skill candidate. The CEO promotes the good ones into permanent skills surfaced to all personas. The platform gets sharper every session — not every release.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-semibold">
                      <Activity className="w-4 h-4 text-primary" /> Resumable long-running work
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      Background scans, indexing jobs, and nightly research checkpoint to disk after every batch. A crashed or restarted process picks up exactly where it left off — no duplicate work, no lost findings.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-semibold">
                      <Shield className="w-4 h-4 text-primary" /> Production-grade governance
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      Strict tenant isolation (HMAC-derived per-tenant MCP keys), claim-then-commit webhook semantics, encryption-at-rest with loud failures, CSRF per-session, and the 80→95 autonomy layer with cost ceilings and owner approval for high-risk actions.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </RevealOnScroll>
        </div>
      </section>

      <section id="section-pricing" className="py-20 px-6 bg-muted/30 border-t border-border" data-testid="section-pricing">
        <div className="max-w-6xl mx-auto">
          <RevealOnScroll>
            <div className="text-center mb-12">
              <Badge variant="secondary" className="mb-4">Pricing</Badge>
              <h2 className="text-3xl font-bold mb-3">Simple, Transparent Pricing</h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Start free, pay per task, or subscribe monthly. Bring your own API keys for unlimited capacity.
              </p>
            </div>
          </RevealOnScroll>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {PRICING_TIERS.map((tier) => (
              <Card
                key={tier.name}
                className={`${tier.highlighted ? "border-primary shadow-sm" : ""} ${tier.trial ? "border-amber-500/50 bg-amber-500/[0.02]" : ""} ${tier.payPerTask ? "border-cyan-500/50 bg-cyan-500/[0.02]" : ""}`}
                data-testid={`card-pricing-${tier.name.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {tier.highlighted && (
                  <div className="px-5 pt-4">
                    <Badge data-testid="badge-most-popular">Most Popular</Badge>
                  </div>
                )}
                {tier.trial && (
                  <div className="px-5 pt-4">
                    <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30" data-testid="badge-free-trial">
                      <Sparkles className="w-3 h-3 mr-1" /> Free Trial
                    </Badge>
                  </div>
                )}
                {tier.payPerTask && (
                  <div className="px-5 pt-4">
                    <Badge variant="secondary" className="bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/30" data-testid="badge-pay-per-task">
                      <Zap className="w-3 h-3 mr-1" /> Pay Only for Results
                    </Badge>
                  </div>
                )}
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{tier.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{tier.description}</p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex items-baseline gap-1">
                    {tier.priceLabel ? (
                      <>
                        <span className="text-3xl font-bold">{tier.priceLabel}</span>
                        <span className="text-muted-foreground text-sm">/credit</span>
                      </>
                    ) : tier.price === 0 ? (
                      <span className="text-4xl font-bold">Free</span>
                    ) : (
                      <>
                        <span className="text-4xl font-bold">${tier.price}</span>
                        <span className="text-muted-foreground text-sm">/mo</span>
                      </>
                    )}
                  </div>
                  <ul className="space-y-2">
                    {tier.features.map((feature: string) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {tier.byokBonus && (
                    <div className="flex items-start gap-2 text-xs text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2 border border-emerald-500/20" data-testid={`byok-bonus-${tier.name.toLowerCase()}`}>
                      <Key className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{tier.byokBonus}</span>
                    </div>
                  )}
                  <Button
                    className="w-full"
                    variant={tier.highlighted ? "default" : "outline"}
                    onClick={() => navigate("/signup")}
                    data-testid={`button-pricing-${tier.name.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {tier.cta}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <RevealOnScroll delay={200}>
            <div className="mt-10 grid md:grid-cols-2 gap-5" data-testid="section-pay-per-task-details">
              <Card className="border-cyan-500/30 bg-cyan-500/[0.02]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-cyan-500" />
                    Credit Packs — Volume Discounts
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Buy once, use anytime. Credits never expire.</p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {CREDIT_PACKS.map((pack) => (
                      <div key={pack.credits} className="flex items-center justify-between bg-muted/30 dark:bg-white/[0.03] rounded-lg px-4 py-2.5 border border-border/40" data-testid={`credit-pack-${pack.credits}`}>
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-bold">{pack.credits}</span>
                          <span className="text-sm text-muted-foreground">credits</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">{pack.perCredit}/credit</span>
                          <Badge variant="secondary" className="font-bold">${pack.price}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-cyan-500/30 bg-cyan-500/[0.02]">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-cyan-500" />
                    Task Costs — Pay by Output
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">Only charged when work is completed. No charge for failed attempts.</p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {TASK_COSTS.map((tc) => (
                      <div key={tc.task} className="flex items-center justify-between bg-muted/30 dark:bg-white/[0.03] rounded-lg px-4 py-2.5 border border-border/40" data-testid={`task-cost-${tc.task.toLowerCase().replace(/\s+/g, "-")}`}>
                        <div>
                          <div className="text-sm font-medium">{tc.task}</div>
                          <div className="text-xs text-muted-foreground">{tc.detail}</div>
                        </div>
                        <Badge variant="secondary" className="font-bold shrink-0">{tc.credits} {tc.credits === 1 ? "credit" : "credits"}</Badge>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3 flex items-start gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    Example: A styled PDF report from research costs 5 credits (~$1.65 at the 75-credit pack rate).
                  </p>
                </CardContent>
              </Card>
            </div>
          </RevealOnScroll>

          <div className="mt-8 space-y-3 text-center" data-testid="section-byok-info">
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-5 py-2.5">
              <Key className="w-4 h-4 text-emerald-400" />
              <span className="text-sm text-emerald-300">
                <strong>Bring Your Own Key (BYOK):</strong> Use your own AI provider API keys and get up to 5x more usage on any paid plan.
              </span>
            </div>
            <p className="text-xs text-muted-foreground max-w-2xl mx-auto" data-testid="text-byok-disclosure">
              BYOK Disclosure: When using your own API keys, response quality, speed, and reliability depend on your chosen AI provider.
              {pn} provides the agent framework, tools, and orchestration.
            </p>
          </div>
        </div>
      </section>

      <section className="relative py-24 px-6 border-t border-border overflow-hidden" data-testid="section-cta">
        <div className="absolute inset-0 bg-gradient-to-t from-primary/[0.04] via-transparent to-transparent" />
        <RevealOnScroll>
          <div className="relative max-w-3xl mx-auto text-center space-y-6">
            <h2 className="text-3xl sm:text-4xl font-bold">Ready to deploy your AI corporation?</h2>
            <p className="text-lg text-muted-foreground max-w-lg mx-auto">
              Start with 5 free conversations. Experience all 16 agents, 359 tools, 24 + 62 + 25 skills, full document and video production
              with craftsmanship quality gates, self-evolving capabilities, and autonomous operations. No credit card required.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                size="lg"
                onClick={() => navigate("/signup")}
                className="gap-2 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-shadow"
                data-testid="button-cta-signup"
              >
                Start Free Now
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </RevealOnScroll>
      </section>
        </>
      )}

      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <a href="/landing" className="flex items-center gap-2 hover:text-foreground transition-colors" data-testid="link-footer-home">
            <img src={vcLogoPath} alt={pn} className="h-6 w-auto dark:brightness-[1.15]" data-testid="img-footer-logo" />
          </a>
          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={() => navigate("/about")} className="hover:text-foreground transition-colors" data-testid="link-footer-about">About</button>
            <button onClick={() => navigate("/contact")} className="hover:text-foreground transition-colors" data-testid="link-footer-contact">Contact</button>
            <button onClick={() => navigate("/store")} className="hover:text-foreground transition-colors" data-testid="link-footer-store">Shop</button>
            <button onClick={() => navigate("/terms")} className="hover:text-foreground transition-colors" data-testid="link-footer-terms">Terms</button>
            <button onClick={() => navigate("/privacy")} className="hover:text-foreground transition-colors" data-testid="link-footer-privacy">Privacy</button>
            <button onClick={() => navigate("/refund")} className="hover:text-foreground transition-colors" data-testid="link-footer-refund">Refunds</button>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <span data-testid="text-footer-copyright">&copy; {new Date().getFullYear()} {pn}. All rights reserved.</span>
            <a
              href="https://replit.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/50 border border-border hover:border-primary/30 hover:bg-muted transition-all text-xs"
              data-testid="link-powered-by-replit"
            >
              <svg width="14" height="14" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 5.5C7 4.67157 7.67157 4 8.5 4H15.5C16.3284 4 17 4.67157 17 5.5V12H8.5C7.67157 12 7 11.3284 7 10.5V5.5Z" fill="currentColor" opacity="0.7"/>
                <path d="M17 12H25.5C26.3284 12 27 12.6716 27 13.5V18.5C27 19.3284 26.3284 20 25.5 20H17V12Z" fill="currentColor" opacity="0.85"/>
                <path d="M7 21.5C7 20.6716 7.67157 20 8.5 20H17V28H8.5C7.67157 28 7 27.3284 7 26.5V21.5Z" fill="currentColor"/>
              </svg>
              <span>Built on <strong>Replit</strong></span>
            </a>
          </div>
        </div>
      </footer>
      <CookieConsent />
    </div>
  );
}

function CookieConsent() {
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem("cookie_consent_dismissed") === "true"
  );

  if (dismissed) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4" data-testid="banner-cookie-consent">
      <div className="max-w-4xl mx-auto bg-card border border-border rounded-xl p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="text-sm text-muted-foreground flex-1">
          We use essential cookies only to keep you logged in. No tracking or advertising cookies.
          See our{" "}
          <a href="/privacy" className="text-primary underline underline-offset-2">Privacy Policy</a>{" "}
          for details.
        </p>
        <Button
          size="sm"
          onClick={() => {
            localStorage.setItem("cookie_consent_dismissed", "true");
            setDismissed(true);
          }}
          data-testid="button-accept-cookies"
        >
          Got it
        </Button>
      </div>
    </div>
  );
}
