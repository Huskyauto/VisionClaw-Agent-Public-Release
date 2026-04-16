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
  Terminal, Briefcase, HelpCircle, ChevronDown, Phone,
} from "lucide-react";
import vcLogoPath from "@assets/Vision_Claw_Logo_Final-01_1775695444328.jpg";


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
    "delegates across 14 specialists",
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
];

const CAPABILITY_SECTIONS = [
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
    title: "194 Enterprise AI Tools",
    subtitle: "Everything a modern business needs, powered by 37+ AI models across 41 categories",
    icon: Layers,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    features: [
      { icon: FileText, label: "Full Document Suite", detail: "PDFs, Word docs, Excel spreadsheets, Google Slides, Mermaid diagrams, charts, dashboards — all auto-uploaded to Google Drive." },
      { icon: Code, label: "Code & Execution", detail: "Write code, execute it in a sandbox, review architecture, generate code proposals, and manage technical projects." },
      { icon: Globe, label: "Virtual Browser", detail: "Navigate websites, take screenshots, fill forms, extract data. Full web research and competitive monitoring." },
      { icon: Mail, label: "Multi-Channel Comms", detail: "Email (AgentMail), WhatsApp, Discord, Telegram, X/Twitter (10 tools) — your AI team communicates across every channel." },
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
      { icon: Sparkles, label: "Dream Consolidation", detail: "Every 6 hours, the system 'sleeps' — merging duplicates, archiving stale data, promoting important findings, and creating summaries." },
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
      { icon: Palette, label: "37+ AI Models", detail: "Smart routing across OpenAI, Anthropic, xAI, and more. OAuth-first for cost optimization. The right model for every task." },
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
      { icon: Users, label: "Multi-Agent Overview", detail: "All 14 agents on one board. Filter by status, persona, or activity type. Instantly see who's doing what across your AI corporation." },
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
      { icon: Database, label: "Centralized Tool Registry", detail: "Single source of truth for all 194 tools — categories, speed class, product output, network tracking. Bidirectional startup audit ensures no tool is invisible. 194 tools across 41 categories." },
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
      "All 14 AI agents",
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
      "All 14 AI agents",
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
      "Full 14-agent team",
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
                  {[{ l: "Specialist agents", v: "14" }, { l: "Connected tools", v: "194" }, { l: "Model routes", v: "37+" }].map(s => (
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
    { icon: Wrench, title: "Real Tool Use", desc: "Create PDFs, write files, browse sites, send emails, query memory, upload assets, and run workflows inside the same system — 194 tools total, managed by a centralized Tool Registry." },
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
    { icon: Layers, title: "Tool Registry System", desc: "Every tool is cataloged in a centralized registry with categories, speed class, and product tracking. Startup audits ensure nothing is invisible. 194 tools across 41 categories with bidirectional integrity checks." },
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
                  {["Executes tasks through 194 connected tools and agent roles", "Stores project memory, notes, and assets for continuity", "Self-corrects incomplete work — ask once, get a complete deliverable", "Uses approval gates where business risk is real", "Auto-recovers from failures with backup agents and clear explanations", "Designed for repeatable operating leverage"].map(item => (
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
                    "40 governance rules enforce operational boundaries across every agent.",
                    "Trust scores track each agent's reliability and adjust autonomy dynamically.",
                    "Multi-model failover ensures no single provider outage stops work.",
                    "Full audit trail on every tool call, decision, and deliverable.",
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
  { agent: "Atlas", icon: Activity, action: "Model routing optimized", detail: "Smart routing saved $2,340 this month — OAuth-first routing cut API costs 41%", type: "analysis", value: "-$2.3K cost" },
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
      description: "Create your account and get instant access to all 14 AI agents. Each one is already trained with specialized expertise.",
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
  const agents = useCountUp(14, 1500, visible);
  const tools = useCountUp(194, 2000, visible);
  const models = useCountUp(37, 1800, visible);
  const skills = useCountUp(61, 1600, visible);
  const tables = useCountUp(118, 2200, visible);
  const govRules = useCountUp(40, 1800, visible);
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
        description="Deploy a 14-agent AI team with 194 tools, 61 AI skills, and a centralized Tool Registry. Automate research, reporting, documents, outreach, and operations. PDF, Word, Excel, Slides, MP4 video with vision-based QA. Craftsmanship quality gate on every deliverable. 37+ AI models. 129K+ lines of code. 510 API routes. Free trial."
        ogTitle={`${pn} — Your Autonomous AI Corporation`}
        ogDescription="An AI team that researches, writes, builds, and delivers. 14 specialist agents, 194 tools, 61 skills, multi-agent orchestration, full business operations suite, parallel video production. Start free."
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

          <BusinessWhoSection />
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
              Platform Online — 14 Agents, 194 Tools, 61 Skills, 37+ Models
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
                onClick={() => document.getElementById("section-demo")?.scrollIntoView({ behavior: "smooth" })}
                data-testid="button-hero-view-demo"
              >
                Watch Live Demo
              </Button>
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={400}>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 pt-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> 194 built-in AI tools</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> 14 specialist agents</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> PDF, Word, Excel, Slides, Video</span>
              <span className="flex items-center gap-1.5"><Check className="w-4 h-4 text-emerald-500" /> 3-layer failure recovery</span>
            </div>
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

      <section id="section-capabilities" className="py-20 px-6 border-t border-border" data-testid="section-capabilities">
        <div className="max-w-6xl mx-auto">
          <RevealOnScroll>
            <div className="text-center mb-14">
              <Badge variant="secondary" className="mb-4">Platform Capabilities</Badge>
              <h2 className="text-3xl font-bold mb-3">Everything Your Business Needs</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Not just a chatbot — a self-evolving AI corporation with 194 tools across 41 categories, multi-agent orchestration (Crews, Flows, Minds),
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
              <h2 className="text-3xl font-bold mb-3">14 Specialized AI Agents</h2>
              <p className="text-muted-foreground max-w-2xl mx-auto">
                Each agent has unique expertise, personality, and tools. They collaborate as a coordinated team —
                delegating tasks, sharing knowledge, and escalating when needed.
              </p>
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
              Start with 5 free conversations. Experience all 14 agents, 194 tools, 61 AI skills, full document and video production
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
