import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Archive, ArrowDown, ArrowLeft, ArrowRight, CalendarClock, FileText, LockKeyhole, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { authFetch } from "@/lib/queryClient";

type Severity = "critical" | "high" | "warning" | "info";

interface AlertLog {
  id: string;
  createdAt: string;
  subject: string;
  source: string;
  severity: Severity;
  sizeBytes: number;
}

interface AlertLogPage {
  items: AlertLog[];
  page: number;
  hasMore: boolean;
}

interface AlertLogDetail extends AlertLog {
  text: string;
  html: string;
  reports: { name: string; content: string }[];
  version: number;
  tenantId: number;
}

const severityStyles: Record<Severity, string> = {
  critical: "border-rose-300 bg-rose-50 text-rose-800",
  high: "border-orange-300 bg-orange-50 text-orange-800",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
  info: "border-sky-300 bg-sky-50 text-sky-800",
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let amount = bytes / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit++;
  }
  return `${amount.toFixed(1)} ${units[unit]}`;
}

async function readError(response: Response): Promise<Error> {
  const payload = await response.json().catch(() => null);
  return new Error(payload?.error || payload?.message || `${response.status} ${response.statusText}`);
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge variant="outline" className={`capitalize ${severityStyles[severity]}`}>
      {severity} reported
    </Badge>
  );
}

function LoadingPanel() {
  return (
    <Card aria-label="Loading alert reports">
      <CardContent className="space-y-4 p-5">
        <div className="h-5 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/5 animate-pulse rounded bg-muted" />
        <div className="h-36 animate-pulse rounded-md bg-muted/70" />
      </CardContent>
    </Card>
  );
}

export default function AlertLogsPage() {
  const { isChecking, tenant, token, isReplitAuth, replitUser } = useAuth();
  const isOwner = !isChecking && tenant?.id === 1 && tenant.isAdmin === true;
  const identityKey = [tenant?.id ?? null, tenant?.email ?? null, isReplitAuth, replitUser?.id ?? null, token ? "authenticated" : "session"];
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const id = new URLSearchParams(window.location.search).get("alert");
    return id && /^[0-9a-f-]{36}$/.test(id) ? id : null;
  });
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const listQuery = useQuery<AlertLogPage>({
    queryKey: ["/api/admin/alert-logs", page, ...identityKey],
    enabled: isOwner,
    queryFn: async () => {
      const response = await authFetch(`/api/admin/alert-logs?page=${page}`);
      if (!response.ok) throw await readError(response);
      return response.json();
    },
  });

  const selectedItem = listQuery.data?.items.find((item) => item.id === selectedId);

  const detailQuery = useQuery<AlertLogDetail>({
    queryKey: ["/api/admin/alert-logs", selectedId, ...identityKey],
    enabled: isOwner && !!selectedId,
    queryFn: async () => {
      const response = await authFetch(`/api/admin/alert-logs/${encodeURIComponent(selectedId!)}`);
      if (!response.ok) throw await readError(response);
      return response.json();
    },
  });

  const changePage = (nextPage: number) => {
    setSelectedId(null);
    setDownloadError(null);
    setPage(nextPage);
  };

  const downloadSnapshot = async () => {
    if (!selectedId) return;
    setDownloadError(null);
    try {
      const response = await authFetch(`/api/admin/alert-logs/${encodeURIComponent(selectedId)}/download`);
      if (!response.ok) throw await readError(response);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `alert-report-${selectedId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "The report download could not be completed.");
    }
  };

  if (isChecking) {
    return <main className="min-h-[100dvh] p-4 md:p-7"><div className="mx-auto max-w-6xl space-y-5"><div className="h-8 w-56 animate-pulse rounded bg-muted" /><LoadingPanel /></div></main>;
  }

  if (!isOwner) {
    return (
      <main className="min-h-[100dvh] px-4 py-12 md:px-8">
        <Card className="mx-auto max-w-xl border-amber-200 bg-amber-50/70">
          <CardContent className="flex gap-4 p-6">
            <LockKeyhole className="mt-1 h-6 w-6 shrink-0 text-amber-800" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-semibold text-foreground">Owner access required</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Private platform alert reports are available only to the platform owner.</p>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] overflow-y-auto bg-[hsl(var(--background))] px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="relative overflow-hidden rounded-2xl border border-slate-300/80 bg-[hsl(195,38%,94%)] p-5 md:p-8">
          <div className="absolute -right-12 -top-16 h-56 w-56 rounded-full border-[28px] border-slate-300/30" aria-hidden="true" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-600">
                <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Platform operations
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">Alert reports</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Private, complete incident snapshots. The summary remains in email; this archive holds the full report and its source material.</p>
            </div>
            <div className="flex items-center gap-2 self-start rounded-lg border border-slate-300 bg-white/70 px-3 py-2 text-xs text-slate-600 sm:self-auto">
              <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> Owner-only archive
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.5fr)]">
          <section aria-labelledby="archive-heading" className="space-y-3">
            <div className="flex items-end justify-between gap-3 px-1">
              <div>
                <h2 id="archive-heading" className="text-lg font-semibold">Archive</h2>
                <p className="text-xs text-muted-foreground">Newest reports first</p>
              </div>
              <span className="font-mono text-xs text-muted-foreground">PAGE {page + 1}</span>
            </div>

            {listQuery.isLoading ? (
              <div className="space-y-2" aria-label="Loading report archive">
                {[0, 1, 2].map((key) => <div key={key} className="h-24 animate-pulse rounded-xl border bg-muted/60" />)}
              </div>
            ) : listQuery.isError ? (
              <Card role="alert" className="border-rose-200">
                <CardContent className="p-5">
                  <p className="font-medium">Archive could not be loaded</p>
                  <p className="mt-1 break-words text-sm text-muted-foreground">{listQuery.error.message}</p>
                  <Button className="mt-4" variant="outline" size="sm" onClick={() => listQuery.refetch()}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Retry
                  </Button>
                </CardContent>
              </Card>
            ) : listQuery.data?.items.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <Archive className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                  <p className="mt-3 font-medium">No reports on this page</p>
                  <p className="mt-1 text-sm text-muted-foreground">{page > 0 ? "Return to the newest page to continue browsing." : "New private platform reports will appear here."}</p>
                  {page > 0 && <Button className="mt-4" variant="outline" size="sm" onClick={() => changePage(0)}>Back to first page</Button>}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {listQuery.data?.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setSelectedId(item.id); setDownloadError(null); }}
                    aria-pressed={selectedId === item.id}
                    className={`w-full rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === item.id ? "border-slate-700 bg-slate-900 text-white shadow-sm" : "border-border bg-card hover:border-slate-400 hover:bg-muted/40"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="line-clamp-2 text-sm font-semibold leading-5">{item.subject}</span>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${selectedId === item.id ? "border-white/30 bg-white/10 text-white" : severityStyles[item.severity]}`}>{item.severity}</span>
                    </div>
                    <p className={`mt-2 truncate text-xs ${selectedId === item.id ? "text-slate-300" : "text-muted-foreground"}`}>{item.source}</p>
                    <div className={`mt-3 flex items-center justify-between gap-2 text-[11px] ${selectedId === item.id ? "text-slate-300" : "text-muted-foreground"}`}>
                      <span>{formatDate(item.createdAt)}</span><span>{formatBytes(item.sizeBytes)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <nav aria-label="Report archive pages" className="flex items-center justify-between rounded-lg border bg-card px-3 py-2">
              <Button variant="ghost" size="sm" disabled={page === 0 || listQuery.isFetching} onClick={() => changePage(page - 1)} aria-label="Previous page">
                <ArrowLeft className="mr-1 h-4 w-4" /> Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {page + 1}</span>
              <Button variant="ghost" size="sm" disabled={!listQuery.data?.hasMore || listQuery.isFetching} onClick={() => changePage(page + 1)} aria-label="Next page">
                Next <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </nav>
          </section>

          <section aria-label="Selected report details" className="min-w-0">
            {!selectedId ? (
              <Card className="flex min-h-[420px] items-center justify-center">
                <CardContent className="max-w-sm py-12 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700"><FileText className="h-5 w-5" aria-hidden="true" /></div>
                  <h2 className="mt-4 text-lg font-semibold">Choose a report</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Select an archive entry to inspect its complete private report and preserved report snapshots.</p>
                </CardContent>
              </Card>
            ) : detailQuery.isLoading ? (
              <LoadingPanel />
            ) : detailQuery.isError ? (
              <Card role="alert" className="border-rose-200">
                <CardContent className="p-6">
                  <h2 className="font-semibold">Report details could not be loaded</h2>
                  <p className="mt-2 break-words text-sm text-muted-foreground">{detailQuery.error.message}</p>
                  <Button className="mt-4" variant="outline" size="sm" onClick={() => detailQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry details</Button>
                </CardContent>
              </Card>
            ) : detailQuery.data ? (
              <div className="space-y-4">
                <Card className="overflow-hidden">
                  <div className="border-b bg-card px-5 py-5 md:px-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={detailQuery.data.severity} />
                          <Badge variant="outline" className="font-mono text-[10px]">REPORT v{detailQuery.data.version}</Badge>
                        </div>
                        <h2 className="mt-3 break-words text-xl font-semibold leading-7">{detailQuery.data.subject}</h2>
                        <div className="mt-3 flex flex-col gap-1.5 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-5">
                          <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />{formatDate(detailQuery.data.createdAt)}</span>
                          <span>Source: <strong className="font-medium text-foreground">{detailQuery.data.source}</strong></span>
                          <span>{formatBytes(detailQuery.data.sizeBytes)}</span>
                        </div>
                      </div>
                      <Button onClick={downloadSnapshot} className="shrink-0"><ArrowDown className="mr-2 h-4 w-4" />Download JSON</Button>
                    </div>
                    <div className="mt-5 flex gap-3 rounded-lg border border-amber-300/70 bg-amber-50 px-3.5 py-3 text-sm text-amber-950" role="note">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <p><strong>Not reviewed.</strong> Severity is reported by the alert source and has not been independently confirmed.</p>
                    </div>
                    {downloadError && <p role="alert" className="mt-3 text-sm text-rose-700">Download failed: {downloadError}</p>}
                  </div>
                  <CardContent className="p-5 md:p-6">
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Full report</h3>
                    <pre className="max-h-[62vh] min-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-slate-50 p-4 font-mono text-xs leading-6 text-slate-800">{detailQuery.data.text}</pre>
                  </CardContent>
                </Card>

                <Card>
                  <div className="border-b px-5 py-4">
                    <h3 className="font-semibold">Report snapshots</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">Complete source reports preserved with this alert. These persist across republishing.</p>
                  </div>
                  <CardContent className="space-y-4 p-5">
                    {detailQuery.data.reports.length ? detailQuery.data.reports.map((report, index) => (
                      <section key={`${report.name}-${index}`} className="overflow-hidden rounded-lg border">
                        <h4 className="break-all border-b bg-muted/40 px-3 py-2 text-xs font-semibold">{report.name}</h4>
                        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6">{report.content}</pre>
                      </section>
                    )) : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">This report contains no separate source snapshots.</p>}
                  </CardContent>
                </Card>

                <aside className="rounded-xl border border-slate-300 bg-slate-100/80 p-4 text-xs leading-5 text-slate-700">
                  <p className="font-semibold">Archive continuity</p>
                  <p className="mt-1">Reports persist in the database across republishing, with a local mirror in <code className="rounded bg-white/80 px-1 py-0.5 font-mono">data/private-alert-logs</code>. Legacy previews cannot restore full report detail.</p>
                </aside>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
