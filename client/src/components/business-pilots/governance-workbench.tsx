import { useState, type ReactNode } from "react";
import { BookOpenCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PilotRunHistory, usePilotRuns } from "@/components/business-pilots/pilot-run-history";
import { GOVERNANCE_CONTROLS, governanceSchema, type GovernanceInput } from "../../../../shared/business-pilots/governance";

const freshControls = (): GovernanceInput["controls"] => GOVERNANCE_CONTROLS.map((control) => ({
  control: control.id, status: "unknown" as const, owner: "", evidence: "", reviewedAt: null as string | null,
}));

export default function GovernanceWorkbench() {
  const [organization, setOrganization] = useState("");
  const [scope, setScope] = useState("");
  const [controls, setControls] = useState<GovernanceInput["controls"]>(freshControls());
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const store = usePilotRuns<GovernanceInput>("governance");

  function mutate(action: () => void) { store.invalidateOperation(); action(); }
  function submit() {
    setValidationErrors([]);
    const parsed = governanceSchema.safeParse({ organization, scope, controls });
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
          <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#e1ece3] text-[#386c5e]"><BookOpenCheck className="size-5" /></span><div><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#987555]">03 / owner evidence inventory</p><CardTitle className="mt-1 font-display text-xl text-[#1d403b]">Governance evidence pack</CardTitle><CardDescription className="mt-1">Organize declared scope, accountable owners, and evidence references.</CardDescription></div></div>
        </CardHeader>
        <CardContent className="space-y-5 p-4 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Organization" help="Example: Northline Services">
              <Input value={organization} onChange={(event) => mutate(() => setOrganization(event.target.value))} placeholder="Organization name" />
            </Field>
            <Field label="Declared review scope" help="Example: customer-support assistant used by service staff; include boundaries and exclusions.">
              <Textarea value={scope} onChange={(event) => mutate(() => setScope(event.target.value))} rows={3} maxLength={1000} placeholder="Describe systems, use and review boundaries" />
            </Field>
          </div>
          <div className="space-y-3">
            <div><p className="text-sm font-semibold text-[#38524b]">Six fixed control areas</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Inventory only; there is no legal compliance or certification verdict.</p></div>
            {GOVERNANCE_CONTROLS.map((control, index) => <section key={control.id} className="rounded-xl border border-[#dbe3dc] bg-[#fbfbf7] p-4">
              <div className="mb-3 flex items-start gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#e6eee6] text-xs font-semibold text-[#527264]">{index + 1}</span><div><h3 className="text-sm font-semibold text-[#354f47]">{control.label}</h3><p className="mt-1 text-xs leading-5 text-[#728078]">{control.guidance}</p></div></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Operator-reported status" help="Implemented, planned, or unknown.">
                  <select value={controls[index].status} onChange={(event) => mutate(() => setControls((rows) => rows.map((row, i) => i === index ? { ...row, status: event.target.value as GovernanceInput["controls"][number]["status"] } : row)))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397166]"><option value="unknown">Unknown</option><option value="implemented">Implemented, reported</option><option value="planned">Planned</option></select>
                </Field>
                <Field label="Accountable owner or role" help="Example: Security lead — no personal contact details required.">
                  <Input value={controls[index].owner} maxLength={160} onChange={(event) => mutate(() => setControls((rows) => rows.map((row, i) => i === index ? { ...row, owner: event.target.value } : row)))} placeholder="Role or team owner" />
                </Field>
                <Field label="Evidence reference" help="Example: access-review-2025-Q1, policy section 4, or exercise record ID.">
                  <Input value={controls[index].evidence} maxLength={1200} onChange={(event) => mutate(() => setControls((rows) => rows.map((row, i) => i === index ? { ...row, evidence: event.target.value } : row)))} placeholder="Reference only; no credentials or sensitive records" />
                </Field>
                <Field label="Last reviewed date" help="Current evidence needs a review date within the 90-day pilot window.">
                  <Input type="date" value={controls[index].reviewedAt ?? ""} onChange={(event) => mutate(() => setControls((rows) => rows.map((row, i) => i === index ? { ...row, reviewedAt: event.target.value || null } : row)))} />
                </Field>
              </div>
            </section>)}
          </div>
          {validationErrors.length > 0 && <div role="alert" className="rounded-lg border border-[#e6c1b6] bg-[#fbefea] px-4 py-3 text-sm text-[#813c31]"><p className="font-semibold">Review these inputs</p><ul className="mt-2 list-inside list-disc space-y-1 text-xs">{validationErrors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul></div>}
          <div className="flex flex-col gap-3 border-t border-[#e2e7df] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-md text-xs leading-5 text-muted-foreground">References and implementation claims are operator-supplied; source material is not independently inspected.</p>
            <div className="flex flex-wrap gap-2">{store.retryAvailable && <Button variant="outline" onClick={() => void store.retry()} disabled={store.busy !== null}>Retry same save</Button>}<Button onClick={submit} disabled={store.busy !== null} className="bg-[#245e57] text-white hover:bg-[#184b45]">{store.busy === "save" ? "Saving…" : "Save evidence pack"}</Button></div>
          </div>
        </CardContent>
      </Card>
      <aside className="rounded-xl border border-[#e5d8c4] bg-[#f7f0e5] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold text-[#65513a]"><ShieldAlert className="size-4" />Scope limitation</h3><p className="mt-2 text-xs leading-5 text-[#6a5e4d]">This general-purpose evidence organizer is not a mapping to a law, standard, insurer requirement, or official Accord. It does not determine compliance or provide legal advice. Obtain applicable requirements and qualified review separately.</p></aside>
    </div>
    <PilotRunHistory kind="governance" store={store} runLabel={(run) => run.input.organization} />
  </div>;
}

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-xs font-semibold text-[#405850]">{label}{children}<span className="block text-[11px] font-normal leading-4 text-[#839087]">{help}</span></label>;
}
