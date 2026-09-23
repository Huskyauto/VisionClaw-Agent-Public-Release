-- =============================================================================
-- R79.2 — Stripe Sync mirror bootstrap for fresh CI Postgres.
--
-- WHY: routes (server/routes/stripe-checkout.ts, server/routes.ts) and tests
-- (tests/security/anonymous-checkout-isolation.test.ts,
--  tests/security/tenant-checkout-isolation.test.ts) query stripe.* tables
-- directly via raw SQL. In dev/prod these tables are populated by an external
-- Stripe Sync process; they use Postgres-native features (GENERATED ALWAYS AS
-- STORED columns, FKs, BEFORE-UPDATE triggers) that Drizzle ORM cannot
-- faithfully express. So we bootstrap a fresh CI DB with the EXACT live shape
-- via this fixture instead of declaring them in shared/schema.ts.
--
-- WHEN: run by .github/workflows/ci.yml in the security-tests job, AFTER
-- `npm run db:push -- --force` and BEFORE the test step.
--
-- VERIFIED 1:1 against `psql \d stripe.accounts/prices/products/payment_intents`
-- on the live dev DB on 2026-05-02. If you change a column here, also confirm
-- the live DB shape matches via psql before merging.
--
-- IDEMPOTENT: every CREATE uses IF NOT EXISTS / CREATE OR REPLACE so this
-- fixture can be re-run against a partially-populated DB without errors.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS stripe;

-- ---- shared trigger function (lives in public, matches prod exactly) -------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  new._updated_at = now();
  return NEW;
end;
$function$;

-- ---- stripe.accounts -------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe.accounts (
    _raw_data         jsonb                    NOT NULL,
    first_synced_at   timestamp with time zone NOT NULL DEFAULT now(),
    _last_synced_at   timestamp with time zone NOT NULL DEFAULT now(),
    _updated_at       timestamp with time zone NOT NULL DEFAULT now(),
    business_name     text                     GENERATED ALWAYS AS ((_raw_data -> 'business_profile'::text) ->> 'name'::text) STORED,
    email             text                     GENERATED ALWAYS AS (_raw_data ->> 'email'::text) STORED,
    type              text                     GENERATED ALWAYS AS (_raw_data ->> 'type'::text) STORED,
    charges_enabled   boolean                  GENERATED ALWAYS AS ((_raw_data ->> 'charges_enabled'::text)::boolean) STORED,
    payouts_enabled   boolean                  GENERATED ALWAYS AS ((_raw_data ->> 'payouts_enabled'::text)::boolean) STORED,
    details_submitted boolean                  GENERATED ALWAYS AS ((_raw_data ->> 'details_submitted'::text)::boolean) STORED,
    country           text                     GENERATED ALWAYS AS (_raw_data ->> 'country'::text) STORED,
    default_currency  text                     GENERATED ALWAYS AS (_raw_data ->> 'default_currency'::text) STORED,
    created           integer                  GENERATED ALWAYS AS ((_raw_data ->> 'created'::text)::integer) STORED,
    api_key_hashes    text[]                   DEFAULT '{}'::text[],
    id                text                     GENERATED ALWAYS AS (_raw_data ->> 'id'::text) STORED,
    CONSTRAINT accounts_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_accounts_api_key_hashes ON stripe.accounts USING gin (api_key_hashes);
CREATE INDEX IF NOT EXISTS idx_accounts_business_name  ON stripe.accounts USING btree (business_name);
DROP TRIGGER IF EXISTS handle_updated_at ON stripe.accounts;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.accounts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- stripe.products -------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe.products (
    _updated_at          timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    _last_synced_at      timestamp with time zone,
    _raw_data            jsonb,
    _account_id          text                     NOT NULL,
    object               text                     GENERATED ALWAYS AS (_raw_data ->> 'object'::text) STORED,
    active               boolean                  GENERATED ALWAYS AS ((_raw_data ->> 'active'::text)::boolean) STORED,
    default_price        text                     GENERATED ALWAYS AS (_raw_data ->> 'default_price'::text) STORED,
    description          text                     GENERATED ALWAYS AS (_raw_data ->> 'description'::text) STORED,
    metadata             jsonb                    GENERATED ALWAYS AS (_raw_data -> 'metadata'::text) STORED,
    name                 text                     GENERATED ALWAYS AS (_raw_data ->> 'name'::text) STORED,
    created              integer                  GENERATED ALWAYS AS ((_raw_data ->> 'created'::text)::integer) STORED,
    images               jsonb                    GENERATED ALWAYS AS (_raw_data -> 'images'::text) STORED,
    marketing_features   jsonb                    GENERATED ALWAYS AS (_raw_data -> 'marketing_features'::text) STORED,
    livemode             boolean                  GENERATED ALWAYS AS ((_raw_data ->> 'livemode'::text)::boolean) STORED,
    package_dimensions   jsonb                    GENERATED ALWAYS AS (_raw_data -> 'package_dimensions'::text) STORED,
    shippable            boolean                  GENERATED ALWAYS AS ((_raw_data ->> 'shippable'::text)::boolean) STORED,
    statement_descriptor text                     GENERATED ALWAYS AS (_raw_data ->> 'statement_descriptor'::text) STORED,
    unit_label           text                     GENERATED ALWAYS AS (_raw_data ->> 'unit_label'::text) STORED,
    updated              integer                  GENERATED ALWAYS AS ((_raw_data ->> 'updated'::text)::integer) STORED,
    url                  text                     GENERATED ALWAYS AS (_raw_data ->> 'url'::text) STORED,
    id                   text                     GENERATED ALWAYS AS (_raw_data ->> 'id'::text) STORED,
    CONSTRAINT products_pkey PRIMARY KEY (id),
    CONSTRAINT fk_products_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id)
);
DROP TRIGGER IF EXISTS handle_updated_at ON stripe.products;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.products
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- stripe.prices ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS stripe.prices (
    _updated_at         timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
    _last_synced_at     timestamp with time zone,
    _raw_data           jsonb,
    _account_id         text                     NOT NULL,
    object              text                     GENERATED ALWAYS AS (_raw_data ->> 'object'::text) STORED,
    active              boolean                  GENERATED ALWAYS AS ((_raw_data ->> 'active'::text)::boolean) STORED,
    currency            text                     GENERATED ALWAYS AS (_raw_data ->> 'currency'::text) STORED,
    metadata            jsonb                    GENERATED ALWAYS AS (_raw_data -> 'metadata'::text) STORED,
    nickname            text                     GENERATED ALWAYS AS (_raw_data ->> 'nickname'::text) STORED,
    recurring           jsonb                    GENERATED ALWAYS AS (_raw_data -> 'recurring'::text) STORED,
    type                text                     GENERATED ALWAYS AS (_raw_data ->> 'type'::text) STORED,
    unit_amount         integer                  GENERATED ALWAYS AS ((_raw_data ->> 'unit_amount'::text)::integer) STORED,
    billing_scheme      text                     GENERATED ALWAYS AS (_raw_data ->> 'billing_scheme'::text) STORED,
    created             integer                  GENERATED ALWAYS AS ((_raw_data ->> 'created'::text)::integer) STORED,
    livemode            boolean                  GENERATED ALWAYS AS ((_raw_data ->> 'livemode'::text)::boolean) STORED,
    lookup_key          text                     GENERATED ALWAYS AS (_raw_data ->> 'lookup_key'::text) STORED,
    tiers_mode          text                     GENERATED ALWAYS AS (_raw_data ->> 'tiers_mode'::text) STORED,
    transform_quantity  jsonb                    GENERATED ALWAYS AS (_raw_data -> 'transform_quantity'::text) STORED,
    unit_amount_decimal text                     GENERATED ALWAYS AS (_raw_data ->> 'unit_amount_decimal'::text) STORED,
    product             text                     GENERATED ALWAYS AS (_raw_data ->> 'product'::text) STORED,
    id                  text                     GENERATED ALWAYS AS (_raw_data ->> 'id'::text) STORED,
    CONSTRAINT prices_pkey PRIMARY KEY (id),
    CONSTRAINT fk_prices_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id)
);
DROP TRIGGER IF EXISTS handle_updated_at ON stripe.prices;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.prices
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---- stripe.payment_intents -----------------------------------------------
CREATE TABLE IF NOT EXISTS stripe.payment_intents (
    _last_synced_at             timestamp with time zone,
    _raw_data                   jsonb,
    _account_id                 text                     NOT NULL,
    object                      text                     GENERATED ALWAYS AS (_raw_data ->> 'object'::text) STORED,
    amount                      integer                  GENERATED ALWAYS AS ((_raw_data ->> 'amount'::text)::integer) STORED,
    amount_capturable           integer                  GENERATED ALWAYS AS ((_raw_data ->> 'amount_capturable'::text)::integer) STORED,
    amount_details              jsonb                    GENERATED ALWAYS AS (_raw_data -> 'amount_details'::text) STORED,
    amount_received             integer                  GENERATED ALWAYS AS ((_raw_data ->> 'amount_received'::text)::integer) STORED,
    application                 text                     GENERATED ALWAYS AS (_raw_data ->> 'application'::text) STORED,
    application_fee_amount      integer                  GENERATED ALWAYS AS ((_raw_data ->> 'application_fee_amount'::text)::integer) STORED,
    automatic_payment_methods   text                     GENERATED ALWAYS AS (_raw_data ->> 'automatic_payment_methods'::text) STORED,
    canceled_at                 integer                  GENERATED ALWAYS AS ((_raw_data ->> 'canceled_at'::text)::integer) STORED,
    cancellation_reason         text                     GENERATED ALWAYS AS (_raw_data ->> 'cancellation_reason'::text) STORED,
    capture_method              text                     GENERATED ALWAYS AS (_raw_data ->> 'capture_method'::text) STORED,
    client_secret               text                     GENERATED ALWAYS AS (_raw_data ->> 'client_secret'::text) STORED,
    confirmation_method         text                     GENERATED ALWAYS AS (_raw_data ->> 'confirmation_method'::text) STORED,
    created                     integer                  GENERATED ALWAYS AS ((_raw_data ->> 'created'::text)::integer) STORED,
    currency                    text                     GENERATED ALWAYS AS (_raw_data ->> 'currency'::text) STORED,
    customer                    text                     GENERATED ALWAYS AS (_raw_data ->> 'customer'::text) STORED,
    description                 text                     GENERATED ALWAYS AS (_raw_data ->> 'description'::text) STORED,
    invoice                     text                     GENERATED ALWAYS AS (_raw_data ->> 'invoice'::text) STORED,
    last_payment_error          text                     GENERATED ALWAYS AS (_raw_data ->> 'last_payment_error'::text) STORED,
    livemode                    boolean                  GENERATED ALWAYS AS ((_raw_data ->> 'livemode'::text)::boolean) STORED,
    metadata                    jsonb                    GENERATED ALWAYS AS (_raw_data -> 'metadata'::text) STORED,
    next_action                 text                     GENERATED ALWAYS AS (_raw_data ->> 'next_action'::text) STORED,
    on_behalf_of                text                     GENERATED ALWAYS AS (_raw_data ->> 'on_behalf_of'::text) STORED,
    payment_method              text                     GENERATED ALWAYS AS (_raw_data ->> 'payment_method'::text) STORED,
    payment_method_options      jsonb                    GENERATED ALWAYS AS (_raw_data -> 'payment_method_options'::text) STORED,
    payment_method_types        jsonb                    GENERATED ALWAYS AS (_raw_data -> 'payment_method_types'::text) STORED,
    processing                  text                     GENERATED ALWAYS AS (_raw_data ->> 'processing'::text) STORED,
    receipt_email               text                     GENERATED ALWAYS AS (_raw_data ->> 'receipt_email'::text) STORED,
    review                      text                     GENERATED ALWAYS AS (_raw_data ->> 'review'::text) STORED,
    setup_future_usage          text                     GENERATED ALWAYS AS (_raw_data ->> 'setup_future_usage'::text) STORED,
    shipping                    jsonb                    GENERATED ALWAYS AS (_raw_data -> 'shipping'::text) STORED,
    statement_descriptor        text                     GENERATED ALWAYS AS (_raw_data ->> 'statement_descriptor'::text) STORED,
    statement_descriptor_suffix text                     GENERATED ALWAYS AS (_raw_data ->> 'statement_descriptor_suffix'::text) STORED,
    status                      text                     GENERATED ALWAYS AS (_raw_data ->> 'status'::text) STORED,
    transfer_data               jsonb                    GENERATED ALWAYS AS (_raw_data -> 'transfer_data'::text) STORED,
    transfer_group              text                     GENERATED ALWAYS AS (_raw_data ->> 'transfer_group'::text) STORED,
    id                          text                     GENERATED ALWAYS AS (_raw_data ->> 'id'::text) STORED,
    CONSTRAINT payment_intents_pkey PRIMARY KEY (id),
    CONSTRAINT fk_payment_intents_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id)
);
CREATE INDEX IF NOT EXISTS stripe_payment_intents_customer_idx ON stripe.payment_intents USING btree (customer);
CREATE INDEX IF NOT EXISTS stripe_payment_intents_invoice_idx  ON stripe.payment_intents USING btree (invoice);

-- ---- seed one row in stripe.accounts ---------------------------------------
-- Required by tests/security/{anonymous,tenant}-checkout-isolation.test.ts
-- which SELECT id FROM stripe.accounts ORDER BY id LIMIT 1 to get an FK
-- target for inserting test products + prices. The test guards with:
--   if (!acctId) throw new Error("test setup: no rows in stripe.accounts...")
INSERT INTO stripe.accounts (_raw_data)
VALUES ('{"id":"acct_ci_bootstrap","object":"account","email":"ci-bootstrap@visionclaw.test","type":"standard","country":"US","default_currency":"usd","charges_enabled":true,"payouts_enabled":true,"details_submitted":true,"created":1700000000,"business_profile":{"name":"CI Bootstrap Account"}}'::jsonb)
ON CONFLICT (id) DO NOTHING;
