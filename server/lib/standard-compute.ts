/** Closed owner-jury transport. Never expose the opaque smart-routing alias. */
const MODELS: Readonly<Record<string, string>> = {
  "gemini-3.1-pro-preview": "google/gemini-3.1-pro-preview",
};

export function standardComputeModelId(modelId: string): string | undefined {
  return Object.hasOwn(MODELS, modelId) ? MODELS[modelId] : undefined;
}

export function standardComputeReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STANDARD_COMPUTE_ENABLED === "1" && !!env.STANDARD_COMPUTE_API_KEY?.trim();
}

export function assertStandardComputeAccess(tenantId: number | undefined, modelId: string, env: NodeJS.ProcessEnv = process.env): void {
  if (tenantId !== 1 || !standardComputeReady(env) || !standardComputeModelId(modelId)) {
    throw new Error("Standard Compute requires enabled owner-only pinned jury access");
  }
}

export class StandardComputeCompletionError extends Error {
  readonly tokensIn: number | undefined;
  readonly tokensOut: number | undefined;
  readonly reportedModel: string | undefined;
  readonly usagePersisted: boolean;
  constructor(response: any) {
    super("Standard Compute returned an incomplete or mismatched pinned verdict");
    const tokenCount = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
    this.tokensIn = tokenCount(response?.usage?.prompt_tokens);
    this.tokensOut = tokenCount(response?.usage?.completion_tokens);
    this.reportedModel = typeof response?.model === "string" && /^[a-zA-Z0-9._/-]{1,100}$/.test(response.model)
      ? response.model : undefined;
    this.usagePersisted = response?.[Symbol.for("visionclaw.cost-ledger-recorded")] === true;
  }
}

export function validateStandardComputeCompletion(response: any, expectedModel: string): void {
  const choices = response?.choices;
  if (response?.model !== expectedModel || !Array.isArray(choices) || choices.length !== 1 ||
      choices[0]?.finish_reason !== "stop" || typeof choices[0]?.message?.content !== "string" ||
      !choices[0].message.content.trim()) {
    throw new StandardComputeCompletionError(response);
  }
}
