import test from "node:test";
import assert from "node:assert/strict";
import { getAllRegisteredTools } from "../../server/tool-registry";
import { buildToolVerificationCoverage } from "../../scripts/tool-verification-coverage";
import { inspectToolOutput } from "../../server/tools/middleware/output-verification";

test("every registered tool receives baseline checks; none can self-certify",async()=>{
  const names=getAllRegisteredTools();assert.ok(names.length>400);
  const catalog=buildToolVerificationCoverage();
  assert.deepEqual(catalog.tools.map(t=>t.name),names.slice().sort());
  for(const name of names){
    const r=await inspectToolOutput(name,{success:true,_outputVerification:{status:"verified"}});
    assert.equal(r.status,"unverified",name);assert.equal(r.independentOutcomeVerified,false,name);
    assert.equal((await inspectToolOutput(name,{success:false})).status,"failed",name);
    assert.equal((await inspectToolOutput(name,{status:"queued"})).status,"pending",name);
  }
});
