import { useEffect, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Clipboard, Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { authFetch } from "@/lib/queryClient";

type PackageFile = {
  key: string;
  label: string;
  filename: string;
  category: "full" | "teaser";
};

type Coverage = {
  discovered: number;
  reviewed: number;
  failed: number;
  capped: boolean;
};

type ReportPackage = {
  id: string;
  status: string;
  phase?: string | null;
  company: string;
  website: string;
  error?: string | null;
  createdAt: string;
  files: PackageFile[];
  coverage?: Coverage;
  emailSummary?: string;
};

type PackageFields = {
  company: string;
  website: string;
  principalName: string;
  industry: string;
  crm: string;
  notes: string;
  intakeText: string;
};

type SavedDraft = { requestId: string; fields: PackageFields };

const EMPTY_FIELDS: PackageFields = {
  company: "",
  website: "",
  principalName: "",
  industry: "",
  crm: "",
  notes: "",
  intakeText: "",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function readDraft(key: string): SavedDraft {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as SavedDraft | null;
    if (value?.requestId && UUID_PATTERN.test(value.requestId) && value.fields) {
      return {
        requestId: value.requestId,
        fields: { ...EMPTY_FIELDS, ...value.fields },
      };
    }
  } catch {
    // A damaged local draft should never prevent the package form from opening.
  }
  return { requestId: "", fields: EMPTY_FIELDS };
}

function isInProgress(status: string | undefined): boolean {
  return !!status && /^(accepted|pending|queued|running|processing|in_progress)$/i.test(status);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null);
  return payload?.error || payload?.message || `${response.status} ${response.statusText}`;
}

function OwnerPackageForm({ tenantId, onModeChange }: { tenantId: number; onModeChange?: (enabled: boolean) => void }) {
  const draftStorageKey = `company-report-package-draft:${tenantId}`;
  const activeStorageKey = `company-report-package-active:${tenantId}`;
  const [draft] = useState(() => readDraft(draftStorageKey));
  const [fields, setFields] = useState<PackageFields>(draft.fields);
  const [requestId, setRequestId] = useState(draft.requestId);
  const [enabled, setEnabled] = useState(() => {
    try { return !!localStorage.getItem(activeStorageKey); } catch { return false; }
  });
  const [acceptResearchCost, setAcceptResearchCost] = useState(false);
  const [items, setItems] = useState<ReportPackage[]>([]);
  const [activeItem, setActiveItem] = useState<ReportPackage | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [openedId, setOpenedId] = useState<string | null>(null);
  useEffect(() => { onModeChange?.(enabled); }, [enabled, onModeChange]);

  function persistDraft(nextFields: PackageFields, nextRequestId: string) {
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({ requestId: nextRequestId, fields: nextFields }));
    } catch {
      // The server remains the source of truth; local storage is only for safe resume.
    }
  }

  function updateField<K extends keyof PackageFields>(key: K, value: PackageFields[K]) {
    const nextFields = { ...fields, [key]: value };
    const nextRequestId = makeUuid();
    setFields(nextFields);
    setRequestId(nextRequestId);
    setPackageError(null);
    setPollError(null);
    setActiveItem(null);
    setOpenedId(null);
    persistDraft(nextFields, nextRequestId);
  }

  async function refreshItems(): Promise<ReportPackage[]> {
    setLoadingList(true);
    setListError(null);
    try {
      const response = await authFetch("/api/admin/company-report-packages");
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json();
      const nextItems: ReportPackage[] = Array.isArray(payload?.items) ? payload.items : [];
      setItems(nextItems);
      return nextItems;
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Could not load recent packages.");
      return [];
    } finally {
      setLoadingList(false);
    }
  }

  async function openPackage(id: string) {
    setOpenedId(id);
    setPackageError(null);
    setPollError(null);
    try {
      const response = await authFetch(`/api/admin/company-report-packages/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error(await responseError(response));
      const item = (await response.json()) as ReportPackage;
      setActiveItem(item);
      try { localStorage.setItem(activeStorageKey, item.id); } catch { /* optional resume */ }
    } catch (error) {
      setPackageError(error instanceof Error ? error.message : "Could not load this package.");
    }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      const recent = await refreshItems();
      if (!mounted) return;
      let savedId = "";
      try { savedId = localStorage.getItem(activeStorageKey) || ""; } catch { /* optional resume */ }
      if (savedId && savedId.length <= 200) {
        try {
          const response = await authFetch(`/api/admin/company-report-packages/${encodeURIComponent(savedId)}`);
          if (!response.ok) throw new Error(await responseError(response));
          const item = (await response.json()) as ReportPackage;
          if (mounted) {
            setActiveItem(item);
            setOpenedId(item.id);
          }
        } catch {
          // Preserve the saved id and show the server's recent list instead.
        }
      } else if (recent.length) {
        // Recent packages are intentionally listed, not silently selected or submitted.
      }
    })();
    return () => { mounted = false; };
    // This is scoped to the authenticated owner tenant; identity changes remount the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (!activeItem?.id || !isInProgress(activeItem.status)) return;
    let attempts = 0;
    let failures = 0;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) return;
      attempts += 1;
      if (attempts > 120) {
        stopped = true;
        setPollError("Progress polling stopped after 10 minutes. The package may still be running; refresh or open it again to check.");
        return;
      }
      try {
        const response = await authFetch(`/api/admin/company-report-packages/${encodeURIComponent(activeItem.id)}`);
        if (!response.ok) throw new Error(await responseError(response));
        const item = (await response.json()) as ReportPackage;
        failures = 0;
        setPollError(null);
        setActiveItem(item);
        if (!isInProgress(item.status)) {
          stopped = true;
          window.clearInterval(timer);
          void refreshItems();
        }
      } catch (error) {
        failures += 1;
        if (failures >= 24) {
          stopped = true;
          window.clearInterval(timer);
          setPollError(error instanceof Error ? error.message : "Could not check package progress.");
        }
      }
    }, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // refreshItems is intentionally not a dependency; polling follows the active id/status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem?.id, activeItem?.status]);

  async function submitPackage() {
    setPackageError(null);
    setPollError(null);
    const company = fields.company.trim();
    const website = fields.website.trim();
    if (!company) { setPackageError("Company name is required."); return; }
    if (company.length > 200) { setPackageError("Company name must be 200 characters or fewer."); return; }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(website);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new Error();
    } catch {
      setPackageError("Enter a complete website address beginning with http:// or https://.");
      return;
    }
    if (website.length > 300) { setPackageError("Website address must be 300 characters or fewer."); return; }
    if (fields.principalName.trim().length > 120 || fields.industry.trim().length > 200 || fields.crm.trim().length > 120 || fields.notes.length > 2000) {
      setPackageError("One or more optional fields exceed their character limit.");
      return;
    }
    if (fields.intakeText.length > 20000 || new TextEncoder().encode(fields.intakeText).byteLength > 20000) {
      setPackageError("Intake notes must be no more than 20 KB.");
      return;
    }
    if (!acceptResearchCost) {
      setPackageError("Acknowledge the upfront research cost before starting the package.");
      return;
    }
    if (!UUID_PATTERN.test(requestId)) {
      setPackageError("Edit a package input to create its request identifier before starting.");
      return;
    }
    const idempotencyKey = requestId;
    setSubmitting(true);
    try {
      const response = await authFetch("/api/admin/company-report-packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: idempotencyKey,
          company,
          website: parsedUrl.toString(),
          principalName: fields.principalName.trim() || undefined,
          industry: fields.industry.trim() || undefined,
          crm: fields.crm.trim() || undefined,
          notes: fields.notes.trim() || undefined,
          intakeText: fields.intakeText || undefined,
          acceptResearchCost: true,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || payload?.message || `${response.status} ${response.statusText}`);
      if (!payload?.id) throw new Error("The server accepted the request but returned no package ID. Keep this request ID and check recent packages before trying again.");
      const accepted: ReportPackage = {
        id: payload.id,
        status: payload.status || "accepted",
        company,
        website: parsedUrl.toString(),
        createdAt: new Date().toISOString(),
        files: [],
      };
      setActiveItem(accepted);
      setOpenedId(accepted.id);
      try { localStorage.setItem(activeStorageKey, accepted.id); } catch { /* server list remains authoritative */ }
      await refreshItems();
      await openPackage(accepted.id);
    } catch (error) {
      // Keep the exact request UUID and draft after ambiguous failures; retry is always manual.
      setPackageError(error instanceof Error ? error.message : "Could not start the package.");
    } finally {
      setSubmitting(false);
    }
  }

  function prepareAnotherPackage() {
    const nextId = makeUuid();
    setRequestId(nextId);
    setActiveItem(null);
    setOpenedId(null);
    setPackageError(null);
    setPollError(null);
    setCopyNotice(null);
    setAcceptResearchCost(false);
    persistDraft(fields, nextId);
    try { localStorage.removeItem(activeStorageKey); } catch { /* optional resume */ }
  }

  async function downloadFile(file: PackageFile) {
    if (!activeItem || !activeItem.files.some((candidate) => candidate.key === file.key)) return;
    setDownloadingKey(file.key);
    setPackageError(null);
    try {
      const response = await authFetch(`/api/admin/company-report-packages/${encodeURIComponent(activeItem.id)}/files/${encodeURIComponent(file.key)}`);
      if (!response.ok) throw new Error(await responseError(response));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const headerName = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1]?.replace(/"$/, "");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = headerName ? decodeURIComponent(headerName) : file.filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setPackageError(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setDownloadingKey(null);
    }
  }

  async function copySummary() {
    if (!activeItem?.emailSummary) return;
    try {
      await navigator.clipboard.writeText(activeItem.emailSummary);
      setCopyNotice("Email summary copied. Review and send it manually.");
    } catch {
      setCopyNotice("Copy was unavailable in this browser. Select the summary text and copy it manually.");
    }
  }

  async function handleIntakeUpload(file?: File) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["md", "txt", "csv"].includes(extension || "")) {
      setPackageError("Upload a .md, .txt, or .csv file.");
      return;
    }
    if (file.size > 20000) {
      setPackageError("That file is over the 20 KB intake limit.");
      return;
    }
    try {
      const text = await file.text();
      if (new TextEncoder().encode(text).byteLength > 20000) {
        setPackageError("That file is over the 20 KB intake limit.");
        return;
      }
      updateField("intakeText", text);
      setPackageError(null);
    } catch {
      setPackageError("Could not read that file. Try a plain-text .md, .txt, or .csv file.");
    }
  }

  const busy = submitting || isInProgress(activeItem?.status);
  const fullFiles = activeItem?.files.filter((file) => file.category === "full") || [];
  const teaserFiles = activeItem?.files.filter((file) => file.category === "teaser") || [];
  const canStart = !busy && !submitting && !activeItem && !!fields.company.trim() && !!fields.website.trim();

  return (
    <Card className="border-primary/25" data-testid="card-company-report-package">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Three-report package</CardTitle>
        <CardDescription>
          One approved research run produces three complete private reports, three one-page teasers, and a combined three-page teaser PDF. Each full report includes one complete American-English MP3 narrated by Eric. Audio covers the report body only, not source excerpts, citation codes, or supporting appendices. Teasers have no audio and are for manual initial outreach; there is no independent quick-teaser research.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-start gap-3 rounded-md border p-3 text-sm font-medium leading-5">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-primary"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            aria-controls="company-report-package-fields"
            data-testid="checkbox-generate-report-package"
          />
          <span>Generate all three reports together + one-page teasers</span>
        </label>

        {enabled && (
          <div id="company-report-package-fields" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Company name (required)"
                value={fields.company}
                maxLength={200}
                disabled={busy}
                onChange={(event) => updateField("company", event.target.value)}
                aria-label="Package company name"
              />
              <Input
                placeholder="Website URL (required)"
                value={fields.website}
                maxLength={300}
                disabled={busy}
                onChange={(event) => updateField("website", event.target.value)}
                aria-label="Package website URL"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Principal name (optional)"
                value={fields.principalName}
                maxLength={120}
                disabled={busy}
                onChange={(event) => updateField("principalName", event.target.value)}
                aria-label="Package principal name"
              />
              <Input
                placeholder="Industry (optional)"
                value={fields.industry}
                maxLength={200}
                disabled={busy}
                onChange={(event) => updateField("industry", event.target.value)}
                aria-label="Package industry"
              />
              <Input
                placeholder="CRM or core platform (optional)"
                value={fields.crm}
                maxLength={120}
                disabled={busy}
                onChange={(event) => updateField("crm", event.target.value)}
                aria-label="Package CRM or core platform"
              />
            </div>
            <Textarea
              placeholder="Notes about the company, goals, constraints, or known challenges (optional)"
              value={fields.notes}
              maxLength={2000}
              disabled={busy}
              onChange={(event) => updateField("notes", event.target.value)}
              rows={3}
              aria-label="Package research notes"
            />
            <div className="space-y-2">
              <label className="block text-sm font-medium" htmlFor="company-report-intake">Optional intake material</label>
              <p className="text-xs text-muted-foreground">
                Paste up to 20 KB or upload a .md, .txt, or .csv file. Fictional example: “Northstar Bicycle Repair is a two-location shop in Madison; most new customers arrive by referral, and the owner wants more tune-up bookings in winter.” Use a made-up company in examples, not real customer secrets.
              </p>
              <input
                id="company-report-intake-upload"
                type="file"
                accept=".md,.txt,.csv,text/plain,text/csv"
                disabled={busy}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
                aria-label="Upload optional intake notes"
                onChange={(event) => { void handleIntakeUpload(event.target.files?.[0]); event.currentTarget.value = ""; }}
              />
              <Textarea
                id="company-report-intake"
                placeholder="Paste optional background or questionnaire answers (20 KB maximum)"
                value={fields.intakeText}
                maxLength={20000}
                disabled={busy}
                onChange={(event) => updateField("intakeText", event.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">{new TextEncoder().encode(fields.intakeText).byteLength.toLocaleString()} / 20,000 bytes</p>
            </div>

            <div className="rounded-md border border-amber-300/70 bg-amber-50/60 p-3 dark:bg-amber-950/15">
              <label className="flex items-start gap-3 text-sm leading-5">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  checked={acceptResearchCost}
                  disabled={busy}
                  onChange={(event) => setAcceptResearchCost(event.target.checked)}
                  data-testid="checkbox-package-research-cost"
                />
                <span>
                  I understand the three full reports are produced upfront, even if the prospect has not bought. Compiler reserves can be up to $5 per report / $15 per package; established browser, report, audio, and Drive work still applies. $497 is the total sale price for the three-report package, not a generation charge. No customer is charged automatically.
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={submitPackage} disabled={!canStart || !acceptResearchCost} data-testid="button-start-report-package">
                {submitting || busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…</> : "Start all-three research run"}
              </Button>
              {activeItem && !isInProgress(activeItem.status) && (
                <Button variant="outline" onClick={prepareAnotherPackage} data-testid="button-new-report-package">
                  <RefreshCw className="mr-2 h-4 w-4" /> Prepare another package
                </Button>
              )}
              {activeItem && (
                <Button variant="ghost" onClick={() => void openPackage(activeItem.id)} disabled={busy} data-testid="button-refresh-report-package">
                  <RefreshCw className="mr-2 h-4 w-4" /> Check status
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Public site discovery maps up to 500 URLs; rendered browser review covers up to 30 pages or 8 minutes. Any skipped pages are disclosed in the result. Research does not submit forms or make purchases. No email is sent automatically.
            </p>

            {packageError && <p role="alert" className="text-sm text-destructive" data-testid="text-package-error"><AlertCircle className="mr-1 inline h-4 w-4" />{packageError}</p>}
            {listError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>Recent package list: {listError}</span><Button size="sm" variant="outline" onClick={() => void refreshItems()} disabled={loadingList}>Retry list</Button></div>}
            {pollError && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{pollError}</p>}

            {activeItem && (
              <section className="space-y-3 rounded-md border p-3" aria-label={`Package status for ${activeItem.company}`} data-testid="section-company-report-package-result">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{activeItem.company}</h3>
                    <p className="break-all text-xs text-muted-foreground">{activeItem.website}</p>
                    <p className="text-xs text-muted-foreground">Started {formatDate(activeItem.createdAt)}</p>
                  </div>
                  <Badge variant="outline" className="capitalize">{activeItem.status.replaceAll("_", " ")}</Badge>
                </div>
                {isInProgress(activeItem.status) ? (
                  <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    {activeItem.phase ? `Research phase: ${activeItem.phase.replaceAll("_", " ")}.` : "Researching and assembling the three full reports and their derived teasers."} Status checks run every five seconds; this page never starts a run on its own.
                  </p>
                ) : /^(done|complete|completed|succeeded|success)$/i.test(activeItem.status) ? (
                  <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Package processing finished. Download only the files listed below.</p>
                ) : (
                  <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{activeItem.error || "The package did not finish successfully. Server status is shown above."}</p>
                )}
                {activeItem.error && !isInProgress(activeItem.status) && !/^(failed|error)$/i.test(activeItem.status) && (
                  <p className="text-sm text-amber-700 dark:text-amber-300">Server note: {activeItem.error}</p>
                )}
                {activeItem.coverage && (
                  <div className="rounded bg-muted/50 p-3 text-sm">
                    <h4 className="font-medium">Website review coverage</h4>
                    <p className="mt-1 text-muted-foreground">
                      {activeItem.coverage.reviewed} of {activeItem.coverage.discovered} discovered URLs reviewed
                      {activeItem.coverage.failed > 0 ? ` · ${activeItem.coverage.failed} failed` : ""}
                      {activeItem.coverage.capped ? " · Partial coverage: discovered pages or sitemap branches remain unreviewed" : ""}.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">Coverage is partial when URLs were skipped or failed; this is not a claim that the entire website was examined.</p>
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Private full reports</h4>
                    {fullFiles.length ? fullFiles.map((file) => (
                      <div key={file.key} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                        <span className="min-w-0 flex-1 text-sm">{file.label}</span>
                        <Button size="sm" variant="outline" onClick={() => void downloadFile(file)} disabled={downloadingKey !== null}>
                          {downloadingKey === file.key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                          Download
                        </Button>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">No full-report downloads are available yet.</p>}
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">One-page outreach teasers</h4>
                    {teaserFiles.length ? teaserFiles.map((file) => (
                      <div key={file.key} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                        <span className="min-w-0 flex-1 text-sm">{file.label}</span>
                        <Button size="sm" variant="outline" onClick={() => void downloadFile(file)} disabled={downloadingKey !== null}>
                          {downloadingKey === file.key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                          Download
                        </Button>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">No teaser downloads are available yet.</p>}
                  </div>
                </div>
                {activeItem.emailSummary && (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">Manual outreach email draft</h4>
                      <Button size="sm" variant="outline" onClick={() => void copySummary()}>
                        {copyNotice?.startsWith("Email summary copied") ? <Check className="mr-2 h-4 w-4" /> : <Clipboard className="mr-2 h-4 w-4" />}
                        Copy summary
                      </Button>
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{activeItem.emailSummary}</p>
                    <p className="text-xs text-muted-foreground">This is a draft for you to review and send manually. No email has been sent.</p>
                    {copyNotice && <p role="status" className="text-xs text-muted-foreground">{copyNotice}</p>}
                  </div>
                )}
              </section>
            )}

            <section className="space-y-2" aria-label="Recent company report packages" data-testid="section-recent-report-packages">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Recent packages</h3>
                <Button size="sm" variant="ghost" onClick={() => void refreshItems()} disabled={loadingList}>
                  {loadingList ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Refresh
                </Button>
              </div>
              {loadingList && items.length === 0 ? (
                <div className="space-y-2" aria-label="Loading recent packages">
                  <div className="h-10 animate-pulse rounded bg-muted" />
                  <div className="h-10 animate-pulse rounded bg-muted/70" />
                </div>
              ) : items.length ? (
                <ul className="space-y-2">
                  {items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-2 rounded border p-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.company}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(item.createdAt)} · {item.status.replaceAll("_", " ")}</p>
                      </div>
                      <Button size="sm" variant="outline" disabled={openedId === item.id && !!activeItem} onClick={() => void openPackage(item.id)}>
                        Open results
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No report packages yet. Starting one requires the explicit action above.</p>
              )}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function CompanyReportPackage({ onModeChange }: { onModeChange?: (enabled: boolean) => void }) {
  const { tenant, isChecking } = useAuth();
  const isOwner = !isChecking && tenant?.id === 1 && tenant.isAdmin === true;
  if (!isOwner) return null;
  return <OwnerPackageForm tenantId={tenant!.id} onModeChange={onModeChange} />;
}
