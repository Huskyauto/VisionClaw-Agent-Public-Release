# Agent architectures: primer review

**Filed:** October 2, 2026  
**Disposition:** Retain as an engineering design/review checklist. No implementation or architecture rebuild requested.

## Source and evidence limits

Bob supplied a social post titled “What are Agent Architectures? (in AI engineering interviews),” attributed in its text to `#jamesCodeLab`, plus an infographic branded DataInterview.

Original supplied image: [Agent Architectures](../../attached_assets/FB_IMG_1790994243686_1790994308925.jpg).

No original post URL, publication date, research paper, or measured comparison was supplied. This is educational guidance, not experimental evidence that one architecture is better or cheaper.

## Useful ideas

Agent architectures structure how models choose actions, use tools, interpret observations, and complete tasks. The strongest takeaway is knowing when **not** to add an agent loop.

| Pattern | Useful when | Main failure mode |
|---|---|---|
| ReAct: choose a step, act, inspect the result, repeat | The next action depends on new evidence, as in exploratory research or troubleshooting | Repeated actions without meaningful progress |
| Plan and execute: separate planning from execution | The task decomposes into clear steps with known dependencies | Following a plan after its assumptions become invalid |
| Reflection: evaluate and revise | Output has explicit, checkable quality requirements | Improving presentation while preserving factual errors |
| Multi-agent: coordinate separate workers | Isolation, permissions, parallel work, or independent evaluation justify separation | Coordination overhead and correlated mistakes |

These are overlapping patterns, not four mutually exclusive choices. A planned workflow can contain adaptive steps, specialist workers, and bounded review.

## Corrections and caveats

### Planning is not automatically cheaper

Savings depend on how much reasoning execution still requires. Model calls at every step, retries, and replanning can erase the advantage. A plan can be a sequence or partial plan; it need not be a complete dependency graph prepared up front.

Compare total observed cost and latency **per independently verified successful task**, including failed attempts and recovery.

### Reflection is not verification

Self-review can reproduce the original mistake. Use reflection to identify possible weaknesses; use tests, source evidence, exact-field checks, and durable receipts to establish completion or correctness.

The diagram's model critique and heuristic score do not prove factual accuracy, safety, or external action completion.

### Specialties do not automatically require separate agents

Retrieval, reasoning, and writing may be stages within one controlled workflow. Separate agents are justified by a concrete benefit: distinct authority, isolated context, useful parallelism, or independent evaluation.

Different persona names alone do not establish independent judgment.

### Memory and operational controls need more detail

A scratchpad is temporary working state; a vector store is a persistent retrieval mechanism. They have different retention, privacy, freshness, and deletion requirements.

Step limits are necessary but insufficient. Production workflows also need time/cost bounds, progress detection, bounded recovery, authorization, approval for consequential actions, idempotency, and evidence-backed completion.

## VisionClaw comparison

Read-only inspection during this review found existing equivalents:

- `server/chat-engine.ts`: tool-use rounds, tool budgets, loop detection, and automatic heavy-loop assessment.
- `server/plan-executor.ts`: execution with bounded replanning and tool-policy enforcement.
- `server/self-reflection.ts`: output evaluation and refinement.
- `server/ceo-orchestrator.ts`: specialist coordination.
- `server/orchestration-efficiency.ts`: lightweight assessment of whether heavy orchestration is worthwhile.

These observations establish that mechanisms exist in the inspected source. They do not establish optimal routing, production activation of every path, or measured performance.

## Retained decision rule

1. Use deterministic code for known procedures.
2. Use one bounded model call when interpretation is needed but the workflow is fixed.
3. Use an adaptive loop when new evidence genuinely determines the next action.
4. Use planning when dependencies and execution structure warrant it; permit bounded replanning.
5. Delegate only when separation adds measurable value.
6. Apply review proportionate to consequence, with independent verification wherever possible.

**Verdict:** Useful vocabulary and a complexity-control checklist. No new capability, broader agent autonomy, or platform rebuild is justified by this primer alone.

**Reconsider only with evidence:** repeated no-progress tool calls, stale plans continuing after contradictions, revisions that retain factual errors, redundant specialist handoffs, or unnecessarily expensive routing on simple tasks.