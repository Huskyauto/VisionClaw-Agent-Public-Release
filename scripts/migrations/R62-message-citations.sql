-- R62 — Citation tracking on assistant messages.
-- Adds a jsonb column carrying the retrieved chunks (knowledge + memory) that
-- were actually injected into the system prompt for the response. Surfaced in
-- the chat UI as a "Sources" pill so the user can see what the agent grounded
-- its answer on.
--
-- Shape of each citation:
--   { kind: "knowledge"|"memory", id: number, title: string,
--     snippet: string, score: number, retrieval?: "vector"|"bm25"|"hybrid" }
--
-- Project rule: never modify shared/schema.ts without approval.
-- Applied via direct SQL.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS citations jsonb;
