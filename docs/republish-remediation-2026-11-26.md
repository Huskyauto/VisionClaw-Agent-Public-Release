# Republish remediation — November 26, 2026

## Status and evidence limits

This is an unpublished remediation record, **not release clearance**.
No publication, GitHub push, or new paid full audit was authorized or performed.
Bob approved baseline-plus-independent-review validation on November 26.

### November 27 gate-policy reconciliation

Bob approved reconciling this policy with a separate unfinished audit. In
baseline-review mode, the gate reads the completed report only from
`generated-artifacts/republish-audit-baseline/data/tenant-isolation-audit/latest.json`.
It still requires complete baseline coverage, reproducible original evidence,
all retained finding dispositions, independent review, supplemental verification
and successful automated checks bound to exact current source. Report overrides,
missing or degraded baseline evidence and stale acceptance remain blocking.

The separate audit's checkpoint and partial report stay untouched and resumable.
They do not replace the completed baseline and are not reported as completed.
Without independent acceptance, full-audit mode still refuses an unfinished
checkpoint. Neither mode grants push or publication authority; the owner's
separate repository/staging approval does not authorize Replit publication.

The completed audit covered 901 files and all 364 chunks without failures or
source drift. Its original source checkpoint is
`56953d2168659d20916c2a56cebd2e1b6edfdb64`; the reconstructed evidence hash
matches the unchanged report:
`3b1ccced10a94537ed98b02901c4b49709c8c57cdb86e6316b295985534533af`.
That establishes which source was audited, not clearance for subsequent edits.

The report retained 115 severe allegations after 46 precision false-positive
decisions and five existing allowlist exclusions. The additional investigations
produced proposed resolutions for all 115. Independent review accepted the final
**13 remediated findings and 102 false positives**. Original records, investigator snapshots, parent corrections
and current-source hashes are preserved in the private working evidence
`.local/republication-triage/closure.json`. The review is retained separately;
neither this document nor that working evidence rewrites the original report.

## Changes and compatibility

| Boundary | Remediation | Preserved behavior |
| --- | --- | --- |
| Research intelligence | All six handlers stamp the trusted context tenant after untrusted fields. | Existing handler arguments and responses. |
| Self-heal | Tenant-scoped run lookup precedes repair side effects. | Owned runs remain eligible. |
| Crews | Explicit agent assignment requires the same crew and tenant before insertion. | Owned and unspecified-agent task creation. |
| WhatsApp credential cleanup | Parameterized literal-prefix matching replaces SQL LIKE wildcard expansion. | Tenant 2 cannot clear tenants 20/21/200; the owner's legacy slot cleanup is unchanged. |
| Global skill builds | Customer tenants are denied before persistence, jury spending or global promotion. | Owner jury-approved autonomous global builds, rejection, and split-vote review. No unreachable customer review queue. |
| Workspace files | Customer writes require non-empty platform-stamped path grants; payload `_allowedPaths` is not authority. | Intentional owner access and existing trusted directory restrictions. |
| Media | Sources require trusted context and ownership of canonical tenant assets or verified upload bytes; customer outputs use tenant directories. | Intentional owner workspace access, verified upload processing and cleanup. |
| Social images | Tenant identity, reference ownership and canonical output directory are checked before model use; UUID outputs are created exclusively and privately. | Existing image generation, Drive durability, paid-timeout no-retry behavior and reference composition. |
| Delegation shell preconditions | The canonical catastrophic/destructive floor and exec-disabled/deny settings apply before the process starts. | The documented owner-tenant Felix/Forge shell capability and exit-77 skip semantics. This is not a finite command allowlist or OS sandbox. |

The social-image and skill-build implementations now live in focused modules.
Their legacy cases forward the same server-stamped params and existing
dependencies; tool names and schemas are unchanged. Tool descriptions explain
the tightened authority requirements.

## Corrections to the preliminary investigation

- The optimizer writers **do have production callers** in the manual and
  nightly operator scripts. Those callers were missed by a server-only search.
  They reject non-admin candidates before jury approval/application, and the
  final global promotion checks the admin tenant independently. The portable
  bundle importer has no current customer ingress. HMAC integrity is not
  treated as proof of caller identity.
- Arbitrary shell syntax in the owner-only delegation precondition is an
  intentional documented capability, not by itself a customer isolation
  vulnerability. A separate genuine gap in the shared destructive-command
  floor was fixed and behaviorally covered.
- A project-file metadata association is not sufficient ownership of source
  bytes in a shared directory. Media authorization uses the canonical tenant
  namespace or verified owned upload bytes instead.
- The initial WhatsApp false-positive rationale proved caller identity but
  missed an underscore wildcard at the deletion sink. Independent review
  rejected it; the namespace deletion is now fixed and independently verified.
- Review also found deployment files, migrations, assets and CI omitted from
  the initial incremental digest. The shared selector now binds all
  repository-visible inputs except explicit private/mutable evidence exclusions.
  Filesystem regressions cover modification, addition, deletion and symlinks.

## Verification and the remaining release decision

Seven new regression files cover tenant overrides, global promotion authority,
image/reference/output isolation, repair and crew ownership, workspace grants,
verified staging and cleanup, symlink rejection, and shell safety-floor parity.
They are selected by the targeted release checker and registered in the normal
test suite. Fixtures do not deliberately call live paid generation providers.

The bounded release-check report must be generated after this remediation,
with stable source membership and hashes. Earlier successful reports do not
verify these edits. The targeted checks are not a whole-repository security scan.

The readiness gate preserves the original fresh-audit path. The owner-approved
incremental path additionally requires an independent review record, exact
acceptance of every retained allegation, reconstruction of the original audit
source hash, successful automated checks, and an exact current release-input
digest including membership and release tooling. Missing, proposed, unresolved
or stale evidence fails closed; the original report is never rewritten.
The operator receipt and retained review live privately under
`.local/republication-triage/`; the reconstructed source is excluded from builds
under `generated-artifacts/republish-audit-baseline/`. These records are local
operator evidence, not signatures, whole-project certification, automatic
approval or permission to publish. Independent review completed all 115 identities
with none rejected or unverified after the WhatsApp repair.

The original 480-regression release check remains preserved. Supplemental
verification passed 59 release-tooling tests, then 39 final targeted tests
including the three WhatsApp regressions, full TypeScript checking and the
production build. The first final TypeScript attempt exhausted the default
Node heap; the bounded 3 GiB heap retry passed. Build retained four existing
import.meta/CJS warnings. Runtime restart/health verification and the final
readiness command are separate from these build results.
