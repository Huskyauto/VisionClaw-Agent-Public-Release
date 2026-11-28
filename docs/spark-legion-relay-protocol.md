# Spark Lenovo relay protocol v1

Status: implementation contract, not a claim of installation or production availability.

## Connection and operation
Protocol string: `spark-legion-relay-v1`. Spark is an outbound worker, not an inbound server.
Production base: the existing canonical app `https://agenticcorporation.net`.
Use Spark's existing securely injected owner API credential with chat/admin scope. The injected value may be an opaque surrogate (such as `hsurr:`) that Spark's secure runtime resolves in flight to the owner's `vc_` credential for an allowlisted application host; the worker preserves that value exactly and the server still authenticates it. Never send it to Ollama or put it in argv/logs/files in this package. Use the ordinary runtime proxy for the app; derive a separate Ollama proxy from HTTPS_PROXY by replacing its port with 3130.
Only Ollama destination: `http://100.73.84.100:11434`; health `/api/tags`, generation `/api/chat`. No redirects. Exact model: `hf.co/JetBrains/Mellum2.1-12B-A2.5B-Instruct-GGUF:MXFP4_MOE`.

## Endpoints
Prefix: `/api/v1/spark/legion-relay`. All endpoints require owner API authentication.

- `GET /schema`: version, approved model, limits and exact mandatory first guardrail.
- `GET /status`: sanitized worker/job metadata; never task text or model output.
- `POST /poll`: `{protocol,workerId,model,ready}`. `workerId` matches `[A-Za-z0-9_-]{8,64}` and persists across restarts. Readiness means an actual bounded tags check through Spark's Ollama proxy found the exact model. One poll per minute. Response `{protocol,job:null}` or `{protocol,job:{jobId,requestId,digest,requestJson,claimToken,deadlineAt}}`.
- `POST /:jobId/start`: `{protocol,workerId,requestId,digest,claimToken}`. Call once only AFTER a durable local checkpoint. HTTP 200 `{started:true}` authorizes ONE inference. A repeated/ambiguous start response NEVER authorizes another inference; recover to uncertain instead. Server claim is valid for 80 seconds and requires at least 130 seconds left on the overall deadline. Admission shares Lenovo's device lock.
- `POST /:jobId/result`: binding above plus `{outcome:"complete",responseJson:<exact native Ollama response string>}` or `{outcome:"failed_before_send"|"uncertain"}`. Preserve and retry these exact bytes when delivery is uncertain. Identical results return success; different bytes under the same identity return 409. A late actual completion can resolve an uncertain reservation for evidence, not retroactively authorize accepting expired work.
- `GET /:jobId`: binding/terminal metadata for recovery (no task text). Query parameters are not credentials; authenticated API identity owns the claim.

No endpoint invokes Felix, chat orchestration, another model, a tool, or a hosted fallback.

## Native request and response
`digest` is lower-case SHA-256 of the exact UTF-8 `requestJson` string. Do not parse/reserialize it before checking that digest. Parse only after verification; send the same JSON bytes to `/api/chat`.
Native request has exact approved model, `stream:false`, `think:false`, existing guardrail as its first system message, system/user text messages, `options.temperature:0`, and `options.num_predict` in 1..2048. Preserve optional `format` exactly. No tools, URLs, files, shell commands or model management.
Native result must have matching model, `done:true`, `done_reason:"stop"`, assistant text, nonnegative integral `prompt_eval_count`/`eval_count`, and no tool calls. Return real provider bytes; never substitute Spark prose or claim physical hardware attestation. Server validates shape and source task output independently. Missing counts are unknown, not invented zero.

## Bounds and recovery
Request/result max 65,536 UTF-8 bytes. One generation; max 8 new jobs/hour, max 4 waiting jobs. Overall relay deadline 210 seconds; Ollama wall clock 120 seconds. Polling normally adds up to one minute. The parent runbook is bounded at 270 seconds, below its existing five-minute queue lease. No DB connection or inference lock is held during the polling wait.
Worker checkpoint states: claimed → starting → result_saved → delivered. Persist `starting` BEFORE the start request. Crash/restart from starting reports uncertain without inference. Crash/restart from result_saved redelivers saved result without inference. A lost HTTP response from `/start` is uncertain, never a license to regenerate. Hold a local exclusive file lock and use atomic fsync'd checkpoint replacement.
If a result is uncertain, stop taking new work until a real saved completion resolves it or Bob confirms Lenovo's old work stopped and explicitly releases the reservation through the owner control plane. Never auto-acknowledge that decision.
Persist private checkpoints under a mode-0700 directory on Spark's durable home, files mode 0600; use only one fixed checkpoint path, not caller-derived filenames.
Use scheduled `--once` invocation each minute for automatic recovery after VM replacement. The schedule must inject existing credentials and HTTPS_PROXY through Spark's normal secure helper; do not place them in the schedule text.

## Activation and handoff
Database prerequisite: the existing `agent_jobs_status_check` must permit the
nine `relay_*` states as well as all legacy states. The workspace-only command
`NODE_ENV=development npx tsx scripts/spark-legion-relay-schema.ts --apply-development`
performs the narrow, atomic extension. `--check` is read-only. There is no startup
DDL and no production-apply command. Review the CHECK change during authorized
Publish and verify production parity before activation. No table/column/index
or tenant policy changes, data backfill or deletion is required.

The application side requires exact `LEGION_SPARK_RELAY_ENABLED=1`, existing primary-project background authorization, and `APP_ACCESS_MODE=owner-only`. These flags are NOT enabled by installation instructions or code delivery.
Spark claim/start is production-only. Before activation, arm the flag in BOTH
development and production, restart development, and verify its Lenovo generation
is refused. Development and production databases cannot share advisory locks:
while armed, development is deliberately barred from direct Lenovo generation.
Do not enable only production or run another unmanaged Lenovo client concurrently.
Existing development Lenovo behavior is unchanged while the new flag is off.
Within one database, unresolved Lenovo reservations block inference globally
across environments, while job content/status access remains environment scoped.
Send protocol version, package SHA-256, schedule installation acknowledgment, a successful authenticated status/poll and exact-model health acknowledgment back through Bob. No live failover until both sides are installed and publication is explicitly approved.
