import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, CheckCircle2, CircleDashed, Clipboard, ShieldCheck, XCircle } from "lucide-react";

interface RunConfirmation {
  version: number;
  status: "confirmed" | "failed" | "unverified";
  scope: string;
  subjectDigest: string;
  checks: { id: string; label: string; status: "passed" | "failed" | "unverified"; evidence: string }[];
  limitations: string[];
}

export function RunConfirmationPanel({ confirmation }: { confirmation?: RunConfirmation }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  if (!confirmation) {
    return (
      <Card aria-label="Run confirmation" data-testid="run-confirmation-missing">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Run confirmation
            <Badge variant="outline" className="ml-auto text-xs">No receipt</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No confirmation receipt was recorded for this run. An agent’s success claim is not verification.
          </p>
        </CardContent>
      </Card>
    );
  }

  const status = {
    confirmed: { label: "Checks confirmed", icon: CheckCircle2, style: "border-emerald-300/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" },
    failed: { label: "Checks failed", icon: XCircle, style: "border-red-300/60 bg-red-500/10 text-red-800 dark:text-red-300" },
    unverified: { label: "Unverified", icon: CircleDashed, style: "border-amber-300/60 bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  }[confirmation.status];
  const StatusIcon = status.icon;
  const subjectDigest = confirmation.subjectDigest;

  async function copyDigest() {
    try {
      await navigator.clipboard.writeText(subjectDigest);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <Card aria-label="Run confirmation" data-testid="run-confirmation-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Run confirmation
          <Badge variant="outline" className={`ml-auto gap-1.5 text-xs ${status.style}`}>
            <StatusIcon aria-hidden="true" className="h-3.5 w-3.5" />
            {status.label}
          </Badge>
        </CardTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Receipt v{confirmation.version}. This applies only to the checks listed here—not approval of the whole project.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <section aria-labelledby="confirmation-scope" className="rounded-md border bg-muted/30 p-3">
          <h3 id="confirmation-scope" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Assessment scope</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm">{confirmation.scope || "Not specified"}</p>
        </section>

        <section aria-labelledby="confirmation-checks">
          <h3 id="confirmation-checks" className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Checks <span className="font-normal normal-case tracking-normal">({confirmation.checks.length})</span>
          </h3>
          {confirmation.checks.length ? (
            <ul className="divide-y rounded-md border">
              {confirmation.checks.map((check) => {
                const Icon = check.status === "passed" ? CheckCircle2 : check.status === "failed" ? XCircle : CircleDashed;
                const color = check.status === "passed" ? "text-emerald-700 dark:text-emerald-400" : check.status === "failed" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400";
                return (
                  <li key={check.id} className="flex items-start gap-2.5 p-3">
                    <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium">{check.label}</span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${color}`}>{check.status}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{check.evidence || "No evidence details provided."}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No checks are included in this receipt.</p>
          )}
        </section>

        <section aria-labelledby="confirmation-limitations">
          <h3 id="confirmation-limitations" className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Limitations</h3>
          {confirmation.limitations.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {confirmation.limitations.map((limitation, index) => <li key={`${index}-${limitation}`}>{limitation}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No limitations were recorded.</p>
          )}
        </section>

        <details className="group rounded-md border">
          <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Subject digest <span className="ml-1 text-xs font-normal text-muted-foreground">· inspect receipt subject</span>
          </summary>
          <div className="flex flex-col gap-2 border-t p-3 sm:flex-row sm:items-start">
            <code className="min-w-0 flex-1 break-all text-xs text-muted-foreground">{confirmation.subjectDigest || "No digest provided."}</code>
            <Button type="button" variant="outline" size="sm" onClick={copyDigest} disabled={!confirmation.subjectDigest} aria-label="Copy subject digest" className="shrink-0">
              {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Clipboard className="mr-1.5 h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          {copyError && <p role="status" className="text-xs text-muted-foreground">Could not copy. Select the digest text instead.</p>}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
