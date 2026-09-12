const fs = require("fs");

const MAX_PAGES = 100;
const MAX_CHARS = 200000;

(async () => {
  const filePath = process.argv[2];
  if (!filePath || !pathIsSafe(filePath)) throw new Error("invalid PDF path");
  const data = fs.readFileSync(filePath);
  if (data.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("invalid PDF signature");
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    await parser.load();
    const info = await parser.getInfo({ parsePageInfo: true });
    const pages = Number(info?.total ?? info?.numPages ?? info?.pages?.length ?? 0);
    if (pages > MAX_PAGES) throw new Error("PDF exceeds page limit");
    const result = await parser.getText();
    const text = typeof result === "string" ? result : result?.text || "";
    if (text.length > MAX_CHARS) throw new Error("PDF exceeds text limit");
    process.stdout.write(JSON.stringify({ ok: true, text }));
  } finally {
    try { parser.destroy(); } catch {}
  }
})().catch((err) => {
  process.stderr.write(String(err?.message || err).slice(0, 1000));
  process.exitCode = 1;
});

function pathIsSafe(value) {
  return require("path").isAbsolute(value) && !value.includes("\0");
}