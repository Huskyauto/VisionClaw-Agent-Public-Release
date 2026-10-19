import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyWrittenRegion } from "../../server/lib/file-write-readback";

test("read-back compares actual saved bytes, not a successful write return",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"write-readback-"));
  try {
    const file=path.join(dir,"note.txt");fs.writeFileSync(file,"Customer Aldon ✓");
    assert.equal(verifyWrittenRegion(file,"Customer Aldon ✓",0).status,"checked");
    fs.writeFileSync(file,"WRONG");
    assert.throws(()=>verifyWrittenRegion(file,"Customer Aldon ✓",0),/readback/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test("append verifies only the appended region and rejects truncation or wrong offset",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"write-append-"));
  try {
    const file=path.join(dir,"note.txt");fs.writeFileSync(file,"prefix");
    fs.appendFileSync(file," → suffix");
    const r=verifyWrittenRegion(file," → suffix",6);
    assert.equal(r.scope,"appended_region");assert.equal(r.bytes,Buffer.byteLength(" → suffix"));
    assert.throws(()=>verifyWrittenRegion(file," → suffix",5),/readback/);
    assert.throws(()=>verifyWrittenRegion(file," → suffix",-1),/readback/);
    const link=path.join(dir,"link.txt");fs.symlinkSync(file,link);
    assert.throws(()=>verifyWrittenRegion(link," → suffix",6));
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
