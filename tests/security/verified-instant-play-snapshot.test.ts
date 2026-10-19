import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { attachInstantPlayUrls } from "../../server/tools/middleware/instant-play";
import { publishVerifiedMediaSnapshot } from "../../server/instant-play";

test("conflicting path aliases and symlink cannot change the published snapshot",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"uninspected-media-"));
  const evil=path.join(dir,"not-verified.mp3");
  const link=path.join(process.cwd(),"uploads",`snapshot-test-${randomUUID()}.mp3`);
  let publicFile:string|undefined;
  try {
    fs.writeFileSync(evil,"UNINSPECTED BYTES");
    fs.mkdirSync(path.dirname(link),{recursive:true});fs.symlinkSync(evil,link);
    const bytes=Buffer.from("VERIFIED SNAPSHOT");
    const out=await attachInstantPlayUrls("generate_audio",{
      success:true,filePath:"uploads/verified.mp3",file_path:link,
    },{_publishInstantPlay:true},{bytes,fileName:"verified.mp3",sha256:createHash("sha256").update(bytes).digest("hex")});
    assert.equal(typeof out.watch_url,"string");
    const name=new URL(out.watch_url).pathname.split("/").pop()!;
    publicFile=path.join(process.cwd(),"public","videos",name);
    assert.deepEqual(fs.readFileSync(publicFile),bytes);
    assert.notEqual(fs.readFileSync(publicFile).toString(),"UNINSPECTED BYTES");
  }finally{
    fs.rmSync(link,{force:true});fs.rmSync(dir,{recursive:true,force:true});
    if(publicFile)fs.rmSync(publicFile,{force:true});
  }
});
test("no snapshot or mismatched digest cannot publish media",async()=>{
  const result={success:true,file_path:"uploads/untrusted.mp3"};
  assert.equal(await attachInstantPlayUrls("generate_audio",result,{_publishInstantPlay:true}),result);
  assert.equal(await publishVerifiedMediaSnapshot({bytes:Buffer.from("bad"),fileName:"bad.mp3",sha256:"0".repeat(64)}),null);
});
