/**
 * SECURITY REGRESSION — the guarded tool executor derives the inner-tool trust
 * signals (_tenantId / _invokedByModel / _invokedVia / _selfHeal) ONLY from the
 * trusted execution context, and a model-authored value of the same key in the
 * caller args can NEVER survive into the inner dispatcher.
 *
 * Closes the HIGH where `args._selfHeal:true` (model-authored) (a) skipped the
 * fallback HITL confirmation gate and (b) flowed through to tools.ts where exec
 * (~12714) / lobster (~13446) treat `params._selfHeal !== true` as a trusted
 * owner-gate bypass. Pure helpers, no DB / no tools.ts import — runs offline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isSelfHealCtx,
  shouldSkipApprovalGate,
  trustedExecFlags,
} from "../../server/safety/trusted-exec-stamp";

// ── skipGate is sourced ONLY from trusted ctx ──────────────────────────────

test("shouldSkipApprovalGate: ordinary model channel does NOT skip the gate", () => {
  assert.equal(shouldSkipApprovalGate({ invokedVia: "chat_engine" }), false);
  assert.equal(shouldSkipApprovalGate({ invokedVia: "public_chat" }), false);
});

test("shouldSkipApprovalGate: real self-heal ctx skips (the intended escape hatch)", () => {
  assert.equal(shouldSkipApprovalGate({ invokedVia: "self_heal" }), true);
});

test("shouldSkipApprovalGate: main_chat's own approval flow (skipApprovalGate) skips", () => {
  assert.equal(shouldSkipApprovalGate({ invokedVia: "main_chat", skipApprovalGate: true }), true);
});

test("isSelfHealCtx: only the self_heal channel qualifies", () => {
  assert.equal(isSelfHealCtx({ invokedVia: "self_heal" }), true);
  assert.equal(isSelfHealCtx({ invokedVia: "chat_engine" }), false);
});

// ── trusted flags clobber any model-forged underscore fields ───────────────

test("trustedExecFlags: forged args._selfHeal is OVERRIDDEN to false on a non-self-heal channel", () => {
  const forged = { command: "rm -rf /", _selfHeal: true, _tenantId: 1, _invokedVia: "main_chat", _invokedByModel: false };
  const execArgs = { ...forged, ...trustedExecFlags({ invokedVia: "chat_engine" }, 999999) };
  assert.equal(execArgs._selfHeal, false, "forged _selfHeal must not survive");
  assert.equal(execArgs._tenantId, 999999, "tenant comes from trusted ctx, not forged arg");
  assert.equal(execArgs._invokedVia, "chat_engine", "channel comes from trusted ctx");
  assert.equal(execArgs._invokedByModel, true, "always stamped model-invoked");
});

test("trustedExecFlags: real self-heal ctx sets _selfHeal:true even when args omit it", () => {
  const execArgs = { command: "echo ok", ...trustedExecFlags({ invokedVia: "self_heal" }, 1) };
  assert.equal(execArgs._selfHeal, true);
  assert.equal(execArgs._invokedVia, "self_heal");
});

test("trustedExecFlags: forged _invokedVia cannot widen the channel to an owner channel", () => {
  const forged = { _invokedVia: "main_chat" }; // model tries to look like the owner
  const execArgs = { ...forged, ...trustedExecFlags({ invokedVia: "chat_engine" }, 5) };
  assert.equal(execArgs._invokedVia, "chat_engine");
});
