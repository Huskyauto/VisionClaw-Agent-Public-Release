-- Unified memory forgetting lifecycle state.
-- Additive only: no existing memory rows are backfilled or rewritten.
BEGIN;

ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS archived_at timestamp;
ALTER TABLE conversation_facts ADD COLUMN IF NOT EXISTS archived_at timestamp;
ALTER TABLE agent_knowledge ADD COLUMN IF NOT EXISTS archived_at timestamp;

CREATE TABLE IF NOT EXISTS memory_retention_policies (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  mode text NOT NULL DEFAULT 'report_only',
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_at timestamp,
  retired_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_retention_policies_tenant
  ON memory_retention_policies (tenant_id);
CREATE INDEX IF NOT EXISTS idx_memory_retention_policies_tenant_status
  ON memory_retention_policies (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_memory_retention_policies_tenant_version
  ON memory_retention_policies (tenant_id, version);

CREATE TABLE IF NOT EXISTS memory_erasure_requests (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  mode text NOT NULL DEFAULT 'explicit',
  status text NOT NULL DEFAULT 'pending',
  reason_code text,
  requested_by_user_id integer,
  item_count integer NOT NULL DEFAULT 0,
  erased_count integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  started_at timestamp,
  completed_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_erasure_requests_tenant
  ON memory_erasure_requests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_memory_erasure_requests_tenant_status
  ON memory_erasure_requests (tenant_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_memory_erasure_requests_tenant_request_key
  ON memory_erasure_requests (tenant_id, request_key);

-- Platform-global compliance evidence. This is deliberately the one
-- tenant-free exception in this migration: it must survive the tenant's
-- ON DELETE CASCADE. It stores only an HMAC tenant fingerprint, an opaque
-- request key, counts, status, and timestamp -- never a tenant id, PII, or
-- memory content.
CREATE TABLE IF NOT EXISTS account_erasure_receipts (
  id serial PRIMARY KEY,
  tenant_fingerprint text NOT NULL,
  request_key text NOT NULL,
  item_count integer NOT NULL CHECK (item_count >= 0),
  erased_count integer NOT NULL CHECK (erased_count >= 0),
  status text NOT NULL,
  recorded_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_account_erasure_receipts_request_key
  ON account_erasure_receipts (request_key);
CREATE INDEX IF NOT EXISTS idx_account_erasure_receipts_fingerprint
  ON account_erasure_receipts (tenant_fingerprint);

CREATE TABLE IF NOT EXISTS memory_tombstones (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_id text NOT NULL,
  value_digest text NOT NULL,
  request_key text NOT NULL,
  reason_code text NOT NULL DEFAULT 'explicit_erasure',
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_tombstones_tenant
  ON memory_tombstones (tenant_id);
CREATE INDEX IF NOT EXISTS idx_memory_tombstones_tenant_source
  ON memory_tombstones (tenant_id, source, source_id);
CREATE INDEX IF NOT EXISTS idx_memory_tombstones_tenant_digest
  ON memory_tombstones (tenant_id, value_digest);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_memory_tombstones_tenant_source_id
  ON memory_tombstones (tenant_id, source, source_id);

-- Provenance is intentionally polymorphic.  Only tenant_id is an FK: source
-- ids refer to different memory tables and cannot safely be constrained by a
-- single relational target.  Erasure follows solely_derived edges only.
CREATE TABLE IF NOT EXISTS memory_derivations (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_source text NOT NULL,
  parent_id text NOT NULL,
  child_source text NOT NULL,
  child_id text NOT NULL,
  relationship text NOT NULL,
  solely_derived boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_derivations_tenant_parent
  ON memory_derivations (tenant_id, parent_source, parent_id);
CREATE INDEX IF NOT EXISTS idx_memory_derivations_tenant_child
  ON memory_derivations (tenant_id, child_source, child_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_memory_derivations_tenant_edge
  ON memory_derivations
    (tenant_id, parent_source, parent_id, child_source, child_id, relationship);

CREATE TABLE IF NOT EXISTS memory_lifecycle_action_claims (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  source text NOT NULL,
  source_id text NOT NULL,
  policy_version integer NOT NULL,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'claimed',
  attempt_count integer NOT NULL DEFAULT 0,
  claim_token_hash text,
  lease_expires_at timestamp,
  claimed_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp,
  failure_code text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_action_claims_tenant
  ON memory_lifecycle_action_claims (tenant_id);
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_action_claims_tenant_status_lease
  ON memory_lifecycle_action_claims (tenant_id, status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_action_claims_tenant_source
  ON memory_lifecycle_action_claims (tenant_id, source, source_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_memory_lifecycle_action_claims_tenant_action_key
  ON memory_lifecycle_action_claims (tenant_id, action_key);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_memory_lifecycle_action_claims_tenant_source_policy_action
  ON memory_lifecycle_action_claims (tenant_id, source, source_id, policy_version, action);

CREATE TABLE IF NOT EXISTS memory_lifecycle_audits (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  source text NOT NULL,
  source_id text NOT NULL,
  policy_version integer,
  action text NOT NULL,
  mode text NOT NULL DEFAULT 'report_only',
  outcome text NOT NULL DEFAULT 'recorded',
  reason_code text,
  request_key text,
  failure_code text,
  actor_user_id integer,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_audits_tenant
  ON memory_lifecycle_audits (tenant_id);
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_audits_tenant_created
  ON memory_lifecycle_audits (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_audits_tenant_action
  ON memory_lifecycle_audits (tenant_id, action, source);
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_audits_tenant_action_key
  ON memory_lifecycle_audits (tenant_id, action_key);

CREATE TABLE IF NOT EXISTS memory_forgetting_scheduler_state (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  last_scanned_at timestamp,
  next_source_offset integer NOT NULL DEFAULT 0,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_memory_forgetting_scheduler_state_tenant
  ON memory_forgetting_scheduler_state (tenant_id);
CREATE INDEX IF NOT EXISTS idx_memory_forgetting_scheduler_state_scan
  ON memory_forgetting_scheduler_state (last_scanned_at, tenant_id);
-- Operational scheduler state is deliberately separate from memory rows.  A
-- cursor is maintained per source so retained rows cannot pin a scan at the
-- beginning of a source forever.
ALTER TABLE memory_forgetting_scheduler_state
  ADD COLUMN IF NOT EXISTS source_cursors jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE memory_forgetting_scheduler_state
  ADD COLUMN IF NOT EXISTS lease_token text;
ALTER TABLE memory_forgetting_scheduler_state
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamp;
CREATE INDEX IF NOT EXISTS idx_memory_forgetting_scheduler_state_lease
  ON memory_forgetting_scheduler_state (lease_expires_at, tenant_id);

-- PostgreSQL boundary enforcement. The application sets this session GUC on
-- every pooled connection. Empty/missing values fail closed after migration.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- This is intentionally not regexp \s: NBSP and all other Unicode
-- whitespace are data, not separators, at the memory boundary.
CREATE OR REPLACE FUNCTION public.memory_ascii_canonical(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $memory_ascii_canonical$
  SELECT btrim(
    regexp_replace(
      coalesce(value, ''),
      '[' || chr(32) || chr(9) || chr(10) || chr(13) || chr(12) || chr(11) || ']+',
      ' ',
      'g'
    ),
    ' '
  )
$memory_ascii_canonical$;

CREATE OR REPLACE FUNCTION public.memory_tombstone_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $memory_tombstone_guard$
DECLARE
  row_data jsonb := to_jsonb(NEW);
  parts text[];
  canonical text := '';
  canonical_part text;
  tenant_value integer;
  hmac_key text;
  digests text[] := ARRAY[]::text[];
  sorted_digests text[];
  digest_value text;
  i integer;
  source_tenant integer;
  target_tenant integer;
BEGIN
  hmac_key := NULLIF(current_setting('app.memory_tombstone_hmac_key', true), '');
  IF hmac_key IS NULL THEN
    RAISE EXCEPTION 'memory tombstone enforcement is unavailable';
  END IF;

  -- Keep this list in lockstep with sourceCanonicalValues(): one aggregate
  -- (NUL-separated) plus every nonblank individual content field. The source
  -- name is intentionally absent from the digest.
  CASE TG_TABLE_NAME
    WHEN 'memory_entries' THEN
      parts := ARRAY[row_data->>'fact'];
    WHEN 'conversation_facts' THEN
      parts := ARRAY[row_data->>'fact_text'];
    WHEN 'agent_knowledge' THEN
      parts := ARRAY[row_data->>'title', row_data->>'content'];
    WHEN 'compaction_archives' THEN
      parts := ARRAY[row_data->>'content', row_data->>'summary'];
    WHEN 'graph_memory' THEN
      parts := ARRAY[row_data->>'path', row_data->>'content'];
    WHEN 'knowledge_triples' THEN
      parts := ARRAY[row_data->>'subject', row_data->>'predicate',
        row_data->>'object'];
    WHEN 'knowledge_nudges' THEN
      parts := ARRAY[row_data->>'fact'];
    WHEN 'messages' THEN
      parts := ARRAY[row_data->>'content'];
    WHEN 'graph_memory_links' THEN
      parts := ARRAY[row_data->>'source_path', row_data->>'target_path',
        row_data->>'link_type'];
    WHEN 'memory_links' THEN
      parts := ARRAY[row_data->>'source_memory_id', row_data->>'target_memory_id',
        row_data->>'link_type'];
      -- memory_links has no tenant column. Derive it from both endpoints and
      -- reject a cross-tenant edge before it can be inserted or restored.
      SELECT source_entry.tenant_id, target_entry.tenant_id
        INTO source_tenant, target_tenant
        FROM public.memory_entries AS source_entry
        JOIN public.memory_entries AS target_entry
          ON target_entry.id = (row_data->>'target_memory_id')::integer
        WHERE source_entry.id = (row_data->>'source_memory_id')::integer;
      IF NOT FOUND OR source_tenant IS NULL OR target_tenant IS NULL
        OR source_tenant <> target_tenant THEN
        RAISE EXCEPTION 'memory link endpoints must belong to the same tenant';
      END IF;
    ELSE
      RAISE EXCEPTION 'memory tombstone guard attached to unsupported table';
  END CASE;

  tenant_value := COALESCE(source_tenant, (row_data->>'tenant_id')::integer);
  -- canonicalMemoryValue() trims and collapses only ASCII space, tab, LF,
  -- CR, formfeed, and vertical-tab in each part, then joins parts with a
  -- unit separator. NULL elements become empty strings.
  FOR i IN 1..array_length(parts, 1) LOOP
    IF i > 1 THEN
      canonical := canonical || U&'\001F';
    END IF;
    canonical := canonical || public.memory_ascii_canonical(parts[i]);
  END LOOP;
  digests := array_append(digests, encode(hmac(
    tenant_value::text || U&'\001F' || canonical, hmac_key, 'sha256'), 'hex'));

  FOREACH canonical_part IN ARRAY parts LOOP
    canonical_part := public.memory_ascii_canonical(canonical_part);
    IF canonical_part <> '' THEN
      digests := array_append(digests, encode(hmac(
        tenant_value::text || U&'\001F' || canonical_part, hmac_key, 'sha256'), 'hex'));
    END IF;
  END LOOP;

  -- Erasure and writes take the same locks in digest order.
  SELECT array_agg(d ORDER BY d)
    INTO sorted_digests
    FROM unnest(digests) AS digest_rows(d);
  FOREACH digest_value IN ARRAY sorted_digests LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(digest_value, 0::bigint));
    IF EXISTS (
      SELECT 1 FROM public.memory_tombstones AS tombstone
      WHERE tombstone.tenant_id = tenant_value
        AND tombstone.value_digest = digest_value
    ) THEN
      RAISE EXCEPTION 'memory write refused: erased content cannot be restored';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$memory_tombstone_guard$;

-- Drop/recreate makes this additive block safe to re-run in development.
DROP TRIGGER IF EXISTS memory_tombstone_guard ON memory_entries;
CREATE TRIGGER memory_tombstone_guard BEFORE INSERT OR UPDATE ON memory_entries
  FOR EACH ROW EXECUTE FUNCTION public.memory_tombstone_guard();
DROP TRIGGER IF EXISTS memory_tombstone_guard ON conversation_facts;
CREATE TRIGGER memory_tombstone_guard BEFORE INSERT OR UPDATE ON conversation_facts
  FOR EACH ROW EXECUTE FUNCTION public.memory_tombstone_guard();
DROP TRIGGER IF EXISTS memory_tombstone_guard ON agent_knowledge;
CREATE TRIGGER memory_tombstone_guard BEFORE INSERT OR UPDATE ON agent_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.memory_tombstone_guard();
DROP TRIGGER IF EXISTS memory_tombstone_guard ON compaction_archives;
CREATE TRIGGER memory_tombstone_guard BEFORE INSERT OR UPDATE ON compaction_archives
  FOR EACH ROW EXECUTE FUNCTION public.memory_tombstone_guard();
DROP TRIGGER IF EXISTS memory_tombstone_guard ON graph_memory;
CREATE TRIGGER memory_tombstone_guard BEFORE INSERT OR UPDATE ON graph_memory
  FOR EACH ROW EXECUTE FUNCTION public.memory_tombstone_guard();
DROP TRIGGER IF EXISTS memory_tombstone_guard ON knowledge_triples;
CREATE TRIGGER memory_tombstone_guard BEFORE INSERT OR UPDATE ON knowledge_triples
  FOR EACH ROW EXECUTE FUNCTION public.memory_tombstone_guard();
DROP TRIGGER IF EXISTS memory_tombstone_guard ON knowledge_nudges;
CREATE TRIGGER memory_tombstone_guard BEFORE INSERT OR UPDATE ON knowledge_nudges
  FOR EACH ROW EXECUTE FUNCTION public.memory_tombstone_guard();
DROP TRIGGER IF EXISTS memory_tombstone_guard ON messages;
CREATE TRIGGER memory_tombstone_guard BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION public.memory_tombstone_guard();
DROP TRIGGER IF EXISTS memory_tombstone_guard ON graph_memory_links;
CREATE TRIGGER memory_tombstone_guard BEFORE INSERT OR UPDATE ON graph_memory_links
  FOR EACH ROW EXECUTE FUNCTION public.memory_tombstone_guard();
DROP TRIGGER IF EXISTS memory_tombstone_guard ON memory_links;
CREATE TRIGGER memory_tombstone_guard BEFORE INSERT OR UPDATE ON memory_links
  FOR EACH ROW EXECUTE FUNCTION public.memory_tombstone_guard();

COMMIT;

-- Rollback (run only after disabling the forgetting coordinator):
-- DROP TRIGGER IF EXISTS memory_tombstone_guard ON memory_links;
-- DROP TRIGGER IF EXISTS memory_tombstone_guard ON graph_memory_links;
-- DROP TRIGGER IF EXISTS memory_tombstone_guard ON messages;
-- DROP TRIGGER IF EXISTS memory_tombstone_guard ON knowledge_nudges;
-- DROP TRIGGER IF EXISTS memory_tombstone_guard ON knowledge_triples;
-- DROP TRIGGER IF EXISTS memory_tombstone_guard ON graph_memory;
-- DROP TRIGGER IF EXISTS memory_tombstone_guard ON compaction_archives;
-- DROP TRIGGER IF EXISTS memory_tombstone_guard ON agent_knowledge;
-- DROP TRIGGER IF EXISTS memory_tombstone_guard ON conversation_facts;
-- DROP TRIGGER IF EXISTS memory_tombstone_guard ON memory_entries;
-- DROP FUNCTION IF EXISTS public.memory_tombstone_guard();
-- DROP FUNCTION IF EXISTS public.memory_ascii_canonical(text);
-- DROP INDEX IF EXISTS idx_memory_forgetting_scheduler_state_lease;
-- DROP INDEX IF EXISTS idx_memory_lifecycle_audits_tenant_action_key;
-- DROP INDEX IF EXISTS idx_memory_lifecycle_audits_tenant_action;
-- DROP INDEX IF EXISTS idx_memory_lifecycle_audits_tenant_created;
-- DROP INDEX IF EXISTS idx_memory_lifecycle_audits_tenant;
-- DROP INDEX IF EXISTS uidx_memory_lifecycle_action_claims_tenant_source_policy_action;
-- DROP INDEX IF EXISTS uidx_memory_lifecycle_action_claims_tenant_action_key;
-- DROP INDEX IF EXISTS idx_memory_lifecycle_action_claims_tenant_source;
-- DROP INDEX IF EXISTS idx_memory_lifecycle_action_claims_tenant_status_lease;
-- DROP INDEX IF EXISTS idx_memory_lifecycle_action_claims_tenant;
-- DROP INDEX IF EXISTS uidx_memory_forgetting_scheduler_state_tenant;
-- DROP INDEX IF EXISTS idx_memory_forgetting_scheduler_state_scan;
-- DROP INDEX IF EXISTS uidx_memory_derivations_tenant_edge;
-- DROP INDEX IF EXISTS idx_memory_derivations_tenant_child;
-- DROP INDEX IF EXISTS idx_memory_derivations_tenant_parent;
-- DROP INDEX IF EXISTS uidx_memory_tombstones_tenant_source_id;
-- DROP INDEX IF EXISTS idx_memory_tombstones_tenant_digest;
-- DROP INDEX IF EXISTS idx_memory_tombstones_tenant_source;
-- DROP INDEX IF EXISTS idx_memory_tombstones_tenant;
-- DROP INDEX IF EXISTS uidx_memory_erasure_requests_tenant_request_key;
-- DROP INDEX IF EXISTS idx_memory_erasure_requests_tenant_status;
-- DROP INDEX IF EXISTS idx_memory_erasure_requests_tenant;
-- DROP INDEX IF EXISTS idx_account_erasure_receipts_fingerprint;
-- DROP INDEX IF EXISTS uidx_account_erasure_receipts_request_key;
-- DROP INDEX IF EXISTS uidx_memory_retention_policies_tenant_version;
-- DROP INDEX IF EXISTS idx_memory_retention_policies_tenant_status;
-- DROP INDEX IF EXISTS idx_memory_retention_policies_tenant;
-- DROP TABLE IF EXISTS memory_lifecycle_audits;
-- DROP TABLE IF EXISTS memory_lifecycle_action_claims;
-- ALTER TABLE memory_forgetting_scheduler_state DROP COLUMN IF EXISTS lease_expires_at;
-- ALTER TABLE memory_forgetting_scheduler_state DROP COLUMN IF EXISTS lease_token;
-- ALTER TABLE memory_forgetting_scheduler_state DROP COLUMN IF EXISTS source_cursors;
-- DROP TABLE IF EXISTS memory_forgetting_scheduler_state;
-- DROP TABLE IF EXISTS memory_tombstones;
-- DROP TABLE IF EXISTS memory_derivations;
-- DROP TABLE IF EXISTS memory_erasure_requests;
-- DROP TABLE IF EXISTS account_erasure_receipts;
-- DROP TABLE IF EXISTS memory_retention_policies;
-- ALTER TABLE agent_knowledge DROP COLUMN IF EXISTS archived_at;
-- ALTER TABLE conversation_facts DROP COLUMN IF EXISTS archived_at;
-- ALTER TABLE memory_entries DROP COLUMN IF EXISTS archived_at;