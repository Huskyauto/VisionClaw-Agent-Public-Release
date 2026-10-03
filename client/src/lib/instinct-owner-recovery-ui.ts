export interface RecoveryFailureIdentity {
  conversationId: number;
  failedAt: string;
  requestId: string | null;
}

export interface RecoverySnapshotForUi {
  thread: { state?: string; conversationId: number | null } | null;
  run: { status: string; failedAt: string | null } | null;
  latestFailure: { requestId: string } | null;
}

export interface VerifiedRecoveryAcknowledgement {
  identity: RecoveryFailureIdentity;
  result: "resumed" | "duplicate";
}

export interface InstinctRecoveryUiInput {
  isPlatformOwner: boolean;
  data: RecoverySnapshotForUi | null | undefined;
  isFetching: boolean;
  hasReadError: boolean;
  reviewedIdentity: RecoveryFailureIdentity | null;
  verifiedAcknowledgement: VerifiedRecoveryAcknowledgement | null;
}

export function getRecoveryFailureIdentity(
  snapshot: RecoverySnapshotForUi | null | undefined,
): RecoveryFailureIdentity | null {
  const conversationId = snapshot?.thread?.conversationId;
  const failedAt = snapshot?.run?.failedAt;
  if (!conversationId || !failedAt || !["failed", "idle"].includes(snapshot?.run?.status || "")) return null;
  return {
    conversationId,
    failedAt,
    requestId: snapshot?.latestFailure?.requestId || null,
  };
}

export function sameRecoveryFailureIdentity(
  left: RecoveryFailureIdentity | null,
  right: RecoveryFailureIdentity | null,
): boolean {
  return !!left && !!right &&
    left.conversationId === right.conversationId &&
    left.failedAt === right.failedAt &&
    left.requestId === right.requestId;
}

export function recoveryFailureIdentityKey(identity: RecoveryFailureIdentity | null): string {
  return identity
    ? `${identity.conversationId}\u0000${identity.failedAt}\u0000${identity.requestId ?? ""}`
    : "";
}

export function retainReviewedRecoveryIdentity(
  reviewed: RecoveryFailureIdentity | null,
  current: RecoveryFailureIdentity | null,
  canReview: boolean,
): RecoveryFailureIdentity | null {
  return canReview && sameRecoveryFailureIdentity(reviewed, current) ? reviewed : null;
}

export function deriveInstinctRecoveryUiState(input: InstinctRecoveryUiInput) {
  const visibleSnapshot = input.isPlatformOwner ? input.data ?? null : null;
  const authoritative = input.isPlatformOwner && !!visibleSnapshot &&
    !input.isFetching && !input.hasReadError;
  const identity = getRecoveryFailureIdentity(visibleSnapshot);
  const isCurrentFailureReviewed = visibleSnapshot?.run?.status === "failed" &&
    sameRecoveryFailureIdentity(input.reviewedIdentity, identity);
  const canReview = authoritative &&
    visibleSnapshot?.thread?.state === "ready" &&
    visibleSnapshot.thread.conversationId !== null &&
    visibleSnapshot.run?.status === "failed" &&
    !!visibleSnapshot.latestFailure?.requestId &&
    !!visibleSnapshot.run.failedAt;
  const canAcknowledge = canReview && isCurrentFailureReviewed;
  const canContinue = authoritative &&
    visibleSnapshot?.thread?.state === "ready" &&
    visibleSnapshot.thread.conversationId !== null &&
    visibleSnapshot.run?.status === "idle";
  const confirmationResult = canContinue &&
    sameRecoveryFailureIdentity(input.verifiedAcknowledgement?.identity ?? null, identity)
    ? input.verifiedAcknowledgement?.result ?? null
    : null;

  return {
    visibleSnapshot,
    identity,
    isCurrentFailureReviewed,
    canReview,
    canAcknowledge,
    canContinue,
    confirmationResult,
  };
}

export function confirmsIdleForAcknowledgedFailure(input: {
  isPlatformOwner: boolean;
  data: RecoverySnapshotForUi | null | undefined;
  isFetching: boolean;
  hasReadError: boolean;
  acknowledgedIdentity: RecoveryFailureIdentity;
}): boolean {
  const state = deriveInstinctRecoveryUiState({
    ...input,
    reviewedIdentity: null,
    verifiedAcknowledgement: null,
  });
  return state.canContinue &&
    sameRecoveryFailureIdentity(state.identity, input.acknowledgedIdentity);
}