import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Copy, ExternalLink, FileText, Loader2, RefreshCw, Send, ShieldCheck, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type CmmcReport = {
  id: number;
  revision: number;
  status: string;
  pdfDriveFileId?: string | null;
  docxDriveFileId?: string | null;
  driveFolderId?: string | null;
  errorMessage?: string | null;
};

type CmmcAssessment = {
  id: number;
  companyName: string;
  customerName: string;
  customerEmail: string;
  status: string;
  submittedRevision?: number | null;
  reports?: CmmcReport[];
  cmmcSummary?: {
    cageCodes: string;
    cmmcStatusDate: string | null;
    level1SelfReady: boolean;
    notMetCount: number;
    notApplicableCount: number;
    retentionUntil: string;
  };
};

function driveFileUrl(fileId: string | null | undefined): string | null {
  return typeof fileId === "string" && /^[a-zA-Z0-9_-]{10,}$/.test(fileId)
    ? `https://drive.google.com/file/d/${fileId}/view?usp=sharing`
    : null;
}

function driveFolderUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value) return null;
  if (/^https:\/\/drive\.google\.com\/[^\s]+$/.test(value)) return value;
  return /^[a-zA-Z0-9_-]{10,}$/.test(value)
    ? `https://drive.google.com/drive/folders/${value}`
    : null;
}

function statusLabel(status: string): string {
  return ({
    draft: "Draft",
    invited: "Invitation sent",
    submitted: "Submitted — ready for review",
    report_ready: "Reports generated — ready to deliver",
    approved: "Approved",
    delivering: "Delivery in progress",
    delivered: "Delivered",
    delivery_failed: "Delivery failed — retry available",
  } as Record<string, string>)[status] || status.replaceAll("_", " ");
}

export default function AdminCmmcPage() {
  const { toast } = useToast();
  const [companyName, setCompanyName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [invite, setInvite] = useState("");
  const [pendingAssessmentId, setPendingAssessmentId] = useState<number | null>(null);
  const { data, isLoading, refetch } = useQuery<{ items: CmmcAssessment[] }>({ queryKey: ["/api/admin/cmmc"], queryFn: async () => (await apiRequest("GET", "/api/admin/cmmc")).json() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/cmmc"] });
  async function create() {
    try {
      const r = await apiRequest("POST", "/api/admin/cmmc", { companyName, customerName, customerEmail });
      const json = await r.json(); if (!r.ok) throw new Error(json.error);
      setInvite(json.inviteUrl); setCompanyName(""); setCustomerName(""); setCustomerEmail("");
      await refresh();
      toast({ title: "Invitation created", description: "Copy the secure link below and send it to the customer." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Invitation could not be created", description: error.message });
    }
  }
  async function action(url: string, assessmentId: number, kind: "invitation" | "revoke" | "generate" | "deliver") {
    setPendingAssessmentId(assessmentId);
    try {
      const r = await apiRequest("POST", url, {}); const json = await r.json(); if (!r.ok) throw new Error(json.error);
      if (json.inviteUrl) setInvite(json.inviteUrl);
      if (kind === "invitation") {
        toast({ title: "New invitation link created", description: "The expiring link is ready to copy below." });
      } else if (kind === "revoke") {
        toast({ title: "Invitation revoked", description: "The previous customer link can no longer be used." });
      } else if (kind === "generate") {
        if (json.report?.status === "reports_ready") {
          toast({ title: "Report pair generated", description: "The PDF and Word files are ready. Review the report card, then choose Approve & deliver." });
        } else if (json.report?.status === "generating") {
          toast({ title: "Report generation is already in progress", description: "The PDF and Word files are still being prepared. This page will refresh with their final status." });
        } else {
          toast({ title: "Existing report found", description: `Its current status is ${statusLabel(json.report?.status || "unknown")}.` });
        }
      } else {
        toast({ title: "Report delivered successfully", description: "The customer-stated PDF and Word preparation packets were delivered. Their Google Drive links are shown below." });
      }
      return json;
    } catch (error: any) {
      toast({ variant: "destructive", title: kind === "deliver" ? "Report delivery failed" : "CMMC action failed", description: error.message });
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/cmmc"] });
      setPendingAssessmentId(null);
    }
  }
  return <div className="h-full overflow-y-auto"><div className="container max-w-5xl px-4 py-8 space-y-6">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">CMMC Level 1 self-assessment preparation</h1><p className="text-sm text-muted-foreground mt-1">Customer-stated preparation packets only — not certification, legal advice, independent verification, or SPRS submission.</p></div><Button variant="outline" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-2" />Refresh</Button></div>
    <Card><CardHeader><CardTitle>Create secure customer questionnaire</CardTitle><CardDescription>Copy the expiring link and email it manually. Do not send FCI, CUI, credentials, or evidence files through this form.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-3">
      <div><Label>Company</Label><Input value={companyName} onChange={e => setCompanyName(e.target.value)} /></div><div><Label>Customer name</Label><Input value={customerName} onChange={e => setCustomerName(e.target.value)} /></div><div><Label>Customer email</Label><Input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} /></div>
      <div className="md:col-span-3"><Button onClick={() => create().catch(e => toast({ variant: "destructive", title: e.message }))} data-testid="button-create-cmmc"><ShieldCheck className="h-4 w-4 mr-2" />Create invitation</Button></div>
      {invite && <div className="md:col-span-3 flex gap-2"><Input readOnly value={invite} /><Button variant="outline" onClick={() => navigator.clipboard.writeText(invite)}><Copy className="h-4 w-4" /></Button></div>}
    </CardContent></Card>
    <div className="space-y-3">{isLoading ? <Loader2 className="animate-spin mx-auto" /> : data?.items.map(item => <Card key={item.id}><CardContent className="py-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-semibold">{item.companyName}</p><p className="text-sm text-muted-foreground">{item.customerName} · {item.customerEmail}</p>{item.cmmcSummary && <div className="mt-2 space-y-1 text-xs text-muted-foreground"><p>CAGE code(s): {item.cmmcSummary.cageCodes || "Not provided"}</p><p>CMMC Status Date: {item.cmmcSummary.cmmcStatusDate || "Not recorded — retention remains provisional"}</p>{item.submittedRevision && <p className={item.cmmcSummary.level1SelfReady ? "font-semibold text-emerald-700" : "font-semibold text-amber-800"}>{item.cmmcSummary.level1SelfReady ? `All customer-stated requirements are Met; ${item.cmmcSummary.notApplicableCount} objective(s) are documented Not applicable — Final Level 1 (Self) candidate only.` : `Not ready for Final Level 1 (Self): ${item.cmmcSummary.notMetCount} Not met response(s) or incomplete Not applicable rationale(s); Level 1 does not allow POA&Ms.`}</p>}</div>}</div><span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-800">{statusLabel(item.status)}</span></div>
      <div className="flex flex-wrap gap-2">{(() => {
        const pending = pendingAssessmentId === item.id;
        const hasReportAwaitingDelivery = item.reports?.some((report: any) => ["reports_ready", "delivering", "delivery_failed", "delivered"].includes(report.status));
        return <><Button size="sm" variant="outline" disabled={pending} onClick={() => action(`/api/admin/cmmc/${item.id}/invitation`, item.id, "invitation")}><Copy className="h-4 w-4 mr-1" />New link</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => action(`/api/admin/cmmc/${item.id}/revoke`, item.id, "revoke")}>Revoke</Button>
        {item.submittedRevision && !hasReportAwaitingDelivery && <Button size="sm" disabled={pending} onClick={() => action(`/api/admin/cmmc/${item.id}/generate`, item.id, "generate")}>{pending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}Generate pair</Button>}
        {item.reports?.filter(report => report.status === "reports_ready" || report.status === "delivery_failed").map(report => <Button key={report.id} size="sm" disabled={pending} onClick={() => action(`/api/admin/cmmc/${item.id}/reports/${report.id}/deliver`, item.id, "deliver")}>{pending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}Approve & deliver</Button>)}</>;
      })()}</div>
      {item.reports?.map(report => {
        const pdfUrl = driveFileUrl(report.pdfDriveFileId);
        const docxUrl = driveFileUrl(report.docxDriveFileId);
        const folderUrl = driveFolderUrl(report.driveFolderId);
        const ready = report.status === "reports_ready";
        const generating = report.status === "generating";
        const delivered = report.status === "delivered";
        const failed = report.status === "delivery_failed";
        return <div key={report.id} className={`rounded-lg border p-4 ${delivered ? "border-emerald-200 bg-emerald-50" : failed ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}>
          <div className="flex flex-wrap items-start gap-3">
            {delivered ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /> : failed ? <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /> : <FileText className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" />}
            <div className="min-w-0 flex-1"><p className="font-semibold text-slate-950">Report pair #{report.id} · {statusLabel(report.status)}</p>
              {ready && <p className="mt-1 text-sm text-slate-700">The PDF and Word files were generated successfully and are waiting for your review.</p>}
              {generating && <p className="mt-1 text-sm text-slate-700">The PDF and Word files are still being generated. Refresh this page in a moment to see the completed report pair.</p>}
              {failed && <p className="mt-1 text-sm text-amber-900">{report.errorMessage || "The paired delivery did not complete. Use Approve & deliver to retry the existing files."}</p>}
              {delivered && <p className="mt-1 text-sm text-emerald-900">Delivery completed. The customer-stated preparation packet links available on this report record are shown below:</p>}
              {delivered && <div className="mt-3 flex flex-wrap gap-2">
                {pdfUrl && <a className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 underline-offset-2 hover:underline" href={pdfUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />View PDF in Google Drive</a>}
                {!pdfUrl && <span className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">PDF Drive link unavailable on this report record.</span>}
                {docxUrl && <a className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 underline-offset-2 hover:underline" href={docxUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />View Word file in Google Drive</a>}
                {!docxUrl && <span className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">Word-file Drive link unavailable on this report record.</span>}
                {folderUrl && <a className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 underline-offset-2 hover:underline" href={folderUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Open customer Drive folder</a>}
              </div>}
            </div>
          </div>
        </div>;
      })}
    </CardContent></Card>)}</div>
  </div></div>;
}