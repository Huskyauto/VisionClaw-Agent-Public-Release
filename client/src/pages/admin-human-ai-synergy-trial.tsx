import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";

const CONDITIONS = [
  { key: "human_alone", label: "Human-alone" },
  { key: "ai_alone", label: "AI-alone" },
  { key: "human_ai", label: "Human + AI" },
] as const;
const DIMENSIONS = [
  { key: "outcomeQuality", label: "Outcome quality" },
  { key: "timeEfficiency", label: "Time efficiency" },
  { key: "errorDetection", label: "Error detection" },
  { key: "adaptation", label: "Adaptation" },
] as const;
type Scores = Record<(typeof DIMENSIONS)[number]["key"], number>;
const emptyScores = (): Scores => ({ outcomeQuality: 50, timeEfficiency: 50, errorDetection: 50, adaptation: 50 });

export default function AdminHumanAiSynergyTrialPage() {
  const queryClient = useQueryClient();
  const [trialName, setTrialName] = useState("");
  const [taskLabel, setTaskLabel] = useState("");
  const [participantAlias, setParticipantAlias] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [notes, setNotes] = useState("");
  const [securityPass, setSecurityPass] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [scores, setScores] = useState<Record<string, Scores>>(
    Object.fromEntries(CONDITIONS.map(({ key }) => [key, emptyScores()])),
  );
  const { data, isLoading } = useQuery<{ trials?: Array<Record<string, unknown>> }>({
    queryKey: ["/api/human-ai-synergy-trials"],
  });
  const save = useMutation({
    mutationFn: (body: unknown) => apiRequest("POST", "/api/human-ai-synergy-trials", body),
    onSuccess: () => {
      setSuccessMessage("Trial saved. The same idempotency key will return this saved result.");
      queryClient.invalidateQueries({ queryKey: ["/api/human-ai-synergy-trials"] });
    },
  });
  const updateScore = (condition: string, dimension: keyof Scores, value: string) => {
    const numeric = Number(value);
    setScores((current) => ({ ...current, [condition]: { ...current[condition], [dimension]: Number.isFinite(numeric) ? numeric : 0 } }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      trialName, taskLabel, participantAlias, idempotencyKey, notes: notes || undefined,
      securityPass,
      arms: CONDITIONS.map(({ key }) => ({ condition: key, measurements: scores[key] })),
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <header>
          <Badge variant="secondary">Owner workspace · observational</Badge>
          <h1 className="mt-3 text-2xl font-bold sm:text-3xl">Human-AI Synergy Trial</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Compare the same task under three conditions. This is task-specific observational evidence,
            not IQ, hiring, or causal evidence. The participant alias is operator-supplied; the server does not verify pseudonymity.
            Use a pseudonymous alias and do not enter sensitive/customer content.
            Both HUMAN_AI_SYNERGY_TRIAL_ENABLED and VITE_HUMAN_AI_SYNERGY_TRIAL_ENABLED must be set to 1.
          </p>
        </header>

        <form onSubmit={submit} className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Trial details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm">Trial name
                <Input required maxLength={120} value={trialName} onChange={(e) => setTrialName(e.target.value)} placeholder="Example: Invoice review pilot" />
              </label>
              <label className="space-y-1 text-sm">Task label
                <Input required maxLength={200} value={taskLabel} onChange={(e) => setTaskLabel(e.target.value)} placeholder="Example: Review one invoice" />
              </label>
              <label className="space-y-1 text-sm">Participant alias (operator-supplied)
                <Input required maxLength={120} value={participantAlias} onChange={(e) => setParticipantAlias(e.target.value)} placeholder="Example: reviewer-01 (use an alias)" />
              </label>
              <label className="space-y-1 text-sm">Idempotency key
                <Input required maxLength={80} value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} placeholder="Example: invoice-review-01" />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">Notes (optional, no sensitive/customer content)
                <Textarea maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Brief non-sensitive context, such as task version or measurement conditions." />
              </label>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            {CONDITIONS.map(({ key, label }) => (
              <Card key={key}>
                <CardHeader><CardTitle className="text-base">{label}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {DIMENSIONS.map(({ key: dimension, label: dimensionLabel }) => (
                    <label key={dimension} className="block space-y-1 text-sm">
                      <span>{dimensionLabel} <span className="text-muted-foreground">(0–100)</span></span>
                      <Input type="number" min={0} max={100} step={1} required aria-label={`${label} ${dimensionLabel}`} value={scores[key][dimension]} onChange={(e) => updateScore(key, dimension, e.target.value)} />
                    </label>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={securityPass} onChange={(e) => setSecurityPass(e.target.checked)} />
            Security pass: no safety or security policy failure occurred, and all conditions used a comparable bounded setup.
          </label>
          {successMessage && <p className="text-sm text-green-700" role="status">{successMessage}</p>}
          {save.isError && <p className="text-sm text-destructive" role="alert">The trial could not be saved. Check the fields and try again.</p>}
          <Button type="submit" className="min-h-11" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save trial"}</Button>
        </form>

        <section aria-labelledby="saved-trials-heading">
          <h2 id="saved-trials-heading" className="text-xl font-semibold">Saved results</h2>
          {isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading saved trials…</p> :
            (data?.trials || []).length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No trials saved yet.</p> :
              <div className="mt-3 space-y-3">{(data?.trials || []).map((trial, index) => (
                <Card key={String(trial.id || index)}><CardContent className="space-y-2 p-4 text-sm">
                  {(() => {
                    const result = (trial.result || {}) as Record<string, unknown>;
                    const resultScores = (result.scores || {}) as Record<string, number>;
                    return <>
                      <div className="flex flex-wrap justify-between gap-2"><strong>{String(trial.trialName || "Untitled trial")}</strong><Badge variant="outline">{String(result.verdict || "Recorded")}</Badge></div>
                      <div className="text-muted-foreground">Coverage: {String(result.coverage ?? "—")} · Human lift: {String(result.liftVsHuman ?? "—")} · AI lift: {String(result.liftVsAi ?? "—")}</div>
                      <div className="text-xs text-muted-foreground">Conservative verdict: {String(result.verdict || "Pending")}</div>
                      <div className="grid gap-2 text-xs sm:grid-cols-3">
                        {CONDITIONS.map(({ key, label }) => <div key={key} className="rounded border p-2"><strong>{label}</strong><div className="mt-1">Overall score: {String(resultScores[key] ?? "—")}/100</div></div>)}
                      </div>
                    </>;
                  })()}
                </CardContent></Card>
              ))}</div>}
        </section>
      </div>
    </div>
  );
}