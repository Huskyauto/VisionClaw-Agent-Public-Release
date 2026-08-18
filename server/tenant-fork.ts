// Tenant config-forking: provision a NEW tenant pre-loaded with a SOURCE
// tenant's *configuration* (voice, approvals, governance, tool policies,
// persona overrides, automation schedules, custom tools, widgets, scoring
// rules, budgets, sender allowlist) — but NEVER its data or memory.
//
// Design invariant (the whole point — see Bob's "client pods" architecture):
//   FAIL CLOSED. Only tables explicitly listed in FORKABLE_CONFIG_TABLES are
//   ever copied. Every one of the other ~150 tenant-scoped tables (messages,
//   memory_entries, conversations, invoices, leads, CRM, finance, video_jobs,
//   logs, telemetry, …) is excluded BY DEFAULT — including any table added in
//   the future. A misclassification or a new table can therefore never bleed
//   one client's data into another's pod. Adding a table to the fork is a
//   deliberate, reviewed, tested one-liner in the registry below.
//
// Deliberately EXCLUDED config-ish tables (need extra work before they're safe
// to fork — tracked in docs/architecture-notes.md):
//   - tenant_provider_keys      → holds API keys; a new client must NOT inherit
//                                  another client's credentials. New tenant
//                                  falls back to env-default provider keys.
//   - crews / crew_agents / crew_flows / crew_tasks → parent→child FK chain,
//                                  needs PK remapping across 4 tables.
//   - research_schedules        → FK to research_programs (a DATA table we
//                                  don't fork) → would dangle.
//   - agent_wake_schedules      → FK to conversations/projects (DATA) → dangle.
//   - outreach_sequences        → child-step rows live elsewhere; partial fork.

import { db } from "./db";
import { eq, and } from "drizzle-orm";
import {
  tenants,
  tenantPersonaNames,
  tenantVoiceProfiles,
  autonomyRules,
  governanceRules,
  governanceFrameworks,
  toolPolicies,
  briefingWidgets,
  leadScoringRules,
  departmentBudgets,
  heartbeatTasks,
  inboxSenderAllowlist,
} from "@shared/schema";

export interface ForkableTableEntry {
  /** Human/log name (matches the SQL table name). */
  name: string;
  /** The drizzle table object. */
  table: any;
  /** True if the table has a serial `id` PK that must be regenerated on copy. */
  hasSerialId: boolean;
  /**
   * Name of a column that references this same table's PK (intra-table FK).
   * Triggers a two-pass copy: insert with the ref nulled to build an
   * oldId→newId map, then re-point the ref at the cloned parent.
   */
  selfRefField?: string;
  /** Mutates a row in place to clear run-state / counters so the clone starts fresh. */
  reset?: (row: any) => void;
}

// The vetted allowlist. Keep entries small, flat, and FK-clean. Each addition
// MUST: (1) be genuinely configuration not data, (2) not reference a row in a
// table we don't fork (no dangling FK), (3) reset any run-state counters, and
// (4) ship with a test in tests/agentic/tenant-fork.test.ts.
export const FORKABLE_CONFIG_TABLES: ForkableTableEntry[] = [
  { name: "tenant_persona_names", table: tenantPersonaNames, hasSerialId: true },
  { name: "tenant_voice_profiles", table: tenantVoiceProfiles, hasSerialId: true },
  { name: "autonomy_rules", table: autonomyRules, hasSerialId: true },
  {
    name: "governance_rules",
    table: governanceRules,
    hasSerialId: true,
    reset: (r) => {
      r.lastTriggeredAt = null;
      r.triggerCount = 0;
    },
  },
  {
    name: "governance_frameworks",
    table: governanceFrameworks,
    hasSerialId: true,
  },
  { name: "tool_policies", table: toolPolicies, hasSerialId: true },
  {
    name: "briefing_widgets",
    table: briefingWidgets,
    hasSerialId: true,
    reset: (r) => {
      r.lastValue = null;
      r.lastUpdatedAt = null;
    },
  },
  { name: "lead_scoring_rules", table: leadScoringRules, hasSerialId: true },
  { name: "department_budgets", table: departmentBudgets, hasSerialId: true },
  // NOTE: custom_tools is DELIBERATELY excluded. `custom_tools.name` carries a
  // GLOBAL unique constraint (shared/schema.ts) — not tenant-scoped — so copying
  // a source tenant's tool names into a new tenant hits a unique violation and
  // aborts the whole fork. Making the constraint UNIQUE(tenant_id, name) touches
  // global tool-name resolution (wide blast radius) — deferred until that's
  // designed. See docs/architecture-notes.md § Known defense-in-depth gaps.
  {
    name: "heartbeat_tasks",
    table: heartbeatTasks,
    hasSerialId: true,
    selfRefField: "parentTaskId",
    reset: (r) => {
      // Clone the schedule definition but start the clock fresh, so the new
      // pod's automations don't "fire immediately as if overdue".
      r.lastRunAt = null;
      r.nextRunAt = null;
    },
  },
  // Composite PK (tenant_id + address), no serial id to regenerate.
  { name: "inbox_sender_allowlist", table: inboxSenderAllowlist, hasSerialId: false },
];

export interface ForkTenantInput {
  /** Display name for the new tenant. */
  name: string;
  /** Unique login email for the new tenant. */
  email: string;
  /** Optional plan (defaults to the source tenant's plan, else "trial"). */
  plan?: string;
  /** Optional pre-hashed password for the new tenant. */
  passwordHash?: string | null;
}

export interface ForkTenantResult {
  newTenantId: number;
  sourceTenantId: number;
  copied: Record<string, number>;
  totalRows: number;
}

/**
 * Provision a new tenant whose CONFIG mirrors `sourceTenantId`. Atomic: any
 * failure rolls the whole thing back (no half-provisioned pod). Returns the
 * new tenant id and a per-table copied-row count.
 */
export async function forkTenant(
  sourceTenantId: number,
  input: ForkTenantInput,
): Promise<ForkTenantResult> {
  if (!Number.isInteger(sourceTenantId) || sourceTenantId <= 0) {
    throw new Error(`forkTenant: invalid sourceTenantId ${sourceTenantId}`);
  }
  const email = (input.email || "").toLowerCase().trim();
  const name = (input.name || "").trim();
  if (!email || !email.includes("@")) {
    throw new Error("forkTenant: a valid email is required for the new tenant");
  }
  if (!name) {
    throw new Error("forkTenant: a name is required for the new tenant");
  }

  return await db.transaction(async (tx) => {
    // 1. Source must exist.
    const [source] = await tx
      .select()
      .from(tenants)
      .where(eq(tenants.id, sourceTenantId));
    if (!source) {
      throw new Error(`forkTenant: source tenant ${sourceTenantId} not found`);
    }

    // 2. Email must be free.
    const [emailTaken] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.email, email));
    if (emailTaken) {
      throw new Error(`forkTenant: email ${email} is already in use`);
    }

    // 3. Create the new tenant shell (fresh identity — we copy NONE of the
    //    source's unique fields like replitUserId / stripe ids / tokens).
    const [newTenant] = await tx
      .insert(tenants)
      .values({
        email,
        name,
        plan: input.plan || source.plan || "trial",
        passwordHash: input.passwordHash ?? null,
        isActive: true,
        forkedFrom: sourceTenantId,
      })
      .returning({ id: tenants.id });
    const newTenantId = newTenant.id;

    // 4. Copy each vetted config table.
    const copied: Record<string, number> = {};
    for (const entry of FORKABLE_CONFIG_TABLES) {
      const rows: any[] = await tx
        .select()
        .from(entry.table)
        .where(eq(entry.table.tenantId, sourceTenantId));

      if (rows.length === 0) {
        copied[entry.name] = 0;
        continue;
      }

      if (entry.selfRefField) {
        // Two-pass copy for intra-table FK (e.g. heartbeat parentTaskId).
        const idMap = new Map<number, number>();
        const reparent: Array<{ newId: number; oldParent: number }> = [];
        for (const r of rows) {
          const row: any = { ...r };
          const oldId = row.id;
          const oldParent = row[entry.selfRefField];
          delete row.id;
          row.tenantId = newTenantId;
          row[entry.selfRefField] = null;
          if (entry.reset) entry.reset(row);
          const [ins] = await tx
            .insert(entry.table)
            .values(row)
            .returning({ id: entry.table.id });
          idMap.set(oldId, ins.id);
          if (oldParent != null) reparent.push({ newId: ins.id, oldParent });
        }
        for (const p of reparent) {
          const mapped = idMap.get(p.oldParent);
          if (mapped != null) {
            await tx
              .update(entry.table)
              .set({ [entry.selfRefField]: mapped })
              .where(eq(entry.table.id, p.newId));
          }
        }
        copied[entry.name] = rows.length;
      } else {
        const prepared = rows.map((r: any) => {
          const row: any = { ...r };
          if (entry.hasSerialId) delete row.id;
          row.tenantId = newTenantId;
          if (entry.reset) entry.reset(row);
          return row;
        });
        await tx.insert(entry.table).values(prepared);
        copied[entry.name] = prepared.length;
      }
    }

    const totalRows = Object.values(copied).reduce((a, b) => a + b, 0);
    return { newTenantId, sourceTenantId, copied, totalRows };
  });
}
