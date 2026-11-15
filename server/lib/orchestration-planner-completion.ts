import { metaHelperTokenLimit, metaModel } from "./meta";

type Resolver = (model: string, tenantId: number) =>
  Promise<{ client: any; actualModelId: string }>;

/** Bounded planner-only recovery. Candidate aliases never replay the same model. */
export async function completeOrchestrationPlan(
  prompt: string, model: string, tenantId: number, resolve: Resolver,
): Promise<any> {
  const attempted = new Set<string>();
  let lastError: unknown;
  const candidates = [...new Set([
    model, "gpt-5.6-sol", "gpt-5.4", "google/gemini-3.7-flash", "gpt-5", "claude-sonnet-4-5",
  ])];
  for (const candidate of candidates) {
    let actualModel: string | undefined;
    try {
      const resolved = await resolve(candidate, tenantId);
      actualModel = resolved.actualModelId;
      if (attempted.has(actualModel)) continue;
      attempted.add(actualModel);
      const params = {
        model: actualModel,
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: metaHelperTokenLimit(actualModel, 1000),
        ...(/claude-opus-4-[78]/.test(actualModel) ? {} : { temperature: 0.3 }),
      };
      const response = await resolved.client.chat.completions.create(params);
      if (!response?.choices?.[0]?.message?.content?.trim()) {
        throw new Error("Planner returned no visible plan");
      }
      return response;
    } catch (error) {
      lastError = error;
      console.warn(`[ceo-orchestrator] Planner candidate ${candidate} failed: ${(error as Error).message?.slice(0, 120)}`);
      // Even settled reasoning exhaustion is not permission to replay a Meta
      // request. Aliases and provider substitution cannot bypass that policy.
      if (actualModel && metaModel(actualModel) && attempted.has(actualModel)) throw error;
    }
  }
  throw new Error(`Orchestration planning failed — permitted routes exhausted: ${(lastError as Error)?.message ?? "no distinct route"}`);
}
