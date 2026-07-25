import { Badge } from "@/components/ui/badge";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import {
  Clock, Cpu, ShieldCheck, Gauge, Database, BookOpen, RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type LoopStage = {
  n: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  guards: string[];
};

const LOOP_STAGES: LoopStage[] = [
  {
    n: "01",
    icon: Clock,
    title: "Trigger",
    desc: "Loops start themselves — no human prompt required.",
    guards: ["Heartbeat + scheduled tasks", "Jury queue drainer", "Nightly research & audits"],
  },
  {
    n: "02",
    icon: Cpu,
    title: "Execution",
    desc: "16 personas act with chunk-and-parallel fan-out.",
    guards: ["Up to 8 parallel agents", "Long jobs split into ≤5-min chunks", "Fresh context per subagent"],
  },
  {
    n: "03",
    icon: ShieldCheck,
    title: "Verification",
    desc: "A separate model grades every output — never self-graded.",
    guards: ["Completion-verification vs goal contract", "Chain-of-Verification (CoVe)", "MoA jury κ concordance routing"],
  },
  {
    n: "04",
    icon: Gauge,
    title: "Stop Rules",
    desc: "Success, failure, AND budget all terminate the loop.",
    guards: ["Checkable loop contracts", "Atomic daily budget claim", "2-failed-attempts circuit breaker"],
  },
  {
    n: "05",
    icon: Database,
    title: "Memory",
    desc: "Progress checkpoints to disk; crashes resume, never repeat.",
    guards: ["Checkpoint / resume pipeline", "Step ledger audit trail", "Confidence-scored Memory V2"],
  },
  {
    n: "06",
    icon: BookOpen,
    title: "Briefing",
    desc: "Frozen instructions read at the start of every run.",
    guards: ["133 skills across 3 registries", "Per-persona operating contracts", "SHA-256-pinned runbook registry"],
  },
];

export function LoopAnatomySection() {
  return (
    <section id="section-loop-anatomy" className="py-20 px-6 bg-muted/30 border-t border-border" data-testid="section-loop-anatomy">
      <div className="max-w-5xl mx-auto">
        <RevealOnScroll>
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-4">Loop Engineering</Badge>
            <h2 className="text-3xl font-bold mb-3">The anatomy of a VisionClaw loop</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Agents that prompt themselves. Every autonomous loop on the platform runs the same six-part
              cycle — triggered on schedule, verified by a separate model, and hard-stopped by budget.
            </p>
          </div>
        </RevealOnScroll>
        <RevealOnScroll>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-100 overflow-hidden shadow-lg" data-testid="card-loop-anatomy">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900/60">
              <span className="w-3 h-3 rounded-full bg-red-500/80" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
              <span className="ml-2 font-mono text-xs text-zinc-400">visionclaw_loop_system.md</span>
              <span className="ml-auto font-mono text-xs text-emerald-400">production · live</span>
            </div>
            <div className="p-5 sm:p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {LOOP_STAGES.map(({ n, icon: Icon, title, desc, guards }) => (
                  <div
                    key={n}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2"
                    data-testid={`card-loop-stage-${n}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-emerald-500/40 text-emerald-400">{n}</span>
                      <Icon className="w-4 h-4 text-emerald-400" />
                      <span className="font-semibold text-sm">{title}</span>
                    </div>
                    <p className="text-xs text-zinc-400 leading-relaxed">{desc}</p>
                    <ul className="space-y-1">
                      {guards.map((g) => (
                        <li key={g} className="font-mono text-[11px] text-zinc-300 flex gap-1.5">
                          <span className="text-emerald-500 shrink-0">▸</span>
                          <span>{g}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 font-mono text-[11px] sm:text-xs text-zinc-300 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="text-loop-cycle">
                <RefreshCw className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-emerald-400">TRIGGER</span><span className="text-zinc-600">→</span>
                <span>EXECUTE</span><span className="text-zinc-600">→</span>
                <span className="text-emerald-400">VERIFY</span><span className="text-zinc-600">→</span>
                <span>STOP&nbsp;/&nbsp;RETRY</span><span className="text-zinc-600">→</span>
                <span className="text-emerald-400">CHECKPOINT</span><span className="text-zinc-600">→</span>
                <span>LEARN</span>
                <span className="ml-auto text-zinc-500">every loop · every run · no exceptions</span>
              </div>
            </div>
          </div>
        </RevealOnScroll>
        <RevealOnScroll>
          <p className="text-center text-xs text-muted-foreground mt-4">
            Disagreement between verifier models (κ &lt; 0.5) escalates to human review automatically — verification theater is itself monitored.
          </p>
        </RevealOnScroll>
      </div>
    </section>
  );
}
