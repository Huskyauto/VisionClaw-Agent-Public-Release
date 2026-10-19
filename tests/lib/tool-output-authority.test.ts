import test from "node:test";
import assert from "node:assert/strict";
import {
  createToolOutputAuthority, withToolOutputAuthority, recordCommittedToolArtifact, getCommittedToolArtifact,
} from "../../server/lib/tool-output-authority";
import { inspectProducedArtifact } from "../../server/lib/tool-artifact-postflight";
import { attachProductVerification } from "../../server/tools/middleware/product-verification";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";

test("unrelated paths and forged handles cannot earn artifact verification",async()=>{
  const result={success:true,filePath:"uploads/unrelated.pdf"};
  assert.equal((await inspectProducedArtifact(result,1)).status,"unverified");
  assert.equal((await inspectProducedArtifact(result,1,{operation:Symbol()})).status,"unverified");
  const token=createToolOutputAuthority();
  withToolOutputAuthority(token,()=>recordCommittedToolArtifact({tenantId:1,logicalName:"actual.pdf",sha256:"a".repeat(64)}));
  assert.equal((await inspectProducedArtifact(result,1,token)).status,"unverified");
  assert.equal(getCommittedToolArtifact(token,2,"actual.pdf"),undefined);
});
test("concurrent operation authorities remain separate and ambiguous revisions degrade",async()=>{
  const a=createToolOutputAuthority(),b=createToolOutputAuthority();
  await Promise.all([[a,"a"],[b,"b"]].map(async([token,letter])=>withToolOutputAuthority(token as typeof a,async()=>{
    await new Promise(resolve=>setTimeout(resolve,1));
    recordCommittedToolArtifact({tenantId:1,logicalName:"same.pdf",sha256:String(letter).repeat(64)});
  })));
  assert.equal(getCommittedToolArtifact(a,1,"same.pdf")?.sha256,"a".repeat(64));
  assert.equal(getCommittedToolArtifact(b,1,"same.pdf")?.sha256,"b".repeat(64));
  withToolOutputAuthority(a,()=>recordCommittedToolArtifact({tenantId:1,logicalName:"same.pdf",sha256:"c".repeat(64)}));
  assert.equal(getCommittedToolArtifact(a,1,"same.pdf"),undefined);
});
test("legacy product presence check does not mutate frozen results or run accessors",()=>{
  const result=Object.freeze({success:true,drive_url:"https://example.com/report.pdf"});
  const out=attachProductVerification("create_pdf",result);
  assert.notEqual(out,result);assert.equal((result as any)._productVerification,undefined);
  assert.equal(out._productVerification.overallStatus,"BASIC_CHECKS_ONLY");
  let invoked=false;const value={get filePath(){invoked=true;throw Error("no")}};
  assert.doesNotThrow(()=>attachProductVerification("create_pdf",value));assert.equal(invoked,false);
});
test("action-bound actual PDF bytes pass; swapping a same-name file fails",async()=>{
  const {db}=await import("../../server/db");
  const {invalidateContractCache}=await import("../../server/deliverable-verifier");
  const select=db.select,execute=db.execute;
  (db as any).select=()=>({from:async()=>[{id:999,deliverableType:"pdf_document",requiredExtensions:[".pdf"],
    requiredMimePattern:"application/pdf",renderCheck:"pdf",minSizeBytes:null,maxSizeBytes:null}]});
  (db as any).execute=async()=>({rows:[{id:777}]});
  invalidateContractCache();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"tool-authority-"));
  try {
    const doc=await PDFDocument.create();doc.addPage().drawText("Aldon Company actual artifact");
    const bytes=Buffer.from(await doc.save()),file=path.join(dir,"report.pdf");
    fs.writeFileSync(file,bytes);
    const token=createToolOutputAuthority();
    withToolOutputAuthority(token,()=>recordCommittedToolArtifact({tenantId:1,logicalName:"report.pdf",
      sha256:createHash("sha256").update(bytes).digest("hex")}));
    const result={filePath:file,success:true};
    const good=await inspectProducedArtifact(result,1,token);
    assert.equal(good.status,"checked");assert.match(good.artifactSha256!,/^[a-f0-9]{64}$/);
    const other=await PDFDocument.create();other.addPage().drawText("Unrelated file");
    fs.writeFileSync(file,await other.save());
    assert.equal((await inspectProducedArtifact(result,1,token)).status,"failed");
    assert.equal((await inspectProducedArtifact(result,2,token)).status,"unverified");
  }finally{
    db.select=select;db.execute=execute;invalidateContractCache();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
