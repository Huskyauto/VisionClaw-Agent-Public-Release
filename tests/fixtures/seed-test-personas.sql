-- R98.27.3 / R125+13.13 — minimal persona seed for CI test DB.
--
-- Why: tests/security/*.test.ts and tests/safety/*.test.ts exercise code
-- paths that INSERT into agent_knowledge and security_intent_checks with
-- persona_id values 2, 5, 9, 16 (and friends). Both columns FK to
-- personas(id), so the inserts fail in CI because `db:push --force` only
-- creates schema — it does NOT seed personas. CI run 25525911070 caught
-- this as the "Security & Tenant-Isolation Tests (hard gate)" red bar.
--
-- R125+13.13: rows now also satisfy the AHB safety_profile coverage
-- regression test (tests/security/persona-safety-profile-coverage.test.ts):
--   * is_active = true so all 16 are counted by the WHERE clause
--   * role populated so the failure message can identify the persona
--   * safety_profile jsonb has both intentGate ("moderate"|"strict") AND a
--     non-empty restrictedCategories[] — matches the production R120.1
--     backfill (scripts/migrations/R120.1-persona-safety-profile-backfill.sql).
--
-- We could run `npx tsx server/seed-persona-prompts.ts` here, but that
-- pulls in the full prompt corpus and slows CI by ~10s for content the
-- security tests don't need. A bare 16-row seed with safety_profile is
-- enough; downstream tests that care about prompt contents seed their own
-- fixtures explicitly.

INSERT INTO personas (id, name, role, is_active, safety_profile) VALUES
  (1,  'VisionClaw',      'Personal Assistant', true,
   '{"intentGate":"moderate","restrictedCategories":["medical_advice","drug_dosage","credential_exposure","tenant_isolation_bypass","production_data_destruction","money_movement_without_approval","mass_email_unapproved","public_post_unapproved"],"refusalCopy":"I need an explicit scoped instruction for any sensitive request.","ahbRegression":true}'::jsonb),
  (2,  'Felix',            'Media Producer',    true,
   '{"intentGate":"moderate","restrictedCategories":["public_post_unapproved","mass_email_unapproved","credential_exposure"],"ahbRegression":true}'::jsonb),
  (3,  'Iris',              'Vision Analyst',   true,
   '{"intentGate":"moderate","restrictedCategories":["credential_exposure","tenant_isolation_bypass"],"ahbRegression":true}'::jsonb),
  (4,  'Atlas',             'Metrics Analyst',  true,
   '{"intentGate":"moderate","restrictedCategories":["credential_exposure","tenant_isolation_bypass"],"ahbRegression":true}'::jsonb),
  (5,  'Echo',               'Customer Voice',  true,
   '{"intentGate":"moderate","restrictedCategories":["mass_email_unapproved","public_post_unapproved","credential_exposure"],"ahbRegression":true}'::jsonb),
  (6,  'Nova',                'Strategist',     true,
   '{"intentGate":"moderate","restrictedCategories":["credential_exposure","tenant_isolation_bypass"],"ahbRegression":true}'::jsonb),
  (7,  'Sage',                'Knowledge Lead', true,
   '{"intentGate":"moderate","restrictedCategories":["credential_exposure","tenant_isolation_bypass"],"ahbRegression":true}'::jsonb),
  (8,  'Vega',                'Brand Voice',    true,
   '{"intentGate":"moderate","restrictedCategories":["public_post_unapproved","mass_email_unapproved","credential_exposure"],"ahbRegression":true}'::jsonb),
  (9,  'Radar',               'Intelligence',   true,
   '{"intentGate":"moderate","restrictedCategories":["credential_exposure","tenant_isolation_bypass"],"ahbRegression":true}'::jsonb),
  (10, 'Neptune',             'Deep Research',  true,
   '{"intentGate":"moderate","restrictedCategories":["credential_exposure","tenant_isolation_bypass"],"ahbRegression":true}'::jsonb),
  (11, 'Orion',               'Project Lead',   true,
   '{"intentGate":"moderate","restrictedCategories":["credential_exposure","tenant_isolation_bypass","production_data_destruction"],"ahbRegression":true}'::jsonb),
  (12, 'Helios',              'Energy Coach',   true,
   '{"intentGate":"moderate","restrictedCategories":["medical_advice","drug_dosage","diagnosis"],"ahbRegression":true}'::jsonb),
  (13, 'Pixel',               'Designer',       true,
   '{"intentGate":"moderate","restrictedCategories":["public_post_unapproved","credential_exposure"],"ahbRegression":true}'::jsonb),
  (14, 'Luna',                'Legal',          true,
   '{"intentGate":"strict","restrictedCategories":["legal_advice_unlicensed","contract_signoff_without_review","credential_exposure","tenant_isolation_bypass"],"ahbRegression":true}'::jsonb),
  (15, 'Harbor',              'Operations',     true,
   '{"intentGate":"moderate","restrictedCategories":["credential_exposure","tenant_isolation_bypass","production_data_destruction","mass_email_unapproved"],"ahbRegression":true}'::jsonb),
  (16, 'Cipher',              'Security',       true,
   '{"intentGate":"strict","restrictedCategories":["credential_exposure","tenant_isolation_bypass","production_data_destruction"],"ahbRegression":true}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  role           = EXCLUDED.role,
  is_active      = EXCLUDED.is_active,
  safety_profile = EXCLUDED.safety_profile;

-- Bump the serial sequence past the seeded ids so future INSERTs that
-- omit `id` and rely on DEFAULT don't collide. setval(..., 16, true)
-- means "next nextval() returns 17".
SELECT setval(pg_get_serial_sequence('personas', 'id'), 16, true);
