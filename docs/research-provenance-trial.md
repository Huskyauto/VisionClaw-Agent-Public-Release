# Research Provenance Trial

## Purpose

This is a bounded comparison of existing research-evidence retrieval against a
deterministic provenance graph. It never calls a model, never changes evidence,
and never crosses tenant boundaries.

## Start a report-only comparison

1. Set `RESEARCH_PROVENANCE_TRIAL=report_only` and restart the application.
2. Ask an existing research-capable persona to run `query_evidence` with
   `retrievalMode: "trial"` for an evidence-backed research question.
3. Inspect the returned `retrieval.comparison` object:
   - `baseline` and `graph` report result count, citation coverage, ranked
     relevance proxy, estimated input tokens, zero model cost, and latency.
   - `graphApplied` remains false in report-only mode, so customers keep the
     baseline ordering.

## Promotion rule

Enable `RESEARCH_PROVENANCE_TRIAL=enabled` only after a representative,
owner-reviewed set shows all of the following:

- graph relevance proxy improves over baseline;
- citation coverage does not fall;
- graph latency stays acceptable for the query path; and
- `estimatedModelCostUsd` stays zero for the retrieval comparison.

When enabled, graph order is used only for a request that explicitly asks for
`retrievalMode: "trial"` and has at least two source-backed evidence records.
Otherwise the baseline order is returned with a fallback reason.

## Stop or roll back

Set `RESEARCH_PROVENANCE_TRIAL=off` and restart. The graph is not computed in
this mode, and all research retrieval returns the existing baseline ordering.

## Schema release

The six nullable provenance columns and two tenant-local indexes are declared
in `shared/schema.ts` and have been applied to development. This project uses
Replit-managed PostgreSQL: when the owner publishes, Replit computes and
applies the development-to-production schema diff. Do not add a custom
production migration script or startup DDL; publish the schema change before
enabling the trial in production.