import { useEffect, useState } from "react";
import { Download, FileCheck, ShieldCheck } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  BILLING_FINDINGS, INVOICE_HEADER, JOB_HEADER, MAX_PILOT_CSV_CHARS, MAX_PILOT_INVOICES, MAX_PILOT_JOBS,
  PILOT_PRICE_USD, REVIEW_LABELS, SAMPLE_INVOICES, SAMPLE_JOBS, exportBillingPilot, reconcileBillingPilot,
  type ReviewDecision,
} from "@shared/lib/finished-not-billed";
import procedure from "../../../docs/finished-but-not-billed.md?raw";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function AdminFinishedNotBilledPage() {
  const [jobs, setJobs] = useState("");
  const [invoices, setInvoices] = useState("");
  const [coverageChecked, setCoverageChecked] = useState(false);
  const [sample, setSample] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ReturnType<typeof reconcileBillingPilot> | null>(null);
  const [reviews, setReviews] = useState<ReadonlyMap<string, ReviewDecision>>(new Map());
  const hasInputs = jobs.length > 0 || invoices.length > 0;

  useEffect(() => {
    if (!hasInputs || sample) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = true; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasInputs, sample]);

  const invalidate = () => {
    setCoverageChecked(false);
    setResult(null);
    setReviews(new Map());
    setError("");
  };
  const changeSource = (kind: "jobs" | "invoices", value: string) => {
    invalidate();
    if (value.length > MAX_PILOT_CSV_CHARS) {
      setError("That paste was too large and was not applied. Use just the rows and columns in the template.");
      return;
    }
    (kind === "jobs" ? setJobs : setInvoices)(value);
  };
  const candidates = result?.rows.filter(row => row.finding === "verify-for-invoicing") ?? [];
  const confirmed = candidates.filter(row => reviews.get(row.jobId) === "office-confirmed").length;

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-background">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-7">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge variant="secondary"><FileCheck className="mr-1 size-3" /> Business Pilot Tools</Badge>
              <Badge variant="outline">${PILOT_PRICE_USD} manual pilot</Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Finished but Not Billed</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Compare completed HVAC jobs with a separate invoice list. Give the office a short list of records to check, without sending invoices or connecting to a CRM.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => download("finished-but-not-billed.md", procedure, "text/markdown;charset=utf-8")}>
            <Download className="mr-2 size-4" /> Download Markdown procedure
          </Button>
        </header>

        <details className="rounded-xl border bg-card px-4 py-3 sm:px-6">
          <summary className="cursor-pointer font-semibold">Sales pitch and step-by-step procedure</summary>
          <div className="prose prose-sm my-4 max-w-none dark:prose-invert prose-pre:overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{procedure}</ReactMarkdown>
          </div>
        </details>

        <Card>
          <CardHeader>
            <CardTitle>1. Prepare the batch</CardTitle>
            <CardDescription className="leading-6">
              Use up to {MAX_PILOT_JOBS} completed jobs and {MAX_PILOT_INVOICES} invoice records. Reuse the same coded job IDs in both sources.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex gap-3 rounded-lg border bg-muted/50 p-3 text-sm">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>Only paste coded records. Never include customer names, contact details, or notes. This page does not upload or save the data. Export your handoff before leaving or refreshing.</p>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={hasInputs} onClick={() => {
                invalidate(); setSample(true); setJobs(SAMPLE_JOBS); setInvoices(SAMPLE_INVOICES);
              }}>Load fictional example</Button>
              {hasInputs && <Button type="button" variant="ghost" size="sm" onClick={() => setClearing(value => !value)}>Clear batch</Button>}
            </div>
            {clearing && hasInputs && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm" role="status">
              <p className="flex-1">Clear both sources and all review decisions? Export first if you want to keep the findings.</p>
              <Button type="button" size="sm" variant="destructive" onClick={() => {
                invalidate(); setJobs(""); setInvoices(""); setSample(false); setClearing(false);
              }}>Clear batch now</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setClearing(false)}>Keep batch</Button>
            </div>}
            {sample && <p className="mb-4 rounded-lg bg-muted p-3 text-sm font-medium">Fictional practice batch. Clear it before starting a customer audit.</p>}
            <form className="space-y-4" onSubmit={e => {
              e.preventDefault();
              if (!coverageChecked) return;
              try {
                setResult(reconcileBillingPilot(jobs, invoices));
                setReviews(new Map());
                setError("");
              } catch (err) {
                setResult(null);
                setError(err instanceof Error ? err.message : "The two CSVs could not be read.");
              }
            }}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-sm font-semibold" htmlFor="billing-pilot-jobs">Completed jobs CSV</label>
                    <Button type="button" size="sm" variant="outline" onClick={() => download("completed-jobs-template.csv", `${JOB_HEADER}\r\n`, "text/csv;charset=utf-8")}>
                      <Download className="mr-2 size-4" /> Jobs template
                    </Button>
                  </div>
                  <p id="billing-pilot-jobs-help" className="text-xs text-muted-foreground">Paste the header and one row per completed job. Example: <code>J-101,2026-11-03,READY</code></p>
                  <Textarea id="billing-pilot-jobs" aria-describedby="billing-pilot-jobs-help" rows={7} value={jobs} readOnly={sample}
                    onChange={e => changeSource("jobs", e.currentTarget.value)} placeholder={SAMPLE_JOBS} spellCheck={false} autoComplete="off" className="font-mono text-xs" />
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-sm font-semibold" htmlFor="billing-pilot-invoices">Invoice records CSV</label>
                    <Button type="button" size="sm" variant="outline" onClick={() => download("invoice-records-template.csv", `${INVOICE_HEADER}\r\n`, "text/csv;charset=utf-8")}>
                      <Download className="mr-2 size-4" /> Invoice template
                    </Button>
                  </div>
                  <p id="billing-pilot-invoices-help" className="text-xs text-muted-foreground">Paste the header and known invoices for this batch. Example: <code>J-101,SENT</code></p>
                  <Textarea id="billing-pilot-invoices" aria-describedby="billing-pilot-invoices-help" rows={7} value={invoices} readOnly={sample}
                    onChange={e => changeSource("invoices", e.currentTarget.value)} placeholder={SAMPLE_INVOICES} spellCheck={false} autoComplete="off" className="font-mono text-xs" />
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4 shrink-0 accent-primary" checked={coverageChecked}
                  onChange={e => {
                    if (!e.currentTarget.checked) invalidate();
                    else setCoverageChecked(true);
                  }} />
                I checked that both lists use the same codes and cover the same batch, including invoices issued after job completion.
              </label>
              {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={!coverageChecked || !jobs.trim() || !invoices.trim() || result !== null}>Review batch</Button>
            </form>
          </CardContent>
        </Card>

        {result && <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
            <div className="space-y-2">
              <CardTitle>2. Review and export the handoff</CardTitle>
              <CardDescription aria-live="polite">
                {result.rows.length} jobs · {result.invoiceCount} invoice records · {candidates.length} to verify · {confirmed} office-confirmed
              </CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={() => download(
              sample ? "billing-audit-fictional-example.csv" : "billing-audit-handoff.csv",
              exportBillingPilot(result.rows, reviews), "text/csv;charset=utf-8",
            )}><Download className="mr-2 size-4" /> {sample ? "Export fictional example" : "Export handoff CSV"}</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A missing match is not proof of a missed invoice. Leave a row pending until the office confirms it. The export does not send anything.
            </p>
            {(result.outsideBatchCount > 0 || result.invoiceCount === 0) && <p className="rounded-md bg-muted p-3 text-sm">
              {result.invoiceCount === 0 ? "No invoice rows were supplied. Verify that the source really has no records before confirming any candidates." :
                `${result.outsideBatchCount} invoice record(s) did not match a job in the batch. Check the scope and ID mapping before handing off.`}
            </p>}
            <div className="overflow-x-auto rounded-md border" tabIndex={0} role="region" aria-label="Billing findings">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-muted"><tr>
                  {["Job ID", "Completed", "Finding and next step", "Office review"].map(heading =>
                    <th key={heading} scope="col" className="p-3 font-medium">{heading}</th>)}
                </tr></thead>
                <tbody>{result.rows.map(row => <tr key={row.jobId} className="border-t">
                  <th scope="row" className="p-3 font-medium">{row.jobId}</th>
                  <td className="whitespace-nowrap p-3">{row.completedDate}</td>
                  <td className="p-3">
                    <div className="font-medium">{BILLING_FINDINGS[row.finding].label}</div>
                    <p className="text-xs text-muted-foreground">{BILLING_FINDINGS[row.finding].action}</p>
                  </td>
                  <td className="p-3">
                    {row.finding === "verify-for-invoicing" ? <select aria-label={`Office review for ${row.jobId}`}
                      className="rounded-md border bg-background p-2 text-sm"
                      value={reviews.get(row.jobId) ?? "pending"} onChange={e => {
                        const decision = e.currentTarget.value;
                        if (decision !== "pending" && decision !== "office-confirmed" && decision !== "excluded") return;
                        setReviews(previous => new Map(previous).set(row.jobId, decision));
                      }}>
                      {Object.entries(REVIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select> : <span className="text-muted-foreground">Not applicable</span>}
                  </td>
                </tr>)}</tbody>
              </table>
            </div>
          </CardContent>
        </Card>}
      </div>
    </main>
  );
}
