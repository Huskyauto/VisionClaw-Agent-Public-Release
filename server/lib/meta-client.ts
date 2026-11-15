import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { currentTenantId } from "./tenant-context";
import {
  META_BASE_URL, META_MODEL_ID, META_CONTRIBUTOR_MODEL_ID,
  metaReady, metaRequest, metaUsageCost, metaModel,
} from "./meta";

interface BudgetDeps {
  reserve: (args: { tenantId: number; attemptKey: string; maximumCostCents: number }) =>
    Promise<{ id: number; attemptKey: string }>;
  settle: (args: { tenantId: number; reservationId: number; attemptKey: string; actualCostCents: number }) => Promise<unknown>;
}

class MetaOutputBudgetError extends Error {
  constructor() {
    super("Meta output budget exhausted before an answer; no automatic replay");
    this.name = "MetaOutputBudgetError";
  }
}

/** Request-local facade: no raw HTTP escape hatch or caller-overridden URL/key/retry. */
export function createMetaClient(
  tenantId: number,
  track: (create: (...args: any[]) => Promise<any>) => (...args: any[]) => Promise<any>,
  healthy: () => boolean,
  onFailure: (error: unknown) => void,
  injected?: { create: (...args: any[]) => Promise<any>; budget: BudgetDeps },
  modelId = META_MODEL_ID,
): OpenAI {
  const model = metaModel(modelId);
  const check = () => {
    if (!model || tenantId !== 1 || currentTenantId() !== 1 || !metaReady() || !healthy() ||
        (model.id === META_CONTRIBUTOR_MODEL_ID && process.env.META_CONTRIBUTOR_APPROVED !== "1")) {
      throw new Error("Meta requires the owner context and an enabled healthy provider");
    }
  };
  check();
  const sdk = injected ? undefined : new OpenAI({
    apiKey: process.env.META_API_KEY!.trim(), baseURL: META_BASE_URL,
    maxRetries: 0, timeout: 60_000,
  });
  const create = track(injected?.create ?? sdk!.chat.completions.create.bind(sdk!.chat.completions));
  let uncertain = false;
  return { chat: { completions: { create: async (params: any, options: any = {}) => {
    check();
    if (uncertain) throw new Error("Meta previous dispatch is uncertain; automatic replay forbidden");
    const { payload, maximumUsd } = metaRequest(params, modelId);
    const module = injected ? undefined : await import("../agentic/aggregate-ai-spend-budget");
    const budget: BudgetDeps = injected?.budget ?? {
      reserve: module!.reserveAggregateAiSpend, settle: module!.settleAggregateAiSpend,
    };
    const held = await budget.reserve({
      tenantId, attemptKey: `meta:${randomUUID()}`, maximumCostCents: Math.ceil(maximumUsd * 100),
    });
    const settle = async (usage: any) => {
      const cost = metaUsageCost(usage, modelId);
      if (cost === undefined) throw new Error("Meta usage missing; spend reservation retained");
      try {
        await budget.settle({ tenantId, reservationId: held.id, attemptKey: held.attemptKey,
          actualCostCents: Math.ceil(cost * 100) });
      } catch {
        console.warn("[meta] Settlement failed; conservative spend reservation retained");
      }
    };
    check();
    options.signal?.throwIfAborted();
    try {
      const result = await create(payload, { signal: options.signal, maxRetries: 0, timeout: 60_000 });
      if (!result?.[Symbol.asyncIterator]) {
        await settle(result?.usage);
        const message = result?.choices?.[0]?.message;
        if (result?.model === model!.upstream &&
            !(message?.content || message?.tool_calls?.length || message?.refusal) &&
            result?.choices?.[0]?.finish_reason === "length") {
          throw new MetaOutputBudgetError();
        }
        if (result?.model !== model!.upstream ||
            !(message?.content || message?.tool_calls?.length || message?.refusal)) {
          throw new Error("Meta returned an empty or mismatched completion");
        }
        return result;
      }
      let consumed = false;
      return new Proxy(result, { get(target, property) {
        if (property === Symbol.asyncIterator) return async function* () {
          if (consumed) throw new Error("Meta stream cannot be consumed twice");
          consumed = true;
          let complete = false;
          let visible = false;
          let outputLimited = false;
          let budgetExhausted = false;
          let usage: any;
          try {
            for await (const chunk of target) {
              if (chunk.model && chunk.model !== model!.upstream) throw new Error("Meta stream model mismatch");
              if (chunk.usage) usage = chunk.usage;
              outputLimited ||= !!chunk.choices?.some((choice: any) => choice.finish_reason === "length");
              visible ||= !!chunk.choices?.some((choice: any) =>
                choice.delta?.content || choice.delta?.tool_calls?.length || choice.delta?.refusal);
              yield chunk;
            }
            await settle(usage);
            if (!visible && outputLimited) {
              budgetExhausted = true;
              throw new MetaOutputBudgetError();
            }
            if (!visible) throw new Error("Meta returned an empty stream");
            complete = true;
          } finally {
            if (!complete) {
              uncertain = true;
              if (!budgetExhausted) onFailure(new Error("Meta stream ended without verified completion"));
            }
          }
        };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    } catch (error) {
      if (error instanceof MetaOutputBudgetError) {
        uncertain = true;
        throw error;
      }
      const status = (error as any)?.status;
      const definite = Number.isInteger(status) && status >= 400 && status < 500 &&
        ![401, 403, 408, 429].includes(status);
      if (!definite) { uncertain = true; onFailure(error); }
      throw error;
    }
  } } } } as unknown as OpenAI;
}

export { META_MODEL_ID };
