/**
 * R74.11 — Cost-aware image quality decider.
 *
 * Bob's direction: "the agent or the platform would decide what quality is
 * needed for that purpose of whatever project we're working on. Cost savings
 * for whatever the project / product we're delivering."
 *
 * This is a rule-based scorer (not an LLM call — that would defeat the cost
 * goal) that picks between the two cascade tiers in
 * `server/replit_integrations/image/client.ts`:
 *   - "high" → gpt-image-2 → Gemini → DALL-E 3 (premium first, ~5-10x cost
 *     of "fast" per image but wins on text-in-image, product shots, brand
 *     consistency, and customer-facing deliverables).
 *   - "fast" → Gemini 2.5 Flash Image → gpt-image-2 → DALL-E 3 (cheap +
 *     fast first, premium fallback only if Gemini fails or rate-limits).
 *
 * Decision philosophy:
 *   1. Customer pays for premium when it's a deliverable they will see
 *      (PDFs, slides, marketing collateral, video scenes shipped to a viewer).
 *   2. We pay for cheap when it's internal (debug previews, bulk thumbnails,
 *      one-off scratch images personas generate while exploring an idea).
 *   3. Bulk batches (>=8 images in one call) downgrade unless explicitly
 *      flagged customer-facing — a 20-thumbnail strip should never burn
 *      $0.20 of gpt-image-2 budget when Gemini gets the same thumbnails
 *      for ~$0.02.
 *   4. Unknown / no signal → "high" (the R74.10 default — safe for quality,
 *      explicit override required to go cheap).
 *
 * Decisions are logged with a reason so you can audit the spend curve later.
 */

export type ImagePurpose =
  // ─── CUSTOMER-FACING (default to "high") ─────────────────────────────────
  | "customer_pdf"          // PDF being shipped to customer / Bob / partner
  | "customer_slide"        // Slide deck deliverable (presentations)
  | "customer_video_scene"  // MPEG video scene (customer-facing video)
  | "marketing"             // Marketing collateral, brand assets, ad creative
  | "social_post"           // Published social media image (X, LinkedIn, etc.)
  | "ad_creative"           // Paid-ad creative — quality compounds via CTR
  | "brand_asset"           // Logo, header, identity image
  | "ecommerce_product"     // Product shot for storefront / catalog
  // ─── INTERNAL / PREVIEW (default to "fast") ──────────────────────────────
  | "thumbnail"             // Small preview thumbnail, video timeline strip
  | "preview"               // Draft / preview render before approval
  | "internal_debug"        // Debug screenshot, internal diagnostic
  | "bulk_batch"            // Batch >=8 images in one workflow
  | "scratch"               // Persona's exploratory / scratchpad image
  | "unknown";              // No signal — defaults to "high" per R74.10

export interface QualityDecisionInput {
  /** Preferred signal: caller explicitly tags the purpose. */
  purpose?: ImagePurpose;
  /** Override: caller forces a specific quality tier. */
  forceQuality?: "fast" | "high";
  /** Auxiliary signals (fallback when purpose is unknown). */
  isCustomerFacing?: boolean;
  estimatedBatchSize?: number;
  hasTextInImage?: boolean;
  /** Caller name for logging only — does not affect decision. */
  callerLabel?: string;
}

export interface QualityDecision {
  quality: "fast" | "high";
  reason: string;
  costTier: "premium" | "economy";
  /** True when caller forced the tier via `forceQuality`. */
  wasForced: boolean;
}

/** Purposes that always default to premium (high). */
const HIGH_PURPOSES = new Set<ImagePurpose>([
  "customer_pdf",
  "customer_slide",
  "customer_video_scene",
  "marketing",
  "social_post",
  "ad_creative",
  "brand_asset",
  "ecommerce_product",
]);

/** Purposes that always default to economy (fast). */
const FAST_PURPOSES = new Set<ImagePurpose>([
  "thumbnail",
  "preview",
  "internal_debug",
  "bulk_batch",
  "scratch",
]);

/** Bulk threshold above which non-customer-facing batches downgrade to fast. */
const BULK_DOWNGRADE_THRESHOLD = 8;

/**
 * Decide which cascade tier to use for an image generation call.
 *
 * Pure function — no I/O, no LLM call. Cheap to invoke per image.
 */
export function decideImageQuality(input: QualityDecisionInput = {}): QualityDecision {
  // Hard override always wins.
  if (input.forceQuality) {
    return {
      quality: input.forceQuality,
      reason: `caller forced quality=${input.forceQuality}`,
      costTier: input.forceQuality === "high" ? "premium" : "economy",
      wasForced: true,
    };
  }

  const purpose = input.purpose ?? "unknown";

  // 1. Explicit purpose-based decision.
  if (HIGH_PURPOSES.has(purpose)) {
    // Customer-facing batches still get premium even if large — Bob's rule:
    // "if we have to go with the high price model then we need to."
    return {
      quality: "high",
      reason: `purpose=${purpose} is customer-facing — premium tier`,
      costTier: "premium",
      wasForced: false,
    };
  }
  if (FAST_PURPOSES.has(purpose)) {
    return {
      quality: "fast",
      reason: `purpose=${purpose} is internal/preview — economy tier`,
      costTier: "economy",
      wasForced: false,
    };
  }

  // 2. Unknown purpose — fall back on auxiliary signals.

  // Bulk batches without customer-facing flag → economy (cost protection).
  if (
    typeof input.estimatedBatchSize === "number" &&
    input.estimatedBatchSize >= BULK_DOWNGRADE_THRESHOLD &&
    !input.isCustomerFacing
  ) {
    return {
      quality: "fast",
      reason: `bulk batch of ${input.estimatedBatchSize} images, not flagged customer-facing — economy to protect spend`,
      costTier: "economy",
      wasForced: false,
    };
  }

  // Text-in-image is a known gpt-image-2 win → premium.
  if (input.hasTextInImage) {
    return {
      quality: "high",
      reason: "text-in-image requested — gpt-image-2 wins this workload",
      costTier: "premium",
      wasForced: false,
    };
  }

  // Customer-facing without batch → premium.
  if (input.isCustomerFacing) {
    return {
      quality: "high",
      reason: "customer-facing flag set — premium tier",
      costTier: "premium",
      wasForced: false,
    };
  }

  // 3. No signal at all → fall back on R74.10 default (high).
  return {
    quality: "high",
    reason: "no purpose / signals provided — R74.10 default (high)",
    costTier: "premium",
    wasForced: false,
  };
}

/**
 * Lightweight one-line log helper so we can audit decisions in production.
 * Format: `[image-decider] purpose=X quality=Y cost=Z reason="..."`
 */
export function logQualityDecision(decision: QualityDecision, input: QualityDecisionInput = {}): void {
  const purpose = input.purpose ?? "unknown";
  const caller = input.callerLabel ? ` caller=${input.callerLabel}` : "";
  console.log(
    `[image-decider]${caller} purpose=${purpose} -> quality=${decision.quality} cost=${decision.costTier} reason="${decision.reason}"`,
  );
}
