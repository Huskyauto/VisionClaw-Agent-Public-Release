# Webhook follow-up affinity

Selective native borrowing from the [DeepSeek research prototype](https://github.com/deepseek-ai/dsh-superagent-prototype),
authorized by the owner before republishing. This extends the existing webhook
route, not a new super-agent framework, subscription service or autonomous loop.

## Behavior

After the existing unique enabled bearer-capability trigger resolves the tenant:

- Structured bodies with `repository.full_name` and `issue.number` or
  `pull_request.number` select one conversation per repository/number.
  GitHub issues and pull requests share that namespace, so issue-comment and
  pull-request payloads for the same item meet in the same conversation.
- Tenant, trigger, effective persona and configured name/scope also form the
  identity. Changing those settings never silently attaches old task context.
- Plain/custom events and unsupported event shapes use a separate trigger-level
  conversation. This does not claim universal CI-to-PR correlation.
- Repository/number fields select context, not authentication. These are
  GitHub-shaped bodies delivered through the existing bearer endpoint, not a new
  GitHub-signature-verified source.
- Payload tenant/persona/conversation identifiers are ignored for authority.
  The existing tenant context, tool gates and approvals remain unchanged.

A server-owned JSONB binding map in `webhook_triggers.thread_conversations`
survives restarts. It is not returned by the trigger-list/create API. Trigger
row locking and one transaction protect conversation creation plus binding.
No legacy conversation is matched by its editable title. The first event in
the new path may start a fresh conversation; previous history is not deleted.

Mapped conversations that are missing, deleted or reassigned are rejected,
not recreated automatically. A disabled trigger is checked at ingress and again
while allocating context. This does not cancel an already accepted/in-flight
model turn or interpret arbitrary "stop" prose as an authenticated stop command.
Use existing trigger enable/disable controls and conversation deletion.

The prompt labels event text untrusted and states that follow-up context grants
no additional authority. Out-of-scope work receives handoff guidance; this is
not a new deterministic mandate engine, enforcement gate or implemented worker
hand-back protocol.

## Limits and failure

At most 128 bindings per trigger, including configuration/persona revisions and
generic context. At capacity existing follow-ups remain usable; new identities
fail explicitly. Create a separate configured trigger rather than evicting old
bindings and silently losing continuity.

Malformed identities, corrupt binding state, unavailable mapped conversations,
configuration races and database failures reject dispatch. Creating and binding
are atomic, but provider webhook deliveries are NOT deduplicated by this feature.
Repeated delivery can still produce another model turn. There is no
exactly-once claim about external actions or message ordering.

Cost: no new model calls or providers. Enabled routing adds short database
reads/locking; default-persona resolution can read the active persona, and new
conversation allocation reads existing model settings. Locks do not span model
execution. Added scope guidance can increase prompt tokens slightly.

## Configuration, migration and rollback

Unset/other values of `WEBHOOK_THREAD_ROUTING` enable routing. Exact `0` restores
the previous in-memory trigger-level routing on subsequent requests; persisted
bindings are retained. No runtime environment value was changed here.
Logs contain `[webhook-routing] mode=github-thread` or `mode=trigger`, without
payloads, webhook capabilities or repository names.

One additive `JSONB NOT NULL DEFAULT '{}'::jsonb` column was applied to the
development database. There is no historical authoritative binding to backfill.
The managed Publish schema diff must carry this column to production; no new
startup-time production migration was added. Production schema and behavior
have not been verified, and no publication was performed.

Rollback is the flag or code checkpoint; retain the column, binding map and
conversations. Dropping the column is unnecessary and would lose continuity.

## Evidence

- Nine offline tests: same-item continuity; different-item separation;
  tenant/repository/trigger/persona/config separation; caller authority fields;
  malformed identities; corrupt state; capacity; deletion/reassignment; failures.
- Source-bound baseline comparison: three unrelated item identities share one
  legacy trigger key but produce three distinct new keys. The live ingress
  capability/tenant guard and allocation lock are also checked at source level.
- Four actual-helper database checks: reuse, separate item, deletion refusal and
  disabled-trigger refusal. All fixture rows rolled back.
- Full TypeScript passed.
- Scoped independent review found no actionable findings. Simultaneous
  transaction contention was not empirically tested; allocation safety relies
  on the PostgreSQL row lock and transaction, not an in-process mutex.

These establish bounded routing behavior, not live productivity improvement,
reduced notification volume, full webhook delivery idempotency or a reproduction
of DeepSeek's complete architecture.

The legacy Layer-1 load script defaults to production and sends owner email;
it is not safe to invoke unmodified for this scoped review. No production load
test or live agent webhook was run.
