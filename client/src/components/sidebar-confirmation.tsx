import { useEffect, useRef, useState } from "react";
import { ChevronDown, CircleDashed, ShieldCheck } from "lucide-react";
import { checkLatestRun } from "@/lib/latest-run-confirmation";

type LatestRunResult = Awaited<ReturnType<typeof checkLatestRun>>;

export function SidebarConfirmation() {
  const mounted = useRef(false);
  const requestGeneration = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LatestRunResult>(null);
  const [error, setError] = useState<string | null>(null);
  const [assessedAt, setAssessedAt] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
    };
  }, []);

  async function confirmLatestRun() {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError(null);
    setResult(null);
    setAssessedAt(null);

    try {
      const latest = await checkLatestRun();
      if (!mounted.current || generation !== requestGeneration.current) return;
      setResult(latest);
      setAssessedAt(latest ? new Date().toISOString() : null);
    } catch {
      if (!mounted.current || generation !== requestGeneration.current) return;
      setError("Could not check the latest run. Try again.");
    } finally {
      if (mounted.current && generation === requestGeneration.current) setLoading(false);
    }
  }

  const confirmation = result?.confirmation;
  const checks = confirmation?.checks ?? [];
  const passed = checks.filter((check) => check.status === "passed").length;
  const failed = checks.filter((check) => check.status === "failed").length;
  const unverified = checks.filter((check) => check.status === "unverified").length;

  return (
    <section className="mx-2 my-2 overflow-hidden rounded-md border border-sidebar-border bg-sidebar">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls="sidebar-confirmation-content"
        className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">Confirmation</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <div id="sidebar-confirmation-content" className="space-y-3 border-t border-sidebar-border px-3 py-3">
          <button
            type="button"
            onClick={confirmLatestRun}
            disabled={loading}
            className="flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar disabled:cursor-wait disabled:opacity-65"
          >
            {loading ? "Checking latest run…" : "Confirm latest run"}
          </button>

          {loading && (
            <div className="space-y-2" role="status" aria-live="polite">
              <span className="sr-only">Checking the latest run</span>
              <div className="h-3 w-4/5 animate-pulse rounded bg-sidebar-accent" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-sidebar-accent" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5" role="alert">
              <p className="break-words text-xs leading-relaxed text-foreground">{error}</p>
              <button
                type="button"
                onClick={confirmLatestRun}
                className="mt-2 flex min-h-11 w-full items-center justify-center rounded-md border border-sidebar-border px-3 py-2 text-xs font-semibold text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && result === null && (
            <p className="rounded-md bg-sidebar-accent/60 p-2.5 text-xs leading-relaxed text-muted-foreground">
              {requestGeneration.current === 0
                ? "Click above to check your latest workflow run."
                : "No saved workflow run found. Ordinary chats and other project types are not covered yet."}
            </p>
          )}

          {!loading && !error && result && (
            <div className="space-y-2.5" aria-live="polite">
              <div className="rounded-md bg-sidebar-accent/60 p-2.5">
                <div className="flex items-start gap-2">
                  <CircleDashed
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                      confirmation?.status === "confirmed"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : confirmation?.status === "failed"
                          ? "text-destructive"
                          : "text-amber-700 dark:text-amber-400"
                    }`}
                    aria-hidden="true"
                  />
                  <p className="min-w-0 break-words text-xs font-semibold leading-relaxed text-foreground">
                    {confirmation
                      ? confirmation.status === "confirmed"
                        ? "Checks confirmed"
                        : confirmation.status === "failed"
                          ? "Checks failed"
                          : "Unverified"
                      : "No confirmation receipt"}
                  </p>
                </div>
                <dl className="mt-2 space-y-1 text-xs leading-relaxed">
                  <div className="flex min-w-0 gap-1.5">
                    <dt className="shrink-0 text-muted-foreground">Run</dt>
                    <dd className="min-w-0 break-words font-mono text-foreground">#{result.run.id}</dd>
                  </div>
                  <div className="flex min-w-0 gap-1.5">
                    <dt className="shrink-0 text-muted-foreground">Objective</dt>
                    <dd className="min-w-0 break-words text-foreground">{result.run.objective || "Not provided"}</dd>
                  </div>
                  {assessedAt && (
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Assessed at</dt>
                      <dd className="break-all font-mono text-[10px] text-foreground">{assessedAt}</dd>
                    </div>
                  )}
                </dl>
                <p className="mt-2 break-words text-xs leading-relaxed text-foreground">
                  {passed} passed · {failed} failed · {unverified} unverified
                </p>
              </div>

              <a
                href={`/replay?run=${result.run.id}`}
                className="flex min-h-11 w-full items-center justify-center rounded-md border border-sidebar-border px-3 py-2 text-center text-xs font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                View run details
              </a>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Checks saved workflow evidence only. No actions are repeated. Missing outcome proof stays unverified.
          </p>
        </div>
      )}
    </section>
  );
}
