/**
 * DFY intake store — CRUD for the $1,997 Done-For-You customer questionnaire.
 *
 * The public form is authorized by the unguessable 48-hex token alone (same
 * pattern as review tokens). Answers are validated against the shared field
 * catalog (shared/dfy-intake-fields.ts) — unknown keys are dropped, values
 * capped — and stored as flat jsonb. Submitted answers become authoritative
 * customer-stated facts for the fix-kit generator.
 */

import crypto from "crypto";
import { db } from "./db";
import { dfyIntakeForms, type DfyIntakeForm } from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  DFY_INTAKE_FIELD_KEYS,
  DFY_INTAKE_REQUIRED_KEYS,
  DFY_INTAKE_MAX_ANSWER_CHARS,
  DFY_INTAKE_LABELS,
} from "@shared/dfy-intake-fields";

const TOKEN_BYTES = 24; // 48 hex chars

export async function createDfyIntakeForm(params: {
  tenantId: number;
  company: string;
  website: string;
  customerName?: string | null;
  customerEmail?: string | null;
  orderId?: string | null;
}): Promise<DfyIntakeForm> {
  const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const [row] = await db
    .insert(dfyIntakeForms)
    .values({
      tenantId: params.tenantId,
      token,
      company: params.company.slice(0, 200),
      website: params.website.slice(0, 500),
      customerName: params.customerName?.slice(0, 200) || null,
      customerEmail: params.customerEmail?.slice(0, 320) || null,
      orderId: params.orderId?.slice(0, 200) || null,
      status: "sent",
      responses: {},
    })
    .returning();
  return row;
}

export async function getDfyIntakeByToken(token: string): Promise<DfyIntakeForm | null> {
  if (!/^[a-f0-9]{48}$/i.test(token)) return null;
  const [row] = await db.select().from(dfyIntakeForms).where(eq(dfyIntakeForms.token, token)).limit(1);
  return row || null;
}

export async function listDfyIntakeForms(tenantId: number, limit = 50): Promise<DfyIntakeForm[]> {
  return db
    .select()
    .from(dfyIntakeForms)
    .where(eq(dfyIntakeForms.tenantId, tenantId))
    .orderBy(desc(dfyIntakeForms.createdAt))
    .limit(limit);
}

export async function getDfyIntakeById(tenantId: number, id: number): Promise<DfyIntakeForm | null> {
  const [row] = await db
    .select()
    .from(dfyIntakeForms)
    .where(and(eq(dfyIntakeForms.tenantId, tenantId), eq(dfyIntakeForms.id, id)))
    .limit(1);
  return row || null;
}

/** Validate + persist a customer submission. Returns the missing required keys (empty = accepted). */
export async function submitDfyIntake(
  token: string,
  rawResponses: unknown,
): Promise<{ ok: boolean; missing: string[]; form?: DfyIntakeForm }> {
  const form = await getDfyIntakeByToken(token);
  if (!form) return { ok: false, missing: [] };
  const src = rawResponses && typeof rawResponses === "object" && !Array.isArray(rawResponses)
    ? (rawResponses as Record<string, unknown>)
    : {};
  const clean: Record<string, string> = {};
  for (const key of DFY_INTAKE_FIELD_KEYS) {
    const v = src[key];
    if (typeof v !== "string") continue;
    const trimmed = v.trim().slice(0, DFY_INTAKE_MAX_ANSWER_CHARS);
    if (trimmed) clean[key] = trimmed;
  }
  const missing = DFY_INTAKE_REQUIRED_KEYS.filter((k) => !clean[k]);
  if (missing.length > 0) return { ok: false, missing, form };
  const [updated] = await db
    .update(dfyIntakeForms)
    .set({ responses: clean, status: "submitted", submittedAt: new Date() })
    .where(eq(dfyIntakeForms.id, form.id))
    .returning();
  return { ok: true, missing: [], form: updated };
}

function normalizeDomain(website: string): string {
  try {
    return new URL(website.startsWith("http") ? website : `https://${website}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    const heuristic = website.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    console.warn(`[dfy-intake] DEGRADED: could not parse website "${website.slice(0, 120)}" as a URL — using heuristic domain "${heuristic}" for intake matching (auto-attach may miss).`);
    return heuristic;
  }
}

/**
 * Find the most recent SUBMITTED intake matching a website (domain match) or
 * customer email — used to automatically attach customer facts to a fix-kit
 * run even when the admin doesn't pick a form explicitly.
 */
export async function findSubmittedDfyIntake(params: {
  tenantId: number;
  website?: string | null;
  customerEmail?: string | null;
}): Promise<DfyIntakeForm | null> {
  const rows = await db
    .select()
    .from(dfyIntakeForms)
    .where(and(eq(dfyIntakeForms.tenantId, params.tenantId), eq(dfyIntakeForms.status, "submitted")))
    .orderBy(desc(sql`coalesce(${dfyIntakeForms.submittedAt}, ${dfyIntakeForms.createdAt})`))
    .limit(100);
  const wantDomain = params.website ? normalizeDomain(params.website) : null;
  const wantEmail = params.customerEmail?.trim().toLowerCase() || null;
  for (const row of rows) {
    if (wantDomain && normalizeDomain(row.website) === wantDomain) return row;
    if (wantEmail && (row.customerEmail || "").toLowerCase() === wantEmail) return row;
  }
  return null;
}

/** Flatten submitted responses into labeled facts for LLM grounding. */
export function intakeFactsFromForm(form: DfyIntakeForm): Record<string, string> {
  const out: Record<string, string> = {};
  const responses = (form.responses || {}) as Record<string, unknown>;
  for (const key of DFY_INTAKE_FIELD_KEYS) {
    const v = responses[key];
    if (typeof v === "string" && v.trim()) out[DFY_INTAKE_LABELS[key] || key] = v.trim();
  }
  return out;
}
