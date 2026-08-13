import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/queryClient";
import { Loader2, Briefcase, Download, CheckCircle2, XCircle } from "lucide-react";

interface ExecJob {
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

export default function ExecutiveReportPage() {
  const [company, setCompany] = useState("");
  const [website, setWebsite] = useState("");
  const [principalName, setPrincipalName] = useState("");
  const [principalEmail, setPrincipalEmail] = useState("");
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState("");
  const [crm, setCrm] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ExecJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    let failures = 0;
    pollRef.current = setInterval(async () => {
      let failed = false;
      try {
        const res = await authFetch(`/api/admin/exec-report/${jobId}`);
        if (res.ok) {
          failures = 0;
          const data: ExecJob = await res.json();
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
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setError("Lost contact while checking the report's progress. It may still be running — refresh the page to check again.");
        setJob((j) => (j && j.status === "running" ? { ...j, status: "error", error: "Progress updates lost — refresh to re-check." } : j));
      }
    }, 5000);
  }

  async function runReport() {
    if (!company.trim() || !website.trim()) {
      setError("Company name and website are both required.");
      return;
    }
    const email = principalEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("That email doesn't look valid — fix it or leave it blank.");
      return;
    }
    setError(null);
    setJob(null);
    try {
      const res = await authFetch("/api/admin/exec-report/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: company.trim(),
          website: website.trim(),
          principalName: principalName.trim() || null,
          principalEmail: email || null,
          description: description.trim() || null,
          industry: industry.trim() || null,
          crm: crm.trim() || null,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data?.jobId) {
        setError(data?.error || "Another report is already generating — wait for it to finish.");
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Could not start the report");
      setJob({ jobId: data.jobId, status: "running", company, website });
      startPolling(data.jobId);
    } catch (e: any) {
      setError(e?.message || "Could not start the report");
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Briefcase className="h-6 w-6" /> Executive Opportunity Report
          </h1>
          <p className="text-muted-foreground mt-1">
            The full Felix-style executive report from one form: website strengths &amp; problems,
            profitability gaps, creative growth ideas, and a 30/60/90-day plan — as a styled boardroom PDF.
          </p>
        </div>

        <Card data-testid="card-exec-report">
          <CardHeader>
            <CardTitle>Company information</CardTitle>
            <CardDescription>
              Fill in what you know — only company and website are required. The more you add
              (what they do, their CRM, the principal's name), the sharper the report gets.
              The website is reviewed live as part of generation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Company name (required)" value={company} onChange={(e) => setCompany(e.target.value)} data-testid="input-exec-company" />
              <Input placeholder="Website (required)" value={website} onChange={(e) => setWebsite(e.target.value)} data-testid="input-exec-website" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Principal in charge (e.g. Mike Lannan)" value={principalName} onChange={(e) => setPrincipalName(e.target.value)} data-testid="input-exec-principal" />
              <Input type="email" placeholder="Principal's email (optional — routes to review queue for Approve & ship)" value={principalEmail} onChange={(e) => setPrincipalEmail(e.target.value)} data-testid="input-exec-email" />
            </div>
            <Textarea placeholder="What the company does (in your words — e.g. 'multifamily apartment owner-operator across IL and WI')" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} data-testid="input-exec-description" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Input placeholder="Industry (optional)" value={industry} onChange={(e) => setIndustry(e.target.value)} data-testid="input-exec-industry" />
              <Input placeholder="CRM / core platform (e.g. ResMan, HubSpot)" value={crm} onChange={(e) => setCrm(e.target.value)} data-testid="input-exec-crm" />
              <Input placeholder="Phone for the cover (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-exec-phone" />
            </div>
            <Textarea placeholder="Anything else you know (optional — problems they mentioned, goals, competitors…)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} data-testid="input-exec-notes" />
            <Button onClick={runReport} disabled={job?.status === "running" || !company.trim() || !website.trim()} data-testid="button-run-exec-report">
              {job?.status === "running" ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating report…</> : "Generate Executive Report"}
            </Button>
            {error && <p className="text-sm text-destructive" data-testid="text-exec-error">{error}</p>}

            {job && (
              <div className="border rounded-md p-3 text-sm space-y-2" data-testid="section-exec-job">
                {job.status === "running" && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reviewing the website and writing the report for {job.company || company}… this usually takes 3–8 minutes. You can leave this page and come back.
                  </p>
                )}
                {job.status === "done" && (
                  <div className="space-y-2">
                    <p className="flex items-center gap-2 text-green-600 font-medium">
                      <CheckCircle2 className="h-4 w-4" /> Report ready{job.pages ? ` — ${job.pages} pages` : ""}.
                    </p>
                    {job.queuedReviewId && (
                      <p className="text-sm" data-testid="text-exec-queued-review">
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
                        const res = await authFetch(`/api/admin/exec-report/${job.jobId}/download`);
                        if (!res.ok) { setError("Download failed — the file may have been moved."); return; }
                        const blob = await res.blob();
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = job.fileName || "executive-opportunity-report.pdf";
                        a.click();
                        URL.revokeObjectURL(a.href);
                      }}
                      data-testid="button-download-exec-report"
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
