/**
 * Smoke test for the Veo / Gemini Omni Flash adapter.
 *
 * Usage:
 *   GEMINI_OMNI_FLASH_ENABLED=true \
 *   npx tsx scripts/smoke-gemini-omni-flash.ts "a slow dolly shot of a sunlit coffee cup on a wooden table"
 *
 * Optional model override (when a newer "Omni Flash" model id ships):
 *   GEMINI_OMNI_FLASH_MODEL=gemini-omni-flash npx tsx scripts/smoke-gemini-omni-flash.ts "..."
 *
 * Exit codes:
 *   0 — success, video saved + path printed
 *   1 — disabled or missing API key (config problem)
 *   2 — generation/poll/download failure (error message printed; calibrate
 *       GEMINI_OMNI_FLASH_MODEL or report the SDK error)
 */

import { generateOmniFlashClip, OmniFlashError, isOmniFlashEnabled, getOmniFlashConfig } from "../server/video/gemini-omni-flash";

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim() ||
    "a slow dolly shot of a sunlit coffee cup on a wooden table, cinematic, shallow depth of field";

  const cfg = getOmniFlashConfig();
  console.log("[smoke] config:", { model: cfg.model, hasKey: !!cfg.apiKey, enabled: isOmniFlashEnabled(), pollIntervalMs: cfg.pollIntervalMs, timeoutMs: cfg.timeoutMs });

  if (!isOmniFlashEnabled()) {
    console.error("[smoke] GEMINI_OMNI_FLASH_ENABLED is not 'true' — set it and retry.");
    process.exit(1);
  }
  if (!cfg.apiKey) {
    console.error("[smoke] no API key on AI_INTEGRATIONS_GEMINI_API_KEY or GOOGLE_API_KEY.");
    process.exit(1);
  }

  console.log("[smoke] prompt:", prompt);
  try {
    const out = await generateOmniFlashClip({ prompt, durationSec: 4, aspectRatio: "16:9", outDir: "data/omni-flash-smoke" });
    console.log("[smoke] OK", out);
    console.log("[smoke] open the file:", out.videoPath);
    process.exit(0);
  } catch (e) {
    if (e instanceof OmniFlashError) {
      console.error(`[smoke] FAIL: ${e.message}`);
      if (e.cause) console.error("[smoke] cause:", e.cause);
      process.exit(2);
    }
    console.error("[smoke] unexpected error:", e);
    process.exit(2);
  }
}

main();
