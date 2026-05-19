-- R98.27.3 — minimal persona seed for CI test DB.
--
-- Why: tests/security/*.test.ts and tests/safety/*.test.ts exercise code
-- paths that INSERT into agent_knowledge and security_intent_checks with
-- persona_id values 2, 5, 9, 16 (and friends). Both columns FK to
-- personas(id), so the inserts fail in CI because `db:push --force` only
-- creates schema — it does NOT seed personas. CI run 25525911070 caught
-- this as the "Security & Tenant-Isolation Tests (hard gate)" red bar.
--
-- We could run `npx tsx server/seed-persona-prompts.ts` here, but that
-- pulls in the full prompt corpus and slows CI by ~10s for content the
-- security tests don't need. A bare 16-row seed is enough to satisfy the
-- FK constraint; downstream tests that care about prompt contents seed
-- their own fixtures explicitly.

INSERT INTO personas (id, name) VALUES
  (1,  'VisionClaw'),
  (2,  'Felix'),
  (3,  'Iris'),
  (4,  'Atlas'),
  (5,  'Echo'),
  (6,  'Nova'),
  (7,  'Sage'),
  (8,  'Vega'),
  (9,  'Radar'),
  (10, 'Neptune'),
  (11, 'Orion'),
  (12, 'Helios'),
  (13, 'Pixel'),
  (14, 'Luna'),
  (15, 'Harbor'),
  (16, 'Cipher')
ON CONFLICT (id) DO NOTHING;

-- Bump the serial sequence past the seeded ids so future INSERTs that
-- omit `id` and rely on DEFAULT don't collide. setval(..., 16, true)
-- means "next nextval() returns 17".
SELECT setval(pg_get_serial_sequence('personas', 'id'), 16, true);
