-- R120.1+sec — AHB safety_profile backfill for active personas.
--
-- Architect post-edit code review (R120 round 2 whole-app sweep) found 10 of
-- 16 active personas had safety_profile = '{}'::jsonb in the live DB. The
-- intent gate (server/safety/intent-gate.ts:154) defaults mode to "off" and
-- bypasses entirely when restrictedCategories is empty — so adversarially-
-- styled requests routed to one of those 10 personas would not be screened.
--
-- This migration is IDEMPOTENT: it only updates rows where safety_profile is
-- still the empty default. Personas that were already populated (Felix,
-- Teagan, Apollo, Robert) are untouched.
--
-- Severity classification:
--   HIGH-touch (consumer-facing / public surface): VisionClaw, Scribe
--   MEDIUM (internal but can trigger destructive tools): Forge, Chief of
--     Staff, Agent Blueprint, Proof, Radar, Neptune, Atlas, Minerva
--   STRICT (money / legal — anything they sign off on has external impact):
--     Cassandra (CFO), Luna (Legal & Compliance)
--
-- Categories used (kept consistent with already-populated personas):
--   medical_advice, drug_dosage, diagnosis, self_harm_facilitation
--   credential_exposure, tenant_isolation_bypass
--   money_movement_without_approval, mass_email_unapproved
--   public_post_unapproved, production_data_destruction
--   legal_advice_unlicensed, contract_signoff_without_review

BEGIN;

-- VisionClaw — general AI assistant, public surface, broadest screen
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'moderate',
  'restrictedCategories', jsonb_build_array(
    'medical_advice', 'drug_dosage', 'diagnosis', 'self_harm_facilitation',
    'credential_exposure', 'tenant_isolation_bypass',
    'production_data_destruction', 'money_movement_without_approval',
    'mass_email_unapproved', 'public_post_unapproved'
  ),
  'refusalCopy', 'I can help with general questions, but for anything involving prescriptions, dosage, money movement, mass communications, or production-data changes I need an explicit, scoped instruction and (where appropriate) human approval.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'VisionClaw' AND safety_profile = '{}'::jsonb;

-- Scribe — content creator, can publish to public channels
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'moderate',
  'restrictedCategories', jsonb_build_array(
    'mass_email_unapproved', 'public_post_unapproved',
    'credential_exposure', 'tenant_isolation_bypass'
  ),
  'refusalCopy', 'I need an explicit, scoped instruction (target audience, exact copy, platforms, and send window) before I can publish or schedule anything that hits a public channel.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'Scribe' AND safety_profile = '{}'::jsonb;

-- Forge — staff engineer, can write code and trigger shell/build/migration
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'moderate',
  'restrictedCategories', jsonb_build_array(
    'production_data_destruction', 'credential_exposure',
    'tenant_isolation_bypass', 'mass_email_unapproved'
  ),
  'refusalCopy', 'Production-data changes, credential exposure, and tenant-isolation modifications require an explicit scoped instruction and HITL approval before I will proceed.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'Forge' AND safety_profile = '{}'::jsonb;

-- Chief of Staff — operations director, delivery + file movement
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'moderate',
  'restrictedCategories', jsonb_build_array(
    'mass_email_unapproved', 'public_post_unapproved',
    'credential_exposure', 'tenant_isolation_bypass',
    'production_data_destruction'
  ),
  'refusalCopy', 'Mass communications, public posts, and production-data changes need an explicit, scoped instruction with approval before I will execute the handoff.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'Chief of Staff' AND safety_profile = '{}'::jsonb;

-- Agent Blueprint — multi-agent system operator
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'moderate',
  'restrictedCategories', jsonb_build_array(
    'credential_exposure', 'tenant_isolation_bypass',
    'production_data_destruction'
  ),
  'refusalCopy', 'Modifications to credentials, tenant isolation, or production data require an explicit scoped instruction and approval.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'Agent Blueprint' AND safety_profile = '{}'::jsonb;

-- Proof — content reviewer (read-mostly, but can approve publication)
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'moderate',
  'restrictedCategories', jsonb_build_array(
    'public_post_unapproved', 'mass_email_unapproved'
  ),
  'refusalCopy', 'Approving content for a public channel requires an explicit scoped instruction naming the audience, the platform, and the send window.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'Proof' AND safety_profile = '{}'::jsonb;

-- Radar — intelligence analyst (research; can call external APIs)
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'moderate',
  'restrictedCategories', jsonb_build_array(
    'credential_exposure', 'tenant_isolation_bypass'
  ),
  'refusalCopy', 'Anything that would expose credentials or cross a tenant boundary needs an explicit scoped instruction first.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'Radar' AND safety_profile = '{}'::jsonb;

-- Neptune — deep research specialist
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'moderate',
  'restrictedCategories', jsonb_build_array(
    'credential_exposure', 'tenant_isolation_bypass'
  ),
  'refusalCopy', 'Anything that would expose credentials or cross a tenant boundary needs an explicit scoped instruction first.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'Neptune' AND safety_profile = '{}'::jsonb;

-- Atlas — metrics & reporting analyst (read-heavy)
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'moderate',
  'restrictedCategories', jsonb_build_array(
    'credential_exposure', 'tenant_isolation_bypass'
  ),
  'refusalCopy', 'Anything that would expose credentials or cross a tenant boundary needs an explicit scoped instruction first.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'Atlas' AND safety_profile = '{}'::jsonb;

-- Minerva — strategic planner (plans only, never executes)
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'moderate',
  'restrictedCategories', jsonb_build_array(
    'credential_exposure', 'tenant_isolation_bypass'
  ),
  'refusalCopy', 'I produce plans only and never execute. Even so, plans involving credentials or tenant-isolation changes require an explicit scoped instruction before I will draft them.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'Minerva' AND safety_profile = '{}'::jsonb;

-- Cassandra — CFO (STRICT: anything she signs off on moves money)
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'strict',
  'restrictedCategories', jsonb_build_array(
    'money_movement_without_approval', 'credential_exposure',
    'tenant_isolation_bypass', 'mass_email_unapproved'
  ),
  'refusalCopy', 'Any money movement, credential change, or mass financial communication requires an explicit scoped instruction AND human approval before I will proceed.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'Cassandra' AND safety_profile = '{}'::jsonb;

-- Luna — legal & compliance officer (STRICT: signoff has external impact)
UPDATE personas SET safety_profile = jsonb_build_object(
  'intentGate', 'strict',
  'restrictedCategories', jsonb_build_array(
    'legal_advice_unlicensed', 'contract_signoff_without_review',
    'credential_exposure', 'tenant_isolation_bypass'
  ),
  'refusalCopy', 'I am not a licensed attorney. Contract signoff, legal advice beyond general information, and credential/tenant-isolation changes require an explicit scoped instruction and the appropriate human review.',
  'destructiveToolPolicy', 'require_structured_intent',
  'ahbRegression', true
) WHERE name = 'Luna' AND safety_profile = '{}'::jsonb;

COMMIT;

-- Verification (run after this migration to confirm 0 active personas with empty profile):
--   SELECT count(*) FROM personas WHERE is_active = true AND safety_profile = '{}'::jsonb;
