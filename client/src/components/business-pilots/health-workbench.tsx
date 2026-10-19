import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowDownRight, ArrowRight, ArrowUpRight, Check, Clipboard, Clock3, FileText, Gauge, LoaderCircle, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authFetch } from "@/lib/queryClient";
import { healthSchema, type HealthInput } from "../../../../shared/business-pilots/health";
import type { PilotResult } from "../../../../shared/business-pilots/common";
import ReleaseWorkbench from "@/components/business-pilots/release-workbench";
import GovernanceWorkbench from "@/components/business-pilots/governance-workbench";
import CostWorkbench from "@/components/business-pilots/cost-workbench";

type PilotKind = "health" | "release" | "governance" | "cost";
interface SavedRun {
  id: string;
  kind: PilotKind;
  input: HealthInput;
  result: PilotResult;
  report: string;
  createdAt: string;
  baselineId?: string;
}
type HealthDraft = {
  business: string;
  reference: string;
  currency: "USD" | "CAD" | "GBP" | "EUR";
  start: string;
  end: string;
  calls: string;
  missedCalls: string;
  quotes: string;
  wonQuotes: string;
  timelyFollowups: string;
  customers: string;
  repeatCustomers: string;
  receivables: string;
  overdueReceivables: string;
};
interface PendingOperation {
  signature: string;
  requestId: string;
  input: HealthInput;
  baselineId?: string;
}

const initialDraft: HealthDraft = {
  business: "", reference: "", currency: "USD", start: "", end: "",
  calls: "", missedCalls: "", quotes: "", wonQuotes: "", timelyFollowups: "",
  customers: "", repeatCustomers: "", receivables: "", overdueReceivables: "",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const metricNotes: Record<string, string> = {
  "Missed-call rate": "Lower is better; calls missed divided by calls received.",
  "Quote win rate": "Higher is better; won quotes divided by quotes issued.",
  "Follow-ups within one day": "Higher is better; timely follow-ups divided by quotes issued.",
  "Repeat-customer rate": "Higher is better; repeat customers divided by customers.",
  "Receivables over 30 days": "Lower is better; overdue balance divided by total receivables.",
};

function inputFromDraft(draft: HealthDraft): unknown {
  const count = (value: string) => value.trim() === "" ? null : Number(value);
  const amount = (value: string) => value.trim() === "" ? null : Number(value);
  return {
    business: draft.business,
    reference: draft.reference,
    currency: draft.currency,
    start: draft.start,
    end: draft.end,
    calls: count(draft.calls),
    missedCalls: count(draft.missedCalls),
    quotes: count(draft.quotes),
    wonQuotes: count(draft.wonQuotes),
    timelyFollowups: count(draft.timelyFollowups),
    customers: count(draft.customers),
    repeatCustomers: count(draft.repeatCustomers),
    receivables: amount(draft.receivables),
    overdueReceivables: amount(draft.overdueReceivables),
  };
}

function errorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  return fallback;
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function MetricDirection({ direction }: { direction?: string }) {
  if (direction === "improved") return <ArrowUpRight className="size-4 text-teal-700" aria-label="Improved" />;
  if (direction === "worsened") return <ArrowDownRight className="size-4 text-rose-700" aria-label="Worsened" />;
  if (direction === "unchanged") return <ArrowRight className="size-4 text-amber-700" aria-label="Unchanged" />;
  return <span className="inline-block size-4 rounded-full border border-current opacity-40" aria-label="Unknown change" />;
}

function HealthResult({ result }: { result: PilotResult }) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-teal-900/10 bg-[#edf5f0] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-0 bg-[#245e57] text-white hover:bg-[#245e57]">{result.verdict}</Badge>
          <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#52716a]">Operator-supplied snapshot</span>
        </div>
        <h2 className="mt-3 font-display text-xl font-semibold tracking-tight text-[#173c38]">{result.title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#4d6761]">{result.summary}</p>
      </div>

      <section aria-labelledby="metrics-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.17em] text-[#8b6b4e]">Reading the period</p>
            <h3 id="metrics-title" className="mt-1 font-display text-lg font-semibold text-[#243b38]">Measured indicators</h3>
          </div>
          <p className="text-right text-xs text-muted-foreground">No combined score or benchmark</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {result.metrics.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-[#dbe3dc] bg-[#fbfaf6] p-4">
              <div className="flex min-h-10 items-start justify-between gap-2">
                <p className="text-sm font-medium text-[#38514c]">{metric.label}</p>
                <MetricDirection direction={metric.direction} />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-display text-3xl font-semibold tabular-nums text-[#173c38]">
                  {metric.value === null ? "Unknown" : `${metric.value}%`}
                </span>
                {metric.delta !== null && metric.delta !== undefined && (
                  <span className={`text-xs font-semibold tabular-nums ${metric.direction === "worsened" ? "text-rose-700" : metric.direction === "improved" ? "text-teal-800" : "text-[#806d4a]"}`}>
                    {metric.delta > 0 ? "+" : ""}{metric.delta} pp
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{metricNotes[metric.label] ?? metric.unit}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="findings-title">
        <h3 id="findings-title" className="mb-3 font-display text-lg font-semibold text-[#243b38]">Evidence & next steps</h3>
        <div className="divide-y divide-[#dfe5df] rounded-xl border border-[#dbe3dc] bg-[#fbfaf6]">
          {result.findings.map((finding) => (
            <article key={finding.label} className="grid gap-3 p-4 md:grid-cols-[minmax(150px,0.7fr)_2fr]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="capitalize text-[10px]">{finding.status}</Badge>
                <h4 className="text-sm font-semibold text-[#344d48]">{finding.label}</h4>
              </div>
              <div className="space-y-2 text-sm leading-6">
                <p className="text-[#4e625d]">{finding.detail}</p>
                {finding.evidence && <p className="text-xs text-muted-foreground">Evidence reference: {finding.evidence}</p>}
                <p><span className="font-semibold text-[#8b6b4e]">Next:</span> <span className="text-[#4e625d]">{finding.nextStep}</span></p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="rounded-xl border border-[#e5d8c4] bg-[#f7f0e5] p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[#65513a]"><ShieldCheck className="size-4" /> Scope & limitations</h3>
        <ul className="mt-2 space-y-1.5 pl-4 text-xs leading-5 text-[#6a5e4d]">
          {result.limitations.map((limitation) => <li key={limitation} className="list-disc">{limitation}</li>)}
        </ul>
      </aside>
    </div>
  );
}

export default function BusinessHealthWorkbench() {
  const [activeKind, setActiveKind] = useState<PilotKind>("health");
  const [draft, setDraft] = useState<HealthDraft>(initialDraft);
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baselineId, setBaselineId] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | "copy" | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const pendingRef = useRef<PendingOperation | null>(null);

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedId) ?? null, [runs, selectedId]);
  const parsed = useMemo(() => healthSchema.safeParse(inputFromDraft(draft)), [draft]);
  const baselineOptions = useMemo(() => {
    if (!parsed.success) return [];
    const current = parsed.data;
    return runs.filter((run) => {
      const baseline = healthSchema.safeParse(run.input);
      return baseline.success && baseline.data.reference === current.reference &&
        baseline.data.business.trim().toLowerCase() === current.business.trim().toLowerCase() &&
        baseline.data.currency === current.currency && baseline.data.end < current.start;
    });
  }, [parsed, runs]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await authFetch("/api/admin/business-pilots/health");
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(data, `Could not load saved health runs (${response.status}).`));
      if (!data || typeof data !== "object" || !Array.isArray((data as { runs?: unknown }).runs)) {
        throw new Error("The saved health history response was not in the expected format.");
      }
      const validRuns = (data as { runs: unknown[] }).runs.filter((run): run is SavedRun => {
        if (!run || typeof run !== "object") return false;
        const item = run as Partial<SavedRun>;
        return typeof item.id === "string" && UUID.test(item.id) && item.kind === "health" && typeof item.createdAt === "string" &&
          typeof item.report === "string" && !!item.result && healthSchema.safeParse(item.input).success;
      });
      setRuns(validRuns);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Could not load saved health runs.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  function updateDraft<K extends keyof HealthDraft>(key: K, value: HealthDraft[K]) {
    const hadPendingOperation = pendingRef.current !== null;
    pendingRef.current = null;
    if (hadPendingOperation) setRequestError((previous) => previous ? `${previous} Inputs changed; the earlier retry identity was discarded. Submit again to start a new save.` : previous);
    setDraft((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function submitHealth() {
    setValidationErrors([]);
    setRequestError(null);
    setNotice(null);
    const validation = healthSchema.safeParse(inputFromDraft(draft));
    if (!validation.success) {
      setValidationErrors(validation.error.issues.map((issue) => `${issue.path.join(".") || "Input"}: ${issue.message}`));
      return;
    }
    const chosenBaseline = baselineId ? runs.find((run) => run.id === baselineId) : undefined;
    if (baselineId && !chosenBaseline) {
      setRequestError("That selected baseline is no longer in saved history. Refresh history and select it again.");
      return;
    }
    const baselineValidation = chosenBaseline ? healthSchema.safeParse(chosenBaseline.input) : undefined;
    if (baselineValidation && !baselineValidation.success) {
      setRequestError("The selected baseline could not be validated. Choose a different saved run.");
      return;
    }
    const input = validation.data;
    const baseline = baselineValidation?.success ? baselineValidation.data : undefined;
    if (baseline && (baseline.reference !== input.reference || baseline.currency !== input.currency || baseline.end >= input.start)) {
      setRequestError("Baseline must match the business reference and currency and end before this reporting period.");
      return;
    }
    const signature = JSON.stringify({ kind: "health", input, baselineId: baselineId || undefined });
    if (!pendingRef.current || pendingRef.current.signature !== signature) {
      pendingRef.current = { signature, requestId: crypto.randomUUID(), input, baselineId: baselineId || undefined };
    }
    void saveRun(pendingRef.current);
  }

  async function saveRun(operation: PendingOperation) {
    setBusy("save");
    setRequestError(null);
    setNotice(null);
    try {
      const response = await authFetch("/api/admin/business-pilots/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: operation.requestId,
          input: operation.input,
          ...(operation.baselineId ? { baselineId: operation.baselineId } : {}),
        }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = errorMessage(data, `Save was rejected (${response.status}).`);
        if (response.status >= 500) {
          setRequestError(`${message} The result may have committed; retrying this exact unchanged operation will reuse its request ID.`);
        } else {
          pendingRef.current = null;
          setRequestError(`${message}${response.status === 409 ? " Resolve the conflict before starting a new save." : response.status === 422 ? " Review the inputs and correct the reported validation issue." : ""}`);
        }
        return;
      }
      if (!data || typeof data !== "object" || typeof (data as SavedRun).id !== "string" ||
          (data as SavedRun).kind !== "health" || !healthSchema.safeParse((data as SavedRun).input).success ||
          typeof (data as SavedRun).createdAt !== "string" || typeof (data as SavedRun).report !== "string" ||
          !(data as SavedRun).result || !Array.isArray((data as SavedRun).result.findings)) {
        setRequestError("The server response could not confirm a valid saved run. Keep the form unchanged and retry to check the same operation.");
        return;
      }
      const saved = data as SavedRun;
      pendingRef.current = null;
      setRuns((current) => [saved, ...current.filter((run) => run.id !== saved.id)]);
      setSelectedId(saved.id);
      setConfirmDeleteId(null);
      setNotice("Saved and confirmed by the server. The result is now in private history.");
    } catch (error) {
      setRequestError(`${error instanceof Error ? error.message : "The save could not be confirmed."} Keep the form unchanged to retry the same operation safely.`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteRun(runId: string) {
    if (!UUID.test(runId)) {
      setRequestError("Delete was not sent: saved run ID is not a valid UUID.");
      return;
    }
    setBusy("delete");
    setRequestError(null);
    setNotice(null);
    try {
      const response = await authFetch(`/api/admin/business-pilots/health/${encodeURIComponent(runId)}`, { method: "DELETE" });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !data || typeof data !== "object" || (data as { ok?: unknown }).ok !== true) {
        throw new Error(errorMessage(data, `Delete was not confirmed (${response.status}).`));
      }
      setRuns((current) => current.filter((run) => run.id !== runId));
      if (selectedId === runId) setSelectedId(null);
      setConfirmDeleteId(null);
      setNotice("Saved run deleted.");
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Delete was not confirmed.");
    } finally {
      setBusy(null);
    }
  }

  async function copyReport(run: SavedRun) {
    setBusy("copy");
    setRequestError(null);
    try {
      await navigator.clipboard.writeText(run.report);
      setCopiedId(run.id);
      setNotice("Report text copied to the clipboard. No file or external delivery was created.");
      window.setTimeout(() => setCopiedId((current) => current === run.id ? null : current), 2200);
    } catch {
      setRequestError("Clipboard access was unavailable. Your saved report remains below and can be selected and copied manually.");
    } finally {
      setBusy(null);
    }
  }

  const hasUnknownMetrics = selectedRun?.result.metrics.some((metric) => metric.value === null) ?? false;
  const canRetrySame = !!pendingRef.current && parsed.success &&
    pendingRef.current.signature === JSON.stringify({ kind: "health", input: parsed.data, baselineId: baselineId || undefined });

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-[#f2f3ed] text-[#263c38]">
      <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-7 lg:px-10 lg:py-10">
        <header className="mb-7 flex flex-col gap-5 border-b border-[#d4ddd5] pb-7 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#c9d8ce] bg-[#e3ece4] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#35635a]">
              <Gauge className="size-3.5" /> Owner workbench
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-[-0.04em] text-[#193d39] sm:text-4xl">Pilot tools</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#61716b]">
              Manual, bounded reviews from your own aggregate inputs. Results are saved to private history only after the server confirms the write.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-xl border border-[#d7e0d8] bg-[#f8f8f3] px-3 py-2 text-xs text-[#5f7069] md:self-auto">
            <ShieldCheck className="size-4 text-[#497a6b]" />
            Owner access · no automated execution
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Pilot tools" className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            <div className="min-w-[200px] rounded-2xl border border-[#cbd9ce] bg-[#e6eee6] p-2 lg:min-w-0">
              <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#75867d]">Approved sequence</p>
              <div className="space-y-1">
                <button type="button" aria-current={activeKind === "health" ? "page" : undefined} onClick={() => setActiveKind("health")} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium ${activeKind === "health" ? "bg-[#245e57] text-white shadow-sm" : "text-[#65766d] hover:bg-[#dce7dd]"}`}>
                  <Gauge className="size-4" /><span>Business health</span>{activeKind === "health" && <span className="ml-auto size-1.5 rounded-full bg-[#d8e8b8]" />}
                </button>
                {([
                  ["release", "Release readiness"],
                  ["governance", "Governance evidence"],
                  ["cost", "AI cost & routing"],
                ] as const).map(([kind, label], index) => (
                  <button type="button" key={kind} aria-current={activeKind === kind ? "page" : undefined} onClick={() => setActiveKind(kind)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${activeKind === kind ? "bg-[#245e57] font-medium text-white shadow-sm" : "text-[#65766d] hover:bg-[#dce7dd]"}`}>
                    <span className={`grid size-5 place-items-center rounded-full border text-[10px] tabular-nums ${activeKind === kind ? "border-white/40" : "border-[#c8d3ca]"}`}>{index + 2}</span>
                    <span>{label}</span>{activeKind === kind && <span className="ml-auto size-1.5 rounded-full bg-[#d8e8b8]" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="hidden rounded-2xl border border-[#d9dfd7] bg-[#f9f8f2] p-4 lg:block">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8b6b4e]">Input boundary</p>
              <p className="mt-2 text-xs leading-5 text-[#68756d]">Enter aggregates only. Do not include credentials, customer names, or personal data.</p>
            </div>
          </nav>

          <div className="min-w-0 space-y-6">
            <div className={activeKind === "health" ? "space-y-6" : "hidden"}>
            {(requestError || notice) && (
              <div role={requestError ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${requestError ? "border-[#e6c1b6] bg-[#fbefea] text-[#813c31]" : "border-[#c5d8ca] bg-[#e8f1e8] text-[#315e50]"}`}>
                {requestError ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <Check className="mt-0.5 size-4 shrink-0" />}
                <p className="flex-1 leading-5">{requestError || notice}</p>
                <button type="button" onClick={() => { setRequestError(null); setNotice(null); }} className="rounded px-2 py-1 text-xs font-semibold underline underline-offset-2">Dismiss</button>
              </div>
            )}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
              <Card className="overflow-hidden border-[#d5dfd7] bg-[#fafaf5] shadow-[0_12px_40px_-32px_rgba(32,66,56,0.35)]">
                <CardHeader className="border-b border-[#e2e7df] bg-[#f5f6ef]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#987555]">01 / baseline & re-scan</p>
                      <CardTitle className="mt-1 font-display text-xl text-[#1d403b]">Business health</CardTitle>
                      <CardDescription className="mt-1 max-w-xl leading-5">Use one defined period of business-wide counts and balances. Blank values stay unknown.</CardDescription>
                    </div>
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e1ece3] text-[#386c5e]"><Gauge className="size-5" /></span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 p-4 sm:p-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Business name" hint="Example: Northline Heating" required>
                      <Input value={draft.business} onChange={(event) => updateDraft("business", event.target.value)} placeholder="Business name" autoComplete="organization" />
                    </Field>
                    <Field label="Stable reference slug" hint="Lowercase letters, numbers and hyphens; keep it consistent, e.g. northline-heating" required>
                      <Input value={draft.reference} onChange={(event) => updateDraft("reference", event.target.value)} placeholder="northline-heating" />
                    </Field>
                    <Field label="Reporting period starts" hint="Inclusive first day, YYYY-MM-DD" required>
                      <Input type="date" value={draft.start} onChange={(event) => updateDraft("start", event.target.value)} />
                    </Field>
                    <Field label="Reporting period ends" hint="Inclusive final day; no longer than 366 days" required>
                      <Input type="date" value={draft.end} onChange={(event) => updateDraft("end", event.target.value)} />
                    </Field>
                    <Field label="Currency" hint="Used for receivables; choose one consistent reporting currency." required>
                      <select value={draft.currency} onChange={(event) => updateDraft("currency", event.target.value as HealthDraft["currency"])} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[#397166]">
                        <option value="USD">USD — US dollar</option><option value="CAD">CAD — Canadian dollar</option>
                        <option value="GBP">GBP — pound sterling</option><option value="EUR">EUR — euro</option>
                      </select>
                    </Field>
                    <Field label="Compare with saved baseline" hint="Optional. Same reference and currency; its period must end before this one.">
                      <select value={baselineId} onChange={(event) => { const hadPendingOperation = pendingRef.current !== null; pendingRef.current = null; if (hadPendingOperation) setRequestError((previous) => previous ? `${previous} Baseline changed; the earlier retry identity was discarded. Submit again to start a new save.` : previous); setBaselineId(event.target.value); }} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[#397166]">
                        <option value="">No comparison — capture baseline</option>
                        {baselineOptions.map((run) => <option key={run.id} value={run.id}>{run.input.start} to {run.input.end} · {run.input.business}</option>)}
                      </select>
                      {parsed.success && baselineId && !baselineOptions.some((run) => run.id === baselineId) && (
                        <span className="mt-1 block text-xs text-amber-800">Selected period is not compatible with the current inputs.</span>
                      )}
                    </Field>
                  </div>
                  <div className="border-t border-[#e2e7df] pt-5">
                    <div className="mb-3">
                      <p className="text-sm font-semibold text-[#38524b]">Optional operating totals</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">Provide full-period totals, not estimates of missing records. A blank field is unknown, not zero.</p>
                    </div>
                    <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                      <NumericField label="Calls received" example="e.g. 184" value={draft.calls} onChange={(value) => updateDraft("calls", value)} integer />
                      <NumericField label="Calls missed" example="e.g. 17; requires calls received" value={draft.missedCalls} onChange={(value) => updateDraft("missedCalls", value)} integer />
                      <NumericField label="Quotes issued" example="e.g. 42" value={draft.quotes} onChange={(value) => updateDraft("quotes", value)} integer />
                      <NumericField label="Quotes won" example="e.g. 13; requires quotes issued" value={draft.wonQuotes} onChange={(value) => updateDraft("wonQuotes", value)} integer />
                      <NumericField label="Quotes followed up within one day" example="e.g. 29; requires quotes issued" value={draft.timelyFollowups} onChange={(value) => updateDraft("timelyFollowups", value)} integer />
                      <NumericField label="Customers served" example="e.g. 76" value={draft.customers} onChange={(value) => updateDraft("customers", value)} integer />
                      <NumericField label="Repeat customers" example="e.g. 21; requires customers served" value={draft.repeatCustomers} onChange={(value) => updateDraft("repeatCustomers", value)} integer />
                      <NumericField label={`Receivables outstanding (${draft.currency})`} example="e.g. 18450.75 at period end" value={draft.receivables} onChange={(value) => updateDraft("receivables", value)} />
                      <NumericField label={`Receivables over 30 days (${draft.currency})`} example="e.g. 2375.00; requires total receivables" value={draft.overdueReceivables} onChange={(value) => updateDraft("overdueReceivables", value)} />
                    </div>
                  </div>
                  {validationErrors.length > 0 && (
                    <div role="alert" className="rounded-lg border border-[#e6c1b6] bg-[#fbefea] px-4 py-3 text-sm text-[#813c31]">
                      <p className="font-semibold">Review these inputs before saving</p>
                      <ul className="mt-2 list-inside list-disc space-y-1 text-xs">{validationErrors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>
                    </div>
                  )}
                  <div className="flex flex-col gap-3 border-t border-[#e2e7df] pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="max-w-sm text-xs leading-5 text-muted-foreground">Calculated locally and saved as an owner-reviewed snapshot. No source systems are connected.</p>
                    <div className="flex flex-wrap gap-2">
                      {canRetrySame && requestError && <Button variant="outline" onClick={() => pendingRef.current && void saveRun(pendingRef.current)} disabled={busy !== null}><RefreshCw className="mr-2 size-4" />Retry same save</Button>}
                      <Button onClick={submitHealth} disabled={busy !== null} className="bg-[#245e57] text-white hover:bg-[#184b45]">
                        {busy === "save" ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
                        Save health run
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-[#d5dfd7] bg-[#fafaf5] shadow-[0_12px_40px_-32px_rgba(32,66,56,0.35)]">
                <CardHeader className="border-b border-[#e2e7df] bg-[#f5f6ef]">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#987555]">Private records</p><CardTitle className="mt-1 font-display text-xl text-[#1d403b]">Saved history</CardTitle><CardDescription className="mt-1">Select a confirmed run to inspect its output.</CardDescription></div>
                    <Button variant="ghost" size="icon" aria-label="Refresh saved history" onClick={() => void loadHistory()} disabled={historyLoading}><RefreshCw className={`size-4 ${historyLoading ? "animate-spin" : ""}`} /></Button>
                  </div>
                </CardHeader>
                <CardContent className="p-3 sm:p-4">
                  {historyError && <div role="alert" className="mb-3 rounded-lg border border-[#e6c1b6] bg-[#fbefea] p-3 text-sm text-[#813c31]"><p>{historyError}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void loadHistory()}>Try again</Button></div>}
                  {historyLoading && runs.length === 0 ? (
                    <div className="space-y-2" aria-label="Loading saved history">
                      {[0, 1, 2].map((item) => <div key={item} className="h-[68px] animate-pulse rounded-xl bg-[#e8ece5]" />)}
                    </div>
                  ) : runs.length === 0 && !historyError ? (
                    <div className="rounded-xl border border-dashed border-[#cbd8ce] bg-[#f6f7f1] px-5 py-8 text-center">
                      <span className="mx-auto grid size-10 place-items-center rounded-full bg-[#e4eee5] text-[#4e766a]"><FileText className="size-5" /></span>
                      <p className="mt-3 text-sm font-semibold text-[#39554d]">No saved health runs yet</p>
                      <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Save a period to capture the first baseline. History only appears after server confirmation.</p>
                    </div>
                  ) : (
                    <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                      {runs.map((run) => (
                        <div key={run.id} className={`rounded-xl border p-3 transition-colors ${selectedId === run.id ? "border-[#7ca69a] bg-[#edf4ed]" : "border-[#e0e6de] bg-[#fbfbf7] hover:bg-[#f2f5ef]"}`}>
                          <button type="button" onClick={() => { setSelectedId(run.id); setConfirmDeleteId(null); }} className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397166]">
                            <span className="flex items-start justify-between gap-2">
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-[#345148]">{run.input.business}</span>
                                <span className="mt-1 block text-xs text-[#718078]">{run.input.start} — {run.input.end} · {run.input.currency}</span>
                              </span>
                              {selectedId === run.id && <Badge variant="outline" className="shrink-0 border-[#8eafa2] text-[#38675b]">Open</Badge>}
                            </span>
                            <span className="mt-2 flex items-center gap-1.5 text-[10px] text-[#89948d]"><Clock3 className="size-3" />Saved {displayDate(run.createdAt)}</span>
                          </button>
                          <div className="mt-2 flex items-center justify-end gap-1 border-t border-[#e4e9e1] pt-2">
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#53685f]" onClick={() => void copyReport(run)} disabled={busy !== null}>
                              {copiedId === run.id ? <Check className="mr-1.5 size-3.5" /> : <Clipboard className="mr-1.5 size-3.5" />}Copy report
                            </Button>
                            {confirmDeleteId === run.id ? (
                              <>
                                <span className="ml-1 text-[10px] text-rose-800">Delete permanently?</span>
                                <Button variant="destructive" size="sm" className="h-7 px-2 text-xs" onClick={() => void deleteRun(run.id)} disabled={busy !== null}>Confirm</Button>
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setConfirmDeleteId(null)} disabled={busy !== null}>Keep</Button>
                              </>
                            ) : <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#896356] hover:text-rose-800" onClick={() => setConfirmDeleteId(run.id)} disabled={busy !== null}><Trash2 className="mr-1.5 size-3.5" />Delete</Button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {selectedRun && (
              <Card className="border-[#d5dfd7] bg-[#fafaf5] shadow-[0_14px_48px_-34px_rgba(32,66,56,0.45)]">
                <CardHeader className="border-b border-[#e2e7df] bg-[#f7f7f0]">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#987555]">Saved run detail</p><CardTitle className="mt-1 font-display text-xl text-[#1d403b]">{selectedRun.input.business}</CardTitle><CardDescription className="mt-1">Saved {displayDate(selectedRun.createdAt)}{selectedRun.baselineId ? " · compared with selected baseline" : " · standalone baseline"}</CardDescription></div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => void copyReport(selectedRun)} disabled={busy !== null}>
                        {copiedId === selectedRun.id ? <Check className="mr-2 size-4" /> : <Clipboard className="mr-2 size-4" />}Copy report text
                      </Button>
                      <Button variant="ghost" onClick={() => setSelectedId(null)}>Close detail</Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 p-4 sm:p-6">
                  {hasUnknownMetrics && <div className="flex items-start gap-2 rounded-lg border border-[#e6d7b8] bg-[#faf3e4] p-3 text-xs leading-5 text-[#725e3b]"><AlertCircle className="mt-0.5 size-4 shrink-0" /><p>Some indicators remain unknown because input totals were missing or a denominator was zero. They have not been treated as zero.</p></div>}
                  <HealthResult result={selectedRun.result} />
                  <details className="rounded-xl border border-[#dbe3dc] bg-[#f7f8f2] p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-[#405b52]">Plain-text report</summary>
                    <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-[#eef1e9] p-4 font-mono text-xs leading-5 text-[#43564e]">{selectedRun.report}</pre>
                  </details>
                </CardContent>
              </Card>
            )}
            </div>
            <div className={activeKind === "release" ? "block" : "hidden"}><ReleaseWorkbench /></div>
            <div className={activeKind === "governance" ? "block" : "hidden"}><GovernanceWorkbench /></div>
            <div className={activeKind === "cost" ? "block" : "hidden"}><CostWorkbench /></div>
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({ label, hint, required, children }: { label: string; hint: string; required?: boolean; children: ReactNode }) {
  return <div className="space-y-1.5">
    <label className="block text-xs font-semibold text-[#405850]">{label}{required && <span className="ml-1 text-[#a55f47]">Required</span>}{children}</label>
    <p className="text-[11px] leading-4 text-[#839087]">{hint}</p>
  </div>;
}

function NumericField({ label, example, value, onChange, integer }: { label: string; example: string; value: string; onChange: (value: string) => void; integer?: boolean }) {
  const id = `health-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return <div className="space-y-1.5">
    <label htmlFor={id} className="block text-xs font-semibold text-[#405850]">{label}</label>
    <Input id={id} type="number" min="0" max="1000000000" step={integer ? "1" : "0.01"} inputMode={integer ? "numeric" : "decimal"} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Leave blank if unknown" />
    <p className="text-[11px] leading-4 text-[#839087]">{example}</p>
  </div>;
}
