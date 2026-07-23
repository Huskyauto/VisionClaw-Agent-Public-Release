import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { SeoHead } from "@/components/seo-head";
import { ThemeToggle } from "@/components/theme-toggle";
import { RevealOnScroll, useInView, usePrefersReducedMotion } from "@/components/reveal-on-scroll";
import { LoopAnatomySection } from "@/components/loop-anatomy";
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
  Eye, Palette, ShieldCheck, Target, Rocket,
  Monitor, Smartphone, BookOpen, Lightbulb,
  Terminal, Briefcase, HelpCircle, ChevronDown, Network,
  FileCode, GitBranch, RotateCcw, Gauge, ShieldAlert, Lock,
  Quote,
} from "lucide-react";
const vcLogoPath = "/visionclaw-logo-full.jpg";
import { PERSONA_LIST, CREDIT_PACKS, TASK_COSTS } from "./landing-data";


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
    "ranks 407 tools by per-tenant performance",
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
      { icon: ShieldCheck, label: "Human-in-the-Loop Safety", detail: "High-risk actions require your approval. 41 governance rules, trust scores, and earned autonomy keep your AI team operating safely." },
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
    title: "3-Tier Model Fallback — Never Stop Working, Never Blow The Budget",
    subtitle: "Premium models by default, budget-friendly models when premium quotas tighten, free models at zero budget — automatic, cross-provider (OpenAI / Anthropic / Gemini / OpenRouter), and visible per call. The same idea third-party CLI routers ship as their headline feature, built natively into the platform and gated by tenant policy.",
    icon: Layers,
    color: "text-teal-600",
    bg: "bg-teal-600/10",
    features: [
      { icon: Crown, label: "Tier 1 — Frontier By Default", detail: "Every reasoning-heavy call (ensemble jury, deep research, code review, longform writing) is routed to the frontier pool — Claude Sonnet 4.5, GPT-5.6 Sol, Gemini 3.1 Pro, DeepSeek V4 Pro. You start at the top of the stack. `getModelForTier(\"reasoning\"|\"powerful\"|\"balanced\"|\"fast\")` makes the pick explicit per call site, not a magic constant." },
      { icon: Gauge, label: "Tier 2 — Cheap Pool When Premium Tightens", detail: "When a frontier provider returns quota/rate-limit/subscription-failed (`markProviderUnhealthy` / `markSubscriptionFailed`), the router silently downshifts to a lineage-diverse cheap pool — Llama 4 Maverick, Ling 2.6 1T, MiMo V2 Flash, Gemma 4 31B, GLM 4.7 Flash. Five different model families so a single provider outage doesn't degrade the whole tier." },
      { icon: ShieldCheck, label: "Tier 3 — Free Models At Zero Budget", detail: "The cheap pool deliberately includes a `:free` OpenRouter model. If your tenant's monthly cap is hit or every paid provider is unhealthy, work keeps moving on free inference instead of erroring out. Slower, lower-fidelity, but the agent never silently stops working in the middle of a job." },
      { icon: ArrowRightLeft, label: "Cross-Provider Translation Built In", detail: "Same call, four wire formats — OpenAI Responses API, Anthropic Messages API, Gemini generateContent, OpenRouter Chat Completions. `getClientForModel()` resolves the right SDK + base URL + auth header automatically. Add a model to `MODEL_REGISTRY` once; every persona and every tool can use it without per-call-site changes." },
      { icon: Workflow, label: "Opt-In Pool Override Per Call", detail: "Any `ensemble_query` invocation can pass `proposer_pool: \"frontier\" | \"cheap\" | \"mixed\"` to force the tier — useful for cost-conscious tenants who want a cheap-jury vote on routine questions and frontier-only on the high-stakes ones. Mixed pool runs 3 frontier + 3 cheap proposers side-by-side, with a κ-concordance score telling you when the cheap jury actually agreed with the frontier jury." },
      { icon: DollarSign, label: "Prompt Caching — ~40% Token Reduction Already On", detail: "Anthropic prompt-caching wired into long-context persona calls and tool-routing prompts (`server/anthropic-prompt-cache.ts`). System instructions + the 407-tool catalog are cached across turns, so subsequent calls in the same session reuse the cached prefix instead of re-paying for every token. Same outcome third-party routers advertise; ours is provider-native, not a proxy in front of your credentials." },
      { icon: Activity, label: "Telemetry Per Pool Choice", detail: "Every model call records `invoked_via` tagged with the pool that served it (`tool|pool=cheap`). The included A/B harness (`scripts/ensemble-query-ab.ts`) sweeps frontier / cheap / mixed pools across N prompts × R repeats and emits per-pool roll-ups — ok_rate, κ concordance, latency, answer length, escalation rate — so you can see when downshifting actually costs you quality and when it doesn't." },
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
      { icon: Mic, label: "Voice-Safe Ticker Lookup", detail: "`forecast_ticker` is on the Glasses Gateway voice-safe allowlist (20 of 407 tools) — ask 'what's AAPL doing?' through your Ray-Ban and hear the directional analysis hands-free." },
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
      { icon: Smartphone, label: "Hands-Free Workflow", detail: "Trigger any of the 407 tools by voice: 'log this expense', 'add to project notes', 'remind me at 3pm'. The glasses become a thin client to your full AI corporation." },
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
      { icon: ShieldCheck, label: "Tool Smoke-Test & Documentation Program — 395 / 395 Tools Verified, 20 / 20 Stages Signed Off (COMPLETE)", detail: "A staged, end-of-session program that smoke-tested and documented every one of the platform's tools — 20 stages of 20 tools each (107 live-safe / 287 doc-only; doc-only tools are NEVER auto-invoked). Each work session advanced exactly ONE stage at $0 / no LLM / no tenant. Completed 2026-07-02: 395 / 395 tools verified across 20 / 20 stages, 0 flags, with the full Tool Transparency Report published. The driver stays live for re-runs whenever the registry changes." },
      { icon: ShieldCheck, label: "Whole-App + 72h Code Review — 3 Tenant-Isolation + Silent-Failure MEDIUMs Closed Fail-CLOSED (R125+75)", detail: "A whole-app + 72-hour post-edit code review (agent-wiring audit exit 0: 394 tools, 0 dead/drift/leak/schema-gap) closed three pre-existing MEDIUMs in the tenant-isolation + silent-failure surface. **MEDIUM #1 — the central guarded-tool executor could take its tenant scope from a model-authored arg:** `server/guarded-tool-executor.ts` sourced the tenant from `ctx.tenantId || args._tenantId`, so a model that emitted `_tenantId` in a tool's args could steer the execution's tenant if a caller ever forgot to set `ctx.tenantId`; that fallback is removed so the tenant comes ONLY from the trusted `ctx` (every real caller sets it; lobster / plan-executor / task-planner deliberately do not route through this function). **MEDIUM #2 — event-bus status writes weren't tenant-scoped:** both `UPDATE event_log` status writes in `server/event-bus.ts` (the no_subscribers and the routed updates) matched on the event id alone, so a status write could touch a row in another tenant; both now carry an explicit tenant scope. **MEDIUM #3 — heartbeat swallowed a failed-event persistence error and wasn't tenant-scoped:** the failed-event `UPDATE event_log SET status='failed'` in `server/heartbeat.ts` had a bare empty catch that hid any persistence failure (the event would stay 'pending' and re-fire on the next tick with a misleading symptom) and matched on id alone; it now logs the failure loud and scopes the update to the event's tenant. Live-stat resync to the database: tables 211→212, indexes 620→623. tsc 0, regression suites green, confirming architect PASS. No new declared tools/tables/personas/capabilities." },
      { icon: ShieldCheck, label: "Whole-App + 72h Code Review — Inline-Markdown Injection in the Terminal-Failure Report Closed + the Owner-Jury Daily-Ceiling Concurrency Overshoot Fixed — 1 MEDIUM Closed Fail-CLOSED (R125+74)", detail: "A whole-app + 72-hour post-edit code review (4 parallel surface-split architect passes + agent-wiring audit exit 0: 394 tools, 0 dead/drift/leak/schema-gap) closed one MEDIUM and fixed a concurrency overshoot. **MEDIUM — inline-markdown injection on the R125+73 failure-contract renderer:** `server/agentic/failure-contract.ts`'s `clampLine` HTML-escaped only `<` and `>`, so untrusted approval-note / question / tool-error text quoted into the structured failure block could still inject INLINE markdown (links, images, emphasis, code spans, tables) when the block is rendered. A new `mdEscape()` backslash-escapes markdown special chars on every untrusted text field, while real artifact URLs pass `mdSafe=false` so they aren't mangled. +1 regression test, suite 9/9, tsc 0. **Also fixed — owner-jury metered daily-ceiling concurrency overshoot:** overlapping owner-initiated jury runs could each pass the daily-$ ceiling pre-check before any of them recorded spend. `server/moa.ts` now accrues a conservative per-run RESERVATION the moment the metered override is granted (so concurrent runs see the in-flight spend) and settles only the excess at the end — additive, so a throw mid-run fails SAFE (over-counts, never under) and self-heals on the daily roll. +2 regression tests (7/7), tsc clean. A public-route IP-source STRICT-mode inconsistency was triaged a FALSE POSITIVE (already logged, not a bypass — not surfaced). No new declared tools/tables/personas/capabilities." },
      { icon: ShieldCheck, label: "Structured Failure Contract for Terminal Agentic Failures — Every Dead-End Now Renders a Legible what-completed / what-failed / what-exists / next-step Block (R125+73)", detail: "A new pure renderer (`server/agentic/failure-contract.ts`) emits a consistent '✅ what completed / ❌ what failed (+why) / 📎 what exists now / 👉 exact next step (+owner)' markdown block plus structured meta, replacing the bare operator error strings on terminal-failure exits. Wired into ALL terminal-failure paths: approval REJECTION + EXPIRY (tenant-scoped, jsonb-merged into `agentRuns.result.failureContract`) and all 4 executor halts (wallclock / budget / stuck / max-turns). It deliberately does NOT auto-route around a rejected approval — that would weaken the AHB approval gate — it only makes an already-decided failure legible. Defense-in-depth: `clampLine` HTML-escaped `<` and `>` on every field (the inline-markdown gap on this surface was closed the next round in R125+74). 8/8 new unit tests, tsc exit 0, preflight clean; architect PASS twice. No new declared tools/tables/personas/capabilities." },
      { icon: ShieldCheck, label: "Closed the #1 Open Threat-Model Gap — Gate-1 Storage-Boundary PII/Secret Redaction on Every Durable-Store Write — 1 HIGH + 2 MEDIUM Closed Fail-CLOSED (R125+72)", detail: "A new central guard (`server/storage-helpers/pii-redaction-guard.ts`) composes the existing 48-pattern secret scanner and is wired into EVERY durable-store write path — `createMemoryEntry` / `updateMemoryEntry`, `createKnowledge` / `updateKnowledge`, `createConversationFact`, plus the one direct `agent_knowledge` insert in `server/step-ledger.ts` (rg-audited as the only write paths to those 3 tables). It ALWAYS strips credential-shaped secrets, Luhn-validated credit cards, and US SSNs before anything is persisted; email + phone are DETECT-only by default (frequently legitimate CRM/business facts — untrusted public-ingest sites opt in via `redactContactInfo:true`), closing the path where the model could persist secrets pulled from untrusted ingest into long-term memory/knowledge. **HIGH — step-ledger direct-insert bypass:** the one knowledge insert outside `storage.ts` skipped the guard entirely and is now routed through it, fail-closed. **MEDIUM #1 — unguarded update paths:** the `update*` write paths weren't covered (only the `create*` ones were) and are now wired in. **MEDIUM #2 — JSON-blob corruption risk:** string-redacting a JSON blob could corrupt it on a numeric credit-card leaf, so the guard now redacts the OBJECT before `JSON.stringify` via a recursive string + numeric-leaf walk with a Luhn check on numbers. Fresh scans found the new guard triggered ZERO findings (dependency 0 critical / 12 high report-only, SAST 817 all pre-existing, HoundDog criticals dev-only `scripts/`); the threat model's AML.T0070 + LLM04 rows moved ◑→✓ and gap-check #1 is closed. 15/15 unit tests, typecheck exit 0, architect confirming pass PASS. No new declared tools/tables/personas/capabilities." },
      { icon: ShieldCheck, label: "Required-MIME Verifier Gate Now Fails Closed on an Undeterminable Type + a Swallowed Audit-Log Write Made Visible — 2 MEDIUM + 2 LOW Closed Fail-CLOSED (R125+76)", detail: "A whole-app post-edit code review closed two MEDIUM and two LOW in the deliverable-verifier, storage-redaction, and memory-ranking surface. **MEDIUM #1 — the required-MIME verifier gate silently PASSED an undeterminable type:** `server/deliverable-verifier.ts` only ran the `requiredMimePattern` check when a MIME could be inferred from the file extension, so a MIME-gated deliverable whose extension yielded no MIME slipped through as a PASS; an undeterminable MIME on a MIME-gated contract is now a verification FAILURE. **MEDIUM #2 — a swallowed audit-log write was reported as durable:** the verifier's audit-log persistence was best-effort and its failure was swallowed while the result still returned as though the check were recorded (a repudiation gap); the result now carries an `auditPersisted` boolean (true on insert, false in the catch) so a persistence failure is visible instead of silently claimed. **LOW #1 — the redaction guard broke its own type contract:** `server/storage-helpers/pii-redaction-guard.ts` returned the raw value on a non-string / empty input, violating the declared string return contract; it now coerces non-string input to a string. **LOW #2 — a stale default-comment:** `server/memory-ranking.ts` described the exploration bonus as OFF by default when the live default is ON; corrected. Architect confirming pass PASS; tsc exit 0, PII-guard tests 15/15. No new declared tools/tables/personas/capabilities, no stat change." },
      { icon: ShieldCheck, label: "Autonomous Plan-Step Watchdog Bounded (Observational → Fail-Closed Per-Tool Timeout) + a Prod-Bundle EIO Probe Hardened — 2 MEDIUM Closed Fail-CLOSED (R125+71)", detail: "A whole-app + 72-hour review (4 parallel surface-split architect passes + wiring audit exit 0, 394 tools, 0 dead/drift/leak/schema-gap) closed two MEDIUM. **MEDIUM #1 — the plan-executor's autonomous tool-step watchdog was OBSERVATIONAL only:** `server/plan-executor.ts` registered a watchdog whose returned `AbortSignal` was discarded, and the bare `executeTool()` it guarded is signal-less — so a hung autonomous tool step neither aborted nor bounded the `await`. The step now runs through `executeToolWithTimeout()` (a per-tool `Promise.race` + `AbortController` that also aborts in-flight network tools) for bounded, fail-CLOSED plan progress; the AHB destructive-tool policy still runs BEFORE the call and still fails closed. **MEDIUM #2 — a prod-bundle existence probe degraded on any fault:** `scripts/lib/bwb-script-runner.ts` used a bare `fs.existsSync` inside a catch-all that returned `false` on ANY error, so a transient overlayFS EIO would silently fall back to the deterministically-broken `npx tsx` prod path; it now uses `existsSyncEIO` (retries transient EIO, throws on a persistent fault) and, on throw, PREFERS the prebuilt bundle (`node dist/*.cjs`) since the tsx loader is known-broken in prod. Architect confirming pass PASS — 0 new issues; typecheck + step-executor policy guard exit 0, regression suites green. No new declared tools/tables/personas/capabilities." },
      { icon: ShieldCheck, label: "Self-Approval-Bypass Class Closed End-to-End at the Central Guarded-Tool Executor — 2 HIGH + 1 MEDIUM Closed Fail-CLOSED (R125+70)", detail: "A whole-app + 72-hour review (4 parallel surface-split architect passes + wiring audit exit 0) closed two HIGH and one MEDIUM, finishing the self-approval-bypass hardening end-to-end. **HIGH #1 — the CENTRAL guarded-tool executor trusted a model-authored approval flag:** `server/guarded-tool-executor.ts` still READ `args._approvedByGate` to set BOTH `hasApproval` (the AHB destructive-tool gate) AND the HITL `skipGate` — the consumer-side complement to R125+69+sec, which had only stripped that signal at the producer step executors. Both reads are removed; approval is now sourced ONLY from the trusted `ctx.skipApprovalGate` (main chat's own SSE human-in-the-loop gate) plus `self_heal` context, so even a path that forgets to strip the signal can never self-approve at the chokepoint (verified repo-wide that nothing legitimately produces `_approvedByGate:true`). **HIGH #2 — schema drift:** `shared/schema.ts`'s `agentJobs` lacked the live `failure_class` / `rollback_note` columns + partial index the running code already uses; an additive schema-only sync mirrors the live DB (psql confirmed the columns + index were already present — no DB change). **MEDIUM — heartbeat `self_initiative` had no cross-process re-fire floor:** a 12h DB-`lastRunAt` guard now runs before the prod-only skip so cron drift can't double-fire it. Architect confirming pass PASS — 0 remaining CRITICAL/HIGH; typecheck + step-executor guard + regression suites green. No new declared tools/tables/personas/capabilities." },
      { icon: ShieldCheck, label: "Self-Approval-Bypass Sweep — a Lobster Step Could Spoof an Approval Flag to Self-Approve a Destructive Tool (R125+69+sec)", detail: "A whole-app + 72-hour review closed one HIGH and one MEDIUM, plus a platform-wide sweep of the same bug class. **HIGH — a lobster workflow step could self-approve a destructive tool:** an autonomous lobster step could set `_approvedByGate:true` (and spoof `_conversationId`) in its `toolArgs` to self-approve a requiresApproval/destructive tool and bypass the AHB destructive-tool gate; `server/lobster.ts` now strips BOTH signals and hard-sets `hasApproval:false`, so an autonomous step can NEVER self-approve. **MEDIUM — plan-executor identity fail-open:** `server/plan-executor.ts` fell back to the admin tenant on a non-numeric `plan.tenant_id` (a NOT-NULL column, so a corrupt/forged identity); it now fails CLOSED before any stamp. **SWEEP (same bug class, platform-wide):** a 3rd self-approval sibling in `server/task-planner.ts`'s autonomous step executor was closed, the `server/tools.ts` glued-name recovery hardened to `hasApproval:false`, and a fail-CLOSED **invariant 3** added to the step-executor policy guard so no executor can ever source `hasApproval` off `_approvedByGate` again. Architect confirming pass PASS — 0 remaining CRITICAL/HIGH; typecheck + agent-wiring audit exit 0. No new declared tools/tables/personas/capabilities." },
      { icon: ShieldCheck, label: "Whole-App + 72h Code Review — 2 Multi-Tenant HIGH Closed: Lobster Pause→Resume Privilege Escalation + Cross-Tenant Attachment Restore (R125+67)", detail: "A whole-app + 72-hour review closed two multi-tenant HIGH and fixed a prod-isolation bug. **HIGH #1 — lobster pause→resume dropped the invoker's identity:** when an autonomous lobster workflow pauses for human approval and later resumes, it lost the original invoker's tenant and persona, so a non-admin launcher's post-approval steps ran with the admin/`system`-trusted identity — lobster's `undefined` invoker fails OPEN to the admin tenant, not closed, so the dropped context silently escalated. The fix persists the invoker tenant + persona in the paused state and restores them on resume, giving resumed steps exactly the launcher's original authority. **HIGH #2 — cross-tenant attachment restore:** the attachment DB→disk restore path looked up stored files by a user-derived filename with NO tenant scope, so a crafted filename could read another tenant's stored file; the lookup is now scoped to the conversation's tenant. **Plus:** the heartbeat `self_initiative` task is now prod-only so a shared-DB dev box no longer double-runs the prod-seeded row, and the landing-page + features-doc statistics were resynced to the live database (211 tables, 128 capabilities, 620 indexes). Architect post-fix pass PASS — 0 new CRITICAL/HIGH. No new declared tools/tables/personas/capabilities." },
      { icon: ShieldCheck, label: "Whole-App + 72h Post-Edit Code Review (Clean) + a Delivery-Pipeline Tenant-Attribution Telemetry Fix (R125+66)", detail: "Four parallel architect passes (sensitive core / revenue + background / SSRF + delivery / frontend) over the last 72 hours returned PASS with 0 CRITICAL / 0 HIGH. The one delivery-cluster MEDIUM was verified a security FALSE POSITIVE — delivery assets are capability-gated at the `/uploads` middleware, not tenant-gated — and downgraded to a telemetry-accuracy LOW, then fixed: the delivery pipeline was stamping a hardcoded default tenant onto the signed download URL, both delivery-engagement events, and both publish-to-own-server callers; it now threads the real request tenant end-to-end so delivery telemetry and signed-URL scoping reflect the true tenant. Also resynced the live capabilities table count (126 → 128). No new declared tools/tables/personas/capabilities." },
      { icon: ShieldCheck, label: "Whole-App + 72h Security Review — 2 HIGH Closed + a Governance Round That Made the Loop Contracts Mechanically Checkable (R125+64 → +65)", detail: "A whole-app + 72-hour review closed two HIGH and tightened the autonomous-loop governance. **HIGH #1 (R125+65) — autonomous plan/lobster step executors bypassed the destructive-tool policy:** the task-planner and lobster step executors ran every plan/workflow step through the RAW tool dispatcher, which skips the AHB policy-enforcement layer (the trusted-persona / structured-args / approval / value-cap gates live ONLY on the guarded path). Both executors now enforce the tool policy BEFORE running each step and fail CLOSED; the policy persona resolves from the run's TENANT — internal/autonomous and admin/owner runs act as the trusted `system` persona, while any real non-admin invoker gets no trusted name so trusted-only and approval-required tools fail closed (deliberately NOT routed through the guarded executor, whose human-in-the-loop await would deadlock an autonomous run). **HIGH #2 (R125+65) — project-create conversation link wrote cross-tenant:** creating a project linked it to a conversation id with an UNSCOPED UPDATE, and that id (unlike `_tenantId`/`_personaId`) wasn't stripped from model-authored step args, so a step could spoof a victim tenant's conversation; the UPDATE is now tenant-scoped with a `RETURNING` guard and the link INSERT only fires when a row in the caller's OWN tenant actually matched. A new regression test pins the trust contract (4/4). **R125+64 (governance + security):** the 8 autonomous-loop contracts gained `verifier` (independent / self / deterministic — a loop must not grade its own output) and `spend` (capped / bounded / none / unbounded — token-blowout ceiling) fields, and the Loop Doctor now ERRORs on a self-grading loop, an unbounded-spend loop, and any `capped` loop whose source doesn't actually reference the atomic claim-before-spend seam (a verification you can't check is no verification) — which honestly downgraded one mislabeled loop; and a capability-recall call that searched agent-knowledge with NO persona scope (returning every persona's private rows within the tenant) now filters to the active persona's own rows plus global rows. Architect PASS — both HIGH closed fail-closed, SQL parameterized, persona leak closed; typecheck + build + Loop Doctor + unit tests green. No new declared tools/tables/personas/capabilities." },
      { icon: Cpu, label: "Autonomous-Loop Contracts + a Top-Tier Model-Lineup Refresh (R125+62 → +63)", detail: "**R125+62 — autonomous-loop contracts (governance).** The Forward-Future Loop Library reviewed out as curated prompts + doctrine with zero importable code, so the discipline was built natively instead: all 8 real autonomous loops (CI self-healer, auto-git-push, jury-queue drainer, skill-optimizer, tenant-isolation audit, BWB weekly render, agent-knowledge refresh, heartbeat tasks) now declare a typed objective / check / feedback / stop-conditions / escalation / authority / fail-mode contract — every mutating or destructive loop fails CLOSED. A new 'Loop Doctor' audit derives the live workflow set and ERRORs on any uncontracted loop (it caught a real umbrella workflow on the first run), with a bidirectional inventory covering the in-process loops too; 34/34 unit tests. The contracts are indexed into agent-knowledge, added to the capability registry and harnessed as weekly-maintenance Pass 12 so the personas actually know the loops exist. **R125+63 — top-tier model lineup refresh.** Removed `claude-fable-5` entirely (Anthropic's Fable 5 was shut down) and added `z-ai/glm-5.2` as a new top-tier OpenRouter model (verified live: 1M-token context) across the powerful/reasoning ladders, free-model rotation, resource predictor, context-window guard (1M) and cost ledger; the locked 4-model jury frontier is unchanged. Also folded in a whole-app-review fix correcting a stale `kimi-k2.5` → `k2.6` model id. Architect PASS, typecheck + build green. No new declared tools/tables/personas/capabilities." },
      { icon: ShieldCheck, label: "Platform-Security Hardening Sprint — 3 HIGH Closed + a Tenant/Persona Escalation in the Plan & Lobster Step Executors (R125+60 → +61)", detail: "Three HIGH closed in a whole-app + 72h review, plus the underlying tenant/persona escalation that surfaced it. **HIGH #1 — plan/lobster tenant+persona escalation:** the task-planner and lobster step executors force-stamp the admin tenant on every step but never carried the REAL invoker identity, so a non-admin tenant chatting with a trusted-named persona could run owner-only tenant-1 tools through a plan/lobster step — a path that bypassed the tenant check blocking their direct call. The fix threads the authenticated invoker tenant AND persona end-to-end, strips any model-supplied `_tenantId`/`_personaId` in the step, and force-stamps the real non-admin tenant — only an admin/internal caller ever gets the admin stamp (fail closed), giving plan/lobster execution exact parity with a direct tool call. **HIGH #2 — SSRF DNS-rebind TOCTOU at 4 more callsites:** the reference-learner content + thumbnail fetches, link-understanding, and the delivery-pipeline share-link verifier validated a URL then fetched it by hostname; each now PINS the undici dispatcher to the exact IPs already validated by the SSRF jail, with guaranteed cleanup. **HIGH #3 — `vc_` API-key admin confusion:** an admin-tenant API key could be mistaken for platform-admin when no admin PIN is set; the admin gate now excludes `vc_` keys from BOTH the session lookup and the no-PIN fallback. Architect PASS — all 3 HIGH closed fail-closed, 0 new CRITICAL/HIGH; +2 `vc_` auth regression tests (6/6 green), typecheck + build clean, agent-wiring audit GREEN. No new declared tools/tables/personas/capabilities." },
      { icon: Cpu, label: "Proactive Skill-Aware Re-Decomposition — the Planner Self-Checks Its Tools Before It Runs (R125+55)", detail: "The task planner used to discover an unusable tool only REACTIVELY — a step fails partway through a job, triggering a costly replan-from-failure. Now, right after it decomposes a task, it validates every step's tool against the REAL tool registry (minus the planner-blocked set) BEFORE anything runs, and if any step references a blocked or hallucinated/unregistered tool it re-decomposes ONCE with explicit feedback (SkillWeaver SAD, arXiv:2606.18051). A single acceptance gate accepts the revision ONLY if it is non-empty, STRICTLY reduces the tool-mismatch count, AND is structurally sound — dangling, self-referential and cyclic step dependencies are rejected via a Kahn topological sort, so a refine can never hand back a worse plan (the first review pass found a HIGH where a mismatch-only check could adopt a deadlocked plan; closed before ship). Bounded to one iteration, fails OPEN (any parse/LLM error leaves the original plan untouched). A behaviour layer over the existing planner — no new declared tools/tables/personas/capabilities." },
      { icon: Shield, label: "BWB Render-Reliability + Chat-Context-Hygiene Hardening Sprint (R125+56 → +59)", detail: "Four hardening rounds. **R125+56 — EIO-resilient reads:** Replit's Reserved-VM overlayFS intermittently throws `EIO` on ordinary file reads; the video render-farm script path's reads were still unguarded and prod disables the local-builder fallback, so a single EIO crashed the weekly recap. A new helper retries ONLY on EIO and re-throws once exhausted so a dead disk still fails closed. **R125+57 — bounded auto-retry on TRANSIENT infra faults:** the weekly-recap orchestrator now retries on transient faults (overlayFS EIO, render-farm timeouts, network/upstream 5xx) but NEVER on real content/config errors, claiming the spend governor fresh before each attempt so a rebuild can't bypass the daily cost ceiling. **R125+58 — AST regression guard:** a TS-compiler-API guard fails CI if any unguarded read-class fs op is reintroduced on a render-path file (resolving aliasing, computed access, imports and destructuring, comment-aware). **R125+59 — observation masking:** the chat round loop now trims stale tool-output bodies (dropping stale images — the biggest token win) while preserving call↔result pairing, cutting Lost-in-the-Middle rot on long agentic turns. Every round architect PASS (0 CRITICAL/HIGH/MEDIUM), unit-tested. No new declared tools/tables/personas/capabilities." },
      { icon: Cpu, label: "Difficulty-Adaptive UP-Route — Hard Requests Auto-Escalate to the High-End Model (R125+54)", detail: "The platform already down-routed trivial requests away from the expensive multi-model heavy loop (arXiv:2605.22687, the \"illusory AI productivity\" finding — reaching for the heavy tool on work your own judgment does faster). This round adds the mirror direction: when a request looks genuinely hard (complexity markers, length, cross-domain reasoning) but wouldn't otherwise trip the heavy ensemble, the AUTO path UP-routes it to the high-end model instead of answering cheap-and-shallow — tagged `request_class='adaptive-hard-route'` and counted by a new `upRouteCount` metric on the Orchestration Efficiency card on `/admin/ecosystem-health`. ADVISORY + fail-open: it only ever shapes the AUTOMATIC route and never blocks or skips an explicit `ensemble_query` / `jury_triage` call, telemetry is fire-and-forget so it can never slow the chat hot path, and the cost-exempt scoping of the sanctioned up-route is locked by a static regression test. A behaviour layer over the existing AUTO path — no new declared tools/tables/personas/capabilities." },
      { icon: Brain, label: "Actor-Critic Reflection — Coached Retry on a Stuck Loop (R125+53)", detail: "When an agent tries something, it fails, loops, retries and STILL spins with no success, the platform no longer just halts or blindly upgrades the model. A SECOND independent LLM (the critic-coach) reads the actual failed output, diagnoses WHY it failed, and hands targeted 'do this / don't repeat that' guidance back to the SAME primary loop for one more INFORMED retry — paired with a model escalation (the 'Combined' mode). The critic runs as an ISOLATED chat completion with its own system prompt and a freshly-built messages array (reviewer-independence invariant) — the failed output is passed as DATA, never by threading the live conversation history. Fails OPEN: any error or unparseable result falls through to the existing halt behaviour; a single `decideStuckRecovery` gate; escalation clamped at 2 and never downgrades. No new declared tools/tables/personas/capabilities — a behaviour layer over the existing supervisor loop." },
      { icon: ShieldCheck, label: "Fail-Closed Cost Circuit Breaker + Honest Compression-Savings Card (R125+52.24 / +52.23)", detail: "Two latest-round wins. **R125+52.24 (security HIGH closed):** the daily metered-Anthropic spend-ceiling circuit breaker now fails CLOSED on any guard/import error instead of proceeding uncapped — so a routing or wiring fault can never silently run up a metered Anthropic bill — while the high-value multi-model jury and the flagship lanes stay exempt and reroute gracefully; paired with a fail-closed tenant guard in the chat workspace-context builder so prompt context can never be assembled without a confirmed tenant. **R125+52.23 (new dashboard card):** the type-aware tool-output compressor now records its REAL bill-impact on live traffic into a new `tool_compression_stats` table, surfaced as a card on `/admin/ecosystem-health` — and reports the savings HONESTLY against the old head-slice baseline it replaced, never against raw uncompressed output, so the number is a truthful improvement figure (+1 table, +1 index; live aggregate 198 tables / 581 indexes). Verified: `tsc` clean, build green, architect PASS." },
      { icon: ShieldCheck, label: "Self-Hardening Security Sprint (R125+52.6 → +52.15)", detail: "A continuous run of self-driven security hardening on the platform's most sensitive internals. The multi-model jury queue — where the platform votes on and auto-applies its own code fixes — was hardened end to end: an HMAC-signed integrity layer plus an out-of-tree drain ledger (`jury_drain_ledger`) so a tampered queue file can never replay an already-applied fix; a single shared advisory-lock queue-writer so two racing producers can't drop each other's entries; and a claim-first drainer so two concurrent drainers can never route the same entry twice — including a fix to a lost-entry race where a legitimately-retryable item could be permanently skipped (a missing ledger row now defers-and-retries instead of being dropped). The headless-browser tool gained fail-closed post-action URL re-validation after every page-mutating step, closing an SSRF gap where a redirect mid-action could reach an internal address. Every fix went through architect FAIL→FIX→PASS review with the agent-wiring audit clean. Adds 1 table (`jury_drain_ledger`); tools unchanged at 391." },
      { icon: Gavel, label: "Jury Experience Library — Shadow Mode (R125+52.4)", detail: "Every time the platform's multi-model jury disagrees on an answer, a Training-Free GRPO experience library (arXiv:2510.08191, Tencent/Youtu-Agent) distills a single comparative 'semantic advantage' lesson from the divergence and files it into a new `jury_experiences` table — so the jury can get sharper over time without any model retraining. It runs in SHADOW MODE: collecting and scoring lessons now, but NOT yet injected into live prompts, behind a single grep-able go-live anchor and gated on a held-out eval before it ever goes live. Untrusted proposer text is tag-delimited and defanged before the evolver model sees it, and the whole path is fail-open fire-and-forget so it can never block or change a vote. The jury vote math also became a dynamic strict-majority (R125+52.3): a tie now ESCALATEs to a human instead of silently picking a fix, and auto-apply requires unanimity." },
      { icon: DollarSign, label: "Autonomous Spend Governor (R125+50)", detail: "A hard daily cost ceiling so the platform's self-running background loops can never silently run up a paid-LLM bill. Every background loop — the escalation resolver, the jury→implement queue drainer, the CI self-healer, the nightly skill optimizer, and the weekly video render — now checks a per-tenant daily budget at its first-spend chokepoint and fails CLOSED if it can't prove it's under budget (owner-only, $25/day default, configurable). A non-owner tenant gets $0 unless it brings its own provisioned budget, so the owner's wallet is never spent on an unpaid tenant. Paired with a new Escalation Resolver (R125+49) that drives the stuck repair-incident backlog to terminal states through the jury, and a Climb Tracker telemetry card + jury→implement loop (R125+48) that auto-applies jury-approved fixes." },
      { icon: Cpu, label: "Flat-Rate Model Routing (R125+51 / +52)", detail: "High-end models now bill flat-rate OAuth subscriptions instead of metered per-token API keys wherever possible — a reversible routing gate tries the subscription above the metered lanes while keeping the free model lane first, and falls through to a metered key only when no subscription is connected. A Claude Runner CLI bridge (R125+52) routes Anthropic inference through the local CLI so it bills the Max plan, with the metered API key deleted from the child environment when the subscription token is present. The canonical frontier jury is a declared four-model top-tier set (R125+52.1 / +52.2). **R125+52.17 takes it further:** everyday agentic, coding, and reasoning lanes now route to the free Gemini Flash and OpenAI-subscription lanes by default, and Claude is reserved for the high-value multi-model jury only — the tier resolver can no longer silently fall back to a metered Anthropic key when a free or subscription lane is available, so routine work never bills a per-token Anthropic charge." },
      { icon: Activity, label: "Delivery Funnel Telemetry (R125+47)", detail: "The platform now measures its own produce → ship → adopt funnel — inspired by 2026 research (SSRN 6859839, MIT) finding that AI lifts code *production* far more than it lifts shipping and adoption, so the weak links are delivery and uptake, not generation. A new `delivery_engagement` table plus a fire-and-forget recorder logs each produced deliverable and, via a hook in the `/uploads` auth middleware, the first confirmed fetch of a delivered file; a tenant-scoped 90-day CTE computes the funnel and surfaces it as a Delivery Funnel card on `/admin/ecosystem-health`. Honesty-first by design: `adopted` counts ONLY confirmed 200/206 initial fetches of `/uploads/delivery-N-*` files (instant-play `/watch` views use unlinked tokens), so it's a documented FLOOR, never a fabricated adoption signal — and a `degraded` flag shows an amber 'telemetry unavailable' banner rather than faking healthy zeros when the query fails. Adds 1 table + 2 indexes (live aggregate resynced to 192 tables / 564 indexes). Verified: `tsc` clean, build green, 16/16 funnel tests, architect FAIL→FIX→PASS (adoption recorded only on the final 200/206 status)." },
      { icon: Users, label: "One-Step Tenant Config-Forking (R125+46)", detail: "Stand up a brand-new tenant pre-loaded with a proven tenant's whole configuration — personas config, trust-tier `tool_policies`, per-persona `autonomy_rules`, voice/skill prefs, and the rest of an explicit 11-table config allowlist — in a single atomic transaction (`POST /api/admin/tenants/fork` or `scripts/fork-tenant.ts`), instead of hand-rebuilding every policy. Fail-closed: only tables on the `FORKABLE_CONFIG_TABLES` allowlist are ever copied (nothing by default), and `custom_tools` is deliberately excluded because its name column carries a global unique constraint a blind copy would violate. Every INSERT passes the destination tenant id explicitly, the source tenant stays read-only, and a failure mid-fork leaves zero half-created rows — verified no cross-tenant leakage on a 104-row dev fork. A `forked_from` column records provenance." },
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
    title: "407 Enterprise AI Tools (R125+1.1 — Whole-App + Last-72h Post-Edit Code-Review Pass: Architect Returned 1 HIGH (Systemic, Pre-Existing) + 1 MEDIUM (Recent Surface); MEDIUM FIXED Inline — client/src/pages/jobs.tsx:154 Rendered href={job.finalDriveUrl} With No Scheme Allow-List So A Tainted DB Value Could Become A javascript: URL Sink; Extracted The safeUrl() Protocol Allow-List (R124 Inlined In video-jobs-banner.tsx) To NEW client/src/lib/safe-url.ts (http/https + Site-Relative Only; Rejects javascript:/data:/vbscript:/blob:/file:), Imported In Both jobs.tsx (Anchor Only Renders When URL Passes Validation) AND video-jobs-banner.tsx (De-Duplicated); HIGH DEFERRED + LOGGED — ~42 Executable Callsites To uploadAndShare()/uploadToDrive() Outside server/delivery-pipeline.ts/google-drive.ts Bypass The replit.md HARD RULE + The R110 +sec Pre-Delivery Secret-Scan Gate (Anchors: server/video-job-runner.ts:678-687 Customer Video Finalization, server/routes.ts:1844, server/tools.ts:8508, server/mpeg-engine.ts:937, server/research-engine.ts:1865); Pre-Existing Systemic, NOT Regressed By R125+1; Documented As Known Defense-In-Depth Gap In docs/architecture-notes.md With Concrete R-Round Migration Shape (Top Customer-Facing Sites First → CI Regression Guard → Leave Internal Scratch Writes On Direct Upload); Single-User Blast Radius = LOW Today, Reopens To HIGH On Any Second-Human Consumer; Architect CLEAN On Tenant Isolation (Video-Jobs Routes), AHB (tests/security/ahb-regression.test.ts Non-Empty, Intent-Gate Fails-Open + Destructive Policy Fails-Closed, R125+1 proposer_pool Confirmed safe/LOW), SQL Parameterization (MoA Pool-Tag Write Parameterized Via Drizzle Template), CSRF (New Video-Jobs Routes Not Skip-Listed), R123 +sec Memory-Backup Fix Intact, Prompt-Injection/CoVe (Aggregator Prompt Unchanged By proposer_pool; CoVe Keeps Draft As User Content Not System Instructions), SSRF/jsdom/ESM (No New Regressions In Last-72h Surfaces), Stale-Strings Preflight CLEAN; tsc --noEmit CLEAN; No tools/tables/capabilities/governance/personas/MCP Changes; R125+1 — OpenRouter ensemble_query Proposer-Pool A/B Infrastructure — OPT-IN, No Default Flip; server/moa.ts Introduced FRONTIER_PROPOSERS (Alias Of Old DEFAULT_PROPOSERS — deepseek-v4-pro/gpt-5.5/gemini-3.1-pro-preview, Unchanged 3-Model Default), CHEAP_PROPOSERS (5 Lineage-Diverse OpenRouter Cheap Models: meta-llama/llama-4-maverick, inclusionai/ling-2.6-1t:free, xiaomi/mimo-v2-flash, google/gemma-4-31b-it, z-ai/glm-4.7-flash), MIXED_PROPOSERS (3 Frontier + 3 Cheap); MAX_PROPOSERS Bumped 5 → 8; Exported resolveProposerPool(name) + ProposerPool Type; Added pool?:\"frontier\"|\"cheap\"|\"mixed\" To MoAOptions; Selection Priority: Explicit proposerIds > pool > FRONTIER_PROPOSERS; Encoded Pool Choice In moa_responses.invoked_via As tool|pool=cheap Suffix — Telemetry Without A Schema Change; server/tools.ts Added Optional proposer_pool Enum Param To ensemble_query Schema; Dispatcher Validates And Silently Drops Invalid Values To undefined (Fail-Safe To Frontier Default); NEW scripts/ensemble-query-ab.ts One-Line Agent-Runnable A/B Harness (AB_TENANT_ID=1 AB_REPEATS=3 npx tsx scripts/ensemble-query-ab.ts) Sweeps N Prompts × 3 Pools, Emits CSV + Per-Pool Roll-Up (ok_rate / κ_mean / latency_ms / answer_len / escalate_rate), Per-Run try/catch So One Failed Run Never Sinks The Sweep, Exit 2 If ≥50% Runs Have Zero Ok Proposers; NEW tests/lib/moa-pool.test.ts 5 node:test Units On resolveProposerPool (Frontier=3, Cheap=5 With 5 Distinct Vendors, Mixed=6 = Frontier + 3 Cheap, Precedence Contract, Returns Fresh Arrays); Post-Edit Architect Review PASS With 1 LOW (invoked_via Mistagged When Explicit proposerIds Co-Supplied With pool — Telemetry Only); FIXED Inline At server/moa.ts:333 — invokedViaTagged Appends |pool=... Only When !explicitProposerIds; Precedence-Contract Test Added; Architect-Verified CLEAN On Sensitive Surfaces; No tools/tables/capabilities/governance/MCP scopes/personas Changes; tsc --noEmit CLEAN; R123 +sec — Post-Edit Code-Review HIGH Fix: POST /api/memory/backup-to-drive Bypassed deliverDigitalProduct() And The R110 +sec Pre-Delivery Secret-Scan Gate (48 Patterns, Fail-CLOSED On CRITICAL/HIGH); Refactored To Stage Backup JSON Under uploads/ Then Route Through deliverDigitalProduct({customerName, productName, filePath, fileName, mimeType:application/json, sendEmail:false, metadata:{kind:memory_backup,tenantId,stats}}); Response Now Returns deliveryId + shareableLink/folderLink/downloadLink And 500s Cleanly On delivery.success===false; NEW tests/security/memory-backup-uses-delivery-pipeline.test.ts Regression Strips Line + Block Comments Then Asserts No Executable uploadAndShare( / uploadToDrive( Call AND Presence Of deliverDigitalProduct( (Pinned 2/2 Pass); Whole-App Post-Edit Code-Review Pass Across Last-72h Surfaces (R123 CoVe + R122 Unified Memory + R120.1+sec AHB Safety_Profile + R120 RLS + R121 Skill Imports) AND App-Wide Sensitive-Surface Invariants (Tenant Isolation Via withTenantTx, AHB Intent-Gate + Destructive-Tool Policy, SQL Parameterization, CSRF, Secrets/File-Delivery, Prompt Injection On New CoVe Surface, SSRF, jsdom, ESM, OAuth) → Architect Verdict CLEAN On R120/R122/R123 Sensitive Surfaces, The One HIGH Closed And Re-Verified; R123 — Chain-Of-Verification (CoVe, Dhuliawala et al. Meta FAIR, arXiv:2309.11495) Factuality-Hardening Pass For Longform Outputs; NEW server/lib/cove-verifier.ts Runs A 4-Step Pipeline: PLAN (Extract Atomic Factual Claims + Rewrite Each As Standalone Verification Question, JSON-Formatted, Max-Clamped 1..15 d=8) → EXECUTE INDEPENDENTLY (Answer Each Question In PARALLEL Via Promise.allSettled, Each Call In A FRESH Context With NO Draft Visible — Single-Model Independence ≈ Ensemble For Narrative Claims Since Model Can't Repeat Its Own Bias If It Can't See What It Wrote, 30s Timeout Per Question Via AbortController) → REVISE (Show Draft + Q/A Pairs, Ask For JSON Revision That Softens UNCERTAIN Claims And Replaces Contradictions) → Return {revised, unchanged, claimsExtracted, questionsAsked, contradictions[], qa[], modelUsed, durationMs, warning?}; NEVER Throws — Fail-Safe Wraps Every Step And Falls Back To Original Draft + warning; 16k Char Draft Cap, Drafts <80 Chars Returned Unchanged; NEW Agent Tool verify_with_cove (safe / LOW / requiresStructuredArgs, isNetworkTool:true, categories: system + quality + research); NEW Capability chain_of_verification In capability-registry With Dhuliawala Citation + Cassandra Integration + Explicit ~5-25% Factuality Lift Not 94% Caveat; WIRED INTO server/research-report-fulfillment.ts As Opt-In verify?:boolean Flag On ResearchReportIntake (Default Off; AUTO-ON For depth:deep Since Deep Reports Are The High-Stakes Surface) — Per-Section Pass With maxQuestions:6 modelTier:balanced Skipping Bookend Sections (Intro/Disclaimer/Sources) And Bodies <200 Chars Or Starting With ( (Error Fallbacks); Fail-Open At The Call Site So A Bad CoVe Pass Never Sinks A Paid $49 Report; Per-Section + Per-Order CoVe Summary Lines For Telemetry; NEW tests/lib/cove-verifier.test.ts Pins The Fail-Safe Surface (Short Drafts → Warning, Empty/Whitespace → Fail-Safe, Invalid tenantId → No Throw, maxQuestions Clamped); Tools 360 → 361 (+1 verify_with_cove), Capabilities 111 → 112 (+1 chain_of_verification); R122 — Unified Memory Context: Single Read Surface Across 11 Memory-Adjacent Tables (memory_entries, agent_knowledge, conversation_facts, mind_tickets, procedure_edits, agent_runs, agent_trace_spans, graph_memory, knowledge_triples, mind_events, conversations); NEW server/memory/unified-context.ts aggregator runs all 11 per-source fetchers in parallel inside ONE withTenantTx (R120 RLS context applies to every read) and returns a normalized {source, id, ts, title, body, category?, status?, personaId?, link?} envelope sorted DESC by ts with per-source totals + per-source filtered counts + per-source fail-OPEN so one wonky table doesn't break the view; THREE surfaces: NEW agent tool get_unified_memory_context (safe / LOW / requiresStructuredArgs, categories: memory + conversations + knowledge), NEW HTTP GET /api/memory/unified, NEW CLI npx tsx scripts/memory-find.ts \"keyword\"; NEW /memory page \"Unified\" tab as FIRST tab with cross-source timeline + 11-color source-pill filter + debounced ILIKE search + sinceDays selector (7 / 30 / 90 / 365 / all) + per-source filtered/total density + deep links per source type; NEW capability unified_memory_context in capability-registry; tools 359 → 360 (+1 get_unified_memory_context), capabilities 110 → 111 (+1 unified_memory_context); R121 — 4 NEW Engineering-Discipline Skills Imported From Matt Pocock's MIT-Licensed Public Skills Repo (github.com/mattpocock/skills, ~48-77k stars) Adapted For VisionClaw: NEW `.agents/skills/tdd/` (Red-Green-Refactor With Strict RED-First Discipline + VisionClaw Sensitive-Surface Invariant Table Mapping AHB Persona / TOOL_POLICIES / Tenant-RLS / CSRF / Drive Admin-Marker To Mandatory Pre-Implementation Tests), NEW `.agents/skills/cross-session-handoff/` (Cross-Session/Cross-Agent Briefing Doc At `.local/handoffs/YYYY-MM-DD-topic.md` — Distinct From Intra-Turn `.local/session_plan.md`, Includes Suggested-Skills + Sensitive-Surface-Invariants-Touched Sections, Gitignored), NEW `.agents/skills/zoom-out/` (Pre-Edit Orientation Primitive Producing Module Map + Caller Map + Sensitive-Surface Invariant Checklist Before Touching Unfamiliar Code, Distinct From Architect Which Runs Post-Edit), NEW `.agents/skills/write-a-skill/` (Diff-Merge With Platform's `.local/skills/skill-authoring/` — Adopts Matt's Sharper Description-Is-What-Future-Agent-Sees Framing + Scripts Criteria + Review Checklist On Top Of VisionClaw R-Number Attribution + Sensitive-Surface Flag Table + .agents/skills/ vs data/output-skills/ Distinction); NEW `docs/future-integration-bookmarks.md` (Lightweight Living Index Of External Repos Worth Remembering — Bookmarks mattpocock/skills + HKUDS/AI-Trader With What/Why-Not-Today/When-To-Revisit/Concrete-Integration-Shape/Anti-Goals Per Entry); Skill Count 24 → 28 .agents/ Skills (+4); No New Tools / Tables / Indexes / Personas / Governance / Capabilities / MCP Scopes — Pure Engineering-Discipline Surface; R120.1+sec — AHB Safety_Profile Coverage Gap Closed: 10 Of 16 Active Personas Had safety_profile = '{}'::jsonb In Live DB (intent gate at server/safety/intent-gate.ts:154 bypasses entirely when restrictedCategories is empty, so adversarially-styled requests routed to those personas got ZERO AHB screening); NEW scripts/migrations/R120.1-persona-safety-profile-backfill.sql applies idempotent role-appropriate UPDATEs (strict intentGate for Cassandra/Luna; moderate for VisionClaw + Forge + Chief of Staff + Agent Blueprint + Scribe + Proof + Radar + Neptune + Atlas + Minerva); NEW Runtime self-heal block at server/seed.ts re-applies same UPDATEs at every startup so fresh DBs auto-populate; NEW CI invariant test tests/security/persona-safety-profile-coverage.test.ts (1/1 PASS on dev) fails build if any active persona has missing intentGate or empty restrictedCategories; MEDIUM (architect) FALSE POSITIVE — CSRF middleware claim verified at server/validation.ts:188-198 where getCsrfSessionKey returns 'tnt:'+tenantId unconditionally when tenantId is non-null, so the !sessionKey branch at line 274-276 is dead defensive code; logged not fixed; R120 — Architectural Hardening Per Gemini-3.5-Flash-Extended Review: Postgres Row-Level Security On 12 Highest-Sensitivity Tenant Tables As Second Line Of Defense Behind App-Layer WHERE Clauses + NEW withTenantTx(tenantId, fn) Helper In server/db.ts + Cross-Tenant RLS Isolation Test + Index-Usage Audit Surfacing 55.91 MB / 68.9% Reclaimable + docker-compose.dev.yml With Ollama For Cost-Conscious Contributors + Local tsc Preflight Gate + RLS Phased Rollout Plan + Microsandbox Design Doc; R119.2+sec — Cross-Tenant Nightly Memory-Backup Hardened Via 3 Architect Passes Loop-Until-Clean, \"Fix All Defer Nothing\": __VisionClaw-Admin-Backups__/ Folder + __admin-memory-backup- Filename Prefix + ADMIN_DRIVE_ARTIFACT_RE List Filter + Fail-CLOSED driveJson Metadata Preflight On google_drive Download/Delete/Share — Refuses Operation If Name Empty, meta.error Truthy, Regex Match, Or Lookup Throws; MEDIUM #1 server/seed.ts Manjaro→wellness-program Normalizer Narrowed To Exclude Linux Ecosystem Terms; MEDIUM #2 R118 message_feedback.comment Now Has Idempotent DB-Level CHECK char_length<=2000; R119 — Context-Window Expansion Exploits 1M-Token Frontier Models (Gemini 3.5 Flash, GPT-5.5, Claude 4.7, DeepSeek V4 Family, Grok 4.20) With Per-Model Trigger Budgets (1M→702K, 200K→102K, 128K→64K Floor), Static ESM Model-Aware compaction.ts Closing Architect MEDIUMs On Dynamic require + Double-Scaled 0.75, Self-Reflection 10× Truncation, Agent-Channels 3× Cross-Persona Awareness, Orchestrator-Ledger Facts/Plan 4× + history.slice(-50), vectorSearchKnowledge topK 25; R118 — Per-Message ThumbsUp/ThumbsDown Feedback Becomes The 4th AEvo Evidence Dimension With Fail-CLOSED Tenant Invariants + JOIN-Verified Message Ownership + UPSERT (tenant, msg, COALESCE(user_id, 0)) + Server-Side Topic-Hint Resolution; R117.1+sec — Cross-Tenant file_storage Overwrite Hardened In server/pdf-create.ts: resolveTenantOrAdmin Helper + ADMIN_TENANT_ID Constant + Scoped SELECT/UPDATE/INSERT With tenantId Validation — Architect-Verified PASS, All ~30 Admin-Tier scripts/* Callers Default To Tenant 1 With Per-Call console.warn Audit Trail; R117 — Two NEW Token-Optimization Tools (read_output_blob + code_slice) On A Shared Symbol-Graph Layer With Token-Aware ReDoS Structural Scanner Rejecting Lookarounds, Backreferences, Nested-Quantifier Shapes, And Quantified-Group-With-Alternation; R116 — agentmemory Tier-A (R115.5+sec round 3 — Thorough 3-Pass Architect Review On The R113.5→R114 Ship Closed 1 HIGH (Legacy MCP `/api/mcp/sse` SSE Surface Gated Behind LEGACY_MCP_ENABLED=1, Default OFF — Scope-Restricted R113.7+sec `/mcp` Streamable HTTP Is The Supported Integration) + 1 MEDIUM (AEvo Forbidden-Pattern Catalog Hardened Against Confusable / Zero-Width / NFKC Bypasses Via `normalizeForPatternCheck` — Soft Hyphen, Fullwidth Latin, ZWSP All Fail-CLOSED) + 4 LOWs (`emptyBodySchema = z.object({}).strict()` Wired Across Procedure-Edits Apply, Council-Verdicts Request, Scheduled-Posts Delete, MCP-Keys Delete — Body-Smuggling Rejected At The Gate); 30/30 AEvo Invariants Pass With 3 New Unicode Regression Tests; SSRF Rebinding MEDIUM Deferred (Pre-Existing, Requires undici Dispatcher Refactor); R114 — AEvo Meta-Editing Of Procedure Context (Zhang et al., arXiv:2605.13821): HITL-Gated Meta-Agent Proposes Minimal Surgical Edits To `data/output-skills/` Playbooks Based On Accumulated Evidence (≥3 agent_trace_spans + delivery_verifications + grade_deliverable Rows), CAS sha256-Pinned, Rollback-Capable; Edit-Surface Allowlist Is HARDCODED Type-Level (targetKind='output_skill' ONLY — NOT .agents/skills/, NOT persona souls, NOT doctrine, NOT safety_profile, NOT TOOL_POLICIES); Forbidden-Pattern Catalog Validator Fails CLOSED (Frontmatter name: Change, safety_profile, intentGate, restrictedCategories, destructiveToolPolicy, refusalCopy, AHB Regression, .agents/skills/ Paths, TOOL_POLICIES Literal, Doctrine #N Markers, persona_soul); Tables 171→173→174 (R115.5 sprint_contracts) (procedure_edits + procedure_evolution_runs), Indexes 449→452, Governance 42→43, Capabilities 109→110 (aevo_meta_editing), Tools 347→357 (propose_procedure_edit, list_procedure_edits, approve_procedure_edit, reject_procedure_edit, apply_procedure_edit, rollback_procedure_edit); NEW `/procedure-edits` Admin UI; Persona Doctrine #13 Added — Every Persona Sees The Edit-Surface Allowlist + Forbidden-Pattern Catalog + Propose-Not-Apply Posture; R113.7+sec — MCP-Server Expose: VCA Now Speaks MCP To External Clients (Claude Desktop, Cursor, Custom Agents) Via Streamable HTTP At POST /mcp With Per-Request Transport + Per-Request McpServer Instance + Cleanup On res.close; NEW Table mcp_api_keys (tenantId notNull, sha256 key_hash, scopes text[], +2 Indexes); Curated 8-Tool MCP Surface (NO Money-Movement, NO Mass-Comms) — schedule_cross_platform_post, cancel_scheduled_post, list_scheduled_posts, get_scheduled_post, list_personas, lookup_output_skill, list_output_skills, get_platform_info; Architect Closed 1 HIGH (Scopes Stored But Never Enforced — Defined MCP_SCOPES Registry With scheduler:write / scheduler:read / catalog:read / * Wildcard + Fail-CLOSED hasScope Guard In Every Tool Handler) + 1 MEDIUM (/api/mcp-keys CRUD Accepted Bearer vc_* — New requireSessionAuth Helper Rejects vc_ With 403); R113.6 — Facebook Page Publisher + YouTube Video-Bridge Wired Natively, NO Third-Party Relay (Closed HIGH SSRF/Memory-Exhaustion: arrayBuffer Was Buffering Before 256MB Cap Check — Replaced With Streaming Content-Length Check + AbortController Cancel); R113.5 — Self-Hosted Multi-Platform Social-Post Scheduler Foundation; R112.18 — Tool Selection Discipline System: Three-Layer Belt+Suspenders Forces Every Agent To Consider The Best Tool BEFORE Acting Across The 342-Tool Inventory — LAYER 1 Top-Picks Header (passive, always-on; semanticRank + per-tenant performance, top 5 per turn, ~250 tokens, env-disable `TOOL_TOP_PICKS_DISABLE=1`); LAYER 2 NEW `recommend_best_tool` Tool (gated, active; <50ms embedding lookup, MANDATORY before 3+ step plans / paid APIs / irreversible writes / customer-facing deliverables); LAYER 3 Post-Call Validator (reactive, automatic; embedding-only re-rank after FIRST tool call, fires `★ TOOL SELECTION HINT ★` once per session if gap ≥0.08 cosine); tools 340→342, governance 40→41 (+1 Tool Selection Discipline System); R112.17 — Tier 1 Web-Access Bot-Wall Bypass via Apify `header-generator` Nugget (Bayesian-Network-Trained Realistic Browser Headers behind env flag `WEB_ACCESS_TIER1_REALISTIC_HEADERS`, default ON, three-layer fail-safe, defense-in-depth SSRF/prompt-injection preserved); R112.16 +sec — One-Shot Video Tool `build_video_from_brief` Collapses Felix's 6-Step Orchestration Into ONE Call (Plan + Finalize + Deliver Auto); R112.16 — Legacy-Path Delivery Gap Closure (start_video_job Dispatch Forwards autoFinalize/autoDeliver/customerName/customerEmail; Compiler-Enforced via Extended Types; NEW scripts/resend-delivery-email.ts Rescue with 60-Day Signed URLs + Four-Link Body); R112.16 +sec — Architect Re-Review Closed 1 HIGH (Rescue-Script Cross-Tenant Signing Footgun Hardened — Explicit TENANT_ID or metadata.tenantId Required, Owner-8 Fallback Requires ALLOW_DEFAULT_OWNER=1, NEW DRY_RUN=1 Mode) + 1 MEDIUM (start_video_job Schema Exposes New Flags with LEGACY Guidance to Prefer build_video_from_brief); R110.15 — Whole-App Architect Sweep + Self-Compacting replit.md (NEW `scripts/replit-md-compact.ts` runs every commit cycle, fail-OPEN, threshold-based — solves the recurring \"replit.md is getting large\" nag without manual intervention) + Executor Budget-Cap Hardened (Explicit tenantId Guard); R110.14 — Two Final Barry Zhang Nuggets: Per-Loop USD Budget Cap + Trajectory-Based Golden-Path Eval (warn-only week 1); R110.13 — Barry Zhang Anthropic \"Building Effective Agents\" Seminar Audit, 5 Actionable Gaps Closed (Wall-Clock Circuit Breaker, Consecutive-Failure Circuit Breaker, Tool-Design Hygiene Linter, Per-Persona Tool Sprawl Audit, NEW `scripts/agent-perspective.ts` Trace-Tree Printer); R110.12 — IJFW Nuggets: NEW `critique` Skill (#24, Structured Steelman→Counter-Args), Stale-String Preflight Gate, Weekly-Maintenance Pass 9, Three Workflow Rules (2-Failed-Corrections-Stop, AskUserQuestion Score Rule, session_plan Format); R110.11.5 +sec — 11 Sub-Rounds R110.2 → R110.11.5 of Felix Render Hardening + Fish Audio Primary TTS Cascade + Public Mirror CodeFlow Card + Split Liveness/Readiness Probe + Baidu ERNIE Auto-Promote Overlay + 72h Architect Sweep Closing 4 Findings In Same Round; R110.1 +sec — Gold-Review Hardening: 4 HIGH + 3 MEDIUM Architect Findings Closed Across 3 Passes Verified CLEAN at Pass 6 — Upload-Scan FAIL-CLOSED, Delivery-Scanner-Throw Synthesizes Blocking Hit, jsdom RCE Sink Removed in html-app-builder + deliverable-grader, Full DNS-Resolving SSRF Guard with IPv4-Mapped IPv6 Hex-Form Coverage, write_file Pre-Drive Secret Scan with Reason Propagation; R110 +sec — Pre-Delivery Secret Scan: 48-Pattern Credential-Regex Catalog Wired as Fail-CLOSED Gate in Delivery + Ingest, Agent-Callable `scan_for_secrets`, All 16 Personas Wired; R109.4 +sec Hardening + Stat-Drift Sweep with Dockerfile data/ Allowlist; R109.3-fix Self-Healer No-Op-Heal Gate; R109.2.3 Monid Agent-UX Clarity Pass; R109/R109.1/R109.2 +sec discover-first integration with prompt-injection fence, per-tool rate ceilings, cost ledger, SSRF guard; R108.1 +sec Fail-CLOSED Hardening; R108 Adaptive Plan-Node maxSteps + Causal Evidence Edges + Cold-Start Hypothesis Nudge; R107 Regime-Aware Memory Consolidation)",
    subtitle: "Everything a modern business needs, powered by 41 curated AI models (plus 1000+ discovered daily via OpenRouter) across 22 tool categories. R98.19 Memory v2 layered four complementary mechanics onto the agent memory subsystem (confidence-scored facts ranking recall by `confidence × recency × access-frequency`, debounced 30s write queue, synthesis-time dedup against existing facts, and an 8K token cap on recall context so memory never blows out the chat budget). **R98.19+sec** is the immediately-following whole-app architect sweep Bob requested — three review rounds, six real bugs closed. The big finding: a recurring bug class showed up across five separate hardening passes — historical code used `require()` inside `try/catch` blocks, but the project runs in ESM mode, so every one of those `require()` calls threw 'require is not defined' at runtime and the catch silently swallowed it. Net effect: five different security primitives were quietly degraded for as long as those files have been deployed. All five fixed in one session: provider-error secret redaction (was passing through unredacted), gate_command untrusted-stdout fence (was silently degrading), wrapAsData fence builder, presenter constant-time HMAC compare (was hard-blocking every legitimate call with 403), and the Claude-agent GitHub-importer prompt-injection scanner (the most serious — imported agents could carry 'ignore previous instructions' payloads straight into a durable persona). The scanner catch was also tightened from 'false fail-closed' to true fail-closed quarantine. R98.18+sec was the self-healing maintenance round closing two HIGH dependency CVEs (drizzle-orm 0.39 → 0.45 + xlsx removed entirely). R98.17 added a 4-tier risk-class taxonomy + hard kill switch + Cairo's MC-1 Gate reserving chat slots. R98.16 shipped the 296th tool, `run_command`, with a large-output sandbox that auto-summarizes test/build/grep output.",
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
      { icon: DollarSign, label: "Revenue Missions Engine + Gap Closures (R125+137.66–.75)", detail: "Five owner-only tools (`mission_create`, `mission_list`, `mission_status`, `mission_draft_experiment`, `mission_portfolio_review`) drive autonomous revenue experimentation behind a deterministic mission stage machine (kill-from-any-stage) plus 3 tables (`revenue_missions`, `mission_experiments`, `mission_evidence`). A HARD_CAPS clamp bounds every mission at 25 prospects / 3 contacts / $25 — mission rows may TIGHTEN but never raise. Read-only Gmail sample harvest → draft packet with zero send paths pre-approval; on approval, CAS race-safe capped outreach with rollback + a fail-closed pre-send spend gate + a mandatory opt-out line; a read-only Gmail reply scan dedupes into mission evidence. A fail-closed Stripe evidence hook verifies revenue; an autonomy ladder (10% reinvestment / $250 cap) governs scaling; a max-3-concurrent-experiments cap is enforced fail-closed ABOVE the draft INSERT. **R125+137.75 gap closures:** a mission retrospective hook (`scoreMission` 0–100 + lessons/ROI captured on every kill or scale), a fail-closed pre-spawn budget gate that refuses on an explicit null spend, and a $0/no-LLM background opportunity scanner (proposal-only, Mon 14:00 UTC). Admin UI at /admin/revenue-missions; approve/kill are HITL-only — deliberately NOT tools. Guard tests 60 → 81." },
      { icon: DollarSign, label: "Sell & Fulfill Loop — Commerce Tools + Auto-Fulfillment (R125+137.74)", detail: "The closed sell-and-fulfill loop: a `commerce_products` DB catalog plus 3 owner-only commerce tools (`product_listing_create`, `product_listing_list`, `create_payment_link`; tools 404 → 407) let the platform list and price its own products. The $497 self-serve AI Readiness Audit now auto-fulfills the instant a Stripe payment lands — the deliverable is generated and shipped, and the buyer is enrolled in a post-purchase follow-up sequence with no human in the loop." },
    ],
  },
  {
    title: "Trust & Continuity (R64 → R125+137.76+sec Hardening)",
    subtitle: "Multiple rounds of security work + cross-AI critique panels — the platform critiques itself, isolates every tenant, and protects every customer download. Latest sweep: R125+137.73+sec → +137.76+sec — a tenant-isolation audit burn-down triaged all 99 kept HIGH/CRITICAL findings across 5 parallel passes and fixed 17 REAL findings across 15 sites (fail-closed tenantId in storage/compaction/data-protection, ownership checks in revenue-missions/business-tools/agent-channels, scoped SELECTs, DEFAULT 1 removed from quarterly-intelligence + a live ALTER DROP DEFAULT), with 82 verified FALSE POSITIVE and the nightly audit gaining a strict suppressible system-sweep pattern; then a 72h whole-app review (3 parallel architect passes) closed 1 HIGH (archive-rescue paid webhook hardcoded tenant_id=1 → ownerTenantId() SoT) + 3 MEDIUMs (data-protection softDelete tenant-scoped atomic UPDATE...RETURNING; compaction memory-extract routed through redactPiiForStorage; revenue-missions experiment cap race-proofed via pg_advisory_xact_lock). Prior sweep: R125+137.61+sec → +137.65+sec — three 72h whole-app review rounds (parallel architect passes over ~330 changed files) closed five MEDIUM tenant-isolation findings: the heartbeat seed reconciler now hard-requires the admin tenant on its row match (a non-admin row with the same key can no longer poison seeding), heartbeat approve/reject endpoints are tenant-scoped (404 on mismatch, tenant-guarded UPDATEs), the inbox-ingest orphan-retry lookup now carries the tenant filter (another tenant's same-message row can't be claimed), research session status reads fail CLOSED on an invalid tenant (the unscoped fallback removed), and the autonomous wake scheduler now fails CLOSED on an invalid tenant before any database write. Prior sweep: R125+137.46+sec + R125+137.49-review — a CRITICAL credential-exposure closed: the seed-data→uploads sync copied dotfiles/secret-named files into the served downloads folder (a real Gmail token file, `uploads/.gmail-direct-token.json`, present since 06-28, was exposed); the sync now excludes dotfiles + secret names, the leaked file was deleted, and a boot-time dotfile-ONLY purge sweeps residue from prior deploy images (scope narrowed per follow-up review — never a name-regex over customer uploads). The 72h retrospective (3 architect passes over 80 files / 223 commits) closed 1 MEDIUM: the IdeaBrowser boot-backfill skip check was a GLOBAL project count that could let one tenant's rows mask another tenant's missing backfill — now strictly per-tenant (skip only when EVERY snapshot tenant is satisfied); plus 3 LOW (stale release badges, dead imports). Prior sweep: R125+137.25-review — a 72h whole-app review (2 architect rounds) closed 2 MEDIUMs: the public Stripe checkout catch was logging raw Stripe error objects (now message + type/status/requestId only), and the AG-UI scope-parity guard test was bypassable (rewritten to a structural comment-stripped SCOPE_RULES parse with first-match-wins semantics mirroring the runtime checker — commented-out rules, stray literals, and shadowing admin rules now all fail the guard). Earlier sweep: R125+137.3 — a full-platform post-edit review (3 architect surface passes + a silent-failure-hunter LLM pass + regex hunter + wiring audit over the prior 72h's 205 commits / 80 files) closed 1 CRITICAL fail-closed: the transactional no-regression snapshot's rollback UPDATE was missing its tenant scope — the safety net that undoes a failed irreversible tool action could have written across tenant boundaries; the rollback is now tenant-scoped like every other write (architect-verified). The same review closed 1 MEDIUM billing-accuracy gap: gpt-5.6-sol, the platform default flagship, was absent from all 3 pricing maps (insights silently $0, ledger billed via an unknown-model fallback) — explicit flagship-class rows + a presence regression test now guarantee a default model can never ship unpriced. Earlier in the window: a pricing drift-guard test + live OpenRouter reconciliation (R125+135/+136, 2 real ledger gaps fixed), PROOF_LOOPS v2 proof-level L1–L5 + Chronicle-precision telemetry (R125+137), a full wiring review that regenerated the tool catalog 396/396 and un-darked 302 post-split tool docs (R125+137.2), and Grok 4.5 wired in additively (R125+134). Prior sweep: R125+133 — a post-edit code-review sweep (whole-app + sensitive areas + 72h) closed 2 HIGH + 3 MEDIUM fail-closed: the trust-reviewer's auto-approve lane now blocks reserved knowledge categories outright (defense-in-depth behind the R125+130 storage chokepoint), and an architect-caught gap where a 'reverted' unvalidated LLM-generated tool stayed active is closed — every revert path now deletes the row and unvalidatable tools fail CLOSED; 6 security tests newly wired into the canonical suite (126/0). R125+132 added a domain-boundary CI gate, coverage reporting, a fail-closed Prometheus /metrics endpoint, a lite deploy profile, and Mermaid architecture diagrams; R125+131 promoted GPT-5.6 Sol to OpenAI flagship with the $0 cost-safety lane intact. Prior sweep: R125+125 — a 72h post-edit review closed 1 HIGH (cross-tenant internal-file-list disclosure in list_uploads: admin-gated + explicit source-tag path mapping) + 4 MEDIUM fail-closed tenant guards across background/treasury handlers, and made the weekly girth-gate fail RED on execution error. Prior: R125+55 → +59 — proactive skill-aware re-decomposition in the task planner (the planner now validates every step's tool against the real registry before execution and re-decomposes once if a step references a blocked or hallucinated tool; SkillWeaver SAD, arXiv:2606.18051) plus a BWB render-reliability + chat-context-hygiene hardening sprint (EIO-resilient reads across the video render path, a bounded auto-retry on transient infra faults, an AST regression guard that locks the hardening in CI, and observation masking that trims stale tool-output bulk from the chat round loop) — every round architect PASS, 0 CRITICAL/HIGH/MEDIUM. Earlier sweep: R125+54 — a whole-app + 72h code review (two parallel architect passes — sensitive core + revenue/agentic/jobs, architect PASS, 0 CRITICAL/HIGH/MEDIUM) shipped alongside the new difficulty-adaptive UP-route (the AUTO path now escalates genuinely-hard requests to the high-end model, the mirror of the existing illusory-productivity down-route guard; ADVISORY + fail-open, regression-locked). Earlier sweep: R125+53 — a new Actor-Critic Reflection step in the supervisor loop (when a loop gets stuck retrying with no success, an independent second LLM diagnoses the failed output and hands back targeted retry guidance instead of blindly halting or upgrading; fails OPEN, single gate, escalation clamped), shipped behind a whole-app + 72h code review (architect PASS, 0 CRITICAL/HIGH) that closed 2 MEDIUM (a session-scoped advisory lock in auto-consolidation now released in a finally so it can't starve future tenant consolidation; a stale '208 tables' → '210' corrected on the pricing + about pages). Earlier sweep: R125+52.48+sec — a whole-app + 72h code review across two parallel architect passes (sensitive core + revenue engines/jobs), architect PASS (0 CRITICAL/HIGH/MEDIUM), that closed 1 LOW client information-leak in the AI Daily Briefing routes (raw `err.message` no longer reaches the browser on 500s — all 9 handlers now log server-side and return a generic 'Internal server error'). Earlier sweep: R125+52.47+sec — a third whole-app + 72h code review (architect PASS, agent-wiring audit CLEAN — 393 tools, 0 dead/drift/leak) that closed 4 findings: a cost-cap backstop adding the two most expensive autonomous tools (`second_opinion`, `venture_discovery`) to the dispatcher's hardcoded expensive-tool set, a tenant-scoped fail-closed projects lookup in the auto-transcript path, a fail-soft import fix so a Token Efficiency probe load error degrades just that one card, and a founder-quote tool-count correction. Earlier sweep: R125+52.44 → +52.46 — a new Token Efficiency telemetry card on `/admin/ecosystem-health` (three read-only per-request overhead metrics: cache-hit starvation, instruction bloat, MCP tool bloat — tenant-scoped, fail-soft) plus two whole-app + 72h security/correctness reviews (architect PASS): 2 HIGH closed in the Venture Discovery loop (a budget reservation that settled on $0 real spend now releases; a non-atomic stage-advance now uses an atomic compare-and-set) and 2 MEDIUM closed (a linked-conversation backfill now joins through `projects` with a tenant guard so a poisoned cross-tenant link can't stamp a foreign project; briefings routes gained Zod validation + a 0-coordinate fix). Earlier sweep: R125+52.41 → +52.42 — a new `second_opinion` agent cross-check tool (all 16 personas) that auto-fires an independent multi-model verdict before escalating to a human, behind a hard $25/day owner-only cost cap that was then hardened against cost-drift overshoot (architect HIGH → accepted LOW) with a deterministic worst-case reservation clamp, a fail-closed cost-drift latch that disables the feature and pages the owner on the first real overshoot, and a dynamic reserve floor that lifts every later reservation to the highest real cost seen that day (+11 guard tests, 20/20; no new counts). Earlier sweep: R125+52.31 → +52.39 — a nine-round security + reliability hardening sprint across the platform's most sensitive internals: three whole-app + 72h post-edit code reviews (architect PASS, agent-wiring audit exit 0), the run-completion judge now runs on a model distinct from the worker set, an SSRF DNS-rebinding TOCTOU was closed by pinning the high-risk public-fetch helper's socket to the already-validated IPs, the multi-model jury's proposer set now fails OPEN to the default pool when caller-supplied ids dedupe to empty (instead of silently running zero proposers), every health probe now carries a degraded marker so a failed probe shows a \"telemetry unavailable\" banner instead of reading as healthy zeros, and a new `ponytail` engineering-discipline skill was added (skills 32 → 33 .agents; no new tools / tables / personas / capabilities). Earlier sweep: R125+52.25 — a whole-app code review closed 2 HIGH + 2 MEDIUM (all cost-governance / isolation correctness): the multi-model jury's premium spend no longer pollutes the daily metered-Anthropic circuit breaker (exempted at the source while still billed at its real cost), the chat engine can never persist a blank reply on a background/scheduled/webhook turn, and two tenant-scope checks were tightened to reject invalid ids. Earlier sweep: R125+52.20 + +52.22 — the new live Instant AI Readiness Audit at /audit was hardened against a DNS-rebinding/SSRF TOCTOU by pinning the validated resolved addresses through an undici connect.lookup override (re-pinned on every redirect hop), and a whole-project code review closed 3 cross-tenant read leaks (chat-engine workspace context + self-improvement experiments now tenant-scoped, fail-closed) plus deleted dead unsafe chat scaffolding. Earlier sweep: R125+52.16+sec upgraded the default reasoning model to Claude Opus 4 and closed 1 HIGH + 2 MEDIUM in a whole-app + 72h review — the owner-only shell tool's catastrophic-command deny floor now defeats quoted/escaped root targets (`rm -rf \"/\"` etc.), workspace containment is boundary-safe (no sibling-prefix escape), and the conversation-delete archive is tenant-scoped (same-tenant-only write). Earlier sweep: R125+52.6 → +52.15 ran a continuous self-hardening sprint on the platform's most sensitive internals — the multi-model jury queue that votes on and auto-applies the platform's own code fixes gained HMAC integrity + an out-of-tree drain ledger (replay-proof), a shared advisory-lock writer (no lost entries), and a claim-first drainer (no double-routing, with a lost-entry-race fix), while the headless-browser tool gained fail-closed post-action URL re-validation (an SSRF gap closed); each fix went through architect FAIL→FIX→PASS with a clean agent-wiring audit (exit 0: 0 dead tools / 0 drift / 0 schema gaps). Earlier sweep: R125+52.5 ran a whole-app + 72h thorough review across three parallel architect passes by surface + an agent-wiring audit over the autonomous cost-governance + flat-rate model-routing + shadow-mode jury-experience work, with 0 new actionable findings. Earlier sweep: R125+38+sec ran two parallel architect passes by surface + an agent-wiring audit (GREEN: 391 tools, 0 dead/drift/leak/orphan/schema-gap) + preflight stale-strings CLEAN, closing 1 HIGH + 2 MEDIUM (self-repair backtest reported a false all-clear on a DB error; ecosystem-health now rejects a non-positive tenant id before any query; public-API live-data fetch replaced with a bounded manual-redirect loop that re-validates host + resolved IP + https on every hop). Earlier sweep: R125+36+sec closed 2 HIGH + 2 MEDIUM (self-repair ESM require break, public tool-count drift resync, public-API DNS-rebinding resolved-IP guard, silent wrong-model routing for OpenRouter-prefixed ids). Clean bills of health across the sweeps: tenant isolation, auth, secrets, SSRF, SQL injection, CSRF, OAuth refresh, schema parity, decline-events telemetry, intent-gate fail-OPEN + tool-policy fail-CLOSED asymmetry.",
    icon: ShieldCheck,
    color: "text-violet-500",
    bg: "bg-violet-500/10",
    features: [
      { icon: ShieldCheck, label: "Tenant-Isolation Audit Burn-Down + 72h Whole-App Review — 17 REAL Fixed / 1 HIGH + 3 MEDIUM Closed (R125+137.73+sec → +137.76+sec)", detail: "**R125+137.73+sec — tenant-isolation audit burn-down:** all 99 kept HIGH/CRITICAL findings triaged across 5 parallel passes → 17 REAL fixes across 15 sites — fail-closed `tenantId` guards added in storage / compaction / data-protection, ownership checks in revenue-missions / business-tools / agent-channels, unscoped SELECTs re-scoped to the caller's tenant, and a `DEFAULT 1` removed from quarterly-intelligence plus a live `ALTER ... DROP DEFAULT`; 82 findings verified FALSE POSITIVE (named-benign) and the nightly Tenant Isolation Audit gained a strict, suppressible system-sweep pattern. **R125+137.76+sec — 72h whole-app review (3 parallel architect passes):** 1 HIGH closed — the archive-rescue paid webhook had a hardcoded `tenant_id=1` now derived from the `ownerTenantId()` single source of truth; plus 3 MEDIUMs — data-protection `softDelete` is now a tenant-scoped atomic `UPDATE ... RETURNING`, compaction memory-extract is routed through `redactPiiForStorage` (closing the last durable-store redaction bypass), and the revenue-missions experiment cap is race-proofed via a per-tenant `pg_advisory_xact_lock`. 2 FALSE POSITIVEs verified (heartbeat_logs/personas global-by-design; auto-memorize watermark). Gates: tsc 0, suite 150/150, seamtests 69/69, guards 81/81." },
      { icon: ShieldCheck, label: "Owner-Gate Single Source of Truth — Mission & Cost-Ledger Owner-Only Tools (R125+137.71 HIGH + .72 follow-up)", detail: "Owner-gate single source of truth (R125+137.71 HIGH + .72 follow-up) — mission & cost-ledger owner-only tools now derive the owner tenant from env-configurable ownerTenantId() instead of a hardcoded tenant id; call-time dynamic import preserves tools-layer acyclicity; env-driven regression tests pin deny/allow behavior. **R125+137.71 — 72h whole-app architect review (2 parallel passes):** ONE HIGH closed — the mission-tool ownerGate had a hardcoded tenant 1 that diverged from the env-configurable ownerTenantId() single source of truth; it now imports the SoT plus 2 env-driven regression tests. All other sensitive surfaces verified clean (HITL boundaries, Stripe webhook signature/livemode/replay guards, dispatcher trust-signal stripping, concurrency cap). **R125+137.72 — follow-up:** the same ownerTenantId() fix applied to the 2 cost-ledger owner-only tools (revenue_vs_cost, agent_cost_summary). Gates: tsc 0, suite 150/150, seamtests 69/69, guards 89." },
      { icon: ShieldCheck, label: "72h Review Rounds 2–4 — Five MEDIUM Tenant-Isolation Findings Closed, Sensitive Core Verified Clean (R125+137.61+sec → +137.65+sec)", detail: "**R125+137.61+sec — 72h review round 2 (3 parallel architect passes, ~100 files):** the heartbeat MAINT_SEED reconciler now hard-requires the admin tenant on its row match — a non-admin row carrying the same key can no longer poison system-task seeding; heartbeat approve/reject endpoints are tenant-scoped (404 on mismatch + tenant-guarded UPDATEs); admin-only scenario polling is gated client-side so non-admin sessions stop generating 401 noise; the route census is pinned at 685 with the two new scenario endpoints verified admin-gated. **R125+137.64+sec — 72h review round 3 (3 parallel architect passes over 122 changed files + the sensitive core):** the safety/tenant/chat-engine core pass came back clean; two MEDIUM tenant-isolation findings were fixed — the inbox-ingest orphan-retry lookup now carries `AND tenant_id` (a same-message row from another tenant can't be claimed), and research session status reads REQUIRE a valid tenant and fail CLOSED (invalid tenant returns null; the unscoped DB fallback is removed). Known by-design false positives were pre-excluded with documented rationale. **R125+137.65+sec — 72h review round 4 (3 parallel architect passes over 110 changed files + the sensitive core):** the intent-gate / tool-policy / dispatcher / chat-engine / auth / storage pass came back clean; 1 MEDIUM fixed — `scheduleWake()` (server/agentic/wake-scheduler.ts) now fails CLOSED on an invalid tenantId with a positive-integer guard before any DB write, pinned by a 7-case regression test (tests/lib/wake-scheduler-tenant.test.ts) added to the suite. A flagged `/api/v1/a2a` scope concern was verified FALSE POSITIVE — scope enforcement is central via authMiddleware → checkApiKeyScopes with the `POST /api/v1/a2a → chat` SCOPE_RULES entry. Gates: tsc 0, seamtests 69/69, suite 149/149, preflight-stale CLEAN, architect PASS." },
      { icon: Lock, label: "CRITICAL Credential-File Leak Closed + Boot-Time Purge + Per-Tenant Backfill Guard (R125+137.46+sec → +137.49-review)", detail: "**R125+137.46+sec — uploads-sync credential exposure (CRITICAL, closed):** the seed-data→uploads file sync copied dotfiles and secret-named files into the publicly served downloads folder — a real Gmail token file (`uploads/.gmail-direct-token.json`) had been exposed since 06-28. Fixed fail-closed: the sync now excludes dotfiles + secret-name patterns, the leaked file was deleted, and a boot-time purge sweeps residue from prior deploy images. The purge is deliberately dotfile-ONLY — a follow-up review narrowed it from a name-regex so it can never delete a customer's legitimately named upload. **R125+137.49-review — 72h retrospective (3 architect passes over 80 touched files / 223 commits):** 1 MEDIUM closed — the IdeaBrowser boot-backfill short-circuit was a GLOBAL idea-project count, so one tenant's completed rows could mask another tenant's missing backfill; the skip check is now strictly per-tenant (snapshot demand grouped by tenant vs GROUP BY tenant_id counts, skip only when EVERY snapshot tenant is satisfied, empty-snapshot edge proceeds to idempotent per-row inserts). 3 LOW closed (stale release badges, dead post-extraction imports). Passes over safety/tools/sandbox/chat-engine/browser and client/tests came back clean; known false positives suppressed with documented rationale. Gates: tsc 0, build OK, suite 147/147, seamtests 69/69, wiring audit CLEAN." },
      { icon: ShieldCheck, label: "Tool Eviction Loop + Tool Forge Phase 2 + Tool-Router Hard Cap + AG-UI Protocol Adapter + 72h Review — 2 MEDIUM Closed (R125+137.23 → +137.25-review)", detail: "The platform learns to retire its own dead tools and forge new ones from unmet demand, the tool-router gains a real hard cap, and the public API speaks a standard agent-UI protocol. **R125+137.23 — Tool Eviction/Retirement loop + Tool Forge Phase 2:** a flag-only eviction classifier with HITL approvals — exemptions fail CLOSED via a strict `parseExemptions`, a registry sanity guard, and a ≤10-candidates/run dedupe (20 candidates queued across the first 2 runs of 30 classified); Tool Forge Phase 2 turns `capability_gaps` demand into budget-claimed LLM module proposals written to `data/tool-forge/proposals/` (≤1/run, nothing ever auto-lands); both wired as weekly heartbeat crons (Tue 11:00/11:30 UTC); an architect finding (exemptions not strict) was closed before ship. **R125+137.23-fable — Claude-Fable external-review follow-ups:** the admin-drive-upload PIN check consolidated onto the exported peppered `verifyAdminPinPlaintext`, and seed.ts's boot re-stamp switched to the canonical peppered `hashPin` — it had been silently re-downgrading the stored hash to the public static salt on every boot; a static guard test now pins the salt literal to auth.ts only. **R125+137.24 — tool-router hard cap (verified external-review finding):** `routeTools()` could add whole categories with no slice-back past `maxTools`; a new pure `enforceToolCap()` trims by priority order at BOTH overshoot sites (persona pre-filter + main routed path), never trims ALWAYS_INCLUDE, leaves escape hatches deliberately uncapped, and logs per-turn `capTrim` + a schema-token estimate; invariant tests in the canonical suite; architect PASS. **R125+137.25 — AG-UI protocol adapter:** `POST /api/v1/agui/run` on the public API v1 surface (vc_* Bearer, chat scope — an architect-caught scope-parity fix plus a static guard test pinning every mounted api-v1 POST to an auth rule) replays a completed chat turn as ordered AG-UI SSE events (RUN_STARTED → TOOL_CALL_* → TEXT_MESSAGE_* → RUN_FINISHED/RUN_ERROR); pure event builders with fail-closed `vc-conv-<id>` thread parsing, tenant-scoped continuation falling through to create-new, a 4000-char tool-result cap, keepalives + timeout race + client-disconnect skip (the turn still persists for the poll endpoint). **R125+137.25-review — 72h whole-app review (2 architect rounds):** closed MEDIUM stripe-checkout catch logging raw Stripe error objects (now message + type/status/requestId only) and MEDIUM agui-scope-parity test bypassability (rewritten to a structural comment-stripped SCOPE_RULES parse with first-match-wins semantics — commented-out rules, stray literals, and shadowing admin rules now all fail the guard). Gates: tsc 0, preflight-stale-strings CLEAN, seamtests 68/68, suite 143/143, wiring audit CLEAN." },
      { icon: ShieldCheck, label: "Self-Improvement Anti-Rut Safeguards + Tool Forge Demand Telemetry + Clean 72h Review — 1 MEDIUM Fail-CLOSED, No CRITICAL/HIGH (R125+137.14 → +137.19)", detail: "The self-improvement loop gains two safeguards and the platform learns to SEE unmet demand. **R125+137.14 — RULER group ranking:** a measure-first, NON-blocking third judge lane in the skill-optimizer's evaluator A/B — one anonymized, seed-shuffled group-ranking LLM call per case; parsing fails CLOSED to null, runtime fails OPEN, and it never touches the apply decision (kill switch `SKILL_OPT_RULER=off`, 16/16 pure tests). **R125+137.15 — prior-collapse detection:** an embedding-space near-dupe tracker over prior failed/rejected proposals — fail-OPEN on every path (even a THROWING injected tracker can't block a loop, pinned by regression tests in both hosts), wired opt-in into the skill-optimizer (a semantic near-dupe of a rejected edit skips the val-scoring spend and a perturbation directive rides the next propose) and the repo-surgeon (a near-identical re-proposal of a FAILED diff skips apply/verify and escalates on the final attempt); kill switch `PRIOR_COLLAPSE=off`. **R125+137.16 / +137.17 — two god-file splits, behavior-preserving:** routes Tier-1 (auth/tenants/admin extracted verbatim, ≈7,794 → 7,329 lines) plus a regression proof that the code-execution sandbox's keyword blocklist is NOT load-bearing (the VM layer is the real control); and tools-layer S34 — `google_workspace` migrated with the fail-closed tenant seam preserved verbatim (295/395 tools migrated). **R125+137.18 — Tool Forge Phase 1 (observability only):** unmet-capability demand folded into the `capability_gaps` table with an atomic miss-count bump, surfaced as a tenant-scoped Unmet Capabilities probe + card on the ecosystem-health dashboard; an architect FAIL was fixed before ship — the probe's terminal-state set now matches the dedup index, so repeat demand can never be absorbed invisibly. **R125+137.19 — 72h post-edit review (3 architect prongs):** 1 MEDIUM closed fail-CLOSED — autonomous capability-gap writes now pass a tenant-validation helper before ANY insert — plus the tenant-isolation audit's unreadable-file accounting wired end-to-end (coverage denominator, degraded banner, exit-cause, double-count fix), prior-collapse degraded-fields surfaced, and email-flush failures logging the full stack. No CRITICAL/HIGH findings. Gates: tsc 0, build 0, seam 68/68, suites green, architect PASS." },
      { icon: ShieldCheck, label: "Action Ledger S1–S5 — Destructive Actions Get a Durable Proof-of-Commit Ledger; Timeout Retry Only on PROVEN Non-Commit (R125+137.4 → +137.13)", detail: "A five-slice hardening campaign closing the oldest scary gap in agentic tool execution: \"the call timed out — did it actually happen?\" **S1 (R125+137.9):** a new tenant-scoped `action_attempts` table (tables 212 → 213) records every ledger-mandatory destructive action with a strict state machine — prepared → executing → committed / failed / unknown → compensated — enforced via a guarded UPDATE (`state = ANY(from)`) so two concurrent settlers can never double-settle; deterministic idempotency keys from deep-sorted argument hashing; every DB helper throws on a non-positive tenant BEFORE any query. **S2 (R125+137.10):** `withActionLedger` middleware at the central dispatch seam — prepare fails CLOSED (no ledger row, no dispatch), classification fails OPEN, settle failures can never break a completed action. **S3 (R125+137.11):** idempotency keys thread through AsyncLocalStorage set ONLY by the middleware after the prepare write (unforgeable — no caller-supplied channel exists) + a 6-hourly reconciler resolving `unknown` attempts via Stripe verify probes (probe errors stay `unknown`, NEVER `failed`; unresolvable → owner digest) + a fail-closed static guard: money-movement Stripe mutations (incl. `checkout.sessions`) can NEVER be grandfathered in without idempotency keying. **S4 (R125+137.12):** advisory AbortSignal threading (unforgeable, timeout-executor-only) + `send_email` opt-in ledgering with a sent-mail verify probe. **S5 (R125+137.13):** timeout retry RE-ENABLED but ONLY for ledgered+probed tools — reconcile FIRST (grace-poll the ledger, then the provider probe), retry ONLY on proven non-commit; a confirmed commit raises a loud \"commit CONFIRMED — Do NOT retry\" error instead of double-charging; `unknown` escalates to the reconciler and NEVER retries; same idempotency key via an unforgeable retry directive; kill switch `AL_TIMEOUT_RETRY=0`. The 72h review closed 1 MEDIUM (a swallowed rollback-claim failure in the transactional snapshot now logs loud) + 2 LOW. Gates: ledger 46/46, retry decision-table 16/16 (incl. commit-during-grace no-double-execution), suite 135/135, seam 68/68, tsc 0, build 0, architect PASS on every slice." },
      { icon: ShieldCheck, label: "Full-Platform Post-Edit Review — Tenant-Scoped Rollback CRITICAL Closed + Flagship Pricing Gap Fixed — 1 CRITICAL + 1 MEDIUM Fail-CLOSED (R125+137.3)", detail: "A full-platform review over the prior 72h's 205 commits / 80 files: 3 architect surface passes + a silent-failure-hunter LLM pass + a regex hunter + a CLEAN wiring audit. **CRITICAL — tenant isolation in the rollback path (architect-verified):** the transactional no-regression snapshot (`server/safety/transactional-snapshot.ts`) — the safety net that captures state before an irreversible tool action and restores it on failure — had a rollback UPDATE missing `AND tenant_id`. The one mechanism designed to undo damage could itself have written across tenant boundaries. Fixed and architect-verified: the rollback is now tenant-scoped like every other write on the platform. **MEDIUM — the default flagship was invisible to the billing meters:** `gpt-5.6-sol` (platform default since the Sol promotion) was absent from ALL 3 pricing maps — insights silently priced it at $0 while the cost ledger billed via the $5/$5 unknown-model fallback. Flagship-class $2.5/$15 rows added to cost-ledger, resource-predictor, and insights-engine + a presence regression test (cost tests 6/6). **FALSE POSITIVE logged:** a \"missing persona-contract text\" flag — the block lives in the imported `PLATFORM_TOOLS_CONTRACT` single source of truth (no drift possible). **Also in the window:** pricing drift-guard test + live OpenRouter reconciliation with a KNOWN_DRIFT heal-ratchet (R125+135/+136 — gpt-5-mini was billed at 20×, glm-5.1 at $0; both fixed with presence-assertion tests, cost tests 31/31); PROOF_LOOPS v2 proof-level knob L1–L5 + Chronicle-precision telemetry (R125+137); a full wiring review that regenerated the smoke catalog 396/396 and taught the static-doc parser the post-split domain-file shape — 302 tools were documentation-dark (R125+137.2); Grok 4.5 wired in additively via OpenRouter, deliberately NOT swapped into router defaults (R125+134). Gates: tsc 0, build 0, suite green, wiring CLEAN, architect PASS after fixes." },
      { icon: ShieldCheck, label: "Post-Edit Code-Review Sweep — Reserved-Category Auto-Approve Blocked + a \"Reverted\" LLM-Generated Tool No Longer Stays Active — 2 HIGH + 3 MEDIUM Closed Fail-CLOSED (R125+133)", detail: "A whole-app + sensitive-areas + 72h post-edit review. **HIGH #1 — trust-reviewer reserved-category auto-approve (defense-in-depth):** the trust-reviewer's `clean_memory_op` auto-approve lane could green-light knowledge writes into reserved categories (e.g. `messaging_pairing` — the category class behind the R125+130 cross-tenant pairing hijack), stacking a second approval path on top of the fail-closed storage chokepoint. Auto-approve now BLOCKS reserved categories outright, so the only remaining path is the storage gate with an explicit `allowReservedCategory`. **HIGH #2 — tool-learning `tryAndRevert` left unvalidated tool code ACTIVE (architect-caught in verification):** two early return branches (test-generation failure, zero test cases) reported status \"reverted\" WITHOUT deleting the just-inserted `custom_tools` row, so unvalidated LLM-generated tool code stayed callable. Every revert path now deletes the row via a shared `revertToolRow` helper and unvalidatable tools fail CLOSED — the confirming architect pass caught the early branches the first fix missed. **MEDIUM ×3:** self-heal drops `allowSystemFallback` and requires a positive-integer tenantId (throws otherwise); `IStorage.createKnowledge`/`updateKnowledge` signatures now carry the `allowReservedCategory` opts so the interface can't drift from the enforcing implementation; 6 security test files on disk but outside the canonical suite are now wired into `tests/run.sh` (guard test 8/8). Deferred + documented: OTP phone-ownership pairing + DB pairing-key uniqueness (known-gaps ledger). Verified: tsc 0, build 0, seam 67/67, wiring CLEAN, suite 126/0, architect FAIL → fixed → PASS." },
      { icon: Activity, label: "Ops/Observability Quintet — Domain-Boundary CI Gate, Coverage, Fail-Closed Prometheus /metrics, Lite Deploy Profile, Architecture Diagrams (R125+132)", detail: "Five hardening items from the public-mirror triage, zero new npm deps. **(1) Domain-boundary CI gate** (`scripts/preflight-domain-boundaries.ts`): a static import scan across `server/tools/domains/**` (219 files / 73 domains — 0 cross-domain imports) that resolves alias-shaped specifiers and fails CLOSED on any non-literal dynamic import/require; wired as a preflight at the top of `tests/run.sh` so the canonical suite fails fast on a boundary violation. **(2) Coverage reporting** (`scripts/run-coverage.sh`): a single-process `--experimental-test-coverage` run over the canonical suite files (extracted from `tests/run.sh` as the source of truth), informational by design. **(3) Prometheus `/metrics`** (`server/routes/metrics.ts`): mounted BEFORE auth/CSRF (scrapers can't CSRF), fails CLOSED to 404 when `METRICS_TOKEN` is unset OR the Bearer mismatches (never 401 — an architect catch), timing-safe compare, per-query try/catch feeding a `visionclaw_scrape_errors` counter so a broken gauge can never 500 the scrape; gauges for 24h cost per tenant, tool calls, tokens, 7d repair incidents, process stats; contract locked by 4/4 tests incl. mount-order-before-CSRF. **(4) Lite deploy profile** (`.env.core.example`): the minimal env set to boot core chat + DB without the full provider fleet. **(5) Mermaid architecture diagrams**: the Memory V2/MNEMA write path and chunk-and-parallel orchestration in `docs/ARCHITECTURE_DIAGRAMS.md`. Gates: tsc 0, build 0, seam 67/67, smoke 20/20, wiring CLEAN, suite 119/0 with the new boundary preflight green in-run, architect FAIL (metrics 401-on-bad-token) → fixed → verified." },
      { icon: Cpu, label: "GPT-5.6 Sol Flagship Promotion — Verified Live, ~28 Files, $0 Cost-Safety Lane Intact (R125+131)", detail: "`gpt-5.6-sol` was verified live against api.openai.com (/v1/models + a real completion) before replacing `gpt-5.5` as the OpenAI flagship across every active default pick (~28 files): MoA FRONTIER_PROPOSERS / aggregator / polarity, auto-router rosters + OAUTH_MODELS + premium-throttle exclude, CEO orchestrator, chat engine, Slack pin, DEFAULT_LOCKED_FRONTIER, and landing Tier-1 copy. Registry entry + alias/output/context-guard (1M) maps added; `gpt-5.5` demoted to fallback and kept in the compat maps. **Cost-safety intact:** the $0 policy still substitutes the free lane outside the cost-exempt `:flagship` lane (resolve smoke confirmed), and the `data/model-tiers.json` $0 frontier pin was deliberately untouched. Gates: tsc 0, build 0, seam 67/67, suite 117/0, wiring CLEAN, smoke 20/20, architect FAIL → fixed (Slack pin + research doc default) → clean." },
      { icon: Activity, label: "72h Post-Edit Review — Cross-Tenant File-List Disclosure Closed, 1 HIGH + 4 MEDIUM (R125+125)", detail: "Three parallel architect passes over the ~230 files touched in the tools-layer-split window (slices S24–S33). **HIGH — `list_uploads` cross-tenant information disclosure:** the file-listing handler in `server/tools/domains/files/handlers.ts` unconditionally enumerated the internal `data/` directory into ANY tenant's listing, and mapped paths by `fs.existsSync` so a name collision between `uploads/` and `data/` could return the wrong path/url. Fixed: `data/` enumeration is now admin-tenant-only, and every entry carries an explicit `source: \"uploads\" | \"data\"` tag that path/url derivation reads instead of re-probing the filesystem — a second confirming architect pass verified the residual collision vector is closed. **MEDIUM ×4:** fail-closed tenant guards (`typeof tenantId !== \"number\" || tenantId <= 0`) added to `run/check/list_background_tasks` and the two treasury handlers (`forecast_ticker`, `analyze_portfolio`); weekly-maintenance Pass 13 now returns RED + a HIGH finding when `preflight-file-girth.ts` itself throws (was silent YELLOW — coverage uncertainty now fails closed). One MEDIUM deferred + logged (browser-replay's direct Browserless fetch bypasses the SSRF-jail routing uniformly used elsewhere — fixed env-configured host, no user-controlled URL, documented in the known-gaps ledger). Verified: tsc 0, esbuild 0, seam tests 67/67, smoke fingerprint unchanged at 395 tools, wiring 0 dead / 0 drift, final architect PASS." },
      { icon: Brain, label: "Actor-Critic Reflection Ships + Whole-App / 72h Review — 2 MEDIUM Closed (R125+53)", detail: "Shipped the new Actor-Critic Reflection step in the supervisor loop — when an agent loops and retries with no success, an independent second LLM (the critic-coach) reads the actual failed output, diagnoses WHY it failed, and hands targeted retry guidance back to the SAME loop for one more INFORMED attempt paired with a model escalation; it fails OPEN through a single `decideStuckRecovery` gate with escalation clamped at 2 (never downgrades), and runs as an isolated completion so the reviewer-independence invariant holds. Shipped behind a whole-app + 72h code review — architect PASS, 0 CRITICAL/HIGH — that closed 2 MEDIUM: (1) a session-scoped `pg_advisory_lock` in auto-consolidation is now released in a `finally` block (guarded by `gotLock`, fail-soft) so it can never outlive the run and starve future tenant consolidation; (2) a stale '208 tables' → '210' corrected on the pricing + about pages. Agent-wiring audit CLEAN (393 tools, 0 dead/drift/leak), tsc + esbuild build green, preflight stale-strings CLEAN. No new tools/tables/personas/capabilities." },
      { icon: Activity, label: "Whole-App + 72h Code Review — Client Error-Leak Closed (R125+52.48+sec)", detail: "Two parallel architect passes — the sensitive core (auth / tenant isolation / safety / payments / secrets) and the revenue engines + background jobs — both returned PASS with 0 CRITICAL/HIGH/MEDIUM. Closed **1 LOW information-leak**: the AI Daily Briefing routes were returning raw server `err.message` text to the browser on 500 errors (9 handlers). All nine now log the real error server-side and return a generic 'Internal server error', so internal database/provider detail can no longer leak to the client. Agent-wiring audit CLEAN (393 tools, 0 dead/drift/leak), tsc + esbuild build green, preflight stale-strings CLEAN. No new tools/tables/personas/capabilities." },
      { icon: Activity, label: "Whole-App + 72h Code Review — 4 Findings Closed (R125+52.47+sec)", detail: "A third whole-app + 72h post-edit review (architect PASS, agent-wiring audit CLEAN — 393 tools, 0 dead/drift/leak) closed four findings: **(1) cost-cap backstop** — the two most expensive autonomous tools (`second_opinion`, `venture_discovery`) were added to the dispatcher's hardcoded expensive-tool set so the per-call spend throttle still fires even if the rate-limiter config fails to load; **(2) tenant isolation** — a projects lookup in the auto-transcript path now scopes its SELECT to the caller's tenant and fails closed, so a poisoned conversation project id can't redirect downstream file writes onto a foreign project; **(3) fail-soft telemetry** — the Token Efficiency probe import on `/admin/ecosystem-health` moved inside its per-probe try with a full default shape so a probe-module load error degrades just that one card instead of throwing the whole dashboard; **(4) stat fix** — a founder-quote tool count corrected 392 → 393. tsc + esbuild build green, preflight stale-strings CLEAN. No new tools/tables/personas/capabilities." },
      { icon: Activity, label: "Token Efficiency Telemetry + Two Whole-App Security/Correctness Reviews (R125+52.44 → +52.46)", detail: "**R125+52.46 (observability):** a new Token Efficiency card on `/admin/ecosystem-health` makes per-request overhead measurable instead of a vibe — three READ-ONLY metrics: (1) **cache-hit starvation** (cache-hit % on large ≥5000-token prompts over 30 days), (2) **instruction bloat** (the fixed system-prompt token tax, measured live on a synthetic persona), and (3) **MCP tool bloat** (the serialized tool-catalog token tax). Tenant-scoped end to end, fail-soft (shows an amber 'telemetry unavailable' marker rather than faking healthy zeros), purely additive — no writes, no schema change. **R125+52.45+sec (whole-app + 72h review, architect PASS, 0 CRIT/HIGH):** closed 2 MEDIUM — a linked-conversation backfill was selecting an always-NULL project id and writing it back over itself; it now joins through `projects` with a tenant guard so a poisoned cross-tenant link row can't stamp a foreign project onto a conversation. The briefings widget/generate routes gained Zod validation, which then surfaced and fixed a 0-coordinate truthiness bug that skipped valid equator/prime-meridian locations. **R125+52.44+sec (whole-app + 72h review, architect PASS):** closed 2 HIGH in the Venture Discovery loop — a budget reservation that settled even when the paid call never happened (so $0 real spend still burned a full stage's daily cap) now releases instead of settling, and a non-atomic stage-advance that two concurrent approvals could double-execute now uses an atomic compare-and-set (loser returns a conflict). `tsc` + esbuild build green, architect PASS. No new tools/tables/personas/capabilities." },
      { icon: DollarSign, label: "Agent Second-Opinion / Cross-Check + Overshoot-Proof $25/day Fusion Cap (R125+52.41 → +52.42)", detail: "A new `second_opinion` tool (wired to all 16 personas) fetches an independent multi-model verdict and AUTO-fires from the native ensemble on a low-confidence answer (concordance κ < 0.5 or single-proposer) BEFORE escalating to a human. Spend routes through OpenRouter Fusion (a managed panel → judge → synthesize backend) behind a dedicated $25/day owner-only cap enforced by atomic reserve-then-settle. **R125+52.42 hardened that cap against cost-drift overshoot (architect HIGH → accepted LOW):** (1) a deterministic worst-case clamp floors every reservation at `max(configured, FUSION_WORST_CASE_USD ≈ $1.15)` (capped in/out tokens × premium rates × a 10× panel→judge→synth multiplier) plus hard output-token / question-length caps; (2) a fail-closed cost-drift latch compares the REAL OpenRouter `usage.cost` against what was reserved on every call and, on the first overshoot, trips an idempotent never-throws latch that disables BOTH the AUTO low-κ hook AND the on-demand path (unless the caller passes an explicit `ownerOverride`) and pages the owner; (3) a dynamic reserve floor lifts each reservation to `max(staticEstimate, MAX(real settled cost today))` so a drifted price can't be repeatedly under-reserved. The cap math uses OpenRouter's returned `usage.cost`, not the model-registry price (a known cosmetic doc-only MEDIUM: `openrouter/fusion` is unpriced so its ledger row reads $0 until a price is set — the cap is unaffected). +11 query-free guard tests (20/20), tsc clean, architect PASS. No new tools/tables/personas/capabilities." },
      { icon: DollarSign, label: "Whole-App Review — Jury Spend No Longer Pollutes the Metered-Anthropic Breaker + Cold-Empty Completion Guard (R125+52.25)", detail: "A whole-app code review closed 2 HIGH + 2 MEDIUM (all cost-governance / isolation correctness; no new counts). **HIGH #1 (cost governance):** the multi-model jury's Claude spend was logged under a bare `toolName:\"ensemble_query\"` the breaker's exempt-lane check (`:jury`/`:flagship`) didn't recognize, so jury spend counted toward the daily metered-Anthropic ceiling and could trip the breaker early for genuinely-metered lanes; a new `costExempt` flag now threads `recordCost → noteModelSpend` and both `moa.ts` calls pass it, while the DB ledger `toolName` stays `ensemble_query` so the 5× cost is still billed truthfully — only the in-memory breaker tally is corrected. **HIGH #2 (correctness):** the chat-engine final-guarantee guard only fired when tools had executed, so a model returning 0 chars + 0 tool calls on a cron/subagent-parent/webhook turn could persist a blank assistant reply; the guard now emits a deterministic non-empty fallback for the cold-empty case too. **MEDIUM ×2:** `/api/experiments/run` now passes its admin tenant id (was a 500), and two `self-improvement` reads tightened their tenant guards to reject 0/negative ids. Verified: `tsc` clean, 26/26 cost-ledger tests, agent-wiring audit exit 0, second architect pass PASS. No new tools/tables/personas." },
      { icon: Lock, label: "Live AI Readiness Audit SSRF Jail — DNS-Rebinding TOCTOU Pin (R125+52.20)", detail: "The new public `POST /api/public/audit/run` fetches a visitor-supplied URL, so its SSRF jail had to be airtight against a DNS-rebinding TOCTOU (the hostname resolves to a safe IP at validation time, then re-resolves to 169.254.169.254 / RFC1918 at fetch time). Fixed by pinning the validated resolved addresses through an undici `Agent` `connect.lookup` override so the socket can only connect to the exact IPs that passed validation — and EVERY redirect hop is re-pinned, with TLS SNI/Host kept bound to the real hostname (no certificate confusion). The per-caller rate-limit key was also moved off `req.ip` (proxy-spoofable) onto the raw TCP socket `remoteAddress`. +1 security regression suite; `tsc` clean." },
      { icon: Users, label: "Whole-Project Review — 3 Cross-Tenant Read Leaks Closed + Dead Chat Scaffolding Removed (R125+52.22)", detail: "A whole-project code-review pass closed 3 live cross-tenant read leaks: chat-engine workspace-context was injecting ALL tenants' uploaded filenames and active-project names/customer/description into the prompt context (now tenant-scoped, fail-closed); self-improvement experiments were `SELECT`ed by `category` only (now also filtered by `tenant_id`); and never-mounted chat scaffolding that hardcoded tenant 1 with zero isolation was deleted outright. Verified: `tsc` clean, architect PASS. No new tools/personas." },
      { icon: Lock, label: "Default Model → Claude Opus 4 + Whole-App / 72h Review — 1 HIGH + 2 MEDIUM Closed (R125+52.16+sec)", detail: "`claude-fable-5` demoted to last-resort only; `claude-opus-4-8` is now the platform default proposer/solver everywhere. 5 parallel architect passes over the ~85-file 72h window + agent-wiring audit exit 0. **HIGH (exec deny-floor bypass):** the owner-only shell tool's catastrophic-command floor anchored on a literal `/`, so `rm -rf \"/\"` / `'/'` / `\\/` slipped the regex; `normalizeCommand()` now unescapes backslashes + strips quotes BEFORE the match so every quoted/escaped root form hits the deny floor (regression cases added; exec suites 4/4 + 12/12 green). **MEDIUM #1 (workspace containment):** 3 naive `startsWith(WORKSPACE_ROOT)` checks replaced with boundary-safe `isWithinWorkspace()` (exact-root or `root+path.sep`), closing the `/home/runner/workspace-evil` sibling-prefix escape. **MEDIUM #2 (cross-tenant archive write):** conversation-delete `project_notes` archive now JOINs `projects` + filters `tenant_id` (same-tenant-only write). Plus a loud `console.warn` on unknown-model fallthrough in `getClientForModel`. Verified: `tsc` clean, build green, exec security suites 12/12 + 4/4, wiring audit exit 0, confirming architect PASS (0 CRITICAL/HIGH). No new tools/tables/personas." },
      { icon: ShieldCheck, label: "Self-Hardening Sprint — Jury-Queue Replay/Race Proofing + Browser SSRF Revalidation (R125+52.6 → +52.15)", detail: "A continuous self-hardening sprint on the platform's most sensitive internals — the multi-model jury queue that votes on and auto-applies the platform's OWN code fixes. It gained HMAC integrity + an out-of-tree `jury_drain_ledger` (replay-proof), a shared advisory-lock queue writer (no lost entries), and a claim-first drainer (no double-routing, including a lost-entry-race fix); the headless-browser tool gained fail-closed post-action URL re-validation, closing an SSRF gap where a page mutation could navigate off the host allowlist. Every fix went architect FAIL→FIX→PASS with a clean agent-wiring audit (exit 0). +1 table (`jury_drain_ledger`); no new tools/personas." },
      { icon: DollarSign, label: "Autonomous Cost Governance + Flat-Rate Model Routing + Shadow-Mode Jury Experience Library (R125+48 → +52.5)", detail: "The platform can now drive its own backlog to done without a surprise bill. An Escalation Resolver pushes the stuck `repair_incidents` backlog to terminal states via the jury (R125+49); a jury→implement loop + Climb Tracker telemetry auto-applies approved fixes (R125+48); and a NEW autonomous-spend governor puts a HARD daily cost ceiling on every background loop — owner-only, fail-CLOSED, $25/day default (R125+50). High-end models now bill flat-rate OAuth subscriptions instead of metered per-token keys wherever possible, including a Claude Runner CLI bridge onto the Max plan (R125+51 / +52); the canonical frontier jury is a declared four-model top-tier set (R125+52.1 / .2). A Training-Free GRPO jury experience library (arXiv:2510.08191, Tencent/Youtu-Agent) distills a comparative lesson from every divergent jury vote into a NEW `jury_experiences` table in SHADOW MODE — collecting now, not yet injected (R125+52.4). R125+52.5: full whole-app + 72h review across three parallel architect passes + wiring audit, 0 new actionable findings." },
      { icon: BarChart3, label: "Delivery Funnel Telemetry — Produce → Ship → Adopt (R125+47)", detail: "The platform now measures its own produce → ship → adopt funnel, inspired by 2026 research (SSRN 6859839, MIT) showing AI lifts code production far more than it lifts shipping or adoption. A `delivery_engagement` table + a fire-and-forget recorder logs each produced deliverable and the first confirmed fetch of a delivered file, surfaced as a Delivery Funnel card on `/admin/ecosystem-health`. Honesty-first: `adopted` counts ONLY confirmed initial 200/206 fetches of delivered files (a documented FLOOR, never a fabricated signal), and a `degraded` flag shows an amber 'telemetry unavailable' banner instead of faking healthy zeros. Whole-app + 72h review closed 2 MEDIUM (deterministic `/uploads` ownership check; signed-URL requirement for ownerless delivery assets)." },
      { icon: Users, label: "Multi-Tenant Config-Forking (R125+46 / +46+sec)", detail: "Spin up a fresh tenant pre-loaded with an existing tenant's curated configuration — personas config, trust-tier tool policies, per-persona autonomy rules, voice/skill preferences (an explicit 11-table allowlist) — in one atomic, fail-closed transaction, via an admin route + an operator CLI. `custom_tools` is deliberately EXCLUDED (its name carries a GLOBAL unique constraint a blind copy would violate); every INSERT passes the destination tenant explicitly and the source tenant is read-only throughout. The +46+sec review closed 3 MEDIUM (a `forked_from` provenance index, BWB-preflight spawn-env scrub, and a stale current-state stat resync on landing/pricing/SEO)." },
      { icon: ShieldCheck, label: "Self-Repair Backtest False-Green + Public-API SSRF Closed (R125+38+sec)", detail: "Full-app + 72h post-edit review across 2 parallel architect passes by surface + an agent-wiring audit (GREEN: 391 tools, 0 dead/drift/leak/orphan/schema-gap) + preflight stale-strings CLEAN — 1 HIGH + 2 MEDIUM closed, 1 FALSE POSITIVE. **HIGH fixed:** the architect-incident-backtest CLI relied on a never-throwing aggregator, so a DB error returned an empty result and the CLI reported the all-clear 'no incidents' exit instead of failing; an opt-in throwOnError channel now surfaces DB errors to the CLI (exit 1) while preserving never-throw for the dashboard card. **MEDIUM ×2:** the self-improvement metrics entry now rejects a non-positive tenant id before any query; the public-API live-data pack's fetch helper replaced redirect-follow + post-hoc host check with a bounded manual-redirect loop that re-validates host + resolved IP + https before every hop (max 4). **FALSE POSITIVE:** the CI self-healer's `execSync` env inheritance is trusted internal tooling that needs its secrets; the untrusted sandbox path spawns no child processes. Verified: `tsc` clean, public-api + self-improvement tests pass. All platform stats UNCHANGED at 391 tools." },
      { icon: ShieldCheck, label: "Self-Repair ESM Break + Public-API DNS-Rebinding + Wrong-Model Routing Closed (R125+36+sec)", detail: "Full-app + 72h post-edit review (architect pass + confirming re-pass + agent-wiring audit GREEN at 390 tools, 0 dead/drift/leak/orphan/schema-gap) — 2 HIGH + 2 MEDIUM closed. **HIGH ×2:** the Guarded Repo Surgeon's source-reader used an inline `require('node:fs')` that throws in the ESM build, silently disabling its source-reading path (replaced with a top-level import); and a public-facing tool-count drift (R125+35 bumped 384 → 390 but left current-state counts at 384 across index.html / seo-head / landing / about / pricing / audit) was resynced to 390 with the historical per-round snapshots preserved. **MEDIUM ×2:** the public-API live-data pack host-locked the request but never validated the RESOLVED IP — added a fail-closed resolve-and-check guard pre-fetch and post-redirect; and the model-client resolver missed OpenRouter-style prefixed ids (e.g. `openai/gpt-4.1-mini`) so ~7 callers silently fell through to the Anthropic default — added a guarded prefix-strip re-lookup that only fires when the stripped id exists in the registry. Verified: `tsc` clean, preflight stale-strings CLEAN, public-api 7/7." },
      { icon: Globe, label: "Public-API Live-Data Pack — 6 Free Read-Only Tools, SSRF-Jailed (R125+35)", detail: "Agenvoy-inspired: 6 free, no-auth, read-only public-data tools wired to all 16 personas (tools 384 → 390), each behind the platform's SSRF guard, per-tool rate ceilings, and a host allowlist — live reference data inline for every persona with no third-party billing dependency. The thesis: own the workflow, not just the model. `tsc` clean; build clean." },
      { icon: ShieldCheck, label: "Heartbeat Maintenance-Cron Spawn Hardened (R125+34+sec)", detail: "Full-app + 72h post-edit review across 4 parallel architect passes by surface + a confirming re-pass + an agent-wiring audit (GREEN: 384 tools, 0 dead/drift/leak/orphan/schema-gap) + preflight stale-strings CLEAN. **HIGH fixed:** the heartbeat maintenance-cron runner spawned its `npx` child with the raw process environment, leaking loader-hijack vars (`LD_*`/`DYLD_*`/`NODE_OPTIONS`/`NODE_PATH`) and every secret into a privileged scheduled child whose output is tailed into incident logs — a functional RCE + secret-leak surface. The spawn now strips that env via `sanitizeSpawnEnv`, at parity with the backup-push spawn already hardened in the same file (`PATH` is retained so `npx` resolution is unaffected). **LOW fixed:** stale 'latest sweep' security copy on this page resynced. Deferred-by-design (logged): owner-notify existence-probe + owner-digest-flush are owner-only cron paths (tenant 1 = owner). Verified: `tsc` clean, preflight stale-strings CLEAN, agent-wiring audit exit 0. All platform stats UNCHANGED." },
      { icon: ShieldCheck, label: "Self-Repair Autofix HITL Gate Widened to Aggregator Modules (R125+31+sec2)", detail: "Follow-up full-app + 72h post-edit review across 4 parallel architect passes + an agent-wiring audit (GREEN: 384 tools, 0 dead/drift/leak/orphan/schema-gap). **MEDIUM fixed:** the Guarded Repo Surgeon's `SENSITIVE_SURFACE_RE` matched payment/auth/schema/safety files by path-token but MISSED the broad aggregator modules that carry auth + payment + session + tool-routing in a single file (`server/routes.ts`, `server/routes/`, `server/tools.ts`, `server/chat-engine.ts`, `server/replitAuth.ts`, `server/guarded-tool-executor.ts`); a `REPAIR_AUTOFIX_ENABLED` autofix touching them now PAUSES for owner HITL. The gate is monotonic — it only ever ADDS a pause, so the change is fail-safe (repo-surgeon suite 22/22 green). Verified: `tsc` clean, preflight stale-strings CLEAN, agent-wiring audit exit 0. All platform stats UNCHANGED." },
      { icon: ShieldCheck, label: "Tool-Block Telemetry Secret-Leak Closed Fail-Closed (R125+25)", detail: "Full-app + 72h post-edit review across 4 parallel architect passes by surface + a confirming pass — 0 CRITICAL / 3 HIGH / 2 MEDIUM; agent-wiring audit GREEN (384 tools, 0 dead/drift/trusted-leak/orphan/schema-gap). **HIGH fixed fail-closed (credential exposure):** the destructive-tool-policy telemetry redactor `redactArgs()` masked secret-like keys AFTER a >80-char length-truncation branch, so a long `token`/`apiKey` value could leak its first 60 characters into the `security_tool_blocks` audit row; reordered so secret keys redact FIRST — no secret value can ever reach the truncation path — then exported the helper and added a 5-case regression test. **2 HIGH + 2 MEDIUM deferred as already-tracked, dormant known gaps (NOT new regressions):** the self-repair diff-guard lexical bypass and the render-farm full-buffer OOM both sit in code whose auto-apply is gated OFF by default with zero production callers (hard gate — close before that flag is ever enabled); plus a missing chat-engine integration test pinning that the efficiency guard can't suppress an explicit jury/ensemble call, and a Drive-discovery body-read that can stall after headers resolve. Verified: `tsc` clean, AHB 52/52, redact-args 5/5, confirming architect pass PASS. All platform stats UNCHANGED." },
      { icon: Activity, label: "Agentic Efficiency Awareness (R125+24)", detail: "The platform now measures whether reaching for a heavy AI loop was actually worth it — inspired by recent research on the 'AI dependence loop' (arXiv:2605.22687, MIT/Stanford/NYU/Princeton), which found people predict large time savings from reaching for AI and then keep reaching for it even when doing the work directly would be faster. Three parts: (1) a new `orchestration_efficiency` table records the predicted-vs-actual time and cost of every orchestration so the felt 'this saved me time' becomes a measured number — all writes are fire-and-forget + try/catch and never block the hot path; (2) `assessHeavyLoopWorth()` is a cheap no-LLM advisory + fail-open guard wired into the AUTO-ensemble path that can down-route a trivially-doable request off the 4-model loop onto the direct path — it NEVER touches an explicit `ensemble_query` / `jury_triage` tool call the user asked for; (3) a new Orchestration Efficiency card on `/admin/ecosystem-health` shows the median predicted-vs-actual gap, heavy loops run, and how often the guard advised the direct path (breaches when the median gap exceeds 50% on ≥10 samples). Adds 1 table (188 → 189) + 2 indexes (now 554). Verified: `tsc` clean, 9 pure-function unit tests, architect PASS." },
      { icon: Wrench, label: "Autonomous Self-Repair Stack (R125+22)", detail: "The platform now repairs itself, with the owner in control. **Incident capture + classifier (capability #51):** on any tool/CI/deliverable failure the system classifies it (code_defect vs guard/safety vs transient) via a heuristic-then-jury pass, persists it to the `repair_incidents` ledger, and routes it. **Guarded Repo Surgeon code-fix executor (#52):** diagnoses root cause, writes a MINIMAL diff, and verifies for real — typecheck → targeted tests → optional golden-path replay → re-run the failed tool — landing on green or rolling back on red. Three fail-closed invariants: it NEVER weakens a guard/test/safety surface; auth/payments/schema/safety changes PAUSE for owner HITL; a durable 2-failed-attempts stop then escalates. Auto-apply is OPT-IN via `REPAIR_AUTOFIX_ENABLED` (default OFF — defects escalate to the owner, not silently rewritten). **Pipeline-checkpoint resume (#53):** long jobs persist each unit's artifact, so a retry REUSES finished units and repairs only the first failed one (no duplicate INSERT/email/upload on resume); wired into the BWB weekly render as the proof case. **Owner incident ledger (#54):** `GET /api/admin/repair-incidents` is an owner-visible decision ledger (status/source/action filters) — there is NO agent tool to trigger a repair, surfacing a clean failure IS the interface." },
      { icon: ShieldCheck, label: "Silent-Failure Regressions Closed Fail-Closed (R125+19/+22)", detail: "Security review rounds R125+19 and R125+22 closed 10 MEDIUM findings with 0 HIGH/CRITICAL — all silent-failure regressions fixed fail-closed: ffprobe sentinels now resolve to NaN/fail-closed instead of a deceptive 0; attempt-ledger reads return the cap on a DB error so the durable 2-attempts stop can't silently reset and loop forever; and the render-orchestrator's HTTP calls got AbortController timeouts so a hung upstream can't wedge a render." },
      { icon: ShieldCheck, label: "Chief-of-Staff Jury Access + Trusted-Tool Wiring Leak Closed (R125+16)", detail: "A new per-tool `extraAllowedPersonas` allowlist lets a specific persona be granted a trusted tool without widening the global trust tier. First use: the Chief of Staff persona is now wired to `jury_triage` (the 3-frontier-model 2-of-3 vote), closing the last trusted-tool wiring leak the agent-wiring audit had been flagging (leaks 1 → 0) — so escalations the Chief of Staff raises can be put to the jury directly. Verified: AHB regression 50/50, `tsc` clean, preflight stale-strings CLEAN, agent-wiring audit exit 0, architect PASS. All platform stats UNCHANGED." },
      { icon: Activity, label: "Blackboard Multi-Agent Coordination (R125+15)", detail: "TigrimOSR-inspired shared-blackboard coordination, built by EXTENDING the existing parallel findings bus — 0 new tools, 0 new tables. Two primitives land on `parallel_job_findings`: **keyed shared-state slots** (latest-wins via `DISTINCT ON`) so parallel agents can read each other's most-recent state, and **atomic work-claims** (exactly one winner per tenant + job + slot, enforced by a partial unique index `idx_pjf_claim`) so two agents never grab the same chunk of work. `findings_publish` / `findings_read` gained `slot_key` / `claim` / `mode:\"board\"`; claim rows are excluded from discovery reads so the coordination channel stays clean. Verified: 12/12 blackboard tests (incl. 5 tool-surface), AHB 47/47, `tsc` clean, preflight CLEAN, architect PASS (the one blocking finding fixed). Adds +1 index (541 → 542); all other stats UNCHANGED." },
      { icon: Mic, label: "Built With Bob Brand-Voice Lock (R125+14+sec3)", detail: "When a render is flagged as a 'Built With Bob' video, the narrator voice is now HARD-LOCKED to Bob's own voice clone — any voice/provider override passed in is ignored — and `strictVoice` is forced ON so a voice-provider failure FAILS the render instead of silently cascading to a generic non-brand voice (an OpenAI/Edge fallback can't reproduce a cloned voice, so the old behavior would have shipped the wrong voice). Resolved at a single chokepoint (`resolveBriefVoiceLock`) and threaded through the job runner + the tool-dispatch + JSON schemas; escape hatch `BWB_VOICE_OVERRIDE_OK=1` only for a deliberate guest segment. Brand weight-stats resynced to the confirmed 504 lb start / 236 lb lost / 268 lb current. Regression-tested (6/6). Verified: `tsc` clean, preflight stale-strings CLEAN, architect PASS." },
      { icon: ShieldCheck, label: "Atomic Money Fail-Close + GitHub-Push Spawn Hardening + Test-Coverage Closure (R125+14+sec4)", detail: "Full-app + 72h + GitHub-system post-edit code review (4 parallel architect passes split by surface + a focused 2nd pass on the fix delta, PASS). **HIGH → fail-closed (money)** — `charge_task_force` is now a single atomic conditional UPDATE: a charge commits ONLY within budget (budget 0 = unlimited); a would-be breach no longer mutates spend, emits an over-budget event, and returns failure — closing the debit-then-check overspend window and the read-then-write race. **MEDIUM (GitHub backup path)** — the heartbeat backup git-push moved from a shell string to a no-shell argv spawn, added owner/repo regex validation, and now throws on commit/push failure instead of swallowing it. **MEDIUM (test integrity)** — the held-out-eval-gate env enforcement moved to proper before/after hooks (was running ambient at module load). **LOW** — stale model-version strings corrected. **Quality** — closed three deferred test-coverage gaps (render-farm dispatch SSRF + bound guards, Drive clip-date parsing, task-force budget-cap — 31 new unit tests) and cleared two live CI issues (a stale sql-raw baseline entry left after a net hardening; rate-limiter coverage added for `jury_triage` + `bwb_weekly_build`). Verified: `tsc` clean, AHB 47/47, held-out-eval-gate 14/14, preflight stale-strings CLEAN, 31 new unit tests green, architect PASS. All stats UNCHANGED." },
      { icon: ShieldCheck, label: "Security/Correctness Hardening — Spawn-Env Scrub, Money-Tool Guards, Parameterized Interval, 500-Leak Removal (R125+14+sec2)", detail: "Full-app + 72h pre-publish post-edit code review (3 parallel architect passes + a focused 2nd pass on the fix delta, PASS). **HIGH (regression)** — the yt-dlp video-transcript ingestion path (`scripts/lib/youtube-transcript.ts`) was spawning with the raw inherited process environment on a NETWORK-FACING ingestion path; it now spawns with `env: sanitizeSpawnEnv(process.env)`, closing a loader-hijack (`LD_*`/`DYLD_*`/`NODE_OPTIONS`/`NODE_PATH`) code-execution pivot. **MEDIUM** — the money-moving governance tools `set_department_budget` (`limitUsd`) and `charge_task_force` (`amountUsd`) now reject negative / non-finite amounts at BOTH the tool-dispatch layer and the module level, killing budget/accounting corruption via malformed args. **MEDIUM** — the `plan-executor` stuck-plan sweep stale-interval `sql.raw` was replaced with a parameterized interval, eliminating a raw-interpolation path. **MEDIUM** — removed client-facing HTTP 500 internal-error-detail leaks across archive-rescue (×2), the graph route, store-checkout, and the leads routes (server-side logging retained). **LOW** — corrected a stale public tool count in the public README. **New tool** — `bwb_weekly_build`, an approval-first autonomous weekly 'Built With Bob' YouTube recap pipeline (383 → 384 tools; all other stats unchanged). Verified: `tsc` clean, AHB regression 47/47, held-out-eval-gate 14/14, agent-wiring audit exit 0, app boots clean at 384 tools." },
      { icon: Lock, label: "Self-Improvement Auto-Apply Fails Closed on Tenant Erosion (R125+13.25+sec)", detail: "Full-app + 72h post-edit review across 3 parallel architect passes split by surface. **HIGH** — the platform's self-improvement auto-apply gate now fails CLOSED on tenant-isolation erosion: any auto-generated diff that nets-out tenant references is blocked from auto-applying and routed to human review (the `tenant-filter-erosion` held-out invariant was promoted warn → block). **LOW** — video clip duration clamp aligned to the documented 1–10s provider limit (was 15s). **1 HIGH triaged ACCEPTED DESIGN** — the Gmail-direct admin OAuth routes are PIN-only by design (mandatory, timing-safe, throttled, header-only credential; the OAuth callback is public by necessity with a server-minted state-nonce CSRF check), supporting the documented headless operator-script access pattern. Builds on R125+13.24 (SIA held-out eval gate) + R125+13.23 (jury fix-direction concordance guard). Verified: typecheck clean, gate tests 14/14, wiring audit exit 0, focused second architect pass on the fixes CLEAN." },
      { icon: Lock, label: "Backup-Push Credential + Spawn-Env Hardening (R125+13.22+sec)", detail: "Whole-app + 72h post-edit review across 4 parallel architect passes split by surface. **HIGH** — the heartbeat backup git-push embedded `GITHUB_TOKEN` inline in the push URL (process-list + error-text exposure); replaced with git `credential.helper` reading the token from env so it never appears in argv/URL/error output (`GIT_TERMINAL_PROMPT=0`). **MEDIUM ×2** — both `/tmp/push-gh.sh` `execSync` spawns (heartbeat path + backup API route) now run with `env: sanitizeSpawnEnv(process.env)`, closing the loader-hijack (`LD_*`/`DYLD_*`/`NODE_OPTIONS`/`NODE_PATH`) inheritance gap the R125+13.19 sweep had left on the script-push branch. **LOW** — MoA jury telemetry now filters the reported `steelmen` set to the post-`MAX_PROPOSERS`-trim proposer list so observability matches execution. Verified: `tsc` clean, no token-in-URL pattern remains in `server/`, wiring audit exit 0, second focused architect pass on the 3 fixed files CLEAN, app boots with no runtime errors." },
      { icon: ShieldCheck, label: "Post-Edit Code-Review Hardening (R125+13.21+sec)", detail: "Loader-hijack guard now prefix-strips the whole `LD_`/`DYLD_` namespace (not an enumerated list); skill-extraction excerpt wrapped in `sanitizeUntrusted`; failure-lesson dedup made namespace-aware; early-commit tool-narrowing preserves deliverable executors. Closed via a 3-prong 72h post-edit architect review; typecheck + wiring audit + second architect pass all clean. (4 MEDIUM + 1 LOW closed; 1 HIGH triaged FALSE POSITIVE — provider-prefixed model id is the established convention.)" },
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
      { icon: Palette, label: "41 Curated AI Models + 1000+ Daily Discovery", detail: "41-model curated registry across OpenAI, Anthropic, Google, xAI, DeepSeek and more, plus a daily OpenRouter probe that auto-discovers 1000+ additional models the day they ship. Subscription-First Routing (BYOS) prefers your ChatGPT Plus / Gemini OAuth tokens for $0/token primary inference. Claude Runner bridge active for $0/token Anthropic when Max plan authenticated. Cost-aware routing always tries free → cheap → paid in that order." },
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
      { icon: ShieldCheck, label: "41 Governance Rules", detail: "Based on NIST, OWASP, and Singapore IMDA standards. 7 categories covering data, comms, finance, code, and behavior." },
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
      { icon: ShieldCheck, label: "Governance Rule Audit", detail: "Validates all 41 governance rules are active and correctly configured. Flags disabled rules, missing categories, and coverage gaps." },
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
      { icon: Database, label: "Centralized Tool Registry", detail: "Single source of truth for all 407 tools — categories, speed class, product output, network tracking. Bidirectional startup audit ensures no tool is invisible. 407 tools across 23 categories (NEW R125+4: `research` category for legitimate academic search — arXiv, PubMed, OpenAlex, Crossref)." },
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
                  {[{ l: "Specialist agents", v: "16" }, { l: "Connected tools", v: "407" }, { l: "Active capabilities", v: "129" }, { l: "Database tables", v: "222" }, { l: "Governance rules", v: "41" }, { l: "Model routes", v: "41+1000" }].map(s => (
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
      solution: "16 specialist agents and 407 tools sit in one workspace — research, write, design, ship, follow up. One inbox, one bill.",
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

function BusinessTransformationSection() {
  const { config } = useSiteConfig();
  const pn = config.platformName;
  const pillars = [
    {
      icon: Users,
      label: "People",
      title: "Every person does specialist-grade work",
      desc: `Generic AI makes everyone a little faster. ${pn} makes everyone able to do work that used to need a specialist — because it already knows your context, terminology, and standards, output ships instead of needing a rewrite.`,
      native: "16 specialist agents · per-tenant profile injected into every conversation · brand-voice tools that learn how you write",
    },
    {
      icon: Workflow,
      label: "Processes",
      title: "Information-dense workflows collapse to minutes",
      desc: "Research-to-memo, contract review, reporting, follow-up — the multi-step, high-volume work that used to take days runs end-to-end in minutes, and accuracy compounds as the system absorbs your standards.",
      native: "End-to-end workflows · universal quality gate · memory that gets smarter every run",
    },
    {
      icon: Rocket,
      label: "Products",
      title: "Capabilities your customers couldn't get before",
      desc: "Combine a frontier model with your proprietary data and your trust boundary, and you can ship things competitors can't easily copy — all inside strict per-tenant isolation.",
      native: "407 tools · multi-tenant isolation · governed autonomy with human-in-the-loop",
    },
  ];
  const proof = [
    { name: "L'Oréal", stat: "99.9%", detail: "analytics accuracy across 44,000 monthly users" },
    { name: "Lyft", stat: "−87%", detail: "customer-support resolution time" },
    { name: "Rakuten", stat: "Quarterly → 2 weeks", detail: "product release cadence" },
  ];
  return (
    <section id="section-biz-transformation" className="py-20 px-6 border-t border-border" data-testid="section-biz-transformation">
      <div className="max-w-6xl mx-auto">
        <RevealOnScroll>
          <div className="mb-12 max-w-3xl">
            <Badge variant="secondary" className="mb-4">The Agentic Shift</Badge>
            <h2 className="text-3xl font-bold mb-3">Point solutions get point-solution results. {pn} runs the whole operation.</h2>
            <p className="text-muted-foreground leading-relaxed">
              A generic model gives generic output your team has to fix before it's usable. The real gains come when the AI
              reflects how your business actually works — your standards, your terminology, your tools. {pn} is built to be
              taught your company's DNA, then act on it across three fronts.
            </p>
          </div>
        </RevealOnScroll>
        <div className="grid md:grid-cols-3 gap-5">
          {pillars.map((p, i) => (
            <RevealOnScroll key={p.label} delay={i * 80}>
              <Card className="h-full" data-testid={`card-biz-pillar-${p.label.toLowerCase()}`}>
                <CardContent className="pt-6 pb-6 px-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 flex items-center justify-center">
                      <p.icon className="w-5 h-5 text-primary" />
                    </div>
                    <Badge variant="outline" className="text-xs">{p.label}</Badge>
                  </div>
                  <h3 className="text-lg font-semibold leading-snug">{p.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
                  <div className="flex items-start gap-2 pt-1 text-xs text-muted-foreground border-t border-border/60 mt-1">
                    <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                    <span data-testid={`text-biz-pillar-native-${p.label.toLowerCase()}`}>{p.native}</span>
                  </div>
                </CardContent>
              </Card>
            </RevealOnScroll>
          ))}
        </div>

        <RevealOnScroll delay={120}>
          <Card className="mt-10 bg-muted/30" data-testid="card-biz-proof">
            <CardContent className="pt-6 pb-6 px-5">
              <div className="flex items-center gap-2 mb-4">
                <Quote className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm font-medium text-muted-foreground">
                  What enterprise leaders report after building agentic AI on their own business context
                </p>
              </div>
              <div className="grid sm:grid-cols-3 gap-5">
                {proof.map((pr) => (
                  <div key={pr.name} data-testid={`proof-${pr.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                    <div className="text-2xl font-bold tracking-tight">{pr.stat}</div>
                    <div className="text-sm font-semibold mt-1">{pr.name}</div>
                    <div className="text-xs text-muted-foreground leading-snug">{pr.detail}</div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground/70 mt-4">
                Source: Anthropic, “Building AI agents for the enterprise” (2026). Figures describe those organizations, not {pn} customers — they show where the market is heading.
              </p>
            </CardContent>
          </Card>
        </RevealOnScroll>

        <RevealOnScroll delay={160}>
          <Card className="mt-5 border-primary/30 bg-gradient-to-br from-primary/[0.04] to-transparent" data-testid="card-biz-fork">
            <CardContent className="pt-6 pb-6 px-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Layers className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Teach it once. Clone it everywhere.</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                  When one workspace is dialed in — its agents, approval policies, brand voice, and approved tools — {pn} forks
                  that whole proven configuration into a brand-new workspace in a single atomic step. Institutional knowledge
                  stops being tribal and becomes infrastructure that scales across every team you stand up.
                </p>
              </div>
            </CardContent>
          </Card>
        </RevealOnScroll>
      </div>
    </section>
  );
}

function BusinessPlatformSection() {
  const { config } = useSiteConfig();
  const pn = config.platformName;
  const features = [
    { icon: Brain, title: "Specialist Agents", desc: "Strategy, research, writing, build, sales, analytics, finance, legal, and operations roles work as one coordinated system." },
    { icon: Wrench, title: "Real Tool Use", desc: "Create PDFs, write files, browse sites, send emails, query memory, upload assets, and run workflows inside the same system — 407 tools total, managed by a centralized Tool Registry." },
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
    { icon: Layers, title: "Tool Registry System", desc: "Every tool is cataloged in a centralized registry with categories, speed class, and product tracking. Startup audits ensure nothing is invisible. 407 tools across 23 categories (R125+4 added `research`) with bidirectional integrity checks." },
    { icon: ShieldCheck, title: "Pause for Approval, Resume Where It Stopped", desc: "Long-running plans can pause for your sign-off and pick up exactly where they left off — no replay, no lost context. Stale approvals expire automatically so nothing stalls forever." },
    { icon: DollarSign, title: "Revenue-vs-Cost Self-Regulation", desc: "Your AI watches its own profit margins. When spend rises faster than revenue, it automatically downgrades to cheaper models and lighter tools — protecting profitability without you lifting a finger." },
    { icon: Activity, title: "Per-Agent Spending Visibility", desc: "Every tool call, model call, and orchestration is recorded against the agent that ran it. See in real time who's expensive, who's efficient, and where the spend is going." },
    { icon: Users, title: "Panel-of-Experts Mode", desc: "For high-stakes questions, your AI doesn't ask one model — it asks four in parallel and has a senior model (Claude Opus) synthesize the best answer. You get ensemble-quality reasoning at a transparent, ledgered cost." },
    { icon: Eye, title: "Wearable AI (Smart Glasses)", desc: "Pair Meta Ray-Ban smart glasses with your tenant. Your AI team sees what you see, hears what you hear, and replies with sub-second voice — all 407 tools available hands-free, from logging expenses to capturing project notes." },
    { icon: Brain, title: "Knows You Personally", desc: "Each tenant has a personal profile that the AI reads into every conversation — preferences, context, terminology, current projects. No more re-explaining who you are or what you're working on." },
    { icon: Sparkles, title: "Self-Healing Conversations", desc: "Long sessions never die mid-thought. When context fills up, the system automatically trims oversized tool results and continues — and 3-phase dreaming consolidates important threads into permanent memory while you sleep." },
    { icon: FileCode, title: "Self-Improving Codebase", desc: "Nightly research can propose real code improvements — but every proposal is shadow-compiled in an isolated workspace and reviewed before it can touch the live system. You see the diff, the verifier verdict, and click Approve. One-click revert restores the original if anything misbehaves." },
    { icon: Sparkles, title: "Brand-Voice MarTech Bundle (R79)", desc: "Six per-tenant content tools — your AI learns your voice from sample posts, drafts hooks across 6 angles, formats posts in PAS / AIDA / STAR / 4Ps with platform-aware caps for LinkedIn / X / newsletter, plans a full content matrix, and scores any post against YOUR voice profile with a 0–100 critique. Hardened against prompt injection so customer-supplied samples can't hijack the AI." },
    { icon: Layers, title: "Plug In Any Claude Code Agent (R80, NEW)", desc: "Found a great open-source AI agent on GitHub? Paste the URL — your VisionClaw inherits it as a fully-wired persona in seconds. A translation adapter teaches the imported agent how to use VisionClaw's real tools, role-based blocks stop it from running anything risky, and dangerous actions still require your approval. Curated collections of vetted public agents are one click away." },
    { icon: Gauge, title: "Instant AI Readiness Audit (R125+52.20, NEW)", desc: "Point the live audit at any website and get a real scored report on the spot — graded /100 across AI Access (35), Structured Data (20), Metadata (20), Social (15), and Technical (10) into an A–F letter grade with concrete recommendations, persisted to the audit_reports table. The public endpoint fetches a visitor-supplied URL behind a hardened SSRF jail that pins the validated resolved addresses through an undici connect.lookup override (re-pinned on every redirect hop, TLS SNI/Host bound to the real hostname) so a DNS-rebinding rebind can never reach internal systems." },
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
                  {["Executes tasks through 407 connected tools and 16 agent roles", "Stores project memory, notes, and assets for continuity", "Self-corrects incomplete work — ask once, get a complete deliverable", "Uses approval gates where business risk is real", "Auto-recovers from failures with backup agents and clear explanations", "Designed for repeatable operating leverage"].map(item => (
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
                    "Money-touching Revenue Mission experiments can never spend or send on their own (R125+137.66 → +137.72) — every autonomous revenue experiment requires typed owner approval before any outreach or charge, is bounded by a hard dollar cap ($25 per experiment) that mission settings can only tighten, and is guarded by an owner-only gate that now reads the owner identity from secure configuration instead of a hardcoded value — a fix verified by permanent regression tests and extended to the cost-reporting tools in a follow-up review. Approve and kill stay strictly human decisions, never something the AI can do for itself.",
                    "Every customer's data stays strictly inside their own walls — five more isolation gaps closed before anyone could hit them (R125+137.61+sec → +137.65+sec) — three 72-hour security reviews by independent expert passes verified the platform's most sensitive core came back clean and tightened five medium-severity checks: system-task seeding can no longer be influenced by a non-admin account, task approval buttons only work inside your own workspace, an email-processing retry can never pick up another customer's message, research status lookups now refuse to answer at all rather than answer without a verified workspace, and the scheduler that wakes agents for future work refuses to write anything without a verified workspace identity.",
                    "A leaked credential file can no longer ride along into the public downloads area, and the platform now cleans up after past deployments (R125+137.46+sec → +137.49-review) — a security review found the platform's own file-sync was copying hidden and secret-named files into the served downloads folder, including one real token file; the sync now excludes them, the exposed file was deleted, and every boot sweeps out hidden files left behind by earlier deploy images (the cleanup is deliberately scoped so it can never touch customer uploads). A follow-up 72-hour review also closed a medium-severity gap where one customer's completed records could mask another customer's missing data during a boot-time backfill — that check is now strictly per-customer.",
                    "The platform's own contact address can no longer be baked into the code, and an outside AI reviewer's findings were closed with permanent safety pins (R125+137.26 → +137.29-review) — an independent frontier AI model reviewed the platform's public source and every finding was verified and fixed: the owner's email address was removed from every server code path (it now comes only from secure configuration, and anything that needs it refuses to run rather than guess), and a 72-hour follow-up review closed three medium-severity issues — a public-API query is now locked to the requesting customer's workspace, a release-tagging script now rejects unrecognized commands before touching anything, and a code-quality gate now stops safely instead of proceeding on unreadable input — each fix pinned by a permanent regression test so it can never silently come back.",
                    "The platform's self-improvement loop now remembers what already failed, and unmet demand becomes visible telemetry (R125+137.14 → +137.19) — when the AI proposes a change that's semantically identical to one already rejected or failed, it skips the spend and tries a different direction instead of looping; a new demand signal counts every capability customers asked for that the platform couldn't do yet, surfaced on a live health card; and a 72-hour review closed a tenant-scoping gap in those very demand-signal writes fail-closed, with no critical or high findings anywhere in the window.",
                    "Risky actions like payments now leave a durable receipt trail, and the platform will never blindly retry one (R125+137.4 → +137.13) — every high-stakes action (moving money, mass email, deletions) is now recorded in a durable ledger before it runs and settled with a verified outcome after. When a risky call times out, the platform no longer guesses: it checks the ledger, then asks the payment provider directly whether the charge actually went through — and only retries when it can PROVE the action never happened. A confirmed charge can never be accidentally run twice, and anything unprovable is escalated to a human instead of retried.",
                    "The safety net that undoes a failed action is now itself bound to your workspace, and the platform's billing meters can never miss the default AI model again (R125+137.3) — a full-platform review (three independent expert passes plus an automated silent-failure hunt over 72 hours of changes) found that the rollback mechanism — the one that restores your data if an irreversible action goes wrong — wasn't itself locked to the owning customer when writing the restore; it now is, verified by an independent reviewer. The same review found the platform's own default AI model was invisible to the cost meters (one meter priced it at zero, another guessed), so real usage was mispriced; correct rates are now in every meter with a permanent test that fails the build if a future default model ever ships unpriced.",
                    "A second door into protected message-routing data is closed, and a failed experimental tool can no longer stay quietly active (R125+133) — a follow-up whole-platform review found the platform's internal reviewer could auto-approve writes into the same protected category that guards message routing, bypassing the lock added a round earlier; that auto-approve lane now refuses those categories outright. The same review caught (via an independent verifying reviewer) that an experimental AI-generated tool which failed its validation tests could report itself as rolled back while actually remaining callable — every rollback path now genuinely removes the tool, and anything that can't be validated is removed rather than trusted. Six existing security tests were also wired into the always-run test suite so these locks are re-checked on every change.",
                    "A file-listing gap that could show one customer internal platform filenames is closed (R125+125) — a 72-hour security review found the internal file-listing tool would include the platform's own internal data-directory filenames in any customer's listing; that listing is now restricted to the platform owner, and every listed file carries an explicit origin tag so a name collision can never map a file to the wrong location. The same review added fail-closed customer-scope checks to five more background and finance tools — each now refuses to run at all rather than run without a verified customer scope — and the platform's weekly self-maintenance now raises a loud red alert if its own code-size watchdog ever fails to run, instead of quietly reporting a pass.",
                    "Delivered-file verification now refuses to pass a file it can't positively identify (R125+76) — a whole-app review found the automatic check that verifies every delivered file's format quietly passed files whose type couldn't be determined; it now fails them instead of guessing. The same round made a silently-lost audit record visible — every verification now reports whether its audit entry was actually saved — and both fixes are locked in with dedicated regression tests.",
                    "Three quiet tenant-isolation gaps closed after a whole-app + 72-hour review (R125+75) — the central tool executor can now take its customer scope only from the platform's own trusted context (never from text the AI wrote), and two internal status updates that matched records by ID alone are now scoped to the owning customer so they can never touch another customer's rows; a swallowed internal error in the background heartbeat now logs loudly instead of hiding.",
                    "Every terminal task failure now produces a clear what-completed / what-failed / what-to-do-next report instead of a raw error string (R125+73) — when a task can't finish (a rejected or expired approval, or a run that hits its time, budget, stuck, or step limit), you get a plain-language summary of what got done, what stopped it and why, what already exists, and the exact next step and who owns it — so a dead-end is always legible instead of a cryptic message.",
                    "Untrusted text shown inside those failure reports can't smuggle in clickable links, images, or hidden formatting (R125+74) — a follow-up review found that approval notes, questions, and tool-error text quoted into a failure report could still sneak in disguised links or formatting; that text is now neutralized so it always displays as plain words, while genuine result links still work normally. The same round also closed a spending-safeguard gap so several owner-initiated heavy AI cross-checks running at once can never slip past the daily cost ceiling together. Caught in a whole-app + 72-hour review across four parallel expert passes (architect PASS, clean wiring audit).",
                    "Your AI team can now get an independent second opinion before bothering a human (R125+52.41) — when an answer comes back low-confidence, the platform automatically asks a separate panel of top models for a cross-check first, and only escalates to a person if it's still unsure. That second-opinion spend sits behind a hard $25/day owner-only ceiling that was then hardened so it can't be overshot (R125+52.42): every charge is reserved against a deliberately pessimistic worst-case estimate before any money moves, the first time a real bill ever comes in higher than expected the whole feature shuts itself off and alerts the owner instead of quietly spending more, and each later reservation rises to match the highest real cost seen that day.",
                    "Heavy AI 'panel of experts' work no longer eats into the platform's daily spending safeguard (R125+52.25) — a whole-app review found that the multi-model jury's premium-model usage was being counted against the daily cost ceiling that's meant to catch runaway everyday spending, which could trip that safeguard early and throttle normal work. Jury usage is now correctly exempted at the source while the real cost is still recorded on the bill, so the safeguard protects only the spending it's meant to. The same review also guaranteed that a background or scheduled task can never save a blank reply, and tightened two internal data checks so they reject invalid account ids.",
                    "A live Instant AI Readiness Audit anyone can run (R125+52.20) — point it at any website and it returns a real, scored readiness report on the spot, grading AI access, structured data, metadata, social, and technical health out of 100 with a letter grade and concrete recommendations. Because it fetches an address you supply, it runs inside a hardened safety jail that can only ever connect to the exact destination it already verified — re-checked on every redirect — so it can never be tricked into reaching internal systems.",
                    "Tighter tenant isolation after a whole-project review (R125+52.22) — three places where one customer's project names, descriptions, or uploaded filenames could surface in another customer's working context were found and closed; each is now locked to its own workspace and fails closed by default, and unused legacy code that didn't isolate properly was removed entirely.",
                    "The platform's own scheduled maintenance jobs now run with a scrubbed environment (R125+34+sec) — a full-app + 72-hour security review across four parallel expert passes found that the automatic maintenance runner was handing its background helper the full set of inherited environment settings, which could leak secrets and let a hostile input swap in code to run inside a privileged scheduled task whose output is logged. The fix strips that environment down to only what the helper needs, matching the same hardening already applied to the automatic GitHub-backup task. The agent-wiring audit came back clean — every one of the 384 tools accounted for, nothing dead, drifted, or leaking.",
                    "The platform now closes its own credential-exposure gaps (R125+25) — a full-app + 72-hour security review across four parallel expert passes found and fixed a flaw where a long secret value (like an API token) could leak its first characters into an internal security audit log; the fix makes sure secrets are blanked out before anything else can touch them, and a regression test now guards it. The agent-wiring audit came back clean — every one of the 384 tools accounted for, nothing dead, drifted, or leaking.",
                    "The platform now tracks whether using a heavy AI process was actually worth it (R125+24) — it records how long and how much each big AI task was predicted to take versus what it really took, and a lightweight check can quietly skip the expensive multi-model process for trivial requests where a direct answer is just as good (it never overrides a heavy analysis you explicitly asked for). A new dashboard card surfaces the real-vs-expected gap so 'this saved me time' becomes a measured fact, not a guess.",
                    "Self-healing with the owner in control (R125+22) — the platform diagnoses its own failures and either fixes them under strict guards (off by default) or escalates with full context; auto-fixes can never weaken a security guard, and money/auth/schema changes always pause for owner approval.",
                    "Long multi-stage jobs now resume by repairing only the step that failed (R125+22) — a retried job reuses everything it already finished and re-runs just the one failed step, so there are no duplicate charges, emails, or uploads on a resume.",
                    "Your AI team can now hand work to each other without collisions (R125+15) — agents working the same big job share a coordination 'blackboard' where each can post its latest status and claim a piece of the work, and the system guarantees only one agent ever grabs a given piece. Built on the existing coordination plumbing, so it added no new moving parts to maintain.",
                    "The Chief of Staff can now put tough calls to a panel of three top AI models (R125+16) — when an escalation needs a tie-breaker, the Chief of Staff can route it to a 3-model majority vote, and a safety audit confirmed this access was granted cleanly without loosening any other permission.",
                    "Money-moving task-force charges now succeed only within budget, atomically (R125+14+sec4) — charging a task force is now a single all-or-nothing database operation, so a charge that would exceed its budget is rejected without ever touching the books, closing an overspend window and a concurrent-charge race. Caught in a full-app + 72-hour + GitHub-system security review across four parallel expert passes (plus a focused second pass on the fixes).",
                    "The platform's own GitHub backups are hardened (R125+14+sec4) — the automatic code-backup push no longer runs through a shell, validates the target repository name, and now fails loudly instead of silently if a backup can't be saved.",
                    "Built With Bob videos are locked to Bob's own voice (R125+14+sec3) — when a video is flagged as a Built With Bob production, it can only be narrated in Bob's authentic cloned voice; if that voice can't be produced the render stops rather than quietly shipping in a generic substitute voice.",
                    "Network-facing video ingestion now runs with a scrubbed environment, closing a code-execution pivot (R125+14+sec2) — the path that pulls transcripts from video URLs no longer hands its background helper the full set of inherited environment settings, so a hostile input can't quietly swap in code to run. Caught in a full-app + 72-hour pre-publish security review across three parallel expert passes (plus a focused second pass on the fixes).",
                    "Money-moving budget and task-force tools now reject malformed or negative amounts before they can touch the books (R125+14+sec2) — setting a department budget or charging a task force is now validated at two independent layers, so a bad value can't corrupt spend tracking or accounting.",
                    "Internal error details no longer leak to API clients (R125+14+sec2) — when something fails server-side, customers now get a clean generic message while the full diagnostics stay in our private logs, across the archive-recovery, graph, store-checkout, and leads paths.",
                    "Made the platform's self-improvement safer (R125+13.25) — when the system writes a fix to its own code, an automatic check now blocks any change that would weaken how each customer's data is kept separate, routing it to a human for review instead of applying it. Caught in a whole-app security review across three parallel expert passes.",
                    "Five silently-degraded security primitives caught and restored in the R98.19+sec whole-app review (architect rounds 1 + 2 + 3). The pattern: legacy hardening code used the wrong import style, so the security check would crash invisibly and pass the request through. Among the closed gaps — provider error messages flowing to agents now scrub our own API keys before display; shell-command output handed to delegated agents now lands inside a fresh random fence so a hostile string can't pretend to be instructions; and the GitHub-imported-agent pipeline now actually runs its prompt-injection scanner on every imported persona body (it had been quietly skipping the scan). When the scanner itself fails for any reason, the import is now hard-quarantined — never passed through unscanned.",
                    "One-step tenant on-ramp with no security trade-off (R125+46) — a brand-new workspace can inherit a proven tenant's entire governance setup (agent policies, autonomy rules, approval tiers, voice/skill preferences) in a single all-or-nothing operation; only an explicit safe-list of configuration is ever copied, custom tools are never blind-cloned, and a failure leaves zero half-created data — verified no cross-tenant leakage.",
                    "The platform just finished a self-hardening security sprint (R125+52.6 → +52.15) — a continuous run of security work on its most sensitive internals: the system that votes on and auto-applies its own code fixes is now replay-proof and race-proof end to end, and the headless-browser tool re-checks every address after each action so a mid-action redirect can't reach an internal service. Every fix passed an independent expert review (FAIL→FIX→PASS) with a clean wiring audit.",
                    "Before that, the platform passed a full self-review (R125+52.5) — a whole-app, all-sensitive-surfaces, 72-hour thorough review across three parallel expert passes plus a clean wiring audit (exit 0) found zero new actionable issues.",
                    "The platform keeps reviewing its own code (R125+46+sec) — a whole-app, all-sensitive-surfaces, 72-hour thorough review across three parallel expert passes plus a clean wiring audit found no critical or high issues and closed three medium hardening items; the receipts are published on the dashboard, not buried.",
                    "Long-session memory now ranks recalled facts by confidence × recency × access-frequency, dedupes near-duplicate writes inside a 30-second window, and caps the recall context at 8K tokens so a long thread never starves the live conversation budget — the system gets sharper over weeks instead of louder (R98.19 Memory v2).",
                    "Dependency supply chain hardened — two HIGH-severity CVEs closed in the R98.18+sec self-healing round: a SQL-injection identifier-escape bug in our database layer (drizzle-orm 0.39 → 0.45, GHSA-gpj5-g38j-94v9) and the prototype-pollution + regex-DoS issues in the `xlsx` library, which had no upstream patch available. We migrated our one runtime spreadsheet call to the already-installed `exceljs` instead of waiting on a fix that wasn't coming. npm audit went from 2 HIGH to zero overnight.",
                    "Provider error messages are scrubbed of secrets before any agent sees them — even our own API keys round-tripping through a 401 from a third-party model now land redacted, and the same scrubber masks anything resembling a credential before it can be quoted into a chat reply (R98.16+sec-2 CRITICAL closed).",
                    "Web fetches blocked from reaching cloud-metadata IPs, private networks, internal cluster TLDs (`.internal`, `.cluster.local`, `.svc`), multicast addresses, IPv6 link-local, and CGNAT — closes the path where a model-controlled URL could pivot from one of our hosted browsers into private infrastructure (R98.16+sec-2 HIGH closed, building on R96 SSRF jail).",
                    "Critical state files (job spool, code-health snapshots, video render state, research findings, skill manifest) survive a power-loss mid-write — every atomic save fsyncs both the file AND the parent directory, so a crash between rename and pagecache-flush no longer leaves an empty file (R98.16).",
                    "Adversarial Humanities Benchmark (AHB) defense — every message is destyled to its literal intent before the AI sees it, catching jailbreaks dressed up in poetry, allegory, or role-play. Captured page titles, oEmbed responses, and shell output are now also defanged of fake markdown headings and pseudo-system XML tags (`<system>`, `<assistant>`, `<|im_start|>`) before they reach a model prompt (R98.16).",
                    "Destructive-tool firewall — payments, deletes, credential-touching tools, and shell-execution tools require typed arguments, trusted personas, approvals, and dollar caps. Unknown tools fail closed.",
                    "Four-tier web access ladder with auto-escalation — web_fetch → firecrawl → stealth_browse → Camofox stealth microservice. Blocked-page detection injects a fallback hint into the next turn so the agent climbs the ladder instead of giving up. Per-(tenant, persona) cookie isolation; SSRF guard on every URL.",
                    "41 governance rules enforce operational boundaries across every agent.",
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
                  data-testid={`button-faq-toggle-${i}`}
                  aria-expanded={open === i}
                  aria-controls={`faq-panel-${i}`}
                >
                  <span className="font-semibold text-sm">{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${open === i ? "rotate-180" : ""}`} />
                </button>
                {open === i && (
                  <div className="px-5 pb-4" id={`faq-panel-${i}`}>
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
                <Button variant="outline" size="lg" onClick={() => navigate("/audit")} className="gap-2" data-testid="button-biz-cta-audit">
                  Run a Free AI Audit <ArrowRight className="w-4 h-4" />
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
  { agent: "Luna", icon: Gavel, action: "Compliance scan complete", detail: "All 41 governance rules validated — zero violations. NIST/OWASP frameworks current", type: "task" },
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
  const tools = useCountUp(407, 2000, visible);
  // R115.5+sec round 3 — surface counters synced to live SoT in replit.md aggregate.
  // R125+13.16+sec3 — resynced to live counts after Bob caught 4-ship drift.
  const models = useCountUp(41, 1800, visible);
  const skills = useCountUp(62, 1600, visible);
  const tables = useCountUp(222, 2200, visible);
  const govRules = useCountUp(41, 1800, visible);
  const capabilities = useCountUp(129, 2100, visible);
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
    try { const p = new URLSearchParams(window.location.search).get("view"); return (p === "technical" || p === "business") ? p : ((localStorage.getItem("vc_landing_mode") as LandingMode) || "business"); } catch { return "business"; }
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
    { id: "section-biz-transformation", label: "The Shift" },
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
        description={"Deploy a 16-agent AI team with 407 tools (+4 MCP memory tools external surface), 129 active capabilities, 222 database tables, 642 indexes, 43 + 62 + 38 skills (143 reference surfaces), and 41 governance rules. Latest R125+137.76+sec — the sell-and-fulfill loop closes: a commerce_products catalog + 3 owner-only commerce tools (product_listing_create/list, create_payment_link; tools 404 → 407) let the platform list its own products, and the $497 self-serve AI Readiness Audit now auto-fulfills on Stripe payment with post-purchase sequence enrollment; Revenue Missions gains a retrospective scoring hook, a fail-closed pre-spawn budget gate and a $0 background opportunity scanner (guard tests 60 → 81); and security ships a tenant-isolation audit burn-down (17 REAL fixes across 15 sites, 82 verified false positives) plus a 72h whole-app review closing 1 HIGH (archive-rescue webhook onto ownerTenantId() SoT) + 3 MEDIUMs (tenant-scoped softDelete, PII-redacted compaction memory-extract, advisory-lock race-proofed experiment cap). Prior R125+137.72 — the Revenue Missions engine ships: autonomous revenue experimentation with owner gates, hard dollar caps ($25/experiment) and Stripe-verified evidence. 5 new owner-only tools (mission_create/list/status/draft_experiment/portfolio_review; tools 399 → 404) + 3 new tables (revenue_missions, mission_experiments, mission_evidence; 218 → 221) drive a deterministic mission stage machine (kill-from-any-stage) with a HARD_CAPS clamp (25 prospects / 3 contacts / $25), CAS race-safe capped outreach behind a fail-closed pre-send spend gate, a fail-closed Stripe evidence hook, an autonomy ladder (10% reinvestment / $250 cap) and a max-3-concurrent-experiments cap; approve/kill stay HITL-only. Security: the .71 HIGH + .72 follow-up move mission & cost-ledger owner-only tools onto the env-configurable ownerTenantId() single source of truth with env-driven regression tests. Prior R125+137.59 → +137.65+sec — the platform starts learning from its own tool choices and opens an agent-to-agent front door: five external-review recommendations land (condition-based wakes, episode playbooks, outcome-learned persona routing, inbound A2A task acceptance via JSON-RPC 2.0, an Autonomy Scoreboard), a tool mis-pick telemetry ledger goes live, the tool-recall doctrine makes every persona re-scan its full inventory before saying it cannot, a production maintenance-cron incident is fixed at the root, and three 72h security review rounds close five MEDIUM tenant-isolation findings — round 4 verified the sensitive core clean and made the autonomous wake scheduler fail closed on any unverified workspace. Prior R125+137.45 → +137.50 — Proactive Commitment Drafting (approaching-deadline commitments drafted unprompted into human-approval cards; the drafter is structurally incapable of sending anything itself), a CRITICAL credential-file leak closed with a boot-time purge of prior deploy residue, all 10 maintenance crons prebundled so production can never lose them, a 10-file god-file cleanup with ceilings locked down, and an IdeaBrowser MASTER sweep that simulated the top 12 of 256 scored business ideas. Prior R125+137.30 → +137.40 — the Simulation Sandbox contract completes S1–S5: offline what-if replay of past safety decisions and model swaps under a shared per-run $5 hard cap (claim-before-spend), new sandbox_run/sandbox_report tools registered fail-closed + trusted-personas-only (tools 396 → 399, tables 213 → 215), a /admin/sandbox UI with admin-gated launch API, and Sandbox probe #16 on the ecosystem-health dashboard — E2E smoke replayed 5/5 live safety decisions with NO_CHANGE. Also in the window: a metered escalation valve for the repo-surgeon (one frontier diagnostic turn on a prior-collapse stall, fail-OPEN), two standing-registry model registrations (meta/muse-spark-1.1 + nvidia/nemotron-3-ultra-550b :free), a self-healing incident-proof BWB weekly recap (explicit date-window + labeled weight-fact extraction cure the wrong-week and wrong-numbers incidents), and a Tool Reliability card on the ecosystem-health dashboard. Earlier R125+137.23 → +137.25-review — the Tool Eviction/Retirement loop + Tool Forge Phase 2 land as weekly crons, the tool-router gains a hard cap (enforceToolCap), an AG-UI protocol adapter opens the public API v1 surface, the admin PIN hash is consolidated onto the canonical peppered hasher, and a 72h whole-app review closes 2 MEDIUMs. Earlier R125+137.20 → +137.22 — six OpenClaw-inspired native features land: a tenant-guarded, PII-redacted commitments/open-loop miner, a summary-quality audit + deterministic fallback wired as an identifier-recovery backstop at the compaction chokepoint, operator-text-as-untrusted wrapping, first-failure-wins health root-cause ordering, a skill code-safety scanner, and a record-only egress telemetry ring buffer. Plus Fable-method borrows — seeded-fraud completion fixtures proving the deterministic verification layer fails closed against a gullible judge (live probe caught 4/4 planted frauds) and a spec-vs-test authority rule in the repo-surgeon — and a Drive connector-lookup fix curing backup upload failures. A follow-up 72h post-edit review added Zod validation to the public checkout and profile routes and logged 1 FALSE POSITIVE. Earlier R125+137.14 → +137.19 — the self-improvement loop gains two new safeguards: RULER-style relative group ranking as a measure-first third judge lane (never touches the apply decision) and prior-collapse detection (an embedding-space memory of failed/rejected proposals so the platform never burns spend re-proposing a semantically identical change). Two god-file splits land behavior-preserving (routes Tier-1 + tools-layer S34, 295/395 tools migrated), Tool Forge Phase 1 turns unmet capability demand into durable telemetry with an Unmet Capabilities health card, and a 72h post-edit review closed 1 MEDIUM fail-CLOSED — autonomous capability-gap writes are now tenant-validated before any insert — plus 4 silent-failure fixes; no CRITICAL/HIGH findings. Earlier R125+137.3 — a full-platform post-edit review (3 architect surface passes + a silent-failure-hunter pass + wiring audit over 205 commits / 80 files) closed 1 CRITICAL fail-CLOSED: the transactional no-regression snapshot's rollback UPDATE was missing its tenant scope — the safety net that undoes a failed irreversible action could have written across tenant boundaries; it is now tenant-scoped and architect-verified. Plus 1 MEDIUM: gpt-5.6-sol (the default flagship) was absent from all 3 pricing maps — explicit rows + a presence regression test guarantee a default model can never ship unpriced. Earlier in the window: a model-pricing drift guard + live OpenRouter reconciliation (2 real ledger gaps fixed), PROOF_LOOPS v2 proof-level L1–L5 + Chronicle-precision telemetry, a full wiring review regenerating the tool catalog 396/396 (302 post-split tool docs un-darked), and Grok 4.5 wired in additively. Earlier R125+133 — a post-edit code-review sweep closed 2 HIGH + 3 MEDIUM fail-CLOSED: the trust-reviewer's auto-approve lane now blocks reserved knowledge categories outright (defense-in-depth behind the storage chokepoint), and an architect-caught gap where a 'reverted' unvalidated LLM-generated tool stayed active is closed — every revert path now deletes the row and unvalidatable tools fail CLOSED; 6 security tests newly wired into the canonical suite. Earlier R125+132 — a domain-boundary CI gate (219 files / 73 tool domains), coverage reporting, a fail-closed Prometheus /metrics endpoint (404 unless the token matches, timing-safe compare), a lite deploy profile, and Mermaid architecture diagrams. Earlier R125+131 — GPT-5.6 Sol verified live and promoted to OpenAI flagship across ~28 files with the $0 cost-safety lane intact. Earlier R125+130 — a post-edit security sweep closed 1 HIGH fail-CLOSED: a cross-tenant SMS/WhatsApp pairing hijack (any tenant-agent could plant a messaging_pairing knowledge row and hijack another tenant's inbound messages) is now blocked at the storage chokepoint — reserved knowledge categories throw on create AND update unless explicitly allowed — plus 3 MEDIUM PII-redaction / tenant-guard fixes and a new 8-assertion CI guard. Earlier R125+129 — a new portable Evidence Docket (generate_evidence_docket, tools 395 → 396) bundles goal contracts, completion-verification verdicts, jury concordance, intent-gate/tool-block audit rows, and the delivery record into one reviewer-facing artifact — tenant-scoped on every query, secrets/SSN/credit-cards scrubbed from every free-text value. Earlier R125+128 — the browser-tool SSRF TOCTOU closed: request interception re-runs the full DNS-validated policy check on every navigation (initial goto, each redirect hop, client-side navs) and fails CLOSED on guard error. Earlier R125+127 — a whole-app security review closed 2 HIGH (cross-tenant uploads read/enumeration; agent-knowledge PII-redaction bypass across 8 raw INSERT sites) plus Twilio webhook replay dedupe. Earlier R125+76 — a whole-app post-edit code review closed 2 MEDIUM + 2 LOW fail-CLOSED in the deliverable-verifier + storage-redaction + memory-ranking surface: an undeterminable MIME on a MIME-gated deliverable contract is now a verification FAILURE (was a silent PASS), the verifier result carries an `auditPersisted` boolean so a swallowed audit-log write is visible instead of silently claimed (repudiation gap closed), the PII-redaction guard coerces non-string input to honor its declared string contract, and a stale exploration-bonus default-comment was corrected; +4 dedicated regression tests on the verifier branches, tsc 0, PII-guard tests 15/15, architect confirming PASS. Earlier R125+75 — a whole-app + 72h post-edit code review (agent-wiring audit exit 0, 394 tools, 0 dead/drift/leak/schema-gap) closed 3 pre-existing MEDIUMs fail-CLOSED in the tenant-isolation + silent-failure surface: the guarded-tool executor now sources the execution tenant ONLY from the trusted ctx (no model-authored `_tenantId` fallback), both event-bus `event_log` status writes are tenant-scoped, and heartbeat's failed-event update logs loud and is tenant-scoped (live-stat resync tables 211→212, indexes 620→623); tsc 0, regression suites green, architect PASS. Earlier R125+74 — a whole-app + 72h post-edit code review (4 parallel architect passes + wiring audit exit 0, 394 tools, 0 dead/drift/leak/schema-gap) closed 1 MEDIUM: untrusted approval-note / question / tool-error text quoted into the new R125+73 terminal-failure report could still inject INLINE markdown, so a new `mdEscape()` in `server/agentic/failure-contract.ts` backslash-escapes every untrusted field (real artifact URLs unmangled); the same round fixed the owner-jury metered daily-ceiling concurrency overshoot in `server/moa.ts` (reserve-then-settle so concurrent owner-jury runs can't slip past the daily-$ ceiling), suites 9/9 + 7/7, tsc 0, architect PASS. Earlier R125+73 — a structured failure contract: a new pure renderer (`server/agentic/failure-contract.ts`) emits a consistent what-completed / what-failed / what-exists / next-step block on every terminal-failure exit (approval rejection/expiry + all 4 executor halts) without ever auto-routing around a rejected approval, 8/8 unit tests, architect PASS twice. Earlier R125+72 — closed the #1 open threat-model gap: a new central guard redacts credential-shaped secrets, Luhn-validated credit cards, and US SSNs on every durable-store write (memory, knowledge, conversation-fact) so the model can never persist credentials pulled from untrusted ingest; 1 HIGH + 2 MEDIUM closed fail-closed, architect PASS, the threat model's RAG-poisoning + data-poisoning rows now fully covered. Earlier R125+60 → +61 — a platform-security hardening sprint: a whole-app + 72h review closed 3 HIGH (a plan/lobster step-executor tenant+persona escalation that let a non-admin tenant run owner-only tools via a plan step, an SSRF DNS-rebind TOCTOU pinned at 4 more public-fetch callsites, and a `vc_` API-key admin confusion), architect PASS, 0 new CRITICAL/HIGH, +2 auth regression tests. Earlier R125+53 — a new Actor-Critic Reflection step in the supervisor loop: when a loop gets stuck retrying with no success, an independent second LLM diagnoses the failed output and hands back targeted retry guidance instead of blindly halting or upgrading (fails OPEN, single gate, escalation clamped), shipped behind a whole-app + 72h review (architect PASS, 0 CRITICAL/HIGH) that closed 2 MEDIUM (an auto-consolidation advisory lock now released in a finally; a stale 208→210 tables fix). Earlier R125+52.47+sec — a third whole-app + 72h code review (architect PASS, agent-wiring audit CLEAN — 393 tools, 0 dead/drift/leak) closed 4 findings: a cost-cap backstop adding the two most expensive autonomous tools (`second_opinion`, `venture_discovery`) to the dispatcher's hardcoded expensive-tool set, a tenant-scoped fail-closed projects lookup in the auto-transcript path, a fail-soft Token Efficiency probe import so a probe load error degrades just that one card, and a founder-quote tool-count fix. R125+52.44 → +52.46 — a new Token Efficiency telemetry card on `/admin/ecosystem-health` plus two whole-app + 72h reviews closing 2 HIGH in the Venture Discovery loop + 2 MEDIUM. Earlier R125+52.43+sec — the nightly cross-tenant Tenant-Isolation audit was hardened so oversized source files are split into overlapping windows and fully audited (62 findings triaged → 8 genuine cross-tenant isolation defects closed, the rest verified false positives; 3 architect passes → PASS). R125+52.41 → +52.42 — a new `second_opinion` agent cross-check tool (all 16 personas, auto-fires an independent multi-model verdict on a low-confidence answer before human escalation) behind an overshoot-proof $25/day owner-only Fusion cost cap (deterministic worst-case reservation clamp + fail-closed cost-drift latch that disables the feature and pages the owner on the first real overshoot + dynamic reserve floor; architect HIGH → accepted LOW, +11 guard tests, PASS). R125+52.31 → +52.39 — a nine-round security + reliability hardening sprint: a new Harness Health card (self-repair land-rate at the attempt grain) on /admin/ecosystem-health, the new `ponytail` engineering-discipline skill, a mid-run budget-adaptive strategy controller, per-probe degraded-telemetry observability + cross-tenant self-heal scoping, the completion-evaluator now judged on a model distinct from the worker set, the deferred SSRF DNS-rebinding TOCTOU closed by socket-pinning the validated IPs, a MoA proposer-sanitization fail-open, and three whole-app + 72h code reviews (architect PASS). R125+52.23 — NEW honest tool-output compression-savings tracking: a new tool_compression_stats table records the REAL bill-impact of the type-aware tool-output compressor on live traffic (savings measured vs the old head-slice baseline, never vs raw), surfaced as a card on /admin/ecosystem-health (+1 table, +1 index). R125+52.19 → +52.22 — NEW live Instant AI Readiness Audit at /audit: a public POST /api/public/audit/run fetches a visitor-supplied website and returns a real scored report on the spot (/100 across AI Access, Structured Data, Metadata, Social, and Technical → grade A–F with recommendations, persisted to the audit_reports table), hardened against a DNS-rebinding/SSRF TOCTOU by pinning the validated resolved addresses through an undici connect.lookup override (re-pinned on every redirect hop) plus a whole-project code review that closed 3 cross-tenant read leaks (chat-engine workspace context + self-improvement experiments now tenant-scoped, fail-closed) and deleted dead unsafe chat scaffolding. R125+52.16+sec — default reasoning model upgraded to Claude Opus 4 (claude-fable-5 demoted to last-resort) plus a whole-app + 72h security review closing 1 HIGH (the owner-shell catastrophic-command deny floor now defeats quoted/escaped root targets) + 2 MEDIUM (boundary-safe workspace containment; tenant-scoped conversation-delete archive). R125+52.6 → +52.15 — self-hardening sprint: jury-queue replay/race proofing + browser SSRF revalidation (+1 table jury_drain_ledger). R125+52.5 — whole-app + 72h thorough review (3 parallel architect passes + agent-wiring audit exit 0) over the autonomous cost-governance, flat-rate model-routing, and shadow-mode jury-experience work: 0 new actionable findings. R125+52.4 — NEW shadow-mode Jury Experience Library (Training-Free GRPO, arXiv:2510.08191): the multi-model jury distills a comparative lesson from every divergent vote into a new jury_experiences table (collecting now, not yet injected, fail-open). R125+50 — autonomous-spend governor puts a hard daily cost ceiling (fail-CLOSED, owner-only) on every background loop; R125+51/+52 flat-rate OAuth model routing. R125+47 — NEW Delivery Funnel telemetry (produce → ship → adopt) via a new delivery_engagement table, a /uploads-middleware hook, and a Delivery Funnel card on /admin/ecosystem-health — honesty-first, adoption is a documented floor. R125+46+sec — whole-app + all-sensitive-surfaces + 72h thorough code review (3 parallel architect passes by surface + agent-wiring audit CLEAN): no CRITICAL/HIGH, closed 3 MEDIUM (added a tenants.forked_from index, scrubbed the BWB preflight spawn environment, re-synced current-state stat strings). R125+46 — Multi-tenant config-forking: stand up a fresh tenant pre-loaded with a proven tenant's whole configuration (personas, tool policies, autonomy rules, voice/skill prefs — an explicit 11-table allowlist) in one atomic, fail-closed transaction. Prior R125+31+sec2 — follow-up full-app + 72h post-edit review (4 parallel architect passes + agent-wiring audit GREEN at 384 tools, 0 dead/drift/leak/orphan/schema-gap): closed 1 MEDIUM — the self-repair autofix HITL gate now also covers the broad aggregator modules (routes/tools/chat-engine/auth/guarded-executor) so an opt-in autofix touching them pauses for owner sign-off (monotonic, fail-safe). R125+31+sec — Full-app + 72h post-edit code review (5 parallel architect passes + agent-wiring audit GREEN + a confirming re-pass): closed 1 HIGH — the autonomous skill-build jury no longer counts an errored juror's abstention toward quorum, restoring the fail-closed invariant — plus 1 MEDIUM (streaming tool-call merge); loop-until-clean PASS. R125+30 — Full-app + 72h post-edit review: closed 2 HIGH (customer delivery-email signed-link corruption; skillify now sanitizes + length-caps LLM-distilled text before it can reach the global skill registry) + 1 MEDIUM (browser SSRF guard IPv6 link-local + multicast parity). R125+29 — Full-app + 72h post-edit code review (4 parallel architect passes + agent-wiring audit GREEN at 384 tools): fixed an illusory-coverage gap where three model-tier unit suites silently never ran (64 assertions now execute in CI) + 3 fail-closed hardenings (skill-build approval predicate, signed order-page app-play link, model-tier refresh fails closed on a corrupt overlay). R125+28 — every skill-enable path (auto AND manual) behind the same jury gate, no human review queue. R125+27 — jury-gated autonomous skill build (strict 2-of-3 frontier vote, injection-defanged). R125+26 — ranking-driven model auto-adoption (weekly refresh promotes the top closed + open LLMs by Artificial Analysis intelligence index into the routable overlay, fail-closed matching). R125+25 — Full-app + 72h post-edit review (4 parallel architect passes; 0 CRITICAL / 3 HIGH / 2 MEDIUM; agent-wiring audit GREEN): the tool-block telemetry redactor now masks secret keys before any truncation so a long token can't leak its prefix into an audit row (exported + 5-case regression test); 2 HIGH + 2 MEDIUM deferred as tracked dormant known gaps. R125+24 — Agentic efficiency awareness: a new orchestration_efficiency table records predicted-vs-actual time/cost per orchestration, an advisory fail-open guard can down-route trivially-doable requests off the 4-model ensemble (never an explicit jury/ensemble call), and a new Orchestration Efficiency dashboard card surfaces the real-vs-expected gap (+1 table, +2 indexes). R125+23 — Full-app + 72h post-edit security review (4 parallel architect passes; 0 CRITICAL / 3 HIGH / 6 MEDIUM; agent-wiring audit GREEN): tenant-isolation ownership guards wired at the 3 LLM-reachable project-scoped INSERT sites that had missed them, the providers invalid-prefix warning no longer logs a decrypted key prefix, and a new idx_agent_knowledge_tenant_source index — plus a stale-stat resync (.agents skills 32→31, indexes 552→553). R125+22 — Autonomous self-repair stack — the platform now repairs itself, with the owner in control: it detects its own failures, classifies them (heuristic-then-jury) into a repair_incidents ledger (#51), and either repairs them via a guarded Repo Surgeon code-fix executor (#52, MINIMAL diff verified by typecheck → targeted tests → optional golden-path replay → re-run the failed tool; green or rollback) or escalates to the owner — auto-apply OPT-IN via REPAIR_AUTOFIX_ENABLED (default OFF), can never weaken a guard, and pauses for owner approval on money/auth/schema changes; long multi-stage jobs resume by repairing ONLY the failed step (pipeline-checkpoint #53, wired into the BWB weekly render); owner-visible incident ledger at GET /api/admin/repair-incidents (#54, no agent tool triggers a repair); security rounds R125+19/+22 closed 10 MEDIUM (0 HIGH/CRITICAL) fixing silent-failure regressions fail-closed. R125+16 — Chief-of-Staff jury access: a new per-tool extraAllowedPersonas allowlist grants jury_triage (the 3-frontier-model 2-of-3 vote) to the Chief of Staff persona without widening the global trust tier, closing the last trusted-tool wiring leak the agent-wiring audit had flagged (leaks 1→0); AHB 50/50, tsc clean, preflight CLEAN, wiring audit exit 0, architect PASS, all stats unchanged. R125+15 — TigrimOSR-inspired blackboard multi-agent coordination on parallel_job_findings (keyed shared-state slots latest-wins via DISTINCT ON + atomic work-claims via partial unique index idx_pjf_claim), built by EXTENDING the existing findings bus: 0 new tools, 0 new tables, +1 index. R125+14+sec2 — Security/correctness hardening round (full-app + 72h pre-publish post-edit review, 3 parallel architect passes + a focused 2nd pass on the fix delta, PASS): the network-facing yt-dlp video-transcript ingestion path now spawns with a scrubbed env (sanitizeSpawnEnv), the money-moving set_department_budget/charge_task_force tools reject negative/non-finite amounts at both dispatch and module level, the plan-executor stuck-plan stale-interval sweep is now parameterized, and client-facing HTTP 500 internal-error-detail leaks were removed across archive-rescue/graph/store-checkout/leads; new tool bwb_weekly_build (383 → 384, all other stats unchanged). Verified tsc clean, AHB 47/47, held-out-eval-gate 14/14, wiring audit exit 0. R125+14 — Autonomous Corporate Operations: 12 new tools + 4 new tables across seven self-managing capabilities (OKR review cadence wired to the heartbeat, durable sleep/wake schedules, departmental budget enforcement, continuous mid-plan replanning, an A/B→Stripe→SOP optimization loop, an LLM-free Process Reward Model scoring every step, and scoped task-forces) + R125+14+sec1 security/correctness pass (fail-closed project/conversation tenant-ownership guards, a FOR UPDATE row-lock fix for the A/B-event race, per-department cost attribution). R125+13.25 — Security hardening post-edit code review (3 parallel architect passes) closed 1 HIGH + 1 LOW: the self-improvement auto-apply gate now fails CLOSED on tenant-isolation erosion (the held-out `tenant-filter-erosion` invariant was promoted warn → block) and the Veo video-clip duration clamp was aligned to the documented 1–10s provider limit; 1 HIGH triaged as accepted design (the Gmail-direct admin OAuth routes are PIN-only by design) + 3 findings deferred to the known-gaps ledger. R125+13.24 — SIA held-out eval gate: a deterministic, LLM-free invariant check that runs after the typecheck gate on every self-improvement auto-apply, catching diffs that pass tsc by eroding what actually verifies. R125+13.23 — jury fix-direction concordance guard: when proposers agree on the verdict label but diverge on the actual fix, the fix no longer auto-queues. R125+13.21 — Security hardening post-edit code review closed 5 findings (4 MEDIUM + 1 LOW; 1 HIGH FALSE POSITIVE): the child-process env guard now prefix-strips the entire LD_/DYLD_ dynamic-linker namespace (was an enumerated denylist), skill-learning excerpts are sanitized before reaching the skill-promotion LLM, failure-lesson dedup is namespace-aware, and early-commitment plan-narrowing preserves explicitly-requested deliverable executors. R125+13.20 — Claude Opus 4.8 wired as the new flagship across the orchestration stack (model registry, MoA aggregator, CEO orchestrator, auto-router), Opus 4.7 retained as fallback, plus a reusable flagship-regression-gate canary. R125+13.19+sec1 — Portable security patterns from ruvnet/ruflo: sanitizeSpawnEnv() (loader-hijack denylist with mixed-runtime coverage for Perl/Python/Ruby/Lua/Bun/Deno) wired into every remaining child-process spawn site; vibevoice audio_url moved to ssrf-safe fetch; NODE_PATH removed from gate_command env-allowlist; revertProposal hardened from raw exec() to spawnSync(); 3-gate untrusted-content pattern codified in security-hardening skill. R125+13.18+sec — ensemble_query deliberation-quality layer ported from Council-of-High-Intelligence (3 opt-in knobs: restate_gate + dissent_quota + polarity-pair roster running Munger/Taleb/Kahneman/Meadows reasoning-tradition prompts); +sec triple-architect pass closed 4 real fixes (POLARITY_SAFETY_INVARIANT preamble, centroid-based consensus selection, polarity+dissent cost guardrail, defensive 1600-char consensus cap), 5 false-positives logged, 13 deferred with rationale; MoA observed κ=0.884 + κ=0.799 in prod post-fix. R125+13.17+sec — Orchestrator token-burn layer (Early Commitment classifier + LOOP plan-replay cache vector-HNSW); +sec closed 4 (skillify prompt-injection sanitize, auto-skillify destructive-tool gate, plan-replay cache versioning hash, gmail-direct source-leak). Earlier R125+13.12+sec — Whole-app + 72h post-edit code review closed 2 MEDIUMs in-round: Archive Rescue free-demo race condition (dedup+OCR-cap+INSERT now atomic under pg_advisory_xact_lock(42) in single db.transaction) + Monid monid_discover/monid_inspect reclassified safe/LOW → sensitive/MEDIUM in destructive-tool-policy. R125+13.12 — Creator Sponsor Ops wedge wired CONCIERGE-MODE (project #239, 3 crons) + Monid catalog 124→166 endpoints + 5-system wedge-wiring backfill. R125+13.11 — Archive Rescue wedge sellable end-to-end (public /archive-rescue + admin queue + 3 live Stripe products $99/$299/$999+$49mo + new table archive_rescue_orders). R125+13.10 — Inbox-ingest auto-cron wired + 6th classifier kind money_opportunity. Earlier: R125+4+sec — closed Monid {fenced,raw} antipattern HIGH (4 tool handlers in server/tools.ts) + CI healer huskyauto@gmail.com fallback MEDIUM + NEW regression gate tests/security/external-content-fenced-raw-antipattern.test.ts (static-source scan, mutation-test verified). R125+4 — NEW legitimate academic research toolset (academic_search META + arxiv_search + pubmed_search + openalex_search + crossref_lookup; FREE public APIs no auth keys; every payload defused via wrapExternalContent; NEW `research` tool category; ACTIVE wiring to Radar/Neptune/Cassandra/Luna). R125+3.9 — NEW recall_capabilities (semantic-rank capability search via hybrid BM25+vector across the 113-capability registry). Prior R121 imports 4 engineering-discipline skills from Matt Pocock's MIT-licensed public Claude skills repo, diff-merged with VisionClaw conventions: tdd (strict RED-first red-green-refactor with sensitive-surface invariant table mapping AHB / TOOL_POLICIES / tenant-RLS / CSRF / Drive admin-marker to MANDATORY pre-implementation invariant tests), cross-session-handoff (distinct from intra-turn session_plan.md; produces .local/handoffs/YYYY-MM-DD-topic.md for tomorrow-Bob or task-agents in isolated environments, gitignored, redact-secrets rule), zoom-out (pre-edit orientation primitive — architect/post-edit-code-review only run AFTER edits, zoom-out runs BEFORE — produces module map + callers map in VisionClaw domain vocabulary), write-a-skill (diff-merge with platform's read-only skill-authoring; adopts Matt's description-is-what-future-agent-sees framing + scripts criteria, layers VisionClaw R-N import-attribution + sensitive-surface flag table). NEW docs/future-integration-bookmarks.md living index of external repos worth remembering. 6 mattpocock skills deliberately NOT adopted (to-issues/to-prd/triage GitHub-issue-oriented vs. our project_tasks; git-guardrails-claude-code already covered by Auto Git Push; scaffold-exercises/migrate-to-shoehorn Matt-specific). Prior R116 — rohitg00/agentmemory Tier-A bundle (five nuggets in one round). N2 per-category Ebbinghaus decay (memory_entries.last_reinforced_at + memory_categories.half_life_days; ranker decays facts at per-category rates — architecture decisions 90d, transient bugs 3d). N6 active contradiction resolver scoring authority+recency+support×confidence, hooked into MoA κ-low escalation as fail-OPEN belt-and-suspenders. N7 heuristic quality_score gate grading every queue-routed memory write 0..1 on structural signals; folded multiplicatively into the ranker. N9 MCP memory scope: 4 NEW MCP tools (`memory_smart_search` / `memory_save` / `memory_supersede` / `memory_list_recent`) + 2 NEW scopes (`memory:read` / `memory:write`), all fail-CLOSED on missing scope. N14 typed edge taxonomy on memory_links (link_type ∈ {uses, depends_on, contradicts, caused, fixed, supersedes, related}, DB CHECK constraint + coerceLinkType guard). Schema deltas via psql ALTER: tables 174→176, indexes 454→507. Architect round 1 caught a memory_supersede orphan bug → fixed same round; round 2 (cross-app sweep) found 2 MEDIUMs + 1 LOW, all closed: memoryEntrySafeCols projection now includes lastReinforcedAt + qualityScore (M1 fix), MoA resolver inert-here-useful-elsewhere documented (M2 ack), getLinkedMemories now tenant-parameterized REQUIRED (L1 fix). verify-agent-wiring CLEAN. 26/26 tests PASS. R115.5+sec round 3 (\"Fix All Issues, Defer Nothing\") closed three defense-in-depth gaps: TOOL_POLICIES full backfill (every one of 384 tools has explicit policy row, 8 destructive hardened to require BOTH approval+trusted), storage tenant-scope required, /deliverables explicit allowlist. R113.7+sec — MCP-server expose (NEW `POST /mcp` Streamable HTTP endpoint with stateless per-request transport + per-request `McpServer` instance + cleanup on `res.close`, plus unauthenticated `GET /mcp/health`). NEW table `mcp_api_keys` (tenantId notNull, key_prefix unique idx, sha256 key_hash, scopes `text[]`; tables 170→171, indexes 447→449). Key format `mcp_<8-char-prefix>_<32-char-secret>` (base64url, 240-bit entropy), sha256-hashed at rest, constant-time compare via `timingSafeEqual`, plaintext shown EXACTLY ONCE on create. Curated 8-tool MCP surface (NO money-movement, NO mass-comms): `schedule_cross_platform_post`, `cancel_scheduled_post`, `list_scheduled_posts`, `get_scheduled_post`, `list_personas`, `lookup_output_skill`, `list_output_skills`, `get_platform_info` — all re-use existing internal tool implementations (no new TOOL_REGISTRY entries). NEW `/mcp-keys` UI page wired into sidebar. **In-round architect fixes (the `+sec` suffix)**: (HIGH-1) scopes were stored but NEVER enforced — defined `MCP_SCOPES` registry (`scheduler:write`, `scheduler:read`, `catalog:read`, `*` wildcard) + `TOOL_SCOPE_REQUIREMENTS` mapping; every tool handler in `buildMcpServer()` now opens with `if(!hasScope(...)) return denyForScope(...)` (fail-CLOSED for empty/null scopes; read-scope does NOT cover write-scope); POST `/api/mcp-keys` validates scopes against registry (unknown→400) and defaults empty input to `[\"catalog:read\"]` (never destructive); UI surfaces explicit scope checkboxes with destructive flag on `scheduler:write`. (MED-2) `/api/mcp-keys` CRUD accepted `Bearer vc_*` API-key auth — a leaked vc_ key could mint unlimited MCP keys → new `requireSessionAuth()` helper on all 3 CRUD routes rejects `Bearer vc_*` with explicit 403 + still requires session cookie / Replit OIDC. 31-test suite (22 first cut + 9 scope-enforcement + vc_-rejection invariants), all passing. R113.6 — Facebook Page publisher + YouTube video-bridge wired natively (NO third-party relay). NEW column `scheduled_posts.video_url`. `publishToFacebook` (Graph v18 `/me/accounts` → page access_token → `/{pageId}/feed` for text or `/{pageId}/photos` for image+caption; warns + records selected page in metadata when Bob manages multiple Pages). `publishToYouTube` (https-only `videoUrl` OR `driveFileId`; 256MB cap; reuses proven resumable-upload pattern). **In-round HIGH closed**: `publishToYouTube` SSRF/memory-exhaustion — `arrayBuffer()` was buffering the entire response BEFORE the 256MB check → replaced with upfront `Content-Length` check + streaming `getReader()` loop with running byte counter + `AbortController` cancel on cap-exceed. 42-test suite, all passing. R113.5 — Self-hosted multi-platform social-post scheduler (foundation; NO third-party relay). NEW table `scheduled_posts` (tenantId notNull, platforms text[], status check pending|publishing|sent|partial|failed|cancelled, locked_at/locked_by, next_attempt_at, jsonb per_platform_results, +2 indexes incl. partial `idx_scheduled_posts_due`). NEW `server/lib/scheduled-post-runner.ts` — atomic CTE `FOR UPDATE SKIP LOCKED` poll + flip to `publishing` (no double-publish across heartbeat ticks), per-platform idempotent retry (skip already-succeeded platforms on attempt N+1), partial-success = terminal (no retry), exponential backoff 60s→1h cap, bounded `max_attempts=3`. Three NEW tools (tools 344→347): `schedule_cross_platform_post` (destructive HIGH, requiresApproval), `cancel_scheduled_post` (sensitive MEDIUM), `list_scheduled_posts` (safe LOW) — all in `TOOL_POLICIES`. API routes `/api/scheduled-posts` GET/POST/DELETE behind `authMiddleware`, tenantId pulled from session (never body). NEW `/social-calendar` UI page. Personas 2/4/11 (Felix/Teagan/Apollo) wired with `intentGate=moderate` + AHB safety_profile. R113.4+sec — Tool Selection Discipline System: three-layer belt+suspenders forces every agent to consider the best tool BEFORE acting across the 347-tool inventory. LAYER 1 Top-Picks Header (passive, always-on; semanticRank + per-tenant performance, top 5 per turn, ~250 tokens). LAYER 2 NEW `recommend_best_tool` tool (gated, active; <50ms embedding lookup; MANDATORY before 3+ step plans / paid APIs / irreversible writes / customer-facing deliverables). LAYER 3 post-call validator (reactive, automatic; embedding-only re-rank after FIRST tool call; fires `★ TOOL SELECTION HINT ★` once per session if gap ≥0.08 cosine). Tools 340→342, governance 40→41 (+1 Tool Selection Discipline System). R112.17 — Tier 1 web-access bot-wall bypass via Apify `header-generator` nugget (Bayesian-network-trained realistic browser headers behind env flag, default ON, three-layer fail-safe, defense-in-depth SSRF + prompt-injection preserved). R112.16 +sec — Architect re-review of the same-day R112.16 patch closed 1 HIGH + 1 MEDIUM in-round. HIGH: rescue script (`scripts/resend-delivery-email.ts`) SELECT omitted the `metadata` column while the tenant resolver read `row.metadata.tenantId` — every rescue silently fell back to hardcoded tenant 8, masking a cross-tenant signing footgun. Fix: SELECT now includes `metadata`; tenant resolution requires explicit `TENANT_ID` env OR `metadata.tenantId`; falling back to owner-tenant 8 now requires explicit `ALLOW_DEFAULT_OWNER=1`; new `DRY_RUN=1` mode prints the four-link body without sending or DB-writing. MEDIUM: `start_video_job` tool dispatch forwarded the new R112.16 flags correctly but the tool schema didn't expose them — planner-discoverability hole. Fix: schema now declares `autoFinalize`/`autoDeliver`/`customerName`/`customerEmail` with R112.16-tagged descriptions; tool description re-marked LEGACY with explicit \"prefer `build_video_from_brief`\" guidance. R112.16 — Closed the R112 legacy-path delivery gap that bit Bob the same afternoon. Felix shipped a BWB video that finalized correctly but bypassed `deliverDigitalProduct()` — no `delivery_logs` row, no `/uploads/` streaming file, no email. Root cause: R112's `build_video_from_brief` sets `autoFinalize`/`autoDeliver` on the spec, but the *legacy* `start_video_job` tool dispatch handler never forwarded those flags. Fix: `case \"start_video_job\"` now explicitly extracts the four flags (with `emailTo` fallback) and forwards them; extended `StartVideoJobInput` + `VideoJobState.spec` types so the R112 one-shot delivery guard is compiler-enforced. NEW `scripts/resend-delivery-email.ts` one-shot rescue — reads any `delivery_logs` row that shipped without email, generates a 60-day signed streaming URL, composes a four-link HTML+text body, fires `sendEmail`, marks `email_sent=true`. Used to recover delivery #127. R112 — NEW `build_video_from_brief` (tools 339→342): ONE call replaces Felix's 6-step video orchestration. Plans chapters+scenes via runLlmTask (gemini-2.5-flash, JSON-strict), fires `startVideoJob` with `autoFinalize: true` + `autoDeliver: !!customerEmail`, returns `{job_id, watch_progress_url, total_chapters, total_scenes, plan_summary, estimated_duration_sec}` immediately. Runner end-of-loop auto-finalizes + auto-delivers (streaming URL + email). Legacy `produce_video`, `mpeg_produce`, `mpeg_produce_parallel`, `start_video_job`, `check_video_job`, `finalize_video` re-marked LEGACY in Felix's `tools_doc` with explicit \"do NOT use for new requests\" guidance. R110.15 — Whole-app architect sweep (PASS WITH NITS) on R110.7→R110.14 72h diff + sensitive surfaces (multi-tenant isolation, AHB safety, SSRF, prompt injection, file delivery, silent-failure hunt). 1 MEDIUM closed same-round: minds-engine confidence parser (`parseFloat() || 0.5` swallowed both NaN and a legitimate 0 — verifier disagreement collapsed to 0.5 silently; replaced with explicit `Number.isFinite()` gate + loud warn). R110.14 budget-cap hardened with explicit tenantId guard (a misconfigured caller can no longer silently bypass the circuit breaker via `WHERE tenant_id = NULL`). NEW `scripts/replit-md-compact.ts` — idempotent threshold-based auto-compactor for replit.md; keeps the 8 newest \"Recent rounds\" one-liners, moves older entries to `docs/release-log-archive.md` as stub prose entries, atomic writes both files; wired into the Auto Git Push cycle BEFORE staging — fail-OPEN, no-op when under threshold; solves the recurring \"replit.md is getting large\" nag without manual intervention. R110.14 — Two final Barry Zhang nuggets: per-loop USD budget cap (new optional `maxLoopUsdBudget` snapshot per turn, loud abort with `abortedReason: \"budget_cap\"` when exceeded; recommended Felix BWB pipeline $3.00, generic supervisor $1.00, heartbeat $0.50) + trajectory-based golden-path eval (new optional `expected_tools_subset` + `forbidden_tools` validates the actual tool sequence against `agent_trace_spans`; warn-only for week 1, promotes to hard-fail after warm-up). R110.13 — Barry Zhang Anthropic \"Building Effective Agents\" seminar audit; 5 actionable gaps closed: wall-clock circuit breaker (default 10 min), consecutive-failure circuit breaker (default 3 — only TRUE handler success resets), tool-design hygiene linter (description under 30 chars + non-object schema; 0 violations on 384 tools), per-persona tool sprawl audit (warn over 30), NEW `scripts/agent-perspective.ts` trace-tree printer with `--upto` mental-drill mode. R110.12 — IJFW nuggets imported (gitlab.com/therealseandonahoe/ijfw): NEW skill `critique` (#24, structured Steelman→Counter-args stress-test), NEW preflight `scripts/preflight-stale-strings.ts` (catches stale tool/table/skill counts before deploy), weekly-maintenance Pass 9 (memory/rule pruning), 3 workflow rules (2-failed-corrections-stop, AskUserQuestion Score Rule, session_plan format/lifecycle). R110.11.5 +sec — 72h thorough architect sweep across R110.7→R110.11.4 + sensitive surfaces (auth, tenant isolation, AHB safety, secret/SSRF/HITL, signed URLs, tool registry, public mirror sanitizer, rate limiters, OAuth, webhooks). Two-prong main + silent-failure-hunter prongs caught 4 findings (2 MEDIUM + 1 LOW main + 2 MEDIUM SFH) all closed in same round per architect-finding-triage rules: /healthz/deep freshness math fix (probeNow inside inflight, cache stamped at completion), /healthz/deep strict catch shape, mpeg-engine probeAudioStreamDuration returns null not 0 on non-finite parse (canonical R110.10 bug-class sibling site finally cleaned), golden-path-replay distinguishes ENOENT from corrupt JSON (exit 2 refuses overwrite). Bonus: monid-catalog-survey MONID_MAX_QUERIES guard so paid Monid spend can't quietly balloon. R110.11.4 — CodeFlow Card on public mirror only (pinned to commit SHA, contents:write only, paths-ignore breaks self-trigger loop, monthly cron). R110.11.3 — split liveness/readiness probe with new unauthenticated /healthz/deep (info-leak-stripped, 5s response cache + 60s staleness + in-flight Promise coalescing) for external monitors. R110.11.2 — model registry auto-add overlay; MODEL_AUTOADD_WATCHLIST will auto-promote Baidu ERNIE 5.x the instant it lands on OpenRouter; atomic write-to-tmp+rename with corrupt-overlay ABORTS (never silent-overwrites). R110.11.1 — TS gate green-up. R110.11 +sec — rate-limit gate fail-CLOSED for expensive tools with 40-tool hardcoded backstop, 2 more probeDuration sibling sites THROWS, brand_voice_drift logic flip, video-job-runner readJobState distinguishes ENOENT vs corrupt JSON. R110.7-R110.10 — Felix YouTube pipeline survives broken container libdrm via probeDurationStrict THROWS with stderr capture, file-size TTS fallback, ffmpeg/ffprobe preflight fails CLOSED with container_environment_corrupted envelope; probeAudioStreamDuration returns null on non-finite parse. R110.3-R110.6 — Fish Audio promoted to PRIMARY TTS with multi-tier cascade Fish → OpenAI → Edge; generate_audio rate limit 2/10/30 → 60/600/2000; create_slideshow_video 1/5/15 → 10/60/200. R110.9 — NEW silent-failure-hunter skill wired as focused second-pass after main architect; Felix anti-fraud rules (6 non-negotiable prompt rules). R110.1 +sec Gold-Review Hardening — 4 HIGH + 3 MEDIUM architect findings closed across 3 passes (verified CLEAN at pass 6). Upload secret-scan now FAIL-CLOSED with 503 UPLOAD_SECRET_SCAN_UNAVAILABLE on any extract/scan-infra throw (was fail-OPEN, malformed-PDF bypass). Delivery-pipeline scanner-throw synthesizes SCANNER_UNAVAILABLE high-severity blocking hit (was log-and-continue scanner-DOS bypass). html-app-builder + deliverable-grader jsdom switched to runScripts:undefined — LLM-authored JavaScript no longer executes server-side (was RCE sink via prompt injection). tools.isUrlSafe + pdf-tool.isUrlSafe rewritten async with full DNS re-validation; literal IPs (v4 + v6) routed through canonical isPrivateIp covering ::1, fc00::/7 ULA, fe80::/10 link-local, 100.64/10 CGNAT, 224/4 multicast, IPv4-mapped IPv6 in BOTH dotted AND Node-canonical hex form (::ffff:7f00:1); fail-CLOSED on DNS failure (was hostname-only attacker-DNS-to-169.254.169.254 bypass). tools.write_file pre-Drive secret scan with BLOCK reason propagated to upload_error / upload_blocked_reason / message. Pinned by new tests/security/ssrf-ip-mapped.test.ts — 11 cases, all green via npx tsx --test. R110 +sec Pre-Delivery Secret Scan — 48-pattern credential-regex catalog (AWS/GCP/GitHub/Stripe live/Anthropic/OpenAI/ElevenLabs/Slack/SendGrid/Twilio/Discord/Telegram/all PEM private-key armor/JWT/Basic-Auth URLs/generic api_key) wired as fail-CLOSED structural gate in delivery-pipeline + customer-upload validator; CRITICAL/HIGH aborts upload + alerts owner; agent-callable scan_for_secrets (1 new tool, 1 new capability) lets all 16 personas fix leaks before they trip the gate. R109.4 +sec hardening + stat-drift sweep — Dockerfile data/ allowlist closes a HIGH (PII + customer-artifact image-embed risk) by replacing broad data/ COPY with an explicit 6-asset allowlist + writable-dir ownership setup; model-freshness exempt-set slug fix silences 2 stale weekly-maintenance RED warnings; README + docs stat refresh; 3-pass architect (Pass 1: 3 MED + 1 LOW; Pass 2: 1 NEW HIGH from broad COPY; Pass 3: CLEAN). R109.3-fix self-healer no-op-heal gate (CI now routes 0-touched-files runs to notifyUnfixable instead of recording them as healed, breaking the false-heal infinite-loop). R109.2.3 Monid external-endpoint catalog integration with agent-UX clarity pass — discover-first thin HTTP wrapper around api.monid.ai/v1/* (browse → discover → inspect → run workflow), 4 new tools (monid_discover, monid_inspect, monid_run, monid_catalog_browse), 124-endpoint catalog harvested via 64-query VCA-domain fan-out and curated to 52 high-fit endpoints across 9 categories, wired into PLATFORM_TOOLS_CONTRACT so all 16 personas discover-first BEFORE writing custom scrapers. R109.1/R109.2/R109.2.1 +sec architect hardening: prompt-injection fence on all monid output via wrapExternalContent; per-tool rate ceilings (monid_run 2/min·10/hr·50/day, discover 5/30/150, inspect 8/40/200) so a runaway tenant can't drain the org-shared key; cost ledger on every monid_run; SSRF guard on MONID_API_BASE env override; error-body trim 600 chars. R109.2.2 +fix corrected two pre-existing R109 wrapper bugs surfaced by live BWB test (splitId helper for {provider,endpoint} fields; queryParams/pathParams field-name mapping). R109.2.3 +agent-ux added monid_inspect 1:1 mapping doc, worked-example block in monid_run, and self-correcting auto-hint when upstream returns Missing required fields. R108.1 +sec fail-CLOSED hardening across rate-limit, usage-metering, and upload-validator chat-ingress gates. R108 adaptive per-node maxSteps budgets + causal evidence edges + cold-start hypothesis nudge. R107 regime-aware memory consolidation (geometry probe + memory_geometry_scan tool). R106 LuaN1aoAgent five-nugget reflexive operating primitives. R105 PageIndex hierarchical doc nav. R104 inbox quarantine + commitments. R102 admission control. R101 causality graphs. R100 transactional no-regression. R98.x Felix deliverable reliability + Camofox stealth browser + AHB defense layer. Start free — no credit card."}
        ogTitle={`${pn} — Your Autonomous AI Corporation`}
        ogDescription="An AI team that researches, writes, builds, and delivers. 16 specialist agents, 407 tools, 129 capabilities, 222 database tables, 642 indexes, 43 + 62 + 38 skills (143 reference surfaces), 41 governance rules. Latest R125+137.76+sec — the sell-and-fulfill loop closes (commerce_products catalog + 3 owner-only commerce tools; tools 404 → 407) and the $497 self-serve AI Readiness Audit auto-fulfills on Stripe payment; Revenue Missions gains retrospective scoring, a fail-closed pre-spawn budget gate and a $0 opportunity scanner (guards 60 → 81); security ships a tenant-isolation audit burn-down (17 REAL fixes / 82 verified false positives) plus a 72h whole-app review closing 1 HIGH + 3 MEDIUMs. Prior R125+137.72 — the Revenue Missions engine ships: autonomous revenue experimentation with owner gates, hard dollar caps ($25/experiment) and Stripe-verified evidence (5 new owner-only tools, tools 399 → 404; 3 new tables, 218 → 221; deterministic stage machine, HARD_CAPS clamp, fail-closed spend + Stripe evidence gates, autonomy ladder, max-3-concurrent cap; approve/kill HITL-only). Security: the .71 HIGH + .72 follow-up put mission & cost-ledger owner-only tools on the env-configurable ownerTenantId() single source of truth with regression tests. Prior R125+137.59 → +137.65+sec — the platform starts learning from its own tool choices and opens an agent-to-agent front door: five external-review recommendations land (condition-based wakes, episode playbooks, outcome-learned persona routing, inbound A2A task acceptance via JSON-RPC 2.0, an Autonomy Scoreboard), a tool mis-pick telemetry ledger goes live, the tool-recall doctrine makes every persona re-scan its full inventory before saying it cannot, a production maintenance-cron incident is fixed at the root, and three 72h security review rounds close five MEDIUM tenant-isolation findings — round 4 verified the sensitive core clean and made the autonomous wake scheduler fail closed on any unverified workspace. Prior R125+137.45 → +137.50 — Proactive Commitment Drafting (approaching-deadline commitments drafted unprompted into human-approval cards; the drafter is structurally incapable of sending anything itself), a CRITICAL credential-file leak closed with a boot-time purge of prior deploy residue, all 10 maintenance crons prebundled so production can never lose them, a 10-file god-file cleanup with ceilings locked down, and an IdeaBrowser MASTER sweep that simulated the top 12 of 256 scored business ideas. Prior R125+137.30 → +137.40 — the Simulation Sandbox contract completes S1–S5: offline what-if replay of past safety decisions and model swaps under a shared per-run $5 hard cap (claim-before-spend), new sandbox_run/sandbox_report tools registered fail-closed + trusted-personas-only (tools 396 → 399, tables 213 → 215), a /admin/sandbox UI with admin-gated launch API, and Sandbox probe #16 on the ecosystem-health dashboard — E2E smoke replayed 5/5 live safety decisions with NO_CHANGE. Also in the window: a metered escalation valve for the repo-surgeon (one frontier diagnostic turn on a prior-collapse stall, fail-OPEN), two standing-registry model registrations (meta/muse-spark-1.1 + nvidia/nemotron-3-ultra-550b :free), a self-healing incident-proof BWB weekly recap (explicit date-window + labeled weight-fact extraction cure the wrong-week and wrong-numbers incidents), and a Tool Reliability card on the ecosystem-health dashboard. Earlier R125+137.23 → +137.25-review — the Tool Eviction/Retirement loop + Tool Forge Phase 2 land as weekly crons, the tool-router gains a hard cap (enforceToolCap), an AG-UI protocol adapter opens the public API v1 surface, the admin PIN hash is consolidated onto the canonical peppered hasher, and a 72h whole-app review closes 2 MEDIUMs. Earlier R125+137.20 → +137.22 — six OpenClaw-inspired native features land: a tenant-guarded, PII-redacted commitments/open-loop miner, a summary-quality audit + deterministic fallback wired as an identifier-recovery backstop at the compaction chokepoint, operator-text-as-untrusted wrapping, first-failure-wins health root-cause ordering, a skill code-safety scanner, and a record-only egress telemetry ring buffer. Plus Fable-method borrows — seeded-fraud completion fixtures proving the deterministic verification layer fails closed against a gullible judge (live probe caught 4/4 planted frauds) and a spec-vs-test authority rule in the repo-surgeon — and a Drive connector-lookup fix curing backup upload failures. A follow-up 72h post-edit review added Zod validation to the public checkout and profile routes and logged 1 FALSE POSITIVE. Earlier R125+137.14 → +137.19 — RULER-style group ranking (measure-first third judge lane) + prior-collapse detection (never re-propose an already-rejected change) in the self-improvement loop, two behavior-preserving god-file splits, Tool Forge Phase 1 unmet-capability telemetry with a new health card, and a 72h review closing 1 MEDIUM fail-CLOSED (tenant-validated capability-gap writes) + 4 silent-failure fixes with no CRITICAL/HIGH findings. Earlier R125+137.3 — a full-platform post-edit review closed 1 CRITICAL fail-CLOSED: the transactional rollback safety net's restore write was missing its tenant scope and is now tenant-bound (architect-verified); plus 1 MEDIUM — the default flagship model was absent from all 3 pricing maps and is now correctly priced everywhere with a permanent presence test. Earlier in the window: a model-pricing drift guard + live-rate reconciliation, PROOF_LOOPS v2 (proof-level L1–L5 + Chronicle-precision telemetry), a full wiring review regenerating the tool catalog 396/396, and Grok 4.5 wired in additively. Earlier R125+133 — a post-edit code-review sweep closed 2 HIGH + 3 MEDIUM fail-CLOSED: the trust-reviewer's auto-approve lane now blocks reserved knowledge categories outright, and an architect-caught gap where a 'reverted' unvalidated LLM-generated tool stayed active is closed — every revert path now deletes the row and unvalidatable tools fail CLOSED. Earlier R125+132 — a domain-boundary CI gate, coverage reporting, a fail-closed Prometheus /metrics endpoint, a lite deploy profile, and Mermaid architecture diagrams. Earlier R125+131 — GPT-5.6 Sol promoted to OpenAI flagship across ~28 files with the $0 cost-safety lane intact. Earlier R125+130 — a post-edit security sweep closed 1 HIGH fail-CLOSED: a cross-tenant SMS/WhatsApp pairing hijack is now blocked at the storage chokepoint (reserved knowledge categories throw on create AND update), plus 3 MEDIUM PII-redaction / tenant-guard fixes and a new 8-assertion CI guard. Earlier R125+129 — a new portable Evidence Docket (generate_evidence_docket, tools 395 → 396) bundles goal contracts, verification verdicts, jury concordance, safety-audit rows, and the delivery record into one reviewer-facing artifact, tenant-scoped with secret/PII scrubbing throughout. Earlier R125+128 — the browser-tool SSRF TOCTOU closed: request interception re-validates every navigation (goto, redirect hops, client-side navs), failing CLOSED on guard error. Earlier R125+127 — a whole-app security review closed 2 HIGH (cross-tenant uploads read/enumeration; agent-knowledge PII-redaction bypass across 8 raw INSERT sites) plus Twilio webhook replay dedupe. Earlier R125+76 — a whole-app post-edit code review closed 2 MEDIUM + 2 LOW fail-CLOSED: an undeterminable MIME on a MIME-gated deliverable contract is now a verification FAILURE (was a silent PASS), the verifier result carries an `auditPersisted` boolean so a swallowed audit-log write is visible, the PII-redaction guard honors its declared string contract on non-string input, and a stale exploration-bonus default-comment was corrected; +4 dedicated regression tests, architect confirming PASS. Earlier R125+75 — a whole-app + 72h post-edit code review (agent-wiring audit exit 0, 394 tools, 0 dead/drift/leak/schema-gap) closed 3 pre-existing MEDIUMs fail-CLOSED in the tenant-isolation + silent-failure surface: the guarded-tool executor sources the execution tenant ONLY from the trusted ctx (no model-authored `_tenantId` fallback), both event-bus `event_log` status writes are tenant-scoped, and heartbeat's failed-event update logs loud and is tenant-scoped. Earlier R125+74 — a whole-app + 72h post-edit code review (architect PASS, wiring audit exit 0) closed 1 MEDIUM: untrusted text quoted into the new R125+73 terminal-failure report could still inject inline markdown, now neutralized by a new `mdEscape()` in `server/agentic/failure-contract.ts`; the same round fixed the owner-jury metered daily-ceiling concurrency overshoot in `server/moa.ts` (reserve-then-settle). Earlier R125+73 — a structured failure contract renderer emits a consistent what-completed / what-failed / what-exists / next-step block on every terminal-failure exit without auto-routing around a rejected approval (architect PASS twice). Earlier R125+72 — closed the #1 open threat-model gap: a new central guard redacts credential-shaped secrets, Luhn-validated credit cards, and US SSNs on every durable-store write (memory, knowledge, conversation-fact) so the model can never persist credentials pulled from untrusted ingest; 1 HIGH + 2 MEDIUM closed fail-closed, architect PASS. Earlier R125+60 → +61 — a platform-security hardening sprint closing 3 HIGH (a plan/lobster step-executor tenant+persona escalation that let a non-admin tenant run owner-only tools via a plan step, an SSRF DNS-rebind TOCTOU pinned at 4 more public-fetch callsites, and a `vc_` API-key admin confusion; architect PASS, 0 new CRITICAL/HIGH, +2 auth regression tests). Earlier R125+53 — a new Actor-Critic Reflection step in the supervisor loop (a stuck retry loop now gets an independent second LLM's diagnosis + targeted retry guidance instead of blindly halting or upgrading; fails OPEN), shipped behind a whole-app + 72h review (architect PASS, 0 CRITICAL/HIGH) closing 2 MEDIUM. Earlier R125+52.47+sec — a third whole-app + 72h code review (architect PASS, agent-wiring audit CLEAN — 393 tools, 0 dead/drift/leak) closed 4 findings: a cost-cap backstop for the two most expensive autonomous tools, a tenant-scoped fail-closed projects lookup, a fail-soft Token Efficiency probe import, and a founder-quote tool-count fix. R125+52.44 → +52.46 — a new Token Efficiency telemetry card plus two whole-app reviews closing 2 HIGH + 2 MEDIUM. Earlier R125+52.43+sec — the nightly Tenant-Isolation audit now windows oversized files so every file is fully audited (62 findings triaged → 8 genuine cross-tenant defects closed; architect PASS). R125+52.41 → +52.42 — a new `second_opinion` agent cross-check tool (all 16 personas) that auto-fires an independent multi-model verdict on a low-confidence answer before escalating to a human, behind an overshoot-proof $25/day owner-only Fusion cost cap (worst-case reservation clamp + fail-closed cost-drift latch + dynamic reserve floor; architect PASS, +11 guard tests). R125+52.31 → +52.39 — a nine-round security + reliability hardening sprint: a new Harness Health card, the new `ponytail` skill, a budget-adaptive strategy controller, degraded-telemetry observability + cross-tenant self-heal scoping, a model-distinct completion-evaluator, the SSRF DNS-rebinding TOCTOU closed via socket-pinning, a MoA proposer fail-open, and three whole-app + 72h code reviews (architect PASS). R125+52.23 — NEW honest tool-output compression-savings card (new tool_compression_stats table records real bill-impact vs the old head-slice baseline, surfaced on /admin/ecosystem-health; +1 table, +1 index). R125+52.19 → +52.22 — NEW live Instant AI Readiness Audit at /audit (public POST /api/public/audit/run scores any website /100 → grade A–F, persisted to audit_reports), hardened against a DNS-rebinding/SSRF TOCTOU (validated resolved IPs pinned via undici connect.lookup, re-pinned every redirect hop) plus a whole-project review that closed 3 cross-tenant read leaks (chat-engine workspace context + self-improvement experiments now tenant-scoped, fail-closed). R125+52.16+sec — default model → Claude Opus 4 plus a whole-app + 72h security review closing 1 HIGH + 2 MEDIUM (shell deny-floor quoted-root bypass; boundary-safe workspace containment; tenant-scoped conversation archive). R125+52.6 → +52.15 — jury-queue replay/race proofing + browser SSRF revalidation. R125+52.5 — whole-app + 72h thorough review (3 architect passes + wiring audit exit 0): 0 new actionable findings. R125+52.4 — NEW shadow-mode Jury Experience Library (Training-Free GRPO, arXiv:2510.08191) distilling jury-divergence lessons into a new jury_experiences table (fail-open, not yet injected). R125+50 — autonomous-spend governor: a hard daily cost ceiling (fail-CLOSED, owner-only) on every background loop; R125+51/+52 flat-rate OAuth model routing. R125+47 — NEW Delivery Funnel telemetry (produce → ship → adopt) via a delivery_engagement table + /uploads hook + a Delivery Funnel card. R125+46+sec — whole-app + 72h thorough review (3 architect passes + wiring audit CLEAN): no CRITICAL/HIGH, closed 3 MEDIUM. R125+46 — Multi-tenant config-forking in one atomic fail-closed transaction. Prior R125+31+sec2 — follow-up full-app + 72h post-edit review (4 architect passes + wiring audit GREEN): closed 1 MEDIUM (self-repair autofix HITL gate widened to the broad aggregator modules — monotonic, fail-safe). R125+31+sec — Full-app + 72h post-edit code review (5 architect passes + wiring audit GREEN + confirming re-pass): closed 1 HIGH (skill-build jury fail-closed restored — an errored juror's abstention no longer counts toward quorum) + 1 MEDIUM (streaming tool-call merge); loop-until-clean PASS. R125+30 — Full-app + 72h review: closed 2 HIGH (delivery-email signed-link corruption; skillify sanitizes LLM-distilled text before the global registry) + 1 MEDIUM (browser SSRF IPv6 parity). R125+29 — Full-app + 72h post-edit code review (4 architect passes + wiring audit GREEN): illusory-coverage fix (3 model-tier suites silently never ran, 64 assertions now run in CI) + 3 fail-closed hardenings. R125+28 — all skill-enable paths behind one jury gate, no human review queue. R125+27 — jury-gated autonomous skill build. R125+26 — ranking-driven model auto-adoption into the routable overlay. R125+25 — Full-app + 72h security review (4 architect passes; 0 CRITICAL / 3 HIGH / 2 MEDIUM; wiring audit GREEN): tool-block telemetry redactor now masks secret keys before truncation (no token-prefix leak into audit rows; +5-case test); 2 HIGH + 2 MEDIUM deferred as tracked dormant gaps. R125+24 — Agentic efficiency awareness (orchestration_efficiency predicted-vs-actual telemetry + advisory fail-open heavy-loop guard that never overrides an explicit jury/ensemble call + Orchestration Efficiency dashboard card; +1 table, +2 indexes). R125+23 — Full-app + 72h security review (4 architect passes; 0 CRITICAL / 3 HIGH / 6 MEDIUM; wiring audit GREEN): tenant-isolation INSERT guards wired, providers key-prefix log scrub, new idx_agent_knowledge_tenant_source index, stale-stat resync (.agents skills 32→31, indexes 552→553). R125+22 — Autonomous self-repair stack — the platform now repairs itself, with the owner in control (detect → classify into a repair_incidents ledger → guarded Repo Surgeon auto-fix OFF by default via REPAIR_AUTOFIX_ENABLED, or escalate to the owner; pipeline-checkpoint resume repairs only the failed step; owner incident ledger at GET /api/admin/repair-incidents; security rounds R125+19/+22 closed 10 MEDIUM, 0 HIGH/CRITICAL). R125+16 — Chief-of-Staff jury access (a per-tool extraAllowedPersonas allowlist grants jury_triage to the Chief of Staff without widening the global trust tier, closing the last trusted-tool wiring leak, leaks 1→0; all stats unchanged). R125+15 — TigrimOSR-inspired blackboard coordination on parallel_job_findings (keyed shared-state slots + atomic work-claims, built by extending the existing findings bus, +1 index, 0 new tools/tables). R125+14+sec2 — Security/correctness hardening (scrubbed video-ingest spawn env via sanitizeSpawnEnv, money-tool negative/non-finite amount guards, parameterized plan-executor stale-interval sweep, removed HTTP 500 internal-error-detail leaks) + new tool bwb_weekly_build (383 → 384, all other stats unchanged); verified tsc clean, AHB 47/47, held-out-eval-gate 14/14, wiring audit exit 0. R125+14 — Autonomous Corporate Operations: 12 new tools + 4 tables (OKR cadence, durable sleep/wake, departmental budgets, continuous replanning, A/B→Stripe→SOP loop, LLM-free Process Reward Model, scoped task-forces) + R125+14+sec1 security/correctness pass. R125+13.25 — Security hardening review (3 parallel architect passes) closed 1 HIGH + 1 LOW: self-improvement auto-apply now fails CLOSED on tenant-isolation erosion + Veo duration clamp aligned to 1–10s; 1 HIGH accepted-design (Gmail-direct admin OAuth PIN-only) + 3 deferred. R125+13.24 — SIA held-out eval gate (deterministic LLM-free invariant check after the tsc gate). R125+13.23 — jury fix-direction concordance guard. R125+13.21 — Security hardening post-edit review closed 5 findings (LD_/DYLD_ namespace prefix-strip, skill-learning sanitize, namespace-aware failure-dedup, deliverable-executor preservation; 1 HIGH FALSE POSITIVE). R125+13.20 — Claude Opus 4.8 new flagship (Opus 4.7 fallback) + flagship-regression-gate canary. R125+13.19+sec1 — Portable security patterns from ruvnet/ruflo: sanitizeSpawnEnv() loader-hijack denylist (Perl/Python/Ruby/Lua/Bun/Deno mixed-runtime coverage) wired into every remaining child-process spawn site; vibevoice audio_url moved to ssrf-safe fetch; NODE_PATH removed from gate_command env-allowlist; revertProposal hardened from raw exec to spawnSync; 3-gate untrusted-content pattern codified in security-hardening skill. R125+13.18+sec — ensemble_query deliberation-quality layer (Council-of-High-Intelligence port: restate_gate + dissent_quota + polarity pool with Munger/Taleb/Kahneman/Meadows reasoning traditions); triple-architect pass closed POLARITY_SAFETY_INVARIANT + centroid-consensus + cost-guardrail + defensive cap. R125+13.17+sec — Early Commitment + LOOP plan-replay token-burn optimizer + 4 +sec closures. Earlier R125+13.12+sec — Whole-app + 72h post-edit code review closed 2 MEDIUMs: Archive Rescue race condition (atomic txn under pg_advisory_xact_lock) + Monid monid_discover/monid_inspect reclassified sensitive/MEDIUM. R125+13.11 ships Archive Rescue wedge sellable end-to-end (public landing + admin queue + 3 Stripe products + new table archive_rescue_orders, tables 179→180). R125+13.12 wires Creator Sponsor Ops wedge CONCIERGE-MODE (project #239, 3 crons) + Monid catalog 124→166 endpoints. Earlier R125+4+sec — Closed 1 HIGH (Monid fence-bypass: 4 tool handlers in server/tools.ts had been returning BOTH the safety-wrapped fenced blob AND the unsanitized raw JSON, silently defeating wrapExternalContent's prompt-injection containment — fix removed raw: from all 4 sites; handlers now return only safe metadata + the fenced payload) + 1 MEDIUM (CI healer huskyauto@gmail.com hardcoded fallback that would leak to forks — replaced with 4-env-var chain + empty-email guards on both sendEmail sites). NEW regression gate tests/security/external-content-fenced-raw-antipattern.test.ts (static-source scan walks server/**/*.ts and fails CI if any tool handler returns both fenced: and raw:; mutation-test verified). R125+4 — NEW legitimate academic research toolset (5 new tools, all safe/LOW read-only public APIs, no auth keys): academic_search META fan-out + arxiv_search + pubmed_search + openalex_search + crossref_lookup. Every payload defused via wrapExternalContent. NEW `research` tool category. ACTIVE persona wiring: Radar (ACADEMIC FIRST in operating loop), Neptune (default first move), Cassandra (unit-economics evidence), Luna (law-review scholarship). R125+3.9 — NEW recall_capabilities tool (semantic-rank capability search via hybrid BM25+vector). R125+3.6+sec.1 — Public-mirror liability lockdown on the jury auto-apply seam: NEW env-var gate JURY_AUTOAPPLY (default OFF) makes forks advisory-only by default; private setup unchanged; public README disclaimer with AS-IS / no-warranty / responsible-disclosure path. R125+3.6+sec closed 4 architect findings (parser prompt-injection, zero-test-coverage, policy scope, doc drift) on the R125+3.6 jury surface; 22/22 jury-triage unit tests pass. R125+3.6 ships multi-model jury triage primitive + full wiring (issues CLI / architect skill / CI healer) — NEW jury_triage tool + NEW multi_model_jury_triage capability wrap executeMoA (deepseek-v4-pro + gpt-5.5 + gemini-3.1-pro-preview, aggregator claude-opus-4-7) with structured VERDICT/RATIONALE/FIX_PROPOSAL prompt, 2-of-3 majority, fail-safe-to-ESCALATE on ambiguity. R125+1.1 closes 1 MEDIUM (jobs.tsx javascript:-URL sink — shared safeUrl() allow-list extracted to NEW client/src/lib/safe-url.ts) and defers + logs 1 HIGH systemic (~42 direct uploadAndShare()/uploadToDrive() callsites bypass the R110 +sec secret-scan gate; pre-existing, single-user LOW blast radius today). R125+1 — OpenRouter ensemble_query proposer-pool A/B infrastructure (OPT-IN, no default flip): FRONTIER_PROPOSERS (unchanged 3-model), CHEAP_PROPOSERS (5 lineage-diverse OpenRouter cheap models — llama-4-maverick / ling-2.6-1t / mimo-v2-flash / gemma-4-31b / glm-4.7-flash), MIXED_PROPOSERS (3 + 3); MAX_PROPOSERS 5 → 8; telemetry via moa_responses.invoked_via `tool|pool=cheap`; NEW scripts/ensemble-query-ab.ts agent-runnable harness; 5 node:test units. R123 +sec closed HIGH post-edit-code-review on POST /api/memory/backup-to-drive (route refactored to deliverDigitalProduct() pipeline). R123 ships Unified Memory Context: single read surface across 11 memory-adjacent tables (memory_entries, agent_knowledge, conversation_facts, mind_tickets, procedure_edits, agent_runs, agent_trace_spans, graph_memory, knowledge_triples, mind_events, conversations) so 'where did I put that?' never has a dark corner — NEW server/memory/unified-context.ts aggregator + NEW HTTP GET /api/memory/unified + NEW agent tool get_unified_memory_context + NEW CLI scripts/memory-find.ts + NEW /memory 'Unified' tab. Prior R121 imports 4 engineering-discipline skills from Matt Pocock's MIT-licensed public Claude skills repo (tdd / cross-session-handoff / zoom-out / write-a-skill), VisionClaw-adapted with sensitive-surface invariant tables; skill count 24 → 28 .agents/ skills. Prior R113.4+sec — Output Skills Library: 25 on-demand structured-deliverable scaffolding templates across 8 departments (Product / Strategy / Communications / Sales / Marketing / Legal / HR / Operations) callable via the NEW `lookup_output_skill` tool (safe / LOW / requiresStructuredArgs; XOR contract); wired into 14 of 16 personas; 17 dispatcher tests pass; architect second pass: PASS. R113.3+sec closed 2 HIGH + 1 MEDIUM (ingest_paper filesystem-read jail, kill_switch SQL-injection sink hardened, paper-ingest race wrapped in pg_advisory_xact_lock). R112.18 — Tool Selection Discipline System (three-layer belt+suspenders forces every agent to consider the best tool BEFORE acting across the 347-tool inventory: Layer 1 Top-Picks Header passive always-on, Layer 2 NEW `recommend_best_tool` tool gated/active, Layer 3 post-call validator reactive/automatic). R112.17 — Tier 1 Web-Access Bot-Wall Bypass via Apify `header-generator` (Bayesian-network-trained realistic browser headers, default ON, three-layer fail-safe). R112.16 +sec — Architect re-review closed 1 HIGH (rescue-script cross-tenant signing footgun: explicit TENANT_ID or metadata.tenantId required, owner-8 fallback requires ALLOW_DEFAULT_OWNER=1, new DRY_RUN=1 mode) + 1 MEDIUM (start_video_job schema exposes the new R112.16 flags with LEGACY guidance to prefer build_video_from_brief). R112.16 — Closed the legacy-path delivery gap (start_video_job dispatch forwards autoFinalize/autoDeliver/customerName/customerEmail; compiler-enforced via extended types; NEW resend-delivery-email.ts rescue script with 60-day signed URLs + four-link body). R112 — NEW build_video_from_brief collapses Felix's 6-step video orchestration into ONE call (plan + finalize + deliver auto). R110.15 — Whole-app architect sweep (PASS WITH NITS); 1 MEDIUM closed same-round (minds-engine confidence parser silent-failure); R110.14 budget-cap hardened with explicit tenantId guard; NEW `scripts/replit-md-compact.ts` self-compacts replit.md every commit cycle. R110.14 — Per-loop USD budget cap + trajectory-based golden-path eval (warn-only week 1). R110.13 — Barry Zhang seminar audit; 5 gaps closed (wall-clock + consecutive-failure circuit breakers, tool-design hygiene linter, per-persona tool sprawl audit, NEW agent-perspective trace-tree printer). R110.12 — IJFW nuggets: NEW `critique` skill #24 + stale-string preflight gate + weekly-maintenance Pass 9 + 3 workflow rules. R110.11.5 +sec — 72h thorough architect sweep across R110.7→R110.11.4 + sensitive surfaces; 4 findings closed in same round (/healthz/deep freshness + strict catch shape, mpeg-engine probeAudio null contract, golden-path-replay corrupt-JSON exit-2) + monid spend-cap bonus. R110.11.4 CodeFlow Card on public mirror (pinned SHA). R110.11.3 split liveness/readiness /healthz/deep. R110.11.2 Baidu ERNIE 5.x auto-promote overlay. R110.7-R110.10 Felix YouTube pipeline survives broken container libdrm. R110.3-R110.6 Fish Audio PRIMARY TTS with multi-tier cascade. R110.9 NEW silent-failure-hunter skill + Felix anti-fraud rules. R110.1 +sec Gold-Review Hardening — 4 HIGH + 3 MEDIUM architect findings closed across 3 passes (verified CLEAN at pass 6): upload-scan FAIL-CLOSED, delivery-scanner-throw synthesizes blocking hit, jsdom RCE sink removed, full DNS-resolving SSRF with IPv4-mapped IPv6 hex-form coverage, write_file pre-Drive secret scan. Pinned by 11-case regression test. R110 +sec Pre-Delivery Secret Scan (48-pattern catalog, fail-CLOSED gate in delivery + ingest, agent-callable scan_for_secrets across all 16 personas). R109.4 +sec — Dockerfile data/ allowlist (closed HIGH PII/customer-artifact image-embed risk) + model-freshness slug fix + stat refresh. R109.2.3 Monid external-endpoint catalog integration with browse → discover → inspect → run workflow + agent-UX clarity pass + R109.1/.2/.2.1 +sec hardening (prompt-injection fence, per-tool rate ceilings, cost ledger, SSRF guard). 124 endpoints harvested, 52 curated across 9 categories. R108 adaptive plan-node maxSteps + causal evidence edges + cold-start hypothesis nudge. R107 regime-aware memory consolidation. Start free."
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
          <BusinessTransformationSection />
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
              Platform Online — 16 Agents, 407 Tools, 222 Tables, 642 Indexes, 129 Capabilities, 43 + 62 + 38 Skills (143 reference surfaces), 41 Governance Rules. R125+137.76+sec — sell-and-fulfill loop closes: a `commerce_products` catalog + 3 owner-only commerce tools (`product_listing_create`, `product_listing_list`, `create_payment_link`; tools 404 → 407) let the platform list and price its own products, and the $497 self-serve AI Readiness Audit auto-fulfills on Stripe payment with post-purchase sequence enrollment (round .74). Revenue Missions gap closures (.75): a `scoreMission` retrospective hook (0–100 + lessons/ROI on kill/scale), a fail-closed pre-spawn budget gate that refuses on explicit null spend, and a $0/no-LLM background opportunity scanner (proposal-only, Mon 14:00 UTC); guard tests 60 → 81. Security (.73+sec → .76+sec): a tenant-isolation audit burn-down triaged all 99 kept HIGH/CRITICAL findings across 5 parallel passes → 17 REAL fixes across 15 sites (fail-closed tenantId in storage/compaction/data-protection, ownership checks in revenue-missions/business-tools/agent-channels, scoped SELECTs, DEFAULT 1 removed from quarterly-intelligence + a live ALTER DROP DEFAULT) with 82 verified FALSE POSITIVE; then a 72h whole-app review (3 parallel architect passes) closed 1 HIGH (archive-rescue paid webhook hardcoded tenant_id=1 → ownerTenantId() SoT) + 3 MEDIUMs (data-protection softDelete tenant-scoped atomic UPDATE...RETURNING; compaction memory-extract routed through redactPiiForStorage; revenue-missions experiment cap race-proofed via per-tenant pg_advisory_xact_lock). Gates: tsc 0, suite 150/150, seamtests 69/69, guards 81/81. Prior R125+137.72 — Revenue Missions engine (rounds .66–.72): autonomous revenue experimentation with owner gates, hard dollar caps ($25/experiment), and Stripe-verified evidence. 5 new owner-only tools (mission_create, mission_list, mission_status, mission_draft_experiment, mission_portfolio_review; tools 399 → 404) + 3 new tables (revenue_missions, mission_experiments, mission_evidence; 218 → 221). A deterministic mission stage machine (kill-from-any-stage) with HARD_CAPS clamp (25 prospects / 3 contacts / $25 — rows can tighten, never raise), CAS race-safe capped outreach with fail-closed pre-send spend gate + mandatory opt-out line, a fail-closed Stripe evidence hook, an autonomy ladder (10% reinvestment / $250 cap) with capital allocator + portfolio review, an evidence-gated scoring rubric, and a max-3-concurrent-experiments cap enforced fail-closed above the draft INSERT; approve/kill are HITL-only, never tools. **Security (.71 HIGH + .72 follow-up):** the mission-tool ownerGate hardcoded tenant 1 diverged from the env-configurable ownerTenantId() single source of truth — now imports the SoT with 2 env-driven regression tests; the same fix applied to the 2 cost-ledger owner-only tools (revenue_vs_cost, agent_cost_summary). All other sensitive surfaces verified clean. Gates: tsc 0, suite 150/150, seamtests 69/69, guards 89. Earlier R125+137.65+sec — 72h full-app review round 4: the platform's most sensitive core (intent gate, tool policy, dispatcher, chat engine, auth, storage) comes back CLEAN across 3 parallel architect passes over 110 changed files; 1 MEDIUM fixed — the autonomous wake scheduler now fails CLOSED on an invalid tenant identity (positive-integer guard before any DB write, pinned by a 7-case regression test); 1 FALSE POSITIVE verified — /api/v1/a2a scope enforcement is central (authMiddleware → checkApiKeyScopes). Rounds 2–4 total: 5 MEDIUM tenant-isolation findings closed, 0 CRITICAL/HIGH. Gates: tsc 0, seamtests 69/69, suite 149/149, preflight-stale CLEAN, architect PASS. Earlier R125+137.59 → +137.64+sec — the platform starts learning from its own tool choices and opens an agent-to-agent front door: all five Kimi-K3 external-review recommendations land (condition-based wakes, step-level episode playbooks, outcome-learned persona routing bounded ±1 from measured success rates, inbound A2A task acceptance at POST /api/v1/a2a via JSON-RPC 2.0, and an Autonomy Scoreboard telemetry probe + admin card); a record-only tool mis-pick telemetry ledger goes live as ecosystem-health probe 18; the TOOL RECALL doctrine makes every persona re-scan the authoritative tool schema before ever saying "I can't", with ratchet-style per-persona sprawl thresholds in the wiring audit; a production maintenance-cron incident is root-fixed; and two 72h security review rounds (.61+sec, .64+sec) close four MEDIUM tenant-isolation findings. Gates: tsc 0, seamtests 69/69, suite 148/148, route census 685. Earlier R125+137.41 → +137.44 — the Simulation Sandbox learns to PROMOTE what it finds, safely: a new `sandbox_promote` tool (tools 398 → 399; trusted-personas-only, sensitive/HIGH changes fail closed) sends a completed sandbox run's findings to the 3-frontier-model jury and files the verdict into a durable Improvement list (`sandbox_improvements` table + admin review card on /admin/sandbox + GET/PATCH admin routes, route-census 681 → 683) — jury-vetted recommendations, NEVER auto-apply, and the pending row is INSERTed BEFORE jury triage so a jury failure still leaves a durable escalated record; sandbox runs gain TTL retention (weekly prod-only cron, improvements survive deletion via SET NULL). Also in the window: the IdeaBrowser weekly money-scenario pipeline (ingest 7 days of ideas → score → top-5 → per-idea scenario simulation with success probability + probability-weighted expected profit ranking → delivered report + owner email, weekly Felix cron), a post-edit review pass hardening the sandbox against silent failures (a new INCONCLUSIVE verdict in BOTH report shapes so zero-replay/zero-graded/errored-heavy runs can never masquerade as NO_CHANGE, grading-failure telemetry, and a read-time stale marker on runs stuck &gt;30 min — 2 HIGH + 1 MEDIUM closed), and the .44 release-sync round adds concurrent-promote race regression pins (a double-fired promote can never double-insert or double-triage the same run) plus a preflight rule that catches stale platform counts inside operator scripts. Gates: tsc 0, seamtests 69/69, suite 146/146, wiring audit CLEAN, preflight CLEAN, architect PASS. Earlier R125+137.30 → +137.40 — the Simulation Sandbox contract completes S1–S5: offline what-if replay of past safety decisions and model swaps under a shared per-run $5 hard cap (claim-before-spend), with new `sandbox_run`/`sandbox_report` tools registered fail-closed + trusted-personas-only (tools 396 → 399, tables 213 → 215), a `/admin/sandbox` UI with admin-gated launch API (5s-wait/202-detach), and Sandbox probe #16 on /admin/ecosystem-health — E2E smoke replayed 5/5 live safety decisions with NO_CHANGE. Also in the window: the repo-surgeon gains a metered escalation valve (exactly ONE frontier diagnostic turn on a prior-collapse stall — judgment only, fail-OPEN, never on the final attempt), two standing-registry model registrations (meta/muse-spark-1.1 paid + nvidia/nemotron-3-ultra-550b :free — neither touches the jury pools or the frontier reserve), the BWB weekly recap becomes self-healing and incident-proof (both redirect chokepoints auto-invoke the weekly build with ctx-derived trust only; explicit date-window extraction cures the wrong-WEEK incident and labeled weight-fact extraction cures the wrong-NUMBERS incident), and a Tool Reliability card lands on /admin/ecosystem-health (SQL-bounded worst/top-N with redacted failure reasons). Gates: tsc 0, seamtests 69/69, suite 146/146, sandbox tests 16/16, architect PASS. Earlier R125+137.26 → +137.29-review — an external frontier-model (Kimi-K3) code review is triaged end-to-end: the hardcoded owner email is purged from EVERY server runtime path onto fail-closed env config (policy-engine seeding, inbox-quarantine allowlist, ingest identity via a new GMAIL_INGEST_ADDRESS env, security.txt contact chain, policy seed script), the 190-entry changelog becomes data (updates.json + a 42-icon map), the public mirror gains a pg_dump DDL schema snapshot + a fail-closed platform-totals refresh + tagged r125.137.x GitHub Releases, a ratchet-DOWN-only `: any`/`as any` budget gate (baseline 6,949) lands as weekly-maintenance Pass 14, Kimi-K3 registers as a frontier RESERVE (fires at most one backfill call, only when a main-round frontier proposer fails on the metered path; 9/9 gate tests), and a 72h whole-app review closes 3 MEDIUMs fail-closed (api-v1 conversation-messages tenant-scoping JOIN, strict unknown-flag CLI contract on the tag-release script, fail-closed any-budget scan with the baseline byte-untouched) with 4 permanent regression pins (suite 144/144). Earlier R125+137.23 → +137.25-review — the Tool Eviction/Retirement loop (flag-only classifier + HITL approvals, exemptions fail-closed) + Tool Forge Phase 2 (unmet-demand → budget-claimed LLM module proposals, nothing auto-lands) land as weekly crons, the tool-router gains a hard cap (pure enforceToolCap at both overshoot sites, ALWAYS_INCLUDE never trimmed), an AG-UI protocol adapter opens the public API v1 surface (POST /api/v1/agui/run replays chat turns as ordered AG-UI SSE events, scope-parity guard pinned), the admin PIN hash is consolidated onto the canonical peppered hasher (seed.ts boot re-downgrade cured), and a 72h whole-app review closes 2 MEDIUMs (stripe-checkout log leak + agui-scope-parity test bypass). Earlier R125+137.20 → +137.22 — six OpenClaw-inspired native features + seeded-fraud judge proof + spec-vs-test authority + the Drive connector-lookup fix + a clean 72h review (1 FALSE POSITIVE logged). Earlier R125+137.14 → +137.19 — the self-improvement loop gains two safeguards + Tool Forge Phase 1 + two god-file splits + a clean 72h review. R125+137.14 — RULER-style relative group ranking (an OpenPipe-ART borrow) lands as a measure-first NON-blocking third judge lane in the skill-optimizer's evaluator A/B: one anonymized seed-shuffled group-ranking call per case, parsing fails CLOSED to null, runtime fails OPEN, never touches the apply decision (kill switch SKILL_OPT_RULER=off; 16/16 pure tests). R125+137.15 — prior-collapse detection ("two loops watching each other"): an embedding-space near-dupe tracker over prior failed/rejected proposals, fail-OPEN on every path (even a THROWING injected tracker can't block a loop — pinned by regression tests in both hosts), wired OPT-IN into the skill-optimizer (near-dupe of a rejected edit skips val-scoring spend + a PRIOR-COLLAPSE perturbation directive rides the next propose) and the repo-surgeon (near-identical re-proposal of a FAILED diff skips apply/verify and escalates on the final attempt); kill switch PRIOR_COLLAPSE=off; 70/70 targeted tests. R125+137.16 — routes god-file Tier-1 split (auth/tenants/admin extracted verbatim, ≈7,794 → 7,329 lines, behavior-preserving architect PASS) + a "sandbox blocklist is not load-bearing" regression proof: keyword-free escape probes fail closed WITHOUT the blocklist string, pinning the VM layer as the real control. R125+137.17 — tools-layer split S34: google_workspace migrated into its own domain package with the fail-closed tenant seam preserved verbatim (tools.ts 9,785 → 9,668 lines, 295/395 migrated). R125+137.18 — Tool Forge Phase 1 (observability only): unmet-capability demand folded into the capability_gaps table (atomic miss_count bump + last_seen_at) + a tenant-scoped Unmet Capabilities probe and card on /admin/ecosystem-health; architect FAIL→fixed — the probe's terminal-state set now matches the dedup index so repeat demand can never be absorbed invisibly. R125+137.19 — 72h post-edit review (3 architect prongs over the window's commits): 1 MEDIUM closed fail-CLOSED — autonomous capability-gap writes now pass a tenant-validation helper before ANY insert (a bad tenant id can no longer create an orphaned cross-tenant row) — plus the tenant-isolation audit's unreadable-file accounting wired end-to-end (coverage denominator, degraded banner, exit-cause, and a phase-split fix so an unreadable file is never double-counted), prior-collapse degraded-fields surfaced, and email-flush failures now log the full stack; no CRITICAL/HIGH findings; tsc 0, build 0, suites green. R125+137.4 → +137.13 — Action Ledger S1–S5 shipped end-to-end: a durable tenant-scoped prepare→dispatch→settle ledger for destructive tool actions (new action_attempts table, tables 212 → 213; state machine prepared→executing→committed/failed/unknown→compensated enforced via guarded UPDATE so concurrent settlers can't double-settle) + withActionLedger middleware at the dispatch seam (prepare fails CLOSED, classification fails OPEN) + unforgeable ALS-threaded Stripe idempotency keys with a 6-hourly verify-probe reconciler (probe errors stay unknown NEVER failed; money-movement mutations can never be grandfathered without keying) + advisory AbortSignal threading + send_email opt-in ledgering with a sent-mail verify probe + timeout retry RE-ENABLED but ONLY on proven non-commit (reconcile first; confirmed commit ⇒ loud \"Do NOT retry\" error; unknown ⇒ reconciler, never retry; kill switch AL_TIMEOUT_RETRY=0). Also in the window: Claude CLI bridge migrated to the official @anthropic-ai/claude-agent-sdk (empty/error streams can no longer end success-looking), Sol mirror-review gaps A+B (live degrading-trajectory replanning + honest completed_unverified status), BWB weekly recap correct-by-default (auto-pinned Sun–Sat window + jobKey collision fix + purge knob). 72h review: 1 MEDIUM (swallowed rollback-claim failure now logs loud) + 2 LOW closed. Gates: ledger 46/46, retry 16/16, suite 135/135, seam 68/68, tsc 0, build 0, architect PASS every slice. R125+137.3 — full-platform post-edit review (3 architect surface passes + silent-failure-hunter + regex hunter + wiring audit over 205 commits / 80 files): 1 CRITICAL closed fail-CLOSED — the transactional no-regression snapshot's rollback UPDATE was missing AND tenant_id (the safety net that undoes a failed irreversible tool action could have written across tenant boundaries; now tenant-scoped, architect-verified) + 1 MEDIUM — gpt-5.6-sol (the platform default flagship) was absent from ALL 3 pricing maps (insights silently $0, ledger billed via the $5/$5 unknown-model fallback) → flagship-class $2.5/$15 rows in cost-ledger / resource-predictor / insights-engine + a presence regression test (cost tests 6/6); FALSE POSITIVE logged (persona-contract text lives in the imported PLATFORM_TOOLS_CONTRACT single source of truth). R125+137.2 — full wiring review: smoke catalog regenerated 396/396 (--status never re-scans; the static-doc parser was blind to standalone domain-file ToolDefinition consts — 302 tools doc-dark post-split, now 0). R125+137 / +137.1 — PROOF_LOOPS v2: per-run proof-level knob L1–L5 (advisory, default L2 byte-identical) + Chronicle-precision telemetry card; post-edit review gains a mandatory wiring trigger question. R125+136 / +135 — pricing locked to live OpenRouter rates behind a drift-guard test with a KNOWN_DRIFT heal-ratchet; 2 real ledger gaps fixed (gpt-5-mini billed at 20×, glm-5.1 at $0), cost tests 31/31. R125+134 — Grok 4.5 wired in additively (verified live on api.x.ai + OpenRouter, 500K ctx, $2/$6); deliberately NOT swapped into router defaults; $0 cost policy intact. R125+133 — post-edit code-review sweep (whole-app + sensitive areas + 72h): 2 HIGH + 3 MEDIUM closed fail-CLOSED — the trust-reviewer's clean_memory_op auto-approve lane now BLOCKS reserved knowledge categories outright (defense-in-depth behind the R125+130 storage chokepoint), and tool-learning's tryAndRevert no longer leaves an unvalidated LLM-generated custom_tools row ACTIVE on its early "reverted" branches (architect-caught in verification — every revert path now deletes the row via a shared revertToolRow helper, and unvalidatable tools fail CLOSED); self-heal drops allowSystemFallback and requires a positive-integer tenantId, IStorage createKnowledge/updateKnowledge signatures carry the allowReservedCategory opts, and 6 security test files are now wired into the canonical suite (126/0, guard test 8/8); tsc 0, build 0, seam 67/67, wiring CLEAN, architect FAIL → fixed → PASS. R125+132 — Grok mirror-triage quintet: domain-boundary CI gate (static import scan across 219 files / 73 tool domains, non-literal dynamic import fails closed, wired as a suite preflight), coverage reporting over the canonical suite, fail-closed Prometheus /metrics (404 unless METRICS_TOKEN matches — never 401; timing-safe Bearer compare, per-query try/catch so a broken gauge can never 500 the scrape, 4/4 contract tests incl. mount-order-before-CSRF), lite deploy profile .env.core.example, and Mermaid architecture diagrams for the Memory V2/MNEMA write path + chunk-and-parallel orchestration. R125+131 — GPT-5.6 Sol verified live against api.openai.com and promoted to OpenAI flagship across ~28 files (MoA proposers/aggregator/polarity, auto-router rosters, CEO orchestrator, chat engine); gpt-5.5 demoted to fallback; the $0-cost policy still substitutes the free lane outside the cost-exempt flagship lane. R125+130 — post-edit security sweep: 1 HIGH closed fail-CLOSED — a cross-tenant SMS/WhatsApp pairing hijack (a planted messaging_pairing knowledge row could steal another tenant's inbound messages) is blocked at the storage chokepoint: reserved knowledge categories now throw on create AND update unless explicitly allowed; +3 MEDIUM PII-redaction / tenant-guard fixes (skill-synthesizer nudgeMemory, research-engine titles, deliver_product) and a new 8-assertion CI guard; tsc 0, build 0, seam 67/67, wiring CLEAN, architect PASS. R125+129 — portable Evidence Docket: new generate_evidence_docket tool (tools 395 → 396) assembles goal contracts, completion-verification verdicts, jury κ concordance, intent-gate/tool-block audit rows, delivery record, and a step-ledger replay pointer into one reviewer-facing artifact — tenant-scoped on EVERY query, secrets/SSN/credit-cards scrubbed from every free-text value, HTML-escaped rendering; 15/15 tests, architect PASS. R125+128 — browser-tool SSRF TOCTOU CLOSED: CDP request interception aborts private-IP hosts / blocked hostnames / non-http(s) schemes on every request and re-runs the full DNS-validated policy check on every navigation (initial goto, each redirect hop, client-side navs), failing CLOSED on guard error; 7-assertion CI guard. R125+127 — whole-app security review: 2 HIGH closed (uploads cross-tenant read/enumeration now bound to canonical tenant-scoped file records; agent-knowledge PII-redaction bypass across 8 raw INSERT sites now redacts objects before stringify) + Twilio webhook MessageSid replay dedupe. R125+125 — 72h post-edit security review: 1 HIGH + 4 MEDIUM closed fail-CLOSED — the list_uploads file-listing tool disclosed internal data/-directory filenames across tenants (now admin-gated, with every entry carrying an explicit source tag so path/url mapping can never be confused by name collisions); fail-closed tenant guards added to 3 background-task + 2 treasury handlers; weekly-maintenance Pass 13 now reports RED + a HIGH finding when the god-file girth gate itself fails to run (was a silent YELLOW). Also lands the tools-layer-split march R125+77 → +124: slices through S33 migrated 294/395 tools out of the legacy tools.ts monolith into per-domain modules with the fail-closed tenant seam preserved verbatim, tool count 394 → 395 (+aeo_score), girth ceiling ratcheted down every slice. Architect confirming PASS; tsc 0, build 0, seam tests 67/67, wiring 0 dead/0 drift. R125+76 — whole-app post-edit code review: 2 MEDIUM + 2 LOW closed fail-CLOSED — the deliverable-verifier's required-MIME gate now FAILS on an undeterminable type (was a silent PASS), the verifier result carries auditPersisted so a swallowed audit-log write is visible (repudiation gap closed), the PII-redaction guard coerces non-string input to honor its string contract, and a stale memory-ranking default-comment was corrected; +4 dedicated regression tests, tsc 0, architect confirming PASS. R125+75 — whole-app + 72h code review (agent-wiring audit exit 0, 394 tools, 0 dead/drift/leak/schema-gap): 3 pre-existing MEDIUMs closed fail-CLOSED in the tenant-isolation + silent-failure surface — the guarded-tool executor now sources the execution tenant ONLY from the trusted ctx (no model-authored _tenantId fallback), both event-bus event_log status writes are tenant-scoped, and heartbeat's failed-event update logs loud and is tenant-scoped (live-stat resync tables 211→212, indexes 620→623). R125+74 — whole-app + 72h code review (4 parallel surface-split architect passes + wiring audit exit 0, 394 tools, 0 dead/drift/leak/schema-gap): 1 MEDIUM closed plus an owner-jury concurrency fix — the failure-contract renderer now backslash-escapes markdown specials (mdEscape) so untrusted approval-note / question / tool-error text can't inject inline links/images/formatting, and overlapping owner-initiated jury runs now accrue a per-run reservation and settle only the excess so the daily-$ ceiling can't be overshot (fails SAFE). R125+73 — a structured failure contract for terminal agentic failures: a pure renderer emits a consistent "what completed / what failed (+why) / what exists now / exact next step" block across approval rejection + expiry and all four executor halts; it deliberately does NOT auto-route around a rejected approval (that would weaken the AHB gate). R125+72 — closed threat-model gap #1: a central pre-INSERT redaction guard on EVERY durable-store write path always strips credential-shaped secrets, Luhn-validated cards and US SSNs (email/phone detect-only), closing a HIGH step-ledger bypass + 2 MEDIUM. Architect confirming PASS, wiring audit exit 0 on every round.
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
              <Button
                variant="outline"
                size="lg"
                onClick={() => navigate("/audit")}
                className="gap-2"
                data-testid="button-hero-audit"
              >
                Run a Free AI Audit
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={400}>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 pt-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> 407 built-in AI tools + 4 MCP memory tools (R125+137.76+sec)</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> 16 specialist agents</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> PDF, Word, Excel, Slides, Video</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> 129 active capabilities</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> Live Instant AI Readiness Audit (R125+52.20)</span>
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
                Not just a chatbot — a self-evolving AI corporation with 407 tools across 23 categories (R125+4 added `research` for academic_search/arxiv/pubmed/openalex/crossref) (R98.16 cross-pollinated 8 features from the IJFW project: a new `run_command` shell tool with large-output auto-summarization, wave-table parallelism on plan_deliverable so deliverable pipelines actually run in parallel, an actionable `translateLlmError` helper that turns provider stack traces into one-line user fixes, a `sanitizeUntrusted` heading + system-tag defang against prompt-injection-via-captured-content, atomicWriteFileSync with parent-dir fsync at 6 critical persistence sites for true power-loss durability, plus a +sec-2 architect sweep that closed 6 findings — CRITICAL secret-redaction in the error translator, HIGH SSRF jail extended for CGNAT/multicast/IPv6/internal cluster TLDs, output-sandbox switched to atomic write, retrieve_hint absolute-path leak removed, and tmp-file cleanup on rename failure; R98.14 completed the 7-workstream Felix Deliverable Reliability Plan with durable resumable long-video jobs that survive chat-turn boundaries, a nightly golden-path regression net, a reference learner that studies real-world exemplars from a YouTube/web URL and absorbs their style, and quality-instinct cards baked into Felix's persona prompt as concrete checkable rules per format; R98.13 added a deterministic plan→pipeline router and a vision/audio quality grader with bounded auto-revise; R98.7 added the Felix self-thinking loop with failure-pattern memory + a sentrux-inspired structural quality sensor + a voluntary self-check loop; R96 added the Camofox stealth-browser microservice plus a four-tier web-access ladder with auto-escalation), multi-agent orchestration (Crews, Flows, Minds),
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
              { icon: Wrench, value: "407", label: "Production tools", sub: "R125+52.19 → +52.22 — NEW live Instant AI Readiness Audit at /audit: public POST /api/public/audit/run scores any visitor-supplied website /100 across AI Access / Structured Data / Metadata / Social / Technical → grade A–F with recommendations, persisted to the audit_reports table; its SSRF jail was hardened against a DNS-rebinding TOCTOU by pinning the validated resolved addresses through an undici connect.lookup override (re-pinned on every redirect hop, TLS SNI/Host bound to the real hostname) + the rate-limit key moved off req.ip onto the raw socket remoteAddress; a separate whole-project review closed 3 cross-tenant read leaks (chat-engine workspace context + self-improvement experiments now tenant-scoped, fail-closed) and deleted dead unsafe chat scaffolding (tsc clean, architect PASS). R125+22 — Autonomous self-repair stack landed: incident classifier → `repair_incidents` ledger → guarded Repo Surgeon code-fix executor (minimal diff, verified, auto-apply OFF by default via `REPAIR_AUTOFIX_ENABLED`) → pipeline-checkpoint resume → owner incident ledger at `GET /api/admin/repair-incidents`; security rounds R125+19/+22 closed 10 MEDIUM (0 HIGH/CRITICAL). R125+13.13+sec — Whole-app + 72h post-edit code review (3 parallel architect passes spanning Safety/Tools/Personas, Routes/Payment/Webhooks/Schema, Scripts/Cron/Lib) closed 3 MEDIUMs in-round: (a) every `archive_rescue_orders` query in `server/routes/archive-rescue.ts` now includes explicit `AND tenant_id = ${PLATFORM_OWNER_TENANT_ID}` predicate (background OCR updates, dedup/cap selects, stripe session-id update, owner-email lookup) — defense-in-depth against future schema-share or single-DB multi-tenant migration; (b) `server/routes/stripe-checkout.ts` anonymous allowlist tightened to ONLY `metadata.kind='audit'` — `archive-rescue` removed, forcing those purchases through the dedicated `/api/public/archive-rescue/checkout` route that creates the order row + session-metadata linkage (eliminates orphan-paid-session state-machine drift); (c) `.agents/skills/_registry.json` regenerated to include the new `feature-contract` skill with sha256+bytes pin. 3 items deferred + logged to docs/architecture-notes.md (AHB refusalCopy backfill across ~15 of 16 personas, heartbeat cron → owner-notification escalation, upsertProject race in wire scripts). R125+13.13 — NEW `feature-contract` skill (durable per-feature spec.md+plan.md contract for multi-day builds, distinct from in-session session_plan.md; architect grades scope-drift against the contract during post-edit-code-review) + `replit-md-maintenance` skill gained \"Act, don't ask\" standing order so agent autonomously fixes stale stats / missing R-rounds / archive-trim when replit.md exceeds ~150 lines. R125+13.12+sec — Whole-app + 72h post-edit code review (2 parallel architect passes) closed 2 MEDIUMs in-round: (a) Archive Rescue free-demo race condition — dedup + OCR daily-cap + INSERT now atomic under `pg_advisory_xact_lock(42)` in a single `db.transaction` so concurrent same-email POSTs can't both pass and burst traffic can't oversubscribe the daily cap; (b) Monid `monid_discover` + `monid_inspect` reclassified `safe/LOW → sensitive/MEDIUM` in destructive-tool-policy (outbound paid API + attacker-steerable URL surface now governed at policy level, matching `monid_run`). 2 LOWs deferred + documented in docs/architecture-notes.md § Known gaps (Gmail refresh-token plaintext at-rest, heartbeat cron LLM bypass of intent-gate — both pre-existing architectural). Stale stat fixed: output-skills 33→32 matching live `_registry.json`. R125+13.12 — Creator Sponsor Ops wedge wired CONCIERGE-MODE (project #239, 3 crons: deadline-scan-daily / weekly-digest / pro-brand-discovery-monthly) + Monid catalog 124→166 endpoints + 5-system wedge-wiring backfill (capability-registry rows for wedge_archive_rescue + wedge_creator_sponsor_ops + felix-brain INTENT_PATTERNS). Pricing $99 audit / $299mo / $499mo Pro w/ Monid brand-discovery; no public landing until 3 paying Standard or 1 Pro (ideabrowser validate-before-build). R125+13.11+sec — 1 HIGH closed (Archive Rescue demo: ARCHIVE_RESCUE_OCR_DAILY_CAP env-cap + email-based 24h dedup), 1 LOW closed (background OCR catch sets ocr_failed + owner-email), 2 FALSE POSITIVES (PLATFORM_OWNER_TENANT_ID=1 correct for owned concierge service), 1 systemic MEDIUM deferred (~42 legacy uploadAndShare callsites). R125+13.11 — Archive Rescue wedge sellable end-to-end: public /archive-rescue (hero + free 5-page demo + 3-tier Stripe cards) + admin queue /admin/archive-rescue + archive_rescue_orders table + route file with 4 endpoints + 3 live Stripe products ($99/500pg / $299/2500pg / $999+$49mo). R125+13.10 — Inbox-ingest auto-cron (inbox:ingest-daily 07:00 + inbox:digest-daily 07:30) wired for previously-orphan Gmail pipeline; classifier gained 6th kind money_opportunity. R125+13.9 — Closed every deferred finding from R125+13.6+sec in one pass: MEDIUM #4 (jury FIX-queue sensitive-path denylist — 17-pattern regex in `scripts/jury-triage.ts` covering auth/safety/payment/schema/secrets routes poisoned-fix proposals to owner-notification instead of the implementer queue even with JURY_AUTOAPPLY=1) + 5 LOWs (gmail-direct token single-flight refresh + 10s AbortController timeout; `INBOX_CLASSIFIER_MODEL` env hot-swap; allowlist sender-shape regex + fail-CLOSED throw + caller try/catch; `seo-head.tsx` canonical cleanup on unmount + `177→179` bump; `/api/admin/gmail-direct/` prefix in PUBLIC_PATH_PREFIXES replaced with three exact paths). Three architect rounds, two self-regressions caught + fixed inline (L1 wedge on hung socket, L3 still broadens scope on all-invalid allowlist), final CLEAN. R125+13.6+sec — whole-app + 72h architect pass across 3 parallel reviewers: 0 CRITICAL, 2 HIGH closed in-round (gmail-direct PIN throttle bypass, leads XFF spoof → req.ip), 5 MEDIUM closed (UNTRUSTED_EMAIL delimiter strip, orphan-retry race → UNIQUE index + CLAIM-then-route, `is_read` collision no-op'd, /api/public/trust scoped 7 tenant-owned counters to tenant 1), loop-until-clean across 3 verification rounds. R125+13.6 — Inbox auto-funnel: NEW table `inbox_classifications` (tables 178→179) + ~400 LOC ingest pipeline + classifier + router for 5 kinds (BWB video idea, capability gap, competitor intel, idea log, noise) with allowlist-scoped Gmail search; NOTHING auto-publishes — all 3 destinations are review queues. R125+13.5+sec — gmail-direct security review closed HIGH PIN throttle bypass + leads XFF spoof. R125+6+sec.1 — NEW public /gallery + /trust pages with default-private opt-in showcase. /trust is the live safety dashboard (495 agent runs/30d, 79 deliverables/30d, 235 declines, 60 tools exercised, 16/16 AHB intent-gate coverage, 3 jury decisions logged, 41 governance rules, 185 tables, 541 indexes). /gallery is empty-by-default until admin explicitly opts in a file via `UPDATE file_storage SET is_public=true WHERE id IN (...)`. Architect across two passes closed 1 CRITICAL (initial gallery leaked admin-tenant filenames including medical PDFs + named customer projects — closed via NEW is_public column + RLS), 2 HIGH (storage_key IDOR — dropped from API + proxied through /api/public/gallery/file/:id with re-check + sanitize + path-traversal guard; open-redirect via drive_url — NEW safeDriveUrl() requires https + drive.google.com/docs.google.com host allowlist, applied at BOTH egress points), 2 MEDIUM (tenant_id nullable drift in live DB despite schema notNull — psql backfill of 10 null rows + ALTER COLUMN SET NOT NULL applied live, defense-in-depth restored at DB layer; cache DoS — 60s in-memory TTL cache + X-Cache: HIT/MISS headers). 2 LOWs accepted as feature (info disclosure on /trust counts IS the trust dashboard's point; file route doesn't re-apply list filters because is_public IS the explicit opt-in gate Bob controls). R120 RLS policy r120_tenant_isolation on file_storage CONFIRMED ACTIVE.  Earlier in R125+4+sec, closed 1 HIGH (Monid fence-bypass: 4 tool handlers returned {fenced, raw} dual-output that defeated wrapExternalContent's prompt-injection containment — fix removed `raw` from all sites, returns only safe metadata + fenced payload) + 1 MEDIUM (CI healer `scripts/agentic-ci-self-heal.ts` had hardcoded `huskyauto@gmail.com` fallback that would leak to forks — replaced with 4-env-var chain + empty-email guards on both sendEmail sites). NEW regression gate `tests/security/external-content-fenced-raw-antipattern.test.ts` — static-source scan walks server/**/*.ts and fails CI if any tool handler returns both `fenced:` and `raw:` (single-line OR multi-line variants); mutation-test verified the gate actually catches the antipattern. R125+4 — NEW legitimate academic research toolset (5 new tools, all safe/LOW read-only public APIs, no auth keys): `academic_search` (META fan-out across all 4 sources, parallel via Promise.all, DOI-dedup + citation-ranked), `arxiv_search` (STEM preprints), `pubmed_search` (NCBI E-utilities biomedical), `openalex_search` (250M+ works with citation counts + reconstructed abstracts), `crossref_lookup` (authoritative DOI registry + exact-title disambiguation, dual-mode DOI-direct OR query). Polite-pool env vars OPENALEX_MAILTO + CROSSREF_MAILTO (omitted when unset — zero PII leak). Every payload defused via `wrapExternalContent` so adversarial paper abstracts can't smuggle tool-call-shaped strings. NEW `research` tool category seeds future research-persona auto-discovery. ACTIVE persona wiring: Radar (Intelligence Analyst, ACADEMIC FIRST in operating loop), Neptune (Deep Research, default first move), Cassandra (Finance, unit-economics evidence backing), Luna (Legal, law-review scholarship). NEW cross-persona briefing in agent_knowledge so every persona discovers via search_knowledge. Smoke-tested live: arxiv_search 5 results in ~1s; academic_search on \"wellness receptor agonist wellness\" returned 12 deduplicated results across all 4 sources with 0 source errors, citation-ranked correctly. R125+3.9 — NEW `recall_capabilities` tool (semantic-rank capability search via hybrid BM25+vector) + auto-index drift loop in agent-knowledge-refresh. R125+3.6+sec.1 — Public-mirror liability lockdown on the jury auto-apply seam. NEW env-var gate `JURY_AUTOAPPLY=1` (default OFF) controls whether `data/jury-decisions/queue.json` writes happen, placed at both auto-apply sites (`scripts/jury-triage.ts` CLI + `scripts/agentic-ci-self-heal.ts` notifyUnfixable). Fork default: jury still runs full 3-model vote + per-decision markdown for human review, but the implementer-pickup queue stays untouched; CI-healer owner-email includes verdict as ADVISORY text + footer naming the env var to flip. Private setup unchanged via Replit shared-env. Public README disclaimer block: AS-IS / no-warranty / maintainers-and-Replit-not-responsible + responsible-disclosure path. R125+3.6+sec — closed 4 architect findings on the R125+3.6 jury surface: A (MEDIUM-HIGH parser prompt-injection via line-anchored regex + sanitizeForPrompt), G (HIGH zero-test-coverage via NEW 22-test suite), B (MEDIUM policy scope: jury_triage bumped safe/LOW → sensitive/MEDIUM/trustedPersonasOnly), C (MEDIUM doc/code drift on auto-apply semantics). Residual A triaged ACCEPT — all known bypass paths fail-safe to ESCALATE not silent verdict; locked with regression tests. R125+3.6 — Multi-model jury triage primitive + full wiring across all three signal sources: (1) issue CLI `scripts/jury-triage.ts` (--source=gaps / --issue / --issue-file), (2) `.agents/skills/architect-finding-triage/SKILL.md` jury section + bypass cases, (3) CI self-healer `notifyUnfixable()` calls jury before owner-email + appends verdict to body + persists to queue.json. NEW `server/lib/jury-triage.ts` wraps executeMoA (frontier pool — deepseek-v4-pro + gpt-5.5 + gemini-3.1-pro-preview, aggregator claude-opus-4-7) with structured VERDICT/RATIONALE/FIX_PROPOSAL prompt, parses each proposer answer, tallies 2-of-3 majority; ties or unparseable → ESCALATE. ACCEPT/REJECT auto-apply (doc-only mutations); FIX queues NL proposal for separate implementer pass. NEW tool `jury_triage` + NEW capability `multi_model_jury_triage`. Smoke test PASSED end-to-end: gap #1 ACCEPT 3-0, κ=0.815, 20.9s. R125+1.1 — whole-app + last-72h post-edit code-review pass; 1 MEDIUM fixed inline (`client/src/pages/jobs.tsx:154` `javascript:`-URL sink — shared `safeUrl()` allow-list extracted to NEW `client/src/lib/safe-url.ts`, imported in jobs.tsx + video-jobs-banner.tsx) and 1 HIGH deferred + logged (~42 direct `uploadAndShare()`/`uploadToDrive()` callsites outside the delivery pipeline bypass the R110 +sec secret-scan gate; pre-existing systemic, single-user LOW blast radius today; logged to docs/architecture-notes.md with concrete migration shape). Architect CLEAN on tenant isolation, AHB, SQL parameterization, CSRF, R123 +sec memory-backup fix intact, prompt-injection/CoVe, SSRF/jsdom/ESM. `tsc --noEmit` CLEAN. R125+1 — OpenRouter `ensemble_query` proposer-pool A/B infrastructure — OPT-IN, no default flip. FRONTIER_PROPOSERS (alias of old default, unchanged 3-model), CHEAP_PROPOSERS (5 lineage-diverse OpenRouter cheap models), MIXED_PROPOSERS (3 + 3); MAX_PROPOSERS 5 → 8; precedence explicit proposerIds > pool > frontier; telemetry via moa_responses.invoked_via `tool|pool=cheap` suffix; NEW agent-runnable A/B harness scripts/ensemble-query-ab.ts; 5 node:test units in tests/lib/moa-pool.test.ts. R115.5+sec round 3 — three-pass architect review on the R113.5→R114 ship closed 1 HIGH (legacy MCP `/api/mcp/sse` SSE surface now gated behind `LEGACY_MCP_ENABLED=1`, default OFF — the scope-restricted R113.7+sec `/mcp` Streamable HTTP surface is the supported integration) + 1 MEDIUM (AEvo meta-editor forbidden-pattern catalog hardened against confusable / zero-width / NFKC bypasses via `normalizeForPatternCheck` — soft hyphen, fullwidth Latin, ZWSP all fail-CLOSED) + 4 LOWs (`emptyBodySchema = z.object({}).strict()` wired across procedure-edits apply, council-verdicts request, scheduled-posts delete, mcp-keys delete — body-smuggling rejected at the gate). 30/30 AEvo invariants pass with 3 new unicode regression tests. SSRF rebinding MEDIUM deferred (pre-existing, requires undici dispatcher refactor). R114 — AEvo meta-editing of procedure context (Zhang et al., arXiv:2605.13821): HITL-gated meta-agent proposes minimal surgical edits to `data/output-skills/` playbooks based on accumulated evidence (≥3 agent_trace_spans + delivery_verifications + grade_deliverable rows), CAS sha256-pinned, rollback-capable. Edit-surface allowlist is HARDCODED type-level: `targetKind='output_skill'` ONLY (NOT .agents/skills/, NOT persona souls, NOT doctrine, NOT safety_profile, NOT TOOL_POLICIES). Tables 171→173→174 (R115.5 sprint_contracts) (`procedure_edits` + `procedure_evolution_runs`), indexes 449→452→454 (R115.5 +2), governance 42→43 (procedure_edit_governance HITL-on-apply), capabilities 109→110 (aevo_meta_editing), tools 347→357 (`propose_procedure_edit`, `list_procedure_edits`, `approve_procedure_edit`, `reject_procedure_edit`, `apply_procedure_edit`, `rollback_procedure_edit`). NEW `/procedure-edits` admin UI. Persona Doctrine #13 added — every persona sees the edit-surface allowlist + forbidden-pattern catalog + propose-not-apply posture. R98.27.8 codebase self-knowledge graph + diff-impact blast-radius (`codebase_graph_query` + `codebase_diff_impact` — 586 files, 1598 edges, layer-tagged, Prong A.5 of post-edit-code-review). Drive, email, calendar, web, code execution, scheduler, Stripe, marketing automation, code-health scan, recursive language model synthesis, tensions/ADRs/graph-explorer (R74.13z-quint+2), self-curating Tool Sommelier playbook (R74.13z-quint+3), four-tier web-access ladder with auto-escalation + Camofox stealth-browser microservice (R96), Felix self-thinking loop with failure-pattern memory + sentrux-inspired structural quality sensor (R98.7), project slash commands (/check, /registry, /commit-all) + AGENT_FOLDER_MAP cross-IDE skill mirroring + new slash_command tool (R98.10, the 284th), exit-77 + gate_command clean-skip pattern on delegate_task (R98.11), R98.13 plan_deliverable (prompt→pipeline router for 10 formats) + grade_deliverable (vision/audio quality grader 0-100 with bounded auto-revise), R98.14 durable resumable long-video jobs (start_video_job/check_video_job/finalize_video — chat turn closes cleanly even on 12+ min jobs, idempotent concat retry never re-renders the cheap-but-failed step) + nightly golden-path regression net + reference learner (learn_from_reference/recall_references — SSRF-jailed YouTube/web exemplar study, vision LLM extracts 3-8 concrete copyable patterns) + quality-instinct cards baked into Felix's persona, and R98.16 IJFW cross-pollination: `run_command` (#296, ad-hoc shell with large-output sandbox + domain-aware auto-summary so test runners / tsc / build / grep don't burn 8KB of context on ✓ lines, owner-tenant + Felix/Forge gated) + wave-table parallelism on plan_deliverable (sibling steps inside a wave dispatch in parallel via single-response multi-tool-calls — PDF wave 3 grade+verify, html_app wave 3 grade+deliver, research wave 1 deep+web, slides wave 1 orchestrate+create) + translateLlmError actionable error UX + sanitizeUntrusted heading/system-tag defang + atomicWriteFileSync parent-dir-fsync at 6 critical persistence sites + extended SSRF jail (CGNAT/multicast/IPv6/internal cluster TLDs)." },
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

      <LoopAnatomySection />

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
              Start with 5 free conversations. Experience all 16 agents, 407 tools, 43 + 62 + 38 skills (143 reference surfaces), full document and video production
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
