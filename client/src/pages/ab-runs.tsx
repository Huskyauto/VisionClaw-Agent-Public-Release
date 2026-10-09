import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AbRun } from "@shared/schema";

type Ranking = Array<{ configLabel: string; avgScore: number; runs: number }>;
type RunResult = { configLabel: string; runIndex: number; output: string; score: number; critique: string; error?: string };

export default function AbRunsPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, isLoading } = useQuery<{ abRuns: AbRun[] }>({ queryKey: ["/api/ab-runs"] });
  const { data: detail } = useQuery<{ abRun: AbRun }>({
    queryKey: ["/api/ab-runs", selectedId],
    enabled: selectedId !== null,
  });
  const runs = data?.abRuns || [];
  const selected = detail?.abRun || null;
  const results: RunResult[] = (selected?.results as RunResult[] | null) || [];

  return (
    <div className="container mx-auto py-8 px-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" data-testid="heading-ab-runs">Cross-Run A/B Evaluations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Same prompt, different agent configs, scored by an LLM judge against your rubric. Created via the <code>run_ab_eval</code> tool.
        </p>
      </div>

      <div className="grid lg:grid-cols-[360px,1fr] gap-6">
        <div className="space-y-2" data-testid="list-ab-runs">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : runs.length === 0 ? (
            <Card><CardContent className="py-6 text-center text-sm text-muted-foreground" data-testid="text-empty">
              No A/B runs yet. Ask an agent to call <code>run_ab_eval</code>.
            </CardContent></Card>
          ) : runs.map((r) => {
            const ranking = (r.ranking as Ranking | null) || [];
            const top = ranking[0];
            return (
              <Card
                key={r.id}
                className={`cursor-pointer hover-elevate ${selectedId === r.id ? "border-primary" : ""}`}
                onClick={() => setSelectedId(r.id)}
                data-testid={`card-ab-run-${r.id}`}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm" data-testid={`text-name-${r.id}`}>{r.name}</div>
                    <Badge variant={r.status === "complete" ? "secondary" : r.status === "failed" ? "destructive" : "default"}>
                      {r.status}
                    </Badge>
                  </div>
                  {top && (
                    <div className="text-xs text-muted-foreground" data-testid={`text-top-${r.id}`}>
                      Winner: <span className="text-foreground font-medium">{top.configLabel}</span> ({top.avgScore}/100)
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {Array.isArray(r.configs) ? (r.configs as any[]).length : 0} configs · {r.runsPerConfig}× runs
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div>
          {!selected ? (
            <Card><CardContent className="py-16 text-center text-sm text-muted-foreground" data-testid="text-select-prompt">
              Select an A/B run on the left to see the breakdown.
            </CardContent></Card>
          ) : (
            <div className="space-y-4" data-testid={`detail-ab-run-${selected.id}`}>
              <Card>
                <CardHeader><CardTitle className="text-base">{selected.name}</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <div className="text-xs uppercase text-muted-foreground mb-1">Prompt</div>
                    <div className="bg-muted/40 p-3 rounded border border-border/40 whitespace-pre-wrap" data-testid="text-prompt">{selected.prompt}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground mb-1">Rubric</div>
                    <div className="bg-muted/40 p-3 rounded border border-border/40 whitespace-pre-wrap" data-testid="text-rubric">{selected.rubric}</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Ranking</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2" data-testid="list-ranking">
                    {((selected.ranking as Ranking | null) || []).map((row, i) => (
                      <div key={row.configLabel} className="flex items-center gap-3 p-2 rounded bg-muted/30" data-testid={`row-rank-${i}`}>
                        <Badge variant={i === 0 ? "default" : "outline"}>#{i + 1}</Badge>
                        <div className="font-medium text-sm flex-1">{row.configLabel}</div>
                        <div className="text-sm font-mono">{row.avgScore}/100</div>
                        <div className="text-xs text-muted-foreground">{row.runs} run{row.runs === 1 ? "" : "s"}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Per-run details</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3" data-testid="list-results">
                    {results.map((r, i) => (
                      <details key={i} className="border border-border/40 rounded p-3 bg-muted/20" data-testid={`result-${i}`}>
                        <summary className="cursor-pointer flex items-center gap-2 text-sm">
                          <Badge variant="outline">{r.configLabel}</Badge>
                          <span className="text-xs text-muted-foreground">run #{r.runIndex + 1}</span>
                          <span className="ml-auto font-mono text-sm">{r.score}/100</span>
                        </summary>
                        <div className="mt-3 space-y-2 text-xs">
                          {r.critique && (
                            <div><span className="font-medium">Critique:</span> {r.critique}</div>
                          )}
                          {r.error && (
                            <div className="text-destructive"><span className="font-medium">Error:</span> {r.error}</div>
                          )}
                          <pre className="whitespace-pre-wrap bg-background p-2 rounded border border-border/40 max-h-64 overflow-auto">{r.output}</pre>
                        </div>
                      </details>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
