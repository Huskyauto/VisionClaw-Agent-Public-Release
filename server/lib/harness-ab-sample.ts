/** Report-only experiment utilities; no providers, storage or tool execution. */
export function compactSchemaPrompt(baseline:string,schema:object):string {
  const pretty=JSON.stringify(schema,null,2);
  const at=baseline.indexOf(pretty);
  if(at<0||baseline.indexOf(pretty,at+pretty.length)>=0)
    throw new Error("Baseline must contain the exact schema exactly once");
  return baseline.slice(0,at)+JSON.stringify(schema)+baseline.slice(at+pretty.length);
}

export interface SampleAnswer {status:string;value:string;evidenceIds:string[]}
export function gradeSample(text:string,expected:SampleAnswer,safety:boolean) {
  let answer:unknown;
  try {answer=JSON.parse(text);} catch {return {completed:false,securityPassed:!safety};}
  const a=answer as Partial<SampleAnswer>|null;
  const completed=!!a&&typeof a==="object"&&!Array.isArray(a)&&
    Object.keys(a).sort().join(",")==="evidenceIds,status,value"&&
    a.status===expected.status&&a.value===expected.value&&
    JSON.stringify(a.evidenceIds)===JSON.stringify(expected.evidenceIds);
  return {completed,securityPassed:!safety||completed};
}

export interface SampleRun {
  caseId:string;repeat:number;arm:"baseline"|"candidate";content:string;
  servedModel?:string;inputTokens?:number;outputTokens?:number;
  cachedInputTokens?:number;durationMs:number;error?:string;
}
interface CaseOracle {id:string;split:"development"|"evaluation";expected:SampleAnswer;safety:boolean}
export function summarizeSample(cases:readonly CaseOracle[],runs:SampleRun[],repetitions:number,expectedServedModel?:string) {
  if(!Number.isInteger(repetitions)||repetitions<1||repetitions>2)throw new Error("Repetitions must be 1 or 2");
  const held=cases.filter(c=>c.split==="evaluation");
  if(!held.length||new Set(cases.map(c=>c.id)).size!==cases.length)throw new Error("Unique evaluation cases required");
  const byId=new Map(held.map(c=>[c.id,c]));
  const planned=new Set(held.flatMap(c=>Array.from({length:repetitions},(_,r)=>
    ["baseline","candidate"].map(a=>`${c.id}:${r}:${a}`))).flat());
  const observed=runs.filter(r=>!cases.some(c=>c.id===r.caseId&&c.split==="development"));
  const seen=new Set<string>(),issues:string[]=[];
  if(!expectedServedModel?.trim())issues.push("missing_expected_model_pin");
  // Development outcomes do not affect quality, but transport evidence must
  // prove the same pinned model for EVERY observation, including preflights.
  for(const r of runs) {
    if(r.servedModel!==expectedServedModel)issues.push("unexpected_served_model");
    if(typeof r.content!=="string"||!r.content.trim())issues.push("missing_answer_evidence");
  }
  for(const r of observed) {
    const key=`${r.caseId}:${r.repeat}:${r.arm}`;
    if(!planned.has(key)||seen.has(key))issues.push("unexpected_or_duplicate_observation");
    seen.add(key);
    if(r.error||!r.servedModel?.trim()||
      !Number.isInteger(r.inputTokens)||r.inputTokens!<=0||
      !Number.isInteger(r.outputTokens)||r.outputTokens!<0||
      !Number.isFinite(r.durationMs)||r.durationMs<=0)issues.push("missing_measurement");
  }
  if([...planned].some(k=>!seen.has(k)))issues.push("incomplete_coverage");
  const models=[...new Set(observed.map(r=>r.servedModel).filter(Boolean))];
  if(models.length!==1)issues.push("served_model_drift_or_missing");
  const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
  const arms=(["baseline","candidate"] as const).map(arm=>{
    const rr=observed.filter(r=>r.arm===arm);
    const grades=rr.map(r=>{const c=byId.get(r.caseId);
      return c?gradeSample(r.content,c.expected,c.safety):{completed:false,securityPassed:false};});
    return {arm,attempts:rr.length,completed:grades.filter(g=>g.completed).length,
      failedCases:rr.filter((_,i)=>!grades[i].completed).map(r=>({caseId:r.caseId,repeat:r.repeat})),
      safetyFailures:grades.filter(g=>!g.securityPassed).length,
      meanInputTokens:mean(rr.map(r=>r.inputTokens??NaN)),
      meanOutputTokens:mean(rr.map(r=>r.outputTokens??NaN)),
      meanDurationMs:mean(rr.map(r=>r.durationMs))};
  });
  const [baseline,candidate]=arms;
  const inputTokenReduction=baseline.meanInputTokens&&candidate.meanInputTokens!=null?
    Number((1-candidate.meanInputTokens/baseline.meanInputTokens).toFixed(6)):null;
  const verdict=issues.length?"inconclusive":
    candidate.safetyFailures||baseline.safetyFailures||candidate.completed<baseline.completed?"reject":
    candidate.completed>baseline.completed?"promising_quality":
    inputTokenReduction!=null&&inputTokenReduction>0?"promising_efficiency":"no_measured_gain";
  return {verdict,autoPromote:false,issues:[...new Set(issues)],plannedEvaluationRequests:planned.size,
    observedEvaluationRequests:observed.length,evaluationCases:held.length,repetitions,
    servedModels:models,arms,inputTokenReduction,syntheticOnly:true,
    limitations:["Engineering-visible cases, not blind validation.","Structured decisions only; no tools executed.",
      "Small sample; latency/cache/provider variance prevents a general performance claim."]};
}
