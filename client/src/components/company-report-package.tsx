import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Clipboard, Download, FileText, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { authFetch, getAuthIdentityVersion } from "@/lib/queryClient";
import { PACKAGE_CONFIRMATION_ERROR, submitCompanyPackage } from "@/lib/company-package-submit";
import { websiteFromBusinessEmail } from "@shared/company-report-intake";

type PackageFile = {
  key: string;
  label: string;
  filename: string;
  category: "full" | "teaser";
  audioUrl?: string;
  pdfUrl?: string;
};

type Coverage = {
  discovered: number;
  reviewed: number;
  failed: number;
  capped: boolean;
  pending?: number;
  evidencePages?: number;
  factsPending?: number;
};
type Recovery = { available: boolean; canRepairResearch: boolean; requiresPaidRetryApproval: boolean;
  snapshot: string; reservedUsd: number; remainingUsd: number; reasons: string[] };
type ReviewContinuation = { available: boolean; snapshot: string; childIds: number[];
  reports: Array<{ kind: string; childId: number; eligible: boolean; reason?: string; compilerChars?: number }> };
type Configuration = { ready: boolean; issues: string[]; notice: string; modelBudgetUsd: number;
  models: Array<{ report: string; model: string; outputTokens: number }> };

type ReportPackage = {
  productionVersion?: number;
  compilationProgress?: { authors: number; syntheses: number; delivered: number;
    execution?: string;
    evidenceReferenceRecovery?: Array<{ operation: string; status: string; note: string }>;
    corrections?: Array<{ operation: string; phase: string; check: string; resolved?: boolean; notDispatched?: boolean }> };
  automaticCorrectionsApproved?: boolean;
  canResumeWithAutomaticCorrections?: boolean;
  targetedRepair?: { available: boolean; phase?: string };
  audioProgress?: Array<{ kind: string; stage?: string; savedChunks: number; totalChunks?: number }>;
  compilationRecovery?: { available: boolean; snapshot: string; operation?: string };
  repairPlan?: { available: boolean; snapshot: string; budgetUsd: number; maximumCompletionUsd: number | null; reasons: string[] };
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
  canResume?: boolean;
  recovery?: Recovery;
  reviewContinuation?: ReviewContinuation;
  reports?: Record<string, { status: string; error?: string }>;
};

type PackageFields = {
  company: string;
  contactEmail: string;
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
  contactEmail: "",
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
  const [enabled, setEnabled] = useState(true);
  const submitLock = useRef(false);
  const [acceptResearchCost, setAcceptResearchCost] = useState(false);
  const [allowAutomaticCorrections, setAllowAutomaticCorrections] = useState(false);
  const [items, setItems] = useState<ReportPackage[]>([]);
  const [activeItem, setActiveItem] = useState<ReportPackage | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [checkingConfiguration, setCheckingConfiguration] = useState(false);
  const [confirmPaidRetry, setConfirmPaidRetry] = useState(false);
  const [confirmedContinuation, setConfirmedContinuation] = useState<string | null>(null);
  const [confirmedRepair, setConfirmedRepair] = useState<string | null>(null);
  const [confirmedReplacement, setConfirmedReplacement] = useState<string | null>(null);
  const replacementSubject = activeItem?.compilationRecovery?.available
    ? `${activeItem.id}:${activeItem.compilationRecovery.snapshot}` : "";
  const continuationSubject = activeItem?.reviewContinuation
    ? `${activeItem.id}:${activeItem.reviewContinuation.snapshot}` : "";
  useEffect(() => { onModeChange?.(enabled); }, [enabled, onModeChange]);
  useEffect(() => { setConfirmPaidRetry(false); }, [activeItem?.id, activeItem?.recovery?.snapshot]);
  useEffect(() => { setAllowAutomaticCorrections(false); }, [activeItem?.id]);
  useEffect(() => { setConfirmedReplacement(null); }, [replacementSubject]);
  useEffect(() => { setConfirmedContinuation(null); }, [continuationSubject]);
  async function checkConfiguration() {
    setCheckingConfiguration(true); setConfigurationError(null);
    try {
      const response = await authFetch("/api/admin/company-report-packages/preflight");
      if (!response.ok) throw new Error(await responseError(response));
      setConfiguration(await response.json());
    } catch (error) {
      setConfiguration(null);
      setConfigurationError(error instanceof Error ? error.message : "Configuration checks are unavailable.");
    } finally { setCheckingConfiguration(false); }
  }
  useEffect(() => { if (enabled) void checkConfiguration(); }, [enabled]);
  async function recoverPackage(researchOnly: boolean, replaceTruncated = false) {
    if (!activeItem) return;
    const manualReplacement = replaceTruncated && !!activeItem.compilationRecovery?.available &&
      !!replacementSubject && confirmedReplacement === replacementSubject;
    if (replaceTruncated && !manualReplacement) return;
    const automaticCorrection = !manualReplacement && activeItem.canResumeWithAutomaticCorrections &&
      (allowAutomaticCorrections || activeItem.automaticCorrectionsApproved);
    if (activeItem.compilationRecovery?.available &&
        (!manualReplacement && !automaticCorrection || researchOnly || !acceptResearchCost)) return;
    setSubmitting(true); setPackageError(null);
    try {
      const response = await authFetch(`/api/admin/company-report-packages/${activeItem.id}/resume`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: activeItem.compilationRecovery?.available
          ? activeItem.compilationRecovery.snapshot : activeItem.recovery?.snapshot, researchOnly,
          acceptResearchCost, confirmUncertainPaidRetry: confirmPaidRetry,
          ...(allowAutomaticCorrections && !manualReplacement ? { allowAutomaticCorrections: true } : {}),
          ...(manualReplacement
            ? { replaceTruncatedCompilation: true } : {}) }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const status = await authFetch(`/api/admin/company-report-packages/${activeItem.id}`);
      if (!status.ok) throw new Error("Recovery was accepted, but status is unavailable. Refresh; do not submit a new package.");
      setActiveItem(await status.json());
      setConfirmPaidRetry(false);
      setConfirmedReplacement(null);
    } catch (error) { setPackageError(error instanceof Error ? error.message : "Recovery could not be confirmed."); }
    finally { setSubmitting(false); }
  }

  async function continueReviewedReports() {
    if (!activeItem?.reviewContinuation?.available || !continuationSubject ||
        confirmedContinuation !== continuationSubject) return;
    const target = { id: activeItem.id, snapshot: activeItem.reviewContinuation.snapshot };
    setSubmitting(true); setPackageError(null);
    try {
      const response = await authFetch(`/api/admin/company-report-packages/${target.id}/continue-reviewed`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: target.snapshot, acceptResearchCost: true }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setConfirmedContinuation(null);
      const status = await authFetch(`/api/admin/company-report-packages/${target.id}`);
      if (!status.ok) throw new Error("Continuation was accepted, but status is unavailable. Refresh; do not start another package.");
      setActiveItem(await status.json());
    } catch (error) { setPackageError(error instanceof Error ? error.message : "Continuation could not be confirmed."); }
    finally { setSubmitting(false); }
  }

  async function repairPackage() {
    if (!activeItem?.repairPlan?.available || confirmedRepair !== activeItem.repairPlan.snapshot) return;
    const target = { id: activeItem.id, ...activeItem.repairPlan };
    setSubmitting(true); setPackageError(null);
    try {
      const response = await authFetch(`/api/admin/company-report-packages/${target.id}/repair`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: target.snapshot, modelBudgetUsd: target.budgetUsd, confirmAdditionalPaidWork: true }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setConfirmedRepair(null);
      const status = await authFetch(`/api/admin/company-report-packages/${target.id}`);
      if (!status.ok) throw new Error("Repair accepted; refresh its status rather than starting another package.");
      setActiveItem(await status.json());
    } catch (error) { setPackageError(error instanceof Error ? error.message : "Repair could not be confirmed."); }
    finally { setSubmitting(false); }
  }

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
    setPollingPaused(false);
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
      if (response.status === 401 || response.status === 403) {
        setPollingPaused(true);
        setPollError("Sign-in required. Status checks are paused; the status below is last known, not live. Sign in again, then reopen this saved package. Do not create another package.");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response));
      const item = (await response.json()) as ReportPackage;
      setActiveItem(item);
      setPollingPaused(false);
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
    if (!activeItem?.id || !isInProgress(activeItem.status) || pollingPaused) return;
    let attempts = 0;
    let failures = 0;
    let stopped = false;
    const timer = window.setInterval(async () => {
      if (stopped) return;
      attempts += 1;
      if (attempts > 17_280) {
        stopped = true;
        window.clearInterval(timer);
        setPollError("Automatic status checks reached the 24-hour limit. Refresh to view saved progress.");
        setPollingPaused(true);
        return;
      }
      try {
        const response = await authFetch(`/api/admin/company-report-packages/${encodeURIComponent(activeItem.id)}`);
        if (stopped) return;
        if (response.status === 401 || response.status === 403) {
          stopped = true;
          window.clearInterval(timer);
          setPollingPaused(true);
          setPollError("Sign-in required. Status checks are paused; the status below is last known, not live. Sign in again, then reopen this saved package. Do not create another package.");
          return;
        }
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
          setPollingPaused(true);
        }
      }
    }, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // refreshItems is intentionally not a dependency; polling follows the active id/status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem?.id, activeItem?.status, pollingPaused]);

  async function submitPackage() {
    if (submitLock.current) return;
    setPackageError(null);
    setPollError(null);
    const company = fields.company.trim();
    const enteredWebsite = fields.website.trim() || websiteFromBusinessEmail(fields.contactEmail) || "";
    const website = enteredWebsite && !/^https?:\/\//i.test(enteredWebsite) ? `https://${enteredWebsite}` : enteredWebsite;
    if (!company) { setPackageError("Company name is required."); return; }
    if (company.length > 200) { setPackageError("Company name must be 200 characters or fewer."); return; }
    let parsedUrl: URL | undefined;
    try {
      if (website) {
        parsedUrl = new URL(website);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new Error();
      } else {
        setPackageError("Enter a company website (example.com) or business email (name@example.com). Personal email needs a website."); return;
      }
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
    submitLock.current = true;
    setSubmitting(true);
    try {
      const identityVersion = getAuthIdentityVersion();
      const response = await submitCompanyPackage(JSON.stringify({
          requestId: idempotencyKey,
          company,
          contactEmail: fields.contactEmail.trim() || undefined,
          website: parsedUrl?.toString() || "",
          principalName: fields.principalName.trim() || undefined,
          industry: fields.industry.trim() || undefined,
          crm: fields.crm.trim() || undefined,
          notes: fields.notes.trim() || undefined,
          intakeText: fields.intakeText || undefined,
          acceptResearchCost: true,
          allowAutomaticCorrections: true,
          modelBudgetUsd: 150,
        }), (url, init) => {
          if (getAuthIdentityVersion() !== identityVersion)
            throw new Error("Your sign-in changed. Review the company and approval before submitting again.");
          return authFetch(url, init);
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || payload?.message ||
        ([502, 503, 504].includes(response.status)
          ? PACKAGE_CONFIRMATION_ERROR
          : `${response.status} ${response.statusText}`));
      if (!payload?.id) throw new Error("The server accepted the request but returned no package ID. Keep this request ID and check recent packages before trying again.");
      const accepted: ReportPackage = {
        id: payload.id,
        status: payload.status || "accepted",
        company,
        website: parsedUrl?.toString() || "",
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
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  function prepareAnotherPackage() {
    const nextId = makeUuid();
    const emptyFields = { ...EMPTY_FIELDS };
    setFields(emptyFields);
    setRequestId(nextId);
    setActiveItem(null);
    setOpenedId(null);
    setPackageError(null);
    setPollError(null);
    setCopyNotice(null);
    setAcceptResearchCost(false);
    setPollingPaused(false);
    persistDraft(emptyFields, nextId);
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

  const busy = submitting || !pollingPaused && isInProgress(activeItem?.status);
  const fullFiles = activeItem?.files.filter((file) => file.category === "full") || [];
  const teaserFiles = activeItem?.files.filter((file) => file.category === "teaser") || [];
  const canStart = configuration?.ready === true && !busy && !submitting && !activeItem && !!fields.company.trim() &&
    (!!fields.website.trim() || !!websiteFromBusinessEmail(fields.contactEmail));

  return (
    <Card className="border-primary/25" data-testid="card-company-report-package">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Three-report package</CardTitle>
        <CardDescription>
          Enter the company name, website and any additional information, then submit once. Three independent AI authors each prepare all three categories; a fourth model synthesizes each category into its final report. You receive AI Readiness, Business Review and Revenue Opportunities PDFs, each with its own Fish Audio listening link, plus a three-page customer teaser offering the complete package for $497. Research and completed work are saved if you leave this page. Nothing is emailed automatically.
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
          <span>Generate all three reports together, with integrated audio</span>
        </label>

        {enabled && (
          <div id="company-report-package-fields" className="space-y-4">
            <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="package-preflight">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{checkingConfiguration ? "Checking report setup…" : configuration?.ready ? "Report configuration is ready" : "Report setup needs attention"}</strong>
                <Button size="sm" variant="outline" disabled={checkingConfiguration} onClick={() => void checkConfiguration()}>Check setup</Button>
              </div>
              {configurationError && <p role="alert" className="text-destructive">{configurationError}</p>}
              {configuration?.issues.map(issue => <p key={issue} role="alert" className="text-destructive">{issue}</p>)}
              {configuration?.models.map(model => <p key={model.model} className="break-words text-muted-foreground">{model.report}: {model.model}</p>)}
              <p className="text-xs text-muted-foreground">{configuration?.notice || "Setup checks do not call models or spend your report budget."}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Company name — example: Example Home Services"
                value={fields.company}
                maxLength={200}
                disabled={busy}
                onChange={(event) => updateField("company", event.target.value)}
                aria-label="Package company name"
              />
              <Input
                placeholder="Website, or use business email — example: example.com"
                value={fields.website}
                maxLength={300}
                disabled={busy}
                onChange={(event) => updateField("website", event.target.value)}
                aria-label="Package website URL"
              />
              <Input
                type="email"
                placeholder="Business email — example: owner@example.com"
                value={fields.contactEmail}
                maxLength={254}
                disabled={busy}
                onChange={(event) => updateField("contactEmail", event.target.value)}
                aria-label="Contact email (saved only; no automatic email)"
              />
            </div>
            <p className="text-xs text-muted-foreground">Enter a website or business email. A business email domain supplies the starting website; personal email such as Gmail needs a website too. Nothing is emailed automatically.</p>
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Additional information (optional)</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Principal name — example: Jane Smith"
                value={fields.principalName}
                maxLength={120}
                disabled={busy}
                onChange={(event) => updateField("principalName", event.target.value)}
                aria-label="Package principal name"
              />
              <Input
                placeholder="Industry — example: residential HVAC"
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

            </details>
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
                  I approve up to $150 in report-model reservations plus a separate $5 maximum narration allowance for this company. These are limits, not predicted charges. The workflow uses nine author compilations and three syntheses, with at most one corrective model call per original step for a confirmed invalid response, inside the same $150 cap. There are no extra juries, and uncertain calls are never repeated. No customer is charged or emailed automatically.
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={submitPackage} disabled={!canStart || !acceptResearchCost} data-testid="button-start-report-package">
                {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…</> : activeItem && isInProgress(activeItem.status) ? pollingPaused ? "Status checks paused" : "Package running" : "Create three reports + audio"}
              </Button>
              {activeItem && !isInProgress(activeItem.status) && (
                <Button variant="outline" onClick={prepareAnotherPackage} data-testid="button-new-report-package">
                  <RefreshCw className="mr-2 h-4 w-4" /> Prepare another package
                </Button>
              )}
              {activeItem && (
                <Button variant="ghost" onClick={() => void openPackage(activeItem.id)} disabled={submitting} data-testid="button-refresh-report-package">
                  <RefreshCw className="mr-2 h-4 w-4" /> Check status
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Website research uses up to three isolated browser workers at once and saves progress in batches of 10 page attempts, with up to two attempts per page. Available browser services share one page queue. Safety limits are 5,000 pages, 500 sitemap files and 24 hours; reaching a limit is incomplete research, never a claim of full coverage. No forms, purchases or automatic emails.
            </p>

            {packageError && <p role="alert" className="text-sm text-destructive" data-testid="text-package-error"><AlertCircle className="mr-1 inline h-4 w-4" />{packageError}</p>}
            {listError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>Recent package list: {listError}</span><Button size="sm" variant="outline" onClick={() => void refreshItems()} disabled={loadingList}>Retry list</Button></div>}
            {pollError && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{pollError}</p>}
            {pollingPaused && <a className="text-sm underline" href="/login">Sign in to restore status access</a>}

            {activeItem && (
              <section className="space-y-3 rounded-md border p-3" aria-label={`Package status for ${activeItem.company}`} data-testid="section-company-report-package-result">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{activeItem.company}</h3>
                    <p className="break-all text-xs text-muted-foreground">{activeItem.website}</p>
                    <p className="text-xs text-muted-foreground">Started {formatDate(activeItem.createdAt)}</p>
                  </div>
                  <Badge variant="outline" className="capitalize">{pollingPaused ? `Last known: ${activeItem.status.replaceAll("_", " ")}` : activeItem.status.replaceAll("_", " ")}</Badge>
                </div>
                {pollingPaused ? <p role="status" className="text-sm text-muted-foreground">Live status is unavailable. The saved package may continue on the server; refresh after restoring access.</p> : isInProgress(activeItem.status) ? (
                  <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    {activeItem.phase ? `Current phase: ${activeItem.phase.replaceAll("_", " ")}.` : "Researching and assembling the three reports and their audio."} Status checks run every five seconds; this page never starts a run on its own.
                  </p>
                ) : /^(done|complete|completed|succeeded|success)$/i.test(activeItem.status) ? (
                  <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Package processing finished. Download only the files listed below.</p>
                ) : (
                  <p role="alert" className="flex items-start gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{activeItem.error || "The package did not finish successfully. Server status is shown above."}</p>
                )}
                {activeItem.error && !isInProgress(activeItem.status) && !/^(failed|error)$/i.test(activeItem.status) && (
                  <p className="text-sm text-amber-700 dark:text-amber-300">Server note: {activeItem.error}</p>
                )}
                {activeItem.reports && Object.entries(activeItem.reports).filter(([, report]) => report.error).map(([kind, report]) => (
                  <p key={kind} className="text-sm text-destructive">{kind}: {report.error}</p>
                ))}
                {activeItem.compilationProgress && <div className="rounded-md border p-3 text-sm" data-testid="package-compilation-progress" role="status">
                  Independent compilations: {activeItem.compilationProgress.authors}/9 · Final syntheses: {activeItem.compilationProgress.syntheses}/3 · Verified report/audio pairs: {activeItem.compilationProgress.delivered}/3.
                  {activeItem.compilationProgress.execution && <p className="mt-1 text-xs text-muted-foreground">Unfinished authors run concurrently. Each final synthesis starts when its three matching author drafts are accepted.</p>}
                  <p className="mt-1 text-xs text-muted-foreground">Each PDF becomes available only after its complete MP3 decodes, its listening link is embedded, and delivery is verified.</p>
                </div>}
                {!!activeItem.audioProgress?.length && <div className="space-y-1 rounded-md border p-3 text-sm" data-testid="package-fish-progress">
                  <p className="font-medium">Fish Audio · s2-pro · Onyx</p>
                  {activeItem.audioProgress.map(progress => <p key={progress.kind}>
                    {progress.kind}: {progress.savedChunks}{progress.totalChunks ? `/${progress.totalChunks}` : ""} audio segments saved
                    {progress.stage ? ` · ${progress.stage.replaceAll("_", " ")}` : ""}.
                  </p>)}
                </div>}
                {activeItem.productionVersion === 3 && (activeItem.canResume || activeItem.canResumeWithAutomaticCorrections) && <div className="rounded-md border p-3 text-sm">
                  <p>Saved work is preserved. Continue only the unfinished steps within the original allowances. Uncertain paid calls are never automatically repeated.</p>
                  {!activeItem.automaticCorrectionsApproved && <label className="my-2 flex gap-2"><input type="checkbox"
                    checked={allowAutomaticCorrections} onChange={event => setAllowAutomaticCorrections(event.target.checked)} />
                    Allow one corrective model call per original report step for a confirmed invalid response, within the existing model allowance (no higher than $150). A failed correction stops; uncertain calls are never repeated.</label>}
                  {activeItem.automaticCorrectionsApproved && !activeItem.targetedRepair?.available && <p>One corrective call per original report step is approved within the existing cap. Failed corrections stop.</p>}
                  {activeItem.targetedRepair?.available && <p>One additional correction is separately approved for this exact saved dental draft. Continue reuses the saved research within the original $150 cap. This does not authorize further retries.</p>}
                  <label className="my-2 flex gap-2"><input type="checkbox" checked={acceptResearchCost} onChange={event => setAcceptResearchCost(event.target.checked)} />Continue within the original $150 model and $5 narration allowances.</label>
                  <Button variant="outline" disabled={submitting || !acceptResearchCost ||
                    !activeItem.canResume && !allowAutomaticCorrections} onClick={() => void recoverPackage(false)}>Continue saved package</Button>
                </div>}
                {activeItem.targetedRepair?.phase && <div className="rounded-md border p-3 text-sm" role="status">
                  Owner-approved additional correction: {activeItem.targetedRepair.phase === "claimed"
                    ? "Claim saved; outcome not yet confirmed."
                    : activeItem.targetedRepair.phase === "complete" ? activeItem.status === "done"
                      ? "Accepted. Package processing and verified file delivery are complete."
                      : "Accepted for this draft. See the current package status for remaining steps."
                    : activeItem.status === "error" ? "Response saved but not accepted. No further automatic retry."
                    : "Response saved; acceptance pending."}
                </div>}
                {!!activeItem.compilationProgress?.corrections?.length && <div className="rounded-md border p-3 text-sm">
                  <p>Saved corrective attempts</p>
                  {activeItem.compilationProgress.corrections.map(correction => <p key={correction.operation}>
                    {correction.operation} — {correction.resolved ? "Resolved; this draft is accepted" :
                      correction.notDispatched ? "Not sent; stopped before spending. Continue can reconcile this claim" :
                      correction.phase === "claimed" ? "Claim recorded; outcome not yet confirmed" :
                      correction.phase === "received" ? "Response saved; acceptance pending or blocked" : "Accepted"} ({correction.check})
                  </p>)}
                </div>}
                {!!activeItem.compilationProgress?.evidenceReferenceRecovery?.length && <div className="rounded-md border p-3 text-sm" role="status">
                  <p className="font-medium">Saved evidence recovery · no replacement model call</p>
                  {activeItem.compilationProgress.evidenceReferenceRecovery.map(recovery => <p key={recovery.operation}>
                    {recovery.operation}: {recovery.status === "applied" ? "Applied. " : "Available through Continue. "}{recovery.note}
                  </p>)}
                </div>}
                {activeItem.productionVersion === 3 && activeItem.compilationRecovery?.available && <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="package-truncated-replacement">
                  <p>A model returned an incomplete report at its output limit. Research and completed compilations will be reused. Replace only this truncated response once, then continue the remaining steps. The original reservation and receipt stay recorded.</p>
                  <p className="break-words">Stopped operation: {activeItem.compilationRecovery.operation}</p>
                  <label className="flex gap-2"><input type="checkbox" checked={acceptResearchCost} onChange={event => setAcceptResearchCost(event.target.checked)} />Stay within the original $150 model and $5 narration allowances.</label>
                  <label className="flex gap-2"><input type="checkbox" checked={confirmedReplacement === replacementSubject}
                    onChange={event => setConfirmedReplacement(event.target.checked ? replacementSubject : null)} />I approve one additional paid request to replace this incomplete response. No uncertain call or completed report will be repeated.</label>
                  <Button variant="outline" className="h-auto min-h-10 w-full whitespace-normal break-words px-3 py-2 text-left"
                    disabled={submitting || !acceptResearchCost || confirmedReplacement !== replacementSubject}
                    onClick={() => void recoverPackage(false, true)}>Replace incomplete response and continue</Button>
                </div>}
                {activeItem.recovery && <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="package-recovery">
                  <p>Model budget: ${activeItem.recovery.reservedUsd.toFixed(2)} reserved · ${activeItem.recovery.remainingUsd.toFixed(2)} remaining of ${(activeItem.recovery.reservedUsd + activeItem.recovery.remainingUsd).toFixed(2)}.</p>
                  <p className="text-xs text-muted-foreground">Reservations are conservative limits, not verified provider charges. Earlier reservations are never erased by recovery.</p>
                  {!isInProgress(activeItem.status) && activeItem.recovery.reasons.map(reason => <p key={reason}>{reason}</p>)}
                  {activeItem.recovery.canRepairResearch && <>
                    <p>Refresh factual excerpts from saved page captures. No model calls, new browser crawl, email or charge.</p>
                    <Button variant="outline" disabled={submitting} onClick={() => void recoverPackage(true)}>Refresh saved research — no model calls</Button>
                  </>}
                  {activeItem.recovery.available && <>
                    {activeItem.recovery.requiresPaidRetryApproval && <label className="flex items-start gap-2">
                      <input type="checkbox" checked={confirmPaidRetry} onChange={event => setConfirmPaidRetry(event.target.checked)} className="mt-1" />
                      <span>I approve another attempt for unconfirmed drafts. Earlier attempts may already have incurred charges; all reservations stay within this package's existing model ceiling.</span>
                    </label>}
                    <Button variant="outline" disabled={submitting || !acceptResearchCost || configuration?.ready !== true ||
                      activeItem.recovery.requiresPaidRetryApproval && !confirmPaidRetry}
                      onClick={() => void recoverPackage(false)}>Continue saved reports</Button>
                    {!acceptResearchCost && <p className="text-muted-foreground">Select the report-cost approval above before continuing.</p>}
                  </>}
                </div>}
                {activeItem.phase === "blocked" && activeItem.repairPlan?.available && <div className="space-y-2 rounded-md border p-3 text-sm">
                  <p className="font-medium">Resume the complete package with retained paid work</p>
                  <p>Preserves existing drafts and valid reviews, replaces only the confirmed truncated reviewer answer, and approves all content before PDF/audio production.</p>
                  <p>Conservative completion envelope: ${activeItem.repairPlan.maximumCompletionUsd?.toFixed(2)} including historical reservations. Maximum model allowance: ${activeItem.repairPlan.budgetUsd}. This is not an actual-charge total.</p>
                  <label className="flex items-start gap-2"><input type="checkbox" disabled={submitting}
                    checked={confirmedRepair === activeItem.repairPlan.snapshot}
                    onChange={e => setConfirmedRepair(e.target.checked ? activeItem.repairPlan!.snapshot : null)} />
                    I approve this saved package's bounded additional paid work.</label>
                  <Button onClick={repairPackage} disabled={submitting || confirmedRepair !== activeItem.repairPlan.snapshot}
                    data-testid="button-repair-complete-package">Resume complete package</Button>
                </div>}
                {activeItem.phase === "blocked" && activeItem.reviewContinuation && !activeItem.repairPlan?.available && <div
                  className="space-y-2 rounded-md border p-3 text-sm" data-testid="saved-review-continuation">
                  <p className="font-medium">Saved paid reviews</p>
                  {activeItem.reviewContinuation.reports.map(report => <p key={report.childId}>
                    {report.kind}: {report.eligible ? "All three reviews verified; ready to compile without repeating them." : report.reason}
                  </p>)}
                  {activeItem.reviewContinuation.available && <>
                    <p>Continue only the verified reports listed above. Other reports stay blocked. Compilation and later review may use the remaining model allowance; this package's existing ceiling and all earlier reservations stay unchanged. This does not guarantee the remaining allowance will finish the package.</p>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" checked={confirmedContinuation === continuationSubject}
                        onChange={event => setConfirmedContinuation(event.target.checked ? continuationSubject : null)} />
                      <span>I approve continuing these verified reports within the remaining allowance, without repeating their saved initial reviews.</span>
                    </label>
                    <Button type="button" variant="outline" disabled={submitting || configuration?.ready !== true ||
                      confirmedContinuation !== continuationSubject} onClick={() => void continueReviewedReports()}>
                      Continue {activeItem.reviewContinuation.childIds.length} verified reports
                    </Button>
                  </>}
                </div>}
                {activeItem.coverage && (
                  <div className="rounded bg-muted/50 p-3 text-sm">
                    <h4 className="font-medium">Website review coverage</h4>
                    <p className="mt-1 text-muted-foreground">
                      {activeItem.coverage.reviewed} of {activeItem.coverage.discovered} discovered URLs reviewed
                      {activeItem.coverage.failed > 0 ? ` · ${activeItem.coverage.failed} failed` : ""}
                      {` · ${activeItem.coverage.pending ?? Math.max(0, activeItem.coverage.discovered - activeItem.coverage.reviewed - activeItem.coverage.failed)} pending`}
                      {activeItem.coverage.capped ? " · Coverage incomplete: pending pages, failures or discovery limits" : ""}.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">Every discovered eligible URL is processed before drafting. Unreachable, excluded or undiscoverable pages are not claimed as reviewed.</p>
                    {activeItem.coverage.evidencePages !== undefined && <p className="mt-1 text-xs text-muted-foreground">
                      {activeItem.coverage.evidencePages} pages contributed usable factual excerpts
                      {activeItem.coverage.factsPending ? ` · ${activeItem.coverage.factsPending} fact projections pending` : ""}.
                      Navigation, footer and review text are kept out of company facts.
                    </p>}
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Private full reports</h4>
                    {fullFiles.length ? fullFiles.map((file) => (
                      <div key={file.key} className="min-w-0 space-y-3 rounded border p-3">
                        <span className="block break-words text-sm font-medium">{file.label}</span>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                          {file.pdfUrl && /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,200}\/view(?:\?usp=(?:sharing|drive_link))?$/.test(file.pdfUrl) && (
                            <a className="text-sm font-medium underline" href={file.pdfUrl} target="_blank" rel="noopener noreferrer">Open PDF on Drive</a>
                          )}
                          {file.audioUrl && /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,200}\/view(?:\?usp=(?:sharing|drive_link))?$/.test(file.audioUrl) && (
                            <a className="text-sm font-medium underline" href={file.audioUrl} target="_blank" rel="noopener noreferrer">American-English MP3</a>
                          )}
                          <Button className="shrink-0" size="sm" variant="outline" onClick={() => void downloadFile(file)} disabled={downloadingKey !== null}>
                            {downloadingKey === file.key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            Download
                          </Button>
                        </div>
                      </div>
                    )) : <p className="text-sm text-muted-foreground">No full-report downloads are available yet.</p>}
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Customer outreach teasers</h4>
                    <p className="text-xs text-muted-foreground">Includes a three-page preview with one page per report and the $497 full-package offer. Full reports stay separate.</p>
                    {teaserFiles.length ? teaserFiles.map((file) => (
                      <div key={file.key} className="min-w-0 space-y-3 rounded border p-3">
                        <span className="block break-words text-sm font-medium">{file.label}</span>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                          {file.pdfUrl && /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,200}\/view(?:\?usp=(?:sharing|drive_link))?$/.test(file.pdfUrl) && (
                            <a className="text-sm font-medium underline" href={file.pdfUrl} target="_blank" rel="noopener noreferrer">Open teaser on Drive</a>
                          )}
                          <Button className="shrink-0" size="sm" variant="outline" onClick={() => void downloadFile(file)} disabled={downloadingKey !== null}>
                            {downloadingKey === file.key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            Download
                          </Button>
                        </div>
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
                        <p className="text-xs text-muted-foreground">{formatDate(item.createdAt)} · {pollingPaused ? "Last known: " : ""}{(activeItem && String(activeItem.id) === String(item.id) ? activeItem.status : item.status).replaceAll("_", " ")}</p>
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
