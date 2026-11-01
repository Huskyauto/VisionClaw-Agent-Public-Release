// Verified against the authenticated catalog and published upper-bound pricing
// on 2026-10-25. Deliberately fixed identities, never "recommended" aliases.
export const MAMMOUTH_BASE_URL = "https://api.mammouth.ai/v1";
export const MAMMOUTH_MODELS = [
  { id: "mammouth/glm-5.3-flash", upstream: "glm-5.3-flash", label: "GLM 5.3 Flash (Mammouth)",
    tier: "fast", inputPerMillion: 0.15, outputPerMillion: 0.5 },
  { id: "mammouth/mistral-large-4", upstream: "mistral-large-4", label: "Mistral Large 4 (Mammouth)",
    tier: "powerful", inputPerMillion: 1.36, outputPerMillion: 4.18 },
] as const;

export function mammouthModel(id: string) {
  return MAMMOUTH_MODELS.find(model => model.id === id);
}
