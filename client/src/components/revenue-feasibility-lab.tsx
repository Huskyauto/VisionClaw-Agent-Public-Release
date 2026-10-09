import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  evaluateTriagePredictions,
  getTriageFixtureView,
  makeExamplePrediction,
  REFERENCE_RULES_VERSION,
  SMART_LEADS_CORPUS,
  SMART_LEADS_CORPUS_VERSION,
  SYNTHETIC_COMPANY,
  TRIAGE_LABELS,
  runReferenceRulesBaseline,
  type TriageEvaluation,
  type TriageEvaluationError,
  type TriageLabel,
} from "../../../shared/revenue-feasibility";

const LABEL_NAMES: Record<TriageLabel, string> = {
  quote: "Quote request",
  booking: "Booking request",
  dispatch: "Dispatch",
  escalate: "Escalate",
  spam: "Spam",
  human_review: "Human review",
  no_action: "No operational action",
};

type EvaluationState = TriageEvaluation | TriageEvaluationError;

export default function RevenueFeasibilityLab() {
  const firstId = SMART_LEADS_CORPUS[0].id;
  const [selectedId, setSelectedId] = useState(firstId);
  const [draftLabels, setDraftLabels] = useState<TriageLabel[]>([]);
  const [predictions, setPredictions] = useState<Record<string, readonly TriageLabel[]>>({});
  const [result, setResult] = useState<EvaluationState | null>(null);
  const [sampleNotice, setSampleNotice] = useState("");
  const showEvaluationDetails = result?.ok === true;
  const selectedCase = getTriageFixtureView(selectedId, showEvaluationDetails);
  const recordedCount = Object.keys(predictions).length;

  function selectFixture(id: string) {
    setSelectedId(id);
    setDraftLabels([...(predictions[id] ?? [])]);
    setResult(null);
  }

  function toggleLabel(label: TriageLabel, checked: boolean | "indeterminate") {
    setDraftLabels((current) => {
      if (checked !== true) return current.filter((item) => item !== label);
      if (label === "no_action") return ["no_action"];
      const operational = current.filter((item) => item !== "no_action");
      return operational.includes(label) ? operational : [...operational, label];
    });
    setResult(null);
    setSampleNotice("");
  }

  function recordPrediction() {
    setPredictions((current) => ({ ...current, [selectedId]: [...draftLabels] }));
    setResult(null);
    setSampleNotice(`Prediction recorded for ${selectedId}.`);
  }

  function loadExamplePrediction() {
    const sample = makeExamplePrediction();
    setSelectedId(sample.id);
    setDraftLabels([...sample.labels]);
    setPredictions((current) => ({ ...current, [sample.id]: [...sample.labels] }));
    setResult(null);
    setSampleNotice("One fixed example prediction is loaded for SL-001. It is not a reference answer; all other fixture IDs remain unrecorded.");
  }

  function runBaseline() {
    const rows = runReferenceRulesBaseline();
    setPredictions(Object.fromEntries(rows.map((row) => [row.id, row.labels])));
    const first = rows.find((row) => row.id === firstId)!;
    setSelectedId(first.id);
    setDraftLabels([...first.labels]);
    setResult(evaluateTriagePredictions(rows));
    setSampleNotice("The deterministic RULES baseline ran locally on the fixed synthetic corpus.");
  }

  function evaluatePredictions() {
    const rows = Object.entries(predictions).map(([id, labels]) => ({ id, labels }));
    setResult(evaluateTriagePredictions(rows));
  }

  function reset() {
    setSelectedId(firstId);
    setDraftLabels([]);
    setPredictions({});
    setResult(null);
    setSampleNotice("");
  }

  return (
    <Card className="border-amber-500/50" data-testid="card-revenue-feasibility-lab">
      <CardHeader>
        <CardTitle>Private offline Smart Leads synthetic demo</CardTitle>
        <CardDescription>
          Fixed, versioned fixtures only. This lab makes no live research, provider, model, network,
          queue, email, checkout, or order calls. It is not an approved real pilot.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section aria-labelledby="synthetic-dossier-title" className="rounded-lg border p-4 space-y-3">
          <div>
            <h3 id="synthetic-dossier-title" className="font-semibold">Sample dossier: {SYNTHETIC_COMPANY.name}</h3>
            <p className="text-sm text-muted-foreground">
              Entirely fictional dossier fixture · no website, phone, email, or fabricated contacts.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="text-sm font-semibold">Synthetic company snapshot</h4>
              <ul className="mt-1 list-disc pl-5 text-sm space-y-1">
                {Object.entries(SYNTHETIC_COMPANY.profile)
                  .filter(([label]) => label !== "offerContext")
                  .map(([label, value]) => <li key={label}><strong>{label}:</strong> {value}</li>)}
              </ul>
              <p className="mt-2 text-sm"><strong>Offer context:</strong> {SYNTHETIC_COMPANY.profile.offerContext}</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold">Fixed fixture facts and source-tagged synthetic operating signals</h4>
              <ul className="mt-1 list-disc pl-5 text-sm space-y-1">
                {SYNTHETIC_COMPANY.facts.map((fact) => <li key={fact}>{fact}</li>)}
                {SYNTHETIC_COMPANY.operatingSignals.map((signal) => (
                  <li key={signal.signal}><strong>{signal.source}:</strong> {signal.signal} <span className="text-muted-foreground">{signal.limit}</span></li>
                ))}
              </ul>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="text-sm font-semibold">Hypotheses — not verified facts</h4>
              <ul className="mt-1 list-disc pl-5 text-sm space-y-1">
                {SYNTHETIC_COMPANY.hypotheses.map((hypothesis) => <li key={hypothesis}>{hypothesis}</li>)}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold">Disqualifiers</h4>
              <ul className="mt-1 list-disc pl-5 text-sm space-y-1">
                {SYNTHETIC_COMPANY.disqualifiers.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
          <div>
            <p className="text-sm"><strong>Fit score:</strong> {SYNTHETIC_COMPANY.fitScore} — {SYNTHETIC_COMPANY.fitScoreNote}</p>
            <ul className="mt-1 list-disc pl-5 text-sm space-y-1">
              {SYNTHETIC_COMPANY.fitRubric.map((item) => <li key={item.criterion}>{item.points}/1 — {item.criterion}: {item.rationale}</li>)}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Private review questions</h4>
            <ul className="mt-1 list-disc pl-5 text-sm space-y-1">
              {SYNTHETIC_COMPANY.reviewQuestions.map((question) => <li key={question}>{question}</li>)}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Source / QA checklist</h4>
            <ul className="mt-1 list-disc pl-5 text-sm space-y-1">
              {SYNTHETIC_COMPANY.qaChecklist.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>

        <section aria-labelledby="triage-title" className="space-y-3">
          <div>
            <h3 id="triage-title" className="font-semibold">Contractor message triage evaluation</h3>
            <p className="text-sm text-muted-foreground">
              Corpus {SMART_LEADS_CORPUS_VERSION} has {SMART_LEADS_CORPUS.length} immutable,
              fixed synthetic cases. Draft labels are unvalidated and awaiting dispatcher review;
              no human approval is claimed. Expected labels stay hidden until a complete evaluation.
              No free-text message entry is available.
            </p>
            <p className="text-xs text-muted-foreground">{REFERENCE_RULES_VERSION}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" variant="outline" className="min-h-11" onClick={loadExamplePrediction}>
              Load one fixed example prediction
            </Button>
            <Button type="button" className="min-h-11" onClick={runBaseline}>
              Run reference RULES baseline (not AI)
            </Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={evaluatePredictions}>
              Evaluate my recorded predictions
            </Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={reset}>
              Reset demo
            </Button>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <label className="block text-sm font-medium" htmlFor="synthetic-fixture-select">Select fixed fixture ID</label>
            <Select value={selectedId} onValueChange={selectFixture}>
              <SelectTrigger id="synthetic-fixture-select" className="min-h-11 w-full sm:max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SMART_LEADS_CORPUS.map((item) => (
                <SelectItem key={item.id} value={item.id} className="min-h-11">{item.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p className="font-medium">{selectedCase.id}{selectedCase.emergency ? ` · ${selectedCase.emergency.kind} synthetic emergency scenario` : ""}</p>
              <p className="mt-1">{selectedCase.message}</p>
              <p className="mt-2 text-xs text-muted-foreground">Provenance: {selectedCase.authoring}
                {selectedCase.emergency ? ` · Hazard marker: ${selectedCase.emergency.kind}; ${selectedCase.emergency.authoring}.` : ""}
              </p>
            </div>
            <p className="text-sm font-medium">Your predicted labels for {selectedId}</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {TRIAGE_LABELS.map((label) => (
                <label key={label} className="flex min-h-11 items-center gap-3 rounded-md px-2 text-sm hover:bg-muted/50">
                  <Checkbox
                    checked={draftLabels.includes(label)}
                    onCheckedChange={(checked) => toggleLabel(label, checked)}
                    aria-label={LABEL_NAMES[label]}
                  />
                  {LABEL_NAMES[label]}
                </label>
              ))}
            </div>
            <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={recordPrediction}>
              Record prediction for {selectedId} (including no labels)
            </Button>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Recorded fixture predictions: {recordedCount} of {SMART_LEADS_CORPUS.length}.
              {sampleNotice ? ` ${sampleNotice}` : ""}
            </p>
          </div>

          <details className="rounded-lg border p-4">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium">Read the complete fixed message corpus ({SMART_LEADS_CORPUS.length} cases)</summary>
            <ol className="mt-3 space-y-3">
              {SMART_LEADS_CORPUS.map((item) => (
                <li key={item.id} className="rounded-md border p-3 text-sm">
                  {(() => {
                    const fixture = getTriageFixtureView(item.id, showEvaluationDetails);
                    return (
                      <>
                        <p className="font-medium">{fixture.id}{fixture.emergency ? ` · ${fixture.emergency.kind} synthetic hazard scenario` : ""}</p>
                        <p className="mt-1">{fixture.message}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Provenance: {fixture.authoring}</p>
                      </>
                    );
                  })()}
                </li>
              ))}
            </ol>
          </details>
        </section>

        {result && (
          <section aria-labelledby="results-title" className="rounded-lg border p-4 space-y-3" data-testid="section-revenue-feasibility-results">
            <h3 id="results-title" className="font-semibold">Evaluation results</h3>
            {!result.ok ? (
              <div className="space-y-2 text-sm">
                <p className="font-medium text-destructive">
                  Evaluation failed; complete, valid fixture coverage is required ({result.coverage.predicted}/{result.coverage.total} valid IDs).
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  {result.errorDetails.map((detail, index) => (
                    <li key={`${detail.code}-${detail.id ?? index}`}>
                      {detail.code}{detail.id ? ` (${detail.id})` : ""}: {detail.message}
                    </li>
                  ))}
                </ul>
                {result.failedIds.length > 0 && <p>Failed fixture IDs: {result.failedIds.join(", ")}</p>}
              </div>
            ) : (
              <>
                <p className="text-sm">Coverage: {result.coverage.predicted}/{result.coverage.total} fixed fixture IDs.</p>
                <div className="rounded-md border p-3 text-sm">
                  <p><strong>Evaluator:</strong> completed with syntactically valid predictions and full fixture coverage.</p>
                  <p><strong>Safety readiness:</strong> {result.safetyHardFail
                    ? "FAIL — one or more fixture emergency escalations were missed; do not interpret other metric agreement as safety."
                    : "NOT ASSESSED — no emergency misses in these fixtures is not real-world readiness evidence."}</p>
                </div>
                {result.safetyHardFail ? (
                  <div className="rounded-md border border-destructive p-3 text-sm" role="alert">
                    <strong>SAFETY HARD FAIL:</strong> emergency escalation was missed for {result.emergencyMisses.map((miss) => `${miss.id} (${miss.kind})`).join(", ")}.
                    Failed IDs: {result.failedIds.join(", ")}.
                  </div>
                ) : (
                  <p className="rounded-md border p-3 text-sm">
                    No emergency escalation misses in this synthetic fixture comparison. This is not evidence of real-world safety.
                  </p>
                )}
                <div>
                  <h4 className="font-medium">Per-label metrics (no aggregate score)</h4>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead><tr className="border-b"><th className="p-2">Label</th><th className="p-2">TP</th><th className="p-2">FP</th><th className="p-2">FN</th><th className="p-2">Precision</th><th className="p-2">Recall</th></tr></thead>
                      <tbody>
                        {TRIAGE_LABELS.map((label) => {
                          const metric = result.metrics[label];
                          return (
                            <tr key={label} className="border-b last:border-0">
                              <th className="p-2 font-normal">{LABEL_NAMES[label]}</th>
                              <td className="p-2">{metric.TP}</td>
                              <td className="p-2">{metric.FP}{metric.fpIds.length ? ` · ${metric.fpIds.join(", ")}` : ""}</td>
                              <td className="p-2">{metric.FN}{metric.fnIds.length ? ` · ${metric.fnIds.join(", ")}` : ""}</td>
                              <td className="p-2">{metric.precision === null ? "null (zero denominator)" : metric.precision.toFixed(2)}</td>
                              <td className="p-2">{metric.recall === null ? "null (zero denominator)" : metric.recall.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="text-sm"><strong>Dispatch review count:</strong> expected {result.dispatchReviewCounts.expected}; predicted {result.dispatchReviewCounts.predicted}. {result.reviewBurdenInstruction}</p>
                <details>
                  <summary className="flex min-h-11 cursor-pointer items-center font-medium">Reveal expected labels and predictions after evaluation</summary>
                  <ol className="mt-1 space-y-2 text-sm">
                    {SMART_LEADS_CORPUS.map((item) => (
                      <li key={item.id} className="rounded-md border p-2">
                        <strong>{item.id}</strong> · expected: {item.expectedLabels.length ? item.expectedLabels.map((label) => LABEL_NAMES[label]).join(", ") : "no operational label"}
                        {" · predicted: "}
                        {predictions[item.id]?.length ? predictions[item.id].map((label) => LABEL_NAMES[label]).join(", ") : "no operational label"}
                      </li>
                    ))}
                  </ol>
                </details>
                <p className="text-xs text-muted-foreground">{result.disclaimer}</p>
              </>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}