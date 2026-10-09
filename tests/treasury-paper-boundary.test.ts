import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { treasuryPaperSimulationTool } from "../server/tools/domains/treasury-paper/handlers";
import { normalizePaperOptions, replayPaper, derivePaperInvocationKey } from "../server/lib/treasury-paper-core";

test("missing trusted persona/tenant signals refuse forged params before any database or inference",async()=>{
  for(const ctx of [{},{tenantId:1},{tenantId:1,personaId:1},{tenantId:1,personaId:3}]){
    const result=await treasuryPaperSimulationTool.handler({action:"run",_tenantId:1,_personaId:2,options:{}},ctx);
    assert.match(String(result.error),/trusted/);
  }
});
test("identical tool retries preserve owner-bound identity; new owner messages/experiments differ",()=>{
  const options=normalizePaperOptions({});
  const key=derivePaperInvocationKey(1,2,3,options);
  assert.equal(derivePaperInvocationKey(1,2,3,normalizePaperOptions({symbol:"SPY"})),key);
  assert.notEqual(derivePaperInvocationKey(1,2,4,options),key);
  assert.notEqual(derivePaperInvocationKey(1,2,3,{...options,symbol:"AAPL"}),key);
});
test("whole-operation deadline prevents late setup from dispatching inference",async()=>{
  const {withPaperDeadline}=await import("../server/lib/treasury-paper-service");
  const controller=new AbortController();
  let called=0;
  const pending=new Promise<()=>void>(resolve=>setTimeout(()=>resolve(()=>called++),30));
  const timer=setTimeout(()=>controller.abort(),5);
  try {
    await assert.rejects((async()=>{const invoke=await withPaperDeadline(pending,controller.signal);invoke();})(),/deadline/);
    await new Promise(resolve=>setTimeout(resolve,40)); assert.equal(called,0);
  } finally {clearTimeout(timer);}
});
test("owner SQL claims are tenant-scoped, serialized, idempotent and replay-safe", {
  skip:process.env.RUN_PAPER_DB_TESTS!=="1" || process.env.NODE_ENV==="production",
},async()=>{
  const store=await import("../server/lib/treasury-paper-store");
  const {ownerTenantId}=await import("../server/agentic/autonomous-budget");
  const {pool}=await import("../server/db");
  const tid=ownerTenantId(),key=randomUUID(),options=normalizePaperOptions({});
  let id:string|undefined;
  try {
    assert.throws(()=>store.requirePaperOwner(tid+99999),/owner/);
    const first=await store.claimPaperRun(tid,key,options);id=first.run.id;
    assert.equal(first.claimed,true);
    const duplicate=await store.claimPaperRun(tid,key,options);
    assert.equal(duplicate.claimed,false);assert.equal(duplicate.run.id,id);
    await assert.rejects(store.claimPaperRun(tid,key,{...options,symbol:"AAPL"}),/conflicts/);
    await assert.rejects(store.claimPaperRun(tid,randomUUID(),options),/running/);
    await assert.rejects(store.getPaperRun(tid+99999,id),/owner/);
    const bars=Array.from({length:70},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10),open:100+i,high:102+i,low:99+i,close:101+i,volume:1000}));
    await store.savePaperBars(tid,id,bars);
    await store.finishPaperRun(tid,id,await replayPaper(bars,options),null);
    const review=await store.claimPaperReview(tid,id);assert.equal(review.claimed,true);
    await store.assertPaperReviewLease(tid,id);
    assert.equal((await store.claimPaperReview(tid,id)).claimed,false);
    await store.finishPaperReview(tid,id,null,"Synthetic stopped review (no provider was called)");
    assert.equal((await store.claimPaperReview(tid,id)).claimed,false); // failed review cannot respawn spend
    const done=await store.getPaperRun(tid,id);assert.equal(done.status,"completed");assert.equal(done.reviewing,false);
    assert.equal((await store.claimPaperRun(tid,key,options)).claimed,false); // terminal run retry cannot respawn spend
    await assert.rejects(store.assertPaperReviewLease(tid,id),/eligible/);
    const row=await pool.query("SELECT options FROM treasury_paper_runs WHERE tenant_id=$1 AND id=$2",[tid,id]);
    assert.deepEqual(row.rows[0].options,options);
  } finally {
    if(id)await pool.query("DELETE FROM treasury_paper_runs WHERE tenant_id=$1 AND id=$2 AND request_key=$3",[tid,id,key]);
  }
});
