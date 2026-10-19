import { useState, type ReactNode } from "react";
import { AlertTriangle, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePilotRuns, PilotRunHistory } from "@/components/business-pilots/pilot-run-history";
import { RELEASE_AREAS, releaseSchema, type ReleaseInput } from "../../../../shared/business-pilots/release";

const freshChecks = (): ReleaseInput["checks"] => RELEASE_AREAS.map((area) => ({
  area: area.id, status: "unknown" as const, evidence: "", checkedAt: null as string | null,
}));

export default function ReleaseWorkbench() {
  const [product, setProduct] = useState("");
  const [version, setVersion] = useState("");
  const [checks, setChecks] = useState<ReleaseInput["checks"]>(freshChecks());
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const store = usePilotRuns<ReleaseInput>("release");

  function mutate(action: () => void) { store.invalidateOperation(); action(); }
  function submit() {
    setValidationErrors([]);
    const parsed = releaseSchema.safeParse({ product, version, checks });
    if (!parsed.success) {
      setValidationErrors(parsed.error.issues.map((issue) => `${issue.path.join(".") || "Input"}: ${issue.message}`));
      return;
    }
    void store.submit(parsed.data);
  }

  return <div className="space-y-5">
    {(store.error || store.notice) && <div role={store.error ? "alert" : "status"} className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${store.error ? "border-[#e6c1b6] bg-[#fbefea] text-[#813c31]" : "border-[#c5d8ca] bg-[#e8f1e8] text-[#315e50]"}`}><span>{store.error || store.notice}</span><button type="button" className="text-xs font-semibold underline" onClick={() => { store.setError(null); store.setNotice(null); }}>Dismiss</button></div>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <Card className="border-[#d5dfd7] bg-[#fafaf5]">
        <CardHeader className="border-b border-[#e2e7df] bg-[#f5f6ef]">
          <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#e1ece3] text-[#386c5e]"><ClipboardCheck className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#987555]">02 / candidate-specific inventory</p><CardTitle className="mt-1 font-display text-xl text-[#1d403b]">Release readiness review</CardTitle><CardDescription className="mt-1">Record the operator's checks and references for one exact candidate.</CardDescription></div></div>
        </CardHeader>
        <CardContent className="space-y-5 p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product or service" help="Example: FieldDesk customer portal">
              <Input value={product} onChange={(event) => mutate(() => setProduct(event.target.value))} placeholder="Name the product" />
            </Field>
            <Field label="Candidate version or release identifier" help="Example: 2.8.1-rc2 — identify the exact candidate reviewed">
              <Input value={version} onChange={(event) => mutate(() => setVersion(event.target.value))} placeholder="Version / commit / candidate label" />
            </Field>
          </div>
          <div className="space-y-3">
            <div><p className="text-sm font-semibold text-[#38524b]">Six fixed review areas</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Every area must be represented. References are supplied by you and are not opened or verified here.</p></div>
            {RELEASE_AREAS.map((area, index) => <section key={area.id} className="rounded-xl border border-[#dbe3dc] bg-[#fbfbf7] p-4">
              <div className="mb-3 flex items-start gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#e6eee6] text-xs font-semibold text-[#527264]">{index + 1}</span><div><h3 className="text-sm font-semibold text-[#354f47]">{area.label}</h3><p className="mt-1 text-xs leading-5 text-[#728078]">{area.guidance}</p></div></div>
              <div className="grid gap-3 sm:grid-cols-[150px_1fr_165px]">
                <Field label="Operator-reported status" help="Select unknown if not established.">
                  <select value={checks[index].status} onChange={(event) => mutate(() => setChecks((rows) => rows.map((row, i) => i === index ? { ...row, status: event.target.value as ReleaseInput["checks"][number]["status"] } : row)))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397166]"><option value="unknown">Unknown</option><option value="pass">Pass reported</option><option value="fail">Fail reported</option></select>
                </Field>
                <Field label="Evidence reference" help="Example: QA run 482, ticket SEC-91, or internal doc path">
                  <Input value={checks[index].evidence} maxLength={1200} onChange={(event) => mutate(() => setChecks((rows) => rows.map((row, i) => i === index ? { ...row, evidence: event.target.value } : row)))} placeholder="Reference only; no credentials or personal data" />
                </Field>
                <Field label="Check date" help="A reported pass must be within 30 days.">
                  <Input type="date" value={checks[index].checkedAt ?? ""} onChange={(event) => mutate(() => setChecks((rows) => rows.map((row, i) => i === index ? { ...row, checkedAt: event.target.value || null } : row)))} />
                </Field>
              </div>
            </section>)}
          </div>
          {validationErrors.length > 0 && <ValidationList errors={validationErrors} />}
          <div className="flex flex-col gap-3 border-t border-[#e2e7df] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-md text-xs leading-5 text-muted-foreground">A readiness indication is not approval. The accountable owner must inspect this candidate and its evidence.</p>
            <div className="flex flex-wrap gap-2">{store.retryAvailable && <Button variant="outline" onClick={() => void store.retry()} disabled={store.busy !== null}>Retry same save</Button>}<Button onClick={submit} disabled={store.busy !== null} className="bg-[#245e57] text-white hover:bg-[#184b45]">{store.busy === "save" ? "Saving…" : "Save review"}</Button></div>
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <ScopeNote title="Review boundary">A missing check, evidence reference, or current date remains an evidence gap. Passing labels are operator assertions, not executed test results.</ScopeNote>
        <div className="flex items-start gap-2 rounded-xl border border-[#e6d7b8] bg-[#faf3e4] p-4 text-xs leading-5 text-[#725e3b]"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p>Do not interpret “ready for human review” as release approval, certification, or an assurance that production is safe.</p></div>
      </div>
    </div>
    <PilotRunHistory kind="release" store={store} runLabel={(run) => `${run.input.product} · ${run.input.version}`} />
  </div>;
}

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-xs font-semibold text-[#405850]">{label}{children}<span className="block text-[11px] font-normal leading-4 text-[#839087]">{help}</span></label>;
}
function ValidationList({ errors }: { errors: string[] }) {
  return <div role="alert" className="rounded-lg border border-[#e6c1b6] bg-[#fbefea] px-4 py-3 text-sm text-[#813c31]"><p className="font-semibold">Review these inputs</p><ul className="mt-2 list-inside list-disc space-y-1 text-xs">{errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul></div>;
}
function ScopeNote({ title, children }: { title: string; children: ReactNode }) {
  return <aside className="rounded-xl border border-[#e5d8c4] bg-[#f7f0e5] p-4"><h3 className="text-sm font-semibold text-[#65513a]">{title}</h3><p className="mt-2 text-xs leading-5 text-[#6a5e4d]">{children}</p></aside>;
}
