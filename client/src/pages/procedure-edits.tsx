import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface EditRow {
  id: number;
  targetKind: string;
  targetId: string;
  status: string;
  diffSummary: string | null;
  proposedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  appliedAt: string | null;
  rolledBackAt: string | null;
}

interface EditDetail extends EditRow {
  beforeContent: string;
  afterContent: string;
  evidenceSummary: any;
  reviewNote: string | null;
  contentSha256Before: string;
  contentSha256After: string;
}

interface PerModelVote {
  lineage: string;
  model: string;
  verdict: string;
  confidence: number;
  reasoning: string;
  durationMs: number;
  error?: string;
}

interface CouncilVerdictRow {
  id: number;
  verdict: string;
  consensus_count: number;
  reviewer_count: number;
  plain_english_summary: string;
  per_model_votes: PerModelVote[];
  requested_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  final_decision: string | null;
  agreed_with_council: boolean | null;
}

const VERDICT_COLORS: Record<string, string> = {
  approve: "bg-emerald-600/20 text-emerald-200 border-emerald-700",
  reject: "bg-rose-600/20 text-rose-200 border-rose-700",
  needs_revision: "bg-amber-600/20 text-amber-200 border-amber-700",
  abstain: "bg-zinc-600/20 text-zinc-200 border-zinc-700",
  pending: "bg-blue-600/20 text-blue-200 border-blue-700",
  error: "bg-rose-700/20 text-rose-300 border-rose-700",
};

const LINEAGE_LABEL: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  deepseek: "DeepSeek",
};

function CouncilPanel({ editId, onVerdictIdChange }: { editId: number; onVerdictIdChange?: (id: number | null) => void }) {
  const { toast } = useToast();
  const q = useQuery<{ ok: boolean; verdict: CouncilVerdictRow | null }>({
    queryKey: ["/api/council-verdicts/by-edit", editId],
    queryFn: async () => {
      const r = await fetch(`/api/council-verdicts/by-edit/${editId}`, { credentials: "include" });
      return r.json();
    },
  });
  const requestMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/council-verdicts/request/${editId}`, {})).json(),
    onSuccess: (data: any) => {
      if (data?.ok || data?.verdict) {
        toast({ title: "Council verdict ready", description: data?.plainEnglishSummary?.slice(0, 140) || data?.verdict });
        queryClient.invalidateQueries({ queryKey: ["/api/council-verdicts/by-edit", editId] });
      } else {
        toast({ title: "Council failed", description: data?.reason || "unknown", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Council request failed", description: e?.message, variant: "destructive" }),
  });
  const v = q.data?.verdict;
  // R115 +sec — surface the rendered verdict id to the parent so the approve/
  // reject mutation can record final decision against THIS exact verdict, not
  // a newer one fetched after a concurrent re-run.
  if (onVerdictIdChange) onVerdictIdChange(v?.id ?? null);
  return (
    <div className="border rounded-md p-3 bg-muted/30" data-testid="panel-council">
      <div className="flex items-center justify-between mb-2">
        <Label className="text-sm font-semibold">External Review Council</Label>
        <Button
          size="sm"
          variant="outline"
          data-testid="button-request-council"
          onClick={() => requestMut.mutate()}
          disabled={requestMut.isPending}
        >
          {requestMut.isPending ? "Asking the Council…" : v ? "Re-run review" : "Request review"}
        </Button>
      </div>
      {q.isLoading ? (
        <div className="text-xs text-muted-foreground">Loading…</div>
      ) : !v ? (
        <div className="text-xs text-muted-foreground">
          No verdict yet. Three independent AI reviewers (OpenAI, Anthropic, Google) will read the proposed edit and
          return a plain-English recommendation. Bob makes the final call.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge className={VERDICT_COLORS[v.verdict] || ""} data-testid="badge-verdict">
              {v.verdict.replace("_", " ")}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {v.consensus_count} of {v.reviewer_count} agreed · {v.duration_ms ? `${Math.round(v.duration_ms / 100) / 10}s` : ""}
            </span>
          </div>
          <div className="text-sm leading-snug" data-testid="text-council-summary">
            {v.plain_english_summary}
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              See each reviewer's individual verdict
            </summary>
            <div className="mt-2 space-y-2">
              {(v.per_model_votes || []).map((vote, idx) => (
                <div key={idx} className="border-l-2 border-border pl-2" data-testid={`vote-${vote.lineage}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{LINEAGE_LABEL[vote.lineage] || vote.lineage}</span>
                    <Badge className={VERDICT_COLORS[vote.verdict] || ""}>{vote.verdict.replace("_", " ")}</Badge>
                    <span className="text-muted-foreground">conf {Math.round(vote.confidence * 100)}%</span>
                  </div>
                  <div className="text-muted-foreground mt-1">{vote.reasoning}</div>
                </div>
              ))}
            </div>
          </details>
          {v.final_decision && (
            <div className="text-xs text-muted-foreground">
              Bob's final call: <span className="font-semibold">{v.final_decision}</span>
              {v.agreed_with_council === true && " — agreed with Council"}
              {v.agreed_with_council === false && " — overrode Council"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  proposed: "bg-amber-600/20 text-amber-200 border-amber-700",
  approved: "bg-blue-600/20 text-blue-200 border-blue-700",
  rejected: "bg-zinc-600/20 text-zinc-200 border-zinc-700",
  applied: "bg-emerald-600/20 text-emerald-200 border-emerald-700",
  rolled_back: "bg-rose-600/20 text-rose-200 border-rose-700",
};

export default function ProcedureEditsPage() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [currentVerdictId, setCurrentVerdictId] = useState<number | null>(null);
  const [topic, setTopic] = useState("");
  const [windowDays, setWindowDays] = useState(30);
  const [reviewNote, setReviewNote] = useState("");

  const listQuery = useQuery<{ ok: boolean; edits: EditRow[] }>({
    queryKey: ["/api/procedure-edits", statusFilter],
    queryFn: async () => {
      const q = statusFilter === "all" ? "" : `?status=${encodeURIComponent(statusFilter)}`;
      const r = await fetch(`/api/procedure-edits${q}`, { credentials: "include" });
      return r.json();
    },
  });

  const detailQuery = useQuery<{ ok: boolean; edit: EditDetail }>({
    queryKey: ["/api/procedure-edits", selectedId],
    enabled: selectedId !== null,
    queryFn: async () => {
      const r = await fetch(`/api/procedure-edits/${selectedId}`, { credentials: "include" });
      return r.json();
    },
  });

  const proposeMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/procedure-edits/propose", {
        targetKind: "output_skill",
        targetId: topic.trim().toLowerCase(),
        evidenceWindowDays: windowDays,
      });
      return r.json();
    },
    onSuccess: (data: any) => {
      if (data?.ok) {
        toast({ title: "Edit proposed", description: `Edit #${data.editId} queued for review` });
        setTopic("");
        queryClient.invalidateQueries({ queryKey: ["/api/procedure-edits"] });
      } else {
        toast({ title: "Proposal not created", description: data?.reason || "unknown", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Propose failed", description: e?.message || "error", variant: "destructive" }),
  });

  const reviewMut = useMutation({
    mutationFn: async (vars: { id: number; decision: "approved" | "rejected"; verdictId?: number }) => {
      const r = await apiRequest("PATCH", `/api/procedure-edits/${vars.id}`, {
        decision: vars.decision,
        note: reviewNote || undefined,
      });
      // R115 +sec — record Bob's decision against the EXACT verdict id the UI
      // is showing (architect LOW-1: avoid attaching final decision to a newer
      // verdict if "re-run review" fired concurrently between render + click).
      // We prefer vars.verdictId (passed by the CouncilPanel via state); fall
      // back to fetching latest only if the panel hadn't loaded a verdict yet.
      try {
        let vid: number | undefined = (vars as any).verdictId;
        if (!vid) {
          const vq = await fetch(`/api/council-verdicts/by-edit/${vars.id}`, { credentials: "include" });
          const vj = await vq.json();
          vid = vj?.verdict?.id;
        }
        if (vid) {
          await apiRequest("POST", `/api/council-verdicts/${vid}/final`, { finalDecision: vars.decision });
        }
      } catch { /* silent — track-record is best-effort */ }
      return r.json();
    },
    onSuccess: (_d, vars) => {
      toast({ title: `Edit ${vars.decision}` });
      setReviewNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/procedure-edits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/council-verdicts/by-edit"] });
    },
    onError: (e: any) => toast({ title: "Review failed", description: e?.message, variant: "destructive" }),
  });

  const applyMut = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/procedure-edits/${id}/apply`, {})).json(),
    onSuccess: (data: any) => {
      if (data?.ok) {
        toast({ title: "Edit applied", description: "Playbook file + registry updated" });
      } else {
        toast({ title: "Apply failed", description: data?.reason || "unknown", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/procedure-edits"] });
    },
    onError: (e: any) => toast({ title: "Apply failed", description: e?.message, variant: "destructive" }),
  });

  const rollbackMut = useMutation({
    mutationFn: async (id: number) =>
      (await apiRequest("POST", `/api/procedure-edits/${id}/rollback`, { reason: reviewNote || "manual" })).json(),
    onSuccess: (data: any) => {
      if (data?.ok) {
        toast({ title: "Edit rolled back" });
      } else {
        toast({ title: "Rollback failed", description: data?.reason || "unknown", variant: "destructive" });
      }
      setReviewNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/procedure-edits"] });
    },
    onError: (e: any) => toast({ title: "Rollback failed", description: e?.message, variant: "destructive" }),
  });

  const edits = listQuery.data?.edits || [];
  const detail = detailQuery.data?.edit;

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Procedure Edits (AEvo)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          R114 — Meta-agent proposes minimal surgical edits to output-skill playbooks based on accumulated evidence.
          HITL-gated. Edit surface allowlist is type-level (output_skill only at launch). Safety surfaces are
          forbidden by validator — frontmatter name, safety_profile, intentGate, doctrine, persona souls cannot be touched.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Propose a new edit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="topic">Output-skill topic</Label>
              <Input
                id="topic"
                data-testid="input-topic"
                placeholder="e.g. prd-template"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="window">Evidence window (days)</Label>
              <Input
                id="window"
                data-testid="input-window"
                type="number"
                min={1}
                max={90}
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
              />
            </div>
            <div className="flex items-end">
              <Button
                data-testid="button-propose"
                disabled={!topic.trim() || proposeMut.isPending}
                onClick={() => proposeMut.mutate()}
              >
                {proposeMut.isPending ? "Gathering evidence…" : "Propose edit"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Queue</CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40" data-testid="select-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="proposed">proposed</SelectItem>
                <SelectItem value="approved">approved</SelectItem>
                <SelectItem value="rejected">rejected</SelectItem>
                <SelectItem value="applied">applied</SelectItem>
                <SelectItem value="rolled_back">rolled_back</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {listQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : edits.length === 0 ? (
              <div className="text-sm text-muted-foreground">No edits in this state.</div>
            ) : (
              <div className="space-y-2">
                {edits.map((e) => (
                  <button
                    key={e.id}
                    data-testid={`row-edit-${e.id}`}
                    onClick={() => setSelectedId(e.id)}
                    className={`w-full text-left p-3 rounded-md border transition hover:bg-accent ${
                      selectedId === e.id ? "border-primary" : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-mono text-xs">#{e.id} · {e.targetId}</div>
                      <Badge className={STATUS_COLORS[e.status] || ""}>{e.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{e.diffSummary || "—"}</div>
                    <div className="text-xs text-muted-foreground mt-1">{new Date(e.proposedAt).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {detail ? `Edit #${detail.id} — ${detail.targetId}` : "Select an edit to review"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!detail ? (
              <div className="text-sm text-muted-foreground">Pick a row from the queue.</div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_COLORS[detail.status] || ""}>{detail.status}</Badge>
                  <span className="text-xs text-muted-foreground">{detail.diffSummary}</span>
                </div>
                <CouncilPanel editId={detail.id} onVerdictIdChange={setCurrentVerdictId} />
                <div>
                  <Label className="text-xs">Evidence</Label>
                  <pre className="text-xs bg-muted p-2 rounded max-h-32 overflow-auto" data-testid="text-evidence">
                    {typeof detail.evidenceSummary === "object"
                      ? (detail.evidenceSummary?.summaryText ?? JSON.stringify(detail.evidenceSummary, null, 2))
                      : String(detail.evidenceSummary)}
                  </pre>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Before ({detail.contentSha256Before.slice(0, 8)})</Label>
                    <pre className="text-xs bg-muted p-2 rounded max-h-64 overflow-auto" data-testid="text-before">
                      {detail.beforeContent}
                    </pre>
                  </div>
                  <div>
                    <Label className="text-xs">After ({detail.contentSha256After.slice(0, 8)})</Label>
                    <pre className="text-xs bg-muted p-2 rounded max-h-64 overflow-auto" data-testid="text-after">
                      {detail.afterContent}
                    </pre>
                  </div>
                </div>
                <div>
                  <Label htmlFor="note">Review note / rollback reason</Label>
                  <Textarea
                    id="note"
                    data-testid="input-note"
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    rows={2}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.status === "proposed" && (
                    <>
                      <Button
                        data-testid="button-approve"
                        onClick={() => reviewMut.mutate({ id: detail.id, decision: "approved", verdictId: currentVerdictId ?? undefined })}
                        disabled={reviewMut.isPending}
                      >
                        Approve
                      </Button>
                      <Button
                        data-testid="button-reject"
                        variant="outline"
                        onClick={() => reviewMut.mutate({ id: detail.id, decision: "rejected", verdictId: currentVerdictId ?? undefined })}
                        disabled={reviewMut.isPending}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  {detail.status === "approved" && (
                    <Button
                      data-testid="button-apply"
                      onClick={() => applyMut.mutate(detail.id)}
                      disabled={applyMut.isPending}
                    >
                      {applyMut.isPending ? "Applying…" : "Apply to file"}
                    </Button>
                  )}
                  {detail.status === "applied" && (
                    <Button
                      data-testid="button-rollback"
                      variant="destructive"
                      onClick={() => rollbackMut.mutate(detail.id)}
                      disabled={rollbackMut.isPending}
                    >
                      {rollbackMut.isPending ? "Rolling back…" : "Rollback"}
                    </Button>
                  )}
                </div>
                {detail.reviewedBy && (
                  <div className="text-xs text-muted-foreground">
                    Reviewed by {detail.reviewedBy} on {new Date(detail.reviewedAt!).toLocaleString()}
                    {detail.reviewNote ? ` — ${detail.reviewNote}` : ""}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
