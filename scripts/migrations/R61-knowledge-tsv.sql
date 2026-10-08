-- R61 — Hybrid retrieval (BM25 + vector) on agent_knowledge.
-- Adds a generated tsvector column and a GIN index so the retriever can run
-- a Postgres full-text search alongside the pgvector cosine search and fuse
-- the two with reciprocal-rank fusion (see server/embeddings.ts).
--
-- Project rule: never modify shared/schema.ts without approval.
-- Applied via direct SQL.

ALTER TABLE agent_knowledge
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(content, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS agent_knowledge_tsv_idx
  ON agent_knowledge USING GIN (tsv);
