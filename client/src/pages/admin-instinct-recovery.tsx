import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { apiRequest, authFetch } from "@/lib/queryClient";
import {
  confirmsIdleForAcknowledgedFailure,
  deriveInstinctRecoveryUiState,
  getRecoveryFailureIdentity,
  recoveryFailureIdentityKey,
  retainReviewedRecoveryIdentity,
  sameRecoveryFailureIdentity,
  type RecoveryFailureIdentity,
  type VerifiedRecoveryAcknowledgement,
} from "@/lib/instinct-owner-recovery-ui";

interface RecoverySnapshot {
  thread: { state?: string; conversationId: number | null; updatedAt?: string | null } | null;
  run: { status: string; reason: string | null; failedAt: string | null } | null;
  latestFailure: { text: string; requestId: string; createdAt: string | null } | null;
  history: Array<{ id: number; role: string; content: string; createdAt: string }>;
  outbox: Array<{ id: number; message: string; createdAt: string }>;
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^\d+:\s*(\{.*\})$/s);
  if (match) {
    try {
      const body = JSON.parse(match[1]);
      if (typeof body.error === "string") return body.error;
    } catch {
      // Keep the API's original error visible if it is not JSON.
    }
  }
  return message;
}

function displayDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

export default function AdminInstinctRecoveryPage() {
  const { tenant, isChecking } = useAuth();
  const isPlatformOwner = tenant?.id === 1 && tenant.isAdmin === true;
  const [reviewedIdentity, setReviewedIdentity] = useState<RecoveryFailureIdentity | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [verifiedAcknowledgement, setVerifiedAcknowledgement] =
    useState<VerifiedRecoveryAcknowledgement | null>(null);
  const { data, error, isLoading, isFetching, refetch } = useQuery<RecoverySnapshot>({
    queryKey: ["/api/admin/instinct-recovery", tenant?.id, tenant?.isAdmin],
    queryFn: async () => {
      const response = await authFetch("/api/admin/instinct-recovery");
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
      return response.json();
    },
    enabled: isPlatformOwner,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const uiState = deriveInstinctRecoveryUiState({
    isPlatformOwner,
    data,
    isFetching,
    hasReadError: !!error,
    reviewedIdentity,
    verifiedAcknowledgement,
  });
  const failureIdentityKey = recoveryFailureIdentityKey(getRecoveryFailureIdentity(data));

  useEffect(() => {
    setReviewedIdentity(current =>
      retainReviewedRecoveryIdentity(current, uiState.identity, uiState.canReview),
    );
  }, [failureIdentityKey, uiState.canReview]);

  useEffect(() => {
    if (isFetching || error || !isPlatformOwner) setVerifiedAcknowledgement(null);
  }, [isFetching, error, isPlatformOwner]);

  const acknowledgeFailure = async () => {
    const reviewedTurn = uiState.identity;
    if (!isPlatformOwner || !uiState.canAcknowledge || !reviewedTurn ||
        !sameRecoveryFailureIdentity(reviewedIdentity, reviewedTurn) || submitting) return;
    const acknowledgedTurn = { ...reviewedTurn };
    setSubmitting(true);
    setRequestError(null);
    setVerifiedAcknowledgement(null);
    try {
      const response = await apiRequest("POST", "/api/admin/instinct-recovery/acknowledge", {
        acknowledge: "yes",
        conversationId: acknowledgedTurn.conversationId,
        failedAt: acknowledgedTurn.failedAt,
      });
      const result = await response.json() as { result: "resumed" | "duplicate" };
      const fresh = await refetch();
      if (!confirmsIdleForAcknowledgedFailure({
        isPlatformOwner,
        data: fresh.data,
        isFetching: fresh.isFetching,
        hasReadError: !!fresh.error,
        acknowledgedIdentity: acknowledgedTurn,
      })) {
        setRequestError(
          `The server recorded ${result.result}, but a fresh status read did not confirm the same conversation idle for the acknowledged failure. Do not send or retry the failed request; refresh status before continuing.`,
        );
        return;
      }
      setReviewedIdentity(null);
      setVerifiedAcknowledgement({ identity: acknowledgedTurn, result: result.result });
    } catch (error) {
      setRequestError(readableError(error));
    } finally {
      setSubmitting(false);
    }
  };
  const view: RecoverySnapshot | null = uiState.visibleSnapshot ? data ?? null : null;

  if (isChecking) {
    return <div className="p-6 text-muted-foreground" role="status">Checking account access…</div>;
  }
  if (!isPlatformOwner) {
    return <div className="p-6"><h1 className="text-2xl font-semibold">Platform owner access required</h1><p className="mt-2 text-muted-foreground">This recovery view is limited to the independently authenticated platform owner.</p></div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold">Instinct owner recovery</h1>
            <Badge variant="outline">Review only · no replay</Badge>
          </div>
          <p className="max-w-3xl text-muted-foreground">
            Review the current saved private thread and its bounded recent history before deciding whether to acknowledge a terminal failure.
          </p>
        </header>

        <Card className="border-amber-500/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-600" />Important: acknowledgement is not a retry</CardTitle>
            <CardDescription>
              The remote provider may still bill for the timed-out or failed request. Earlier partial work, reads, or private outbox writes may already exist. Review the saved history and outbox below before proceeding.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Acknowledgement only permits the conversation to become idle. It does not complete, resend, or automatically replay the original request, and it does not release any retained spend reservation.</p>
            <p>Unknown or active local work is not safe to resume. The server will reject stale or conflicting failure timestamps.</p>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh saved status
          </Button>
          {isFetching && <span className="text-sm text-muted-foreground" role="status">Refreshing…</span>}
        </div>

        {isLoading ? <p role="status" className="text-muted-foreground">Loading current saved Instinct thread…</p> : null}
        {error ? <p role="alert" className="text-destructive">Could not load owner recovery data: {readableError(error)}</p> : null}
        {requestError ? <p role="alert" className="rounded-md border border-destructive/50 p-3 text-destructive">{requestError}</p> : null}
        {uiState.confirmationResult && (
          <p role="status" className="rounded-md border border-green-600/40 p-3 text-sm">
            {uiState.confirmationResult === "duplicate"
              ? "The earlier owner acknowledgement is persisted. Fresh status confirms the same saved conversation is idle; the failed request remains failed and was not replayed."
              : "Owner acknowledgement is persisted. Fresh status confirms the same saved conversation is idle; the failed request remains failed and was not replayed."}
          </p>
        )}

        {view && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Current saved thread</CardTitle>
                <CardDescription>Only the server-bound current Instinct thread is shown; no conversation ID can be selected here.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                <p>Thread state: <strong>{view.thread?.state ?? "No saved thread"}</strong></p>
                <p>Conversation: <strong>{view.thread?.conversationId ?? "None"}</strong></p>
                <p>Turn status: <strong>{view.run?.status ?? "Unavailable"}</strong></p>
                <p>Failure reason: <strong>{view.run?.reason ?? "None recorded"}</strong></p>
                <p>Failed at: <strong>{displayDate(view.run?.failedAt)}</strong></p>
                <p>Thread updated: <strong>{displayDate(view.thread?.updatedAt)}</strong></p>
              </CardContent>
            </Card>

            {view.latestFailure && (
              <Card>
                <CardHeader>
                  <CardTitle>Latest failed original submission</CardTitle>
                  <CardDescription>Request ID: <code>{view.latestFailure.requestId}</code> · submitted {displayDate(view.latestFailure.createdAt)}</CardDescription>
                </CardHeader>
                <CardContent><pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm">{view.latestFailure.text}</pre></CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Recent conversation history</CardTitle>
                <CardDescription>Most recent saved messages, oldest first within this bounded window.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {view.history.length ? view.history.map(item => (
                  <article key={item.id} className="rounded-md border p-3">
                    <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                      <strong>{item.role}</strong><time>{displayDate(item.createdAt)}</time>
                    </div>
                    <pre className="whitespace-pre-wrap break-words text-sm">{item.content}</pre>
                  </article>
                )) : <p className="text-sm text-muted-foreground">No recent history is available.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Instinct outbox</CardTitle>
                <CardDescription>Review these private messages for partial work before acknowledging.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {view.outbox.length ? view.outbox.map(item => (
                  <article key={item.id} className="rounded-md border p-3">
                    <time className="text-xs text-muted-foreground">{displayDate(item.createdAt)}</time>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-sm">{item.message}</pre>
                  </article>
                )) : <p className="text-sm text-muted-foreground">No recent outbox messages are available.</p>}
              </CardContent>
            </Card>

            {view.run?.status === "failed" && view.thread?.conversationId && view.run.failedAt && view.latestFailure && (
              <Card>
                <CardHeader>
                  <CardTitle>Owner acknowledgement</CardTitle>
                  <CardDescription>This is available only for the current saved failed turn. The original failed receipt is retained.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={uiState.isCurrentFailureReviewed}
                      disabled={!uiState.canReview}
                      onChange={event => setReviewedIdentity(event.target.checked ? uiState.identity : null)}
                    />
                    <span>I reviewed the history and outbox, understand the provider may still bill and partial work may exist, and confirm that no automatic replay is requested.</span>
                  </label>
                  <Button onClick={() => void acknowledgeFailure()} disabled={!uiState.canAcknowledge || submitting}>
                    {submitting ? "Saving acknowledgement…" : "Resume conversation only — do not replay failed request"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {view.run?.status === "failed" && !view.latestFailure && (
              <p role="alert" className="rounded-md border border-amber-500/50 p-3 text-sm">
                The latest failed submission receipt is unavailable. Recovery is disabled; do not open a replacement thread or resend the request.
              </p>
            )}

            {uiState.canContinue && (
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-5 w-5 text-green-600" />A fresh status read confirms the saved conversation is idle.</p>
                  <Button asChild variant="outline"><a href="/instinct/chat">Open the private Instinct chat</a></Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}