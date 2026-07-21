import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const images = [
  { label: "A. Auto-scan JPG (Notes/Drive scan mode)", path: "attached_assets/Scan_20260525_104433_1779724065264.jpg" },
  { label: "B. Raw photo (on-lap, hand visible, angled)", path: "attached_assets/20260525_104420_1779724065270.jpg" },
  { label: "C. Raw photo (straight-on, tilted) [resized to fit 5MB]", path: "/tmp/capture-C-resized.jpg" },
];

async function ocr(p: string) {
  const buf = await fs.readFile(p);
  const b64 = buf.toString("base64");
  const t0 = Date.now();
  const resp = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: "Transcribe ALL printed text on this page verbatim. Preserve column structure (blank line between columns). Do not summarize. If any word is unreadable mark [?]. Return ONLY the transcribed text." }
      ]
    }]
  });
  const text = (resp.content as any[]).filter(c => c.type === "text").map(c => c.text).join("");
  return { ms: Date.now() - t0, bytes: buf.length, text, in: resp.usage.input_tokens, out: resp.usage.output_tokens };
}

(async () => {
  const ground = (await fs.readFile("attached_assets/Scan_20260525_104433_1779724065248.pdf", "utf-8").catch(() => ""))
    .toLowerCase().match(/[a-z]+/g) || [];
  const groundSet = new Set(ground);

  for (const im of images) {
    console.log("\n=== " + im.label + " ===");
    try {
      const r = await ocr(im.path);
      const words = (r.text.toLowerCase().match(/[a-z]+/g) || []);
      const hit = words.filter(w => groundSet.has(w)).length;
      console.log(`  bytes=${(r.bytes/1024).toFixed(0)}KB  ms=${r.ms}  tokens_in=${r.in}  tokens_out=${r.out}`);
      console.log(`  words_returned=${words.length}  matches_pdf_corpus=${hit}  match_rate=${(hit/Math.max(words.length,1)*100).toFixed(1)}%`);
      console.log(`  FIRST 500:\n${r.text.slice(0, 500)}`);
      console.log(`  ...LAST 300:\n${r.text.slice(-300)}`);
    } catch (e: any) {
      console.log("  ERROR:", e.message);
    }
  }
})();
