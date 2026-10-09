# Restricted GitHub Copilot connection

Scope: official SDK chat-only access from this workspace and an owner-scoped
VisionClaw tool. No Microsoft consumer API, file access, shell, remote sessions,
MCP, ambient skills, provider fallback, or automatic model routing.

## Pre-build gate
1. Cost: auth/model discovery does not generate prompts. Generation will have a
   durable pre-dispatch quota claim, maximum 20 requests/day, one concurrent
   request, <=12,000 input characters, no retries. Copilot allowance and model
   multipliers apply. Never advertise unlimited/free inference.
2. State: durable quota/audit in Postgres. Scratch HOME/cwd is a disposable cache,
   not durable state; no repository access or saved/resumed credentials.
3. Failure: auth, limits and tool permissions fail closed. Hard timeout kills the
   runtime. Errors sanitized; no fallback to other providers.
4. Identity: fresh session per dispatch, no automatic retry after timeout; reserve
   each request before generation and keep the claim after uncertain completion.
5. Tenant: owner's credential only for trusted owner context, not caller arguments.
6. Stop/observe: removing the secret disables the bridge. Explicit disable flag;
   sanitized readiness and request evidence.
7. Authority: Bob authorizes use and can revoke the token. Copilot returns text
   only; it cannot approve actions, modify policy or invoke other agent tools.
8. Delta: baseline has no Copilot access. Verify a small real reply and deterministic
   isolation, authorization, input/concurrency/quota bounds and no-fallback tests.
   Failed authentication/runtime compatibility blocks capability registration.

## Work order
Inspect/install SDK, verify auth, then implement the restricted runtime and owner
tool, wire agent guidance, run focused verification and review. Installation alone
is not proof of a working connection.

## Authentication prerequisite result
The official SDK runtime started successfully on this workspace. GitHub identity
validation returned HTTP 200, but Copilot model discovery returned HTTP 401 with
an explicit missing `Copilot Requests` permission. No inference was dispatched.
The initial unused SDK dependency was removed pending permission correction.
The latest replacement key passed official SDK model discovery in a fresh managed
process. The SDK is installed for the restricted chat implementation. No automatic
provider routing is enabled.

A replacement-secret retry and a fresh managed-process check also returned the
same explicit missing-permission rejection. The dedicated credential is a
fine-grained token and does not duplicate another configured GitHub credential.
Do not repeat token requests or enable routing without resolving this
authorization mismatch; inspect the token's Account permissions first.

## Supported OAuth alternative
Official `copilot login --device-code` is an alternative if the account permission
is unavailable. The CLI help command ran successfully in an isolated temporary
HOME, without authentication or generation. No OAuth login was started.

The draft bootstrap was removed before execution following review. Any future
implementation must establish explicit administrator-owner binding, a supported
version-specific credential cache contract, and process-group cancellation with
catchable-signal cleanup. Uncatchable termination needs an explicit stale-cache
recovery policy; do not claim unconditional cleanup. Credential persistence must
be encrypted and owner-scoped, with enforced expiration and no invented refresh.
The owner supplied another fine-grained key to try before pursuing OAuth.

## Operational interfaces
Workspace owner / Replit Agent: send only the intended prompt over stdin:

    printf '%s' 'Explain this design tradeoff.' | npx tsx scripts/copilot-chat.ts
    printf '%s' 'Explain this design tradeoff.' | npx tsx scripts/copilot-chat.ts --model gpt-5.4

VisionClaw: Felix and Forge can call `copilot_chat({model?})` in the
authenticated owner tenant only. Never pass caller `_tenantId` or persona stamps;
the domain consumes trusted dispatcher context. Other tenants are refused.
Bob must begin his latest message with `Copilot:` or an explicit imperative such
as `Please use Copilot ...`. The server sends only that owner-authored text, never
model-selected context. Autonomous calls or missing owner conversation are refused.
Each VisionClaw owner message is bound to one durable unique attempt, so a
retained old question cannot authorize later background calls or automatic retries.
To intentionally retry, send a new explicit Copilot message.

Both interfaces share `copilot_request_claims`: atomically reserve before generation,
20 attempts per UTC day and one live request. No raw prompts or answers are stored
in that quota ledger. Failures consume quota; no automatic retries or fallback.
Running claims never unlock merely because their lease timestamp expires. After
a crash, unresolved claims fail closed until an operator verifies the worker
process group is stopped and settles that exact owner claim.
Maximum output is 16,000 characters with `truncated:true` when capped.
Models: gpt-5.4-mini (default), gpt-5.4, claude-sonnet-5, subject to live availability.
Removing COPILOT_GITHUB_TOKEN or setting COPILOT_CHAT_DISABLED=1 disables chat.
This is an SDK tool restriction, not an OS filesystem sandbox.

Schema change: additive owner-scoped table/FK/index; no existing-data backfill.
Development DDL is scripts/migrations/copilot-request-claims.sql. Production
schema reconciliation is part of a separately authorized publication, not startup.
Rollback by disabling the feature and retaining the ledger as quota evidence.

Review: explicit owner intent now derives from tenant-scoped conversation history;
stale claims remain blocking; settlement requires confirmed process-group death;
the worker has its own deadline and IPC-disconnect kill; build stages the worker
into dist. The workspace SDK chat smoke returned COPILOT_CONNECTED. The owner
VisionClaw handler returned VISIONCLAW_CONNECTED from a retained development
verification conversation; it ignored injected model-authored prompt text.
Both quota claims settled complete. The repository-wide typecheck exceeded the
bounded 2 GiB heap; it is not reported as passing.
