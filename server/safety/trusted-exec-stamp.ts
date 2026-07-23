/**
 * Trusted execution-context stamping for the guarded tool executor.
 *
 * SECURITY: tool args are MODEL-AUTHORED and therefore untrusted. The
 * underscore trust signals that inner tool dispatchers consume (`_tenantId`,
 * `_invokedByModel`, `_invokedVia`, `_selfHeal`) MUST be derived solely from
 * the trusted execution context and MUST override any same-named field a model
 * may have emitted in toolArgs. These pure helpers centralize that derivation
 * so the guarded executor cannot accidentally trust a caller-supplied field.
 *
 * Pinned by tests/security/trusted-exec-stamp.test.ts. Kept dependency-free
 * (no tools.ts / DB import) so the invariant is testable hermetically.
 */

export interface TrustedExecCtx {
  invokedVia: string;
  /** Set true only by a caller that already ran its own approval flow (main_chat). */
  skipApprovalGate?: boolean;
}

/** Self-heal is identified ONLY by the trusted context channel, never by an arg. */
export function isSelfHealCtx(ctx: TrustedExecCtx): boolean {
  return ctx.invokedVia === "self_heal";
}

/**
 * Whether the in-executor fallback HITL confirmation gate may be skipped.
 * Sourced ONLY from trusted ctx — a model-authored `args._selfHeal` can NEVER
 * influence this (it is not a parameter here), so a jailbroken model cannot
 * emit `_selfHeal:true` to skip requestToolConfirmation() for high-risk tools.
 */
export function shouldSkipApprovalGate(ctx: TrustedExecCtx): boolean {
  return ctx.skipApprovalGate === true || isSelfHealCtx(ctx);
}

/**
 * The trusted underscore flags stamped onto the inner tool's args. Spread this
 * AFTER the caller args (`{ ...args, ...trustedExecFlags(ctx, tenantId) }`) so
 * any model-forged `_tenantId` / `_invokedByModel` / `_invokedVia` / `_selfHeal`
 * is deterministically clobbered with the trusted value.
 */
export function trustedExecFlags(ctx: TrustedExecCtx, tenantId: number): {
  _tenantId: number;
  _invokedByModel: true;
  _invokedVia: string;
  _selfHeal: boolean;
} {
  return {
    _tenantId: tenantId,
    _invokedByModel: true,
    _invokedVia: ctx.invokedVia,
    _selfHeal: isSelfHealCtx(ctx),
  };
}
