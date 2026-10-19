import type { AgentJourneyCheck, AgentJourneyResult } from "../../../shared/agent-journey";
import { ArrowUpRight, CheckCircle2, CircleHelp, CircleX, FileSearch, ShieldCheck } from "lucide-react";

interface AgentJourneyResultsProps {
  result: AgentJourneyResult;
}

const STATUS_COPY: Record<AgentJourneyCheck["status"], { label: string; detail: string; className: string; Icon: typeof CheckCircle2 }> = {
  observed: {
    label: "Found on the site",
    detail: "We found evidence for this",
    className: "border-teal-700/20 bg-teal-700/5 text-teal-800 dark:text-teal-300",
    Icon: CheckCircle2,
  },
  not_found: {
    label: "Not found in pages checked",
    detail: "No evidence was found in the pages checked",
    className: "border-amber-700/20 bg-amber-700/5 text-amber-800 dark:text-amber-300",
    Icon: CircleX,
  },
  uncertain: {
    label: "Could not tell",
    detail: "The available pages did not give a clear answer",
    className: "border-slate-500/20 bg-slate-500/5 text-slate-700 dark:text-slate-300",
    Icon: CircleHelp,
  },
};

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export default function AgentJourneyResults({ result }: AgentJourneyResultsProps) {
  return (
    <section
      aria-labelledby="agent-journey-title"
      className="overflow-hidden rounded-lg border border-primary/25 bg-primary/[0.025]"
      data-testid="agent-journey-results"
    >
      <div className="border-b border-primary/15 px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
            <FileSearch className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="agent-journey-title" className="font-semibold">What a visitor can learn from your site</h3>
              <span className="rounded-full border border-primary/25 bg-background px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                Read-only evidence pilot
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Five website checks, based only on the public pages below. This is not a live assistant, booking, or phone verification, and it does not change your existing 100-point score.
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-border/70">
        {result.checks.map((check, index) => {
          const status = STATUS_COPY[check.status];
          const StatusIcon = status.Icon;
          return (
            <article key={check.id} className="px-4 py-4 sm:px-5" data-testid={`agent-journey-check-${check.id}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <h4 className="font-medium leading-snug">{check.label}</h4>
                      <p className="mt-1 break-words text-sm leading-relaxed text-foreground/85">{check.finding}</p>
                    </div>
                  </div>
                </div>
                <span className={`inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.className}`}>
                  <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{status.label}</span>
                </span>
              </div>

              <div className="mt-3 space-y-3 pl-7">
                <p className="text-xs text-muted-foreground">{status.detail}.</p>
                <div className="rounded-md border bg-background/70 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next fix</p>
                  <p className="mt-1 break-words text-sm leading-relaxed">{check.nextStep}</p>
                </div>
                {check.evidence.length > 0 ? (
                  <div className="space-y-2">
                    <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence from the site</h5>
                    {check.evidence.map((evidence, evidenceIndex) => {
                      const href = safeHttpUrl(evidence.url);
                      return (
                        <blockquote key={`${evidence.url}-${evidenceIndex}`} className="min-w-0 border-l-2 border-primary/30 pl-3">
                          <p className="break-words text-sm leading-relaxed text-foreground/85">“{evidence.excerpt}”</p>
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex max-w-full items-start gap-1 text-xs text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                            >
                              <span className="break-all">{href}</span>
                              <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="sr-only">(opens in a new tab)</span>
                            </a>
                          ) : (
                            <p className="mt-1 text-xs text-muted-foreground">Source link omitted because it is not a safe public http(s) URL.</p>
                          )}
                        </blockquote>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No source excerpt was retained for this check.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="grid gap-4 border-t border-primary/15 bg-muted/25 px-4 py-4 sm:grid-cols-2 sm:px-5">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <FileSearch className="h-4 w-4 text-primary" aria-hidden="true" />
            Pages assessed
          </h4>
          {result.pages.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {result.pages.map((page, index) => {
                const href = safeHttpUrl(page);
                return (
                  <li key={`${page}-${index}`} className="min-w-0 text-sm">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-start gap-1 text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">
                        <span className="break-all">{href}</span>
                        <ArrowUpRight className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="text-muted-foreground">A page was assessed; its link was omitted because it is not a safe public http(s) URL.</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No assessed page links were supplied.</p>
          )}
        </div>

        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            Coverage limits
          </h4>
          {result.limitations.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
              {result.limitations.map((limitation, index) => <li key={index} className="break-words">{limitation}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">This is a partial view of public website evidence, not a complete verification of the business.</p>
          )}
        </div>
      </div>
    </section>
  );
}
