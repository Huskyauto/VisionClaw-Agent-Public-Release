# Source-backed agent working context

Owner-approved application-level adaptation of consolidation and rehearsal ideas
from [Google's Sleep research](https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/).
This does not train model weights or claim universal prevention of forgetting.

## Lifecycle

1. The existing completed-turn memory extraction receives a bounded additional
   JSON packet and selects at most four exact excerpts: goals, decisions,
   constraints, corrections, reported results, blockers, next actions or references.
2. The server validates those excerpts against actual persisted user/assistant
   messages. Existing PostgreSQL pipeline artifacts store scope, source IDs,
   span offsets, full-message SHA-256 revision and correction references—not text.
3. Before a later turn, the server resolves the current conversation's tenant,
   persona and project, reads at most three matching conversations and 24 artifacts,
   then rehydrates excerpts from authorized live messages.
4. Missing, deleted, relinked, persona-reassigned, changed or tombstoned sources
   do not enter the brief. Model-selected classifications are advisory.
5. A default 2400-character brief prioritizes constraints/corrections. When present,
   it replaces overlapping recent-conversation previews; workspace resources,
   ordinary memory, project brain and Project Compass remain available.
6. The existing dreaming cycle compacts up to eight active conversations into
   pointer-only snapshots. Individual turn IDs survive compaction; older source
   history is not rewritten or deleted. Recent turn pointers remain immediately
   available without waiting for dreaming.

Private briefs never cross persona or project boundaries. Shared Project Compass
guidance retains its existing separate authorization. Unlinked conversations
can recall same-agent personal context on continuation or subject matches.

## Evidence and corrections

`user_stated` means an exact quote came from a user message, not that it approves
a present action. `assistant_reported` is never promoted to verified execution.
An explicit user correction may supersede known prior entry references in the
current authorized context; assistant text cannot supersede user constraints.
Sources remain inspectable by conversation/message ID and time.

The brief is escaped historical data, not a system instruction, resume request,
policy update, tool call, approval or spending permission. No executor is added.

## Bounds and failure behavior

- No additional model call; the existing extraction cap increases from 300 to
  900 output tokens when context capture is available. The extra serialized
  packet is at most 7500 characters including escaping/metadata.
- Source bodies returned to the application are bounded to 16000 visible
  characters, with a full persisted-message SHA-256 revision.
- Chat context reads have a 900ms advisory deadline; timeout/error uses existing
  context. Subsequent internal steps stop after the deadline; an already-running
  database query still obeys the database client's own timeout.
- Dream compaction has a five-second advisory deadline and an eight-context cap.
- `AGENT_WORKING_CONTEXT_ENABLED=0` disables the feature without deleting history.
- Logs contain event/count codes, not remembered text or credentials.
- Existing deterministic injection-pattern checks omit suspicious excerpts.
  Tombstone verification is one bounded batch; a revocation or verification
  failure omits the whole brief and uses existing context instead.
- New completed turns populate this feature. There is no automatic model-based
  backfill of old conversations; existing memories and history remain intact.

## Verification

Run the core/service offline suites and the PostgreSQL isolation suite. Offline
tests use controlled extraction outputs: they verify source handling and
continuity plumbing, not actual hosted-model extraction accuracy or live gains.
The existing preview path is a component baseline, not the entirety of agent
memory. Never claim that a synthetic fixture establishes end-to-end improvement.
