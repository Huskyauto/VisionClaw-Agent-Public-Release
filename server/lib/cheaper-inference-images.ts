import OpenAI from "openai";
import { CHEAPER_INFERENCE_BASE_URL } from "./cheaper-inference";
import { cheaperAutomaticAllowed, getCheaperCatalog, runCheaperBudgeted } from "./cheaper-inference-automatic";

/** Fixed-unit models only. Token-priced images/video wait for a proven output bound. */
export async function generateCheaperImage(prompt: string, model: string, tenantId: number): Promise<string> {
  if (!cheaperAutomaticAllowed(tenantId) || !["nano-banana", "grok-imagine"].includes(model)) {
    throw new Error("CheaperInference images require the enabled owner policy and a supported fixed-price model");
  }
  if (typeof prompt !== "string" || !prompt.trim() || Buffer.byteLength(prompt, "utf8") > 4096) {
    throw new Error("CheaperInference image prompt must be non-empty and at most 4 KiB");
  }
  const entry = (await getCheaperCatalog()).find(m => m.type === "image" && m.id === model);
  if (!entry || typeof entry.imagePrice !== "number" || entry.imagePrice <= 0 || entry.imagePrice > 1) {
    throw new Error("A valid fixed per-image catalog price is required before spending");
  }
  const client = new OpenAI({ apiKey: process.env.CHEAPER_INFERENCE_API_KEY!.trim(),
    baseURL: CHEAPER_INFERENCE_BASE_URL, maxRetries: 0, timeout: 60_000 });
  let dataUrl = "";
  await runCheaperBudgeted(tenantId, entry.imagePrice, async () => {
    const result: any = await client.images.generate({
      model, prompt, n: 1, size: "1024x1024", response_format: "b64_json",
    });
    const encoded = result?.data?.[0]?.b64_json;
    if (!Array.isArray(result?.data) || result.data.length !== 1 || typeof encoded !== "string" ||
        encoded.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error("CheaperInference did not return one bounded base64 image");
    }
    const bytes = Buffer.from(encoded, "base64");
    const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" :
      bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg" :
      bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : undefined;
    if (!mime) throw new Error("CheaperInference image bytes have an unsupported signature");
    const sharp = (await import("sharp")).default;
    const decoded = await sharp(bytes, { limitInputPixels: 4_194_304, animated: false })
      .raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== decoded.info.height || decoded.info.width > 2048) {
      throw new Error("CheaperInference fixed-unit image is not a bounded square");
    }
    dataUrl = `data:${mime};base64,${encoded}`;
    const cost = typeof result.usage?.cost === "number" && Number.isFinite(result.usage.cost) &&
      result.usage.cost >= 0 ? result.usage.cost : entry.imagePrice;
    const { recordCost } = await import("../agentic/cost-ledger");
    if (!await recordCost({ tenantId, toolName: "image.cheaperinference",
      model: `cheaperinference/${model}`, costUsd: cost, operation: "one fixed-unit image" })) {
      console.error("[cheaper-images] Cost ledger unavailable; image retained and independent spend reservation still applies");
    }
    return { usage: { cost } };
  }, usage => usage?.cost);
  return dataUrl;
}
