import { db } from "../db";
import { sql } from "drizzle-orm";

/** Additive bootstrap, matching shared/schema.ts; no existing data is removed. */
export async function ensureFelixConnectorSchema() {
  await db.execute(sql`
    ALTER TABLE spark_outbox ADD COLUMN IF NOT EXISTS recipient text NOT NULL DEFAULT 'spark';
    CREATE INDEX IF NOT EXISTS idx_spark_outbox_recipient_cursor ON spark_outbox(tenant_id,recipient,id);
    CREATE TABLE IF NOT EXISTS felix_connector_records (
      id text PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      kind text NOT NULL, client_id text NOT NULL, payload text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_felix_connector_records_tenant_client ON felix_connector_records(tenant_id,client_id);
    CREATE INDEX IF NOT EXISTS idx_felix_connector_records_expiry ON felix_connector_records(expires_at);
    CREATE TABLE IF NOT EXISTS felix_line_clients (
      client_id text PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      conversation_id integer NOT NULL REFERENCES conversations(id), outbox_cursor integer NOT NULL DEFAULT 0,
      delivered_id integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_felix_line_clients_tenant ON felix_line_clients(tenant_id,client_id);
    ALTER TABLE felix_line_clients ADD COLUMN IF NOT EXISTS allow_work boolean NOT NULL DEFAULT false;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_felix_line_clients_conversation ON felix_line_clients(conversation_id);
    CREATE TABLE IF NOT EXISTS felix_line_turns (
      request_id text PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_id text NOT NULL REFERENCES felix_line_clients(client_id),
      conversation_id integer NOT NULL REFERENCES conversations(id), idempotency_key text NOT NULL,
      message_hash text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_felix_line_turns_key ON felix_line_turns(tenant_id,client_id,idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_felix_line_turns_client_created ON felix_line_turns(tenant_id,client_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_felix_line_turns_client ON felix_line_turns(client_id);
    CREATE INDEX IF NOT EXISTS idx_felix_line_turns_conversation ON felix_line_turns(conversation_id);
    CREATE TABLE IF NOT EXISTS felix_line_audit (
      id serial PRIMARY KEY, tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_id text NOT NULL REFERENCES felix_line_clients(client_id), tool text NOT NULL,
      request_id text, ok boolean NOT NULL, error text, at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_felix_line_audit_tenant_at ON felix_line_audit(tenant_id,at);
    CREATE INDEX IF NOT EXISTS idx_felix_line_audit_client ON felix_line_audit(client_id);
  `);
}
