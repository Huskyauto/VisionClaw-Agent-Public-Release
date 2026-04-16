import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { useSiteConfig } from "@/hooks/use-site-config";
import {
  Brain, Cpu, Database, Globe, Shield, Users, Zap, Mail,
  MessageSquare, Layers, Activity, ArrowRight, ChevronDown,
  Bot, Cog, Eye, Lightbulb, RotateCw, Wrench, Clock,
  Network, FileText, Mic, Video, Search, Code
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
            operating with {stats.governanceRules} governance rules across {stats.skills} skills and {stats.tools || 195}+ tools
          </p>
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
          <StatCard label="Conversations" value={stats.conversations} icon={MessageSquare} color="from-violet-500 to-purple-600" delay={0} />
          <StatCard label="Messages" value={stats.messages} icon={FileText} color="from-blue-500 to-cyan-500" delay={0.1} />
          <StatCard label="Tools" value={stats.tools || 195} icon={Wrench} color="from-orange-500 to-red-500" delay={0.2} />
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
