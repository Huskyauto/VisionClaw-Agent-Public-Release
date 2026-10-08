# Provider and incident evidence — October 4, 2026

## Confirmed source

The former non-streaming processMessage assembly appended a new role:user
message after the authentic current request, claiming pending deferred research
and instructing the model not to report completion. That was server-created
context, not a Bob/Spark instruction. It carried no retrievable injection receipt.

The earlier incident report overstates two conclusions: the initial reply DID
contain a low-confidence ESCALATE, and the saved thread model does not prove the
served model. A subsequent answer veered into the deferred note instead of
answering the health question.

## Intended current routing

| Purpose | Intended model | Account/transport | Failure boundary |
|---|---|---|---|
| Owner Felix API/A2A primary | GPT-5.4 | Replit | Existing authenticated-owner ingress pin; saved thread choice is unchanged |
| Juror 1 | DeepSeek V4 Pro | Openference | Independent pinned seat |
| Juror 2 | GPT-5.6 Sol | Profundo flat account | Independent pinned seat; bounded 90 seconds |
| Juror 3 | Claude Sonnet 5 | Anthropic API | Owner metered/cost authorization applies |
| Default owner synthesis | Claude Opus 5 | Claude subscription bridge when ready; otherwise Profundo flat account | Route selected before inference; explicit caller pins never silently reroute |
| Last default zero-marginal synthesis choice | DeepSeek V4 Pro | Openference | Failure remains explicit, not an artificial success |
| Optional replacement seats | GLM-5.3; Gemini 3.8 Flash | Z.AI; OpenRouter | Existing owner paid-access, independent-lane and spend limits |
| Existing optional Felix fallback | Grok 4.7 | xAI | Existing authenticated-owner Felix grant, switch and budget remain; not newly made an automatic jury seat |

## Observed access, not promised uptime

- Production startup reported the Claude subscription credential missing or
  invalid and deliberately disabled the bridge instead of spending through an
  Anthropic key. Secret presence metadata says the subscription secret exists;
  this does not prove validity or entitlement. No credential was changed.
- A read-only authenticated Profundo model-list request succeeded and listed Sol,
  Luna, Opus 5 and Sonnet 5. This proves metadata access, not inference readiness.
- Live public OpenRouter metadata listed google/gemini-3.8-flash (1,048,576 context)
  and x-ai/grok-4.7 (500,000 context). These are available catalog IDs, not an
  authenticated inference test of either account.
- Incident Sol failed at the outer 45-second proposer deadline. Its SDK has a
  90-second bound and a separately paced queue. Aligning outer bounds removes
  that mismatch without unbounded waits or another inference attempt. It does
  not establish whether the original delay was queueing, upstream inference,
  account contention or provider availability.
- Tenant-audit precision triage is a separate implementation. Shared cause with
  jury failures remains unproved; this repair does not certify that audit.

## Acceptance evidence and limits

82 final focused tests passed: attribution, explicit/negative resumption,
read-only provenance, legacy echoes, cached-prefix retention, tool-block tracing,
bounded metadata operations, deterministic verdict-survival boundary, real jury
parser/quorum, lane pins/cost authorization and reviewer independence.
TypeScript and production bundle build passed after all final code changes.
Existing build warnings remain. Development startup and the public homepage
passed; the protected health endpoint returned authorization/rate-limit responses
to unauthenticated probes, so those probes are not a valid load-test result.
The canonical load-test script was not run because it defaults to production
and sends owner mail, both outside this work order.

Independent review's two MEDIUM failure paths were addressed: deadline-bound
claims carry an unguessable token, reconcile late completion by conditional release,
and surface explicit unavailability; initial/final durable aggregation escalation
is preserved even when embedding/concordance work is unavailable.

The verdict-survival fixture exercises actual context assembly and jury tally,
but is NOT a live full Felix conversation. No paid inference, original checkpoint
mutation/replay or production publish is authorized by these offline tests.

## Owner-approved live verification — October 5, 2026

The owner explicitly approved short development checks including paid routes.
Only fixed, non-private synthetic prompts were used; no original research replay,
credential changes, sends or publication. Existing owner cost limits stayed in
place. Shared OWNER_JURY_METERED was already true; it was not newly enabled.

| Requested route | Live result | Approximate latency |
|---|---|---|
| Replit GPT-5.4 | READY; reported gpt-5.4-2026-03-05 | 0.8s |
| OpenRouter Gemini 3.8 Flash | READY; matching reported model | 2.5s |
| xAI Grok 4.7 | First nonempty reply missed exact format; targeted follow-up READY | 4.4s follow-up |
| Anthropic API Sonnet 5 | READY; matching reported model | 1.2s |
| Openference DeepSeek V4 Pro | READY; reported DeepSeek-V4-Pro-0813 | 4.8s |
| Profundo GPT-5.6 Sol | READY; matching reported model | 6.0s |
| Profundo Opus 5 | READY; matching reported model | 2.7s |

A real executeMoA synthetic quorum fixture completed in 17.4s: Openference
DeepSeek, Profundo Sol and Anthropic Sonnet all succeeded, and Opus 5 surfaced
VERDICT: ESCALATE without treating unrelated pending research as an instruction.
Its shouldEscalate=false describes provider-answer concordance, not the verdict
of the fictional split-vote scenario; these are distinct concepts.

The synthesis also invented an injection warning from a plain model identifier.
The security notice now distinguishes inert metadata from instruction-bearing
content and requires quoted evidence for injection warnings. A targeted live
Opus aggregation using fixed candidate fixtures returned the correct verdict
without a positive injection claim. This is one successful behavioral check,
not proof that hallucination is impossible. Independent scoped review passed;
final 82 focused tests, typecheck and build passed.

These checks establish point-in-time inference access and the live jury/synthesis
path, not permanent uptime, HTTP-ingress authentication proof, complete live
processMessage acceptance, or completed streaming/background provenance capture.

Prepared manifests record assembly and bounded unions of block identities; they
do not prove a remote model received or obeyed a payload. System identities name
assembled system segments, not independently verified memory-fact originals.
The new capture currently covers the incident's non-streaming processMessage
path, not every unrelated streaming/background engine in the platform.