// Felix Proposal Verification Rail (R74.13x, 2026-04-28)
//
// Inspired by mythos-router's Strict Write Discipline: every Felix proposal
// must declare an EXPECTED POST-STATE — a small, machine-verifiable spec
// that says "after this proposal executes, the world will look like X."
//
// At execution time we capture pre-state, fire the action (live mode only),
// capture post-state, and verify that the actual delta matches the claim.
// Mismatch = automatic retry (1 attempt) → then yield to Bob with a
// 'verification_failed' status.
//
// Security: the spec comes from the LLM (felix-loop.ts). We treat it as
// untrusted input. Tables are whitelisted per kind; column names and values
// flow through parameterized queries — never sql.raw on LLM output.
//
// Bob preference: never sql.raw user input (LLM output qualifies).

import { db } from "./db";
import { sql } from "drizzle-orm";

// Tables that a verifier is allowed to inspect, keyed by proposal kind.
// Each entry pins the exact table and the columns the spec is allowed
// to filter on. Anything not in this allowlist is rejected at validation
// time, before a single SQL byte is constructed.
const VERIFIER_REGISTRY: Record<
  string,
  {
    table: string;
    description: string;
    filterable: string[]; // columns the spec may filter on
    contentColumns: string[]; // columns that may be substring-checked
    requiresTenantId: boolean; // true for every table that has tenant_id
  }
> = {
  send_message_to_bob: {
    table: "notifications",
    description: "Felix surfaces a notification for Bob to see",
    filterable: ["type", "category"],
    contentColumns: ["title", "message"],
    requiresTenantId: true,
  },
  delegate_to_specialist: {
    table: "delegation_scratchpad",
    description: "Felix opens a delegation chain to a specialist persona",
    filterable: ["agent_name", "chain_key"],
    contentColumns: ["value"],
    requiresTenantId: true,
  },
  promote_skill_candidate: {
    table: "agent_knowledge",
    description: "Felix graduates a skill candidate into a real skill entry",
    filterable: ["category", "source"],
    contentColumns: ["title", "content"],
    requiresTenantId: true,
  },
  draft_proactive_action: {
    table: "proactive_actions",
    description: "Felix schedules a proactive action",
    filterable: ["persona_id", "outcome"],
    contentColumns: ["trigger_condition", "action_taken"],
    requiresTenantId: true,
  },
  research_topic: {
    table: "research_sessions",
    description: "Felix kicks off a research session",
    filterable: ["status", "program_id"],
    contentColumns: ["summary"],
    requiresTenantId: true,
  },
  // review_project does not get a verifier in v1 — it would require a
  // join through projects(id, name, tenant_id) to project_notes which
  // doesn't carry tenant_id. We allow these proposals through with no
  // post_state and verify them by hand for now.
};

export interface PostStateSpec {
  // Kind that owns this spec — used to look up the allowed table.
  // Must match the parent proposal's kind (validated by caller).
  kind: string;
  // Optional column=value filters. Keys must be in registry.filterable.
  // Values are scalar (string / number / boolean) — anything else is rejected.
  filter?: Record<string, string | number | boolean>;
  // Optional substring check on a content column. Both column and substring
  // are validated; substring is bound through ILIKE %$%.
  content_substring?: { column: string; substring: string };
  // Expected delta in row count after execution. Bounded [0, 100].
  // 0 means "the row that proves this happened was already present" — rare
  // but legal for idempotent operations.
  expected_count_delta: number;
}

export interface SpecValidation {
  ok: boolean;
  errors: string[];
  resolvedTable?: string;
}

export function validatePostStateSpec(kind: string, spec: any): SpecValidation {
  const errors: string[] = [];
  const entry = VERIFIER_REGISTRY[kind];
  if (!entry) {
    return {
      ok: false,
      errors: [`kind '${kind}' has no verifier registered (review_project is intentionally unverified in v1)`],
    };
  }
  if (!spec || typeof spec !== "object") {
    return { ok: false, errors: ["spec is required and must be an object"] };
  }
  if (typeof spec.expected_count_delta !== "number" || spec.expected_count_delta < 0 || spec.expected_count_delta > 100) {
    errors.push("expected_count_delta must be a number in [0, 100]");
  }
  if (spec.filter !== undefined) {
    if (typeof spec.filter !== "object" || Array.isArray(spec.filter) || spec.filter === null) {
      errors.push("filter must be an object of column -> scalar value");
    } else {
      for (const k of Object.keys(spec.filter)) {
        if (!entry.filterable.includes(k)) {
          errors.push(`filter column '${k}' is not allowed for kind '${kind}' (allowed: ${entry.filterable.join(", ")})`);
        }
        const v = spec.filter[k];
        const t = typeof v;
        if (t !== "string" && t !== "number" && t !== "boolean") {
          errors.push(`filter['${k}'] must be a scalar (string|number|boolean), got ${t}`);
        }
        if (t === "string" && (v as string).length > 200) {
          errors.push(`filter['${k}'] value too long (max 200 chars)`);
        }
      }
    }
  }
  if (spec.content_substring !== undefined) {
    if (typeof spec.content_substring !== "object" || spec.content_substring === null) {
      errors.push("content_substring must be {column, substring}");
    } else {
      const { column, substring } = spec.content_substring;
      if (!entry.contentColumns.includes(column)) {
        errors.push(`content_substring.column '${column}' not allowed for kind '${kind}' (allowed: ${entry.contentColumns.join(", ")})`);
      }
      if (typeof substring !== "string" || substring.length === 0 || substring.length > 200) {
        errors.push("content_substring.substring must be a non-empty string up to 200 chars");
      }
    }
  }
  return { ok: errors.length === 0, errors, resolvedTable: entry.table };
}

export interface CapturedState {
  table: string;
  count: number;
  capturedAt: string;
  filterApplied: Record<string, any>;
  contentSubstring?: { column: string; substring: string };
}

// Capture the current world-state matching the spec. Always parameterized.
// Always tenant-scoped (when the registry says the table has tenant_id).
// Read-only — no side effects.
//
// R74.13x architect-fix: actually consult requiresTenantId. Today all
// registry entries are true, but if a future entry adds a tenant-less
// table this prevents the query from crashing with "column tenant_id
// does not exist." A tenant-less table without an alternate scoping
// mechanism is REJECTED here defensively — adding such an entry
// requires explicitly choosing a scoping strategy in code review.
export async function captureState(spec: PostStateSpec, tenantId: number): Promise<CapturedState> {
  const v = validatePostStateSpec(spec.kind, spec);
  if (!v.ok || !v.resolvedTable) {
    throw new Error(`Invalid spec for capture: ${v.errors.join("; ")}`);
  }
  const table = v.resolvedTable;
  const entry = VERIFIER_REGISTRY[spec.kind];
  if (!entry.requiresTenantId) {
    throw new Error(
      `Verifier entry for kind '${spec.kind}' has requiresTenantId=false but no alternate scoping is implemented. Refusing to run a cross-tenant query.`
    );
  }

  // Build a fully-parameterized query. We use sql`` template tags which
  // safely bind values; sql.identifier for the table name and column
  // names (both whitelisted in the registry — provably safe).
  const filterEntries = Object.entries(spec.filter || {});
  let whereSql = sql`tenant_id = ${tenantId}`;
  for (const [col, val] of filterEntries) {
    // col is whitelisted in entry.filterable; sql.identifier guards it
    whereSql = sql`${whereSql} AND ${sql.identifier(col)} = ${val as any}`;
  }
  if (spec.content_substring) {
    // column is whitelisted in entry.contentColumns
    const { column, substring } = spec.content_substring;
    whereSql = sql`${whereSql} AND ${sql.identifier(column)} ILIKE ${"%" + substring + "%"}`;
  }
  const tableIdent = sql.identifier(table);
  const r: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM ${tableIdent} WHERE ${whereSql}`);
  const count = r.rows?.[0]?.n ?? 0;

  return {
    table,
    count,
    capturedAt: new Date().toISOString(),
    filterApplied: spec.filter || {},
    contentSubstring: spec.content_substring,
    // entry retained for caller debugging if needed
    ...({ _allowedFilter: entry.filterable } as any),
  };
}

export interface VerificationResult {
  match: boolean;
  expected_delta: number;
  actual_delta: number;
  pre_count: number;
  post_count: number;
  detail: string;
}

export function verifyDelta(pre: CapturedState, post: CapturedState, expectedDelta: number): VerificationResult {
  if (pre.table !== post.table) {
    return {
      match: false,
      expected_delta: expectedDelta,
      actual_delta: 0,
      pre_count: pre.count,
      post_count: post.count,
      detail: `pre/post table mismatch (${pre.table} vs ${post.table})`,
    };
  }
  const actual = post.count - pre.count;
  return {
    match: actual === expectedDelta,
    expected_delta: expectedDelta,
    actual_delta: actual,
    pre_count: pre.count,
    post_count: post.count,
    detail:
      actual === expectedDelta
        ? `Verified: ${pre.table} row count moved by ${actual} as expected`
        : `MISMATCH: ${pre.table} expected delta ${expectedDelta}, actual ${actual} (pre=${pre.count}, post=${post.count})`,
  };
}

// Tells the caller (felix-loop.ts executeFelixProposal) whether a kind
// has a verifier. Used to decide if a missing post_state is a hard error
// or expected (review_project today).
export function hasVerifier(kind: string): boolean {
  return Boolean(VERIFIER_REGISTRY[kind]);
}

export function listVerifiableKinds(): string[] {
  return Object.keys(VERIFIER_REGISTRY);
}

export function describeVerifier(kind: string): string | null {
  const e = VERIFIER_REGISTRY[kind];
  return e ? `${e.table}: ${e.description}` : null;
}
