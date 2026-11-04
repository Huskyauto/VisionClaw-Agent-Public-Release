# Graphify assessment

Reviewed October 31, 2026, America/Chicago (November 1 UTC).

## Decision

Useful engineering reference and a potential development-time tool, not a
reason to replace VisionClaw's architecture or delay republishing. Refresh the
existing native index now; retain function-level parsing, relationship
provenance and source-aware incremental refresh as the worthwhile next
improvements. Do not install Graphify, add its hooks/MCP server, upload the
repository to its cloud service, or change application source as part of this
investigation.

This assessment includes upstream source inspection and native before/after
queries. Graphify itself was not installed or executed. No comparative speed,
memory, token-saving or extraction-accuracy benchmark was performed.

## Upstream evidence

Repository: https://github.com/Graphify-Labs/graphify

Source inspected at:
`f5155badddaa3286c78a51653791131e9e2e4d29`, branch `v8`.
The pinned pyproject declares version **0.9.100**, Apache-2.0.
GitHub's public repository API reported **140,057 stars** at review time;
the supplied post's 135K figure is plausible historical popularity, not
evidence of engineering quality.

Inspected pinned README, pyproject, extract.py, extractors/engine.py,
cache.py, build.py and serve.py. Remote files were inspected as data, not run.

Verified in documentation and/or implementation:

- Local source extraction uses tree-sitter and language grammars; this code
  graph does not require embeddings, a vector database or model inference.
  The approximately 40-language description includes optional grammar extras;
  it should not be read as every parser being installed by default.
- Nodes/edges can carry source locations and relationship confidence.
  `serve.py` renders confidence, and path summaries use the weakest hop.
  `EXTRACTED`, `INFERRED` and `AMBIGUOUS` must remain distinguishable.
- Local query scoring and path traversal operate on a persisted graph.
  Natural-language input is not proof of arbitrary behavioral reasoning:
  `_score_query` uses local term/scoring logic and graph context.
- `cache.py:file_hash` uses content/path hashing with a stat-based shortcut;
  documentation describes update and watch workflows.
- Integration guidance distinguishes actual hooks from persistent instruction
  files. Instructions encourage query-first behavior; they do not universally
  force it. Installing the CLI integration does not itself connect an MCP
  server.
- Code-only extraction and document/media semantic extraction have different
  privacy and cost boundaries. A graph and its reports are derived repository
  information, not automatically safe public assets.

The README's **80% token reduction** is a Graphify Cloud marketing claim, not
a measured result for VisionClaw. Its listed benchmark results are task- and
sample-specific, including an ERPNext comparison with six cases. No basis was
found in this bounded review to promise 80% savings here.

Likewise, a graph of imports/calls is not proof of authentication correctness,
tenant isolation, payment safety or absence of vulnerabilities. The Cloud
formal-verification wording must not be presented as certification of the
local CLI or of VisionClaw.

## Native comparison and executed checks

VisionClaw already has a persistent, local codebase index and tools for file,
export and layer lookup, dependency neighbors, hubs and reverse-dependency
impact. Relevant homes:

- `scripts/build-codebase-graph.ts`
- `server/lib/codebase-graph.ts`
- `server/tools/domains/codebase-graph/`
- Existing query-first guidance in `server/seed-persona-prompts.ts`

Our current builder uses regex-based TypeScript/TSX import/export extraction,
not Graphify's function/class-level AST relationship model. Do not call these
capabilities equivalent.

The prior generated graph was dated **2026-09-23**, with 1,530 files and 3,921
edges. It had no entry for the current tenant-audit runner or completion helper.
The native builder was run once; it produced **1,849 files and 4,830 edges**.
Only the generated index changed, not application source.

Executed queries:

| Case | Before refresh | After refresh |
|---|---|---|
| File lookup: tenant-audit runner | 0 matches | 1 exact file match |
| Export lookup: runTenantAuditJob | 0 matches | 1 correct owning file |
| Control: server/auth.ts | 1 match | 1 match |
| Explicit impact inputs: audit runner and completion helper | Both outside graph | Both inside graph |
| Static imports: source-audit → completion helper; runner → state helper | Not relied on | Both edges present |
| Inline dynamic import: job-worker → audit runner | Not relied on | **Still missing** |

The last case is an important negative control: `server/job-worker.ts` really
loads the runner through an inline dynamic import, but the current import regex
does not capture that form. Regenerating the index fixes staleness, not parser
completeness. Empty caller results must not be treated as proof of no callers.
The import graph also cannot establish which function actually invokes which
other function.

Checks used the existing `queryGraph` and `computeDiffImpact` interfaces,
explicit changed-file inputs, and direct comparison of selected edges with
current source. No model call or upstream code execution was needed.

## Practical adoption order

1. **Done:** refresh the existing generated index and verify exact lookups.
2. Before a later graph enhancement, test inline/dynamic imports, aliases,
   re-exports and symbol ambiguity against known source relationships.
   Prefer the already-installed TypeScript compiler API for this TypeScript
   repository rather than adding a second Python/parser stack automatically.
3. Add source/version freshness evidence so a dated graph cannot look current
   merely because it loads. A one-time refresh is not a durable refresh policy.
4. Consider bounded function-level path queries and confidence/source receipts
   only after retrieval correctness is demonstrated. Keep graphs advisory for
   security decisions and retain source reads and tests.
5. Evaluate Graphify itself in an isolated, code-only pilot if multilingual or
   mixed-document requirements justify its additional dependencies. Measure
   answer correctness, bytes/tokens read, elapsed time, update cost and memory
   against the native graph plus targeted search.

No runtime feature, new tool registration, dependency, credential, external
upload, publish or Git push resulted from this review. No application source
was modified, so the ongoing audit's source-bound checkpoint was not reset.

## Primary references

- [Repository](https://github.com/Graphify-Labs/graphify)
- [Pinned README](https://github.com/Graphify-Labs/graphify/blob/f5155badddaa3286c78a51653791131e9e2e4d29/README.md)
- [Pinned dependencies/license](https://github.com/Graphify-Labs/graphify/blob/f5155badddaa3286c78a51653791131e9e2e4d29/pyproject.toml)
- [Pinned extraction engine](https://github.com/Graphify-Labs/graphify/blob/f5155badddaa3286c78a51653791131e9e2e4d29/graphify/extractors/engine.py)
- [Pinned queries and paths](https://github.com/Graphify-Labs/graphify/blob/f5155badddaa3286c78a51653791131e9e2e4d29/graphify/serve.py)
- [Pinned incremental cache](https://github.com/Graphify-Labs/graphify/blob/f5155badddaa3286c78a51653791131e9e2e4d29/graphify/cache.py)
