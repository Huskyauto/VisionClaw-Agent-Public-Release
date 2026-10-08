# PageIndex Nuggets — Knowledge-Library Future-Work Log

Source: research dive into [VectifyAI/PageIndex](https://github.com/VectifyAI/PageIndex) on May 9, 2026.
License: MIT (free to adapt).
Architecture: Python framework that builds a hierarchical, table-of-contents-style **tree index** of long structured documents (financial filings, legal contracts, technical manuals) and lets an LLM *navigate* the tree (chapter → section → subsection) instead of doing pure cosine-similarity retrieval over chunks.

This log captures patterns from PageIndex that map onto VisionClaw's knowledge library and MoA stack. Adopted as a **complement** to the existing pgvector + MNEMA pipeline — *not* a replacement.

## What PageIndex actually is

- "Reasoning-based retrieval" framing: vector RAG is fast but loses cross-section context on long structured docs; tree-walking is slower but preserves hierarchy and lets the model *reason* about which section to read.
- Builds the tree by parsing the source PDF's outline (or LLM-generated TOC for unstructured PDFs).
- Their benchmark: `MAFIN2.5` — long-document QA where vector RAG underperforms tree-walking.

## Stack mismatch warning

PageIndex is Python. VisionClaw is TS/Node. **Lift the patterns, not the code.**

## What's implemented in R105

✅ **Nugget #1 — Hierarchical heading tree at PDF ingest.**
- New table `doc_heading_trees(collection_id, doc_path, doc_title, tree jsonb, total_headings, total_lines, tenant_id)` with unique `(collection_id, doc_path, tenant_id)`.
- `server/doc-heading-tree.ts` parses markdown headings (`#`/`##`/`###`/...) into a nested tree at ingest. Pure structural parsing — **zero LLM cost**. Skipped silently for docs with `< 3` headings; capped at `5000` headings per doc.
- Hooked into `addDocument()` in `server/doc-collections.ts` — fail-open (a tree-build failure NEVER blocks ingest).

✅ **Nugget #2 — `knowledge_navigate` tool.**
- Two modes: `list` (return matching docs' heading trees) and `read` (return body text under a `heading_path`, reassembled from `doc_chunks`, capped at 6000 chars).
- Tenant-scoped. Default-`safe` policy (no policy entry needed) — same risk profile as `search_knowledge`.
- Bounded inputs: `limit` 1–20 docs in list mode; substring-tolerant case-insensitive heading matching for resilience.

✅ **Nugget #3 — κ-fallback hint to tree-walk before HITL.**
- In `server/chat-engine.ts`, when `moa.shouldEscalate` is true AND the tenant has any heading trees indexed, the escalation note now appends: *"If the question is grounded in an uploaded document, try `knowledge_navigate` (mode='list' then 'read') to walk the doc's heading tree before escalating."*
- Cheap pre-check (`SELECT 1 … LIMIT 1`); fail-open on DB hiccup so the warning still renders.
- Honest framing — we do **not** auto-execute the tree walk (we don't know which doc the question is grounded in without more context). The hint pushes the model toward the right tool on the next turn.

## Backlog — side-nuggets, not implemented

### Side-nugget A — `MAFIN2.5`-style eval harness (LOW priority)

If/when knowledge-library retrieval quality becomes a real complaint, port a thin eval harness:
- A handful of long-doc QA fixtures (a synthetic 100-page contract, a 50-page financial report, etc.).
- Metric: top-k chunk-recall vs. tree-walk-recall on the same questions.
- Run before/after any retrieval-tuning change.

PageIndex's published `MAFIN2.5` could be a starting fixture if license allows.

### Side-nugget B — "Don't chunk, navigate" framing for long deliverables (FUTURE-WORK)

The same mental model applies to Felix's long deliverables (multi-section PDFs, technical reports). Today Felix chunks-and-grades whole-deliverable text. A future iteration could:
1. At deliverable composition time, build the same heading tree.
2. Run `grade_deliverable` per-section using the tree, not just on the whole.
3. Auto-revise only the sections that fail grading, not the whole deliverable.

ROI not justified at current deliverable volume — log it here so it's not forgotten.

### Side-nugget C — LLM-extracted TOC for unstructured PDFs (MEDIUM, on-demand)

R105 only catches markdown headings (which our PDF→text extractor preserves for well-structured PDFs). For scanned-OCR PDFs or PDFs where the extractor strips heading hierarchy, headings won't be detected and `total_headings` will be 0.

If users upload such a doc and the chunk-only retrieval misses, we could add an opt-in fallback: one cheap LLM pass at ingest to *infer* a TOC from the body text (~$0.001/doc with `gpt-5-mini`), stored in the same `doc_heading_trees` row. Defer until a user actually hits this case.

## When to revisit

- A user uploads a long structured PDF (contract, 10-K, technical manual) AND complains that knowledge retrieval missed an obvious section → confirms hierarchical retrieval would help → also implement Side-nugget A (eval) at the same time.
- Felix deliverable QA escalations stack up on long PDFs → implement Side-nugget B.
- Persistent retrieval misses on scanned/OCR'd docs → implement Side-nugget C.

## Footnotes

- PageIndex license: MIT (`https://github.com/VectifyAI/PageIndex/blob/main/LICENSE`).
- The R105 implementation is purely additive: existing chunk-vector retrieval is unchanged, no migration of existing knowledge data was needed, and short docs (< 3 headings) are completely unaffected.
