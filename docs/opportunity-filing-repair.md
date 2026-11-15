# Felix opportunity filing repair — November 11, 2026

## Observed failure

The retained production reply confirmed six strict-schema failures caused by
executor bookkeeping, with empty field errors. The subsequent schema-inspection
call was denied by the model-round roster. It also used `name`, while inspection
previously accepted only `tool_name`.

## Local repair

- Added an opt-in framework-metadata boundary to `defineTool`; enabled it for
  opportunity filing and owner-business overview. Only an explicit list of
  executor bookkeeping keys is removed. Unknown business fields still fail;
  declared public fields take precedence. Legacy handlers retain their original
  parameters. Trusted tenant/persona checks still read dispatcher context.
- Kept schema inspection in filtered engine menus. Curator deprecation can no
  longer drop protected always-included or mandatory tools from the normal router.
  Ordinary blocked-tool, owner-tenant and model-round authorization checks remain.
- Inspection accepts `name` as a documented compatibility alias. Conflicting or
  malformed targets fail; customer discovery still conceals restricted tools.
- Updated shared agent guidance to inspect schemas before retrying, use the
  canonical spelling, avoid invented metadata and never bypass authorization.

The historical roster itself was not retained in the cited reply. The filtered
menu and deprecation defects are reproduced locally; neither is established as
the exact cause of that historical round's denial. Deliberately tool-disabled
terminal rounds remain unauthorized.

## Bounded strict-input sweep

Searched the legacy executor and migrated domain handlers for whole-parameter
Zod parsing, custom unknown-key rejection, and delegated strict validators.
The directly exposed collisions found were the two income-opportunity handlers:
filing uses a strict Zod schema; overview uses an explicit unknown-key check.
The business-pilot wrapper already constructs public arguments before its strict
request parser. Other inspected strict schemas validate nested payloads or HTTP,
provider, persisted-state and model-response objects, not this tool envelope.
This is a targeted source inspection, not whole-platform security clearance or
a claim that every indirect service branch was dynamically executed.

## Acceptance boundary

Offline regressions exercise the real dispatcher with the exact rejected
metadata keys and six named example ideas, using an isolated persistence fixture.
They verify six distinct receipts, owner-only access, unknown-field rejection,
the overview parser, schema alias visibility and exact model-request rosters.
They do not create real opportunities or establish production acceptance.

Completed local checks: 38 focused offline regressions passed; full TypeScript
check and release-check production build passed. Shared guidance was synchronized
and verified in all 18 development personas. Wiring and stale-string gates
passed, with existing warn-only orphan-table/sprawl findings. The restarted app
reported a healthy initial check and both Felix menu preflights passed; the
public landing preview loaded. Existing build warnings remain. None of this
clears the separate tenant audit or verifies a published filing.

After Bob publishes and approves the retry, Spark should resend the original
six-idea request. Acceptance requires all six saved identifiers in Felix's reply
and matching entries in Income Opportunities. Existing database filing remains
tenant-scoped and slug-idempotent. Do not replay the filings before approval or
report simulated identifiers as real ones.
