import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

export interface CustomerAcceptanceCriteria {
  requiredText?: string[];
  expectedLinks?: string[];
  minimumPages?: number;
}
export interface ArtifactBackcheck {
  version: 1;
  passed: boolean;
  artifactSha256: string;
  criteriaSha256: string;
  coverage: "pdf_text_and_links" | "text" | "identity_only" | "incomplete";
  failures: string[];
  pages?: number;
  checkedTextRequirements: number;
  checkedLinkRequirements: number;
}
export const BACKCHECK_LIMITS = { bytes: 10 * 1024 * 1024, pages: 80, workers: 2, deadlineMs: 10_000 } as const;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

export function parseAcceptanceCriteria(raw: unknown): CustomerAcceptanceCriteria {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_acceptance_criteria");
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some(k => !["requiredText", "expectedLinks", "minimumPages"].includes(k))) throw new Error("invalid_acceptance_criteria");
  const out: CustomerAcceptanceCriteria = {};
  for (const key of ["requiredText", "expectedLinks"] as const) {
    if (r[key] === undefined) continue;
    if (!Array.isArray(r[key]) || r[key].length > 20 ||
        r[key].some(v => typeof v !== "string" || !v.trim() || v.length > (key === "requiredText" ? 250 : 2048))) {
      throw new Error("invalid_acceptance_criteria");
    }
    out[key] = (r[key] as string[]).map(v => v.trim());
  }
  if (out.expectedLinks?.some(v => {
    try { const u = new URL(v); return !["https:", "http:"].includes(u.protocol) || !!u.username || !!u.password; }
    catch { return true; }
  })) throw new Error("invalid_acceptance_criteria");
  if (r.minimumPages !== undefined) {
    if (!Number.isSafeInteger(r.minimumPages) || (r.minimumPages as number) < 1 || (r.minimumPages as number) > BACKCHECK_LIMITS.pages) throw new Error("invalid_acceptance_criteria");
    out.minimumPages = r.minimumPages as number;
  }
  return out;
}

// Inline CJS worker survives the esbuild production bundle: no tsx loader,
// workspace script, application credentials or network request is needed.
const PDF_WORKER = String.raw`
const {parentPort,workerData}=require("node:worker_threads");
(async()=>{
  const {PDFDocument,PDFName,PDFArray,PDFDict,PDFString,PDFHexString}=require("pdf-lib");
  const bytes=Buffer.from(workerData.bytes);
  const doc=await PDFDocument.load(bytes,{throwOnInvalidObject:true});
  const count=doc.getPageCount();
  if(count<1||count>80) throw Error("pdf_page_limit");
  const links=[];
  for(const [index,page] of doc.getPages().entries()){
    const crop=page.getCropBox(),annots=page.node.lookupMaybe(PDFName.of("Annots"),PDFArray);
    if(annots&&annots.size()>2000)throw Error("pdf_annotation_limit");
    for(let i=0;annots&&i<annots.size();i++){
      const a=annots.lookup(i,PDFDict);
      if(a.get(PDFName.of("Subtype"))?.toString()!=="/Link")continue;
      const action=a.lookupMaybe(PDFName.of("A"),PDFDict);
      if(!action||action.get(PDFName.of("S"))?.toString()!=="/URI")continue;
      const uri=action.lookup(PDFName.of("URI"));
      if(!(uri instanceof PDFString||uri instanceof PDFHexString))throw Error("pdf_link_invalid");
      const raw=uri.decodeText();
      let url;try{url=new URL(raw)}catch{throw Error("pdf_link_invalid")}
      if(!["http:","https:","mailto:","tel:"].includes(url.protocol)||url.username||url.password)throw Error("pdf_link_unsafe");
      const rect=a.lookup(PDFName.of("Rect"),PDFArray).asArray().map(n=>Number(n.toString()));
      if(rect.length!==4||rect.some(n=>!Number.isFinite(n)))throw Error("pdf_link_invalid");
      const [x0,y0,x1,y1]=rect;
      if(x1-x0>=4&&y1-y0>=4&&x0>=crop.x&&y0>=crop.y&&x1<=crop.x+crop.width&&y1<=crop.y+crop.height)
        links.push({page:index+1,url:url.href});
    }
  }
  const {PDFParse}=require("pdf-parse");
  const parser=new PDFParse({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false});
  try{
    const text=await parser.getText();
    if(text.total!==count||text.pages.length!==count)throw Error("pdf_text_incomplete");
    const totalText=text.text.length;
    if(totalText>1000000)throw Error("pdf_text_limit");
    parentPort.postMessage({ok:true,pages:count,text:text.text,
      pageTexts:text.pages.map(p=>({page:p.num,text:p.text})),links});
  }finally{await parser.destroy();}
})().catch(()=>parentPort.postMessage({ok:false,error:"pdf_inspection_failed"}));
`;
interface PdfInspection {
  ok: boolean; error?: string; pages: number; text: string;
  pageTexts: { page: number; text: string }[];
  links: { page: number; url: string }[];
}
let activeWorkers = 0;
async function inspectPdf(bytes: Buffer): Promise<PdfInspection> {
  if (activeWorkers >= BACKCHECK_LIMITS.workers) throw new Error("backcheck_capacity");
  activeWorkers++;
  let worker: Worker | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    worker = new Worker(PDF_WORKER, { eval: true, execArgv: [], env: {}, workerData: { bytes },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    return await new Promise<PdfInspection>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("backcheck_deadline")), BACKCHECK_LIMITS.deadlineMs);
      worker!.once("message", (result: PdfInspection) => result.ok ? resolve(result) : reject(new Error("pdf_inspection_failed")));
      worker!.once("error", () => reject(new Error("pdf_inspection_failed")));
      worker!.once("exit", () => reject(new Error("pdf_inspection_incomplete")));
    });
  } finally {
    if (timer) clearTimeout(timer);
    try { if (worker) await worker.terminate(); }
    finally { activeWorkers--; }
  }
}

/** A replay cannot weaken or replace the criteria attached to an old receipt. */
export function retainedAcceptanceCriteria(requested: unknown, metadata: unknown): CustomerAcceptanceCriteria {
  const stored = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)._customerAcceptanceCriteria : undefined;
  const original = parseAcceptanceCriteria(stored);
  if (requested !== undefined && JSON.stringify(parseAcceptanceCriteria(requested)) !== JSON.stringify(original)) {
    throw new Error("acceptance_criteria_changed_use_new_delivery_identity");
  }
  return original;
}

export function assertBackcheckIdentity(bytes: Buffer, receipt: ArtifactBackcheck, intendedSha256: string): void {
  if (!receipt.passed || receipt.coverage === "incomplete" || receipt.coverage === "identity_only" ||
      !/^[a-f0-9]{64}$/.test(intendedSha256) ||
      digest(bytes) !== receipt.artifactSha256 || intendedSha256 !== receipt.artifactSha256) {
    throw new Error("artifact_backcheck_identity_mismatch");
  }
}

export function assertCompletedPackageIdentity(
  requested: { fileName: string; bytes?: Buffer }[],
  recorded: { logicalName: string; sha256: string; idempotencyKey: string }[],
  deliveryId: number,
): void {
  if (!requested.length || recorded.length !== requested.length) throw new Error("completed_package_identity_mismatch");
  for (const [index, file] of requested.entries()) {
    const key = index === 0 ? `delivery-artifact:${deliveryId}:primary` : `delivery-artifact:${deliveryId}:bundle:${index - 1}`;
    const record = recorded.find(r => r.idempotencyKey === key);
    if (!record || record.logicalName !== file.fileName || (file.bytes && digest(file.bytes) !== record.sha256)) {
      throw new Error("completed_package_identity_mismatch");
    }
  }
}

/** Deterministic artifact acceptance, NOT factual/visual/media certification. */
export async function backcheckCustomerArtifact(input: { bytes: Buffer; fileName: string; criteria?: unknown }): Promise<ArtifactBackcheck> {
  const bytes = Buffer.from(input.bytes);
  const result: ArtifactBackcheck = { version: 1, passed: false, artifactSha256: digest(bytes),
    criteriaSha256: digest("{}"), coverage: "incomplete", failures: [],
    checkedTextRequirements: 0, checkedLinkRequirements: 0 };
  let criteria: CustomerAcceptanceCriteria;
  try { criteria = parseAcceptanceCriteria(input.criteria); }
  catch { result.failures.push("invalid_acceptance_criteria"); return result; }
  result.criteriaSha256 = digest(JSON.stringify(criteria));
  if (!bytes.length || bytes.length > BACKCHECK_LIMITS.bytes) {
    result.failures.push("backcheck_byte_limit"); return result;
  }
  const pdf = /\.pdf$/i.test(input.fileName);
  const textFormat = /\.(txt|md|markdown|html?|csv|json)$/i.test(input.fileName);
  let text = "";
  let links: string[] = [];
  if (pdf) {
    try {
      const inspected = await inspectPdf(bytes);
      text = inspected.text; links = inspected.links.map(l => l.url);
      result.pages = inspected.pages; result.coverage = "pdf_text_and_links";
      for (const page of inspected.pageTexts) {
        if (/\b(?:listen to (?:the )?(?:full )?report|play (?:the )?audio)\b/i.test(page.text) &&
            !inspected.links.some(l => l.page === page.page && /^https?:/.test(l.url))) result.failures.push("listening_link_missing");
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      result.failures.push(["backcheck_capacity", "backcheck_deadline"].includes(reason) ? reason : "pdf_inspection_failed");
      return result;
    }
  } else if (textFormat) {
    text = bytes.toString("utf8"); result.coverage = "text";
  } else result.coverage = "identity_only";
  if (result.coverage === "identity_only" && (criteria.requiredText?.length || criteria.expectedLinks?.length || criteria.minimumPages)) {
    result.failures.push("acceptance_checks_unsupported");
  }
  for (const [i, required] of (criteria.requiredText ?? []).entries()) {
    result.checkedTextRequirements++;
    if (!normalize(text).includes(normalize(required))) result.failures.push(`required_text_missing:${i}`);
  }
  for (const [i, expected] of (criteria.expectedLinks ?? []).entries()) {
    result.checkedLinkRequirements++;
    if (!pdf || !links.includes(new URL(expected).href)) result.failures.push(`expected_link_missing:${i}`);
  }
  if (criteria.minimumPages && (!result.pages || result.pages < criteria.minimumPages)) result.failures.push("minimum_pages_not_met");
  result.passed = result.failures.length === 0;
  return result;
}
