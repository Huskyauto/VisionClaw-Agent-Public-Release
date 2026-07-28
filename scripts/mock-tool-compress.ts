/**
 * Mock harness: measures what the tool-output compressor actually sends to the LLM.
 * Runs realistic tool payloads through the SAME compressToolOutput used at the
 * chat round-loop chokepoint (server/routes.ts), at the SAME caps (4000 pres / 6000),
 * and reports tokens for: RAW (uncompressed) vs OLD dumb head-slice vs NEW compressor.
 *
 * Run: npx tsx scripts/mock-tool-compress.ts
 */
import { compressToolOutput } from "../server/lib/tool-output-compressor";

const tok = (chars: number) => Math.ceil(chars / 3.5); // same estimator as the compressor
const DEFAULT_CAP = 6000;
const PRES_CAP = 4000;

// ---- realistic tool payloads --------------------------------------------------

// 1) execute_sql: 800 invoice rows (what a "list all invoices" query returns)
const sqlRows = Array.from({ length: 800 }, (_, i) => ({
  id: i + 1,
  tenant_id: 1,
  customer: `Customer ${(i % 60) + 1} LLC`,
  email: `billing+${i}@customer${(i % 60) + 1}.example.com`,
  amount_cents: 1000 + ((i * 37) % 90000),
  status: ["paid", "open", "void", "overdue"][i % 4],
  created_at: `2026-0${(i % 9) + 1}-1${i % 9}T1${i % 9}:00:00.000Z`,
  notes: i % 11 === 0 ? "Net-30 terms; PO required; see contract addendum B for details." : "",
}));
const sqlRaw = JSON.stringify({ rows: sqlRows, rowCount: sqlRows.length });

// 2) deployment logs: 2000 lines, heavy repetition + a trailing FATAL (the signal)
const logLines: string[] = [];
for (let i = 0; i < 2000; i++) {
  if (i % 50 === 0) logLines.push(`[2026-06-13T10:${String(i % 60).padStart(2, "0")}:00Z] INFO  request handled route=/api/chat ms=${40 + (i % 30)}`);
  else logLines.push(`[2026-06-13T10:00:00Z] DEBUG  heartbeat tick ok pool=healthy conns=3`);
}
logLines.push("[2026-06-13T10:59:59Z] FATAL  db connection lost: ECONNREFUSED 10.0.0.5:5432");
const logRaw = logLines.join("\n");

// 3) read large source file (~38KB dump)
const fileRaw =
  `// server/some-large-module.ts\n` +
  Array.from({ length: 900 }, (_, i) => `  const result_${i} = doWork(input_${i}, { retries: 3, timeout: 5000 }); // step ${i}`).join("\n");

// 4) web/API fetch: nested JSON with long prose fields
const apiRaw = JSON.stringify({
  results: Array.from({ length: 120 }, (_, i) => ({
    title: `Result ${i}`,
    url: `https://example.com/article/${i}`,
    snippet: "Lorem ipsum dolor sit amet, ".repeat(20) + `(item ${i})`,
  })),
  meta: { total: 120, page: 1 },
});

const cases = [
  { name: "execute_sql (800 invoice rows)", raw: sqlRaw, cap: DEFAULT_CAP, tool: "execute_sql" },
  { name: "deployment logs (2000 lines + FATAL)", raw: logRaw, cap: DEFAULT_CAP, tool: "fetch_deployment_logs" },
  { name: "read large file (~38KB)", raw: fileRaw, cap: DEFAULT_CAP, tool: "read_file" },
  { name: "web_search (120 results, long snippets)", raw: apiRaw, cap: DEFAULT_CAP, tool: "web_search" },
  { name: "presentation tool payload", raw: apiRaw, cap: PRES_CAP, tool: "render_slides" },
];

// ---- run + report -------------------------------------------------------------

let sumRawTok = 0, sumOldTok = 0, sumNewTok = 0;
const pad = (s: string, n: number) => s.padEnd(n);
const rj = (s: string, n: number) => s.padStart(n);

console.log("\nMOCK: tokens HEADING TO THE LLM per tool result (estimator ceil(chars/3.5))\n");
console.log(pad("tool result", 38), rj("RAW tok", 9), rj("OLD tok", 9), rj("NEW tok", 9), rj("vs RAW", 9), rj("tail?", 7));
console.log("-".repeat(83));

for (const c of cases) {
  const old = c.raw.slice(0, c.cap); // the dumb head-slice the compressor replaced
  const res = compressToolOutput({ toolName: c.tool, raw: c.raw, maxChars: c.cap, enabled: true });

  const rawTok = tok(c.raw.length);
  const oldTok = tok(old.length);
  const newTok = tok(res.outputChars);
  sumRawTok += rawTok; sumOldTok += oldTok; sumNewTok += newTok;

  const vsRaw = rawTok > 0 ? Math.round((1 - newTok / rawTok) * 100) : 0;
  // did the trailing signal line survive? (only meaningful for the log case)
  const tailKept = res.text.includes("FATAL") || !c.raw.includes("FATAL");

  console.log(
    pad(c.name, 38),
    rj(String(rawTok), 9),
    rj(String(oldTok), 9),
    rj(String(newTok), 9),
    rj(`-${vsRaw}%`, 9),
    rj(c.raw.includes("FATAL") ? (res.text.includes("FATAL") ? "kept" : "LOST") : "n/a", 7),
  );
}

console.log("-".repeat(83));
console.log(pad("TOTAL", 38), rj(String(sumRawTok), 9), rj(String(sumOldTok), 9), rj(String(sumNewTok), 9),
  rj(`-${Math.round((1 - sumNewTok / sumRawTok) * 100)}%`, 9), rj("", 7));

console.log(`\nGross savings vs sending RAW uncompressed: ${sumRawTok - sumNewTok} tokens (${Math.round((1 - sumNewTok / sumRawTok) * 100)}%).`);
console.log(`At the same byte budget, NEW vs OLD head-slice: ${sumOldTok - sumNewTok} tokens diff — the real win is INFO RETAINED per token (structure + trailing signal), not raw count.\n`);
