import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AlertCircle, Check, Clipboard, Clock3, FileText, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PilotResult } from "../../../../shared/business-pilots/common";
import { authFetch } from "@/lib/queryClient";

export type PilotKind = "health" | "release" | "governance" | "cost";
export interface PilotRun<I> {
  id: string;
  kind: PilotKind;
  input: I;
  result: PilotResult;
  report: string;
  createdAt: string;
  baselineId?: string;
}
interface PendingOperation<I> { signature: string; requestId: string; input: I; baselineId?: string }
export interface PilotRunsStore<I> {
  runs: PilotRun<I>[];
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  selectedRun: PilotRun<I> | null;
  loading: boolean;
  historyError: string | null;
  refresh: () => Promise<void>;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  notice: string | null;
  setNotice: Dispatch<SetStateAction<string | null>>;
  busy: "save" | "delete" | null;
  retryAvailable: boolean;
  submit: (input: I, baselineId?: string) => Promise<void>;
  retry: () => Promise<void>;
  invalidateOperation: () => void;
  confirmId: string | null;
  setConfirmId: Dispatch<SetStateAction<string | null>>;
  remove: (runId: string) => Promise<void>;
  clipboardError: string | null;
  setClipboardError: Dispatch<SetStateAction<string | null>>;
}

export function usePilotRuns<I>(kind: PilotKind) {
  const [runs, setRuns] = useState<PilotRun<I>[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const pending = useRef<PendingOperation<I> | null>(null);
  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedId) ?? null, [runs, selectedId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setHistoryError(null);
    try {
      const response = await authFetch(`/api/admin/business-pilots/${kind}`);
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getError(data, `Could not load ${kind} history (${response.status}).`));
      const rows = data && typeof data === "object" && Array.isArray((data as { runs?: unknown }).runs)
        ? (data as { runs: unknown[] }).runs : null;
      if (!rows) throw new Error("The saved history response was not in the expected format.");
      const valid = rows.filter((row): row is PilotRun<I> => {
        if (!row || typeof row !== "object") return false;
        const run = row as Partial<PilotRun<I>>;
        return typeof run.id === "string" && UUID.test(run.id) && run.kind === kind && typeof run.createdAt === "string" &&
          typeof run.report === "string" && !!run.input && !!run.result && Array.isArray(run.result.findings) &&
          Array.isArray(run.result.metrics) && Array.isArray(run.result.limitations);
      });
      setRuns(valid);
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : `Could not load ${kind} history.`);
    } finally {
      setLoading(false);
    }
  }, [kind]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function sendOperation(operation: PendingOperation<I>) {
    setBusy("save"); setError(null); setNotice(null); setRetryAvailable(false);
    try {
      const response = await authFetch(`/api/admin/business-pilots/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: operation.requestId, input: operation.input, ...(operation.baselineId ? { baselineId: operation.baselineId } : {}) }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = getError(data, `Save rejected (${response.status}).`);
        if (response.status >= 500) {
          setRetryAvailable(true);
          setError(`${message} The result may have committed; retry this unchanged operation to reuse its request ID.`);
        } else {
          pending.current = null;
          setError(`${message}${response.status === 409 ? " Resolve the conflict before starting another save." : response.status === 422 ? " Correct the reported validation issue and submit again." : ""}`);
        }
        return;
      }
      if (!data || typeof data !== "object" || typeof (data as PilotRun<I>).id !== "string" ||
          (data as PilotRun<I>).kind !== kind || !(data as PilotRun<I>).result || typeof (data as PilotRun<I>).report !== "string" ||
          typeof (data as PilotRun<I>).createdAt !== "string" || !(data as PilotRun<I>).input) {
        setRetryAvailable(true);
        setError("The server response did not confirm a saved run. Keep inputs unchanged and retry this same operation.");
        return;
      }
      const saved = data as PilotRun<I>;
      pending.current = null;
      setRetryAvailable(false);
      setRuns((current) => [saved, ...current.filter((run) => run.id !== saved.id)]);
      setSelectedId(saved.id);
      setConfirmId(null);
      setNotice("Saved and confirmed by the server.");
    } catch (caught) {
      setRetryAvailable(true);
      setError(`${caught instanceof Error ? caught.message : "The save could not be confirmed."} Keep inputs unchanged to retry the same request.`);
    } finally {
      setBusy(null);
    }
  }

  function invalidateOperation() {
    const hadPendingOperation = pending.current !== null;
    pending.current = null;
    setRetryAvailable(false);
    if (hadPendingOperation) {
      setError((previous) => previous ? `${previous} Inputs changed; the earlier retry identity was discarded. Submitting now starts a new save.` : previous);
    }
  }

  async function submit(input: I, baselineId?: string) {
    const signature = JSON.stringify({ kind, input, baselineId });
    if (!pending.current || pending.current.signature !== signature) {
      pending.current = { signature, requestId: crypto.randomUUID(), input, baselineId };
    }
    const operation = pending.current;
    if (operation) await sendOperation(operation);
  }

  async function retry() {
    if (pending.current && retryAvailable) await sendOperation(pending.current);
  }

  async function remove(runId: string) {
    if (!UUID.test(runId)) {
      setError("Delete was not sent: saved run ID is not a valid UUID.");
      return;
    }
    setBusy("delete"); setError(null); setNotice(null);
    try {
      const response = await authFetch(`/api/admin/business-pilots/${kind}/${encodeURIComponent(runId)}`, { method: "DELETE" });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !data || typeof data !== "object" || (data as { ok?: unknown }).ok !== true) {
        throw new Error(getError(data, `Delete was not confirmed (${response.status}).`));
      }
      setRuns((current) => current.filter((run) => run.id !== runId));
      if (selectedId === runId) setSelectedId(null);
      setConfirmId(null);
      setNotice("Saved run deleted.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete was not confirmed.");
    } finally { setBusy(null); }
  }

  return {
    runs, selectedId, setSelectedId, selectedRun, loading, historyError, refresh,
    error, setError, notice, setNotice, busy, retryAvailable, submit, retry, invalidateOperation,
    confirmId, setConfirmId, remove, clipboardError, setClipboardError,
  };
}

function getError(data: unknown, fallback: string) {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : fallback;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function PilotRunHistory<I>({ kind, store, runLabel }: {
  kind: PilotKind;
  runLabel: (run: PilotRun<I>) => string;
  store: PilotRunsStore<I>;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { runs, selectedId, setSelectedId, selectedRun, loading, historyError, refresh, busy, confirmId, setConfirmId, remove } = store;

  async function copyReport(run: PilotRun<I>) {
    store.setClipboardError(null);
    store.setNotice(null);
    try {
      await navigator.clipboard.writeText(run.report);
      setCopiedId(run.id);
      store.setNotice("Report text copied. No file or external delivery was created.");
      window.setTimeout(() => setCopiedId((current) => current === run.id ? null : current), 2200);
    } catch {
      setSelectedId(run.id);
      store.setClipboardError("Clipboard access is unavailable. The report text below remains selectable for manual copying.");
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(270px,0.62fr)_minmax(0,1.38fr)]">
      <Card className="border-[#d5dfd7] bg-[#fafaf5]">
        <CardHeader className="border-b border-[#e2e7df] bg-[#f5f6ef]">
          <div className="flex items-start justify-between gap-2">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#987555]">{kind} archive</p><CardTitle className="mt-1 font-display text-xl text-[#1d403b]">Saved history</CardTitle><CardDescription className="mt-1">Confirmed, private records.</CardDescription></div>
            <Button variant="ghost" size="icon" aria-label="Refresh saved history" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></Button>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-4">
          {historyError && <div role="alert" className="mb-3 rounded-lg border border-[#e6c1b6] bg-[#fbefea] p-3 text-sm text-[#813c31]"><p>{historyError}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void refresh()}>Try again</Button></div>}
          {loading && runs.length === 0 ? <div className="space-y-2" aria-label="Loading saved history">{[0, 1, 2].map((i) => <div key={i} className="h-[68px] animate-pulse rounded-xl bg-[#e8ece5]" />)}</div>
            : runs.length === 0 && !historyError ? <div className="rounded-xl border border-dashed border-[#cbd8ce] bg-[#f6f7f1] px-4 py-8 text-center"><span className="mx-auto grid size-10 place-items-center rounded-full bg-[#e4eee5] text-[#4e766a]"><FileText className="size-5" /></span><p className="mt-3 text-sm font-semibold text-[#39554d]">No saved runs yet</p><p className="mt-1 text-xs leading-5 text-muted-foreground">A run appears here only after the server confirms it.</p></div>
            : <div className="max-h-[640px] space-y-2 overflow-y-auto pr-1">
              {runs.map((run) => <div key={run.id} className={`rounded-xl border p-3 ${selectedId === run.id ? "border-[#7ca69a] bg-[#edf4ed]" : "border-[#e0e6de] bg-[#fbfbf7]"}`}>
                <button type="button" className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397166]" onClick={() => { setSelectedId(run.id); setConfirmId(null); }}>
                  <span className="block truncate text-sm font-semibold text-[#345148]">{runLabel(run)}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-[10px] text-[#89948d]"><Clock3 className="size-3" />{dateLabel(run.createdAt)}</span>
                </button>
                <div className="mt-2 flex flex-wrap items-center justify-end gap-1 border-t border-[#e4e9e1] pt-2">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void copyReport(run)}><Clipboard className="mr-1.5 size-3.5" />{copiedId === run.id ? "Copied" : "Copy report"}</Button>
                  {confirmId === run.id ? <><span className="text-[10px] text-rose-800">Delete permanently?</span><Button variant="destructive" size="sm" className="h-7 px-2 text-xs" onClick={() => void remove(run.id)} disabled={busy !== null}>Confirm</Button><Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setConfirmId(null)} disabled={busy !== null}>Keep</Button></>
                    : <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#896356]" onClick={() => setConfirmId(run.id)} disabled={busy !== null}><Trash2 className="mr-1.5 size-3.5" />Delete</Button>}
                </div>
              </div>)}
            </div>}
        </CardContent>
      </Card>

      {selectedRun ? <Card className="min-w-0 border-[#d5dfd7] bg-[#fafaf5]">
        <CardHeader className="border-b border-[#e2e7df] bg-[#f7f7f0]"><p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#987555]">Saved run detail</p><CardTitle className="mt-1 font-display text-xl text-[#1d403b]">{selectedRun.result.title}</CardTitle><CardDescription>{dateLabel(selectedRun.createdAt)} · {selectedRun.result.verdict}</CardDescription></CardHeader>
        <CardContent className="space-y-5 p-4 sm:p-6">
          <p className="text-sm leading-6 text-[#61716b]">{selectedRun.result.summary}</p>
          {selectedRun.result.metrics.length > 0 && <section><h3 className="mb-2 text-sm font-semibold text-[#38524b]">Metrics & changes</h3><div className="grid gap-2 sm:grid-cols-2">{selectedRun.result.metrics.map((metric) => <div key={metric.label} className="rounded-lg border border-[#dbe3dc] bg-[#f7f8f2] p-3"><p className="text-xs font-medium text-[#597067]">{metric.label}</p><p className="mt-1 font-display text-xl font-semibold text-[#173c38]">{metric.value === null ? "Unknown" : `${metric.value} ${metric.unit}`}</p>{metric.delta != null && <p className="text-xs text-muted-foreground">Change: {metric.delta > 0 ? "+" : ""}{metric.delta} {metric.unit} ({metric.direction ?? "unknown"})</p>}</div>)}</div></section>}
          <section><h3 className="mb-2 text-sm font-semibold text-[#38524b]">Findings & next steps</h3><div className="divide-y divide-[#dfe5df] rounded-xl border border-[#dbe3dc] bg-[#fbfaf6]">{selectedRun.result.findings.map((finding) => <article key={finding.label} className="space-y-1.5 p-3"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-[#344d48]">{finding.label}</h4><Badge variant="outline" className="capitalize text-[10px]">{finding.status}</Badge></div><p className="text-sm leading-5 text-[#4e625d]">{finding.detail}</p>{finding.evidence && <p className="text-xs text-muted-foreground">Evidence reference: {finding.evidence}</p>}<p className="text-xs leading-5"><strong className="text-[#8b6b4e]">Next step:</strong> <span className="text-[#4e625d]">{finding.nextStep}</span></p></article>)}</div></section>
          <section className="rounded-xl border border-[#e5d8c4] bg-[#f7f0e5] p-4"><h3 className="text-sm font-semibold text-[#65513a]">Scope limitations</h3><ul className="mt-2 space-y-1.5 pl-4 text-xs leading-5 text-[#6a5e4d]">{selectedRun.result.limitations.map((limitation) => <li key={limitation} className="list-disc">{limitation}</li>)}</ul></section>
          <details className="rounded-xl border border-[#dbe3dc] bg-[#f7f8f2] p-4" open={!!store.clipboardError}><summary className="cursor-pointer text-sm font-semibold text-[#405b52]">Selectable report text</summary>{store.clipboardError && <p role="alert" className="mt-2 flex items-start gap-2 text-xs text-[#813c31]"><AlertCircle className="size-4 shrink-0" />{store.clipboardError}</p>}<pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-[#eef1e9] p-4 font-mono text-xs leading-5 text-[#43564e]">{selectedRun.report}</pre><Button variant="outline" size="sm" className="mt-3" onClick={() => void copyReport(selectedRun)}><Check className="mr-2 size-4" />Copy report text</Button></details>
        </CardContent>
      </Card> : <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-[#d0dbd2] bg-[#f8f8f2] p-6 text-center"><p className="max-w-sm text-sm leading-6 text-[#718078]">Choose a saved run to inspect its measured output, evidence gaps, and next steps. Report text stays available here for manual review and copying.</p></div>}
    </div>
  );
}
