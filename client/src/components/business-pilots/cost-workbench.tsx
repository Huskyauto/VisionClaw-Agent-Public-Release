import { useState, type ReactNode } from "react";
import { Calculator, CircleHelp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PilotRunHistory, usePilotRuns } from "@/components/business-pilots/pilot-run-history";
import { costSchema, type CostInput } from "../../../../shared/business-pilots/cost";

type CostRowDraft = {
  workload: string; model: string; inputTokens: string; outputTokens: string;
  inputRate: string; outputRate: string; rateDate: string; rateSource: string;
  hasAlternative: boolean; alternativeModel: string; alternativeInputRate: string;
  alternativeOutputRate: string; qualityValidated: boolean; alternativeEvidence: string; testedAt: string;
};
type CostDraft = { business: string; start: string; end: string; currency: CostInput["currency"]; rows: CostRowDraft[] };
const newRow = (): CostRowDraft => ({
  workload: "", model: "", inputTokens: "", outputTokens: "", inputRate: "", outputRate: "",
  rateDate: "", rateSource: "", hasAlternative: false, alternativeModel: "",
  alternativeInputRate: "", alternativeOutputRate: "", qualityValidated: false,
  alternativeEvidence: "", testedAt: "",
});
const numberOrMissing = (value: string) => value.trim() === "" ? undefined : Number(value);

function asInput(draft: CostDraft): unknown {
  return {
    business: draft.business, start: draft.start, end: draft.end, currency: draft.currency,
    rows: draft.rows.map((row) => ({
      workload: row.workload, model: row.model,
      inputTokens: numberOrMissing(row.inputTokens), outputTokens: numberOrMissing(row.outputTokens),
      inputRate: numberOrMissing(row.inputRate), outputRate: numberOrMissing(row.outputRate),
      rateDate: row.rateDate, rateSource: row.rateSource,
      alternative: row.hasAlternative ? {
        model: row.alternativeModel,
        inputRate: numberOrMissing(row.alternativeInputRate),
        outputRate: numberOrMissing(row.alternativeOutputRate),
        qualityValidated: row.qualityValidated,
        evidence: row.alternativeEvidence,
        testedAt: row.testedAt || null,
      } : null,
    })),
  };
}

export default function CostWorkbench() {
  const [draft, setDraft] = useState<CostDraft>({ business: "", start: "", end: "", currency: "USD", rows: [newRow()] });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [nonOverlapConfirmed, setNonOverlapConfirmed] = useState(false);
  const store = usePilotRuns<CostInput>("cost");

  function mutate(action: () => void) { store.invalidateOperation(); action(); }
  function changeRow(index: number, patch: Partial<CostRowDraft>) {
    mutate(() => setDraft((current) => ({ ...current, rows: current.rows.map((row, i) => i === index ? { ...row, ...patch } : row) })));
  }
  function submit() {
    setValidationErrors([]);
    if (!nonOverlapConfirmed) {
      setValidationErrors(["Confirm that workload rows are distinct and their usage volumes do not overlap."]);
      return;
    }
    const parsed = costSchema.safeParse(asInput(draft));
    if (!parsed.success) {
      setValidationErrors(parsed.error.issues.map((issue) => `${issue.path.join(".") || "Input"}: ${issue.message}`));
      return;
    }
    void store.submit(parsed.data);
  }

  return <div className="space-y-5">
    {(store.error || store.notice) && <div role={store.error ? "alert" : "status"} className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${store.error ? "border-[#e6c1b6] bg-[#fbefea] text-[#813c31]" : "border-[#c5d8ca] bg-[#e8f1e8] text-[#315e50]"}`}><span>{store.error || store.notice}</span><button type="button" className="text-xs font-semibold underline" onClick={() => { store.setError(null); store.setNotice(null); }}>Dismiss</button></div>}
    <Card className="border-[#d5dfd7] bg-[#fafaf5]">
      <CardHeader className="border-b border-[#e2e7df] bg-[#f5f6ef]">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#e1ece3] text-[#386c5e]"><Calculator className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#987555]">04 / usage estimates</p><CardTitle className="mt-1 font-display text-xl text-[#1d403b]">AI cost & model-routing audit</CardTitle><CardDescription className="mt-1">Enter measured token totals and dated operator-supplied rates. This tool estimates only; it never changes routing.</CardDescription></div></div>
      </CardHeader>
      <CardContent className="space-y-5 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Business" help="Example: Northline Services"><Input value={draft.business} onChange={(event) => mutate(() => setDraft((current) => ({ ...current, business: event.target.value })))} placeholder="Business name" /></Field>
          <Field label="Reporting period starts" help="YYYY-MM-DD"><Input type="date" value={draft.start} onChange={(event) => mutate(() => setDraft((current) => ({ ...current, start: event.target.value })))} /></Field>
          <Field label="Reporting period ends" help="Up to 366 days"><Input type="date" value={draft.end} onChange={(event) => mutate(() => setDraft((current) => ({ ...current, end: event.target.value })))} /></Field>
          <Field label="Currency" help="Rates are per million tokens in this currency."><select value={draft.currency} onChange={(event) => mutate(() => setDraft((current) => ({ ...current, currency: event.target.value as CostInput["currency"] })))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397166]"><option value="USD">USD</option><option value="CAD">CAD</option><option value="GBP">GBP</option><option value="EUR">EUR</option></select></Field>
        </div>
        <div className="rounded-lg border border-[#d8e1d8] bg-[#edf3ed] p-3 text-xs leading-5 text-[#546b61]">
          <p className="flex items-center gap-2 font-semibold"><CircleHelp className="size-4" />Set a consistent reporting period and non-overlapping workloads</p>
          <p className="mt-1">Each row must represent a distinct workload volume within the period. Avoid counting the same usage twice, including cached or reasoning tokens. Enter current input/output rates per 1,000,000 tokens in the chosen currency.</p>
          <label className="mt-3 flex items-start gap-2 font-medium text-[#405850]"><input type="checkbox" checked={nonOverlapConfirmed} onChange={(event) => setNonOverlapConfirmed(event.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[#397166]" /><span>I confirm these workload rows are separate and do not count the same usage more than once.</span></label>
        </div>

        <div className="space-y-4">
          {draft.rows.map((row, index) => <section key={index} className="rounded-xl border border-[#dbe3dc] bg-[#fbfbf7] p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#987555]">Workload {String(index + 1).padStart(2, "0")}</p><h3 className="mt-1 text-sm font-semibold text-[#354f47]">Usage and price assumptions</h3></div>
              {draft.rows.length > 1 && <Button type="button" variant="ghost" size="sm" className="text-[#896356]" onClick={() => mutate(() => setDraft((current) => ({ ...current, rows: current.rows.filter((_, i) => i !== index) })))}><Trash2 className="mr-1.5 size-4" />Remove row</Button>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Distinct workload" help="Example: inbound support summaries"><Input value={row.workload} onChange={(event) => changeRow(index, { workload: event.target.value })} placeholder="Describe a distinct usage group" /></Field>
              <Field label="Current model / service" help="Example: provider/model-family-v3"><Input value={row.model} onChange={(event) => changeRow(index, { model: event.target.value })} placeholder="Model identifier" /></Field>
              <Field label="Rate source" help="Example: provider pricing page, plan name, or internal quote date; do not paste credentials."><Input value={row.rateSource} maxLength={400} onChange={(event) => changeRow(index, { rateSource: event.target.value })} placeholder="Public price source or quote reference" /></Field>
              <NumberField label="Input tokens in period" example="e.g. 1,240,000" value={row.inputTokens} onChange={(value) => changeRow(index, { inputTokens: value })} integer />
              <NumberField label="Output tokens in period" example="e.g. 318,500" value={row.outputTokens} onChange={(value) => changeRow(index, { outputTokens: value })} integer />
              <DateField label="Rate checked date" help="Rates older than 30 days are flagged by the analysis." value={row.rateDate} onChange={(value) => changeRow(index, { rateDate: value })} />
              <NumberField label={`Input rate / 1M (${draft.currency})`} example="e.g. 2.50" value={row.inputRate} onChange={(value) => changeRow(index, { inputRate: value })} />
              <NumberField label={`Output rate / 1M (${draft.currency})`} example="e.g. 10.00" value={row.outputRate} onChange={(value) => changeRow(index, { outputRate: value })} />
            </div>
            <div className="mt-5 border-t border-[#e2e7df] pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[#405850]"><input type="checkbox" checked={row.hasAlternative} onChange={(event) => changeRow(index, { hasAlternative: event.target.checked })} className="size-4 accent-[#397166]" />Compare an alternative model (optional)</label>
              {row.hasAlternative && <div className="mt-3 rounded-lg border border-[#e3dccb] bg-[#f8f4e9] p-4">
                <p className="mb-3 text-xs leading-5 text-[#756448]">Scenario assumption: alternative uses the same token volumes, currency, rate checked date, and rate source as the current model. The rates below are the alternative's per-million rates under that same date/source assumption.</p>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Alternative model / service" help="Example: provider/model-family-lite"><Input value={row.alternativeModel} onChange={(event) => changeRow(index, { alternativeModel: event.target.value })} placeholder="Candidate model" /></Field>
                  <NumberField label={`Alternative input rate / 1M (${draft.currency})`} example="e.g. 0.80" value={row.alternativeInputRate} onChange={(value) => changeRow(index, { alternativeInputRate: value })} />
                  <NumberField label={`Alternative output rate / 1M (${draft.currency})`} example="e.g. 3.20" value={row.alternativeOutputRate} onChange={(value) => changeRow(index, { alternativeOutputRate: value })} />
                  <DateField label="Quality test date" help="Required for a recent (30-day) qualified estimate." value={row.testedAt} onChange={(value) => changeRow(index, { testedAt: value })} />
                  <Field label="Quality evidence reference" help="Example: evaluation-run-128; source is not independently inspected."><Input value={row.alternativeEvidence} maxLength={1200} onChange={(event) => changeRow(index, { alternativeEvidence: event.target.value })} placeholder="Reference only" /></Field>
                  <label className="flex items-start gap-2 rounded-md border border-[#ded8c9] bg-[#fbfaf5] p-3 text-xs leading-5 text-[#5f6559]"><input type="checkbox" checked={row.qualityValidated} onChange={(event) => changeRow(index, { qualityValidated: event.target.checked })} className="mt-0.5 size-4 shrink-0 accent-[#397166]" /><span>Operator reports a quality test was validated for this workload. This claim is not independently verified.</span></label>
                </div>
              </div>}
            </div>
          </section>)}
          <Button type="button" variant="outline" onClick={() => mutate(() => setDraft((current) => current.rows.length < 20 ? { ...current, rows: [...current.rows, newRow()] } : current))} disabled={draft.rows.length >= 20}><Plus className="mr-2 size-4" />Add workload row <span className="ml-1 text-xs text-muted-foreground">({draft.rows.length}/20)</span></Button>
        </div>

        {validationErrors.length > 0 && <div role="alert" className="rounded-lg border border-[#e6c1b6] bg-[#fbefea] px-4 py-3 text-sm text-[#813c31]"><p className="font-semibold">Review these inputs before saving</p><ul className="mt-2 list-inside list-disc space-y-1 text-xs">{validationErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul></div>}
        <div className="flex flex-col gap-3 border-t border-[#e2e7df] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-xs leading-5 text-muted-foreground">Usage, price and test data are supplied by the operator. This does not reconcile a provider bill or switch production routing.</p>
          <div className="flex flex-wrap gap-2">{store.retryAvailable && <Button variant="outline" onClick={() => void store.retry()} disabled={store.busy !== null}>Retry same save</Button>}<Button onClick={submit} disabled={store.busy !== null} className="bg-[#245e57] text-white hover:bg-[#184b45]">{store.busy === "save" ? "Saving…" : "Save cost estimate"}</Button></div>
        </div>
      </CardContent>
    </Card>
    <PilotRunHistory kind="cost" store={store} runLabel={(run) => `${run.input.business} · ${run.input.start}–${run.input.end}`} />
  </div>;
}

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-xs font-semibold text-[#405850]">{label}{children}<span className="block text-[11px] font-normal leading-4 text-[#839087]">{help}</span></label>;
}
function NumberField({ label, example, value, onChange, integer }: { label: string; example: string; value: string; onChange: (value: string) => void; integer?: boolean }) {
  return <label className="block space-y-1.5 text-xs font-semibold text-[#405850]">{label}<Input type="number" min="0" step={integer ? "1" : "0.0001"} inputMode={integer ? "numeric" : "decimal"} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Required — enter 0 only when verified" /><span className="block text-[11px] font-normal leading-4 text-[#839087]">{example}</span></label>;
}
function DateField({ label, help, value, onChange }: { label: string; help: string; value: string; onChange: (value: string) => void }) {
  return <label className="block space-y-1.5 text-xs font-semibold text-[#405850]">{label}<Input type="date" value={value} onChange={(event) => onChange(event.target.value)} /><span className="block text-[11px] font-normal leading-4 text-[#839087]">{help}</span></label>;
}
