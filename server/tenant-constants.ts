// R115.5+sec round 3 — standalone constants module with ZERO imports, so
// modules in circular-import cycles with ./auth (discord, telegram,
// webhook-triggers, whatsapp) can still reference ADMIN_TENANT_ID without
// tripping TS2448 "used before declaration". Mirror of `server/auth.ts:19`.
export const ADMIN_TENANT_ID = 1;
