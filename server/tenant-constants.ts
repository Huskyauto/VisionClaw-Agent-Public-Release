// R115.5+sec round 3 — compatibility facade for the dependency-free leaf, so
// modules in circular-import cycles with ./auth (discord, telegram,
// webhook-triggers, whatsapp) can still reference ADMIN_TENANT_ID without
// tripping TS2448 "used before declaration". Canonical platform owner identity;
// auth re-exports this value. Environment variables must not reassign ownership.
export { ADMIN_TENANT_ID } from "./tools/lib/tenant-constants";
