export const GLM_LAYOUT_REVIEW_PATH = "/api/admin/audit/layout-review";
export const GLM_LAYOUT_CONSENT = "public-or-synthetic-v1";
export const GLM_LAYOUT_IMAGE_BYTES = 360 * 1024;
export const GLM_LAYOUT_CSS_CHARS = 3_000;

export type GlmLayoutAdvice = {
  diagnosis: string;
  suggestion: string;
  verification: string;
};

export type GlmLayoutReply = {
  model: "glm-5.4" | "coding-glm-5.4";
  advice: GlmLayoutAdvice;
};
