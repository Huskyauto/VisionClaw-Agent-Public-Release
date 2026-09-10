import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/queryClient";
import { Loader2, Users, Download, CheckCircle2, XCircle, Plus, Trash2, Search, MapPin } from "lucide-react";

interface FoundLead {
  name: string;
  website: string | null;
  address: string;
  phone: string | null;
  rating: number | null;
  reviews: number | null;
}

interface SmartLeadsJob {
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

interface LeadRow {
  domain: string;
  email: string;
  name: string;
  title: string;
  linkedin: string;
}

const MAX_LEADS = 8;
const JOB_STORAGE_KEY = "smart-leads-active-job";
const emptyLead = (): LeadRow => ({ domain: "", email: "", name: "", title: "", linkedin: "" });

// Normalized identity helpers so the same business can't be added twice —
// "https://www.AcmeHVAC.com/" and "acmehvac.com" are one lead.
const normHost = (raw: string): string =>
  raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const normName = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, " ");
const isDuplicateLead = (rows: LeadRow[], candidate: { website: string | null; name: string }): boolean => {
  const candHost = candidate.website ? normHost(candidate.website) : "";
  const candName = normName(candidate.name);
  return rows.some((l) => {
    const host = normHost(l.domain);
    if (candHost && host && host === candHost) return true;
    const name = normName(l.name);
    return !!candName && !!name && name === candName;
  });
};

export default function SmartLeadsPage() {
  const [oneLiner, setOneLiner] = useState("");
  const [customerCompany, setCustomerCompany] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [leads, setLeads] = useState<LeadRow[]>([emptyLead()]);
  const [error, setError] = useState<string | null>(null);
  const [findType, setFindType] = useState("");
  const [findLocation, setFindLocation] = useState("");
  const [findZip, setFindZip] = useState("");
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [found, setFound] = useState<FoundLead[] | null>(null);
  const [job, setJob] = useState<SmartLeadsJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Resume an in-flight/finished job across refreshes & navigation (jobs are
  // kept server-side for 24h; the id is remembered locally).
  useEffect(() => {
    const saved = localStorage.getItem(JOB_STORAGE_KEY);
    if (!saved) return;
    (async () => {
      try {
        const res = await authFetch(`/api/admin/smart-leads/${saved}`);
        if (res.status === 404) { localStorage.removeItem(JOB_STORAGE_KEY); return; } // job expired
        if (!res.ok) return; // transient — keep the id for the next visit
        const data: SmartLeadsJob = await res.json();
        setJob(data);
        if (data.status === "running") startPolling(saved);
      } catch { /* transient — leave the saved id for the next visit */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setLead(i: number, patch: Partial<LeadRow>) {
    setLeads((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const usableLeads = leads.filter((l) => l.domain.trim() || l.email.trim() || l.name.trim());

  function startPolling(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    let failures = 0;
    pollRef.current = setInterval(async () => {
      let failed = false;
      try {
        const res = await authFetch(`/api/admin/smart-leads/${jobId}`);
        if (res.status === 404) {
          // Job expired server-side — stop polling and drop the stale id.
          localStorage.removeItem(JOB_STORAGE_KEY);
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setJob((j) => (j && j.status === "running" ? { ...j, status: "error", error: "Job no longer found on the server (jobs are kept for 24h)." } : j));
          return;
        }
        if (res.ok) {
          failures = 0;
          const data: SmartLeadsJob = await res.json();
          setJob(data);
          if (data.status !== "running" && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          return;
        }
        failed = true;
      } catch {
        failed = true;
      }
      if (failed && ++failures >= 24) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setError("Lost contact while checking progress. It may still be running — refresh the page to check again.");
        setJob((j) => (j && j.status === "running" ? { ...j, status: "error", error: "Progress updates lost — refresh to re-check." } : j));
      }
    }, 5000);
  }

  async function runDossiers() {
    if (!oneLiner.trim() || oneLiner.trim().length < 5) {
      setError("Describe what you sell and to whom — that one-liner drives every dossier.");
      return;
    }
    if (usableLeads.length === 0) {
      setError("Add at least one lead with a company website, a contact email, or a name.");
      return;
    }
    const email = customerEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("That customer email doesn't look valid — fix it or leave it blank.");
      return;
    }
    setError(null);
    setJob(null);
    try {
      const res = await authFetch("/api/admin/smart-leads/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerOneLiner: oneLiner.trim(),
          customerCompany: customerCompany.trim() || null,
          customerEmail: email || null,
          leads: usableLeads.map((l) => ({
            domain: l.domain.trim() || null,
            email: l.email.trim() || null,
            name: l.name.trim() || null,
            title: l.title.trim() || null,
            linkedin: l.linkedin.trim() || null,
          })),
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data?.jobId) {
        setError(data?.error || "Another report is already generating — wait for it to finish.");
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Could not start the dossiers");
      localStorage.setItem(JOB_STORAGE_KEY, data.jobId);
      setJob({ jobId: data.jobId, status: "running" });
      startPolling(data.jobId);
    } catch (e: any) {
      setError(e?.message || "Could not start the dossiers");
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6" /> Smart Leads, Zero Research
          </h1>
          <p className="text-muted-foreground mt-1">
            Paste raw leads, get sales dossiers: each lead's website is researched live, then a
            one-page dossier is written for YOUR offer — company snapshot, buying signals, pain
            hypotheses, a recommended opener, and honest disqualifiers — all in one PDF with a
            fit-ranked summary.
          </p>
        </div>

        <Card data-testid="card-smart-leads">
          <CardHeader>
            <CardTitle>Your offer</CardTitle>
            <CardDescription>
              One sentence: what's being sold and to whom. Every dossier's pitch angle is tailored to it.
              If a customer email is added, the finished PDF goes to your review queue for "Approve &amp; ship".
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder='What you sell and to whom (required — e.g. "AI answering service for HVAC contractors who miss after-hours calls")'
              value={oneLiner}
              onChange={(e) => setOneLiner(e.target.value)}
              rows={2}
              data-testid="input-sl-oneliner"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Customer / company name for the cover (optional)" value={customerCompany} onChange={(e) => setCustomerCompany(e.target.value)} data-testid="input-sl-company" />
              <Input type="email" placeholder="Customer's email (optional — routes to review queue for Approve & ship)" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} data-testid="input-sl-email" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-smart-leads-find">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Search className="h-5 w-5" /> Find leads near a location</CardTitle>
            <CardDescription>
              This is the discovery half: tell it what kind of businesses to go after and where, and it pulls
              real nearby businesses from Google Maps. Click "Add" on the good ones and they drop straight
              into the lead list below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder='Kind of business to target (e.g. "commercial cleaning companies")' value={findType} onChange={(e) => setFindType(e.target.value)} data-testid="input-sl-find-type" />
              <Input placeholder='City / area (e.g. "[Your City, ST]")' value={findLocation} onChange={(e) => setFindLocation(e.target.value)} data-testid="input-sl-find-location" />
              <Input placeholder="ZIP code (optional — narrows to one part of town)" value={findZip} onChange={(e) => setFindZip(e.target.value)} data-testid="input-sl-find-zip" />
            </div>
            <Button
              variant="secondary"
              disabled={finding || findType.trim().length < 2 || findLocation.trim().length < 2}
              onClick={async () => {
                setFinding(true); setFindError(null); setFound(null);
                try {
                  const res = await authFetch("/api/admin/smart-leads/find", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ businessType: findType.trim(), location: findLocation.trim(), zip: findZip.trim() || undefined }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data?.error || "Search failed");
                  setFound(data.results || []);
                } catch (e: any) {
                  setFindError(e?.message || "Search failed");
                } finally {
                  setFinding(false);
                }
              }}
              data-testid="button-sl-find"
            >
              {finding ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching…</> : <><MapPin className="h-4 w-4 mr-2" /> Find Businesses</>}
            </Button>
            {findError && <p className="text-sm text-destructive" data-testid="text-sl-find-error">{findError}</p>}
            {found && found.length === 0 && <p className="text-sm text-muted-foreground">No businesses found — try a broader business type or a bigger city.</p>}
            {found && found.length > 0 && (
              <div className="space-y-2" data-testid="list-sl-found">
                {found.map((f, i) => {
                  const alreadyAdded = isDuplicateLead(leads, f);
                  const atCap = usableLeads.length >= MAX_LEADS;
                  return (
                    <div key={i} className="border rounded-md p-2 flex items-center justify-between gap-2 text-sm" data-testid={`row-sl-found-${i}`}>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{f.name}{f.rating != null && <span className="text-muted-foreground font-normal"> · {f.rating}★{f.reviews != null ? ` (${f.reviews})` : ""}</span>}</p>
                        <p className="text-muted-foreground truncate">{f.address}{f.phone ? ` · ${f.phone}` : ""}{!f.website ? " · no website listed" : ""}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={alreadyAdded || atCap}
                        onClick={() => {
                          const row: LeadRow = { domain: f.website || "", email: "", name: f.name, title: "", linkedin: "" };
                          setLeads((rows) => {
                            const cleaned = rows.filter((r) => r.domain.trim() || r.email.trim() || r.name.trim());
                            // The updater re-enforces the invariants — button state alone
                            // can't protect against rapid/stale clicks.
                            if (isDuplicateLead(cleaned, f) || cleaned.length >= MAX_LEADS) {
                              return cleaned.length > 0 ? cleaned : [emptyLead()];
                            }
                            return [...cleaned, row];
                          });
                        }}
                        data-testid={`button-sl-found-add-${i}`}
                      >
                        {alreadyAdded ? "Added" : atCap ? "List full" : "Add"}
                      </Button>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">Businesses without a website still get a dossier — it just leans on the name, area, and industry instead of a live site review.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-smart-leads-list">
          <CardHeader>
            <CardTitle>Leads ({usableLeads.length} of {MAX_LEADS} max)</CardTitle>
            <CardDescription>
              Each lead needs at least a company website OR a contact email (the domain is pulled from it).
              Name, title, and LinkedIn sharpen the dossier.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {leads.map((lead, i) => (
              <div key={i} className="border rounded-md p-3 space-y-2" data-testid={`row-sl-lead-${i}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Lead {i + 1}</p>
                  {leads.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => setLeads((rows) => rows.filter((_, idx) => idx !== i))} data-testid={`button-sl-remove-${i}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input placeholder="Company website / domain (e.g. acmehvac.com)" value={lead.domain} onChange={(e) => setLead(i, { domain: e.target.value })} data-testid={`input-sl-domain-${i}`} />
                  <Input placeholder="Contact email (optional)" value={lead.email} onChange={(e) => setLead(i, { email: e.target.value })} data-testid={`input-sl-lead-email-${i}`} />
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input placeholder="Contact name (optional)" value={lead.name} onChange={(e) => setLead(i, { name: e.target.value })} data-testid={`input-sl-name-${i}`} />
                  <Input placeholder="Title (optional)" value={lead.title} onChange={(e) => setLead(i, { title: e.target.value })} data-testid={`input-sl-title-${i}`} />
                  <Input placeholder="LinkedIn URL (optional)" value={lead.linkedin} onChange={(e) => setLead(i, { linkedin: e.target.value })} data-testid={`input-sl-linkedin-${i}`} />
                </div>
              </div>
            ))}
            {leads.length < MAX_LEADS && (
              <Button variant="outline" onClick={() => setLeads((rows) => [...rows, emptyLead()])} data-testid="button-sl-add-lead">
                <Plus className="h-4 w-4 mr-2" /> Add another lead
              </Button>
            )}

            <div className="pt-2 space-y-3">
              <Button onClick={runDossiers} disabled={job?.status === "running" || !oneLiner.trim() || usableLeads.length === 0} data-testid="button-run-smart-leads">
                {job?.status === "running" ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Researching &amp; writing…</> : `Generate ${usableLeads.length || ""} Dossier${usableLeads.length === 1 ? "" : "s"}`}
              </Button>
              {error && <p className="text-sm text-destructive" data-testid="text-sl-error">{error}</p>}

              {job && (
                <div className="border rounded-md p-3 text-sm space-y-2" data-testid="section-sl-job">
                  {job.status === "running" && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Researching each lead's website and writing the dossiers… roughly 2–4 minutes per lead. You can leave this page and come back.
                    </p>
                  )}
                  {job.status === "done" && (
                    <div className="space-y-2">
                      <p className="flex items-center gap-2 text-green-600 font-medium">
                        <CheckCircle2 className="h-4 w-4" /> Dossiers ready{job.pages ? ` — ${job.pages} pages` : ""}.
                      </p>
                      {job.queuedReviewId && (
                        <p className="text-sm" data-testid="text-sl-queued-review">
                          Also waiting in your{" "}
                          <a href="/admin/service-orders" className="underline font-medium">review queue</a>
                          {job.customerEmail ? <> — proofread it there, then "Approve &amp; ship" emails the download link to {job.customerEmail}.</> : "."}
                        </p>
                      )}
                      {!job.queuedReviewId && job.error && (
                        <p className="text-sm text-amber-600 dark:text-amber-400">{job.error}</p>
                      )}
                      <Button
                        onClick={async () => {
                          const res = await authFetch(`/api/admin/smart-leads/${job.jobId}/download`);
                          if (!res.ok) { setError("Download failed — the file may have been moved."); return; }
                          const blob = await res.blob();
                          const a = document.createElement("a");
                          a.href = URL.createObjectURL(blob);
                          a.download = job.fileName || "smart-leads-dossiers.pdf";
                          a.click();
                          URL.revokeObjectURL(a.href);
                        }}
                        data-testid="button-download-smart-leads"
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
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
