import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { useSiteConfig } from "@/hooks/use-site-config";
import {
  Brain, Cpu, Shield, Users, Zap, Bot, Wrench,
  ArrowRight, CheckCircle2, XCircle, Clock, Rocket,
  FileText, Target, Mail, Search, Code, Globe,
  Lightbulb, BarChart3, Briefcase, Lock, BookOpen,
  Layers, Network, ChevronDown
} from "lucide-react";

interface ArchData {
  stats: Record<string, number>;
  personas: { name: string; role: string; costTier: string }[];
  uptime: number;
}

const manualSteps = [
  {
    step: 1,
    title: "Validate your idea",
    subtitle: "Before you build anything",
    description: "Use Claude Chat to stress-test your idea, challenge assumptions, and find gaps before spending a penny.",
    color: "from-purple-500/20 to-purple-600/20",
    border: "border-purple-500/30",
    icon: Target,
  },
  {
    step: 2,
    title: "Create two core files",
    subtitle: "about-me.md & brand-voice.md",
    description: "Build these once and every session runs better. Covers your business, ICP, goals, tone, and rules.",
    color: "from-blue-500/20 to-blue-600/20",
    border: "border-blue-500/30",
    icon: FileText,
  },
  {
    step: 3,
    title: "Build a Project per function",
    subtitle: "Strategy, Content, Operations",
    description: "Upload core files to each Project so every chat picks up where you left off.",
    color: "from-cyan-500/20 to-cyan-600/20",
    border: "border-cyan-500/30",
    icon: Layers,
  },
  {
    step: 4,
    title: "Use Artifacts for assets",
    subtitle: "Pitch decks, financial models, content",
    description: "Build one-pagers, landing pages, pricing docs — no designer or spreadsheet expert needed.",
    color: "from-green-500/20 to-green-600/20",
    border: "border-green-500/30",
    icon: Briefcase,
  },
  {
    step: 5,
    title: "Write sales scripts & outreach",
    subtitle: "Cold DMs, follow-ups, call frameworks",
    description: "Write your cold outreach, DM sequences, and sales call frameworks before you've spoken to a prospect.",
    color: "from-yellow-500/20 to-yellow-600/20",
    border: "border-yellow-500/30",
    icon: Mail,
  },
  {
    step: 6,
    title: "Connect your tools",
    subtitle: "Google Drive, Notion, Slack",
    description: "Link 50+ tools so Claude can search them mid-chat without you uploading anything.",
    color: "from-orange-500/20 to-orange-600/20",
    border: "border-orange-500/30",
    icon: Globe,
  },
  {
    step: 7,
    title: "Graduate to Cowork",
    subtitle: "Produce real documents",
    description: "Cowork reads your actual files and creates real documents — Excel, Word, PDF — directly into your folder.",
    color: "from-red-500/20 to-red-600/20",
    border: "border-red-500/30",
    icon: Code,
  },
  {
    step: 8,
    title: "Use Claude Code to build",
    subtitle: "Your product",
    description: "Claude Code reads your codebase, writes code, runs tests and ships changes. Non-technical founders: hire one person and set them up with Code on day one.",
    color: "from-pink-500/20 to-pink-600/20",
    border: "border-pink-500/30",
    icon: Cpu,
  },
  {
    step: 9,
    title: "Set up a daily business brief",
    subtitle: "Morning context file",
    description: "Automate a morning context file so Claude knows your priorities and open tasks before you start each day.",
    color: "from-violet-500/20 to-violet-600/20",
    border: "border-violet-500/30",
    icon: BookOpen,
  },
];

const visionClawAnswers = [
  {
    agent: "Radar + Neptune",
    capability: "Autonomous deep research, competitive intel, market analysis — runs overnight without you",
    tools: "28 research tools, Firecrawl, browser, evidence store",
    icon: Search,
    color: "text-purple-400",
  },
  {
    agent: "Memory Palace",
    capability: "Persistent 4-layer memory system with wing/room hierarchy — every persona knows your business automatically",
    tools: "14 memory tools, vector search, knowledge triples",
    icon: Brain,
    color: "text-blue-400",
  },
  {
    agent: "Project Brain System",
    capability: "Automatic project continuity with Drive folders, files, and full context inheritance across conversations",
    tools: "Project brains, scratchpads, continuity system",
    icon: Layers,
    color: "text-cyan-400",
  },
  {
    agent: "Scribe + Doc Production",
    capability: "24 tools produce PDFs, presentations, charts, video, audio — auto-delivered to Google Drive",
    tools: "PDF toolkit, Google Slides, MPEG engine, ElevenLabs",
    icon: FileText,
    color: "text-green-400",
  },
  {
    agent: "Apollo",
    capability: "Full outreach sequences with AI personalization, lead scoring, pipeline management, and CRM",
    tools: "29 communication tools, email sequences, X/Twitter",
    icon: Mail,
    color: "text-yellow-400",
  },
  {
    agent: "263 Integrated Tools",
    capability: "Google Drive, Workspace, email, X/Twitter, WhatsApp, Telegram, browser, Firecrawl, Stripe, payments, voice, video, OCR, scrapers, file safety, MCP, tensions/ADRs/graph-explorer — already wired and Tool-Registry-audited every boot",
    tools: "263 tools, fully tenant-isolated, drift-checked on every restart (R70/R71), tenant-isolation hardened end-to-end (R74.5), self-curating playbook injected via R74.13z-quint+3 Tool Sommelier",
    icon: Globe,
    color: "text-orange-400",
  },
  {
    agent: "Drive Auto-Sync",
    capability: "Every file-producing tool routes output to the correct project Drive folder automatically",
    tools: "Video, screenshots, exports — all organized by project",
    icon: Rocket,
    color: "text-red-400",
  },
  {
    agent: "Forge",
    capability: "Code execution, file read/write, security scanning, code proposals — full engineering agent",
    tools: "6 code tools, exec sandbox, SAST scanning",
    icon: Code,
    color: "text-pink-400",
  },
  {
    agent: "Chief of Staff + Heartbeat",
    capability: "11 scheduled tasks, morning briefings, nightly research, daily digest — runs before you wake up",
    tools: "Heartbeat engine, research digest, morning brief skill",
    icon: Zap,
    color: "text-violet-400",
  },
];

function AnimatedCounter({ value, duration = 2000 }: { value: number; duration?: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    if (end === 0) return;
    const increment = end / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);
    return () => clearInterval(timer);
  }, [value, duration]);
  return <span>{count.toLocaleString()}</span>;
}

function PulsingDot({ color = "#10b981" }: { color?: string }) {
  return (
    <span className="relative flex h-3 w-3">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: color }} />
      <span className="relative inline-flex rounded-full h-3 w-3" style={{ backgroundColor: color }} />
    </span>
  );
}

export default function ComparePage() {
  const { data } = useQuery<ArchData>({ queryKey: ["/api/public/architecture"] });
  const { config } = useSiteConfig();
  const pn = config.platformName;
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const stats = data?.stats;
  const personaCount = data?.personas?.length ?? 16;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-violet-500/3 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10">
        <header className="border-b border-white/5">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">{pn}</h1>
                <p className="text-xs text-white/40">Agentic Corporation</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <PulsingDot />
              <span className="text-xs text-white/50">LIVE</span>
              <a
                href="/architecture"
                className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                data-testid="link-architecture"
              >
                Architecture →
              </a>
            </div>
          </div>
        </header>

        <section className="max-w-7xl mx-auto px-6 pt-16 pb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-sm mb-6">
              <Zap className="w-3.5 h-3.5" />
              AI Tinkers Chicago — Live Demo
            </div>
            <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-4">
              <span className="text-white/90">9 Manual Steps.</span>
              <br />
              <span className="bg-gradient-to-r from-violet-400 via-purple-400 to-blue-400 bg-clip-text text-transparent">
                16 Agents. Zero Effort.
              </span>
            </h2>
            <p className="text-lg text-white/50 max-w-2xl mx-auto">
              Here's what founders do manually with Claude in 9 steps.
              {pn} does all of it autonomously — with governance, memory, and multi-tenant isolation.
            </p>
          </motion.div>

          {stats && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-12 max-w-4xl mx-auto"
            >
              {[
                { label: "AI Agents", value: personaCount, icon: Users, color: "text-violet-400" },
                { label: "Tools", value: stats.tools || 263, icon: Wrench, color: "text-blue-400" },
                { label: "Skills", value: stats.skills || 62, icon: Lightbulb, color: "text-cyan-400" },
                { label: "Gov Rules", value: stats.governanceRules || 40, icon: Shield, color: "text-emerald-400" },
                { label: "Research Sessions", value: stats.researchSessions || 121, icon: BarChart3, color: "text-amber-400" },
              ].map((stat, i) => (
                <div
                  key={stat.label}
                  className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 text-center"
                  data-testid={`stat-${stat.label.toLowerCase().replace(/\s/g, '-')}`}
                >
                  <stat.icon className={`w-5 h-5 ${stat.color} mx-auto mb-2`} />
                  <div className="text-2xl font-bold">
                    <AnimatedCounter value={stat.value} />
                  </div>
                  <div className="text-xs text-white/40 mt-1">{stat.label}</div>
                </div>
              ))}
            </motion.div>
          )}
        </section>

        <section className="max-w-7xl mx-auto px-6 pb-8">
          <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] gap-0 md:gap-0 items-start">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-300 text-xs font-medium">
                <Clock className="w-3 h-3" />
                Manual Approach
              </div>
              <p className="text-white/30 text-xs mt-2">What founders do by hand</p>
            </div>
            <div className="hidden md:block" />
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-medium">
                <Rocket className="w-3 h-3" />
                {pn} Autonomous
              </div>
              <p className="text-white/30 text-xs mt-2">What 16 agents do for you</p>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-6 pb-20">
          <div className="space-y-4">
            {manualSteps.map((step, index) => {
              const answer = visionClawAnswers[index];
              const isExpanded = expandedStep === index;
              const shouldShow = showAll || index < 5;

              if (!shouldShow) return null;

              return (
                <motion.div
                  key={step.step}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: index * 0.05 }}
                  className="group"
                  data-testid={`compare-step-${step.step}`}
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={`Step ${step.step}: ${step.title} — ${answer.agent}`}
                    className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] gap-4 md:gap-6 items-stretch cursor-pointer w-full text-left"
                    onClick={() => setExpandedStep(isExpanded ? null : index)}
                  >
                    <div className={`bg-gradient-to-br ${step.color} border ${step.border} rounded-xl p-5 transition-all duration-300 hover:border-white/20`}>
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-sm font-bold text-white/70">
                          {step.step}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-white/90 text-sm">{step.title}</h3>
                          <p className="text-xs text-white/40 mt-0.5">{step.subtitle}</p>
                          {isExpanded && (
                            <motion.p
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              className="text-xs text-white/50 mt-2 leading-relaxed"
                            >
                              {step.description}
                            </motion.p>
                          )}
                        </div>
                        <XCircle className="w-4 h-4 text-red-400/50 flex-shrink-0 mt-0.5" />
                      </div>
                    </div>

                    <div className="hidden md:flex flex-col items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-r from-violet-500/20 to-blue-500/20 border border-violet-500/20 flex items-center justify-center">
                        <ArrowRight className="w-4 h-4 text-violet-400" />
                      </div>
                    </div>

                    <div className="bg-gradient-to-br from-violet-500/10 to-blue-500/10 border border-violet-500/20 rounded-xl p-5 transition-all duration-300 hover:border-violet-400/30 relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                      <div className="relative flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
                          <answer.icon className={`w-4 h-4 ${answer.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-white/90 text-sm">{answer.agent}</h3>
                          <p className="text-xs text-white/60 mt-0.5">{answer.capability}</p>
                          {isExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                            >
                              <p className="text-xs text-violet-300/60 mt-2 font-mono">{answer.tools}</p>
                            </motion.div>
                          )}
                        </div>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                      </div>
                    </div>
                  </button>
                </motion.div>
              );
            })}
          </div>

          {!showAll && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center mt-8"
            >
              <button
                onClick={() => setShowAll(true)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/[0.05] border border-white/10 text-white/70 hover:text-white hover:bg-white/[0.08] transition-all text-sm"
                data-testid="button-show-all-steps"
              >
                Show All 9 Steps
                <ChevronDown className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </section>

        <section className="max-w-7xl mx-auto px-6 pb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-gradient-to-br from-violet-500/10 via-purple-500/5 to-blue-500/10 border border-violet-500/15 rounded-2xl p-8 md:p-12"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div>
                <h3 className="text-2xl md:text-3xl font-bold mb-4">
                  <span className="text-white/90">But here's the real difference:</span>
                </h3>
                <div className="space-y-4">
                  {[
                    { icon: Network, text: "16 specialized agents collaborate through an internal message bus — they don't just execute, they coordinate" },
                    { icon: Shield, text: "41 governance rules control autonomy levels, spending limits, and approval workflows" },
                    { icon: Brain, text: "4-layer Memory Palace persists context across sessions — nothing gets lost" },
                    { icon: Lock, text: "Full multi-tenant isolation — every tool, memory, and file scoped to your organization" },
                    { icon: Zap, text: "Heartbeat engine runs 11 scheduled tasks — research, monitoring, and briefings happen while you sleep" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <item.icon className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-white/60 leading-relaxed">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-black/30 rounded-xl p-6 border border-white/5">
                <div className="text-xs text-white/30 font-mono mb-4">{`// Founder's morning with ${pn}`}</div>
                <div className="space-y-3 text-sm font-mono">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span className="text-white/60">Research completed overnight</span>
                    <span className="text-white/20 ml-auto">3:00 AM</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span className="text-white/60">Competitor changes detected</span>
                    <span className="text-white/20 ml-auto">4:15 AM</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span className="text-white/60">Morning briefing generated</span>
                    <span className="text-white/20 ml-auto">6:00 AM</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span className="text-white/60">Outreach sequences sent</span>
                    <span className="text-white/20 ml-auto">7:30 AM</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-violet-400">▸</span>
                    <span className="text-white/80">You open your laptop</span>
                    <span className="text-white/20 ml-auto">8:00 AM</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-violet-400">▸</span>
                    <span className="text-white/80">Everything's already done</span>
                    <span className="text-white/20 ml-auto">☕</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        <section className="max-w-7xl mx-auto px-6 pb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center"
          >
            <h3 className="text-xl font-bold text-white/80 mb-6">The Team Behind the Automation</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {(data?.personas ?? []).map((p, i) => {
                const colors = [
                  "from-violet-500 to-purple-600",
                  "from-blue-500 to-cyan-500",
                  "from-emerald-500 to-green-500",
                  "from-amber-500 to-yellow-500",
                  "from-pink-500 to-rose-500",
                  "from-red-500 to-orange-500",
                  "from-indigo-500 to-blue-500",
                  "from-teal-500 to-cyan-500",
                  "from-fuchsia-500 to-pink-500",
                  "from-lime-500 to-green-500",
                  "from-sky-500 to-blue-500",
                  "from-orange-500 to-amber-500",
                  "from-rose-500 to-red-500",
                  "from-cyan-500 to-teal-500",
                ];
                return (
                  <motion.div
                    key={p.name}
                    initial={{ opacity: 0, scale: 0.9 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.04 }}
                    className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-center hover:border-white/15 transition-all"
                    data-testid={`persona-card-${p.name.toLowerCase().replace(/\s/g, '-')}`}
                  >
                    <div className={`w-10 h-10 mx-auto rounded-lg bg-gradient-to-br ${colors[i % colors.length]} flex items-center justify-center text-white font-bold text-sm mb-2`}>
                      {p.name.charAt(0)}
                    </div>
                    <div className="text-xs font-semibold text-white/80 truncate">{p.name}</div>
                    <div className="text-[10px] text-white/30 truncate mt-0.5">{p.role}</div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </section>

        <footer className="border-t border-white/5 py-8">
          <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <Bot className="w-4 h-4" />
              <span>{pn} Agent Platform</span>
            </div>
            <div className="flex items-center gap-6 text-xs">
              <a href="/architecture" className="text-white/40 hover:text-white/70 transition-colors" data-testid="link-footer-architecture">Architecture</a>
              <a href="/" className="text-white/40 hover:text-white/70 transition-colors" data-testid="link-footer-home">Home</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}