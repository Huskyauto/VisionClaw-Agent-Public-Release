import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Play, ChevronDown, ChevronRight, Clock, Bot, Wrench, CheckCircle2, XCircle, CircleDashed } from "lucide-react";

interface RunSummary {
  id: number;
  objective: string | null;
  source: string;
  status: string;
  plannedSteps: number;
  loggedSteps: number;
  createdAt: string;
  updatedAt: string;
}

interface ReplayStep {
  step: number;
  agent: string | null;
  task: string | null;
  tools: string[];
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  success: boolean | null;
  summary: string | null;
  output: string | null;
  notes: string | null;
  error: string | null;
  qualityScore: number | null;
  qualityRationale: string | null;
}

interface PendingStep {
  step: number;
  agent: string | null;
  task: string | null;
  tools: string[];
  executed: false;
}

interface RunDetail {
  id: number;
  objective: string | null;
  source: string;
  status: string;
  ceoDecision: string | null;
  ceoDecisionReason: string | null;
  createdAt: string;
  updatedAt: string;
  plannedStepCount: number;
  executedStepCount: number;
  steps: ReplayStep[];
  pendingSteps: PendingStep[];
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-300/40",
  executing: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-300/40",
  awaiting_approval: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-300/40",
  failed: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-300/40",
  rejected: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-300/40",
};

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function StepCard({ step }: { step: ReplayStep }) {
  const [open, setOpen] = useState(false);
  return (
    <Card data-testid={`card-replay-step-${step.step}`}>
      <button className="w-full text-left" onClick={() => setOpen(o => !o)} data-testid={`button-replay-step-toggle-${step.step}`}>
        <CardContent className="py-3 flex items-center gap-3">
          {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
          <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
            {step.step}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm">
              <Bot className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium">{step.agent || "agent"}</span>
              {step.model && <span className="text-xs text-muted-foreground truncate hidden md:inline">{step.model}</span>}
            </div>
            <p className="text-xs text-muted-foreground truncate">{step.summary || step.task || "—"}</p>
          </div>
          {step.qualityScore != null && (
            <Badge variant="outline" className="shrink-0 hidden sm:inline-flex">quality {step.qualityScore}</Badge>
          )}
          <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {fmtDuration(step.durationMs)}
          </span>
          {step.success === true && <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />}
          {step.success === false && <XCircle className="w-4 h-4 text-red-600 shrink-0" />}
          {step.success == null && <CircleDashed className="w-4 h-4 text-muted-foreground shrink-0" />}
        </CardContent>
      </button>
      {open && (
        <CardContent className="pt-0 pb-4 space-y-3 border-t mt-0">
          {step.task && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mt-3">Task given</div>
              <p className="text-sm whitespace-pre-wrap">{step.task}</p>
            </div>
          )}
          {step.tools.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
              {step.tools.map(t => (
                <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
              ))}
            </div>
          )}
          {step.output && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Output</div>
              <pre className="text-xs bg-muted rounded p-3 whitespace-pre-wrap max-h-72 overflow-y-auto">{step.output}</pre>
            </div>
          )}
          {step.error && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-red-600">Error</div>
              <pre className="text-xs bg-red-500/5 border border-red-300/30 rounded p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">{step.error}</pre>
            </div>
          )}
          {step.qualityRationale && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Grader rationale ({step.qualityScore}/100)</div>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{step.qualityRationale}</p>
            </div>
          )}
          {step.notes && <p className="text-xs text-muted-foreground italic">{step.notes}</p>}
        </CardContent>
      )}
    </Card>
  );
}

export default function WorkflowReplayPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: list, isLoading: listLoading } = useQuery<{ runs: RunSummary[] }>({
    queryKey: ["/api/agent-insights/runs"],
    queryFn: async () => {
      const r = await fetch("/api/agent-insights/runs?limit=50", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const { data: detail, isLoading: detailLoading } = useQuery<RunDetail>({
    queryKey: ["/api/agent-insights/runs", selectedId],
    enabled: selectedId != null,
    queryFn: async () => {
      const r = await fetch(`/api/agent-insights/runs/${selectedId}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  if (listLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const runs = list?.runs || [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="container mx-auto p-6 space-y-6 max-w-6xl">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2" data-testid="text-replay-title">
            <Play className="w-7 h-7" /> Workflow Replay
          </h1>
          <p className="text-muted-foreground mt-1">
            Step through any finished agent run — what each agent was asked, what it did, how long it took, and how it
            was graded. Read-only: nothing is re-executed.
          </p>
        </div>

        {runs.length === 0 && (
          <div className="p-10 text-center text-muted-foreground" data-testid="text-replay-empty">
            No orchestrated runs yet. When agents execute multi-step plans, they'll appear here for replay.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 items-start">
          <div className="space-y-2 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1">
            {runs.map(run => (
              <button
                key={run.id}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${selectedId === run.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                onClick={() => setSelectedId(run.id)}
                data-testid={`button-replay-run-${run.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground shrink-0">#{run.id}</span>
                  <Badge variant="outline" className={`ml-auto text-[10px] shrink-0 ${STATUS_COLORS[run.status] || ""}`}>
                    {run.status}
                  </Badge>
                </div>
                <p className="text-sm font-medium mt-1 line-clamp-2">{run.objective || "(no objective)"}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {run.loggedSteps}/{run.plannedSteps} steps · {new Date(run.createdAt).toLocaleString()}
                </p>
              </button>
            ))}
          </div>

          <div className="space-y-3 min-w-0">
            {selectedId == null && runs.length > 0 && (
              <div className="p-10 text-center text-muted-foreground border rounded-lg">
                Select a run on the left to replay it.
              </div>
            )}
            {detailLoading && selectedId != null && (
              <div className="p-10 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {detail && !detailLoading && (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      Run #{detail.id}
                      <Badge variant="outline" className={`${STATUS_COLORS[detail.status] || ""}`}>{detail.status}</Badge>
                      <span className="ml-auto text-xs font-normal text-muted-foreground">
                        {detail.executedStepCount}/{detail.plannedStepCount} steps executed
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <p className="text-sm whitespace-pre-wrap">{detail.objective}</p>
                    {detail.ceoDecision && (
                      <p className="text-xs text-muted-foreground">
                        CEO decision: <span className="font-medium">{detail.ceoDecision}</span>
                        {detail.ceoDecisionReason ? ` — ${detail.ceoDecisionReason}` : ""}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {detail.steps.map(s => <StepCard key={s.step} step={s} />)}

                {detail.pendingSteps.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Planned but not executed</p>
                    {detail.pendingSteps.map(s => (
                      <Card key={`p-${s.step}`} className="opacity-60">
                        <CardContent className="py-3 flex items-center gap-3">
                          <span className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">
                            {s.step}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{s.agent || "agent"}</div>
                            <p className="text-xs text-muted-foreground truncate">{s.task}</p>
                          </div>
                          <CircleDashed className="w-4 h-4 text-muted-foreground ml-auto shrink-0" />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
