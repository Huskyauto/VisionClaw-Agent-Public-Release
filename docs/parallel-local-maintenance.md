# Parallel laptop maintenance

## Scope and controls

Bob approved both laptops working on different read-only internal maintenance
tasks, overnight and on demand. Surface retains its current 7B Foundry model;
Lenovo retains Qwen3 8b. No models were installed or resized.

This first expansion uses only the same three screened engineering runbooks:
test-first development, caller inspection and oversized-module maintenance.
It does not continuously scan/test the whole platform, ingest arbitrary logs,
send customer data to personal machines, alter code, approve decisions or move
high-end work out of the existing hosted routes. An idle queue stays idle.

### Allocation

- **Lenovo:** existing one-to-four concept selection with bounded exact-source
  references and server-extracted quotations.
- **Surface:** one direct, source-specific question; output exactly
  `{"lineStart":42}` with the chosen line number. Server extracts the complete
  selected line and checks strict schema, range, substantive text and relevance
  to the fixed question. At most four exact candidate instructions, retaining
  their original source numbers, are sent; the entire model message packet is
  capped at 2,400 characters. Answers must choose a transmitted candidate.
  Advisory reference only—not proof the step was executed.
- A single private identity/proxy still serves both laptops. Independent
  PostgreSQL session advisory slots prevent same-device generation overlap,
  including CLI/workflow processes. Loss of a slot connection aborts that request.
  Two held slots cannot starve supervision: the bounded private pool has four
  connections, not two.

### Overnight and daytime

The existing 02:00 America/Chicago scheduler queues at most three sources × two
task classes per nightly window. Exact source hashes bind tasks and results.
Unchanged successful results skip generation. Three real attempts per job;
six jobs × three attempts × up to three providers gives a conservative ceiling
of 54 provider submissions/window, not an expected workload.

The owner-only **Operator Inbox** at `/operator` now shows configuration, actual
slot occupancy, recent job results/errors and daytime submission controls.
Choose a listed source and both laptops or one laptop. There is no arbitrary
prompt/source/model/tenant entry. At most six unique source/type jobs per Chicago
calendar day; identical submissions reuse their job IDs, not additional work.
If a source changes after today's submission, the endpoint reports a conflict
rather than silently reusing old content or granting unlimited runs.

Daytime jobs lead normal claims. Before an overnight generation starts it also
checks pending **and already-claimed** daytime work assigned to that device.
This handles unordered claim batches. A daytime capacity retry waits 10 seconds;
night work waits 15 minutes. Pending daytime work retains precedence during its
short cooldown. Running inference is never interrupted for priority.

Every queue INSERT, lookup, result listing and deferral is owner/environment
scoped. The global advisory-lock catalog is control-plane metadata, deliberately
not a tenant-data table. POST has owner authentication, existing global CSRF,
a 12/minute process-local submission throttle and the durable per-day cap.

### Recovery, cancellation and costs

With parallel allocation enabled, complex work starts on Lenovo and does **not**
fall back to Surface's previously unreliable multi-concept format. Simple work
starts on Surface and can try Lenovo if the Surface attempt fails. A permitted
local ladder failing can reach the existing hosted fast tier when opted in.
All candidates pass the same task-specific deterministic checks.

Busy capacity does not trigger hosted spending. If Surface already made a real
failed attempt and Lenovo is busy, that job retains the consumed attempt rather
than claiming a pre-generation capacity refund. Direct cancellation/revocation/
shutdown signals prevent recovery. The existing generic Operator cancellation
control is not a guaranteed immediate abort of an in-flight provider call;
its warning and lease-fenced completion semantics remain unchanged.

Hosted recovery still reserves the existing autonomous budget before dispatch,
uses owner billing context and normal ledger accounting, disables SDK retries
and has a 90-second provider / 240-second whole-task deadline below the
five-minute queue lease. Local accepted/rejected completions record zero
inference charge; this is not a claim of zero electricity or measured savings.

### Flags and rollback

All require exact `1`, default off, and the original owner workspace:

- `LEGION_BACKGROUND_ENABLED`: supervised connection and internal compiler.
- `SURFACE_LOCAL_ENABLED`: permits the Surface route.
- `LOCAL_PARALLEL_ENABLED`: independent allocation, simple tasks and daytime UI.
- `LEGION_NIGHTLY_ENABLED`: existing nightly scheduling.
- `LOCAL_HOSTED_FALLBACK_ENABLED`: separately budget-gated hosted recovery.

Set the parallel flag to `0`/remove it and restart to stop new parallel tasks;
saved jobs/results remain. Stop the Surface flag to stop new Surface work.
Legacy Lenovo-first fallback mode remains when parallel allocation is off.
Changing development flags neither changes production nor publishes the app.

This is internal queue/compiler infrastructure plus an owner-only UI, not a
persona-facing tool. No allowlists, standing grants or specialist prompts change.
Operational context is in this document, the configuration catalog, example env,
feature contract and main project instructions.

## Verification

Development checks, November 17:

- 54 focused offline checks cover transport, schema/source failures, Surface-first
  allocation, per-device serialization, parallel priority contexts, scope/CSRF
  denial, hosted recovery, cancellation and real-attempt accounting. Admission
  database failure or lost admission cannot become a paid fallback.
- Expanded application/workflow/test TypeScript passed. Stale-string and wiring
  checks passed; wiring retains existing advisory orphan-table warnings.
- Real daytime Zoom Out jobs began on Lenovo at epoch ms 1794958673644 and
  Surface at 1794958674085. Lenovo's request finished at 1794958680648:
  **6.563 seconds of overlapping admitted requests**. Its result passed in
  7.094 seconds, one source-backed concept, no fallback. Both results persisted;
  the initial full-source Surface attempt was rejected and hosted recovery
  completed its task. Duplicate submission returned the same two job IDs.
- A subsequent short-packet daytime pair overlapped for about two seconds.
  Lenovo's concept task passed in 2.230 seconds. Surface's short test-first
  answer was rejected; schema-constrained Lenovo recovery passed, without
  hosted recovery. This is not evidence every short task succeeds on Surface.
- One bounded Surface-only diagnostic used the same native worker, strict
  validator and per-device admission over a screened Zoom Out source. The
  900-character packet returned exactly `{"lineStart":53}` with stop finish
  reason and one server-extracted quotation, accepted in 10.839 seconds on
  `surface-local:qwen2.5-7b-instruct-qnn-npu:3`, no fallback, $0 recorded
  inference cost. Raw diagnostic evidence is retained under ignored generated
  artifacts, not Git/deployment. No invalid answer was trimmed or accepted.
- Unauthenticated metadata access returned 403 before reading jobs. Public
  landing capture loaded after restart; protected controls are type/code and
  route-boundary verified, not claimed as a signed-in browser pass.
- The actual metadata handler with trusted owner-fixture authorization returned
  HTTP-style 200, two nodes, three sources and the persisted daytime results.
  A final Surface-assigned module-maintenance queue job also completed through
  Lenovo recovery. It is not mislabeled as a Surface success.
- Parallel allocation is enabled in **development only**. Existing supervisor
  and nightly scheduler started; no production settings or publication changed.

Scoped self-review covered queue identity/claims, owner and environment filters,
CSRF integration, selected-source boundaries, source revision checks, same-device
admission, per-request aborts, busy/lost-slot spending refusal, retry accounting,
hosted budget-before-spend and role-aware UI rendering. No reviewer agent was
requested or launched; this is not independent or whole-platform clearance.

This establishes bounded local utility and functional recovery, not blanket
Surface reliability, all-night platform testing, production behavior or measured
avoided hosted cost.
