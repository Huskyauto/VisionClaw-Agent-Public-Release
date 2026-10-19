import test from "node:test";
import assert from "node:assert/strict";
import { inspectToolOutput, postflightToolOutput } from "../../server/tools/middleware/output-verification";

test("a success flag and URL alone never prove the requested outcome",async()=>{
  const r=await inspectToolOutput("send_message",{success:true,url:"https://example.com",_outputVerification:{status:"verified"}});
  assert.equal(r.status,"unverified");
  assert.equal(r.independentOutcomeVerified,false);
  assert.equal(r.checks.some(c=>c.code==="result_structure"&&c.status==="checked"),true);
});
test("false success, contradictions and invalid numbers never become checked",async()=>{
  for(const value of [{success:false},{success:true,error:"provider rejected"},{score:NaN},{count:Infinity},undefined]){
    assert.equal((await inspectToolOutput("any_tool",value)).status,"failed");
  }
});
test("queued work remains pending and cannot trigger artifact inspection",async()=>{
  let called=0;
  const r=await inspectToolOutput("produce_video",{status:"queued",success:true},{productOutput:true,inspectArtifact:async()=>{called++;return{status:"checked"}}});
  assert.equal(r.status,"pending");assert.equal(called,0);assert.equal(r.retryOriginalAction,false);
});
test("array, primitive, frozen object, empty reads and optional fields preserve compatibility",async()=>{
  for(const value of [[],[1,2],"hello",0,null]){
    const r=await postflightToolOutput("read_tool",value);
    assert.equal(r.result,value);assert.notEqual(r.report.status,"failed");
  }
  const value=Object.freeze({success:true,optional:undefined,_outputVerification:{status:"verified"}});
  const r=await postflightToolOutput("unknown_future_tool",value);
  assert.equal(r.report.status,"unverified");
  assert.equal((r.result as any)._outputVerification.version,1);
  assert.equal(value._outputVerification.status,"verified");
});
test("inspection errors cannot discard an already-completed action or invite retry",async()=>{
  const r=await postflightToolOutput("create_pdf",{success:true},{productOutput:true,inspectArtifact:async()=>{throw Error("unavailable")}});
  assert.equal(r.report.status,"unverified");assert.equal((r.result as any).success,true);assert.equal(r.report.retryOriginalAction,false);
});
test("only a real supplied artifact check supports its limited contract scope",async()=>{
  const r=await inspectToolOutput("create_pdf",{success:true},{productOutput:true,inspectArtifact:async()=>({status:"checked",artifactSha256:"a".repeat(64)})});
  assert.equal(r.status,"checked");assert.equal(r.scope,"artifact_contract");assert.equal(r.independentOutcomeVerified,false);
  const failed=await inspectToolOutput("create_pdf",{success:true},{productOutput:true,inspectArtifact:async()=>({status:"failed"})});
  assert.equal(failed.status,"failed");
});
test("cyclic/accessor outputs fail safely without evaluating a getter",async()=>{
  const cycle:any={};cycle.self=cycle;
  assert.equal((await inspectToolOutput("tool",cycle)).status,"failed");
  let invoked=false;const value={get bad(){invoked=true;throw Error("no")}};
  assert.equal((await inspectToolOutput("tool",value)).status,"failed");assert.equal(invoked,false);
});
test("large results stop at a bounded check rather than claiming full coverage",async()=>{
  const r=await inspectToolOutput("search",{rows:Array.from({length:1000},(_,i)=>({id:i}))});
  assert.equal(r.status,"unverified");assert.ok(r.checks.some(c=>c.code==="structure_budget_exceeded"));
});
test("an unreadable producer cannot preserve a forged checked receipt through fallback",async()=>{
  const value=new Proxy({_outputVerification:{status:"checked"}},{ownKeys(){throw Error("unreadable")}});
  const out=await postflightToolOutput("producer",value);
  assert.equal(out.report.status,"unverified");
  assert.equal((out.result as any)._outputVerification.status,"unverified");
});
