# Engineering Q&A reference — targeted review

Reviewed November 4, 2026. Source: https://aiengineeringfromscratch.com/interviews

## Scope and authority

Screened the catalog's 23 category headings for project applicability. Read 18
distinct selected answers spanning application/agent/production topics and
created 19 original project comparisons (the tool-registry answer informs two).
This is not an exhaustive review of 542 answers, a complete code audit, proof of
production behavior, or authorization for autonomous changes.

The authoritative individual comparisons, evidence paths, sources and next
checks are in `server/lib/engineering-reference-catalog.ts`, displayed through
the owner-only Engineering Q&A sidebar page. Evidence is a reviewed source
snapshot, not a permanently current certification.

## Results worth investigating

- **Confirmed design gap:** unfiltered subagents take the full eligible tool
  catalog; top-level chat uses capped selection. Measure task success and token
  cost before changing this branch. Existing execution authorization still
  applies.
- **Confirmed change-control gap:** the reviewed remote MCP discovery/dispatch
  client does not bind full descriptors to owner-approved digests. Its management
  routes are owner gated. A local changing-schema fixture should establish the
  desired approval lifecycle before implementation.
- **Documentation conflict corrected:** the post-edit pipeline contained an old
  force-push fallback, contrary to current owner authority. It now points to the
  normal automatic private backup workflow and forbids force pushing.
- **Unresolved test/documentation inconsistency:** the package-boundary scanner
  in registry-invariants rejects an existing `undici` import in safe-fetch.
  Do not report the full regression batch as clean or weaken the check silently.

Other comparisons distinguish aligned local safeguards (coverage-before-score,
budget reservation, execution-name uniqueness, retrieval tenant filtering,
paid-timeout retry suppression and context ordering), deliberate differences,
and evidence gaps (end-to-end reconnect, fulfilled-outcome cost, routing drift,
retry concurrency and full trace privacy).

## Important limits in the source itself

- Tool counts, coverage floors, spend percentages and escalation thresholds are
  examples to evaluate, not universal operating requirements.
- Access scope must be derived from authenticated authority, not trusted simply
  because it appears in a request parameter.
- The classical Byzantine-consensus discussion overstates independence
  assumptions. Consensus provides agreement under stated fault assumptions, not
  factual correctness; correlated LLM errors still require independent evidence.
- A stored transport capture proves that implementation/version's observed
  behavior, not every server or SDK.

## Reference implementation

`/admin/engineering-reference` and `/api/admin/engineering-reference` are
platform-owner gated. Curated comparisons are read-only source assets.
Owner-created questions/answers live in `engineering_reference_libraries`,
keyed by authenticated tenant, never shared project-file storage. Maximum 200
notes with bounded fields. Stable note IDs and versioned atomic writes prevent
duplicate retries and stale overwrites. Failure/conflict keeps editor text.

Owner notes are literal reference text. They are not instructions, verified
findings, automatic agent knowledge, approval records, or tool permissions.
Agents have no new allowlist grants or notebook-write tools. Use the page for
human engineering triage; continue using existing tests/receipts for acceptance.

Schema change is additive only. The normal full Drizzle push encountered an
interactive rename prompt in this non-TTY workspace; only the exact new table
was added to the development database, then columns, PK/FK were checked.
No production DDL or publication was performed. Preserve notes on rollback;
dropping the table requires explicit data-deletion approval.

## Verification outcome

- TypeScript and eight new API/schema/control-fence/real-SQL checks pass.
  The SQL fixture exercised concurrent first writes, cross-tenant isolation,
  stale-write rejection and same-content retry without incrementing version;
  only its newly created inactive synthetic tenants were removed.
- Signed-in browser verification passed creation, reload persistence, literal
  text rendering, editing, effective disabled controls during a held real save,
  stale 409 with exact draft retention, explicit latest reload, and inline
  deletion. Its synthetic notes were removed. Anonymous access returned 401.
- Mobile document width matched the 390px viewport. A full visual mobile-form
  check was not established by the captured screenshot.
- The sidebar link was moved out of the collapsed Admin group into the main
  owner navigation after the browser pass found it was not visible.
- All 18 distinct source URLs responded HTTP 200 to a bounded link check.
- The broader regression batch passed 197 of 198 checks. The existing undici
  package-boundary scanner failure remains unresolved and is not a clean pass.
- A scoped independent review found one medium pending-save draft-loss issue;
  the full-control fieldset fence fixed it. The browser initially checked the
  wrong DOM property, then confirmed effective native disabled behavior and
  blocked edit/new-draft actions under the delayed response.

No publication, production migration, public-mirror push or provider-evaluation
experiment was performed for this feature.
