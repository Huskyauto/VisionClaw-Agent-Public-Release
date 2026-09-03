import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { invalidateContractCache, listContracts, verifyDeliverable } from "../server/deliverable-verifier";
import * as fs from "fs";
import * as path from "path";

(async () => {
  const seeds = [
    { type: "html_page", exts: [".html", ".htm"], mime: "text/html", min: 200, render: "html", desc: "Standalone HTML page (landing page, report)" },
    { type: "pdf_document", exts: [".pdf"], mime: "application/pdf", min: 1024, render: "pdf", desc: "Polished PDF" },
    { type: "slide_deck", exts: [".pptx", ".html", ".pdf"], mime: null, min: 2048, render: "none", desc: "Slide deck (pptx or html)" },
    { type: "image", exts: [".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"], mime: "image/*", min: 100, render: "image", desc: "Single image" },
    { type: "video", exts: [".mp4", ".webm", ".mov"], mime: "video/*", min: 4096, render: "none", desc: "Video file" },
    { type: "audio", exts: [".mp3", ".wav", ".ogg"], mime: "audio/*", min: 1024, render: "none", desc: "Audio file" },
    { type: "csv_data", exts: [".csv"], mime: "text/csv", min: 10, render: "none", desc: "CSV dataset" },
    { type: "json_data", exts: [".json"], mime: "application/json", min: 2, render: "json", desc: "JSON document" },
  ];

  for (const s of seeds) {
    await db.execute(sql`
      INSERT INTO deliverable_contracts (deliverable_type, required_extensions, required_mime_pattern, min_size_bytes, render_check, description)
      VALUES (${s.type}, ${sql.raw(`ARRAY[${s.exts.map((e) => `'${e}'`).join(",")}]::text[]`)}, ${s.mime}, ${s.min}, ${s.render}, ${s.desc})
      ON CONFLICT (deliverable_type) DO UPDATE SET
        required_extensions = EXCLUDED.required_extensions,
        required_mime_pattern = EXCLUDED.required_mime_pattern,
        min_size_bytes = EXCLUDED.min_size_bytes,
        render_check = EXCLUDED.render_check,
        description = EXCLUDED.description
    `);
    console.log(`[seed-contracts] upserted ${s.type}`);
  }

  invalidateContractCache();
  const all = await listContracts();
  console.log(`[seed-contracts] total contracts: ${all.length}`);

  // Smoke test fixtures
  const tmp = "/tmp/r76-fixtures";
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, "good.html"), "<!doctype html><html><head><title>x</title></head><body>" + "x".repeat(300) + "</body></html>");
  fs.writeFileSync(path.join(tmp, "fake.pdf"), "this is not a pdf, just a long string ".repeat(50));
  fs.writeFileSync(path.join(tmp, "real.pdf"), Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2000, 0x20), Buffer.from("\n%%EOF")]));
  fs.writeFileSync(path.join(tmp, "bad-html.html"), "just plain text, no html tags here");
  fs.writeFileSync(path.join(tmp, "data.json"), JSON.stringify({ ok: true, n: 1 }));
  fs.writeFileSync(path.join(tmp, "broken.json"), "{not valid json");

  const cases = [
    { type: "html_page", file: "good.html", expect: "passed" },
    { type: "html_page", file: "bad-html.html", expect: "failed" },
    { type: "pdf_document", file: "real.pdf", expect: "passed" },
    { type: "pdf_document", file: "fake.pdf", expect: "failed" },
    { type: "json_data", file: "data.json", expect: "passed" },
    { type: "json_data", file: "broken.json", expect: "failed" },
    { type: "html_page", file: "real.pdf", expect: "failed" },
  ];
  let pass = 0;
  for (const c of cases) {
    const r = await verifyDeliverable({ tenantId: 1, deliverableType: c.type, filePath: path.join(tmp, c.file) });
    const ok = r.status === c.expect;
    console.log(`${ok ? "PASS" : "FAIL"} | ${c.type} <- ${c.file} → ${r.status} (expected ${c.expect}) failures=${JSON.stringify(r.failures)}`);
    if (ok) pass++;
  }
  console.log(`\n[seed-contracts] ${pass}/${cases.length} verifier smoke tests passed`);
  process.exit(pass === cases.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
