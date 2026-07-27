import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { useSiteConfig } from "@/hooks/use-site-config";
import {
  Brain, Cpu, Database, Globe, Shield, Users, Zap, Mail,
  MessageSquare, Layers, Activity, ArrowRight, ChevronDown,
  Bot, Cog, Eye, Lightbulb, RotateCw, Wrench, Clock,
  Network, FileText, Mic, Video, Search, Code,
  CheckCircle2, ShoppingBag, Sparkles, ArrowRightLeft, ShieldCheck
} from "lucide-react";

interface ArchData {
  stats: Record<string, number>;
  personas: { name: string; role: string; costTier: string }[];
  architecture: {
    layers: { name: string; component: string; description: string }[];
    agentLoop: { steps: string[]; maxToolRounds: number; maxToolCallsPerRound: number; models: string[] };
  };
  uptime: number;
  status: string;
}

const layerIcons: Record<string, any> = {
  "CEO Orchestrator": Bot,
  "Persona Team": Users,
  "Tool Layer": Wrench,
  "Skill Layer": Lightbulb,
  "Memory System": Brain,
  "Governance": Shield,
  "Heartbeat Engine": Activity,
  "Communication": Globe,
};

const layerColors = [
  "from-violet-500 to-purple-600",
  "from-blue-500 to-cyan-500",
  "from-emerald-500 to-green-500",
  "from-amber-500 to-yellow-500",
  "from-pink-500 to-rose-500",
  "from-red-500 to-orange-500",
  "from-indigo-500 to-blue-500",
  "from-teal-500 to-cyan-500",
];

const loopStepIcons: Record<string, any> = {
  PERCEIVE: Eye,
  REASON: Brain,
  ACT: Zap,
  OBSERVE: Search,
  REPEAT: RotateCw,
};

const loopStepColors: Record<string, string> = {
  PERCEIVE: "#8b5cf6",
  REASON: "#3b82f6",
  ACT: "#10b981",
  OBSERVE: "#f59e0b",
  REPEAT: "#ef4444",
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

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

function AgentLoopVisualization({ steps }: { steps: string[] }) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep(prev => (prev + 1) % steps.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [steps.length]);

  const radius = 140;
  const centerX = 180;
  const centerY = 180;

  return (
    <div className="relative flex items-center justify-center" data-testid="agent-loop-viz">
      <svg width="360" height="360" viewBox="0 0 360 360">
        <circle cx={centerX} cy={centerY} r={radius + 15} fill="none" stroke="rgba(139,92,246,0.1)" strokeWidth="30" />
        
        {steps.map((step, i) => {
          const angle = (i * 2 * Math.PI) / steps.length - Math.PI / 2;
          const x = centerX + radius * Math.cos(angle);
          const y = centerY + radius * Math.sin(angle);
          const isActive = i === activeStep;
          const nextAngle = ((i + 1) * 2 * Math.PI) / steps.length - Math.PI / 2;
          const midAngle = angle + (nextAngle - angle) * 0.5;
          const arrowX = centerX + (radius + 2) * Math.cos(midAngle);
          const arrowY = centerY + (radius + 2) * Math.sin(midAngle);

          return (
            <g key={step}>
              <line
                x1={centerX + (radius - 35) * Math.cos(angle)}
                y1={centerY + (radius - 35) * Math.sin(angle)}
                x2={centerX + (radius - 35) * Math.cos(nextAngle)}
                y2={centerY + (radius - 35) * Math.sin(nextAngle)}
                stroke={isActive ? loopStepColors[step] : "rgba(148,163,184,0.2)"}
                strokeWidth={isActive ? 3 : 1.5}
                strokeDasharray={isActive ? "none" : "4 4"}
              />
              <motion.circle
                cx={x}
                cy={y}
                r={isActive ? 32 : 26}
                fill={isActive ? loopStepColors[step] : "rgba(30,30,50,0.8)"}
                stroke={loopStepColors[step]}
                strokeWidth={isActive ? 3 : 1.5}
                animate={{ scale: isActive ? [1, 1.1, 1] : 1 }}
                transition={{ duration: 0.6, repeat: isActive ? Infinity : 0 }}
              />
              <text
                x={x}
                y={y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                fontSize="9"
                fontWeight="bold"
                letterSpacing="0.5"
              >
                {step}
              </text>
            </g>
          );
        })}

        <motion.circle
          cx={centerX}
          cy={centerY}
          r="45"
          fill="url(#coreGradient)"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 3, repeat: Infinity }}
        />
        <text x={centerX} y={centerY - 8} textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">AGENT</text>
        <text x={centerX} y={centerY + 8} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="9">CORE</text>

        <defs>
          <radialGradient id="coreGradient">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#3b82f6" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}

function ArchitectureStack({ layers }: { layers: ArchData["architecture"]["layers"] }) {
  return (
    <div className="space-y-2" data-testid="architecture-stack">
      {layers.map((layer, i) => {
        const Icon = layerIcons[layer.name] || Layers;
        return (
          <motion.div
            key={layer.name}
            initial={{ opacity: 0, x: -40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.12 }}
            className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm hover:border-white/20 transition-all duration-300"
            data-testid={`layer-${layer.name.toLowerCase().replace(/\s/g, '-')}`}
          >
            <div className={`absolute inset-0 bg-gradient-to-r ${layerColors[i]} opacity-[0.07] group-hover:opacity-[0.15] transition-opacity`} />
            <div className="relative flex items-center gap-4 p-4">
              <div className={`flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br ${layerColors[i]} flex items-center justify-center shadow-lg`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{layer.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/70">{layer.component}</span>
                </div>
                <p className="text-xs text-white/50 mt-0.5 truncate">{layer.description}</p>
              </div>
              {i < layers.length - 1 && (
                <ChevronDown className="w-4 h-4 text-white/20 absolute -bottom-3 left-1/2 -translate-x-1/2 z-10" />
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function PersonaGrid({ personas }: { personas: ArchData["personas"] }) {
  const tierColors: Record<string, string> = {
    fast: "border-green-500/30 bg-green-500/5",
    balanced: "border-blue-500/30 bg-blue-500/5",
    powerful: "border-purple-500/30 bg-purple-500/5",
    reasoning: "border-amber-500/30 bg-amber-500/5",
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2" data-testid="persona-grid">
      {personas.map((p, i) => (
        <motion.div
          key={p.name}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.06 }}
          className={`rounded-lg border p-3 text-center ${tierColors[p.costTier] || tierColors.balanced}`}
        >
          <div className="text-lg mb-1">
            {p.name === "Felix" ? "👔" : p.name === "VisionClaw" ? "🐾" : p.name === "Forge" ? "⚙️" :
             p.name === "Luna" ? "⚖️" : p.name === "Radar" ? "🔍" : p.name === "Scribe" ? "✍️" :
             p.name === "Atlas" ? "📊" : p.name === "Apollo" ? "💰" : p.name === "Cassandra" ? "💵" :
             p.name === "Chief of Staff" ? "📋" : p.name === "Neptune" ? "🔬" : p.name === "Proof" ? "✅" :
             p.name === "Teagan" ? "📢" : p.name === "Agent Blueprint" ? "🏗️" : "🤖"}
          </div>
          <div className="text-xs font-bold text-white">{p.name}</div>
          <div className="text-[10px] text-white/40 mt-0.5 truncate">{p.role || p.costTier}</div>
        </motion.div>
      ))}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color, delay = 0 }: { label: string; value: number; icon: any; color: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="relative overflow-hidden rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm p-4"
      data-testid={`stat-${label.toLowerCase().replace(/\s/g, '-')}`}
    >
      <div className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl ${color} opacity-10 rounded-bl-full`} />
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <div>
          <div className="text-2xl font-bold text-white"><AnimatedCounter value={value} /></div>
          <div className="text-xs text-white/50">{label}</div>
        </div>
      </div>
    </motion.div>
  );
}

function DataFlowAnimation() {
  return (
    <div className="relative h-16 overflow-hidden rounded-xl border border-white/5 bg-black/20" data-testid="data-flow">
      <div className="absolute inset-0 flex items-center">
        {["User Input", "Felix", "Reason", "Tools", "Observe", "Response"].map((label, i) => (
          <div key={label} className="flex items-center">
            <motion.div
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: `hsla(${i * 60}, 70%, 50%, 0.15)`, color: `hsl(${i * 60}, 70%, 70%)` }}
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, delay: i * 0.4, repeat: Infinity }}
            >
              {label}
            </motion.div>
            {i < 5 && (
              <motion.div
                animate={{ x: [0, 8, 0], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.5, delay: i * 0.4, repeat: Infinity }}
              >
                <ArrowRight className="w-4 h-4 mx-1 text-white/30" />
              </motion.div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ArchitecturePage() {
  const { data, isLoading } = useQuery<ArchData>({ queryKey: ["/api/public/architecture"] });
  const { config } = useSiteConfig();
  const pn = config.platformName;

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <Cpu className="w-12 h-12 text-violet-500" />
        </motion.div>
      </div>
    );
  }

  const { stats, personas, architecture } = data;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-auto" data-testid="architecture-page">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-violet-900/20 via-transparent to-transparent pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <PulsingDot color="#10b981" />
            <span className="text-sm text-emerald-400 font-medium">LIVE SYSTEM — {formatUptime(data.uptime)} uptime</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight bg-gradient-to-r from-violet-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
            {pn} Architecture
          </h1>
          <p className="mt-3 text-lg text-white/50 max-w-2xl mx-auto">
            Multi-tenant agentic AI corporation — autonomous team of {stats.personas} AI personas
            operating with {stats.governanceRules} governance rules across {stats.skills} skills and {stats.tools || 272}+ tools, with R79 MarTech Bundle (6 new per-tenant brand-voice and social-content tools — build_voice_profile, get_voice_profile, generate_hooks, format_post, generate_content_matrix, score_post — hardened against prompt injection with fenced voice context, marker-stripping, and string-aware balanced-bracket JSON parsing), R77.5 KisMATH Reasoning Audit Rail (regime-aware routing, audit_reasoning_step + verify_math_chain tools, REASONING_GLUE_MISSING flag), R77.6 + R77.7 security hardening (15 surgical fixes from a four-architect + six-pronged whole-app review), and R76 Trust-Tier Policy Engine + Deliverable Contract Verification (Doctrine #12) all gating every risky action and every customer-facing claim.
            Built on 149 database tables, 453 TypeScript modules, ~180k lines of code, 158 security tests across 16 files in 6 categories, and a 36-curated AI model registry plus 1000+ daily auto-discovery via OpenRouter.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
          <StatCard label="Conversations" value={stats.conversations} icon={MessageSquare} color="from-violet-500 to-purple-600" delay={0} />
          <StatCard label="Messages" value={stats.messages} icon={FileText} color="from-blue-500 to-cyan-500" delay={0.1} />
          <StatCard label="Tools" value={stats.tools || 272} icon={Wrench} color="from-orange-500 to-red-500" delay={0.2} />
          <StatCard label="Skills" value={stats.skills} icon={Lightbulb} color="from-amber-500 to-yellow-500" delay={0.3} />
          <StatCard label="Memories" value={stats.memories} icon={Brain} color="from-pink-500 to-rose-500" delay={0.4} />
          <StatCard label="Emails" value={stats.emailsProcessed} icon={Mail} color="from-emerald-500 to-green-500" delay={0.5} />
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mb-10"
        >
          <DataFlowAnimation />
        </motion.div>

        <div className="grid md:grid-cols-2 gap-8 mb-12">
          <div>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <RotateCw className="w-5 h-5 text-violet-400" />
              Core Agent Loop
            </h2>
            <p className="text-sm text-white/40 mb-4">
              Each conversation runs up to {architecture.agentLoop.maxToolRounds} tool rounds with {architecture.agentLoop.maxToolCallsPerRound} parallel tool calls per round
            </p>
            <AgentLoopVisualization steps={architecture.agentLoop.steps} />
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {architecture.agentLoop.models.map(m => (
                <span key={m} className="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/60">{m}</span>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-400" />
              Architecture Stack
            </h2>
            <p className="text-sm text-white/40 mb-4">
              8-layer architecture — from CEO orchestration to multi-channel communication
            </p>
            <ArchitectureStack layers={architecture.layers} />
          </div>
        </div>

        <div className="mb-12">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-cyan-400" />
            AI Team — {personas.length} Autonomous Personas
          </h2>
          <p className="text-sm text-white/40 mb-4">
            Each persona has specialized skills, their own cost tier, and can be delegated tasks by Felix
          </p>
          <PersonaGrid personas={personas} />
        </div>

        <div className="mb-12">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-violet-400" />
            80→95% Autonomy Layer
          </h2>
          <p className="text-sm text-white/40 mb-6">
            The newest layer pushing end-to-end corporate autonomy from ~80% to ~95% — interrupt/resume approvals, decision-confidence scoring, and revenue-vs-cost self-regulation.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Shield, title: "Interrupt & Resume", desc: "request_approval / decide_approval / list_pending_approvals — long-running plans pause for human sign-off and resume exactly where they left off. Heartbeat sweep auto-expires stale approvals so plans never stall." },
              { icon: Eye, title: "Decision Confidence", desc: "commit_decision logs every autonomous decision with a confidence score, expected outcome, and reasoning trail. Per-tenant audit trail; low-confidence calls escalate, high-confidence execute." },
              { icon: Activity, title: "Revenue vs. Cost", desc: "revenue_vs_cost + auto-router burn-ratio throttle. When spend ÷ revenue exceeds threshold, the router downgrades to cheaper models and lighter tools automatically — gated to owner tenant." },
              { icon: Database, title: "Per-Agent Cost Ledger", desc: "agent_cost_summary aggregates every tool call, model call, and orchestration against the responsible agent. Tenant-scoped, queryable in real time." },
              { icon: Cog, title: "Hardened Webhooks", desc: "Coinbase Commerce webhook now hard-rejects unsigned requests (was accepting them — payment-spoofing risk). updateRunState uses JSONB-concat merge to eliminate lost-update races." },
              { icon: Wrench, title: "Strict Tool Aliases", desc: "Fuzzy substring tool matching replaced with an explicit alias allowlist. Agents can only invoke tools by exact name or pre-approved alias — no accidental tool misfires." },
              { icon: ShoppingBag, title: "Service Review Queue", desc: "Every paid service-product order (e.g. the $49 Custom AI Research Report) is generated post-payment, runs through automated QA (file size, page count, per-section depth, placeholder detection), and lands in an admin review queue. The customer gets a holding email; the owner gets a review link with the PDF embedded for proofread + a single Approve & Ship button. No deliverable reaches a customer unverified." },
              { icon: CheckCircle2, title: "Auto-Ship Graduation", desc: "Per-SKU clean-ship counter. After N (default 10) consecutive clean manual ships and zero broken deliveries, the owner can flip auto-ship ON for that SKU and new orders bypass manual review when QA passes. If any auto-shipped delivery ever fails link verification, auto-ship for that SKU snaps back OFF and a fresh streak must be earned. Lets each product graduate to full autonomy at its own pace." },
              { icon: Database, title: "Webhook Idempotency & Recovery", desc: "Stripe is at-least-once. The service-fulfillment webhook serializes queue writes, dedupes by Stripe session id, and wraps the whole branch in a recovery net — any unexpected exception still persists a 'failed' review item plus alerts the owner, so a paid order can never silently vanish." },
            ].map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                className="rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/5 to-blue-500/5 p-4"
                data-testid={`card-autonomy-${f.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <f.icon className="w-4 h-4 text-violet-400" />
                  <h3 className="font-semibold text-sm">{f.title}</h3>
                </div>
                <p className="text-xs text-white/50 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="mb-12">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            Self-Healing & Resilience Layer
          </h2>
          <p className="text-sm text-white/40 mb-6">
            When an agent's tool call fails, the platform doesn't just log the error and stop — it diagnoses the failure, attempts a fix, and resumes the work. If a capability is missing entirely, it researches a solution and builds a new tool.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Wrench, title: "Self-Healing Supervisor", desc: "self_heal / self_heal_log / self_heal_inspect — when a tool fails, the supervisor inspects the error, classifies it (transient, auth, schema, permission, missing-capability), picks a fix strategy, and retries. Hard cap of 20 heal attempts per tenant per hour to prevent runaway loops." },
              { icon: Sparkles, title: "Auto Tool Builder", desc: "Skill Seeker detects when an agent can't accomplish a task because a capability is missing. It searches GitHub and npm for proven solutions, scores trust, and — for high-trust matches — generates a new tool that gets registered into the live registry without restart." },
              { icon: Shield, title: "5-Layer Safety Gate", desc: "Every auto-built tool passes through trusted-domain allowlist, code scanner (25+ dangerous patterns), prompt-injection detector, LLM security assessment, and three-tier trust scoring before going live. Low-trust gets blocked, medium-trust queues for admin review, high-trust auto-deploys." },
              { icon: ArrowRightLeft, title: "3-Layer Failure Recovery", desc: "Self-correction retry → lean-mode fallback → backup-agent reroute. If Radar's research call fails, Neptune takes over. If Scribe's writing fails, VisionClaw steps in. Every failure ends with a 5-part explanation so users always understand what happened." },
              { icon: Eye, title: "Heartbeat Watchdog", desc: "Background process every 60s that detects stalled runs, expired approvals, and stuck agents. Auto-clears dead state so the system never gets pinned by a single failure. Chief of Staff stability check every 10 minutes." },
              { icon: Database, title: "Health Monitor", desc: "300-second interval health check across 6 critical subsystems (DB, providers, sessions, tokens, queues, storage). Surfaces issues before they cascade. Boots clean every restart with provider key validation and tool-registry audit." },
              { icon: Cog, title: "Atomic State Recovery", desc: "Run state updates use JSONB-concat merge instead of read-modify-write — eliminates lost-update races when multiple agents touch the same plan. Failed runs can be resumed from exact checkpoint without replaying completed steps." },
              { icon: CheckCircle2, title: "Strict Tool Aliases", desc: "Fuzzy substring tool matching replaced with explicit alias allowlist. Combined with tool-registry startup audit, every tool definition is reachable and every dispatch path is registered — no invisible tools, no accidental misfires." },
              { icon: Lightbulb, title: "Pattern Graduation", desc: "Successful multi-tool sequences get extracted as reusable skill patterns. After 3+ successful reuses, patterns graduate to permanent knowledge so the same problem solves itself faster the next time." },
            ].map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                className="rounded-xl border border-white/10 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 p-4"
                data-testid={`card-resilience-${f.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <f.icon className="w-4 h-4 text-emerald-400" />
                  <h3 className="font-semibold text-sm">{f.title}</h3>
                </div>
                <p className="text-xs text-white/50 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="mb-12">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-rose-400" />
            Production Hardening
          </h2>
          <p className="text-sm text-white/40 mb-6">
            <strong className="text-rose-300">R76 Trust-Tier Policy Engine + Deliverable Contract Verification</strong> — every risky tool call now passes through `evaluatePolicy()` which ranks per-tenant `tool_policies` rows by specificity (recipient_pattern &gt; tool_action &gt; tool; deny beats allow; amount-cap bypass forces require_approval) with a hardcoded NEVER_AUTO_APPROVE veto on `set_policy`/`create_tool`/`delete_custom_tool`/`manage_skills`/`lobster` so even a self-issued allow rule cannot escalate. Every claimed customer-facing deliverable (HTML/PDF/deck/video/audio/image/CSV/JSON) is then checked by the supervisor against an 8-contract registry (extension allowlist + magic-byte MIME sniff + render check) and `DELIVERABLE_VERIFICATION_FAILED` / `_UNVERIFIED` issues feed back into the chat-engine correction loop until the persona produces a verifiable artifact. Path-jail on `verifyDeliverable` (ALLOWED_FILE_ROOTS + realpath symlink check). All 16 personas carry Doctrine #12. Architect PASS after two re-review cycles closing 2 CRITICAL + 3 HIGH + 1 MEDIUM. 11/11 R76 e2e regression tests green. Bonus: 14+ pre-existing ESM `require()` landmines swept (scan_file path-jail security sandbox, smart tool router, 5+ auto-tuner consumers — all silent-failing under ESM, all now using static or lazy `await import()`). Multiple rounds of whole-app architect security review (R63.17, R74, R74.3, R74.5, R74.13d, R74.13g, R74.13u-sec, R74.13u-2, R74.13v, R74.13w, R74.13x, R74.13y, R75, R75.1, R76) closed every CRITICAL and HIGH finding. R74.13y also shipped the Felix Loop verification rail — every plan step now carries an expected_post_state JSONB contract, and a deterministic post-execution verifier rejects unverified outputs and forces retry/escalate before the step is marked complete; R74.13x exposed the 252-tool surface as one-click MCP plugins in Claude Code, Cursor, and OpenAI Codex CLI marketplaces under per-tenant Bearer-key isolation. As of R74.13u-2, the Stripe + Coinbase webhook subsystem uses a durable `webhook_events` table with a claim-then-commit dedupe pattern (PK on provider+event_id, completed_at NULL until side effects succeed) — a transient processing failure leaves the row uncommitted so the next provider retry is allowed through, closing a class of silently-dropped revenue events. A 6-hour scheduler GCs committed dedupe rows older than 14 days while explicitly preserving in-flight claims. As of R74.13u-sec, platform-admin routes (Lobster) hard-gated to `requirePlatformAdmin` (admin tenant + admin role); Stripe Checkout validates priceId against live `stripe.prices`+`stripe.products` (active=true) and refuses non-canonical domains in production; `decryptApiKey` throws `DecryptionError` on `enc:v1:` failure (no silent ciphertext leak); Drive backup of conversations is now scoped by `tenant_id`; CSRF tokens are keyed per-session (Bearer-hash → Replit `sub` → tenantId). The platform is single-tenant production-ready with multi-tenant safe defaults in place across foreground tool execution AND background services. As of R74.13g, every one of the 138 schema tables is classified by tenant-scoping bucket (80 strict, 5 fail-open documented, 3 nullable, 4 parent-linked, 8 global); the new `tenantScope()` storage helper rejects every fail-open shape (zero, NaN, negative, fractional, string-coerced, null, boolean, object); the new `assertTenantContext()` runtime guard runs at 4 entry points (heartbeat L599/L679/L788, chat-engine L1973) and threads the asserted tenantId through 17 chat-engine sites + 4 hardcoded `tenantId: 1` writes in `processTaskOutput` + 5 daily-note/memory-archive helpers; an end-to-end propagation test exercises a live-DB persist round-trip through chat → assertTenantContext → step-ledger → AsyncLocalStorage → recordExecution. As of R74.13d, the heartbeat engine's working memory, knowledge writes, daily notes, task list, and activity logs are all tenant-scoped at the storage layer; Telegram bot tokens and WhatsApp/Baileys session credentials are encrypted with AES-256-GCM at rest; password reset tokens and email verification codes are stored as HMAC-SHA256 hashes; upload-signing fail-closes in production without `SESSION_SECRET`; OAuth callback host is pinned to an allowlist.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Shield, title: "Tenant Isolation", desc: "Memory CRUD operations accept optional tenantId for cross-tenant IDOR protection. Chunked uploads bind to tenant at init time and reject cross-tenant chunk injection." },
              { icon: Wrench, title: "Tool Dispatch Hardening", desc: "Both SSE chat paths strip underscore-prefixed args from model output before forcing _tenantId + _invokedByModel=true. The exec tool refuses model invocation entirely — agents must request approval." },
              { icon: Cog, title: "Admin-Gated Config", desc: "Persona and skill mutation endpoints now require admin scope. These tables are platform-wide config — without the gate, any authenticated key could rewrite agent behavior for everyone." },
              { icon: Eye, title: "Scope-Order Fix", desc: "API key scope rules now evaluated before the GET-with-read auto-allow. Closes a path where read-scoped keys could hit admin endpoints via GET." },
              { icon: Database, title: "Upload Safety", desc: "Per-tenant cap of 10 concurrent uploads, 1000 chunks max, 50MB total. Duplicate chunks rejected, oversized payloads cleaned up immediately, error responses no longer echo internal details." },
              { icon: Activity, title: "Webhook Verification", desc: "Coinbase Commerce webhook hard-rejects unsigned requests. Stripe and other payment webhooks require signature verification before any state mutation." },
              { icon: Brain, title: "R77.5 KisMATH Reasoning Audit Rail", desc: "Seven shippable nuggets from arxiv 2507.11408v2 (KisMATH — Causal CoT Graphs): (1) every model in the registry tagged with trainingRegime (rlvr/distilled/sft/base) so the platform knows which models collapse the answer distribution; (2) auto-router prefers non-RLVR models for high-complexity reasoning + agentic categories (RLVR is exploitation-strong but exploration-poor); (3) execution-supervisor flags REASONING_GLUE_MISSING when a multi-step trace lacks discourse connectives (\"therefore/because/since/thus/if-then\") — KisMATH §5.4 shows that pattern correlates with pattern-matched non-causal reasoning; (4) audit_reasoning_step tool masks each step in a chain, regenerates with a cheap model, and computes per-step causalScore via Jaccard divergence + numeric mismatch (behavioral surrogate for KisMATH attention-suppression); (5) verify_math_chain tool deterministically re-executes named arithmetic steps with substitution + safe Function-eval, reporting per-step pass/fail, unit mismatches, and load-bearing vs decorative steps; (6) MoA mode='exploration' auto-rebalances the proposer ensemble so >=50% are non-RLVR (distilled/base/sft) for ideation/debate; (7) agent-eval second-pass cross-checks borderline judgments against gemini-2.5-flash and surfaces disagreements as POSSIBLE_ANNOTATION_ERROR rather than burying them in a single-judge verdict. Tool count 264 → 266." },
              { icon: Shield, title: "R77.6 Security Hardening v1 (11 fixes)", desc: "Four-architect whole-platform review yielded 11 surgical fixes: (1) `auth.ts` SESSION_SECRET hard-fails in production instead of falling back to a dev-only constant; (2) `crypto.ts` warns once when AES-256-GCM falls back to legacy plaintext (was silent — masked unencrypted credentials); (3) `storage.ts` `_warnUnscoped` helper instruments every tenant-fail-open read so background-service scope drift is visible; (4) `felix-loop.ts` budget-cap check throttled to a 4h DB interval (was firing every iteration — billing rail safe); (5) `exec-tool.ts` strips its environment to a known allowlist before spawning the sandboxed child; (6) `routes.ts` 30-req/min cap on unauth `/api/*` paths; (7-11) tenantId threading through `memory.ts`, `conversations.ts`, `api-v1.ts`, `sessions.ts`, and `chat-engine.ts` callsites that previously read tenant-scoped tables without scope. Commit ae0a2df." },
              { icon: ShieldCheck, title: "R77.7 Security Hardening v2 (4 fixes)", desc: "Six-pronged parallel architect review (today's work, multi-tenant isolation, auth/crypto, tool execution, external integrations, public endpoints/DoS) — 30+ raw findings triaged down to 4 verified real issues, all shipped: (1) `routes.ts` `tenantRateLimiter` fail-CLOSED on 10000-entry saturation — previously a saturated bucket map silently allowed the request through, so 10000 unique X-Forwarded-For values bypassed rate limiting entirely; now returns 429 \"Rate limiter saturated\" once pruning fails; (2) `auth.ts` `loginAttempts` Map capped at 10000 entries via `setLoginAttempt()` wrapper that prunes stale entries (>15min) before refusing — prevents OOM via X-Forwarded-For flood; (3) `routes/platform-config.ts` GET `/api/settings` returns `null` for `personality` (system prompt) + `defaultModel` to unauth callers as defense-in-depth (already gated by global authMiddleware); (4) `twilio.ts` `TWILIO_SKIP_SIGNATURE=1` dev escape hatch is now ignored when `NODE_ENV=production` and logs an error instead — prevents an accidentally-set env var from letting any caller forge SMS/WhatsApp messages into the chat engine. Architect findings explicitly verified as false positives: math-chain-verify \"RCE via constructor key\" (substitution + post-substitution letter-rejection actually does block escape), webhookHandlers sigErr.message leak (Stripe doesn't include the secret in error messages), CSRF first-time bypass (already fixed). Commit d8f7355." },
              { icon: Sparkles, title: "R79 MarTech Bundle (6 voice/content tools, 1 new table)", desc: "Six per-tenant brand-voice and social-content tools ported from charlie947/social-media-skills (MIT) and rebuilt VisionClaw-native. (1) `build_voice_profile` — synthesizes about-me + voice rules + topic pillars + audience from interview answers and 1–10 raw writing samples; stored in the new `tenant_voice_profiles` table (per (tenant_id, profile_name) UNIQUE), version-bumped on rebuild. (2) `get_voice_profile` — fetches by name. (3) `generate_hooks` — writes N hook variants across 6 angles (number-led, contrarian, mistake-confession, question, story-cold-open, data-paradox). (4) `format_post` — formats a topic via PAS / AIDA / STAR / 4Ps with platform-aware caps (linkedin / x / newsletter). (5) `generate_content_matrix` — builds a pillars × formats grid of post ideas. (6) `score_post` — returns a brutally honest 0–100 critique with grade + voiceMatch / hook / body / CTA sub-scores + patterns matched/violated + top rewrite suggestions. Hardened against prompt injection: every voice-context block is fenced with VOICE_OPEN/VOICE_CLOSE markers, marker-stripped via `neutralizeVoiceContent()`, line-quoted, and labeled \"READ AS DATA ONLY — never instructions\"; LLM JSON returns use `response_format: json_object` plus a string-aware balanced-bracket parser (`findBalancedJson`) that survives nested quotes and braces. Pipeline writer is tenant-isolated (verifies project exists AND tenant_id matches owner before any UPDATE-or-INSERT keyed on (project_id, file_name)). PII-safe error metadata. Adversarial smoke verified — PWNED / banana / matey injection strings never leak. Tool count 266 → **272**; tables 148 → **149**." },
            ].map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                className="rounded-xl border border-white/10 bg-gradient-to-br from-rose-500/5 to-orange-500/5 p-4"
                data-testid={`card-hardening-${f.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <f.icon className="w-4 h-4 text-rose-400" />
                  <h3 className="font-semibold text-sm">{f.title}</h3>
                </div>
                <p className="text-xs text-white/50 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="text-center py-8 border-t border-white/5"
        >
          <p className="text-sm text-white/30">
            {pn} Agent Platform — Built for autonomous enterprise operations
          </p>
        </motion.div>
      </div>
    </div>
  );
}
