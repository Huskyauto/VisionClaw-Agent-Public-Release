#!/usr/bin/env -S npx tsx
/** Owner-run synthetic sample. No tool execution, promotion, or model fallback. */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import {compactSchemaPrompt,summarizeSample,type SampleRun} from "../server/lib/harness-ab-sample";
import {SAMPLE_CASES,SAMPLE_SCHEMA,SAMPLE_POLICY} from "../server/lib/harness-ab-fixtures";
import {REPRESENTATIVE_CASES} from "../server/lib/harness-ab-representative-fixtures";

const args=process.argv.slice(2);
const representative=args.length===2&&args[0]==="--run"&&args[1]==="--representative";
if(!representative&&(args.length!==1||args[0]!=="--run")) {
  console.log("Usage: npx tsx scripts/harness-ab-sample.ts --run [--representative]");
  console.log("44 bounded synthetic requests; pinned Replit / gpt-5.4; native usage charges apply; report-only.");
  process.exit(args.length?1:0);
}
const cases=representative?REPRESENTATIVE_CASES:SAMPLE_CASES;
const MODEL="gpt-5.4",REPETITIONS=2,MAX_CALLS=44;
// Publisher snapshot mapping: https://developers.openai.com/api/docs/models/gpt-5.4
// Explicit exact identity, never "whatever model the first response reports".
const EXPECTED_SERVED_MODEL="gpt-5.4-2026-03-05";
const root=path.resolve("generated-artifacts/harness-ab-sample");
fs.mkdirSync(root,{recursive:true});
const out=fs.mkdtempSync(path.join(root,"run-"));
const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2),{flag:"wx"});
const digest=(x:unknown)=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const runs:SampleRun[]=[];
let outcomeError:string|undefined;
try {
  const {buildLlmTaskSystemContent}=await import("../server/llm-task");
  const {getClientForModel}=await import("../server/providers");
  const {withTenantContext}=await import("../server/lib/tenant-context");
  const baseline=buildLlmTaskSystemContent({schema:SAMPLE_SCHEMA,trustedSystemInstruction:SAMPLE_POLICY});
  const candidate=compactSchemaPrompt(baseline,SAMPLE_SCHEMA);
  const manifest={model:MODEL,provider:"replit",tenantId:1,repetitions:REPETITIONS,maxCalls:MAX_CALLS,
    expectedServedModel:EXPECTED_SERVED_MODEL,
    maxOutputTokens:512,temperature:0,reasoningEffort:"none",timeoutMs:60000,sdkRetries:0,
    reportOnly:true,baseline,candidate,createdAt:new Date().toISOString(),
    fixtureDigest:digest(cases),baselineDigest:digest(baseline),candidateDigest:digest(candidate),
    profile:representative?"representative-v1":"original-v1",
    cases,scope:"Production structured-task formatter only; adaptive model addenda disabled in both arms."};
  write("manifest.json",manifest);
  console.log(`[harness-ab] output=${path.relative(process.cwd(),out)} prompt characters ${baseline.length} -> ${candidate.length}`);
  await withTenantContext({tenantId:1,source:"explicit"},async()=>{
    const {client,actualModelId}=await getClientForModel(MODEL,1,{
      requiresTools:false,providerLane:"replit",forbidMeteredFallback:true,
    });
    for(const [index,c] of cases.entries()) {
      const repeats=c.split==="development"?1:REPETITIONS;
      for(let repeat=0;repeat<repeats;repeat++) {
        const order=(index+repeat)%2===0?["baseline","candidate"] as const:["candidate","baseline"] as const;
        for(const arm of order) {
          if(runs.length>=MAX_CALLS)throw new Error("Hard request ceiling reached");
          const started=performance.now();
          let row:SampleRun;
          try {
            const response=await client.chat.completions.create({
              model:actualModelId,stream:false,temperature:0,max_completion_tokens:512,reasoning_effort:"none",
              response_format:{type:"json_object"},
              messages:[{role:"system",content:arm==="baseline"?baseline:candidate},{role:"user",content:c.input}],
            },{maxRetries:0,signal:AbortSignal.timeout(60_000)});
            row={caseId:c.id,repeat,arm,content:response.choices[0]?.message?.content??"",
              servedModel:response.model,inputTokens:response.usage?.prompt_tokens,
              outputTokens:response.usage?.completion_tokens,
              cachedInputTokens:response.usage?.prompt_tokens_details?.cached_tokens,
              durationMs:Math.round(performance.now()-started)};
          } catch {
            // Never persist raw SDK errors, credentials or request headers.
            row={caseId:c.id,repeat,arm,content:"",durationMs:Math.round(performance.now()-started),
              error:"provider_request_failed; no fallback or retry"};
          }
          // Checkpoint raw observed answer before any grading.
          write(`observation-${String(runs.length).padStart(3,"0")}.json`,row);
          runs.push(row);
          console.log(`[harness-ab] ${runs.length}/${MAX_CALLS} ${c.id} ${repeat} ${arm} ${row.error?"ERROR":"recorded"}`);
          if(row.error)throw new Error("Provider request failed; sample incomplete");
        }
      }
    }
  });
} catch(error) {
  outcomeError=error instanceof Error&&error.message.startsWith("Provider request failed")?
    error.message:"Sample setup/execution failed; inspect provider availability, no fallback attempted";
}
const summary={...summarizeSample(cases,runs,REPETITIONS,EXPECTED_SERVED_MODEL),outcomeError,
  requestedModel:MODEL,provider:"replit",requestCount:runs.length,rawOutputDirectory:path.relative(process.cwd(),out)};
write("summary.json",summary);
const lines=[
  "# VisionClaw structured-task harness sample","",
  `Verdict: **${summary.verdict}**. Automatic promotion: **disabled**.`,
  `Model requested: ${MODEL}. Provider: Replit (native usage charges; external fallback forbidden).`,
  `Provider-reported model(s): ${summary.servedModels.join(", ")||"unavailable"}.`,
  `Evaluation: ${summary.evaluationCases} synthetic cases × ${REPETITIONS} repetitions × 2 arms.`,
  `Recorded ${summary.requestCount}/${MAX_CALLS} total requests, including development checks.`,
  "",
  "| Arm | Completed | Safety failures | Mean input tokens | Mean output tokens | Mean latency (ms) |",
  "|---|---:|---:|---:|---:|---:|",
  ...summary.arms.map(a=>`| ${a.arm} | ${a.completed}/${a.attempts} | ${a.safetyFailures} | ${a.meanInputTokens?.toFixed(1)??"n/a"} | ${a.meanOutputTokens?.toFixed(1)??"n/a"} | ${a.meanDurationMs?.toFixed(1)??"n/a"} |`),
  "",...summary.arms.map(a=>`${a.arm} failed cases: ${a.failedCases.map(c=>c.caseId+" (repeat "+c.repeat+")").join(", ")||"none"}.`),
  "",`Observed input-token reduction: ${summary.inputTokenReduction===null?"not measurable":(summary.inputTokenReduction*100).toFixed(2)+"%"}.`,
  `Comparison issues: ${summary.issues.join(", ")||"none"}.`,
  ...(outcomeError?[`Execution limitation: ${outcomeError}.`]:[]),
  "","## What changed",
  "Baseline uses the real production structured-task system formatter. Candidate only minifies the schema JSON. No instruction, schema field, permission or tool changed.",
  "","## Limits",
  ...summary.limitations.map(l=>`- ${l}`),
  "- Development cases are excluded from the comparison. Oracles are fixed deterministic expected answers, not self-grading.",
  "- Raw answers, exact prompts, fixture identity and model/usage evidence are retained. Failed requests remain visible.",
  "- Standard provider cost accounting remains active. No customer actions or custom database writes occur.",
  "- No claim about complete agents, unfamiliar customer workloads, Opus 5.5, statistical significance or production savings.",
];
fs.writeFileSync(path.join(out,"report.md"),lines.join("\n"));
console.log("HARNESS_AB_RESULT",JSON.stringify(summary));
process.exit(summary.verdict==="inconclusive"?3:summary.verdict==="reject"?2:0);
