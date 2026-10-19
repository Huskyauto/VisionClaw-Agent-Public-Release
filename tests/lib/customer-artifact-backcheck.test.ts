import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { assertBackcheckIdentity, assertCompletedPackageIdentity, backcheckCustomerArtifact, retainedAcceptanceCriteria } from "../../server/lib/customer-artifact-backcheck";

const audio = "https://drive.google.com/file/d/recording-one/view";
async function pdf(text: string, link?: string, outside=false) {
  const d=await PDFDocument.create(),p=d.addPage([612,792]);
  const font=await d.embedFont(StandardFonts.Helvetica);
  p.drawText(text,{x:40,y:700,size:12,font});
  if(link) p.node.set(PDFName.of("Annots"),d.context.obj([d.context.register(d.context.obj({
    Type:"Annot",Subtype:"Link",Rect:outside?[700,600,760,630]:[40,680,450,730],
    A:{S:"URI",URI:PDFString.of(link)},
  }))]));
  return Buffer.from(await d.save());
}
test("valid report satisfies requirements and binds exact bytes",async()=>{
  const bytes=await pdf("LISTEN TO THE FULL REPORT. Customer: Aldon",audio);
  const r=await backcheckCustomerArtifact({bytes,fileName:"report.pdf",criteria:{requiredText:["Customer: Aldon"],expectedLinks:[audio],minimumPages:1}});
  assert.equal(r.passed,true,JSON.stringify(r));
  assert.match(r.artifactSha256,/^[a-f0-9]{64}$/);assert.equal(r.coverage,"pdf_text_and_links");
  const changed=await backcheckCustomerArtifact({bytes:await pdf("Changed"),fileName:"report.pdf"});
  assert.notEqual(r.artifactSha256,changed.artifactSha256);
});
test("PDF signature alone is not a valid report",async()=>{
  const r=await backcheckCustomerArtifact({bytes:Buffer.from("%PDF-1.7\n"+"fake ".repeat(300)),fileName:"report.pdf"});
  assert.equal(r.passed,false);
});
test("printed listening promise without a clickable link fails",async()=>{
  const r=await backcheckCustomerArtifact({bytes:await pdf("LISTEN TO THE FULL REPORT"),fileName:"report.pdf"});
  assert.equal(r.passed,false);assert.ok(r.failures.includes("listening_link_missing"));
});
test("wrong recording and missing requested customer are rejected",async()=>{
  const r=await backcheckCustomerArtifact({bytes:await pdf("Customer: Other",audio),fileName:"report.pdf",
    criteria:{requiredText:["Customer: Aldon"],expectedLinks:["https://example.com/correct.mp3"]}});
  assert.equal(r.passed,false);assert.ok(r.failures.includes("required_text_missing:0"));assert.ok(r.failures.includes("expected_link_missing:0"));
});
test("off-page annotations do not count as clickable links",async()=>{
  const r=await backcheckCustomerArtifact({bytes:await pdf("LISTEN TO THE FULL REPORT",audio,true),fileName:"report.pdf",criteria:{expectedLinks:[audio]}});
  assert.equal(r.passed,false);
});
test("malformed criteria fail closed, rather than silently becoming empty",async()=>{
  for(const criteria of [null,[],{requiredText:"Aldon"},{minimumPages:"2"},{expectedLinks:["javascript:alert(1)"]},{unknown:true}]){
    const r=await backcheckCustomerArtifact({bytes:Buffer.from("Customer: Aldon"),fileName:"report.txt",criteria});
    assert.equal(r.passed,false,JSON.stringify(criteria));
  }
});
test("plain text criteria work; unsupported checks remain explicit",async()=>{
  assert.equal((await backcheckCustomerArtifact({bytes:Buffer.from("Customer: Aldon"),fileName:"report.md",criteria:{requiredText:["Customer: Aldon"]}})).passed,true);
  assert.equal((await backcheckCustomerArtifact({bytes:Buffer.from("binary"),fileName:"video.mp4",criteria:{requiredText:["Aldon"]}})).passed,false);
  const r=await backcheckCustomerArtifact({bytes:Buffer.from("binary"),fileName:"video.mp4"});
  assert.equal(r.coverage,"identity_only");assert.equal(r.passed,true);
});
test("replays retain requirements and cannot weaken or add them to an old receipt",()=>{
  const saved={requiredText:["Aldon"],expectedLinks:[audio]};
  const metadata={_customerAcceptanceCriteria:saved};
  assert.deepEqual(retainedAcceptanceCriteria(undefined,metadata),saved);
  assert.deepEqual(retainedAcceptanceCriteria(saved,metadata),saved);
  assert.throws(()=>retainedAcceptanceCriteria({},metadata),/changed/);
  assert.throws(()=>retainedAcceptanceCriteria(saved,{}),/changed/);
  assert.throws(()=>retainedAcceptanceCriteria(undefined,{_customerAcceptanceCriteria:null}),/invalid/);
});
test("PDF page requirement is enforced and receipts bind criteria",async()=>{
  const bytes=await pdf("Customer Aldon");
  const one=await backcheckCustomerArtifact({bytes,fileName:"one.pdf",criteria:{minimumPages:1}});
  const two=await backcheckCustomerArtifact({bytes,fileName:"two.pdf",criteria:{minimumPages:2}});
  assert.equal(one.passed,true);assert.equal(two.passed,false);
  assert.equal(one.artifactSha256,two.artifactSha256);assert.notEqual(one.criteriaSha256,two.criteriaSha256);
});
test("accepted bytes must also match the immutable durable intent and changed sources fail",async()=>{
  const bytes=Buffer.from("Aldon Company requirements");
  const receipt=await backcheckCustomerArtifact({bytes,fileName:"report.txt",criteria:{requiredText:["Aldon Company"]}});
  assert.doesNotThrow(()=>assertBackcheckIdentity(bytes,receipt,receipt.artifactSha256));
  assert.throws(()=>assertBackcheckIdentity(Buffer.from("replaced"),receipt,receipt.artifactSha256),/identity_mismatch/);
  assert.throws(()=>assertBackcheckIdentity(bytes,receipt,"0".repeat(64)),/identity_mismatch/);
  assert.throws(()=>assertBackcheckIdentity(bytes,{...receipt,passed:false},receipt.artifactSha256),/identity_mismatch/);
});
test("source-less completed lookups still enforce filenames and full companion composition",()=>{
  const records=[
    {logicalName:"report.pdf",sha256:"0".repeat(64),idempotencyKey:"delivery-artifact:42:primary"},
    {logicalName:"recording.mp3",sha256:"1".repeat(64),idempotencyKey:"delivery-artifact:42:bundle:0"},
  ];
  assert.doesNotThrow(()=>assertCompletedPackageIdentity([{fileName:"report.pdf"},{fileName:"recording.mp3"}],records,42));
  assert.throws(()=>assertCompletedPackageIdentity([{fileName:"other.pdf"},{fileName:"recording.mp3"}],records,42),/identity_mismatch/);
  assert.throws(()=>assertCompletedPackageIdentity([{fileName:"report.pdf"}],records,42),/identity_mismatch/);
  assert.throws(()=>assertCompletedPackageIdentity([{fileName:"report.pdf"},{fileName:"other.mp3"}],records,42),/identity_mismatch/);
  assert.throws(()=>assertCompletedPackageIdentity([{fileName:"report.pdf"},{fileName:"recording.mp3",bytes:Buffer.from("changed")}],records,42),/identity_mismatch/);
});
