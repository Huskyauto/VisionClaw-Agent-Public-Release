import { GoogleGenAI, Modality } from "@google/genai";
import { cachedString } from "../../cache-gate";
import { decideImageQuality, logQualityDecision, type ImagePurpose } from "../../image-quality-decider";

export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

export type ImageQuality = "fast" | "high";
export type ImageModel = "auto" | "gpt-image-2" | "gemini" | "dalle-3";
export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024" | "1792x1024" | "auto";

export interface GenerateImageOptions {
  quality?: ImageQuality;
  model?: ImageModel;
  size?: ImageSize;
  // R74.11 — Cost-aware decider signals. If `quality` is provided, it wins.
  // Otherwise the decider uses these to choose "high" vs "fast" per call.
  purpose?: ImagePurpose;
  isCustomerFacing?: boolean;
  estimatedBatchSize?: number;
  hasTextInImage?: boolean;
  callerLabel?: string;
  // R99.1 — Reference image paths. When non-empty AND a refs-capable model
  // (gpt-image-2) is selected, the call is routed through the OpenAI Images
  // Edit endpoint (multipart, image[] array) so the model can SEE the
  // references rather than reading a text description of them. Caching is
  // bypassed for refs-edit calls since each scene's reference set is unique.
  // Hard cap 4 references per call (gpt-image-2 supports up to ~10 but each
  // input image costs input tokens — 4 is the sweet spot for character +
  // environment continuity at acceptable latency/cost).
  referenceImagePaths?: string[];
}

const REFS_EDIT_MAX_IMAGES = 4;
const REFS_EDIT_MAX_BYTES_PER_IMAGE = 8 * 1024 * 1024;

async function generateImageGemini(prompt: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
    },
  });
  const candidate = response.candidates?.[0];
  const imagePart = candidate?.content?.parts?.find(
    (part: { inlineData?: { data?: string; mimeType?: string } }) => part.inlineData
  );
  if (!imagePart?.inlineData?.data) throw new Error("No image data in Gemini response");
  const mimeType = imagePart.inlineData.mimeType || "image/png";
  return `data:${mimeType};base64,${imagePart.inlineData.data}`;
}

// R64.D — gpt-image-2: OpenAI's latest image model. Token-priced (input + output
// image tokens). Higher quality than gpt-image-1 / dall-e-3 for product shots,
// realistic humans, and embedded text. Requires Verified Organization on the
// OpenAI dashboard. Returns b64_json (no url field).
async function generateImageGptImage2(prompt: string, size: ImageSize = "1024x1024"): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("gpt-image-2 unavailable: no OPENAI_API_KEY");
  // gpt-image-2 only accepts square or its own portrait/landscape — coerce dall-e-3-style sizes.
  const apiSize = size === "1792x1024" ? "1536x1024" : size === "auto" ? "1024x1024" : size;
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt: prompt.slice(0, 4000),
      n: 1,
      size: apiSize,
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`gpt-image-2 API error ${resp.status}: ${errBody.slice(0, 220)}`);
  }
  const data = await resp.json() as { data?: { b64_json?: string }[]; usage?: { total_tokens?: number } };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data in gpt-image-2 response");
  if (data.usage?.total_tokens) console.log(`[image-gen] gpt-image-2 used ${data.usage.total_tokens} tokens`);
  return `data:image/png;base64,${b64}`;
}

// R99.1 — gpt-image-2 with reference images via /v1/images/edits.
// Multipart form with `image[]` accepting up to ~10 reference files. We cap
// at REFS_EDIT_MAX_IMAGES (4) to bound cost and latency. Each reference is
// read off disk + size-checked before append. Fails loudly if no usable refs
// — caller (generateImage) will fall back to refs-less cascade.
async function generateImageGptImage2WithRefs(
  prompt: string,
  refPaths: string[],
  size: ImageSize = "1024x1024",
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("gpt-image-2 (refs) unavailable: no OPENAI_API_KEY");
  const fs = await import("fs/promises");
  const path = await import("path");

  const apiSize = size === "1792x1024" ? "1536x1024" : size === "auto" ? "1024x1024" : size;

  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("prompt", prompt.slice(0, 4000));
  form.append("n", "1");
  form.append("size", apiSize);

  // R99.1 +sec — Defense-in-depth: re-apply path jail at the lowest level
  // even though server/tools.ts:generate_social_image already filters. If a
  // future caller wires `referenceImagePaths` without going through the tool
  // dispatch (e.g., a new internal helper), this layer still blocks
  // arbitrary local file uploads to OpenAI.
  const { filterAllowedRefPaths } = await import("../../lib/image-ref-jail");
  const { allowed: jailedRefPaths, rejected: jailedReject } = filterAllowedRefPaths(refPaths);
  if (jailedReject.length > 0) {
    console.warn(`[image-gen] gpt-image-2 refs +sec: rejected ${jailedReject.length} path(s) outside allowed roots`);
  }

  let appended = 0;
  for (const p of jailedRefPaths.slice(0, REFS_EDIT_MAX_IMAGES)) {
    try {
      const buf = await fs.readFile(p);
      if (buf.length === 0 || buf.length > REFS_EDIT_MAX_BYTES_PER_IMAGE) {
        console.warn(`[image-gen] gpt-image-2 refs: skipping ${path.basename(p)} (size=${buf.length} bytes, cap=${REFS_EDIT_MAX_BYTES_PER_IMAGE})`);
        continue;
      }
      const ext = (p.split(".").pop() || "png").toLowerCase();
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
      // OpenAI accepts repeated `image[]` parts for multi-image edit.
      form.append("image[]", new Blob([new Uint8Array(buf)], { type: mime }), `ref_${appended}.${ext === "jpg" ? "jpg" : ext}`);
      appended++;
    } catch (err: any) {
      console.warn(`[image-gen] gpt-image-2 refs: failed to read ${p}: ${(err?.message || "").slice(0, 80)}`);
    }
  }

  if (appended === 0) {
    throw new Error("gpt-image-2 (refs) called with zero usable reference files");
  }

  const resp = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` }, // Content-Type set by FormData
    body: form,
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`gpt-image-2 edits API error ${resp.status}: ${errBody.slice(0, 220)}`);
  }
  const data = await resp.json() as { data?: { b64_json?: string }[]; usage?: { total_tokens?: number } };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data in gpt-image-2 edits response");
  if (data.usage?.total_tokens) console.log(`[image-gen] gpt-image-2 edits used ${data.usage.total_tokens} tokens (${appended} refs)`);
  return `data:image/png;base64,${b64}`;
}

async function generateImageDallE(prompt: string, size: ImageSize = "1792x1024"): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("DALL-E fallback unavailable: no OPENAI_API_KEY");
  const apiSize = size === "1024x1536" ? "1024x1792" : size === "1536x1024" ? "1792x1024" : size === "auto" ? "1024x1024" : size;
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: prompt.slice(0, 4000),
      n: 1,
      size: apiSize,
      quality: "standard",
      response_format: "b64_json",
    }),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`DALL-E API error ${resp.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await resp.json() as { data?: { b64_json?: string }[] };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data in DALL-E response");
  return `data:image/png;base64,${b64}`;
}

// Try a single provider, log success/failure; return result or throw.
async function tryProvider(name: string, fn: () => Promise<string>): Promise<string> {
  try {
    const result = await fn();
    console.log(`[image-gen] ${name} succeeded`);
    return result;
  } catch (err: any) {
    const msg = (err?.message || "").slice(0, 160);
    const isRateLimit = /RATELIMIT|rate limit|429|quota/i.test(msg);
    console.warn(`[image-gen] ${name} failed${isRateLimit ? " (rate-limited)" : ""}: ${msg}`);
    throw err;
  }
}

/**
 * R64.D / R74.10 — Generate an image with a tiered cascade.
 *
 * - opts.model="gpt-image-2" | "gemini" | "dalle-3": force one provider (no fallback).
 * - opts.quality="high" (DEFAULT as of R74.10): cascade gpt-image-2 → Gemini → DALL-E 3.
 *   Best-quality model first, premium fallback chain if it fails or rate-limits.
 *   Bob's standing direction: "we want good images for PDFs, pictures, video,
 *   and all the different projects." gpt-image-2 wins on text-in-image, product
 *   shots, and brand-consistent visuals — exactly the workloads we run.
 * - opts.quality="fast": cascade Gemini → gpt-image-2 → DALL-E 3 (cheap+fast first).
 *   Use explicitly when latency or per-image cost matters more than peak quality
 *   (e.g., bulk thumbnail generation, low-stakes preview renders).
 *
 * Cache key namespaces by quality tier so a "fast" call doesn't return a stale
 * "high" image (and vice versa). All providers fail open within their tier:
 * a single provider failure cascades to the next. Throws only if every tier
 * in the chosen cascade fails.
 */
export async function generateImage(prompt: string, opts: GenerateImageOptions = {}): Promise<string> {
  // R64.D — Default to LANDSCAPE so existing no-opts callers (generate_social_image,
  // slide hero visuals) keep getting wide aspect images regardless of which
  // provider fulfils the request. Without this, an OpenAI fallback would silently
  // return 1024x1024 squares while DALL-E used to give 1792x1024 landscape.
  // Each provider coerces this to its nearest supported aspect:
  //   gpt-image-2 → 1536x1024,  DALL-E 3 → 1792x1024,  Gemini → ignored (model decides).
  // R74.10 — DEFAULT FLIPPED from "fast" to "high" so every untagged caller
  // (slides, social, MPEG scene gen, PDF hero visuals) leads with gpt-image-2.
  // R74.11 — If caller passes a `purpose` (or aux signals) instead of explicit
  // `quality`, the decider picks the right tier for the workload's cost
  // profile. Explicit `quality` still wins if both are provided.
  const { model = "auto", size = "1536x1024" } = opts;
  let quality: ImageQuality;
  if (opts.quality) {
    // Caller forced a specific tier — log it so audits show every decision uniformly.
    quality = opts.quality;
    logQualityDecision(
      { quality, reason: `caller passed explicit quality=${quality}`, costTier: quality === "high" ? "premium" : "economy", wasForced: true },
      { purpose: opts.purpose, callerLabel: opts.callerLabel },
    );
  } else if (opts.purpose || opts.isCustomerFacing !== undefined || opts.estimatedBatchSize !== undefined || opts.hasTextInImage !== undefined) {
    const decision = decideImageQuality({
      purpose: opts.purpose,
      isCustomerFacing: opts.isCustomerFacing,
      estimatedBatchSize: opts.estimatedBatchSize,
      hasTextInImage: opts.hasTextInImage,
      callerLabel: opts.callerLabel,
    });
    logQualityDecision(decision, { purpose: opts.purpose, callerLabel: opts.callerLabel });
    quality = decision.quality;
  } else {
    // R74.10 fallback when no signals at all — still log so audits show 100% coverage.
    quality = "high";
    logQualityDecision(
      { quality, reason: "no purpose/quality/signals — R74.10 default (high)", costTier: "premium", wasForced: false },
      { callerLabel: opts.callerLabel },
    );
  }

  // R99.1 — Reference-image fast path. When the caller provides reference
  // images (Felix Visual Continuity), route to the gpt-image-2 edits endpoint
  // so the model literally sees the references. Cache is bypassed because
  // each scene's reference set + prompt combination is effectively unique.
  // Falls back to the refs-less cascade if the edits endpoint fails so a
  // single API hiccup never kills a render.
  const refPathsRaw = Array.isArray(opts.referenceImagePaths) ? opts.referenceImagePaths.filter(p => typeof p === "string" && p.length > 0) : [];
  if (refPathsRaw.length > 0) {
    try {
      return await tryProvider("gpt-image-2 (refs)", () => generateImageGptImage2WithRefs(prompt, refPathsRaw, size));
    } catch (err: any) {
      console.warn(`[image-gen] R99.1 refs path failed (${(err?.message || "").slice(0, 100)}); falling back to refs-less cascade`);
    }
  }

  // Forced single-provider mode (no fallback) — used when caller wants a
  // specific model for A/B testing or contractual reasons.
  if (model !== "auto") {
    const cacheNs = `images-${model}`;
    return cachedString(cacheNs, prompt.trim() + (size ? `|${size}` : ""), async () => {
      if (model === "gpt-image-2") return tryProvider("gpt-image-2", () => generateImageGptImage2(prompt, size));
      if (model === "gemini")      return tryProvider("Gemini",       () => generateImageGemini(prompt));
      if (model === "dalle-3")     return tryProvider("DALL-E 3",     () => generateImageDallE(prompt, size));
      throw new Error(`Unknown image model: ${model}`);
    });
  }

  // Cascade order depends on quality tier.
  const cascade: Array<{ name: string; fn: () => Promise<string> }> = quality === "high"
    ? [
        { name: "gpt-image-2", fn: () => generateImageGptImage2(prompt, size) },
        { name: "Gemini",      fn: () => generateImageGemini(prompt) },
        { name: "DALL-E 3",    fn: () => generateImageDallE(prompt, size) },
      ]
    : [
        { name: "Gemini",      fn: () => generateImageGemini(prompt) },
        { name: "gpt-image-2", fn: () => generateImageGptImage2(prompt, size) },
        { name: "DALL-E 3",    fn: () => generateImageDallE(prompt, size) },
      ];

  const cacheNs = `images-cascade-${quality}`;
  return cachedString(cacheNs, prompt.trim() + (size ? `|${size}` : ""), async () => {
    const errors: string[] = [];
    for (const tier of cascade) {
      try {
        return await tryProvider(tier.name, tier.fn);
      } catch (err: any) {
        errors.push(`${tier.name}: ${(err?.message || "").slice(0, 100)}`);
      }
    }
    throw new Error(`Image generation failed across all tiers — ${errors.join("; ")}`);
  });
}
