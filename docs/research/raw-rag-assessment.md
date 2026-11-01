# RAW-RAG: preserve source evidence before adding memory complexity

## Source and verdict

Reviewed October 27, 2026: https://arxiv.org/html/2610.30755v1

*Is Complex Agentic Memory Always Needed? Naive RAG Is Stronger Than We Thought*, October 22, 2026.

Verdict: strong reason to require a well-tuned raw-history baseline and preserve authorized source evidence. Not evidence to remove structured memory, privacy deletion, or current-state controls. No runtime changes.

## Observed in the paper

- RAW-RAG uses timestamped raw dialogue, 256-token windows with 32-token overlap, 128 dense candidates and cross-encoder reranking to 15 evidence items. “Naive” does not mean an unranked top-one vector lookup.
- It leads compared memory systems in six of seven benchmark/model settings, excluding full-context. The reported margins are 0.13–5.53 percentage points, not multiplicative improvements or proof of practical significance in every setting.
- The exception is DeepSeek-V4-Flash on MEME: MemMachine scores 44.71, RAW-RAG 43.19, and full-context 63.17. RAW-RAG's cascade score is 3.66 in that setting. A high overall rank is not robust dynamic-state mastery.
- On the reported MemoryAgentBench ablation, removing reranking costs 3.92 points. Atomic-fact replacement costs 19.62 points; summary augmentation and graph expansion also regress in their tested constructions. This is not a proof that all summaries or graphs are harmful.
- BEAM-1M sequential ingestion is 0.33 hours for RAW-RAG versus up to 26.95 hours for a compared system. Ingestion is not end-to-end answer latency or dollar cost. The separate MEME latency table excludes generation/evaluation; RAW-RAG search is slower than Mem0 search despite much cheaper ingestion and combined time.
- The paper limits its conclusions to offline public conversation benchmarks, identifies storage/privacy concerns, and notes reader capability affects state reconstruction. Complete-store controls are gold-informed diagnostics, not deployable retrievers.
- Appendix A uses setting-specific embedding/reranking configurations, including Qwen3 4B components and Cohere. Reproducing those components locally is not assumed feasible within the current VM budget.

## Native comparison and cross-case review

Inspected native interfaces show that VisionClaw has derived facts/temporal triples, a `recall_context` route for archived conversation context, and a unified-memory view that explicitly excludes messages. These are different surfaces; a unified view is not proof that automatic turn retrieval searches raw history. No complete ingestion/retrieval audit or source-retention guarantee was established here.

| Case | Engineering implication |
|---|---|
| Exact wording, exceptions, reasons | Retain permitted source excerpts and provenance; extracted values alone can lose meaning |
| Corrections and changing preferences | Retrieve chronology and the superseding correction, not just the highest semantic match |
| Multi-hop dependencies | Evaluate whether all necessary relations are present, not just the final value |
| Stable preferences and operational state | Structured records may reduce repeated reasoning and provide explicit current-state semantics |
| Forget requests, access revocation, tenant boundaries | Raw-history fallback must obey deletion and authorization; never resurrect deleted content |
| Similar documents with headings | STAIR and RAW-RAG are compatible: preserve document hierarchy where useful and original conversational evidence where useful |

This is a source-level cross-case review, not an executed performance experiment.

## Candidate claim and smallest meaningful test

HYPOTHESIS: Adding or improving authorized raw-history evidence retrieval reduces errors caused by lossy derived memory without unacceptable latency, token cost or privacy regressions.

Baseline: the actual current native retrieval, not an artificially weakened summary-only substitute. Compare with raw-history dense retrieval plus reranking, and with the existing retrieval augmented by bounded source excerpts. Freeze reader model, evidence-token budget, source versions and evaluation questions.

Use development-independent cases spanning exact recall, correction chronology, temporal reasoning, dependency chains, insufficient evidence, revoked/deleted facts and cross-tenant decoys. Measure answer accuracy, complete evidence coverage, stale-fact errors, abstention, privacy violations, ingestion cost and per-query economics. Safety violations are not averaged away.

DISPROOF/STOP: No held-out quality improvement; lost current-state correctness; any unauthorized/deleted evidence returned; or operating cost that exceeds the benefit. Do not install a local 4B reranker merely to reproduce a paper recipe.

VALIDATION STATUS: Untested for VisionClaw. No matched held-out source-history corpus was assembled, no reader experiment ran, and no native gains are claimed. Retain the research; revisit when an evidence-loss failure can be reproduced with an authorized fixture.
