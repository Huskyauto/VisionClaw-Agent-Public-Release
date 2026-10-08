# OpenDots: selective reference, not a platform replacement

Reviewed October 4, 2026. Verdict: retain for interface and computer-control
patterns; do not install, migrate to, or claim operational gains from the template.

## Primary evidence

- [Repository and README](https://github.com/CopilotKit/OpenDots)
- [Security boundary](https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/SECURITY.md)
- [Computer setup and isolation](https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/docs/COMPUTERS.md)
- [Setup and service dependencies](https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/docs/SETUP.md)
- [Conversation implementation](https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/platform.ts)
- [Computer control implementation](https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/src/server/computer-service.ts)
- [MIT license](https://github.com/CopilotKit/OpenDots/blob/c2569bb6a13a22e565cf3eb791c62267d06babb1/LICENSE)
- [CopilotKit announcement](https://www.copilotkit.ai/blog/introducing-opendots), October 1.
- [OpenAI announcement](https://openai.com/index/introducing-dots), September 29.

The dates support a rapid response, not an independently verified claim that
every capability was recreated from scratch in 48 hours. The project builds on
existing CopilotKit, AG-UI, TanStack AI, and OpenBot infrastructure.

## What is verified, and what is not

The reviewed repository labels itself alpha and single-owner. Its security
document explicitly says it is not a security-audited autonomous agent and
requires further identity enforcement for connected multi-user use.
The README excludes shared editing, invitations, uploads, interactive page
embeds, automatic specialist delegation, and a complete goal/event system.
It reports local live verification for some flows, while Slack, spoken compute
delegation and cloud Learning schedules still need connected-service verification.
Those are author-reported results, not tests reproduced in this review.

Conversation history requires configured CopilotKit Intelligence in the current
implementation; SQLite stores pages, configuration and thread bindings, not a
complete conversation backup. Custom Intelligence endpoints are supported, but
availability, terms and cost of a self-hosted Intelligence deployment were not
verified. Self-hosting the application alone does not establish an entirely
local, cloud-independent deployment.

Dedicated computers use a Docker supervisor, persistent profiles/workspaces and
per-Dot credentials. Permissions start disabled; missing services do not fall
back to the application host. Human control uses request/take/release operations
and requires fresh browser state on resumption. Ordinary containers share the
host kernel; the docs do not claim a restrictive egress policy or mandatory
stronger isolation. Copying this deployment would add infrastructure and resource
cost, not merely a new UI component.

MIT permits commercial reuse with the copyright/license notice retained.
Dependency and service terms need separate review. Models, voice, compute and
managed services are not made free by the application license.

## Bounded cross-case comparison

This is a source-backed fit assessment, not a runtime A/B or usability study.
No candidate implementation was developed, so no held-out performance gain is
claimed. The cases include ordinary work, handoff, failure and trust boundaries.

| Case | Current native baseline / evidence | OpenDots evidence and disposition |
|---|---|---|
| Ordinary tool-backed research | Existing browser tools and streamed chat/tool activity | Duplicates the backend purpose; no demonstrated reason to replace it. |
| External frontend integration | Existing scoped AG-UI endpoint and pure event encoder | Already have the protocol. Reference CopilotKit renderers; do not add a second agent engine just to render events. |
| A person intervenes in a browser workflow | Browser actions exist; reviewed native browser surface did not establish an equivalent inline takeover/handback interface | Most promising trial: visible activity, exclusive human control, fresh state before agent resumption. |
| Long research during a voice conversation | Existing speech-to-text/chat/text-to-speech implementation | Realtime speech plus separate compute is a useful pattern; latency, interruptions, costs and permissions need live comparison. |
| Editing a project deliverable | Existing projects and artifact delivery are not proof of an equivalent page-centric visual editor | Editable Spaces, revision conflicts and retained failed-save drafts are useful UX references, not a demonstrated productivity gain. |
| Multiple customers or Slack identities | Existing tenant/auth/tool-policy machinery must remain authoritative | Single-owner actor mapping is not a drop-in replacement. Do not import it as customer authorization. |
| Missing services, restart or cancellation | Native durable work and failure controls remain the baseline | Clear setup errors and persistent computer profiles are useful patterns; cancellation cannot undo remote effects and stopping the supervisor does not stop all computers. |

## Verification performed

Ran only the existing offline native baseline:

`npx tsx --test tests/lib/agui-events.test.ts tests/security/agui-scope-parity.test.ts`

Eight passed, zero failed. This checks native event fixtures and static scope
parity; it does not prove live CopilotKit interoperability or computer isolation.
No OpenDots services were installed, no model calls were made, and no application
runtime, defaults, permissions or publication settings were changed.

## Recommendation and revisit trigger

Use the project as an interface/control reference, not a replacement for
VisionClaw's agent, storage or authorization stack. The best first candidate is
one existing browser workflow with visible progress and safe human handoff.

Revisit after a concrete operator workflow shows costly intervention or
completion uncertainty. Compare the current workflow with a native prototype on
normal completion, human takeover, stale-page resumption, permission revocation,
network failure and cross-tenant denial. Measure independently verified completion,
operator intervention time, latency and total cost. Any authority leakage,
agent action during exclusive human control, or stale-state action fails the
safety gate regardless of average quality. Reject the addition if it does not
improve the measured workflow enough to justify the infrastructure.