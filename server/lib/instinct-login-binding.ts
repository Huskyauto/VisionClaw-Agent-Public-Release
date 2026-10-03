import { ownerTenantId } from "../agentic/autonomous-budget";

/** Exact private-channel login account; unset preserves the original owner login. */
export function instinctLoginTenantId(): number | null {
  const raw = process.env.INSTINCT_OWNER_LOGIN_TENANT_ID;
  if (raw === undefined) {
    const ownerId = ownerTenantId();
    return Number.isSafeInteger(ownerId) && ownerId > 0 ? ownerId : null;
  }
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}