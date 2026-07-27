import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/queryClient";
import { Loader2, FileText, Download, CheckCircle2, XCircle } from "lucide-react";

interface Job {
  jobId: string;
  status: "running" | "done" | "error";
  topic?: string;
  pages?: number | null;
  fileName?: string | null;
  error?: string | null;
}

export default function AdminResearchReportPage() {
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [focus, setFocus] = useState("");
  const [deep, setDeep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await authFetch(`/api/admin/income/research-report/${jobId}`);
        if (!res.ok) return;
        const data: Job = await res.json();
        setJob(data);
        if (data.status !== "running" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch { /* transient poll failure — keep trying */ }
    }, 5000);
  }

  async function run() {
    if (!topic.trim()) { setError("A topic is required."); return; }
    setError(null);
    setJob(null);
    try {
      const res = await authFetch("/api/admin/income/research-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          audience: audience.trim() || null,
          focus: focus.trim() || null,
          depth: deep ? "deep" : "standard",
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data?.jobId) {
        setJob({ jobId: data.jobId, status: "running" });
        startPolling(data.jobId);
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Could not start the report");
      setJob({ jobId: data.jobId, status: "running", topic });
      startPolling(data.jobId);
    } catch (e: any) {
      setError(e?.message || "Could not start the report");
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="h-6 w-6" /> Research Report
        </h1>
        <p className="text-muted-foreground mt-1">
          Generate the Custom AI Research Report (the $49 product) for free — a ~20-page PDF with
          executive summary, key findings, market landscape, risks, and a 90-day action checklist.
        </p>
      </div>

      <Card data-testid="card-research-report">
        <CardHeader>
          <CardTitle>New report</CardTitle>
          <CardDescription>Tell it the topic — everything else is optional. Takes a few minutes; you can leave and come back.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Topic (required) — e.g. AI adoption in dental practices" value={topic} onChange={(e) => setTopic(e.target.value)} data-testid="input-topic" />
          <Input placeholder="Audience (optional) — e.g. practice owners" value={audience} onChange={(e) => setAudience(e.target.value)} data-testid="input-audience" />
          <Textarea placeholder="Angle / focus (optional) — what should the report emphasize?" value={focus} onChange={(e) => setFocus(e.target.value)} rows={2} data-testid="input-focus" />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} data-testid="checkbox-deep" />
            Deep mode (longer, with extra fact-verification — takes longer)
          </label>
          <Button onClick={run} disabled={job?.status === "running" || !topic.trim()} data-testid="button-run-report">
            {job?.status === "running" ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating…</> : "Generate Report (free)"}
          </Button>
          {error && <p className="text-sm text-destructive" data-testid="text-report-error">{error}</p>}

          {job && (
            <div className="border rounded-md p-3 text-sm space-y-2" data-testid="section-report-job">
              {job.status === "running" && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Researching and writing… this usually takes 5–15 minutes.
                </p>
              )}
              {job.status === "done" && (
                <div className="space-y-2">
                  <p className="flex items-center gap-2 text-green-600 font-medium">
                    <CheckCircle2 className="h-4 w-4" /> Report ready{job.pages ? ` — ${job.pages} pages` : ""}.
                  </p>
                  <Button
                    onClick={async () => {
                      const res = await authFetch(`/api/admin/income/research-report/${job.jobId}/download`);
                      if (!res.ok) { setError("Download failed — the file may have been moved."); return; }
                      const blob = await res.blob();
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = job.fileName || "research-report.pdf";
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                    data-testid="button-download-report"
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
  );
}
