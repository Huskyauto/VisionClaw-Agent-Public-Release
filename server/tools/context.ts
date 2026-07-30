/**
 * Tools-layer-split S2 — trusted-context builder.
 *
 * The dispatcher (S4) calls `buildToolContext` ONCE per invocation, deriving
 * identity from platform-internal values. Caller-supplied trust signals in
 * params (`_tenantId`, `_personaId`, `_conversationId`, `_approvedByGate`,
 * `_rateLimitChecked`) are NEVER read here — the legacy strip-and-restamp
 * hardening (R125+69–71) is preserved by construction: the only way identity
 * enters a new-package handler is via this function's explicit arguments.
 *
 * Contract: data/feature-contracts/tools-layer-split/spec.md
 */

import type { ToolContext } from "./types";

const TRUST_SIGNAL_KEYS = [
  "_tenantId",
  "_personaId",
  "_conversationId",
  "_approvedByGate",
  "_rateLimitChecked",
  // Trust-seam authz signals surfaced on ToolContext (see types.ts). Stripped
  // from a migrated handler's params so it can only read the trusted ctx value.
  // NOTE: telemetry/hint keys (`_projectDriveFolderId`, `_invokedVia`,
  // `_invokedByModel`, `_userId`, `_personaName`) are DELIBERATELY absent — they
  // are non-authoritative passthroughs that migrated handlers read from params
  // verbatim (media/agentic precedent). Adding them here would break those.
  "_projectId",
  "_allowedPaths",
] as const;

/** Returns a shallow copy of params with every caller-supplied trust signal
 * removed. Dispatcher applies this before a handler ever sees params. */
export function stripTrustSignals(params: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...params };
  for (const k of TRUST_SIGNAL_KEYS) delete out[k];
  return out;
}

export function buildToolContext(args: {
  tenantId?: number;
  personaId?: number;
  conversationId?: number;
  projectId?: number;
  allowedPaths?: string[];
  rateLimitChecked?: boolean;
  /** S4 advisory cancellation — platform-threaded (ALS), never from params. */
  abortSignal?: AbortSignal;
}): ToolContext {
  return {
    tenantId: args.tenantId,
    personaId: args.personaId,
    conversationId: args.conversationId,
    projectId: args.projectId,
    allowedPaths: args.allowedPaths,
    rateLimitChecked: args.rateLimitChecked === true,
    abortSignal: args.abortSignal,
  };
}
