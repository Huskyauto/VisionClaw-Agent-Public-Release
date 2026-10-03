CREATE TABLE public.agent_capital (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    balance_usd_cents integer DEFAULT 0 NOT NULL,
    total_earned_usd_cents integer DEFAULT 0 NOT NULL,
    total_spent_usd_cents integer DEFAULT 0 NOT NULL,
    seeded_at timestamp without time zone,
    seeded_by text,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.agent_capital_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.agent_capital_id_seq OWNED BY public.agent_capital.id;
CREATE TABLE public.mission_evidence (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    mission_id integer NOT NULL,
    experiment_id integer,
    type text NOT NULL,
    summary text NOT NULL,
    source text NOT NULL,
    external_ref text,
    amount_usd_cents integer,
    contact_email text,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.mission_evidence_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.mission_evidence_id_seq OWNED BY public.mission_evidence.id;
CREATE TABLE public.mission_experiments (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    mission_id integer NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    prospects jsonb DEFAULT '[]'::jsonb NOT NULL,
    variants jsonb DEFAULT '[]'::jsonb NOT NULL,
    max_prospects integer DEFAULT 25 NOT NULL,
    max_contacts_per_prospect integer DEFAULT 3 NOT NULL,
    max_spend_usd_cents integer DEFAULT 2500 NOT NULL,
    approved_by_owner_at timestamp without time zone,
    approved_by text,
    sequence_id integer,
    enrolled_count integer DEFAULT 0 NOT NULL,
    reply_token text,
    result_summary text,
    dry_run boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE SEQUENCE public.mission_experiments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.mission_experiments_id_seq OWNED BY public.mission_experiments.id;
CREATE TABLE public.revenue_missions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    hypothesis text NOT NULL,
    ideal_customer text NOT NULL,
    pain_statement text,
    offer text NOT NULL,
    price_usd integer DEFAULT 0 NOT NULL,
    acquisition_channel text DEFAULT 'email'::text NOT NULL,
    stage text DEFAULT 'hypothesis'::text NOT NULL,
    max_cash_at_risk_usd integer DEFAULT 25 NOT NULL,
    max_prospects integer DEFAULT 25 NOT NULL,
    max_contacts_per_prospect integer DEFAULT 3 NOT NULL,
    success_criteria text,
    kill_criteria text,
    leads_contacted integer DEFAULT 0 NOT NULL,
    positive_replies integer DEFAULT 0 NOT NULL,
    negative_replies integer DEFAULT 0 NOT NULL,
    calls_booked integer DEFAULT 0 NOT NULL,
    payments_received integer DEFAULT 0 NOT NULL,
    revenue_usd_cents integer DEFAULT 0 NOT NULL,
    refunds_usd_cents integer DEFAULT 0 NOT NULL,
    spend_usd_cents integer DEFAULT 0 NOT NULL,
    project_id integer,
    notes text,
    killed_reason text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    autonomy_level integer DEFAULT 0 NOT NULL,
    retrospective jsonb,
    retrospective_at timestamp without time zone,
    validation jsonb,
    validation_score integer,
    validation_at timestamp without time zone,
    capital_settled_at timestamp without time zone
);
CREATE SEQUENCE public.revenue_missions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.revenue_missions_id_seq OWNED BY public.revenue_missions.id;
ALTER TABLE ONLY public.agent_capital ALTER COLUMN id SET DEFAULT nextval('public.agent_capital_id_seq'::regclass);
ALTER TABLE ONLY public.mission_evidence ALTER COLUMN id SET DEFAULT nextval('public.mission_evidence_id_seq'::regclass);
ALTER TABLE ONLY public.mission_experiments ALTER COLUMN id SET DEFAULT nextval('public.mission_experiments_id_seq'::regclass);
ALTER TABLE ONLY public.revenue_missions ALTER COLUMN id SET DEFAULT nextval('public.revenue_missions_id_seq'::regclass);
ALTER TABLE ONLY public.agent_capital
    ADD CONSTRAINT agent_capital_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.agent_capital
    ADD CONSTRAINT agent_capital_tenant_unique UNIQUE (tenant_id);
ALTER TABLE ONLY public.mission_evidence
    ADD CONSTRAINT mission_evidence_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mission_experiments
    ADD CONSTRAINT mission_experiments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.revenue_missions
    ADD CONSTRAINT revenue_missions_pkey PRIMARY KEY (id);
CREATE INDEX idx_agent_capital_tenant ON public.agent_capital USING btree (tenant_id);
CREATE INDEX idx_mission_evidence_mission ON public.mission_evidence USING btree (mission_id);
CREATE INDEX idx_mission_evidence_tenant ON public.mission_evidence USING btree (tenant_id);
CREATE INDEX idx_mission_experiments_mission ON public.mission_experiments USING btree (mission_id);
CREATE INDEX idx_mission_experiments_tenant ON public.mission_experiments USING btree (tenant_id);
CREATE INDEX idx_revenue_missions_tenant ON public.revenue_missions USING btree (tenant_id);
CREATE INDEX idx_revenue_missions_tenant_stage ON public.revenue_missions USING btree (tenant_id, stage);
CREATE UNIQUE INDEX uq_mission_evidence_tenant_source_ref ON public.mission_evidence USING btree (tenant_id, source, external_ref) WHERE (external_ref IS NOT NULL);
ALTER TABLE ONLY public.mission_evidence
    ADD CONSTRAINT mission_evidence_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES public.revenue_missions(id);
ALTER TABLE ONLY public.mission_experiments
    ADD CONSTRAINT mission_experiments_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES public.revenue_missions(id);
-- (generated via pg_dump --schema-only from the dev DB, 2026-08-06; applied by
-- tests/integration/mission-golden-path.test.ts ONLY when revenue_missions is
-- absent — i.e. a fresh CI database, where db:push has already created every
-- shared/schema.ts table (agent_wake_schedules, outreach_*, agent_cost_ledger)
-- but NOT these ops-managed mission tables. No psql meta-commands: this file
-- is executed through the node-postgres driver. The dev/prod deployment path
-- for these tables remains server/seed.ts + ops DDL.)
