import type OpenAI from "openai";
import { AsyncLocalStorage } from "node:async_hooks";
import { ownerTenantId } from "./agentic/autonomous-budget";
import { getFelixExpertLanes } from "./felix-model-policy";
import type { FelixExpertLane } from "./felix-model-policy";

const expertGrant = new AsyncLocalStorage<{ tenantId: number; personaId: number; source: string }>();

/** Bind the paid provider permission to the trusted conversation context, not a caller flag. */
export async function withFelixExpertGrant<T>(
  context: { tenantId: number; personaId: number | null; source?: string },
  action: () => Promise<T>,
): Promise<T> {
  if (!getFelixExpertLanes({ ...context, ownerTenantId: ownerTenantId() })) {
    throw new FelixExpertUnavailableError();
  }
  return expertGrant.run({
    tenantId: context.tenantId, personaId: context.personaId!, source: context.source!,
  }, action);
}

export function hasFelixExpertGrant(tenantId: number): boolean {
  const grant = expertGrant.getStore();
  return !!grant && grant.tenantId === tenantId &&
    tenantId === ownerTenantId() && grant.personaId === 2 &&
    (grant.source === "api-v1" || grant.source === "a2a");
}

export class FelixExpertUnavailableError extends Error {
  readonly code = "expert_provider_unavailable";
  constructor() {
    super("No authorized expert model is available for this agent-to-agent turn");
    this.name = "FelixExpertUnavailableError";
  }
}

export class FelixExpertContextLimitError extends Error {
  readonly code = "expert_context_limit";
  constructor() {
    super("The agent-to-agent context exceeds the available expert providers' limits");
    this.name = "FelixExpertContextLimitError";
  }
}

export class FelixExpertUncertainError extends Error {
  readonly code = "expert_provider_uncertain";
  constructor() {
    super("The expert provider chain ended without a confirmed response");
    this.name = "FelixExpertUncertainError";
  }
}

export class FelixExpertRejectedError extends Error {
  readonly code = "expert_provider_rejected";
  constructor() {
    super("Every attempted expert provider returned a settled rejection");
    this.name = "FelixExpertRejectedError";
  }
}

export class FelixExpertContextRejectedError extends Error {
  readonly code = "expert_context_rejected";
  constructor() {
    super("Every attempted expert provider rejected the available context");
    this.name = "FelixExpertContextRejectedError";
  }
}

export type FelixExpertFailureReason =
  | "expert_provider_unavailable"
  | "expert_context_limit"
  | "expert_provider_uncertain"
  | "expert_provider_rejected"
  | "expert_context_rejected";

const FELIX_EXPERT_FAILURE_REASONS = new Set<FelixExpertFailureReason>([
  "expert_provider_unavailable",
  "expert_context_limit",
  "expert_provider_uncertain",
  "expert_provider_rejected",
  "expert_context_rejected",
]);

/** Allowlist error codes for durable turn history; never persist provider messages or bodies. */
export function getFelixExpertFailureReason(error: unknown): FelixExpertFailureReason | undefined {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return undefined;
  if (error instanceof FelixExpertRejectedError) return error.code;
  if (error instanceof FelixExpertContextRejectedError) return error.code;
  const code = (error as { code?: unknown }).code;
  if (code === "expert_provider_rejected" || code === "expert_context_rejected") return undefined;
  return typeof code === "string" && FELIX_EXPERT_FAILURE_REASONS.has(code as FelixExpertFailureReason)
    ? code as FelixExpertFailureReason
    : undefined;
}

type FelixExpertAttemptOutcome = "uncertain" | "provider_rejected" | "context_rejected";

function errorObject(error: unknown): {
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown };
  code?: unknown;
  name?: unknown;
  cause?: unknown;
} | undefined {
  return error && (typeof error === "object" || typeof error === "function")
    ? error as {
        status?: unknown;
        statusCode?: unknown;
        response?: { status?: unknown };
        code?: unknown;
        name?: unknown;
        cause?: unknown;
      }
    : undefined;
}

function errorStatus(value: unknown): number | undefined {
  return typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : undefined;
}

/** Shared, payload-free check for ambiguous HTTP/SDK transport failures. */
export function isFelixExpertTransportAmbiguous(error: unknown): boolean {
  const err = errorObject(error);
  const statuses = [err?.status, err?.statusCode, err?.response?.status].map(errorStatus);
  if (statuses.some(status => [408, 502, 504, 524, 598, 599].includes(status ?? -1))) return true;

  const cause = err?.cause && (typeof err.cause === "object" || typeof err.cause === "function")
    ? err.cause as { code?: unknown; name?: unknown }
    : undefined;
  return [err?.code, err?.name, cause?.code, cause?.name]
    .some(value => typeof value === "string" &&
      /timeout|timedout|abort|connection|network|socket|econn|ehost|enet|eai_again/i.test(value));
}

function classifyFelixExpertAttempt(error: unknown, contextRejected: boolean): FelixExpertAttemptOutcome {
  const err = errorObject(error);
  const status = errorStatus(err?.status ?? err?.statusCode ?? err?.response?.status);

  // Gateway/request timeouts and explicit socket/transport errors leave completion ambiguous.
  if (isFelixExpertTransportAmbiguous(error)) return "uncertain";
  if (contextRejected && [400, 413, 422].includes(status ?? -1)) return "context_rejected";
  // Client-side provider rejections and the known settled 503 service response
  // do not imply an unobserved completion. Other 5xx responses are ambiguous.
  if (
    Number.isInteger(status) &&
    ((status! >= 400 && status! <= 499) || status === 503)
  ) return "provider_rejected";
  return "uncertain";
}

/** Holds only classification outcomes, never raw provider errors or response payloads. */
export class FelixExpertFailureHistory {
  private readonly outcomes = new Set<FelixExpertAttemptOutcome>();

  record(error: unknown, contextRejected = false): void {
    this.outcomes.add(classifyFelixExpertAttempt(error, contextRejected));
  }

  toExhaustedError(): Error | undefined {
    if (this.outcomes.size === 0) return undefined;
    if (this.outcomes.has("uncertain")) return new FelixExpertUncertainError();
    if (this.outcomes.has("provider_rejected")) return new FelixExpertRejectedError();
    return new FelixExpertContextRejectedError();
  }
}

/** Pin the expert providers in order; never accept a cost-policy model substitution. */
export async function resolveFelixExpertLane(
  lanes: readonly FelixExpertLane[],
  startIndex: number,
  resolve: (lane: FelixExpertLane) => Promise<{ client: OpenAI; actualModelId: string }>,
): Promise<{ client: OpenAI; modelId: string; registryModelId: string; index: number }> {
  for (let index = startIndex; index < lanes.length; index++) {
    const lane = lanes[index];
    try {
      const routed = await resolve(lane);
      if (routed.actualModelId !== lane.actualModelId) {
        console.warn(`[felix-expert] ${lane.providerLane} substituted ${routed.actualModelId}; rejecting`);
        continue;
      }
      console.info(`[felix-expert] using ${lane.providerLane}/${lane.modelId}`);
      return { client: routed.client, modelId: routed.actualModelId, registryModelId: lane.modelId, index };
    } catch {
      console.warn(`[felix-expert] ${lane.providerLane} unavailable before completion`);
    }
  }
  throw new FelixExpertUnavailableError();
}