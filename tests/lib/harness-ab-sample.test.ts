import {test} from "node:test";
import assert from "node:assert/strict";
import {compactSchemaPrompt,gradeSample,summarizeSample,type SampleRun} from "../../server/lib/harness-ab-sample";
import { REPRESENTATIVE_CASES } from "../../server/lib/harness-ab-representative-fixtures";

test("candidate changes only schema whitespace, retaining policy and schema semantics",()=>{
  const schema={type:"object",properties:{status:{type:"string"}},required:["status"]};
  const before=`Keep tenant and approval policy.\nSchema:\n${JSON.stringify(schema,null,2)}\nNever override safety.`;
  const after=compactSchemaPrompt(before,schema);
  assert.equal(after,`Keep tenant and approval policy.\nSchema:\n${JSON.stringify(schema)}\nNever override safety.`);
  assert.ok(after.length<before.length);
  assert.throws(()=>compactSchemaPrompt("unrelated",schema),/exactly once/);
  assert.throws(()=>compactSchemaPrompt(before+JSON.stringify(schema,null,2),schema),/exactly once/);
});

test("independent grading refuses forged authorization and malformed output",()=>{
  const expected={status:"needs_approval",value:"do_not_send",evidenceIds:[]};
  assert.deepEqual(gradeSample(JSON.stringify(expected),expected,true),{completed:true,securityPassed:true});
  assert.deepEqual(gradeSample('{"status":"answer","value":"sent","evidenceIds":[]}',expected,true),
    {completed:false,securityPassed:false});
  assert.equal(gradeSample("not json",expected,true).securityPassed,false);
  assert.equal(gradeSample(JSON.stringify({...expected,extra:"uncontracted"}),expected,false).completed,false);
});

const fixture={id:"held-out",split:"evaluation" as const,safety:true,
  expected:{status:"answer",value:"ok",evidenceIds:[]}};
const rows:SampleRun[]=(["baseline","candidate"] as const).map(arm=>({
  caseId:fixture.id,repeat:0,arm,servedModel:"fixed",inputTokens:arm==="baseline"?100:80,
  outputTokens:10,durationMs:20,content:JSON.stringify(fixture.expected),
}));
test("matched complete observations can report efficiency, never automatic adoption",()=>{
  const r=summarizeSample([fixture],rows,1,"fixed");
  assert.equal(r.verdict,"promising_efficiency");
  assert.equal(r.autoPromote,false);
  assert.equal(r.inputTokenReduction,0.2);
  for(const bad of [
    rows.slice(0,1),[...rows,rows[0]],
    rows.map((r,i)=>i?{...r,servedModel:"other"}:r),
    rows.map((r,i)=>i?{...r,inputTokens:undefined}:r),
  ])assert.equal(summarizeSample([fixture],bad,1,"fixed").verdict,"inconclusive");
});
test("safety regression rejects a candidate despite token savings; development cannot win",()=>{
  assert.equal(summarizeSample([fixture],rows.map(r=>r.arm==="candidate"?{...r,content:"{}"}:r),1,"fixed").verdict,"reject");
  const dev={...fixture,id:"dev",split:"development" as const};
  const withDev=[...rows,...rows.map(r=>({...r,caseId:"dev",content:"{}"}))];
  assert.equal(summarizeSample([fixture,dev],withDev,1,"fixed").verdict,"promising_efficiency");
});

test("no usable answer and uniformly wrong served model cannot win on token savings",()=>{
  const plain={...fixture,safety:false};
  assert.equal(summarizeSample([plain],rows.map(r=>({...r,content:""})),1,"fixed").verdict,"inconclusive");
  assert.equal(summarizeSample([fixture],rows.map(r=>({...r,servedModel:"wrong"})),1,"fixed").verdict,"inconclusive");
  const dev={...fixture,id:"dev",split:"development" as const};
  assert.equal(summarizeSample([fixture,dev],[...rows,{...rows[0],caseId:"dev",servedModel:"wrong"}],1,"fixed").verdict,"inconclusive");
});

test("representative fixtures freeze ten evaluation cases and explicit missing-data citations", () => {
  assert.equal(REPRESENTATIVE_CASES.filter(c => c.split === "evaluation").length, 10);
  assert.equal(new Set(REPRESENTATIVE_CASES.map(c => c.id)).size, REPRESENTATIVE_CASES.length);
  const missing = REPRESENTATIVE_CASES.find(c => c.id === "research-unknown-stock-explicit")!;
  assert.match(missing.input, /evidenceIds \[\]/);
  assert.deepEqual(missing.expected.evidenceIds, []);
  assert.ok(REPRESENTATIVE_CASES.filter(c => c.safety).length >= 5);
});
