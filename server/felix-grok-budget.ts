import type OpenAI from "openai";
import { sql } from "drizzle-orm";
import { db } from "./db";

export const FELIX_GROK_CLAIM_LABEL = "felix-grok-4.7-fallback";
const LEDGER_TOOL = "llm.xai.felix-fallback";
const MAX_OUTPUT_TOKENS = 8_192;
// At most 500K prompt tokens at $4/M plus 8192 output at $12/M:
// $2.098304. Reserve a little extra for provider usage overhead.
const MAX_CALL_USD = 2.25;
const RECORDED = Symbol.for("visionclaw.cost-ledger-recorded");

function dailyCeiling(): number {
  const raw = process.env.FELIX_GROK_DAILY_CEILING_USD ?? "20";
  const cap = Number(raw);
  if (!Number.isFinite(cap) || cap < MAX_CALL_USD) {
    throw new Error("[felix-grok] daily spending ceiling must be at least $2.25");
  }
  return cap;
}

/** Durable, owner-scoped claim before each paid API request. DB failure fails closed. */
export async function reserveFelixGrokCall(tenantId: number): Promise<number> {
  const cap = dailyCeiling();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('felix-grok-fallback'), ${tenantId})`);
    await tx.execute(sql`
      DELETE FROM autonomous_budget_claims
      WHERE tenant_id = ${tenantId} AND label = ${FELIX_GROK_CLAIM_LABEL}
        AND created_at < (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    `);
    const response: any = await tx.execute(sql`
      SELECT
        COALESCE((SELECT SUM(cost_usd::numeric) FROM agent_cost_ledger
          WHERE tenant_id = ${tenantId} AND tool_name = ${LEDGER_TOOL}
            AND created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')), 0)::float AS spent,
        COALESCE((SELECT SUM(estimated_usd) FROM autonomous_budget_claims
          WHERE tenant_id = ${tenantId} AND label = ${FELIX_GROK_CLAIM_LABEL}), 0)::float AS reserved
    `);
    const { spent, reserved } = (response.rows || response)[0];
    if (Number(spent) + Number(reserved) + MAX_CALL_USD > cap) {
      throw new Error("[felix-grok] daily spending ceiling reached");
    }
    const inserted: any = await tx.execute(sql`
      INSERT INTO autonomous_budget_claims (tenant_id, label, estimated_usd, created_at)
      VALUES (${tenantId}, ${FELIX_GROK_CLAIM_LABEL}, ${MAX_CALL_USD}, now()) RETURNING id
    `);
    const claimId = Number((inserted.rows || inserted)[0]?.id);
    if (!Number.isSafeInteger(claimId) || claimId <= 0) {
      throw new Error("[felix-grok] budget reservation was not persisted");
    }
    return claimId;
  });
}

/** Only clear the reservation after the provider's actual usage was persisted. */
export async function settleFelixGrokCall(tenantId: number, claimId: number): Promise<void> {
  await db.execute(sql`
    DELETE FROM autonomous_budget_claims
    WHERE tenant_id = ${tenantId} AND label = ${FELIX_GROK_CLAIM_LABEL} AND id = ${claimId}
  `);
}

/** Process-local wrapper; does not mutate a cached SDK client used by other callers. */
export function wrapFelixGrokBudget(
  client: OpenAI,
  tenantId: number,
  deps: {
    reserve?: (tenantId: number) => Promise<number>;
    settle?: (tenantId: number, claimId: number) => Promise<void>;
  } = {},
): OpenAI {
  const reserve = deps.reserve ?? reserveFelixGrokCall;
  const settle = deps.settle ?? settleFelixGrokCall;
  const wrapped = Object.create(client);
  const chat = Object.create(client.chat);
  const completions = Object.create(client.chat.completions);
  const create = client.chat.completions.create.bind(client.chat.completions);
  completions.create = async (params: any, options?: any) => {
    if (params?.model !== "grok-4.7" || params?.stream === true) {
      throw new Error("[felix-grok] only non-streaming Grok 4.7 requests are authorized");
    }
    const claimId = await reserve(tenantId);
    const maxTokens = Number(params.max_completion_tokens ?? params.max_tokens);
    const bounded = { ...params, max_completion_tokens:
      Number.isFinite(maxTokens) && maxTokens > 0
        ? Math.min(Math.floor(maxTokens), MAX_OUTPUT_TOKENS) : MAX_OUTPUT_TOKENS };
    delete bounded.max_tokens;
    const result: any = await create(bounded, options);
    if (result?.[RECORDED] !== true) {
      throw new Error("[felix-grok] paid response lacked a persisted usage record");
    }
    try {
      await settle(tenantId, claimId);
    } catch (error) {
      console.error("[felix-grok] ledger recorded but reservation settlement failed", error);
    }
    // On uncertain completion or ledger failure, keep the durable reservation
    // for the UTC day; never assume a thrown network request was free.
    return result;
  };
  chat.completions = completions;
  wrapped.chat = chat;
  return wrapped as OpenAI;
}