import { mkdir, writeFile, mkdtemp, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import AdmZip from "adm-zip";
import { DECISION_REVIEW_DOCUMENTS, buildDecisionReviewMarkdown } from "../shared/ai-stack-decision-package";

// Purely local export. No database, customer delivery, email or provider imports.
const output = path.resolve("generated-artifacts/ai-stack-decision-review");
const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]!));
const inline = (value: string) => escape(value)
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

function renderDocument(markdown: string): string {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const heading = /^(#{1,4}) (.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (line.startsWith("|") && /^\|[\s:|-]+\|$/.test(lines[index + 1] ?? "")) {
      const cells = (row: string) => row.slice(1, -1).split("|").map((cell) => inline(cell.trim()));
      const header = cells(line).map((cell) => `<th>${cell}</th>`).join("");
      index += 2;
      const rows: string[] = [];
      while (index < lines.length && lines[index].startsWith("|")) {
        rows.push(`<tr>${cells(lines[index]).map((cell) => `<td>${cell}</td>`).join("")}</tr>`);
        index++;
      }
      index--;
      blocks.push(`<div class="table"><table><thead><tr>${header}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`);
    } else if (/^-\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^-\s/.test(lines[index])) items.push(`<li>${inline(lines[index++].slice(2))}</li>`);
      index--;
      blocks.push(`<ul>${items.join("")}</ul>`);
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s/.test(lines[index])) items.push(`<li>${inline(lines[index++].replace(/^\d+\.\s/, ""))}</li>`);
      index--;
      blocks.push(`<ol>${items.join("")}</ol>`);
    } else {
      blocks.push(`<p>${inline(line)}</p>`);
    }
  }
  return blocks.join("\n");
}

const css = `*{box-sizing:border-box}body{font:16px/1.65 system-ui,sans-serif;color:#172b3a;background:#f3f5f4;margin:0}main{max-width:1050px;margin:auto;padding:32px}header,section{padding:30px;background:white;margin-bottom:22px;border:1px solid #d6dfdd;border-radius:10px}h1,h2{line-height:1.2}h2{margin-top:30px}p,li{overflow-wrap:anywhere}.tag{font-size:13px;color:#53665e}.table{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #cbd5d1;padding:9px;text-align:left;vertical-align:top}th{background:#e8efeb}a{color:#165d47}@media print{body{background:white;font-size:10pt}main{padding:0;max-width:none}header,section{border:0;padding:0;border-radius:0}section{break-before:page}h1,h2,h3{break-after:avoid}.table{overflow:visible}table{font-size:8pt}thead{display:table-header-group}tr{break-inside:avoid}}`;
function html(title: string, documents: typeof DECISION_REVIEW_DOCUMENTS): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${css}</style></head><body><main><header><p class="tag">AI Stack Decision Review · Version 1.0</p><h1>${escape(title)}</h1><p>${documents.length > 1 ? "Owner launch package. Includes internal operations; do not send the whole package to a customer." : "Illustrative sample. Hypothetical buyer; source-reviewed findings, not a customer engagement."}</p><p>Open this file in a browser and choose Print → Save as PDF. No internet or account required to read it.</p>${documents.length > 1 ? `<ol>${documents.map((document) => `<li><a href="#${document.id}">${escape(document.title)}</a> — ${escape(document.audience)}</li>`).join("")}</ol>` : ""}</header>${documents.map((document) => `<section id="${document.id}"><p class="tag">${escape(document.audience)}</p>${renderDocument(document.content)}</section>`).join("")}</main></body></html>`;
}

async function main() {
  const files: Record<string, string> = {
    "START-HERE.md": "# AI Stack Decision Review — owner package\n\nStart with 01-offer.md. Use complete-package.html for offline reading or browser Print → Save as PDF. The sample report is illustrative, not commissioned research. Internal operations must not be sent to customers. No checkout, outreach or automated fulfillment is enabled.\n\nSource of truth: shared/ai-stack-decision-package.ts. Regenerate with npx tsx scripts/export-ai-stack-decision-package.ts.\n",
    "complete-package.md": buildDecisionReviewMarkdown(),
    "complete-package.html": html("Complete owner launch package", DECISION_REVIEW_DOCUMENTS),
    "sample-decision-report.html": html("Sample decision report", DECISION_REVIEW_DOCUMENTS.filter((document) => document.id === "sample")),
    "sample-comparison.csv": [
      "candidate,criterion,mandatory,result,evidence_class,confidence,limitation",
      ...[
        ["Restart-safe recovery", "yes", "unknown", "Resumption remains open in reviewed roadmap; no runtime test"],
        ["Multi-customer isolation", "yes", "unknown", "Multi-tenancy is a future idea; no equivalent boundary demonstrated"],
        ["Exact recipient and artifact approval", "yes", "unknown", "Not established by this source review"],
        ["Pre-call spend ceiling and uncertain outcomes", "yes", "unknown", "Not established by this source review"],
        ["Durable final deliverables", "yes", "unknown", "Not established by this source review"],
        ["Readable workflow definition", "no", "demonstrated", "TOML source reviewed; authoring usability not measured"],
        ["Stage queues and overflow routes", "no", "demonstrated", "Implementation reviewed; no runtime or strict memory-bound proof"],
        ["Durable long waits", "no", "unknown", "Durable waits remain open; needed only for workflows that require them"],
        ["Credential destination restrictions", "no", "unknown", "Per-credential allowed-host locks are planned"],
        ["All-branch joining", "no", "unknown", "Waiting for all branches is planned; required-output acceptance unverified"],
        ["Measured total cost", "no", "unknown", "No matched end-to-end measurement"],
      ].flatMap(([criterion, mandatory, result, limitation]) => [
        ["Hypothetical current worker", criterion, mandatory, "unknown", "Hypothetical", "Low", "Illustrative baseline; no supplied or tested implementation"],
        ["PurpleFlow reviewed revision", criterion, mandatory, result, "Source-reviewed", result === "demonstrated" ? "Medium" : "Low", limitation],
      ]).map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")),
    ].join("\r\n") + "\r\n",
    "evidence-register-template.csv": "claim_id,claim,source_url,version,accessed_at,evidence_class,confidence,support,limitations,decision_effect\r\n",
  };
  DECISION_REVIEW_DOCUMENTS.forEach((document, index) => {
    files[`${String(index + 1).padStart(2, "0")}-${document.id}.md`] = document.content + "\n";
  });
  const hashes = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, createHash("sha256").update(content).digest("hex")]));
  files["manifest.json"] = JSON.stringify({ package: "AI Stack Decision Review", version: "1.0", hashes }, null, 2) + "\n";
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content, "utf8"));
  const bytes = zip.toBuffer();
  // Build completely away from the published directory. A failed write must
  // not leave a previous ZIP beside a partially refreshed document set.
  await mkdir(path.dirname(output), { recursive: true });
  const staging = await mkdtemp(`${output}-staging-`);
  const backup = `${output}-previous-${randomUUID()}`;
  let backedUp = false;
  let published = false;
  try {
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(staging, name), content, "utf8");
    await writeFile(path.join(staging, "ai-stack-decision-review-package.zip"), bytes);
    try {
      await rename(output, backup);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(staging, output);
      published = true;
    } catch (error) {
      if (backedUp) await rename(backup, output);
      throw error;
    }
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true });
    if (published && backedUp) await rm(backup, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ output, files: Object.keys(files), zipBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, null, 2));
}

main().catch((error) => {
  console.error("Package export failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
