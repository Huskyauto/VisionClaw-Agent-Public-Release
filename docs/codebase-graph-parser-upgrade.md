# Source-aware codebase navigation

## Scope and design gate

Improve the existing codebase graph, not add a second framework. Its existing
query and diff-impact tools already provide file dependencies and dependents.
Graphify's local parsing approach is a useful reference; no Graphify code,
package, cloud service or advertised savings are adopted.

1. Cost: zero model/API calls; sequential parsing with the installed TypeScript
   parser, bounded to 20,000 files, 4 MiB per source and 256 MiB total source.
2. State: `data/codebase-graph.json` remains a disposable, rebuildable code-only
   index. No customer data, credentials or runtime database state is indexed.
3. Failure: build errors fail explicitly; atomic replacement preserves the
   prior complete index. No symlink or out-of-inventory target is indexed.
4. Identity: deterministic sorted files/edges; rebuild from current sources.
   Timestamp is generation time, not proof of source freshness at query time.
5. Scope: same four source roots and existing tool permissions. No new route,
   tool, tenant access, provider, scheduler or runtime filesystem authority.
6. Stop/observation: explicit manual builder and application build-time refresh
   only; no background or request-path work. The build prints file/edge counts.
   Stop the build process to stop indexing.
7. Authority: read-only navigation advice. A dependency edge cannot approve
   changes, prove a call executes, establish security clearance or grant access.
8. Evaluation: compare syntax fixtures and a bounded real-repository rebuild;
   measure wall time/peak memory. Do not infer task accuracy or token savings
   from parser coverage or a successful build.

## Behavior

The parser identifies static imports, re-exports, literal dynamic `import()`,
literal `require()` and TypeScript import types/import-equals. Comments,
string examples and computed import targets are not dependency evidence.
Exports include explicit named exports, declarations, destructuring and default
exports. Edges are file-level syntactic dependencies, not function-call graphs;
type-only and conditional imports do not prove runtime execution.

Resolution uses only the scanned inventory, supports project aliases and
TypeScript source counterparts of `.js`/`.jsx` specifiers. It never reads an
import target outside that inventory. Missing/computed targets remain untraced;
the graph is not exhaustive and never substitutes for reading current sources.
The existing JSON schema and query/diff-impact interfaces are retained.
Application builds regenerate the disposable index before packaging, so an
ignored local cache is not required on a fresh checkout. A failed refresh fails
the build instead of silently shipping an older index.

## Screenshot and repository triage

- https://github.com/Shubhamsaboo/awesome-llm-apps — useful curated examples.
  Its scope-creep and self-improvement themes overlap existing review/optimizer
  safeguards. Reference individual examples when a concrete product need exists;
  do not bulk-install skills or autonomous loops.
- https://github.com/anti-work/shortest — natural-language testing over Playwright
  with Anthropic calls. Existing browser testing already serves this purpose;
  no additional paid testing framework is needed for this change.
- The screenshot also lists project-based-learning, Lobe Chat, openai-openapi,
  system-design-primer and CasaOS. These are learning, alternative UI,
  specification or hosting references, not evidence of a missing capability.
  They were screened from the screenshot, not individually audited.
- ECC remains a selective engineering reference. DeepSeek Harness is explicitly
  developer-preview/unaudited. Neither justifies a framework migration.

No new dependency, live model run, public export or publication is authorized
by this implementation. Verification results are recorded separately.

## Local measurement

On the inspected November 12, 2026 checkout, the original builder indexed 1,900
files and 4,981 edges in 11.12 seconds with 169,568 KiB peak child RSS. The
parser-based rebuild indexed 1,901 files (one new parser module) and 6,490 edges
in 11.78 seconds with 282,016 KiB peak child RSS. Python's monotonic clock and
`RUSAGE_CHILDREN.ru_maxrss` measured each separate invocation including the tsx
launcher. These single observations are not a statistical performance benchmark.

There were 1,525 added edges and 16 removed edges. Added examples include lazy
page imports in `client/src/App.tsx`. Removed edges pointed outside the scanned
inventory (including JSON/CSS and excluded data directories), not proven
runtime dead dependencies. Every new edge endpoint belongs to the inventory.
This is better syntactic coverage, not measured agent accuracy or token savings.

## Verification and scoped review

Local checks: six new parser/builder tests plus four existing migrated-tool
surface checks passed. Fixtures exercise the real CLI and existing query/impact
consumers, exports and aliases, literal dynamic/type/CommonJS imports, excluded
comments/examples, inventory-only edges, oversized-source failure retaining the
last graph, empty-inventory refusal and source/output symlink refusal.

Explicit script/test TypeScript compilation and the full application TypeScript
check passed. A complete `scripts/build.ts --release-check` passed, including
the new build-time index refresh (1,901 files, 6,491 edges; the extra edge is the
build hook importing the builder). Existing PostCSS/Rollup and CJS `import.meta`
warnings remain. Development snapshot synchronization was skipped deliberately.
The stale-string gate passed.

Self-review: changed code is confined to build-time source indexing and its
tests; existing query/executor/tenant/approval interfaces are unchanged. File
handling is the relevant sensitive surface and is covered above. No new tool,
persona, permission, schema, model, paid call or application route was added.
The missing fourth index in AGENTS.md was corrected. A separate review agent,
whole-platform audit, paid benchmark, documentation-mail pipeline and
publication were not run for this scoped internal maintenance change.

The dependency-impact check was confined to three Script-layer files with no
other caller layers traced. The agent-wiring audit passed with zero dead tools,
persona drift, trusted leaks, orphan skills or schema gaps; existing warn-only
sprawl/orphan-table notices remain. Development was restarted once and the
landing page rendered. Startup's database health probe timed out at three
seconds while subsequent startup database work completed; this is not evidence
of whole-app health or a diagnosed persistent database failure. Unrelated
historical audit logs were not rerun or treated as acceptance for this work.
