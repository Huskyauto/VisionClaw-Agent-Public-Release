import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/queryClient";
import { Loader2, Globe, FileText, Download, CheckCircle2, AlertTriangle, XCircle, Gauge, Wrench, Link as LinkIcon, Printer } from "lucide-react";

interface AuditCheck {
  id: string;
  label: string;
  category: string;
  status: "pass" | "warn" | "fail";
  score: number;
  maxScore: number;
  detail: string;
  recommendation?: string;
}

interface AuditResult {
  websiteUrl: string;
  finalUrl: string;
  overallScore: number;
  grade: string;
  checks: AuditCheck[];
  recommendations: string[];
  fetchedAt: string;
}

interface FullJob {
  jobId: string;
  status: "running" | "done" | "error";
  company?: string;
  website?: string;
  pages?: number | null;
  fileName?: string | null;
  error?: string | null;
  customerEmail?: string | null;
  queuedReviewId?: string | null;
}

function StatusIcon({ status }: { status: AuditCheck["status"] }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
  return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "bg-green-600 text-white";
  if (grade.startsWith("B")) return "bg-emerald-600 text-white";
  if (grade.startsWith("C")) return "bg-yellow-600 text-white";
  if (grade.startsWith("D")) return "bg-orange-600 text-white";
  return "bg-red-600 text-white";
}

export default function WebsiteAuditPage() {
  // --- Quick audit state ---
  const [quickUrl, setQuickUrl] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickResult, setQuickResult] = useState<AuditResult | null>(null);

  // --- Full audit state ---
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [crm, setCrm] = useState("");
  const [notes, setNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [fullError, setFullError] = useState<string | null>(null);
  const [job, setJob] = useState<FullJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function runQuickAudit() {
    const url = quickUrl.trim();
    if (!url) return;
    setQuickLoading(true);
    setQuickError(null);
    setQuickResult(null);
    try {
      const res = await authFetch("/api/admin/audit/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Audit failed");
      setQuickResult(data as AuditResult);
    } catch (e: any) {
      setQuickError(e?.message || "Audit failed");
    } finally {
      setQuickLoading(false);
    }
  }

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    let failures = 0;
    pollRef.current = setInterval(async () => {
      let failed = false;
      try {
        const res = await authFetch(`/api/admin/audit/full/${jobId}`);
        if (res.ok) {
          failures = 0;
          const data: FullJob = await res.json();
          setJob(data);
          if (data.status !== "running" && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          return;
        }
        failed = true;
      } catch {
        failed = true; /* transient poll failure — retry with a bounded budget */
      }
      if (failed && ++failures >= 24) {
        // ~2 minutes of consecutive failures — stop spinning silently.
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setFullError("Lost contact while checking the report's progress. It may still be running — refresh the page to check again.");
        setJob((j) => (j && j.status === "running" ? { ...j, status: "error", error: "Progress updates lost — refresh to re-check." } : j));
      }
    }, 5000);
  }

  async function runFullAudit() {
    if (!company.trim() || !website.trim()) {
      setFullError("Company name and website are both required.");
      return;
    }
    const email = customerEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFullError("That customer email doesn't look valid — fix it or leave it blank.");
      return;
    }
    setFullError(null);
    setJob(null);
    try {
      const res = await authFetch("/api/admin/audit/full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: company.trim(),
          website: website.trim(),
          industry: industry.trim() || null,
          crm: crm.trim() || null,
          notes: notes.trim() || null,
          customerName: customerName.trim() || null,
          customerEmail: customerEmail.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data?.jobId) {
        // An audit is already running — attach to it and keep polling.
        setJob({ jobId: data.jobId, status: "running" });
        startPolling(data.jobId);
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Could not start the audit");
      setJob({ jobId: data.jobId, status: "running", company, website });
      startPolling(data.jobId);
    } catch (e: any) {
      setFullError(e?.message || "Could not start the audit");
    }
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gauge className="h-6 w-6" /> Website Audit
        </h1>
        <p className="text-muted-foreground mt-1">
          Run a quick AI-readiness check on any company website, or generate the full
          comprehensive PDF audit you deliver to customers.
        </p>
      </div>

      {/* ------------------------------------------------ Quick audit */}
      <Card data-testid="card-quick-audit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5" /> Step 1 — Quick Audit (instant, free)</CardTitle>
          <CardDescription>
            Paste the company's website. You get a score, grade, and the list of issues in ~10 seconds.
            Same engine as the public /audit page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="https://companywebsite.com"
              value={quickUrl}
              onChange={(e) => setQuickUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !quickLoading && runQuickAudit()}
              data-testid="input-quick-url"
            />
            <Button onClick={runQuickAudit} disabled={quickLoading || !quickUrl.trim()} data-testid="button-run-quick">
              {quickLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Run Audit"}
            </Button>
          </div>
          {quickError && <p className="text-sm text-destructive" data-testid="text-quick-error">{quickError}</p>}
          {quickResult && (
            <div className="space-y-4" data-testid="section-quick-result">
              <div className="flex items-center gap-3">
                <span className={`text-xl font-bold rounded-md px-3 py-1 ${gradeColor(quickResult.grade)}`}>{quickResult.grade}</span>
                <span className="text-lg font-semibold">{quickResult.overallScore}/100</span>
                <span className="text-sm text-muted-foreground truncate">{quickResult.finalUrl}</span>
              </div>
              <div className="space-y-2">
                {quickResult.checks.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 text-sm border rounded-md p-2">
                    <StatusIcon status={c.status} />
                    <div className="min-w-0">
                      <span className="font-medium">{c.label}</span>
                      <span className="text-muted-foreground ml-2">{c.score}/{c.maxScore}</span>
                      <p className="text-muted-foreground">{c.detail}</p>
                      {c.recommendation && <p className="text-foreground/80 mt-0.5">Fix: {c.recommendation}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {quickResult.recommendations.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-1">Top improvements</h3>
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    {quickResult.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------ Full PDF audit */}
      <Card data-testid="card-full-audit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Step 2 — Comprehensive Audit (customer PDF)</CardTitle>
          <CardDescription>
            Generates the full multi-page PDF deliverable (the $497 report): executive summary, llms.txt
            checklist, all issues, AI tooling opportunities, and a 90-day improvement roadmap. Takes a few
            minutes — you can leave this page and come back.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input placeholder="Company name (required)" value={company} onChange={(e) => setCompany(e.target.value)} data-testid="input-full-company" />
            <Input placeholder="Website (required)" value={website} onChange={(e) => setWebsite(e.target.value)} data-testid="input-full-website" />
          </div>
          <Input placeholder="Industry (optional, e.g. dental clinic, HVAC)" value={industry} onChange={(e) => setIndustry(e.target.value)} data-testid="input-full-industry" />
          <Input placeholder="CRM they already use (optional, e.g. HubSpot, Salesforce, GoHighLevel — tailors the report to it)" value={crm} onChange={(e) => setCrm(e.target.value)} data-testid="input-full-crm" />
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-sm font-medium">Send it to the customer? (optional)</p>
            <p className="text-xs text-muted-foreground">
              Add their email and the finished report goes straight to your review queue as a paid-offline order
              (check/cash/invoice). One tap on "Approve &amp; ship" there emails them the download link — no manual
              attaching. Leave blank to just download the PDF yourself.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Customer name (optional)" value={customerName} onChange={(e) => setCustomerName(e.target.value)} data-testid="input-full-customer-name" />
              <Input type="email" placeholder="Customer email (optional)" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} data-testid="input-full-customer-email" />
            </div>
          </div>
          <Textarea placeholder="Notes for the report (optional — anything you know about the business)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} data-testid="input-full-notes" />
          <Button onClick={runFullAudit} disabled={job?.status === "running" || !company.trim() || !website.trim()} data-testid="button-run-full">
            {job?.status === "running" ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating PDF…</> : "Generate Full PDF Audit"}
          </Button>
          {fullError && <p className="text-sm text-destructive" data-testid="text-full-error">{fullError}</p>}

          {job && (
            <div className="border rounded-md p-3 text-sm space-y-2" data-testid="section-full-job">
              {job.status === "running" && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Writing the report for {job.company || company}… this usually takes 3–8 minutes.
                </p>
              )}
              {job.status === "done" && (
                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-green-600 font-medium">
                    <CheckCircle2 className="h-4 w-4" /> PDF ready{job.pages ? ` — ${job.pages} pages` : ""}.
                  </p>
                  {job.queuedReviewId && (
                    <p className="text-sm" data-testid="text-queued-review">
                      It's waiting in your{" "}
                      <a href="/admin/service-orders" className="underline font-medium">review queue</a>
                      {job.customerEmail ? <> — proofread it there, then "Approve &amp; ship" emails the download link to {job.customerEmail}.</> : "."}
                    </p>
                  )}
                  {!job.queuedReviewId && job.error && (
                    <p className="text-sm text-amber-600 dark:text-amber-400">{job.error}</p>
                  )}
                  <Button
                    onClick={async () => {
                      const res = await authFetch(`/api/admin/audit/full/${job.jobId}/download`);
                      if (!res.ok) { setFullError("Download failed — the file may have been moved."); return; }
                      const blob = await res.blob();
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = job.fileName || "ai-readiness-audit.pdf";
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                    data-testid="button-download-pdf"
                  >
                    <Download className="h-4 w-4 mr-2" /> Download PDF
                  </Button>
                </div>
              )}
              {job.status === "error" && (
                <p className="text-destructive flex items-center gap-2">
                  <XCircle className="h-4 w-4" /> Generation failed: {job.error || "unknown error"}
                </p>
              )}
            </div>
          )}
          <div className="text-xs text-muted-foreground pt-1">
            <Badge variant="secondary" className="mr-2">Tip</Badge>
            Want to see what a finished report looks like first? Open the{" "}
            <a href="/api/public/audit/sample.pdf" target="_blank" rel="noreferrer" className="underline">sample audit PDF</a>.
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------ DFY Fix Kit */}
      <DfyCard defaultCompany={company} defaultWebsite={website} defaultIndustry={industry} defaultCustomerName={customerName} defaultCustomerEmail={customerEmail} />
    </div>
    </div>
  );
}

// ============================================================================
// Step 3 — $1,997 Done-For-You Fix Kit (free admin runs + customer intake links)
// ============================================================================

interface IntakeFormRow {
  id: number;
  company: string;
  website: string;
  customerName?: string | null;
  customerEmail?: string | null;
  status: "sent" | "submitted";
  answeredCount: number;
  path: string;
  createdAt: string;
  submittedAt?: string | null;
}

function DfyCard(props: {
  defaultCompany: string;
  defaultWebsite: string;
  defaultIndustry: string;
  defaultCustomerName: string;
  defaultCustomerEmail: string;
}) {
  const [company, setCompany] = useState(props.defaultCompany);
  const [website, setWebsite] = useState(props.defaultWebsite);
  const [industry, setIndustry] = useState(props.defaultIndustry);
  const [customerName, setCustomerName] = useState(props.defaultCustomerName);
  const [customerEmail, setCustomerEmail] = useState(props.defaultCustomerEmail);
  const [forms, setForms] = useState<IntakeFormRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "link" | "run">("");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Follow Step 2 typing so the operator doesn't retype everything.
  useEffect(() => { if (props.defaultCompany && !company) setCompany(props.defaultCompany); }, [props.defaultCompany]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (props.defaultWebsite && !website) setWebsite(props.defaultWebsite); }, [props.defaultWebsite]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadForms() {
    try {
      const res = await authFetch("/api/admin/dfy-intake");
      if (!res.ok) return;
      const data = await res.json();
      setForms(Array.isArray(data?.forms) ? data.forms : []);
    } catch { /* non-fatal */ }
  }
  useEffect(() => { loadForms(); }, []);

  function fullLink(path: string): string {
    return `${window.location.origin}${path}`;
  }

  async function copyLink(row: IntakeFormRow) {
    try {
      await navigator.clipboard.writeText(fullLink(row.path));
      setCopiedId(row.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setNotice(`Copy failed — link: ${fullLink(row.path)}`);
    }
  }

  async function createLink() {
    if (!company.trim() || !website.trim()) { setError("Company and website are required."); return; }
    setBusy("link"); setError(null); setNotice(null);
    try {
      const res = await authFetch("/api/admin/dfy-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: company.trim(),
          website: website.trim(),
          customerName: customerName.trim() || null,
          customerEmail: customerEmail.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not create the link");
      const link = fullLink(data.path);
      try { await navigator.clipboard.writeText(link); setNotice("Intake link created and copied — paste it into an email or text to the customer."); }
      catch { setNotice(`Intake link created: ${link}`); }
      await loadForms();
    } catch (e: any) {
      setError(e?.message || "Could not create the link");
    } finally { setBusy(""); }
  }

  const [printingId, setPrintingId] = useState<number | -1 | null>(null); // -1 = blank
  async function printQuestionnaire(formId?: number) {
    setPrintingId(formId ?? -1); setError(null);
    try {
      const res = await authFetch(`/api/admin/dfy-intake/pdf${formId ? `?formId=${formId}` : ""}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Could not generate the PDF");
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "ai-setup-questionnaire.pdf";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      setError(e?.message || "Could not generate the PDF");
    } finally { setPrintingId(null); }
  }

  async function runKit(intakeFormId?: number, rowCompany?: string, rowWebsite?: string) {
    const c = (rowCompany || company).trim();
    const w = (rowWebsite || website).trim();
    if (!c || !w) { setError("Company and website are required."); return; }
    setBusy("run"); setError(null); setNotice(null);
    try {
      const res = await authFetch("/api/admin/audit/dfy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: c,
          website: w,
          industry: industry.trim() || null,
          customerName: customerName.trim() || null,
          customerEmail: customerEmail.trim() || null,
          intakeFormId: intakeFormId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not start the Fix Kit");
      setNotice("Fix Kit generation started (free — no charge). It takes a few minutes, then appears in your review queue where you approve & ship it.");
    } catch (e: any) {
      setError(e?.message || "Could not start the Fix Kit");
    } finally { setBusy(""); }
  }

  return (
    <Card data-testid="card-dfy" className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-5 w-5" /> Step 3 — Done-For-You Fix Kit ($1,997 tier — run free)
        </CardTitle>
        <CardDescription>
          Builds the actual fix files (llms.txt, schema markup, meta tags, robots additions) as a ready-to-install
          zip. Running it here is <span className="font-medium text-foreground">always free</span> — no Stripe, no charge —
          perfect for validation give-aways. The kit lands in your{" "}
          <a href="/admin/service-orders" className="underline">review queue</a> for approval before anything ships.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="Company name (required)" value={company} onChange={(e) => setCompany(e.target.value)} data-testid="input-dfy-company" />
          <Input placeholder="Website (required)" value={website} onChange={(e) => setWebsite(e.target.value)} data-testid="input-dfy-website" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input placeholder="Industry (optional)" value={industry} onChange={(e) => setIndustry(e.target.value)} data-testid="input-dfy-industry" />
          <Input placeholder="Customer name (optional)" value={customerName} onChange={(e) => setCustomerName(e.target.value)} data-testid="input-dfy-customer-name" />
          <Input type="email" placeholder="Customer email (optional)" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} data-testid="input-dfy-customer-email" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={createLink} disabled={busy !== "" || !company.trim() || !website.trim()} data-testid="button-create-intake">
            {busy === "link" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <LinkIcon className="h-4 w-4 mr-2" />}
            Create customer intake link
          </Button>
          <Button onClick={() => runKit()} disabled={busy !== "" || !company.trim() || !website.trim()} data-testid="button-run-dfy">
            {busy === "run" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wrench className="h-4 w-4 mr-2" />}
            Generate Fix Kit now (free)
          </Button>
          <Button variant="ghost" onClick={() => printQuestionnaire()} disabled={printingId !== null} data-testid="button-print-blank-questionnaire">
            {printingId === -1 ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Printer className="h-4 w-4 mr-2" />}
            Print blank questionnaire (PDF)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Best flow: create the intake link → the customer fills in their real details (hours, services, FAQs…) →
          you get an email when they submit → generate the kit and their answers are baked in automatically.
          You can also generate immediately; it then uses only what's on their website.
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Not comfortable with computers?</span> Print the paper questionnaire
          (blank, or the personalized one on a form row below), have the customer fill it in by hand, then use
          "Enter answers" on their form to type it into the system yourself — the Fix Kit uses it exactly the same way.
        </p>
        {error && <p className="text-sm text-destructive" data-testid="text-dfy-error">{error}</p>}
        {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400" data-testid="text-dfy-notice">{notice}</p>}

        {forms.length > 0 && (
          <div className="space-y-2" data-testid="section-intake-forms">
            <h3 className="text-sm font-semibold">Customer intake forms</h3>
            {forms.map((f) => (
              <div key={f.id} className="border rounded-md p-2.5 text-sm flex flex-wrap items-center gap-2" data-testid={`row-intake-${f.id}`}>
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{f.company}</span>
                  <span className="text-muted-foreground ml-2 truncate">{f.website}</span>
                  <div className="text-xs text-muted-foreground">
                    {f.status === "submitted"
                      ? <span className="text-emerald-600 dark:text-emerald-400 font-medium">Submitted — {f.answeredCount} answers</span>
                      : "Waiting for the customer"}
                    {f.customerEmail ? ` · ${f.customerEmail}` : ""}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => copyLink(f)} data-testid={`button-copy-link-${f.id}`}>
                  {copiedId === f.id ? "Copied!" : "Copy link"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => printQuestionnaire(f.id)} disabled={printingId !== null} data-testid={`button-print-questionnaire-${f.id}`}>
                  {printingId === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Printer className="h-4 w-4 mr-1.5" />Print PDF</>}
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.open(f.path, "_blank")} data-testid={`button-enter-answers-${f.id}`}>
                  {f.status === "submitted" ? "View / edit answers" : "Enter answers"}
                </Button>
                {f.status === "submitted" && (
                  <Button size="sm" onClick={() => runKit(f.id, f.company, f.website)} disabled={busy !== ""} data-testid={`button-run-with-intake-${f.id}`}>
                    Generate with these answers
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
