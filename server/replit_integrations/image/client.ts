import { GoogleGenAI, Modality } from "@google/genai";

export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

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

  if (!imagePart?.inlineData?.data) {
    throw new Error("No image data in Gemini response");
  }

  const mimeType = imagePart.inlineData.mimeType || "image/png";
  return `data:${mimeType};base64,${imagePart.inlineData.data}`;
}

async function generateImageDallE(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("DALL-E fallback unavailable: no OPENAI_API_KEY");

  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: prompt.slice(0, 4000),
      n: 1,
      size: "1792x1024",
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

export async function generateImage(prompt: string): Promise<string> {
  try {
    const result = await generateImageGemini(prompt);
    console.log("[image-gen] Gemini succeeded");
    return result;
  } catch (geminiErr: any) {
    const msg = geminiErr?.message || "";
    const isRateLimit = msg.includes("RATELIMIT") || msg.includes("rate limit") || msg.includes("429") || msg.includes("quota");
    console.warn(`[image-gen] Gemini failed${isRateLimit ? " (rate-limited)" : ""}: ${msg.slice(0, 120)}`);
    console.log("[image-gen] Falling back to DALL-E 3...");
    try {
      const result = await generateImageDallE(prompt);
      console.log("[image-gen] DALL-E 3 succeeded (fallback)");
      return result;
    } catch (dalleErr: any) {
      console.error(`[image-gen] DALL-E fallback also failed: ${(dalleErr as any)?.message?.slice(0, 120)}`);
      throw new Error(`Image generation failed — Gemini: ${msg.slice(0, 100)}; DALL-E: ${(dalleErr as any)?.message?.slice(0, 100)}`);
    }
  }
}
