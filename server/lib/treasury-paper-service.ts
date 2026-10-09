import type { PaperRun, PaperSnapshot } from "../../shared/treasury-paper-contract";
import { normalizePaperOptions, replayPaper, validatePaperBars, paperReviewParameters } from "./treasury-paper-core";
import { fetchPriceHistoryWithSource } from "../treasury";
import { askTypeSafeJev, getTypeSafeJevStatus } from "../typesafe-jev";
import { withTenantContext } from "./tenant-context";
import { getClientForModel } from "../providers";
import { claimPaperRun, getPaperRun, savePaperBars, finishPaperRun, requirePaperEnabled,
  claimPaperReview, finishPaperReview, assertPaperReviewLease } from "./treasury-paper-store";

export const paperStatus = () => ({ enabled:process.env.TREASURY_PAPER_DISABLED!=="1",jevReady:getTypeSafeJevStatus().ready });
async function jevJudge(snapshot:PaperSnapshot, signal:AbortSignal) {
  requirePaperEnabled();
  if(signal.aborted) throw new Error("Simulation deadline reached");
  const started=Date.now();
  const response=await askTypeSafeJev({
    state:{...snapshot,entryAllocationPct:25,maxDrawdownPct:10},
    questions:{
      direction:{type:"choice",instructions:"Using only this causal numeric snapshot, classify whether the next daily close is more likely above or below the current close. This is an uncalibrated research judgment.",criteria:{up:"Next daily close above current close",down:"Next daily close at or below current close"}},
      regime:{type:"choice",instructions:"Describe this snapshot's regime without future information.",criteria:{trend:"Directional momentum",flat:"No clear directional trend",volatile:"High uncertainty or volatility"}},
      risk:{type:"noul",instructions:"Is this snapshot too uncertain or volatile to justify even a 25% long-only simulated allocation? Judge uncertainty, not authorization."},
    },
  },fetch,signal);
  const d=response.answers.direction, risk=response.answers.risk;
  const probability=d.probabilities?.up;
  return {target:d.choice==="up" && typeof risk.noul==="number" && risk.noul<0.5?"long" as const:"cash" as const,
    probability,confidence:d.confidence,inputTokens:response.usage.input_tokens,outputTokens:response.usage.output_tokens,
    latencyMs:Date.now()-started,servedModel:response.model,regime:response.answers.regime.choice,riskProbability:risk.noul};
}
async function execute(tenantId:number,run:PaperRun) {
  const deadline=AbortSignal.timeout(120000);
  try {
    requirePaperEnabled();
    const source=await fetchPriceHistoryWithSource(run.options.symbol);
    const bars=source.bars.filter(b=>b.date<new Date().toISOString().slice(0,10)).slice(-90);
    validatePaperBars(bars);
    await savePaperBars(tenantId,run.id,bars);
    const result=await replayPaper(bars,run.options,run.options.mode==="jev_shadow"?async snapshot=>{
      if(deadline.aborted) throw new Error("Deadline");
      return jevJudge(snapshot,deadline);
    }:undefined);
    result.dataSource=source.source; result.fetchedAt=source.fetchedAt;
    result.ageCalendarDays=Math.floor((Date.now()-Date.parse(result.endDate))/86400000);
    await finishPaperRun(tenantId,run.id,result,null);
  } catch(error) {
    await finishPaperRun(tenantId,run.id,null,(error instanceof Error?error.message:"Simulation failed").slice(0,500));
  }
}
export async function startPaperRun(tenantId:number,key:string,input:unknown):Promise<PaperRun> {
  const options=normalizePaperOptions(input);
  const claim=await claimPaperRun(tenantId,key,options);
  if(claim.claimed) void withTenantContext({tenantId,source:"explicit"},()=>execute(tenantId,claim.run)).catch(error=>console.error("[treasury-paper] terminal persistence failed",error instanceof Error?error.message:"unknown"));
  return claim.run;
}
async function executeReview(tenantId:number,run:PaperRun) {
  const deadline=AbortSignal.timeout(120000);
  try {
    requirePaperEnabled();
    const r=run.result!;
    const summary={symbol:r.options.symbol,strategy:r.strategyVersion,window:[r.startDate,r.endDate],rule:r.rule.metrics,
      benchmark:r.benchmark.metrics,shadow:r.shadow?{metrics:r.shadow.metrics,coverage:r.shadow.coverage,brier:r.shadow.directionBrierScore}:null,
      excessReturnPct:r.excessReturnPct,limitations:r.limitations};
    const requestedModel="meta/muse-spark-1.3";
    const {client,actualModelId}=await withPaperDeadline(getClientForModel(requestedModel,tenantId),deadline);
    await withPaperDeadline(assertPaperReviewLease(tenantId,run.id),deadline);
    if(deadline.aborted) throw new Error("Review operation deadline reached; no retry");
    const response=await withPaperDeadline(client.chat.completions.create({
      model:actualModelId,...paperReviewParameters(actualModelId),
      messages:[{role:"system",content:"Interpret only these deterministic historical paper-simulation measurements. Do not recompute or invent results, endorse real-money trades, or call probabilities calibrated. Explain costs, incomplete coverage, sample limitations and baseline comparison. Suggestions are staged research only; no promotion or changes to rules."},
        {role:"user",content:JSON.stringify(summary)}],
    },{signal:AbortSignal.any([deadline,AbortSignal.timeout(45000)]),maxRetries:0}),deadline);
    const text=response.choices?.[0]?.message?.content;
    if(typeof text!=="string" || !text.trim()) throw new Error("Review model returned no interpretation");
    await finishPaperReview(tenantId,run.id,{requestedModel,servedModel:response.model||actualModelId,text:text.slice(0,12000),interpretationOnly:true},null);
  } catch(error) {
    await finishPaperReview(tenantId,run.id,null,(error instanceof Error?error.message:"Review failed").slice(0,500));
  }
}
export async function withPaperDeadline<T>(promise:PromiseLike<T>,signal:AbortSignal):Promise<T> {
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>reject(new Error("Paper operation deadline reached; no automatic retry"));
    if(signal.aborted) {
      Promise.resolve(promise).catch(()=>undefined); abort(); return;
    }
    signal.addEventListener("abort",abort,{once:true});
    Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
  });
}
export async function startPaperReview(tenantId:number,id:string):Promise<PaperRun> {
  const claim=await claimPaperReview(tenantId,id);
  if(claim.claimed) void withTenantContext({tenantId,source:"explicit"},()=>executeReview(tenantId,claim.run)).catch(error=>console.error("[treasury-paper] review persistence failed",error instanceof Error?error.message:"unknown"));
  return getPaperRun(tenantId,id);
}
