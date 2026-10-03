import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmsIdleForAcknowledgedFailure,
  deriveInstinctRecoveryUiState,
  getRecoveryFailureIdentity,
  retainReviewedRecoveryIdentity,
  type RecoveryFailureIdentity,
  type RecoverySnapshotForUi,
} from "../../client/src/lib/instinct-owner-recovery-ui";

const snapshot = (
  conversationId: number,
  status: string,
  failedAt: string,
  requestId: string,
): RecoverySnapshotForUi => ({
  thread: { state: "ready", conversationId },
  run: { status, failedAt },
  latestFailure: { requestId },
});

const failureA = snapshot(10, "failed", "2026-10-21T10:00:00.000Z", "request-A");
const identityA: RecoveryFailureIdentity = {
  conversationId: 10,
  failedAt: "2026-10-21T10:00:00.000Z",
  requestId: "request-A",
};
const freshOwner = { isPlatformOwner: true, isFetching: false, hasReadError: false };

test("consent for failed turn A is not consent for a newly observed failure B", () => {
  for (const failedTurnB of [
    snapshot(10, "failed", "2026-10-21T10:01:00.000Z", "request-B"),
    snapshot(10, "failed", identityA.failedAt, "request-B"),
  ]) {
    const state = deriveInstinctRecoveryUiState({
      ...freshOwner,
      data: failedTurnB,
      reviewedIdentity: identityA,
      verifiedAcknowledgement: null,
    });
    assert.equal(state.isCurrentFailureReviewed, false);
    assert.equal(state.canAcknowledge, false);
    assert.equal(
      retainReviewedRecoveryIdentity(identityA, getRecoveryFailureIdentity(failedTurnB), true),
      null,
    );
  }
});

test("cached idle state is not continuation or success while fetching or after a read error", () => {
  const idle = snapshot(10, "idle", identityA.failedAt, identityA.requestId);
  for (const state of [
    deriveInstinctRecoveryUiState({
      ...freshOwner, data: idle, isFetching: true, reviewedIdentity: null, verifiedAcknowledgement: null,
    }),
    deriveInstinctRecoveryUiState({
      ...freshOwner, data: idle, hasReadError: true, reviewedIdentity: null, verifiedAcknowledgement: null,
    }),
  ]) {
    assert.equal(state.canContinue, false);
    assert.equal(state.confirmationResult, null);
  }
});

test("verified acknowledgement for A is suppressed after a later failure B", () => {
  const state = deriveInstinctRecoveryUiState({
    ...freshOwner,
    data: snapshot(10, "failed", "2026-10-21T10:01:00.000Z", "request-B"),
    reviewedIdentity: null,
    verifiedAcknowledgement: { identity: identityA, result: "resumed" },
  });
  assert.equal(state.confirmationResult, null);
  assert.equal(state.canContinue, false);
});

test("role loss masks cached recovery data and continuation", () => {
  const state = deriveInstinctRecoveryUiState({
    ...freshOwner,
    isPlatformOwner: false,
    data: snapshot(10, "idle", identityA.failedAt, identityA.requestId),
    reviewedIdentity: identityA,
    verifiedAcknowledgement: { identity: identityA, result: "resumed" },
  });
  assert.equal(state.visibleSnapshot, null);
  assert.equal(state.canContinue, false);
  assert.equal(state.confirmationResult, null);
});

test("fresh idle acknowledgement remains visible only for the exact verified failure", () => {
  const state = deriveInstinctRecoveryUiState({
    ...freshOwner,
    data: snapshot(10, "idle", identityA.failedAt, identityA.requestId),
    reviewedIdentity: null,
    verifiedAcknowledgement: { identity: identityA, result: "resumed" },
  });
  assert.equal(state.canContinue, true);
  assert.equal(state.confirmationResult, "resumed");

  const changedThread = deriveInstinctRecoveryUiState({
    ...freshOwner,
    data: snapshot(11, "idle", identityA.failedAt, identityA.requestId),
    reviewedIdentity: null,
    verifiedAcknowledgement: { identity: identityA, result: "resumed" },
  });
  assert.equal(changedThread.confirmationResult, null);
});

test("an acknowledgement refetch confirms only a fresh idle read of the exact reviewed failure", () => {
  assert.equal(confirmsIdleForAcknowledgedFailure({
    ...freshOwner,
    data: snapshot(10, "idle", identityA.failedAt, identityA.requestId),
    acknowledgedIdentity: identityA,
  }), true);
  assert.equal(confirmsIdleForAcknowledgedFailure({
    ...freshOwner,
    data: snapshot(10, "idle", identityA.failedAt, identityA.requestId),
    isFetching: true,
    acknowledgedIdentity: identityA,
  }), false);
  assert.equal(confirmsIdleForAcknowledgedFailure({
    ...freshOwner,
    data: snapshot(10, "idle", identityA.failedAt, identityA.requestId),
    hasReadError: true,
    acknowledgedIdentity: identityA,
  }), false);
  assert.equal(confirmsIdleForAcknowledgedFailure({
    ...freshOwner,
    data: snapshot(10, "failed", "2026-10-21T10:01:00.000Z", "request-B"),
    acknowledgedIdentity: identityA,
  }), false);
});