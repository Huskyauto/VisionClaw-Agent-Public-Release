import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/queryClient";
import { Loader2, Globe, FileText, Download, CheckCircle2, AlertTriangle, XCircle, Gauge } from "lucide-react";

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
  const [notes, setNotes] = useState("");
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
    pollRef.current = setInterval(async () => {
      try {
        const res = await authFetch(`/api/admin/audit/full/${jobId}`);
        if (!res.ok) return;
        const data: FullJob = await res.json();
        setJob(data);
        if (data.status !== "running" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        /* transient poll failure — keep trying */
      }
    }, 5000);
  }

  async function runFullAudit() {
    if (!company.trim() || !website.trim()) {
      setFullError("Company name and website are both required.");
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
          notes: notes.trim() || null,
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
    </div>
  );
}
