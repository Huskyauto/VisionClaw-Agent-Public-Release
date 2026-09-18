# Project Compass

## Purpose

Every project-linked VisionClaw conversation receives practical decision guidance grounded in the project's explicit goals, desired outcomes, concerns, constraints, affected people, guiding principles, assumptions, and unknowns.

## Contract

- One PostgreSQL profile exists per `(tenant_id, project_id)`.
- A profile contains at most 64 entries. Statements are trimmed, plain text, and limited to 500 characters.
- Categories are `goal`, `desired_outcome`, `concern`, `constraint`, `affected_person`, `guiding_principle`, `assumption`, and `unknown`.
- Provenance is `user_stated` or `agent_inferred`.
- Status is `stated`, `confirmed`, `inferred`, or `rejected`.
- User-stated entries may be stated or confirmed. Agent-inferred entries remain visibly inferred until confirmed.
- Confidence is a finite number from 0 to 1. Inferred entries must include it and are rendered as hypotheses.
- Updates replace the complete profile and require the current revision. A stale revision returns a conflict instead of overwriting a newer correction.
- Users and agents may edit, confirm, reject, or delete entries.
- Sensitive personal attributes must not be inferred or stored.

## Context behavior

- Compass guidance is injected automatically for every persona in every project-linked conversation.
- The first release performs no additional LLM call per message.
- Rendered context is capped at 4,000 characters.
- If the profile is empty, missing, disabled, or unreadable, a static common-sense checklist remains active.
- Recommendations connect options to stated outcomes and affected people, separate facts from assumptions, identify material tradeoffs and second-order effects, and prefer proportionate reversible actions.
- High-impact actions require confirmation. Private chain-of-thought is never requested or stored.

## Controls and rollback

- `PROJECT_COMPASS_ENABLED=0` disables stored Compass injection without deleting data. The generic checklist remains active.
- Writes validate tenant ownership, profile shape, entry limits, and optimistic revision.
- Rollback is additive: disable injection, then remove the route/UI/table in a later migration only after confirming no consumers remain.