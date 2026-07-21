--
-- PostgreSQL database dump
--

\restrict iMqBm4Ug7pOKI22l8MHM27Pj0Qt0lsguteMmcJVS1MI2T3ObZFVdepqovvVEZI3

-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: stripe; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA stripe;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: invoice_status; Type: TYPE; Schema: stripe; Owner: -
--

CREATE TYPE stripe.invoice_status AS ENUM (
    'draft',
    'open',
    'paid',
    'uncollectible',
    'void',
    'deleted'
);


--
-- Name: pricing_tiers; Type: TYPE; Schema: stripe; Owner: -
--

CREATE TYPE stripe.pricing_tiers AS ENUM (
    'graduated',
    'volume'
);


--
-- Name: pricing_type; Type: TYPE; Schema: stripe; Owner: -
--

CREATE TYPE stripe.pricing_type AS ENUM (
    'one_time',
    'recurring'
);


--
-- Name: subscription_schedule_status; Type: TYPE; Schema: stripe; Owner: -
--

CREATE TYPE stripe.subscription_schedule_status AS ENUM (
    'not_started',
    'active',
    'completed',
    'released',
    'canceled'
);


--
-- Name: subscription_status; Type: TYPE; Schema: stripe; Owner: -
--

CREATE TYPE stripe.subscription_status AS ENUM (
    'trialing',
    'active',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'past_due',
    'unpaid',
    'paused'
);


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new._updated_at = now();
  return NEW;
end;
$$;


--
-- Name: set_updated_at_metadata(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at_metadata() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return NEW;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ab_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_runs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    prompt text NOT NULL,
    rubric text NOT NULL,
    configs jsonb NOT NULL,
    runs_per_config integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    results jsonb DEFAULT '[]'::jsonb,
    ranking jsonb DEFAULT '[]'::jsonb,
    error_message text,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: ab_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ab_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ab_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ab_runs_id_seq OWNED BY public.ab_runs.id;


--
-- Name: action_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_attempts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    operation_id text NOT NULL,
    plan_id integer,
    run_id integer,
    conversation_id integer,
    tool_name text NOT NULL,
    arguments_hash text NOT NULL,
    idempotency_key text NOT NULL,
    risk text NOT NULL,
    state text DEFAULT 'prepared'::text NOT NULL,
    provider_receipt jsonb,
    error text,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    settled_at timestamp without time zone,
    committed_at timestamp without time zone
);


--
-- Name: action_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.action_attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: action_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.action_attempts_id_seq OWNED BY public.action_attempts.id;


--
-- Name: action_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_outcomes (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer NOT NULL,
    action_type text NOT NULL,
    action_ref text,
    action_description text NOT NULL,
    action_timestamp timestamp without time zone DEFAULT now() NOT NULL,
    expected_outcome text,
    expected_metric text,
    expected_value real,
    actual_outcome text,
    actual_value real,
    outcome_status text DEFAULT 'pending'::text,
    measured_at timestamp without time zone,
    feedback_summary text,
    feedback_applied boolean DEFAULT false,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: action_outcomes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.action_outcomes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: action_outcomes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.action_outcomes_id_seq OWNED BY public.action_outcomes.id;


--
-- Name: action_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_snapshots (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    action_id text NOT NULL,
    tool_name text NOT NULL,
    snapshot_kind text NOT NULL,
    payload jsonb NOT NULL,
    args_redacted jsonb,
    persona_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    undone_at timestamp without time zone
);


--
-- Name: action_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.action_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: action_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.action_snapshots_id_seq OWNED BY public.action_snapshots.id;


--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    actor_type character varying(30) DEFAULT 'agent'::character varying NOT NULL,
    actor_name character varying(100) DEFAULT 'System'::character varying NOT NULL,
    action character varying(100) NOT NULL,
    resource_type character varying(50),
    resource_id character varying(100),
    description text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_log_id_seq OWNED BY public.activity_log.id;


--
-- Name: agent_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_activity (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    persona_name text DEFAULT 'VisionClaw'::text NOT NULL,
    status text DEFAULT 'idle'::text NOT NULL,
    activity_type text DEFAULT 'chat'::text NOT NULL,
    summary text,
    conversation_id integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_activity_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_activity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_activity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_activity_id_seq OWNED BY public.agent_activity.id;


--
-- Name: agent_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_approvals (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer,
    requested_by text,
    question text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    decision jsonb,
    decided_by text,
    requested_at timestamp without time zone DEFAULT now() NOT NULL,
    decided_at timestamp without time zone,
    expires_at timestamp without time zone
);


--
-- Name: agent_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_approvals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_approvals_id_seq OWNED BY public.agent_approvals.id;


--
-- Name: agent_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_channels (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    description text,
    type text DEFAULT 'topic'::text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: agent_channels_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_channels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_channels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_channels_id_seq OWNED BY public.agent_channels.id;


--
-- Name: agent_cost_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_cost_ledger (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    tool_name text NOT NULL,
    model text,
    cost_usd numeric(10,6) DEFAULT 0 NOT NULL,
    tokens_in integer DEFAULT 0,
    tokens_out integer DEFAULT 0,
    operation text,
    run_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    persona_id integer,
    department text,
    cached_tokens_in integer DEFAULT 0,
    cache_write_tokens integer DEFAULT 0
);


--
-- Name: agent_cost_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_cost_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_cost_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_cost_ledger_id_seq OWNED BY public.agent_cost_ledger.id;


--
-- Name: agent_desks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_desks (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer NOT NULL,
    active_tasks jsonb DEFAULT '[]'::jsonb,
    blocked_items jsonb DEFAULT '[]'::jsonb,
    waiting_for jsonb DEFAULT '[]'::jsonb,
    queue jsonb DEFAULT '[]'::jsonb,
    recent_completions jsonb DEFAULT '[]'::jsonb,
    focus_area text,
    status_note text,
    last_active_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: agent_desks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_desks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_desks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_desks_id_seq OWNED BY public.agent_desks.id;


--
-- Name: agent_evals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_evals (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer NOT NULL,
    persona_name text NOT NULL,
    task_name text NOT NULL,
    task_prompt text NOT NULL,
    judge_type text DEFAULT 'llm'::text NOT NULL,
    judge_criteria text,
    status text DEFAULT 'pending'::text NOT NULL,
    passed boolean,
    score real,
    cost_usd real,
    duration_ms integer,
    result_summary text,
    error text,
    run_number integer DEFAULT 1 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone
);


--
-- Name: agent_evals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_evals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_evals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_evals_id_seq OWNED BY public.agent_evals.id;


--
-- Name: agent_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_jobs (
    id integer NOT NULL,
    kind text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    tenant_id integer,
    persona_id integer,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    lease_until timestamp with time zone,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_job_id integer,
    result jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    failure_class text,
    rollback_note text,
    CONSTRAINT agent_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'failed_terminal'::text, 'cancelled'::text])))
);


--
-- Name: agent_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_jobs_id_seq OWNED BY public.agent_jobs.id;


--
-- Name: agent_knowledge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_knowledge (
    id integer NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    category text DEFAULT 'insight'::text NOT NULL,
    priority integer DEFAULT 3 NOT NULL,
    persona_id integer,
    source text DEFAULT 'user'::text NOT NULL,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    embedding jsonb,
    tenant_id integer,
    embedding_vec public.vector(1536),
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(content, ''::text)))) STORED
);


--
-- Name: agent_knowledge_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_knowledge_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_knowledge_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_knowledge_id_seq OWNED BY public.agent_knowledge.id;


--
-- Name: agent_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_runs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_type text NOT NULL,
    goal text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    result jsonb,
    error text,
    parent_run_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp without time zone
);


--
-- Name: agent_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_runs_id_seq OWNED BY public.agent_runs.id;


--
-- Name: agent_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_settings (
    id integer NOT NULL,
    agent_name text DEFAULT 'VisionClaw'::text NOT NULL,
    personality text DEFAULT 'You are VisionClaw, a helpful personal AI assistant.'::text NOT NULL,
    default_model text DEFAULT 'gpt-5-mini'::text NOT NULL,
    thinking_enabled boolean DEFAULT false NOT NULL,
    discord_bot_token text,
    access_pin text,
    whatsapp_approval_phone text,
    telegram_bot_token text,
    bwb_current_weight integer,
    bwb_total_lost integer,
    bwb_start_weight integer,
    bwb_weight_updated_at timestamp without time zone,
    gmail_direct_token text
);


--
-- Name: agent_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_settings_id_seq OWNED BY public.agent_settings.id;


--
-- Name: agent_trace_spans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_trace_spans (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    trace_id text NOT NULL,
    span_id text NOT NULL,
    parent_span_id text,
    kind text NOT NULL,
    agent_name text,
    tool_name text,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    ended_at timestamp without time zone,
    status text,
    summary text,
    metadata jsonb
);


--
-- Name: agent_trace_spans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_trace_spans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_trace_spans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_trace_spans_id_seq OWNED BY public.agent_trace_spans.id;


--
-- Name: agent_wake_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_wake_schedules (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    conversation_id integer,
    project_id integer,
    kind text DEFAULT 'follow_up'::text NOT NULL,
    goal text NOT NULL,
    context jsonb,
    wake_at timestamp without time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 1 NOT NULL,
    result jsonb,
    created_by text DEFAULT 'agent'::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: agent_wake_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agent_wake_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agent_wake_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agent_wake_schedules_id_seq OWNED BY public.agent_wake_schedules.id;


--
-- Name: ai_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_insights (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    engine_type text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    details text,
    priority text DEFAULT 'medium'::text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    data_snapshot text,
    action_taken text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_insights_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_insights_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_insights_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_insights_id_seq OWNED BY public.ai_insights.id;


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name character varying(255) NOT NULL,
    key_hash character varying(255) NOT NULL,
    key_prefix character varying(12) NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone,
    is_revoked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_keys_id_seq OWNED BY public.api_keys.id;


--
-- Name: architecture_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.architecture_decisions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    title text NOT NULL,
    status character varying(30) DEFAULT 'proposed'::character varying NOT NULL,
    context text DEFAULT ''::text NOT NULL,
    decision text DEFAULT ''::text NOT NULL,
    consequences text DEFAULT ''::text NOT NULL,
    supersedes integer,
    superseded_by integer,
    supersede_reason text,
    tags text[] DEFAULT ARRAY[]::text[],
    author_persona_id integer,
    evidence jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone
);


--
-- Name: architecture_decisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.architecture_decisions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: architecture_decisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.architecture_decisions_id_seq OWNED BY public.architecture_decisions.id;


--
-- Name: archive_rescue_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.archive_rescue_orders (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    org_name text NOT NULL,
    org_type text DEFAULT 'other'::text NOT NULL,
    contact_email text NOT NULL,
    contact_name text,
    tier text DEFAULT 'demo'::text NOT NULL,
    status text DEFAULT 'demo_requested'::text NOT NULL,
    pages_quota integer DEFAULT 0 NOT NULL,
    pages_used integer DEFAULT 0 NOT NULL,
    stripe_session_id text,
    stripe_payment_intent text,
    demo_ocr_summary text,
    demo_image_paths text[],
    notes text,
    ip_hash text,
    user_agent text,
    notified_at timestamp without time zone,
    delivered_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: archive_rescue_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.archive_rescue_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: archive_rescue_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.archive_rescue_orders_id_seq OWNED BY public.archive_rescue_orders.id;


--
-- Name: audit_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_leads (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    email text,
    kind text NOT NULL,
    tier_interest text,
    icp_hint text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    referer text,
    ip_hash text,
    user_agent text,
    notes text,
    notified_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_leads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_leads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_leads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_leads_id_seq OWNED BY public.audit_leads.id;


--
-- Name: audit_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_reports (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    website_url text NOT NULL,
    final_url text,
    overall_score integer NOT NULL,
    grade text NOT NULL,
    checks jsonb DEFAULT '[]'::jsonb NOT NULL,
    recommendations jsonb DEFAULT '[]'::jsonb NOT NULL,
    email text,
    ip_hash text,
    user_agent text,
    status text DEFAULT 'completed'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_reports_id_seq OWNED BY public.audit_reports.id;


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    token text NOT NULL,
    tenant_id integer NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL
);


--
-- Name: autonomous_budget_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.autonomous_budget_claims (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    label text,
    estimated_usd numeric NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: autonomous_budget_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.autonomous_budget_claims_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: autonomous_budget_claims_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.autonomous_budget_claims_id_seq OWNED BY public.autonomous_budget_claims.id;


--
-- Name: autonomy_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.autonomy_log (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer NOT NULL,
    action_type text NOT NULL,
    decision text NOT NULL,
    rule_id integer,
    confidence_score real,
    context jsonb,
    escalated_to text,
    resolved_at timestamp without time zone,
    resolved_by text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: autonomy_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.autonomy_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: autonomy_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.autonomy_log_id_seq OWNED BY public.autonomy_log.id;


--
-- Name: autonomy_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.autonomy_rules (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    action_type text NOT NULL,
    autonomy_level text DEFAULT 'approve_before'::text NOT NULL,
    conditions jsonb,
    max_value real,
    requires_confidence_score real,
    escalate_to text,
    description text,
    enabled boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: autonomy_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.autonomy_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: autonomy_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.autonomy_rules_id_seq OWNED BY public.autonomy_rules.id;


--
-- Name: briefing_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.briefing_reports (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    content text NOT NULL,
    generated_by text DEFAULT 'ai'::text,
    model text,
    duration_ms integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: briefing_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.briefing_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: briefing_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.briefing_reports_id_seq OWNED BY public.briefing_reports.id;


--
-- Name: briefing_widgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.briefing_widgets (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    widget_type text DEFAULT 'custom'::text NOT NULL,
    label text NOT NULL,
    prompt text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    last_value text,
    last_updated_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: briefing_widgets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.briefing_widgets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: briefing_widgets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.briefing_widgets_id_seq OWNED BY public.briefing_widgets.id;


--
-- Name: browser_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.browser_workflows (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    recorded_actions jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    last_replayed timestamp without time zone
);


--
-- Name: browser_workflows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.browser_workflows_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: browser_workflows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.browser_workflows_id_seq OWNED BY public.browser_workflows.id;


--
-- Name: calendar_feeds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_feeds (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    feed_name text NOT NULL,
    feed_url text NOT NULL,
    feed_type text DEFAULT 'ics'::text,
    last_synced timestamp without time zone,
    cached_events jsonb DEFAULT '[]'::jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: calendar_feeds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.calendar_feeds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: calendar_feeds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.calendar_feeds_id_seq OWNED BY public.calendar_feeds.id;


--
-- Name: capabilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capabilities (
    id integer NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    category text,
    description text NOT NULL,
    code_path text,
    code_symbol text,
    metadata jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: capabilities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.capabilities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: capabilities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.capabilities_id_seq OWNED BY public.capabilities.id;


--
-- Name: capability_gaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capability_gaps (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    gap_description text NOT NULL,
    trigger_context text,
    source text DEFAULT 'auto'::text NOT NULL,
    status text DEFAULT 'detected'::text NOT NULL,
    research_results jsonb DEFAULT '[]'::jsonb,
    resolution text,
    resolved_tool text,
    resolved_skill text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    resolved_at timestamp without time zone,
    priority text DEFAULT 'medium'::text NOT NULL,
    miss_count integer DEFAULT 1 NOT NULL,
    last_seen_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: capability_gaps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.capability_gaps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: capability_gaps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.capability_gaps_id_seq OWNED BY public.capability_gaps.id;


--
-- Name: capability_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capability_reviews (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    conversation_id integer,
    task_summary text,
    assets_surfaced integer DEFAULT 0 NOT NULL,
    rebuild_risks integer DEFAULT 0 NOT NULL,
    reuse_eligible boolean DEFAULT false NOT NULL,
    surfaced_names text[],
    reused boolean DEFAULT false NOT NULL,
    reused_capability text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: capability_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.capability_reviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: capability_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.capability_reviews_id_seq OWNED BY public.capability_reviews.id;


--
-- Name: causal_chains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.causal_chains (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    cause_subject text NOT NULL,
    cause_predicate text,
    cause_object text DEFAULT ''::text NOT NULL,
    effect_subject text NOT NULL,
    effect_predicate text,
    effect_object text DEFAULT ''::text NOT NULL,
    confidence real DEFAULT 0.5 NOT NULL,
    time_lag_seconds integer,
    evidence_text text DEFAULT ''::text NOT NULL,
    source_kind text DEFAULT 'llm-extracted'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    chain_hash text
);


--
-- Name: causal_chains_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.causal_chains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: causal_chains_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.causal_chains_id_seq OWNED BY public.causal_chains.id;


--
-- Name: channel_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_messages (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    channel_id integer NOT NULL,
    from_persona_id integer,
    message_type text DEFAULT 'message'::text,
    content text NOT NULL,
    metadata jsonb,
    thread_id integer,
    read_by jsonb DEFAULT '[]'::jsonb,
    event_ref integer,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: channel_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.channel_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: channel_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.channel_messages_id_seq OWNED BY public.channel_messages.id;


--
-- Name: channel_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_subscriptions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    channel_id integer NOT NULL,
    persona_id integer NOT NULL,
    priority text DEFAULT 'normal'::text,
    filter jsonb,
    enabled boolean DEFAULT true
);


--
-- Name: channel_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.channel_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: channel_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.channel_subscriptions_id_seq OWNED BY public.channel_subscriptions.id;


--
-- Name: character_portrait_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_portrait_registry (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    identifier text NOT NULL,
    view text NOT NULL,
    image_path text NOT NULL,
    description text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: character_portrait_registry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.character_portrait_registry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: character_portrait_registry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.character_portrait_registry_id_seq OWNED BY public.character_portrait_registry.id;


--
-- Name: code_health_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.code_health_findings (
    id integer NOT NULL,
    scan_id text NOT NULL,
    file_path text NOT NULL,
    line_number integer,
    category text NOT NULL,
    severity text DEFAULT 'warning'::text NOT NULL,
    pattern text NOT NULL,
    snippet text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: code_health_findings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.code_health_findings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: code_health_findings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.code_health_findings_id_seq OWNED BY public.code_health_findings.id;


--
-- Name: code_health_scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.code_health_scans (
    id integer NOT NULL,
    scan_id text NOT NULL,
    files_scanned integer DEFAULT 0 NOT NULL,
    total_findings integer DEFAULT 0 NOT NULL,
    critical_count integer DEFAULT 0 NOT NULL,
    warning_count integer DEFAULT 0 NOT NULL,
    info_count integer DEFAULT 0 NOT NULL,
    duration_ms integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: code_health_scans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.code_health_scans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: code_health_scans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.code_health_scans_id_seq OWNED BY public.code_health_scans.id;


--
-- Name: code_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.code_proposals (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    title text NOT NULL,
    description text NOT NULL,
    target_file text NOT NULL,
    code_diff text NOT NULL,
    rationale text NOT NULL,
    source text DEFAULT 'autoresearch'::text NOT NULL,
    source_session_id integer,
    validation_result jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by text,
    reviewed_at timestamp without time zone,
    applied_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    verification_status text DEFAULT 'unverified'::text,
    verification_details text,
    verified_at timestamp without time zone
);


--
-- Name: code_proposals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.code_proposals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: code_proposals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.code_proposals_id_seq OWNED BY public.code_proposals.id;


--
-- Name: commitments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commitments (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona character varying(80),
    description text NOT NULL,
    due_at timestamp with time zone,
    heartbeat_interval_ms bigint DEFAULT 3600000 NOT NULL,
    last_heartbeat_at timestamp with time zone,
    last_note text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    escalated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source character varying(40) DEFAULT 'manual'::character varying NOT NULL,
    dedupe_key text,
    confidence real,
    sensitivity character varying(20) DEFAULT 'routine'::character varying NOT NULL,
    draft_status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    draft_artifact_id integer,
    drafted_at timestamp with time zone,
    lead_time_hours integer DEFAULT 24 NOT NULL
);


--
-- Name: commitments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.commitments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: commitments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.commitments_id_seq OWNED BY public.commitments.id;


--
-- Name: compaction_archives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compaction_archives (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    tenant_id integer,
    archived_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    message_count integer DEFAULT 0 NOT NULL,
    total_messages integer DEFAULT 0 NOT NULL,
    content text NOT NULL,
    summary text
);


--
-- Name: compaction_archives_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compaction_archives_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compaction_archives_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compaction_archives_id_seq OWNED BY public.compaction_archives.id;


--
-- Name: competitor_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitor_changes (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    competitor_id integer NOT NULL,
    snapshot_id integer NOT NULL,
    change_type text NOT NULL,
    summary text NOT NULL,
    details text,
    significance text DEFAULT 'medium'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: competitor_changes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.competitor_changes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: competitor_changes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.competitor_changes_id_seq OWNED BY public.competitor_changes.id;


--
-- Name: competitor_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitor_registry (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    website text NOT NULL,
    pricing_url text,
    product_url text,
    changelog_url text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: competitor_registry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.competitor_registry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: competitor_registry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.competitor_registry_id_seq OWNED BY public.competitor_registry.id;


--
-- Name: competitor_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitor_snapshots (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    competitor_id integer NOT NULL,
    url text NOT NULL,
    content_hash text,
    content_text text,
    metadata text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: competitor_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.competitor_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: competitor_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.competitor_snapshots_id_seq OWNED BY public.competitor_snapshots.id;


--
-- Name: consolidation_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consolidation_log (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    reviewed integer DEFAULT 0,
    merged integer DEFAULT 0,
    archived integer DEFAULT 0,
    promoted integer DEFAULT 0,
    created integer DEFAULT 0,
    errors integer DEFAULT 0,
    summary text,
    duration_ms integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: consolidation_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.consolidation_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: consolidation_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.consolidation_log_id_seq OWNED BY public.consolidation_log.id;


--
-- Name: contact_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_submissions (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    subject text DEFAULT 'general'::text,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: contact_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contact_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_submissions_id_seq OWNED BY public.contact_submissions.id;


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    customer_id integer,
    title character varying(255) NOT NULL,
    contract_type character varying(50),
    status character varying(30) DEFAULT 'draft'::character varying,
    start_date date,
    end_date date,
    value numeric(12,2),
    terms text,
    pdf_url text,
    drive_url text,
    signed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contracts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contracts_id_seq OWNED BY public.contracts.id;


--
-- Name: conversation_facts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_facts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    conversation_id integer NOT NULL,
    persona_id integer,
    fact_text text NOT NULL,
    fact_kind text DEFAULT 'other'::text NOT NULL,
    source_message_id integer,
    source text DEFAULT 'extractor'::text NOT NULL,
    ref_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_referenced_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp without time zone
);


--
-- Name: conversation_facts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_facts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_facts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_facts_id_seq OWNED BY public.conversation_facts.id;


--
-- Name: conversation_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_templates (
    id integer NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    icon text DEFAULT 'MessageSquare'::text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    persona_id integer,
    model text,
    system_prompt_prefix text,
    starter_messages text[],
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: conversation_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_templates_id_seq OWNED BY public.conversation_templates.id;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id integer NOT NULL,
    title text DEFAULT 'New Chat'::text NOT NULL,
    model text DEFAULT 'gpt-5-mini'::text NOT NULL,
    thinking boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    persona_id integer,
    thinking_level text DEFAULT 'off'::text NOT NULL,
    tenant_id integer,
    is_public boolean DEFAULT false NOT NULL,
    public_token text,
    project_id integer,
    deleted_at timestamp without time zone,
    deleted_by text
);


--
-- Name: conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversations_id_seq OWNED BY public.conversations.id;


--
-- Name: council_verdicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.council_verdicts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    procedure_edit_id integer NOT NULL,
    verdict text NOT NULL,
    consensus_count integer DEFAULT 0 NOT NULL,
    reviewer_count integer DEFAULT 0 NOT NULL,
    plain_english_summary text NOT NULL,
    per_model_votes jsonb DEFAULT '[]'::jsonb NOT NULL,
    kappa double precision,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    duration_ms integer,
    final_decision text,
    final_decided_at timestamp with time zone,
    final_decided_by text,
    agreed_with_council boolean,
    CONSTRAINT council_verdicts_final_chk CHECK (((final_decision IS NULL) OR (final_decision = ANY (ARRAY['approved'::text, 'rejected'::text, 'deferred'::text])))),
    CONSTRAINT council_verdicts_verdict_chk CHECK ((verdict = ANY (ARRAY['approve'::text, 'reject'::text, 'needs_revision'::text, 'abstain'::text, 'pending'::text, 'error'::text])))
);


--
-- Name: council_verdicts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.council_verdicts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: council_verdicts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.council_verdicts_id_seq OWNED BY public.council_verdicts.id;


--
-- Name: crew_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_agents (
    id integer NOT NULL,
    crew_id integer NOT NULL,
    tenant_id integer NOT NULL,
    name character varying(255) NOT NULL,
    role character varying(500) NOT NULL,
    goal text NOT NULL,
    backstory text DEFAULT ''::text NOT NULL,
    persona_id integer,
    tools text[] DEFAULT '{}'::text[] NOT NULL,
    allow_delegation boolean DEFAULT false NOT NULL,
    max_iterations integer DEFAULT 25 NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crew_agents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crew_agents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crew_agents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crew_agents_id_seq OWNED BY public.crew_agents.id;


--
-- Name: crew_flows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_flows (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    state jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(50) DEFAULT 'idle'::character varying NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crew_flows_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crew_flows_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crew_flows_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crew_flows_id_seq OWNED BY public.crew_flows.id;


--
-- Name: crew_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_runs (
    id integer NOT NULL,
    crew_id integer NOT NULL,
    tenant_id integer NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    process character varying(50) DEFAULT 'sequential'::character varying NOT NULL,
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    task_outputs jsonb DEFAULT '[]'::jsonb NOT NULL,
    final_output text,
    token_usage jsonb DEFAULT '{}'::jsonb NOT NULL,
    error text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crew_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crew_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crew_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crew_runs_id_seq OWNED BY public.crew_runs.id;


--
-- Name: crew_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_tasks (
    id integer NOT NULL,
    crew_id integer NOT NULL,
    tenant_id integer NOT NULL,
    name character varying(255),
    description text NOT NULL,
    expected_output text NOT NULL,
    agent_id integer,
    context_task_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    async_execution boolean DEFAULT false NOT NULL,
    output_json_schema jsonb,
    tools text[] DEFAULT '{}'::text[] NOT NULL,
    guardrail text,
    sort_order integer DEFAULT 0 NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crew_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crew_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crew_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crew_tasks_id_seq OWNED BY public.crew_tasks.id;


--
-- Name: crews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crews (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    process character varying(50) DEFAULT 'sequential'::character varying NOT NULL,
    manager_persona_id integer,
    memory_enabled boolean DEFAULT false NOT NULL,
    cache_enabled boolean DEFAULT true NOT NULL,
    is_verbose boolean DEFAULT false NOT NULL,
    max_rpm integer DEFAULT 60,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(50) DEFAULT 'idle'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.crews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: crews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.crews_id_seq OWNED BY public.crews.id;


--
-- Name: custom_tools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_tools (
    id integer NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    parameters jsonb DEFAULT '[]'::jsonb NOT NULL,
    implementation text NOT NULL,
    created_by text DEFAULT 'agent'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    usage_count integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id integer
);


--
-- Name: custom_tools_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.custom_tools_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: custom_tools_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.custom_tools_id_seq OWNED BY public.custom_tools.id;


--
-- Name: customer_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_interactions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    customer_id integer,
    interaction_type character varying(50) NOT NULL,
    subject character varying(255),
    notes text,
    outcome character varying(100),
    follow_up_date date,
    created_by character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: customer_interactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_interactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_interactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_interactions_id_seq OWNED BY public.customer_interactions.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    company_name character varying(255),
    contact_name character varying(255),
    email character varying(255),
    phone character varying(50),
    address text,
    city character varying(100),
    state character varying(50),
    zip character varying(20),
    country character varying(50) DEFAULT 'US'::character varying,
    industry character varying(100),
    status character varying(30) DEFAULT 'active'::character varying,
    notes text,
    total_revenue numeric(12,2) DEFAULT 0,
    deal_stage character varying(50) DEFAULT 'prospect'::character varying,
    deal_value numeric(12,2),
    assigned_to character varying(100),
    last_contact_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: daily_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_notes (
    id integer NOT NULL,
    date text NOT NULL,
    content text NOT NULL,
    persona_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id integer
);


--
-- Name: daily_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_notes_id_seq OWNED BY public.daily_notes.id;


--
-- Name: decline_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decline_events (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    conversation_id integer,
    source text NOT NULL,
    reason text NOT NULL,
    detail text,
    tool_name text,
    flagged_categories text[],
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: decline_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.decline_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: decline_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.decline_events_id_seq OWNED BY public.decline_events.id;


--
-- Name: delegation_scratchpad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delegation_scratchpad (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    chain_key text NOT NULL,
    agent_name text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: delegation_scratchpad_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delegation_scratchpad_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delegation_scratchpad_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delegation_scratchpad_id_seq OWNED BY public.delegation_scratchpad.id;


--
-- Name: deliverable_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliverable_contracts (
    id integer NOT NULL,
    deliverable_type text NOT NULL,
    required_extensions text[] DEFAULT ARRAY[]::text[],
    required_mime_pattern text,
    min_size_bytes integer,
    max_size_bytes integer,
    schema_jsonschema jsonb,
    render_check text DEFAULT 'none'::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deliverable_contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deliverable_contracts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deliverable_contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deliverable_contracts_id_seq OWNED BY public.deliverable_contracts.id;


--
-- Name: delivery_engagement; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_engagement (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    delivery_id integer,
    event_type text DEFAULT 'fetch'::text NOT NULL,
    file_name text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: delivery_engagement_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_engagement_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_engagement_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_engagement_id_seq OWNED BY public.delivery_engagement.id;


--
-- Name: delivery_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_logs (
    id integer NOT NULL,
    order_id text,
    customer_name text NOT NULL,
    customer_email text,
    product_name text NOT NULL,
    file_name text NOT NULL,
    drive_file_id text,
    drive_folder_id text,
    folder_link text,
    download_link text,
    shareable_link text,
    email_sent boolean DEFAULT false,
    email_message_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text,
    stripe_payment_id text,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp without time zone,
    tenant_id integer NOT NULL
);


--
-- Name: delivery_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_logs_id_seq OWNED BY public.delivery_logs.id;


--
-- Name: delivery_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_verifications (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    conversation_id integer,
    deliverable_type text NOT NULL,
    file_path text,
    file_url text,
    contract_id integer,
    status text NOT NULL,
    failures jsonb DEFAULT '[]'::jsonb NOT NULL,
    detected_extension text,
    detected_mime text,
    detected_size integer,
    verified_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: delivery_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.delivery_verifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: delivery_verifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.delivery_verifications_id_seq OWNED BY public.delivery_verifications.id;


--
-- Name: department_budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.department_budgets (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    department text NOT NULL,
    period text DEFAULT 'monthly'::text NOT NULL,
    limit_usd text DEFAULT '0'::text NOT NULL,
    period_start timestamp without time zone NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: department_budgets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.department_budgets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: department_budgets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.department_budgets_id_seq OWNED BY public.department_budgets.id;


--
-- Name: doc_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doc_chunks (
    id integer NOT NULL,
    collection_id integer NOT NULL,
    doc_path text NOT NULL,
    doc_title text NOT NULL,
    chunk_index integer DEFAULT 0 NOT NULL,
    content text NOT NULL,
    context text DEFAULT ''::text,
    embedding jsonb,
    token_count integer DEFAULT 0,
    tenant_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: doc_chunks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.doc_chunks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: doc_chunks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.doc_chunks_id_seq OWNED BY public.doc_chunks.id;


--
-- Name: doc_collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doc_collections (
    id integer NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    tenant_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: doc_collections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.doc_collections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: doc_collections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.doc_collections_id_seq OWNED BY public.doc_collections.id;


--
-- Name: doc_heading_trees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doc_heading_trees (
    id integer NOT NULL,
    collection_id integer NOT NULL,
    doc_path text NOT NULL,
    doc_title text NOT NULL,
    tree jsonb NOT NULL,
    total_headings integer DEFAULT 0 NOT NULL,
    total_lines integer DEFAULT 0 NOT NULL,
    tenant_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: doc_heading_trees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.doc_heading_trees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: doc_heading_trees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.doc_heading_trees_id_seq OWNED BY public.doc_heading_trees.id;


--
-- Name: email_verification_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verification_codes (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    email text NOT NULL,
    code text NOT NULL,
    expires_at bigint NOT NULL,
    created_at bigint DEFAULT (EXTRACT(epoch FROM now()) * (1000)::numeric)
);


--
-- Name: email_verification_codes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_verification_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_verification_codes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_verification_codes_id_seq OWNED BY public.email_verification_codes.id;


--
-- Name: eval_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.eval_runs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    answer_model text NOT NULL,
    judge_model text NOT NULL,
    total_cases integer NOT NULL,
    evaluated_cases integer NOT NULL,
    coverage real NOT NULL,
    suite_score real NOT NULL,
    baseline_score real,
    degraded boolean DEFAULT false NOT NULL,
    regressed boolean DEFAULT false NOT NULL,
    regression_drop real DEFAULT 0 NOT NULL,
    below_min_cases text[] DEFAULT '{}'::text[] NOT NULL,
    record jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: eval_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.eval_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: eval_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.eval_runs_id_seq OWNED BY public.eval_runs.id;


--
-- Name: evaluator_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evaluator_snapshots (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    evaluator_name text NOT NULL,
    metrics jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: evaluator_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.evaluator_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: evaluator_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.evaluator_snapshots_id_seq OWNED BY public.evaluator_snapshots.id;


--
-- Name: event_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_log (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    event_type text NOT NULL,
    source text NOT NULL,
    data jsonb,
    status text DEFAULT 'pending'::text,
    processing_result jsonb,
    processed_by integer,
    processed_at timestamp without time zone,
    error text,
    created_at timestamp without time zone DEFAULT now(),
    salience_score numeric,
    salience_meta jsonb
);


--
-- Name: event_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_log_id_seq OWNED BY public.event_log.id;


--
-- Name: event_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_subscriptions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    event_type text NOT NULL,
    persona_id integer NOT NULL,
    action text DEFAULT 'process'::text,
    priority integer DEFAULT 5,
    action_config jsonb,
    enabled boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: event_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_subscriptions_id_seq OWNED BY public.event_subscriptions.id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    category character varying(100) NOT NULL,
    vendor character varying(255),
    description text,
    amount numeric(12,2) NOT NULL,
    payment_method character varying(50),
    receipt_url text,
    is_deductible boolean DEFAULT true,
    tax_category character varying(100),
    project_id integer,
    approved_by character varying(100),
    status character varying(30) DEFAULT 'recorded'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.expenses_id_seq OWNED BY public.expenses.id;


--
-- Name: experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiments (
    id integer NOT NULL,
    hypothesis text NOT NULL,
    approach text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    metric text,
    baseline_value text,
    result_value text,
    status text DEFAULT 'running'::text NOT NULL,
    outcome text,
    persona_id integer,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id integer
);


--
-- Name: experiments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.experiments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: experiments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.experiments_id_seq OWNED BY public.experiments.id;


--
-- Name: express_lane_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.express_lane_usage (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    lane_id text NOT NULL,
    from_persona_id integer NOT NULL,
    to_persona_id integer NOT NULL,
    work_type text NOT NULL,
    success boolean,
    description text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: express_lane_usage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.express_lane_usage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: express_lane_usage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.express_lane_usage_id_seq OWNED BY public.express_lane_usage.id;


--
-- Name: failure_attributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.failure_attributions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    scope text NOT NULL,
    scope_ref text NOT NULL,
    level text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: failure_attributions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.failure_attributions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: failure_attributions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.failure_attributions_id_seq OWNED BY public.failure_attributions.id;


--
-- Name: felix_loop_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.felix_loop_runs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    mode text DEFAULT 'dry_run'::text NOT NULL,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    ended_at timestamp without time zone,
    context_summary text DEFAULT ''::text,
    intent_summary text DEFAULT ''::text,
    proposals_drafted integer DEFAULT 0 NOT NULL,
    tokens_used integer DEFAULT 0,
    cost_cents integer DEFAULT 0 NOT NULL,
    error text
);


--
-- Name: felix_loop_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.felix_loop_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: felix_loop_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.felix_loop_runs_id_seq OWNED BY public.felix_loop_runs.id;


--
-- Name: felix_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.felix_proposals (
    id integer NOT NULL,
    loop_run_id integer,
    tenant_id integer NOT NULL,
    kind text NOT NULL,
    summary text NOT NULL,
    rationale text DEFAULT ''::text NOT NULL,
    target text,
    target_args jsonb DEFAULT '{}'::jsonb,
    estimated_cost_cents integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by text,
    reviewed_at timestamp without time zone,
    rejection_reason text,
    executed_at timestamp without time zone,
    execution_result text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    expected_post_state jsonb,
    args_embedding public.vector(1536),
    actual_outcome_embedding public.vector(1536),
    surprise_score real,
    surprise_band text
);


--
-- Name: felix_proposals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.felix_proposals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: felix_proposals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.felix_proposals_id_seq OWNED BY public.felix_proposals.id;


--
-- Name: file_storage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_storage (
    id integer NOT NULL,
    filename text NOT NULL,
    original_name text NOT NULL,
    mime_type text NOT NULL,
    size integer NOT NULL,
    data text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id integer NOT NULL,
    storage_key text,
    drive_url text,
    is_public boolean DEFAULT false NOT NULL
);


--
-- Name: file_storage_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.file_storage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: file_storage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.file_storage_id_seq OWNED BY public.file_storage.id;


--
-- Name: financial_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_models (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer NOT NULL,
    idea_id integer NOT NULL,
    pricing_options jsonb DEFAULT '[]'::jsonb NOT NULL,
    startup_cost_usd real,
    monthly_opex_usd real,
    revenue_scenarios jsonb DEFAULT '[]'::jsonb NOT NULL,
    break_even_note text,
    cash_plan_90d text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: financial_models_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.financial_models_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: financial_models_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.financial_models_id_seq OWNED BY public.financial_models.id;


--
-- Name: flow_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flow_steps (
    id integer NOT NULL,
    flow_id integer NOT NULL,
    tenant_id integer NOT NULL,
    name character varying(255) NOT NULL,
    step_type character varying(50) DEFAULT 'start'::character varying NOT NULL,
    listen_to text[] DEFAULT '{}'::text[] NOT NULL,
    router_outputs text[] DEFAULT '{}'::text[] NOT NULL,
    crew_id integer,
    action_type character varying(50) DEFAULT 'crew_kickoff'::character varying NOT NULL,
    action_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: flow_steps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.flow_steps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: flow_steps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.flow_steps_id_seq OWNED BY public.flow_steps.id;


--
-- Name: governance_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.governance_actions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    rule_id integer,
    rule_name text NOT NULL,
    category text NOT NULL,
    condition_met text NOT NULL,
    action_taken text NOT NULL,
    action_detail jsonb,
    escalated boolean DEFAULT false NOT NULL,
    escalation_status text DEFAULT 'none'::text,
    resolved_by text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: governance_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.governance_actions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: governance_actions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.governance_actions_id_seq OWNED BY public.governance_actions.id;


--
-- Name: governance_frameworks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.governance_frameworks (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    organization text NOT NULL,
    version text NOT NULL,
    source_url text,
    category text NOT NULL,
    description text NOT NULL,
    key_principles jsonb DEFAULT '[]'::jsonb NOT NULL,
    rules_informed jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_reviewed timestamp with time zone DEFAULT now() NOT NULL,
    next_review_date timestamp with time zone,
    review_notes text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: governance_frameworks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.governance_frameworks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: governance_frameworks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.governance_frameworks_id_seq OWNED BY public.governance_frameworks.id;


--
-- Name: governance_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.governance_rules (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    category text NOT NULL,
    rule_name text NOT NULL,
    description text NOT NULL,
    condition jsonb NOT NULL,
    action text NOT NULL,
    action_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    escalate_to_human boolean DEFAULT false NOT NULL,
    escalation_reason text,
    priority integer DEFAULT 5 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_triggered_at timestamp with time zone,
    trigger_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: governance_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.governance_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: governance_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.governance_rules_id_seq OWNED BY public.governance_rules.id;


--
-- Name: graph_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.graph_memory (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    path text NOT NULL,
    content text NOT NULL,
    trigger_condition text,
    version integer DEFAULT 1,
    parent_path text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    importance real DEFAULT 0 NOT NULL,
    community_id integer
);


--
-- Name: graph_memory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.graph_memory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: graph_memory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.graph_memory_id_seq OWNED BY public.graph_memory.id;


--
-- Name: graph_memory_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.graph_memory_links (
    id integer NOT NULL,
    source_path text NOT NULL,
    target_path text NOT NULL,
    tenant_id integer NOT NULL,
    link_type text DEFAULT 'reference'::text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: graph_memory_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.graph_memory_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: graph_memory_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.graph_memory_links_id_seq OWNED BY public.graph_memory_links.id;


--
-- Name: heartbeat_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heartbeat_logs (
    id integer NOT NULL,
    task_id integer,
    task_name text NOT NULL,
    status text DEFAULT 'success'::text NOT NULL,
    input text,
    output text,
    model text,
    duration_ms integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    persona_id integer,
    persona_name text,
    delegated_tasks text,
    source text
);


--
-- Name: heartbeat_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.heartbeat_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: heartbeat_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.heartbeat_logs_id_seq OWNED BY public.heartbeat_logs.id;


--
-- Name: heartbeat_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.heartbeat_tasks (
    id integer NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    type text DEFAULT 'routine'::text NOT NULL,
    cron_expression text DEFAULT '*/30 * * * *'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    prompt_content text NOT NULL,
    model text DEFAULT 'gpt-5-nano'::text NOT NULL,
    last_run_at timestamp without time zone,
    next_run_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    persona_id integer,
    created_by text DEFAULT 'user'::text NOT NULL,
    parent_task_id integer,
    run_once boolean DEFAULT false NOT NULL,
    tenant_id integer,
    approval_status text DEFAULT 'approved'::text NOT NULL
);


--
-- Name: heartbeat_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.heartbeat_tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: heartbeat_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.heartbeat_tasks_id_seq OWNED BY public.heartbeat_tasks.id;


--
-- Name: hypothesis_evidence_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hypothesis_evidence_edges (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    hypothesis_id integer NOT NULL,
    evidence_kind text NOT NULL,
    evidence_ref text NOT NULL,
    confidence real DEFAULT 0.6 NOT NULL,
    note text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: hypothesis_evidence_edges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hypothesis_evidence_edges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hypothesis_evidence_edges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hypothesis_evidence_edges_id_seq OWNED BY public.hypothesis_evidence_edges.id;


--
-- Name: inbox_classifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_classifications (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    inbox_message_id integer NOT NULL,
    message_id_external character varying(255) NOT NULL,
    kind text NOT NULL,
    confidence real DEFAULT 0 NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    routed_to jsonb DEFAULT '{}'::jsonb NOT NULL,
    classifier_model text DEFAULT ''::text NOT NULL,
    classified_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inbox_classifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbox_classifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inbox_classifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbox_classifications_id_seq OWNED BY public.inbox_classifications.id;


--
-- Name: inbox_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_messages (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    message_id character varying(255) NOT NULL,
    inbox_id character varying(255) NOT NULL,
    from_address text DEFAULT ''::text NOT NULL,
    to_address text DEFAULT ''::text NOT NULL,
    subject text DEFAULT '(No Subject)'::text NOT NULL,
    body_text text,
    body_html text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    is_starred boolean DEFAULT false NOT NULL,
    thread_id character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    direction character varying(10) DEFAULT 'inbound'::character varying NOT NULL,
    quarantined boolean DEFAULT false NOT NULL
);


--
-- Name: inbox_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbox_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inbox_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbox_messages_id_seq OWNED BY public.inbox_messages.id;


--
-- Name: inbox_sender_allowlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_sender_allowlist (
    tenant_id integer NOT NULL,
    address text NOT NULL,
    status character varying(20) DEFAULT 'approved'::character varying NOT NULL,
    added_by character varying(80),
    notes text,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone
);


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_items (
    id integer NOT NULL,
    invoice_id integer,
    description text NOT NULL,
    quantity numeric(10,2) DEFAULT 1,
    unit_price numeric(12,2) NOT NULL,
    amount numeric(12,2) NOT NULL,
    sort_order integer DEFAULT 0
);


--
-- Name: invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoice_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoice_items_id_seq OWNED BY public.invoice_items.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    invoice_number character varying(50) NOT NULL,
    customer_id integer,
    customer_name character varying(255),
    customer_email character varying(255),
    issue_date date DEFAULT CURRENT_DATE NOT NULL,
    status character varying(30) DEFAULT 'draft'::character varying,
    subtotal numeric(12,2) DEFAULT 0,
    tax_rate numeric(5,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    total numeric(12,2) DEFAULT 0,
    amount_paid numeric(12,2) DEFAULT 0,
    payment_terms character varying(100),
    notes text,
    pdf_url text,
    drive_url text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    due_date date
);


--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: jury_drain_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jury_drain_ledger (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    entry_key text NOT NULL,
    issue_slug text,
    outcome text,
    drained_at timestamp with time zone DEFAULT now()
);


--
-- Name: jury_drain_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jury_drain_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jury_drain_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jury_drain_ledger_id_seq OWNED BY public.jury_drain_ledger.id;


--
-- Name: jury_experiences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jury_experiences (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    request_class text NOT NULL,
    question text NOT NULL,
    question_embedding public.vector(1536),
    lesson text NOT NULL,
    winning_summary text,
    losing_summary text,
    concordance real,
    proposer_count integer,
    status text DEFAULT 'shadow'::text NOT NULL,
    confidence real DEFAULT 0.5 NOT NULL,
    source_response_id integer,
    hit_count integer DEFAULT 0 NOT NULL,
    validated_at timestamp without time zone,
    valid_until timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: jury_experiences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jury_experiences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jury_experiences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jury_experiences_id_seq OWNED BY public.jury_experiences.id;


--
-- Name: key_value_store; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.key_value_store (
    key text NOT NULL,
    value text DEFAULT ''::text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_communities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_communities (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    label text DEFAULT ''::text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    key_entities text[] DEFAULT ARRAY[]::text[],
    member_paths text[] DEFAULT ARRAY[]::text[],
    member_triple_ids integer[] DEFAULT ARRAY[]::integer[],
    size integer DEFAULT 0 NOT NULL,
    importance_avg real DEFAULT 0 NOT NULL,
    source text DEFAULT 'louvain'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_communities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_communities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_communities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_communities_id_seq OWNED BY public.knowledge_communities.id;


--
-- Name: knowledge_diversity_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_diversity_snapshots (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    sample_size integer NOT NULL,
    mean_pairwise_cosine real NOT NULL,
    sigreg_pvalue real NOT NULL,
    sigreg_axes_failed integer DEFAULT 0 NOT NULL,
    alert_emitted boolean DEFAULT false NOT NULL,
    snapshot_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_diversity_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_diversity_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_diversity_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_diversity_snapshots_id_seq OWNED BY public.knowledge_diversity_snapshots.id;


--
-- Name: knowledge_nudges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_nudges (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    fact text NOT NULL,
    category text DEFAULT 'nudge'::text NOT NULL,
    source text DEFAULT 'proactive'::text NOT NULL,
    score real DEFAULT 0 NOT NULL,
    conversation_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_nudges_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_nudges_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_nudges_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_nudges_id_seq OWNED BY public.knowledge_nudges.id;


--
-- Name: knowledge_triples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_triples (
    id integer NOT NULL,
    subject text NOT NULL,
    predicate text NOT NULL,
    object text NOT NULL,
    confidence real DEFAULT 1.0 NOT NULL,
    source text DEFAULT 'agent'::text NOT NULL,
    valid_from timestamp without time zone DEFAULT now(),
    valid_until timestamp without time zone,
    wing text,
    room text,
    tenant_id integer NOT NULL,
    persona_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb
);


--
-- Name: knowledge_triples_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.knowledge_triples_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: knowledge_triples_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.knowledge_triples_id_seq OWNED BY public.knowledge_triples.id;


--
-- Name: kpi_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_metrics (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    metric_name character varying(100) NOT NULL,
    category character varying(50) NOT NULL,
    value numeric(14,2) NOT NULL,
    target numeric(14,2),
    unit character varying(30) DEFAULT 'count'::character varying,
    period character varying(20) DEFAULT 'monthly'::character varying,
    period_start date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: kpi_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kpi_metrics_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kpi_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kpi_metrics_id_seq OWNED BY public.kpi_metrics.id;


--
-- Name: lead_enrichments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_enrichments (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    lead_name text NOT NULL,
    lead_email text,
    company_name text,
    company_url text,
    company_description text,
    industry text,
    company_size text,
    role text,
    enrichment_data text,
    icp_score integer,
    icp_grade text,
    qualification_status text DEFAULT 'unscored'::text NOT NULL,
    stage text DEFAULT 'new'::text NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: lead_enrichments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_enrichments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_enrichments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_enrichments_id_seq OWNED BY public.lead_enrichments.id;


--
-- Name: lead_scoring_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_scoring_rules (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    icp_description text NOT NULL,
    criteria text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: lead_scoring_rules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lead_scoring_rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lead_scoring_rules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lead_scoring_rules_id_seq OWNED BY public.lead_scoring_rules.id;


--
-- Name: legal_risk_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_risk_reviews (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer NOT NULL,
    idea_id integer NOT NULL,
    compliance_risk text,
    privacy_risk text,
    ip_risk text,
    disclaimers jsonb DEFAULT '[]'::jsonb NOT NULL,
    regulated_concerns text,
    go_no_go text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: legal_risk_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.legal_risk_reviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: legal_risk_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.legal_risk_reviews_id_seq OWNED BY public.legal_risk_reviews.id;


--
-- Name: marketing_calendar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_calendar (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    platform text DEFAULT 'x'::text NOT NULL,
    content text NOT NULL,
    scheduled_date timestamp without time zone NOT NULL,
    style text,
    campaign text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: marketing_calendar_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_calendar_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_calendar_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_calendar_id_seq OWNED BY public.marketing_calendar.id;


--
-- Name: marketing_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_results (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    platform text DEFAULT 'x'::text NOT NULL,
    content text,
    campaign text,
    views integer DEFAULT 0,
    likes integer DEFAULT 0,
    replies integer DEFAULT 0,
    reposts integer DEFAULT 0,
    clicks integer DEFAULT 0,
    bookmarks integer DEFAULT 0,
    score numeric DEFAULT 0,
    posted_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: marketing_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marketing_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marketing_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marketing_results_id_seq OWNED BY public.marketing_results.id;


--
-- Name: mcp_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_api_keys (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_by text
);


--
-- Name: mcp_api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mcp_api_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mcp_api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mcp_api_keys_id_seq OWNED BY public.mcp_api_keys.id;


--
-- Name: mcp_servers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mcp_servers (
    id integer NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    server_url text NOT NULL,
    auth_type text DEFAULT 'none'::text,
    auth_token text,
    enabled boolean DEFAULT true,
    tool_count integer DEFAULT 0,
    last_connected timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: mcp_servers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mcp_servers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mcp_servers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mcp_servers_id_seq OWNED BY public.mcp_servers.id;


--
-- Name: memory_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_categories (
    id integer NOT NULL,
    name text NOT NULL,
    parent_id integer,
    description text,
    tenant_id integer,
    persona_id integer,
    memory_count integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    half_life_days integer DEFAULT 30 NOT NULL
);


--
-- Name: memory_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.memory_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: memory_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.memory_categories_id_seq OWNED BY public.memory_categories.id;


--
-- Name: memory_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_entries (
    id integer NOT NULL,
    fact text NOT NULL,
    category text DEFAULT 'preference'::text NOT NULL,
    source text DEFAULT 'conversation'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    persona_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_accessed timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    access_count integer DEFAULT 0 NOT NULL,
    expires_at timestamp without time zone,
    embedding jsonb,
    tenant_id integer,
    deleted_at timestamp without time zone,
    category_id integer,
    wing text,
    room text,
    embedding_vec public.vector(1536),
    confidence real DEFAULT 1.0 NOT NULL,
    confidence_source text,
    succeeded_by_id integer,
    valid_until timestamp without time zone,
    kin_group_id text,
    provenance_triple jsonb,
    last_reinforced_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    quality_score real DEFAULT 1.0 NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(fact, ''::text))) STORED
);


--
-- Name: memory_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.memory_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: memory_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.memory_entries_id_seq OWNED BY public.memory_entries.id;


--
-- Name: memory_geometry_audits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_geometry_audits (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    scope text NOT NULL,
    scope_value text,
    n integer NOT NULL,
    d_bar real NOT NULL,
    d_eff real NOT NULL,
    theta_prime real NOT NULL,
    regime text NOT NULL,
    spread_pairs integer DEFAULT 0 NOT NULL,
    total_pairs integer DEFAULT 0 NOT NULL,
    notes text,
    computed_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: memory_geometry_audits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.memory_geometry_audits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: memory_geometry_audits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.memory_geometry_audits_id_seq OWNED BY public.memory_geometry_audits.id;


--
-- Name: memory_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_links (
    id integer NOT NULL,
    source_memory_id integer NOT NULL,
    target_memory_id integer NOT NULL,
    link_type text DEFAULT 'related'::text NOT NULL,
    strength real DEFAULT 0.5 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    confidence real DEFAULT 0.5 NOT NULL,
    source_count integer DEFAULT 1 NOT NULL,
    CONSTRAINT memory_links_link_type_check CHECK ((link_type = ANY (ARRAY['uses'::text, 'depends_on'::text, 'contradicts'::text, 'caused'::text, 'fixed'::text, 'supersedes'::text, 'related'::text])))
);


--
-- Name: memory_links_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.memory_links_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: memory_links_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.memory_links_id_seq OWNED BY public.memory_links.id;


--
-- Name: message_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_feedback (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    conversation_id integer NOT NULL,
    message_id integer NOT NULL,
    user_id integer,
    rating integer NOT NULL,
    comment text,
    topic_hint text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT check_message_feedback_comment_len CHECK (((comment IS NULL) OR (char_length(comment) <= 2000))),
    CONSTRAINT check_message_feedback_rating CHECK ((rating = ANY (ARRAY['-1'::integer, 1]))),
    CONSTRAINT message_feedback_rating_check CHECK ((rating = ANY (ARRAY['-1'::integer, 1])))
);


--
-- Name: message_feedback_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_feedback_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_feedback_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_feedback_id_seq OWNED BY public.message_feedback.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    conversation_id integer NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id integer NOT NULL,
    citations jsonb
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: mind_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mind_events (
    id integer NOT NULL,
    mind_id integer NOT NULL,
    tenant_id integer NOT NULL,
    event_type character varying(100) NOT NULL,
    source character varying(200) DEFAULT 'user'::character varying NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    handled boolean DEFAULT false NOT NULL,
    handled_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: mind_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mind_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mind_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mind_events_id_seq OWNED BY public.mind_events.id;


--
-- Name: mind_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mind_tickets (
    id integer NOT NULL,
    mind_id integer NOT NULL,
    tenant_id integer NOT NULL,
    title character varying(500) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    acceptance_criteria text DEFAULT ''::text NOT NULL,
    priority integer DEFAULT 2 NOT NULL,
    ticket_type character varying(50) DEFAULT 'task'::character varying NOT NULL,
    status character varying(30) DEFAULT 'ready'::character varying NOT NULL,
    assigned_agent_id character varying(200),
    depends_on integer[],
    result jsonb,
    verdict jsonb,
    next_steps text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: mind_tickets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mind_tickets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mind_tickets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mind_tickets_id_seq OWNED BY public.mind_tickets.id;


--
-- Name: minds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.minds (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name character varying(200) NOT NULL,
    purpose text DEFAULT ''::text NOT NULL,
    soul text DEFAULT ''::text NOT NULL,
    status character varying(30) DEFAULT 'active'::character varying NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    talking_persona_id integer,
    thinking_persona_id integer,
    max_concurrent_workers integer DEFAULT 5 NOT NULL,
    memory jsonb DEFAULT '{}'::jsonb NOT NULL,
    work_log jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: minds_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.minds_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: minds_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.minds_id_seq OWNED BY public.minds.id;


--
-- Name: moa_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moa_responses (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    question text NOT NULL,
    aggregator_model text NOT NULL,
    aggregated_answer text NOT NULL,
    proposer_count integer NOT NULL,
    proposer_success_count integer NOT NULL,
    proposer_details_json text,
    total_latency_ms integer NOT NULL,
    invoked_via text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    concordance real,
    should_escalate boolean DEFAULT false
);


--
-- Name: moa_responses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.moa_responses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: moa_responses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.moa_responses_id_seq OWNED BY public.moa_responses.id;


--
-- Name: model_context_lengths; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_context_lengths (
    id integer NOT NULL,
    model_id text NOT NULL,
    base_url text DEFAULT ''::text NOT NULL,
    context_length integer NOT NULL,
    source text DEFAULT 'learned'::text NOT NULL,
    learned_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: model_context_lengths_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.model_context_lengths_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: model_context_lengths_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.model_context_lengths_id_seq OWNED BY public.model_context_lengths.id;


--
-- Name: model_harness_deltas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_harness_deltas (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    model_id text NOT NULL,
    weakness text NOT NULL,
    addendum text NOT NULL,
    status text DEFAULT 'shadow'::text NOT NULL,
    held_out_prevention real,
    baseline_rate real,
    jury_verdict text,
    jury_majority integer,
    evidence_count integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone
);


--
-- Name: model_harness_deltas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.model_harness_deltas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: model_harness_deltas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.model_harness_deltas_id_seq OWNED BY public.model_harness_deltas.id;


--
-- Name: model_registry_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_registry_updates (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    update_type text NOT NULL,
    model_id text NOT NULL,
    model_data jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    applied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: model_registry_updates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.model_registry_updates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: model_registry_updates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.model_registry_updates_id_seq OWNED BY public.model_registry_updates.id;


--
-- Name: mvp_briefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mvp_briefs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer NOT NULL,
    idea_id integer NOT NULL,
    scope text,
    integrations jsonb DEFAULT '[]'::jsonb NOT NULL,
    components jsonb DEFAULT '[]'::jsonb NOT NULL,
    difficulty text,
    fastest_path text,
    risks jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: mvp_briefs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mvp_briefs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mvp_briefs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mvp_briefs_id_seq OWNED BY public.mvp_briefs.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    type character varying(50) DEFAULT 'info'::character varying NOT NULL,
    title text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    category character varying(50) DEFAULT 'system'::character varying NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    action_url text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: oauth_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_subscriptions (
    id integer NOT NULL,
    provider text NOT NULL,
    tenant_id integer NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    expires_at bigint NOT NULL,
    account_id text,
    email text,
    scope text,
    token_type text DEFAULT 'Bearer'::text,
    pkce_state text,
    pkce_verifier text,
    connected_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_refreshed timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true NOT NULL,
    consecutive_failures integer DEFAULT 0 NOT NULL
);


--
-- Name: oauth_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.oauth_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: oauth_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.oauth_subscriptions_id_seq OWNED BY public.oauth_subscriptions.id;


--
-- Name: orchestration_efficiency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orchestration_efficiency (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    request_class text NOT NULL,
    label text,
    predicted_duration_ms integer,
    predicted_cost_usd double precision,
    actual_duration_ms integer,
    actual_cost_usd double precision,
    heavy_loop_used boolean DEFAULT false NOT NULL,
    guard_verdict text,
    triviality double precision,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    process_quality double precision,
    completion_rate double precision,
    failure_rate double precision,
    redundancy_rate double precision,
    steps integer
);


--
-- Name: orchestration_efficiency_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orchestration_efficiency_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orchestration_efficiency_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orchestration_efficiency_id_seq OWNED BY public.orchestration_efficiency.id;


--
-- Name: order_lookup_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_lookup_codes (
    email text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: outcome_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outcome_patterns (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    action_type text NOT NULL,
    pattern text NOT NULL,
    evidence jsonb,
    confidence_score real,
    recommendation text,
    sample_size integer,
    discovered_at timestamp without time zone DEFAULT now(),
    last_validated timestamp without time zone
);


--
-- Name: outcome_patterns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outcome_patterns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outcome_patterns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outcome_patterns_id_seq OWNED BY public.outcome_patterns.id;


--
-- Name: outreach_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_enrollments (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    sequence_id integer NOT NULL,
    contact_name text NOT NULL,
    contact_email text NOT NULL,
    company_name text,
    current_step integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_sent_at timestamp without time zone,
    next_send_at timestamp without time zone,
    reply_classification text,
    reply_content text,
    personal_context text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: outreach_enrollments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outreach_enrollments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outreach_enrollments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outreach_enrollments_id_seq OWNED BY public.outreach_enrollments.id;


--
-- Name: outreach_sequence_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_sequence_steps (
    id integer NOT NULL,
    sequence_id integer NOT NULL,
    step_number integer NOT NULL,
    channel text DEFAULT 'email'::text NOT NULL,
    subject text,
    body_template text NOT NULL,
    wait_days integer DEFAULT 3 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: outreach_sequence_steps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outreach_sequence_steps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outreach_sequence_steps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outreach_sequence_steps_id_seq OWNED BY public.outreach_sequence_steps.id;


--
-- Name: outreach_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_sequences (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: outreach_sequences_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.outreach_sequences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: outreach_sequences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.outreach_sequences_id_seq OWNED BY public.outreach_sequences.id;


--
-- Name: parallel_job_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parallel_job_findings (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    job_id text NOT NULL,
    subtask_id text NOT NULL,
    finding jsonb NOT NULL,
    confidence real DEFAULT 0.7 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    slot_key text,
    claim boolean DEFAULT false NOT NULL
);


--
-- Name: parallel_job_findings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.parallel_job_findings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parallel_job_findings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.parallel_job_findings_id_seq OWNED BY public.parallel_job_findings.id;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    token text NOT NULL,
    tenant_id integer NOT NULL,
    email text NOT NULL,
    expires_at bigint NOT NULL,
    created_at bigint DEFAULT (EXTRACT(epoch FROM now()) * (1000)::numeric)
);


--
-- Name: pending_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_deliveries (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    conversation_id integer NOT NULL,
    delivery_type text DEFAULT 'presentation'::text NOT NULL,
    payload jsonb NOT NULL,
    delivered boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: pending_deliveries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pending_deliveries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pending_deliveries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pending_deliveries_id_seq OWNED BY public.pending_deliveries.id;


--
-- Name: personality_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personality_files (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer NOT NULL,
    file_type text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: personality_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.personality_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: personality_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.personality_files_id_seq OWNED BY public.personality_files.id;


--
-- Name: personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personas (
    id integer NOT NULL,
    name text NOT NULL,
    role text DEFAULT 'Personal Assistant'::text NOT NULL,
    icon text DEFAULT 'Bot'::text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    soul text DEFAULT ''::text NOT NULL,
    identity text DEFAULT ''::text NOT NULL,
    memory_doc text DEFAULT ''::text NOT NULL,
    operating_loop text DEFAULT ''::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    heartbeat_doc text DEFAULT ''::text NOT NULL,
    tools_doc text DEFAULT ''::text NOT NULL,
    agents_doc text DEFAULT ''::text NOT NULL,
    brand_voice_doc text DEFAULT ''::text NOT NULL,
    cost_tier text DEFAULT 'balanced'::text NOT NULL,
    reasoning_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    emoji text DEFAULT '🤖'::text NOT NULL,
    catchphrase text DEFAULT ''::text NOT NULL,
    safety_profile jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: personas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.personas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: personas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.personas_id_seq OWNED BY public.personas.id;


--
-- Name: pinned_hypotheses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pinned_hypotheses (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    conversation_id integer,
    persona_id integer,
    hypothesis text NOT NULL,
    confidence real DEFAULT 0.7 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone
);


--
-- Name: pinned_hypotheses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pinned_hypotheses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pinned_hypotheses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pinned_hypotheses_id_seq OWNED BY public.pinned_hypotheses.id;


--
-- Name: pipeline_stage_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_stage_artifacts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    job_key text NOT NULL,
    stage text NOT NULL,
    unit_key text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    artifact jsonb DEFAULT '{}'::jsonb NOT NULL,
    artifact_path text,
    error text,
    attempts integer DEFAULT 1 NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: pipeline_stage_artifacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pipeline_stage_artifacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pipeline_stage_artifacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pipeline_stage_artifacts_id_seq OWNED BY public.pipeline_stage_artifacts.id;


--
-- Name: plan_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_nodes (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    plan_id text NOT NULL,
    node_id text NOT NULL,
    label text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    depends_on jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    max_steps integer
);


--
-- Name: plan_nodes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plan_nodes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plan_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plan_nodes_id_seq OWNED BY public.plan_nodes.id;


--
-- Name: plan_replay_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_replay_cache (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    request_class text NOT NULL,
    objective text NOT NULL,
    objective_embedding public.vector(1536),
    plan_json jsonb NOT NULL,
    step_count integer NOT NULL,
    total_duration_ms integer,
    hit_count integer DEFAULT 0 NOT NULL,
    last_hit_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: plan_replay_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plan_replay_cache_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plan_replay_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plan_replay_cache_id_seq OWNED BY public.plan_replay_cache.id;


--
-- Name: plan_rollout_simulations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_rollout_simulations (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    plan_summary text DEFAULT ''::text NOT NULL,
    steps_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    predicted_success real NOT NULL,
    estimated_cost_cents integer DEFAULT 0 NOT NULL,
    weak_links_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    simulated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: plan_rollout_simulations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plan_rollout_simulations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plan_rollout_simulations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plan_rollout_simulations_id_seq OWNED BY public.plan_rollout_simulations.id;


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    objective text NOT NULL,
    source text DEFAULT 'owner.directive'::text NOT NULL,
    source_ref text,
    status text DEFAULT 'awaiting_approval'::text NOT NULL,
    plan_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    planner_persona_id integer,
    ceo_decision text,
    ceo_decision_reason text,
    ceo_decided_at timestamp without time zone,
    ceo_decided_by_persona_id integer,
    execution_log jsonb DEFAULT '[]'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    parent_plan_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT plans_status_check CHECK ((status = ANY (ARRAY['awaiting_approval'::text, 'approved'::text, 'rejected'::text, 'revising'::text, 'executing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plans_id_seq OWNED BY public.plans.id;


--
-- Name: policy_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.policy_audit (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    tool_name text NOT NULL,
    action text,
    decision text NOT NULL,
    matched_policy_id integer,
    reason text DEFAULT ''::text NOT NULL,
    params_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: policy_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.policy_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: policy_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.policy_audit_id_seq OWNED BY public.policy_audit.id;


--
-- Name: presenter_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.presenter_sessions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    presentation_id text NOT NULL,
    title text NOT NULL,
    slides jsonb DEFAULT '[]'::jsonb NOT NULL,
    embed_url text NOT NULL,
    present_url text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    token text DEFAULT ''::text NOT NULL
);


--
-- Name: presenter_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.presenter_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: presenter_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.presenter_sessions_id_seq OWNED BY public.presenter_sessions.id;


--
-- Name: presenter_slide_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.presenter_slide_images (
    id integer NOT NULL,
    session_id integer NOT NULL,
    slide_index integer NOT NULL,
    image_data bytea NOT NULL,
    image_size integer DEFAULT 0 NOT NULL,
    quality text DEFAULT 'full'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: presenter_slide_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.presenter_slide_images_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: presenter_slide_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.presenter_slide_images_id_seq OWNED BY public.presenter_slide_images.id;


--
-- Name: proactive_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proactive_actions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer NOT NULL,
    trigger_condition text NOT NULL,
    action_taken text NOT NULL,
    pab_cost integer DEFAULT 1 NOT NULL,
    outcome text DEFAULT 'pending'::text,
    trust_impact integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: proactive_actions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.proactive_actions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: proactive_actions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.proactive_actions_id_seq OWNED BY public.proactive_actions.id;


--
-- Name: procedure_edits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procedure_edits (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    target_kind text NOT NULL,
    target_id text NOT NULL,
    before_content text NOT NULL,
    after_content text NOT NULL,
    diff_summary text,
    evidence_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    evidence_window_days integer DEFAULT 30 NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    proposed_by_run_id text,
    proposed_at timestamp without time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp without time zone,
    reviewed_by text,
    review_note text,
    applied_at timestamp without time zone,
    rolled_back_at timestamp without time zone,
    content_sha256_before text NOT NULL,
    content_sha256_after text NOT NULL,
    CONSTRAINT procedure_edits_status_chk CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'applied'::text, 'rolled_back'::text])))
);


--
-- Name: procedure_edits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procedure_edits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procedure_edits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procedure_edits_id_seq OWNED BY public.procedure_edits.id;


--
-- Name: procedure_evolution_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.procedure_evolution_runs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    target_kind text NOT NULL,
    target_id text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    finished_at timestamp without time zone,
    evidence_window_days integer DEFAULT 30 NOT NULL,
    iterations integer DEFAULT 1 NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    CONSTRAINT procedure_evolution_runs_status_chk CHECK ((status = ANY (ARRAY['running'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: procedure_evolution_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.procedure_evolution_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: procedure_evolution_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.procedure_evolution_runs_id_seq OWNED BY public.procedure_evolution_runs.id;


--
-- Name: project_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_conversations (
    id integer NOT NULL,
    project_id integer NOT NULL,
    conversation_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    linked_at timestamp without time zone DEFAULT now()
);


--
-- Name: project_conversations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_conversations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_conversations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_conversations_id_seq OWNED BY public.project_conversations.id;


--
-- Name: project_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_files (
    id integer NOT NULL,
    project_id integer NOT NULL,
    file_name text NOT NULL,
    file_path text,
    file_url text,
    file_type text,
    file_size integer,
    uploaded_by text DEFAULT 'system'::text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: project_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_files_id_seq OWNED BY public.project_files.id;


--
-- Name: project_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_notes (
    id integer NOT NULL,
    project_id integer NOT NULL,
    note text NOT NULL,
    author text DEFAULT 'system'::text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: project_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_notes_id_seq OWNED BY public.project_notes.id;


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id integer NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    customer_name text,
    customer_email text,
    tags text[] DEFAULT '{}'::text[],
    metadata jsonb DEFAULT '{}'::jsonb,
    tenant_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    primary_conversation_id integer,
    drive_folder_id text,
    drive_folder_url text,
    current_state text DEFAULT ''::text
);


--
-- Name: projects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.projects_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: projects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.projects_id_seq OWNED BY public.projects.id;


--
-- Name: proposed_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proposed_skills (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    body text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    source_context text,
    proposing_persona text,
    confidence integer DEFAULT 70 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    promoted_skill_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: proposed_skills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.proposed_skills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: proposed_skills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.proposed_skills_id_seq OWNED BY public.proposed_skills.id;


--
-- Name: provider_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provider_keys (
    id integer NOT NULL,
    provider text NOT NULL,
    api_key text NOT NULL,
    base_url text,
    enabled boolean DEFAULT true NOT NULL
);


--
-- Name: provider_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.provider_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: provider_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.provider_keys_id_seq OWNED BY public.provider_keys.id;


--
-- Name: repair_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repair_incidents (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    source text NOT NULL,
    signature text DEFAULT ''::text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    classification text NOT NULL,
    classification_confidence real DEFAULT 0 NOT NULL,
    classification_reason text DEFAULT ''::text NOT NULL,
    classified_by text DEFAULT 'heuristic'::text NOT NULL,
    routed_to text DEFAULT 'surface'::text NOT NULL,
    safety_blocked_autofix boolean DEFAULT false NOT NULL,
    jury_verdict text,
    jury_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    escalated boolean DEFAULT false NOT NULL,
    human_label text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    classified_at timestamp without time zone,
    action_taken text,
    action_outcome text,
    action_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp without time zone,
    dispatched_at timestamp without time zone
);


--
-- Name: repair_incidents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.repair_incidents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: repair_incidents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.repair_incidents_id_seq OWNED BY public.repair_incidents.id;


--
-- Name: repo_surgeon_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repo_surgeon_attempts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    incident_id integer,
    attempt_number integer DEFAULT 1 NOT NULL,
    diagnosis text DEFAULT ''::text NOT NULL,
    root_cause text DEFAULT ''::text NOT NULL,
    touched_files text[] DEFAULT '{}'::text[] NOT NULL,
    outcome text DEFAULT 'rolled_back'::text NOT NULL,
    outcome_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    escalated boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp without time zone
);


--
-- Name: repo_surgeon_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.repo_surgeon_attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: repo_surgeon_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.repo_surgeon_attempts_id_seq OWNED BY public.repo_surgeon_attempts.id;


--
-- Name: research_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_evidence (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    project_id integer,
    query text NOT NULL,
    claim text NOT NULL,
    source_url text,
    source_title text,
    source_date text,
    theme text,
    confidence integer DEFAULT 70 NOT NULL,
    supporting_quote text,
    contradicts text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: research_evidence_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.research_evidence_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: research_evidence_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.research_evidence_id_seq OWNED BY public.research_evidence.id;


--
-- Name: research_experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_experiments (
    id integer NOT NULL,
    session_id integer NOT NULL,
    tenant_id integer NOT NULL,
    program_id integer NOT NULL,
    hypothesis text NOT NULL,
    approach text DEFAULT ''::text NOT NULL,
    result text,
    metric text,
    metric_value text,
    status text DEFAULT 'running'::text NOT NULL,
    parent_experiment_id integer,
    tokens_used integer DEFAULT 0,
    duration_ms integer,
    model text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    numeric_metric_value double precision,
    metric_delta_pct double precision,
    verification_status text DEFAULT 'unverified'::text,
    verification_details text,
    replayed_at timestamp without time zone,
    replayed_proposal_id integer
);


--
-- Name: research_experiments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.research_experiments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: research_experiments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.research_experiments_id_seq OWNED BY public.research_experiments.id;


--
-- Name: research_programs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_programs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    name text NOT NULL,
    objective text NOT NULL,
    constraints text DEFAULT ''::text NOT NULL,
    metrics text DEFAULT ''::text NOT NULL,
    exploration_strategy text DEFAULT 'balanced'::text NOT NULL,
    model text DEFAULT 'deepseek/deepseek-v3.2'::text,
    max_experiments_per_session integer DEFAULT 20,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    baseline_metric_value double precision,
    baseline_label text,
    eval_type text DEFAULT 'judge'::text
);


--
-- Name: research_programs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.research_programs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: research_programs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.research_programs_id_seq OWNED BY public.research_programs.id;


--
-- Name: research_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_schedules (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    program_id integer,
    name text NOT NULL,
    cron_expression text DEFAULT '0 2 * * *'::text NOT NULL,
    timezone text DEFAULT 'America/Chicago'::text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    run_all boolean DEFAULT false NOT NULL,
    last_run_at timestamp without time zone,
    next_run_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: research_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.research_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: research_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.research_schedules_id_seq OWNED BY public.research_schedules.id;


--
-- Name: research_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_sessions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    program_id integer NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    ended_at timestamp without time zone,
    total_experiments integer DEFAULT 0,
    experiments_kept integer DEFAULT 0,
    experiments_discarded integer DEFAULT 0,
    experiments_crashed integer DEFAULT 0,
    total_tokens_used integer DEFAULT 0,
    summary text,
    model text
);


--
-- Name: research_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.research_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: research_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.research_sessions_id_seq OWNED BY public.research_sessions.id;


--
-- Name: sandbox_improvements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sandbox_improvements (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer,
    title text NOT NULL,
    summary text NOT NULL,
    proposal jsonb NOT NULL,
    jury_verdict text,
    jury_votes jsonb,
    status text DEFAULT 'jury_pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone
);


--
-- Name: sandbox_improvements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sandbox_improvements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sandbox_improvements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sandbox_improvements_id_seq OWNED BY public.sandbox_improvements.id;


--
-- Name: sandbox_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sandbox_results (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer NOT NULL,
    item_ref text NOT NULL,
    baseline jsonb NOT NULL,
    simulated jsonb NOT NULL,
    flip text NOT NULL,
    severity text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sandbox_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sandbox_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sandbox_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sandbox_results_id_seq OWNED BY public.sandbox_results.id;


--
-- Name: sandbox_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sandbox_runs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    corpus text NOT NULL,
    status text NOT NULL,
    overrides jsonb NOT NULL,
    sample_size integer NOT NULL,
    report jsonb,
    error text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: sandbox_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sandbox_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sandbox_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sandbox_runs_id_seq OWNED BY public.sandbox_runs.id;


--
-- Name: scheduled_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_posts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    platforms text[] NOT NULL,
    content text NOT NULL,
    image_url text,
    image_base64 text,
    scheduled_for timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    last_error text,
    per_platform_results jsonb DEFAULT '{}'::jsonb NOT NULL,
    campaign text,
    created_by text,
    locked_at timestamp with time zone,
    locked_by text,
    next_attempt_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    video_url text,
    CONSTRAINT scheduled_posts_status_chk CHECK ((status = ANY (ARRAY['pending'::text, 'publishing'::text, 'sent'::text, 'partial'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: scheduled_posts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scheduled_posts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scheduled_posts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scheduled_posts_id_seq OWNED BY public.scheduled_posts.id;


--
-- Name: scraped_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scraped_pages (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    url text NOT NULL,
    domain text NOT NULL,
    title text,
    content text NOT NULL,
    content_length integer DEFAULT 0 NOT NULL,
    crawl_job_id text,
    tags text[],
    metadata jsonb,
    scraped_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scraped_pages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scraped_pages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scraped_pages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scraped_pages_id_seq OWNED BY public.scraped_pages.id;


--
-- Name: sculptor_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sculptor_sessions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    title text NOT NULL,
    task text NOT NULL,
    plan jsonb DEFAULT '[]'::jsonb,
    persona_id integer,
    model text,
    status text DEFAULT 'pending'::text,
    conversation_id integer,
    parent_session_id integer,
    comparison_group text,
    result text,
    review_result jsonb,
    tool_calls_count integer DEFAULT 0,
    tokens_used integer DEFAULT 0,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: sculptor_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sculptor_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sculptor_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sculptor_sessions_id_seq OWNED BY public.sculptor_sessions.id;


--
-- Name: security_intent_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_intent_checks (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    conversation_id integer,
    source text NOT NULL,
    message_hash text NOT NULL,
    literal_intent text,
    flagged_categories text[] DEFAULT '{}'::text[] NOT NULL,
    action text NOT NULL,
    reason text,
    classifier text,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: security_intent_checks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_intent_checks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_intent_checks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_intent_checks_id_seq OWNED BY public.security_intent_checks.id;


--
-- Name: security_scan_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_scan_results (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    scan_type text NOT NULL,
    grade text,
    score integer,
    findings jsonb DEFAULT '[]'::jsonb,
    summary text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: security_scan_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_scan_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_scan_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_scan_results_id_seq OWNED BY public.security_scan_results.id;


--
-- Name: security_tool_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_tool_blocks (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer,
    tool_name text NOT NULL,
    reason text NOT NULL,
    args_redacted jsonb,
    invoked_via text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: security_tool_blocks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_tool_blocks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_tool_blocks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_tool_blocks_id_seq OWNED BY public.security_tool_blocks.id;


--
-- Name: self_heal_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.self_heal_attempts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer,
    trigger_source text NOT NULL,
    original_goal text NOT NULL,
    failure_context jsonb DEFAULT '{}'::jsonb NOT NULL,
    diagnosis text,
    fix_type text,
    fix_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    fix_snippet text,
    reversible boolean DEFAULT true NOT NULL,
    outcome text DEFAULT 'diagnosing'::text NOT NULL,
    outcome_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    promoted_to_platform boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp without time zone
);


--
-- Name: self_heal_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.self_heal_attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: self_heal_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.self_heal_attempts_id_seq OWNED BY public.self_heal_attempts.id;


--
-- Name: self_initiatives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.self_initiatives (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    title text NOT NULL,
    rationale text DEFAULT ''::text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence real DEFAULT 0 NOT NULL,
    risk text DEFAULT 'medium'::text NOT NULL,
    estimated_value text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'surfaced'::text NOT NULL,
    source_model text DEFAULT ''::text NOT NULL,
    signature text DEFAULT ''::text NOT NULL,
    decided_at timestamp without time zone,
    decided_by text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: self_initiatives_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.self_initiatives_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: self_initiatives_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.self_initiatives_id_seq OWNED BY public.self_initiatives.id;


--
-- Name: sentiment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sentiment_events (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    conversation_id integer NOT NULL,
    frustration boolean DEFAULT false,
    urgency boolean DEFAULT false,
    confusion boolean DEFAULT false,
    satisfaction boolean DEFAULT false,
    score integer DEFAULT 0,
    triggers text,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: sentiment_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sentiment_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sentiment_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sentiment_events_id_seq OWNED BY public.sentiment_events.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    sid character varying NOT NULL,
    sess jsonb NOT NULL,
    expire timestamp without time zone NOT NULL
);


--
-- Name: skill_rag_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skill_rag_decisions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    question text NOT NULL,
    invoked boolean DEFAULT false NOT NULL,
    gate_reason text,
    judge_confidence numeric(3,2),
    judge_reason text,
    skill_used text DEFAULT 'none'::text NOT NULL,
    rewritten_query text,
    sub_questions text,
    exited boolean DEFAULT false NOT NULL,
    candidates_in integer DEFAULT 0 NOT NULL,
    candidates_out integer DEFAULT 0 NOT NULL,
    total_ms integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: skill_rag_decisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.skill_rag_decisions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skill_rag_decisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.skill_rag_decisions_id_seq OWNED BY public.skill_rag_decisions.id;


--
-- Name: skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skills (
    id integer NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    icon text DEFAULT 'Zap'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    prompt_content text,
    persona_id integer,
    status text DEFAULT 'active'::text NOT NULL,
    succeeded_by_id integer,
    valid_until timestamp without time zone
);


--
-- Name: skills_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.skills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skills_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.skills_id_seq OWNED BY public.skills.id;


--
-- Name: smart_enrichment_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.smart_enrichment_reports (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    input_email text,
    company_domain text NOT NULL,
    final_url text,
    company_name text,
    industry text,
    estimated_size text,
    icp_fit_score integer DEFAULT 0 NOT NULL,
    routing text DEFAULT 'cold'::text NOT NULL,
    signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    talking_points jsonb DEFAULT '[]'::jsonb NOT NULL,
    decision_makers jsonb DEFAULT '[]'::jsonb NOT NULL,
    summary text,
    ip_hash text,
    user_agent text,
    status text DEFAULT 'completed'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: smart_enrichment_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.smart_enrichment_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: smart_enrichment_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.smart_enrichment_reports_id_seq OWNED BY public.smart_enrichment_reports.id;


--
-- Name: social_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_connections (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    platform text NOT NULL,
    account_name text DEFAULT ''::text NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    token_expires_at bigint,
    scopes text DEFAULT ''::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: social_connections_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.social_connections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: social_connections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.social_connections_id_seq OWNED BY public.social_connections.id;


--
-- Name: social_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_posts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    platform text NOT NULL,
    content text NOT NULL,
    image_url text,
    image_drive_url text,
    status text DEFAULT 'draft'::text NOT NULL,
    scheduled_for timestamp with time zone,
    published_at timestamp with time zone,
    platform_post_id text,
    platform_post_url text,
    engagement_data jsonb DEFAULT '{}'::jsonb,
    campaign text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: social_posts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.social_posts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: social_posts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.social_posts_id_seq OWNED BY public.social_posts.id;


--
-- Name: sprint_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sprint_contracts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    ref_kind text NOT NULL,
    ref_id text NOT NULL,
    done_condition text NOT NULL,
    criteria jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    pinned_at timestamp without time zone DEFAULT now() NOT NULL,
    pinned_by text,
    evaluated_at timestamp without time zone,
    evaluation jsonb,
    content_sha256 text NOT NULL
);


--
-- Name: sprint_contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sprint_contracts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sprint_contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sprint_contracts_id_seq OWNED BY public.sprint_contracts.id;


--
-- Name: step_rewards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.step_rewards (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    plan_id integer,
    run_id integer,
    conversation_id integer,
    step_index integer NOT NULL,
    agent text,
    score integer NOT NULL,
    rationale text,
    signals jsonb,
    model text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: step_rewards_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.step_rewards_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: step_rewards_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.step_rewards_id_seq OWNED BY public.step_rewards.id;


--
-- Name: storefront_checkout_hits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storefront_checkout_hits (
    id bigint NOT NULL,
    rate_key text NOT NULL,
    hit_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: storefront_checkout_hits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storefront_checkout_hits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storefront_checkout_hits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storefront_checkout_hits_id_seq OWNED BY public.storefront_checkout_hits.id;


--
-- Name: synthetic_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.synthetic_customers (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer NOT NULL,
    idea_id integer NOT NULL,
    name text NOT NULL,
    role text,
    industry text,
    business_size text,
    profile jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: synthetic_customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.synthetic_customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: synthetic_customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.synthetic_customers_id_seq OWNED BY public.synthetic_customers.id;


--
-- Name: task_forces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_forces (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    name text NOT NULL,
    mission text NOT NULL,
    persona_ids integer[],
    budget_usd text DEFAULT '0'::text NOT NULL,
    spent_usd text DEFAULT '0'::text NOT NULL,
    project_id integer,
    status text DEFAULT 'active'::text NOT NULL,
    deadline timestamp without time zone,
    result jsonb,
    created_by text DEFAULT 'Felix'::text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    sunset_at timestamp without time zone
);


--
-- Name: task_forces_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_forces_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_forces_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_forces_id_seq OWNED BY public.task_forces.id;


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    email character varying(255) NOT NULL,
    display_name character varying(255),
    role character varying(30) DEFAULT 'viewer'::character varying NOT NULL,
    status character varying(30) DEFAULT 'invited'::character varying NOT NULL,
    invited_by integer,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    joined_at timestamp with time zone
);


--
-- Name: team_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_members_id_seq OWNED BY public.team_members.id;


--
-- Name: tenant_persona_names; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_persona_names (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer NOT NULL,
    display_name text NOT NULL
);


--
-- Name: tenant_persona_names_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_persona_names_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_persona_names_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_persona_names_id_seq OWNED BY public.tenant_persona_names.id;


--
-- Name: tenant_provider_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_provider_keys (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    provider text NOT NULL,
    api_key text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    label text,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    last_error text,
    last_verified_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: tenant_provider_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_provider_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_provider_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_provider_keys_id_seq OWNED BY public.tenant_provider_keys.id;


--
-- Name: tenant_voice_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_voice_profiles (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    profile_name text DEFAULT 'default'::text NOT NULL,
    about_me text DEFAULT ''::text NOT NULL,
    voice text DEFAULT ''::text NOT NULL,
    pillars text[] DEFAULT ARRAY[]::text[] NOT NULL,
    audience text DEFAULT ''::text NOT NULL,
    samples text[] DEFAULT ARRAY[]::text[] NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tenant_voice_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_voice_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_voice_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_voice_profiles_id_seq OWNED BY public.tenant_voice_profiles.id;


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id integer NOT NULL,
    email text NOT NULL,
    password_hash text,
    name text NOT NULL,
    plan text DEFAULT 'trial'::text NOT NULL,
    trial_conversations_used integer DEFAULT 0 NOT NULL,
    trial_max_conversations integer DEFAULT 5 NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    replit_user_id text,
    agentmail_inbox_id text,
    agentmail_email text,
    public_chat_token text,
    public_chat_enabled boolean DEFAULT false NOT NULL,
    vanity_slug text,
    stripe_connect_account_id text,
    stripe_connect_enabled boolean DEFAULT false NOT NULL,
    stripe_payment_mode text DEFAULT 'none'::text NOT NULL,
    stripe_byok_secret_key text,
    stripe_byok_publishable_key text,
    stripe_setup_fee_paid boolean DEFAULT false NOT NULL,
    deletion_scheduled_at timestamp without time zone,
    account_status text,
    email_verified boolean DEFAULT false,
    whatsapp_approval_phone text,
    coinbase_commerce_api_key text,
    coinbase_cdp_api_key_id text,
    coinbase_cdp_api_key_secret text,
    coinbase_commerce_webhook_secret text,
    is_admin boolean DEFAULT false,
    onboarding_seen boolean DEFAULT false,
    drive_folder_id text,
    user_notes_markdown text,
    disabled_skill_names text[],
    profile_photo_path text,
    forked_from integer
);


--
-- Name: tenants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenants_id_seq OWNED BY public.tenants.id;


--
-- Name: tensions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tensions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    title text NOT NULL,
    predicted_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    actual_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    owner_persona_id integer,
    source_kind character varying(50) DEFAULT 'manual'::character varying NOT NULL,
    source_id integer,
    status character varying(30) DEFAULT 'open'::character varying NOT NULL,
    resolution text,
    resolution_evidence jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone
);


--
-- Name: tensions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tensions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tensions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tensions_id_seq OWNED BY public.tensions.id;


--
-- Name: tool_compression_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_compression_stats (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    day date NOT NULL,
    calls integer DEFAULT 0 NOT NULL,
    compressed_calls integer DEFAULT 0 NOT NULL,
    original_chars bigint DEFAULT 0 NOT NULL,
    output_chars bigint DEFAULT 0 NOT NULL,
    baseline_chars bigint DEFAULT 0 NOT NULL,
    tokens_saved_vs_raw bigint DEFAULT 0 NOT NULL,
    tokens_saved_vs_baseline bigint DEFAULT 0 NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: tool_compression_stats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tool_compression_stats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tool_compression_stats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tool_compression_stats_id_seq OWNED BY public.tool_compression_stats.id;


--
-- Name: tool_optimizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_optimizations (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    tool_name text NOT NULL,
    optimization_type text DEFAULT 'description'::text NOT NULL,
    original_hint text,
    optimized_hint text NOT NULL,
    failure_pattern text,
    improvement_score real,
    applied boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tool_optimizations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tool_optimizations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tool_optimizations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tool_optimizations_id_seq OWNED BY public.tool_optimizations.id;


--
-- Name: tool_performance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_performance (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    tool_name text NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    fail_count integer DEFAULT 0 NOT NULL,
    total_duration_ms bigint DEFAULT 0 NOT NULL,
    last_failure_reason text,
    last_success_at timestamp with time zone,
    last_failure_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tool_performance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tool_performance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tool_performance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tool_performance_id_seq OWNED BY public.tool_performance.id;


--
-- Name: tool_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_policies (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    scope_kind text NOT NULL,
    scope_value text NOT NULL,
    action text NOT NULL,
    max_amount_cents integer,
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_by text DEFAULT 'owner'::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tool_policies_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tool_policies_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tool_policies_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tool_policies_id_seq OWNED BY public.tool_policies.id;


--
-- Name: trust_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trust_scores (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    persona_id integer NOT NULL,
    category text NOT NULL,
    score integer DEFAULT 50 NOT NULL,
    autonomy_level text DEFAULT 'approve_before'::text NOT NULL,
    last_change_reason text,
    last_change_amount integer DEFAULT 0,
    consecutive_days_above integer DEFAULT 0,
    locked boolean DEFAULT false NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    action_alpha real DEFAULT 1.0 NOT NULL,
    action_beta real DEFAULT 1.0 NOT NULL,
    restraint_alpha real DEFAULT 1.0 NOT NULL,
    restraint_beta real DEFAULT 1.0 NOT NULL
);


--
-- Name: trust_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trust_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trust_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trust_scores_id_seq OWNED BY public.trust_scores.id;


--
-- Name: usage_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_tracking (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    metric text NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    period text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: usage_tracking_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usage_tracking_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usage_tracking_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usage_tracking_id_seq OWNED BY public.usage_tracking.id;


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    observations jsonb DEFAULT '[]'::jsonb NOT NULL,
    communication_style text,
    decision_patterns text,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    personality_traits jsonb DEFAULT '{}'::jsonb NOT NULL,
    interaction_count integer DEFAULT 0 NOT NULL,
    last_derived_at timestamp with time zone,
    last_consolidated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_profiles_id_seq OWNED BY public.user_profiles.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text DEFAULT gen_random_uuid() NOT NULL,
    username text,
    password text DEFAULT ''::text,
    email character varying,
    first_name character varying,
    last_name character varying,
    profile_image_url character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: validation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.validation_runs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer NOT NULL,
    idea_id integer NOT NULL,
    icp_profile text,
    offer_statement text,
    landing_headline text,
    cold_outreach text,
    survey_questions jsonb DEFAULT '[]'::jsonb NOT NULL,
    discovery_call_script text,
    recommended_channel text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: validation_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.validation_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: validation_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.validation_runs_id_seq OWNED BY public.validation_runs.id;


--
-- Name: venture_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venture_artifacts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer NOT NULL,
    idea_id integer,
    kind text NOT NULL,
    title text,
    content text,
    file_path text,
    delivery_url text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: venture_artifacts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.venture_artifacts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: venture_artifacts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.venture_artifacts_id_seq OWNED BY public.venture_artifacts.id;


--
-- Name: venture_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venture_decisions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer NOT NULL,
    idea_id integer,
    decision text,
    executive_summary text,
    action_plan_7d jsonb DEFAULT '[]'::jsonb NOT NULL,
    assigned_agents jsonb DEFAULT '[]'::jsonb NOT NULL,
    required_deliverables jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: venture_decisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.venture_decisions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: venture_decisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.venture_decisions_id_seq OWNED BY public.venture_decisions.id;


--
-- Name: venture_discovery_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venture_discovery_runs (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    objective text NOT NULL,
    status text DEFAULT 'awaiting_approval'::text NOT NULL,
    current_stage text DEFAULT 'discovery'::text NOT NULL,
    dry_run boolean DEFAULT true NOT NULL,
    completed_stages jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by text,
    last_error text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: venture_discovery_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.venture_discovery_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: venture_discovery_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.venture_discovery_runs_id_seq OWNED BY public.venture_discovery_runs.id;


--
-- Name: venture_ideas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venture_ideas (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer NOT NULL,
    idx integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    target_customer text,
    problem text,
    solution text,
    revenue_model text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: venture_ideas_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.venture_ideas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: venture_ideas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.venture_ideas_id_seq OWNED BY public.venture_ideas.id;


--
-- Name: venture_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venture_scores (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    run_id integer NOT NULL,
    idea_id integer NOT NULL,
    scores jsonb DEFAULT '{}'::jsonb NOT NULL,
    total real DEFAULT 0 NOT NULL,
    rank integer,
    recommendation text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: venture_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.venture_scores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: venture_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.venture_scores_id_seq OWNED BY public.venture_scores.id;


--
-- Name: video_job_frame_pool; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_job_frame_pool (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    job_id text NOT NULL,
    frame_idx integer NOT NULL,
    image_path text NOT NULL,
    description text DEFAULT ''::text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: video_job_frame_pool_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.video_job_frame_pool_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: video_job_frame_pool_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.video_job_frame_pool_id_seq OWNED BY public.video_job_frame_pool.id;


--
-- Name: video_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_jobs (
    job_id character varying(100) NOT NULL,
    tenant_id integer NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    total_chapters integer NOT NULL,
    chapters jsonb DEFAULT '[]'::jsonb NOT NULL,
    spec jsonb DEFAULT '{}'::jsonb NOT NULL,
    final_file_path text,
    final_drive_url text,
    final_watch_url text,
    final_duration_sec real,
    final_size_bytes bigint,
    error_message text,
    cancel_requested boolean DEFAULT false NOT NULL,
    concat_attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    completed_at timestamp without time zone,
    instance_id text,
    phase text
);


--
-- Name: watchlist_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watchlist_alerts (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    watchlist_item_id integer NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    source text,
    severity text DEFAULT 'info'::text,
    matched_keywords jsonb,
    acknowledged boolean DEFAULT false,
    acknowledged_by_persona_id integer,
    processed_by_event integer,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: watchlist_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.watchlist_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: watchlist_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.watchlist_alerts_id_seq OWNED BY public.watchlist_alerts.id;


--
-- Name: watchlist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watchlist_items (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    created_by_persona_id integer,
    name text NOT NULL,
    category text DEFAULT 'competitor'::text NOT NULL,
    search_queries jsonb DEFAULT '[]'::jsonb NOT NULL,
    keywords jsonb,
    check_frequency text DEFAULT 'daily'::text,
    last_checked_at timestamp without time zone,
    last_results jsonb,
    alert_threshold text DEFAULT 'any_new'::text,
    escalate_to_persona_id integer,
    enabled boolean DEFAULT true,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: watchlist_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.watchlist_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: watchlist_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.watchlist_items_id_seq OWNED BY public.watchlist_items.id;


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    provider text NOT NULL,
    event_id text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: wellbeing_interventions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wellbeing_interventions (
    id integer NOT NULL,
    tenant_id integer NOT NULL,
    user_id text,
    intervention_id text NOT NULL,
    intervention_type text DEFAULT 'micro_sabbatical'::text NOT NULL,
    fatigue_type text,
    shame_intensity text,
    trigger_keywords text,
    accepted boolean,
    feedback text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: wellbeing_interventions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.wellbeing_interventions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: wellbeing_interventions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.wellbeing_interventions_id_seq OWNED BY public.wellbeing_interventions.id;


--
-- Name: whatsapp_auth; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_auth (
    key text NOT NULL,
    value text NOT NULL
);


--
-- Name: _managed_webhooks; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe._managed_webhooks (
    id text NOT NULL,
    object text,
    url text NOT NULL,
    enabled_events jsonb NOT NULL,
    description text,
    enabled boolean,
    livemode boolean,
    metadata jsonb,
    secret text NOT NULL,
    status text,
    api_version text,
    created integer,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_synced_at timestamp with time zone,
    account_id text NOT NULL
);


--
-- Name: _migrations; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe._migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: _sync_status; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe._sync_status (
    id integer NOT NULL,
    resource text NOT NULL,
    status text DEFAULT 'idle'::text,
    last_synced_at timestamp with time zone DEFAULT now(),
    last_incremental_cursor timestamp with time zone,
    error_message text,
    updated_at timestamp with time zone DEFAULT now(),
    account_id text NOT NULL,
    CONSTRAINT _sync_status_status_check CHECK ((status = ANY (ARRAY['idle'::text, 'running'::text, 'complete'::text, 'error'::text])))
);


--
-- Name: _sync_status_id_seq; Type: SEQUENCE; Schema: stripe; Owner: -
--

CREATE SEQUENCE stripe._sync_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _sync_status_id_seq; Type: SEQUENCE OWNED BY; Schema: stripe; Owner: -
--

ALTER SEQUENCE stripe._sync_status_id_seq OWNED BY stripe._sync_status.id;


--
-- Name: accounts; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.accounts (
    _raw_data jsonb NOT NULL,
    first_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    _last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    _updated_at timestamp with time zone DEFAULT now() NOT NULL,
    business_name text GENERATED ALWAYS AS (((_raw_data -> 'business_profile'::text) ->> 'name'::text)) STORED,
    email text GENERATED ALWAYS AS ((_raw_data ->> 'email'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    charges_enabled boolean GENERATED ALWAYS AS (((_raw_data ->> 'charges_enabled'::text))::boolean) STORED,
    payouts_enabled boolean GENERATED ALWAYS AS (((_raw_data ->> 'payouts_enabled'::text))::boolean) STORED,
    details_submitted boolean GENERATED ALWAYS AS (((_raw_data ->> 'details_submitted'::text))::boolean) STORED,
    country text GENERATED ALWAYS AS ((_raw_data ->> 'country'::text)) STORED,
    default_currency text GENERATED ALWAYS AS ((_raw_data ->> 'default_currency'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    api_key_hashes text[] DEFAULT '{}'::text[],
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: active_entitlements; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.active_entitlements (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    feature text GENERATED ALWAYS AS ((_raw_data ->> 'feature'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    lookup_key text GENERATED ALWAYS AS ((_raw_data ->> 'lookup_key'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: charges; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.charges (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    paid boolean GENERATED ALWAYS AS (((_raw_data ->> 'paid'::text))::boolean) STORED,
    "order" text GENERATED ALWAYS AS ((_raw_data ->> 'order'::text)) STORED,
    amount bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::bigint) STORED,
    review text GENERATED ALWAYS AS ((_raw_data ->> 'review'::text)) STORED,
    source jsonb GENERATED ALWAYS AS ((_raw_data -> 'source'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    dispute text GENERATED ALWAYS AS ((_raw_data ->> 'dispute'::text)) STORED,
    invoice text GENERATED ALWAYS AS ((_raw_data ->> 'invoice'::text)) STORED,
    outcome jsonb GENERATED ALWAYS AS ((_raw_data -> 'outcome'::text)) STORED,
    refunds jsonb GENERATED ALWAYS AS ((_raw_data -> 'refunds'::text)) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    captured boolean GENERATED ALWAYS AS (((_raw_data ->> 'captured'::text))::boolean) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    refunded boolean GENERATED ALWAYS AS (((_raw_data ->> 'refunded'::text))::boolean) STORED,
    shipping jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping'::text)) STORED,
    application text GENERATED ALWAYS AS ((_raw_data ->> 'application'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    destination text GENERATED ALWAYS AS ((_raw_data ->> 'destination'::text)) STORED,
    failure_code text GENERATED ALWAYS AS ((_raw_data ->> 'failure_code'::text)) STORED,
    on_behalf_of text GENERATED ALWAYS AS ((_raw_data ->> 'on_behalf_of'::text)) STORED,
    fraud_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'fraud_details'::text)) STORED,
    receipt_email text GENERATED ALWAYS AS ((_raw_data ->> 'receipt_email'::text)) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    receipt_number text GENERATED ALWAYS AS ((_raw_data ->> 'receipt_number'::text)) STORED,
    transfer_group text GENERATED ALWAYS AS ((_raw_data ->> 'transfer_group'::text)) STORED,
    amount_refunded bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_refunded'::text))::bigint) STORED,
    application_fee text GENERATED ALWAYS AS ((_raw_data ->> 'application_fee'::text)) STORED,
    failure_message text GENERATED ALWAYS AS ((_raw_data ->> 'failure_message'::text)) STORED,
    source_transfer text GENERATED ALWAYS AS ((_raw_data ->> 'source_transfer'::text)) STORED,
    balance_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'balance_transaction'::text)) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    payment_method_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_details'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: checkout_session_line_items; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.checkout_session_line_items (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    amount_discount integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_discount'::text))::integer) STORED,
    amount_subtotal integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_subtotal'::text))::integer) STORED,
    amount_tax integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_tax'::text))::integer) STORED,
    amount_total integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_total'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    price text GENERATED ALWAYS AS ((_raw_data ->> 'price'::text)) STORED,
    quantity integer GENERATED ALWAYS AS (((_raw_data ->> 'quantity'::text))::integer) STORED,
    checkout_session text GENERATED ALWAYS AS ((_raw_data ->> 'checkout_session'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: checkout_sessions; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.checkout_sessions (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    adaptive_pricing jsonb GENERATED ALWAYS AS ((_raw_data -> 'adaptive_pricing'::text)) STORED,
    after_expiration jsonb GENERATED ALWAYS AS ((_raw_data -> 'after_expiration'::text)) STORED,
    allow_promotion_codes boolean GENERATED ALWAYS AS (((_raw_data ->> 'allow_promotion_codes'::text))::boolean) STORED,
    amount_subtotal integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_subtotal'::text))::integer) STORED,
    amount_total integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_total'::text))::integer) STORED,
    automatic_tax jsonb GENERATED ALWAYS AS ((_raw_data -> 'automatic_tax'::text)) STORED,
    billing_address_collection text GENERATED ALWAYS AS ((_raw_data ->> 'billing_address_collection'::text)) STORED,
    cancel_url text GENERATED ALWAYS AS ((_raw_data ->> 'cancel_url'::text)) STORED,
    client_reference_id text GENERATED ALWAYS AS ((_raw_data ->> 'client_reference_id'::text)) STORED,
    client_secret text GENERATED ALWAYS AS ((_raw_data ->> 'client_secret'::text)) STORED,
    collected_information jsonb GENERATED ALWAYS AS ((_raw_data -> 'collected_information'::text)) STORED,
    consent jsonb GENERATED ALWAYS AS ((_raw_data -> 'consent'::text)) STORED,
    consent_collection jsonb GENERATED ALWAYS AS ((_raw_data -> 'consent_collection'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    currency_conversion jsonb GENERATED ALWAYS AS ((_raw_data -> 'currency_conversion'::text)) STORED,
    custom_fields jsonb GENERATED ALWAYS AS ((_raw_data -> 'custom_fields'::text)) STORED,
    custom_text jsonb GENERATED ALWAYS AS ((_raw_data -> 'custom_text'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    customer_creation text GENERATED ALWAYS AS ((_raw_data ->> 'customer_creation'::text)) STORED,
    customer_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'customer_details'::text)) STORED,
    customer_email text GENERATED ALWAYS AS ((_raw_data ->> 'customer_email'::text)) STORED,
    discounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'discounts'::text)) STORED,
    expires_at integer GENERATED ALWAYS AS (((_raw_data ->> 'expires_at'::text))::integer) STORED,
    invoice text GENERATED ALWAYS AS ((_raw_data ->> 'invoice'::text)) STORED,
    invoice_creation jsonb GENERATED ALWAYS AS ((_raw_data -> 'invoice_creation'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    locale text GENERATED ALWAYS AS ((_raw_data ->> 'locale'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    mode text GENERATED ALWAYS AS ((_raw_data ->> 'mode'::text)) STORED,
    optional_items jsonb GENERATED ALWAYS AS ((_raw_data -> 'optional_items'::text)) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    payment_link text GENERATED ALWAYS AS ((_raw_data ->> 'payment_link'::text)) STORED,
    payment_method_collection text GENERATED ALWAYS AS ((_raw_data ->> 'payment_method_collection'::text)) STORED,
    payment_method_configuration_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_configuration_details'::text)) STORED,
    payment_method_options jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_options'::text)) STORED,
    payment_method_types jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_types'::text)) STORED,
    payment_status text GENERATED ALWAYS AS ((_raw_data ->> 'payment_status'::text)) STORED,
    permissions jsonb GENERATED ALWAYS AS ((_raw_data -> 'permissions'::text)) STORED,
    phone_number_collection jsonb GENERATED ALWAYS AS ((_raw_data -> 'phone_number_collection'::text)) STORED,
    presentment_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'presentment_details'::text)) STORED,
    recovered_from text GENERATED ALWAYS AS ((_raw_data ->> 'recovered_from'::text)) STORED,
    redirect_on_completion text GENERATED ALWAYS AS ((_raw_data ->> 'redirect_on_completion'::text)) STORED,
    return_url text GENERATED ALWAYS AS ((_raw_data ->> 'return_url'::text)) STORED,
    saved_payment_method_options jsonb GENERATED ALWAYS AS ((_raw_data -> 'saved_payment_method_options'::text)) STORED,
    setup_intent text GENERATED ALWAYS AS ((_raw_data ->> 'setup_intent'::text)) STORED,
    shipping_address_collection jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping_address_collection'::text)) STORED,
    shipping_cost jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping_cost'::text)) STORED,
    shipping_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping_details'::text)) STORED,
    shipping_options jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping_options'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    submit_type text GENERATED ALWAYS AS ((_raw_data ->> 'submit_type'::text)) STORED,
    subscription text GENERATED ALWAYS AS ((_raw_data ->> 'subscription'::text)) STORED,
    success_url text GENERATED ALWAYS AS ((_raw_data ->> 'success_url'::text)) STORED,
    tax_id_collection jsonb GENERATED ALWAYS AS ((_raw_data -> 'tax_id_collection'::text)) STORED,
    total_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'total_details'::text)) STORED,
    ui_mode text GENERATED ALWAYS AS ((_raw_data ->> 'ui_mode'::text)) STORED,
    url text GENERATED ALWAYS AS ((_raw_data ->> 'url'::text)) STORED,
    wallet_options jsonb GENERATED ALWAYS AS ((_raw_data -> 'wallet_options'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: coupons; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.coupons (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    name text GENERATED ALWAYS AS ((_raw_data ->> 'name'::text)) STORED,
    valid boolean GENERATED ALWAYS AS (((_raw_data ->> 'valid'::text))::boolean) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    duration text GENERATED ALWAYS AS ((_raw_data ->> 'duration'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    redeem_by integer GENERATED ALWAYS AS (((_raw_data ->> 'redeem_by'::text))::integer) STORED,
    amount_off bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_off'::text))::bigint) STORED,
    percent_off double precision GENERATED ALWAYS AS (((_raw_data ->> 'percent_off'::text))::double precision) STORED,
    times_redeemed bigint GENERATED ALWAYS AS (((_raw_data ->> 'times_redeemed'::text))::bigint) STORED,
    max_redemptions bigint GENERATED ALWAYS AS (((_raw_data ->> 'max_redemptions'::text))::bigint) STORED,
    duration_in_months bigint GENERATED ALWAYS AS (((_raw_data ->> 'duration_in_months'::text))::bigint) STORED,
    percent_off_precise double precision GENERATED ALWAYS AS (((_raw_data ->> 'percent_off_precise'::text))::double precision) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: credit_notes; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.credit_notes (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    amount integer GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::integer) STORED,
    amount_shipping integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_shipping'::text))::integer) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    customer_balance_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'customer_balance_transaction'::text)) STORED,
    discount_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'discount_amount'::text))::integer) STORED,
    discount_amounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'discount_amounts'::text)) STORED,
    invoice text GENERATED ALWAYS AS ((_raw_data ->> 'invoice'::text)) STORED,
    lines jsonb GENERATED ALWAYS AS ((_raw_data -> 'lines'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    memo text GENERATED ALWAYS AS ((_raw_data ->> 'memo'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    number text GENERATED ALWAYS AS ((_raw_data ->> 'number'::text)) STORED,
    out_of_band_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'out_of_band_amount'::text))::integer) STORED,
    pdf text GENERATED ALWAYS AS ((_raw_data ->> 'pdf'::text)) STORED,
    reason text GENERATED ALWAYS AS ((_raw_data ->> 'reason'::text)) STORED,
    refund text GENERATED ALWAYS AS ((_raw_data ->> 'refund'::text)) STORED,
    shipping_cost jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping_cost'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    subtotal integer GENERATED ALWAYS AS (((_raw_data ->> 'subtotal'::text))::integer) STORED,
    subtotal_excluding_tax integer GENERATED ALWAYS AS (((_raw_data ->> 'subtotal_excluding_tax'::text))::integer) STORED,
    tax_amounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'tax_amounts'::text)) STORED,
    total integer GENERATED ALWAYS AS (((_raw_data ->> 'total'::text))::integer) STORED,
    total_excluding_tax integer GENERATED ALWAYS AS (((_raw_data ->> 'total_excluding_tax'::text))::integer) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    voided_at text GENERATED ALWAYS AS ((_raw_data ->> 'voided_at'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.customers (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    address jsonb GENERATED ALWAYS AS ((_raw_data -> 'address'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    email text GENERATED ALWAYS AS ((_raw_data ->> 'email'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    name text GENERATED ALWAYS AS ((_raw_data ->> 'name'::text)) STORED,
    phone text GENERATED ALWAYS AS ((_raw_data ->> 'phone'::text)) STORED,
    shipping jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping'::text)) STORED,
    balance integer GENERATED ALWAYS AS (((_raw_data ->> 'balance'::text))::integer) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    default_source text GENERATED ALWAYS AS ((_raw_data ->> 'default_source'::text)) STORED,
    delinquent boolean GENERATED ALWAYS AS (((_raw_data ->> 'delinquent'::text))::boolean) STORED,
    discount jsonb GENERATED ALWAYS AS ((_raw_data -> 'discount'::text)) STORED,
    invoice_prefix text GENERATED ALWAYS AS ((_raw_data ->> 'invoice_prefix'::text)) STORED,
    invoice_settings jsonb GENERATED ALWAYS AS ((_raw_data -> 'invoice_settings'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    next_invoice_sequence integer GENERATED ALWAYS AS (((_raw_data ->> 'next_invoice_sequence'::text))::integer) STORED,
    preferred_locales jsonb GENERATED ALWAYS AS ((_raw_data -> 'preferred_locales'::text)) STORED,
    tax_exempt text GENERATED ALWAYS AS ((_raw_data ->> 'tax_exempt'::text)) STORED,
    deleted boolean GENERATED ALWAYS AS (((_raw_data ->> 'deleted'::text))::boolean) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: disputes; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.disputes (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    amount bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::bigint) STORED,
    charge text GENERATED ALWAYS AS ((_raw_data ->> 'charge'::text)) STORED,
    reason text GENERATED ALWAYS AS ((_raw_data ->> 'reason'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    evidence jsonb GENERATED ALWAYS AS ((_raw_data -> 'evidence'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    evidence_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'evidence_details'::text)) STORED,
    balance_transactions jsonb GENERATED ALWAYS AS ((_raw_data -> 'balance_transactions'::text)) STORED,
    is_charge_refundable boolean GENERATED ALWAYS AS (((_raw_data ->> 'is_charge_refundable'::text))::boolean) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: early_fraud_warnings; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.early_fraud_warnings (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    actionable boolean GENERATED ALWAYS AS (((_raw_data ->> 'actionable'::text))::boolean) STORED,
    charge text GENERATED ALWAYS AS ((_raw_data ->> 'charge'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    fraud_type text GENERATED ALWAYS AS ((_raw_data ->> 'fraud_type'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: events; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.events (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    data jsonb GENERATED ALWAYS AS ((_raw_data -> 'data'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    request text GENERATED ALWAYS AS ((_raw_data ->> 'request'::text)) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    api_version text GENERATED ALWAYS AS ((_raw_data ->> 'api_version'::text)) STORED,
    pending_webhooks bigint GENERATED ALWAYS AS (((_raw_data ->> 'pending_webhooks'::text))::bigint) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: features; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.features (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    name text GENERATED ALWAYS AS ((_raw_data ->> 'name'::text)) STORED,
    lookup_key text GENERATED ALWAYS AS ((_raw_data ->> 'lookup_key'::text)) STORED,
    active boolean GENERATED ALWAYS AS (((_raw_data ->> 'active'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: invoices; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.invoices (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    auto_advance boolean GENERATED ALWAYS AS (((_raw_data ->> 'auto_advance'::text))::boolean) STORED,
    collection_method text GENERATED ALWAYS AS ((_raw_data ->> 'collection_method'::text)) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    hosted_invoice_url text GENERATED ALWAYS AS ((_raw_data ->> 'hosted_invoice_url'::text)) STORED,
    lines jsonb GENERATED ALWAYS AS ((_raw_data -> 'lines'::text)) STORED,
    period_end integer GENERATED ALWAYS AS (((_raw_data ->> 'period_end'::text))::integer) STORED,
    period_start integer GENERATED ALWAYS AS (((_raw_data ->> 'period_start'::text))::integer) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    total bigint GENERATED ALWAYS AS (((_raw_data ->> 'total'::text))::bigint) STORED,
    account_country text GENERATED ALWAYS AS ((_raw_data ->> 'account_country'::text)) STORED,
    account_name text GENERATED ALWAYS AS ((_raw_data ->> 'account_name'::text)) STORED,
    account_tax_ids jsonb GENERATED ALWAYS AS ((_raw_data -> 'account_tax_ids'::text)) STORED,
    amount_due bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_due'::text))::bigint) STORED,
    amount_paid bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_paid'::text))::bigint) STORED,
    amount_remaining bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_remaining'::text))::bigint) STORED,
    application_fee_amount bigint GENERATED ALWAYS AS (((_raw_data ->> 'application_fee_amount'::text))::bigint) STORED,
    attempt_count integer GENERATED ALWAYS AS (((_raw_data ->> 'attempt_count'::text))::integer) STORED,
    attempted boolean GENERATED ALWAYS AS (((_raw_data ->> 'attempted'::text))::boolean) STORED,
    billing_reason text GENERATED ALWAYS AS ((_raw_data ->> 'billing_reason'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    custom_fields jsonb GENERATED ALWAYS AS ((_raw_data -> 'custom_fields'::text)) STORED,
    customer_address jsonb GENERATED ALWAYS AS ((_raw_data -> 'customer_address'::text)) STORED,
    customer_email text GENERATED ALWAYS AS ((_raw_data ->> 'customer_email'::text)) STORED,
    customer_name text GENERATED ALWAYS AS ((_raw_data ->> 'customer_name'::text)) STORED,
    customer_phone text GENERATED ALWAYS AS ((_raw_data ->> 'customer_phone'::text)) STORED,
    customer_shipping jsonb GENERATED ALWAYS AS ((_raw_data -> 'customer_shipping'::text)) STORED,
    customer_tax_exempt text GENERATED ALWAYS AS ((_raw_data ->> 'customer_tax_exempt'::text)) STORED,
    customer_tax_ids jsonb GENERATED ALWAYS AS ((_raw_data -> 'customer_tax_ids'::text)) STORED,
    default_tax_rates jsonb GENERATED ALWAYS AS ((_raw_data -> 'default_tax_rates'::text)) STORED,
    discount jsonb GENERATED ALWAYS AS ((_raw_data -> 'discount'::text)) STORED,
    discounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'discounts'::text)) STORED,
    due_date integer GENERATED ALWAYS AS (((_raw_data ->> 'due_date'::text))::integer) STORED,
    ending_balance integer GENERATED ALWAYS AS (((_raw_data ->> 'ending_balance'::text))::integer) STORED,
    footer text GENERATED ALWAYS AS ((_raw_data ->> 'footer'::text)) STORED,
    invoice_pdf text GENERATED ALWAYS AS ((_raw_data ->> 'invoice_pdf'::text)) STORED,
    last_finalization_error jsonb GENERATED ALWAYS AS ((_raw_data -> 'last_finalization_error'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    next_payment_attempt integer GENERATED ALWAYS AS (((_raw_data ->> 'next_payment_attempt'::text))::integer) STORED,
    number text GENERATED ALWAYS AS ((_raw_data ->> 'number'::text)) STORED,
    paid boolean GENERATED ALWAYS AS (((_raw_data ->> 'paid'::text))::boolean) STORED,
    payment_settings jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_settings'::text)) STORED,
    post_payment_credit_notes_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'post_payment_credit_notes_amount'::text))::integer) STORED,
    pre_payment_credit_notes_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'pre_payment_credit_notes_amount'::text))::integer) STORED,
    receipt_number text GENERATED ALWAYS AS ((_raw_data ->> 'receipt_number'::text)) STORED,
    starting_balance integer GENERATED ALWAYS AS (((_raw_data ->> 'starting_balance'::text))::integer) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    status_transitions jsonb GENERATED ALWAYS AS ((_raw_data -> 'status_transitions'::text)) STORED,
    subtotal integer GENERATED ALWAYS AS (((_raw_data ->> 'subtotal'::text))::integer) STORED,
    tax integer GENERATED ALWAYS AS (((_raw_data ->> 'tax'::text))::integer) STORED,
    total_discount_amounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'total_discount_amounts'::text)) STORED,
    total_tax_amounts jsonb GENERATED ALWAYS AS ((_raw_data -> 'total_tax_amounts'::text)) STORED,
    transfer_data jsonb GENERATED ALWAYS AS ((_raw_data -> 'transfer_data'::text)) STORED,
    webhooks_delivered_at integer GENERATED ALWAYS AS (((_raw_data ->> 'webhooks_delivered_at'::text))::integer) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    subscription text GENERATED ALWAYS AS ((_raw_data ->> 'subscription'::text)) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    default_payment_method text GENERATED ALWAYS AS ((_raw_data ->> 'default_payment_method'::text)) STORED,
    default_source text GENERATED ALWAYS AS ((_raw_data ->> 'default_source'::text)) STORED,
    on_behalf_of text GENERATED ALWAYS AS ((_raw_data ->> 'on_behalf_of'::text)) STORED,
    charge text GENERATED ALWAYS AS ((_raw_data ->> 'charge'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: payment_intents; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.payment_intents (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    amount integer GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::integer) STORED,
    amount_capturable integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_capturable'::text))::integer) STORED,
    amount_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'amount_details'::text)) STORED,
    amount_received integer GENERATED ALWAYS AS (((_raw_data ->> 'amount_received'::text))::integer) STORED,
    application text GENERATED ALWAYS AS ((_raw_data ->> 'application'::text)) STORED,
    application_fee_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'application_fee_amount'::text))::integer) STORED,
    automatic_payment_methods text GENERATED ALWAYS AS ((_raw_data ->> 'automatic_payment_methods'::text)) STORED,
    canceled_at integer GENERATED ALWAYS AS (((_raw_data ->> 'canceled_at'::text))::integer) STORED,
    cancellation_reason text GENERATED ALWAYS AS ((_raw_data ->> 'cancellation_reason'::text)) STORED,
    capture_method text GENERATED ALWAYS AS ((_raw_data ->> 'capture_method'::text)) STORED,
    client_secret text GENERATED ALWAYS AS ((_raw_data ->> 'client_secret'::text)) STORED,
    confirmation_method text GENERATED ALWAYS AS ((_raw_data ->> 'confirmation_method'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    invoice text GENERATED ALWAYS AS ((_raw_data ->> 'invoice'::text)) STORED,
    last_payment_error text GENERATED ALWAYS AS ((_raw_data ->> 'last_payment_error'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    next_action text GENERATED ALWAYS AS ((_raw_data ->> 'next_action'::text)) STORED,
    on_behalf_of text GENERATED ALWAYS AS ((_raw_data ->> 'on_behalf_of'::text)) STORED,
    payment_method text GENERATED ALWAYS AS ((_raw_data ->> 'payment_method'::text)) STORED,
    payment_method_options jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_options'::text)) STORED,
    payment_method_types jsonb GENERATED ALWAYS AS ((_raw_data -> 'payment_method_types'::text)) STORED,
    processing text GENERATED ALWAYS AS ((_raw_data ->> 'processing'::text)) STORED,
    receipt_email text GENERATED ALWAYS AS ((_raw_data ->> 'receipt_email'::text)) STORED,
    review text GENERATED ALWAYS AS ((_raw_data ->> 'review'::text)) STORED,
    setup_future_usage text GENERATED ALWAYS AS ((_raw_data ->> 'setup_future_usage'::text)) STORED,
    shipping jsonb GENERATED ALWAYS AS ((_raw_data -> 'shipping'::text)) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    statement_descriptor_suffix text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor_suffix'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    transfer_data jsonb GENERATED ALWAYS AS ((_raw_data -> 'transfer_data'::text)) STORED,
    transfer_group text GENERATED ALWAYS AS ((_raw_data ->> 'transfer_group'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: payment_methods; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.payment_methods (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    billing_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'billing_details'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    card jsonb GENERATED ALWAYS AS ((_raw_data -> 'card'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: payouts; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.payouts (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    date text GENERATED ALWAYS AS ((_raw_data ->> 'date'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    amount bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::bigint) STORED,
    method text GENERATED ALWAYS AS ((_raw_data ->> 'method'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    automatic boolean GENERATED ALWAYS AS (((_raw_data ->> 'automatic'::text))::boolean) STORED,
    recipient text GENERATED ALWAYS AS ((_raw_data ->> 'recipient'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    destination text GENERATED ALWAYS AS ((_raw_data ->> 'destination'::text)) STORED,
    source_type text GENERATED ALWAYS AS ((_raw_data ->> 'source_type'::text)) STORED,
    arrival_date text GENERATED ALWAYS AS ((_raw_data ->> 'arrival_date'::text)) STORED,
    bank_account jsonb GENERATED ALWAYS AS ((_raw_data -> 'bank_account'::text)) STORED,
    failure_code text GENERATED ALWAYS AS ((_raw_data ->> 'failure_code'::text)) STORED,
    transfer_group text GENERATED ALWAYS AS ((_raw_data ->> 'transfer_group'::text)) STORED,
    amount_reversed bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount_reversed'::text))::bigint) STORED,
    failure_message text GENERATED ALWAYS AS ((_raw_data ->> 'failure_message'::text)) STORED,
    source_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'source_transaction'::text)) STORED,
    balance_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'balance_transaction'::text)) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    statement_description text GENERATED ALWAYS AS ((_raw_data ->> 'statement_description'::text)) STORED,
    failure_balance_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'failure_balance_transaction'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: plans; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.plans (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    name text GENERATED ALWAYS AS ((_raw_data ->> 'name'::text)) STORED,
    tiers jsonb GENERATED ALWAYS AS ((_raw_data -> 'tiers'::text)) STORED,
    active boolean GENERATED ALWAYS AS (((_raw_data ->> 'active'::text))::boolean) STORED,
    amount bigint GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::bigint) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    product text GENERATED ALWAYS AS ((_raw_data ->> 'product'::text)) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    "interval" text GENERATED ALWAYS AS ((_raw_data ->> 'interval'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    nickname text GENERATED ALWAYS AS ((_raw_data ->> 'nickname'::text)) STORED,
    tiers_mode text GENERATED ALWAYS AS ((_raw_data ->> 'tiers_mode'::text)) STORED,
    usage_type text GENERATED ALWAYS AS ((_raw_data ->> 'usage_type'::text)) STORED,
    billing_scheme text GENERATED ALWAYS AS ((_raw_data ->> 'billing_scheme'::text)) STORED,
    interval_count bigint GENERATED ALWAYS AS (((_raw_data ->> 'interval_count'::text))::bigint) STORED,
    aggregate_usage text GENERATED ALWAYS AS ((_raw_data ->> 'aggregate_usage'::text)) STORED,
    transform_usage text GENERATED ALWAYS AS ((_raw_data ->> 'transform_usage'::text)) STORED,
    trial_period_days bigint GENERATED ALWAYS AS (((_raw_data ->> 'trial_period_days'::text))::bigint) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    statement_description text GENERATED ALWAYS AS ((_raw_data ->> 'statement_description'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: prices; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.prices (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    active boolean GENERATED ALWAYS AS (((_raw_data ->> 'active'::text))::boolean) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    nickname text GENERATED ALWAYS AS ((_raw_data ->> 'nickname'::text)) STORED,
    recurring jsonb GENERATED ALWAYS AS ((_raw_data -> 'recurring'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    unit_amount integer GENERATED ALWAYS AS (((_raw_data ->> 'unit_amount'::text))::integer) STORED,
    billing_scheme text GENERATED ALWAYS AS ((_raw_data ->> 'billing_scheme'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    lookup_key text GENERATED ALWAYS AS ((_raw_data ->> 'lookup_key'::text)) STORED,
    tiers_mode text GENERATED ALWAYS AS ((_raw_data ->> 'tiers_mode'::text)) STORED,
    transform_quantity jsonb GENERATED ALWAYS AS ((_raw_data -> 'transform_quantity'::text)) STORED,
    unit_amount_decimal text GENERATED ALWAYS AS ((_raw_data ->> 'unit_amount_decimal'::text)) STORED,
    product text GENERATED ALWAYS AS ((_raw_data ->> 'product'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.products (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    active boolean GENERATED ALWAYS AS (((_raw_data ->> 'active'::text))::boolean) STORED,
    default_price text GENERATED ALWAYS AS ((_raw_data ->> 'default_price'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    name text GENERATED ALWAYS AS ((_raw_data ->> 'name'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    images jsonb GENERATED ALWAYS AS ((_raw_data -> 'images'::text)) STORED,
    marketing_features jsonb GENERATED ALWAYS AS ((_raw_data -> 'marketing_features'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    package_dimensions jsonb GENERATED ALWAYS AS ((_raw_data -> 'package_dimensions'::text)) STORED,
    shippable boolean GENERATED ALWAYS AS (((_raw_data ->> 'shippable'::text))::boolean) STORED,
    statement_descriptor text GENERATED ALWAYS AS ((_raw_data ->> 'statement_descriptor'::text)) STORED,
    unit_label text GENERATED ALWAYS AS ((_raw_data ->> 'unit_label'::text)) STORED,
    updated integer GENERATED ALWAYS AS (((_raw_data ->> 'updated'::text))::integer) STORED,
    url text GENERATED ALWAYS AS ((_raw_data ->> 'url'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: refunds; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.refunds (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    amount integer GENERATED ALWAYS AS (((_raw_data ->> 'amount'::text))::integer) STORED,
    balance_transaction text GENERATED ALWAYS AS ((_raw_data ->> 'balance_transaction'::text)) STORED,
    charge text GENERATED ALWAYS AS ((_raw_data ->> 'charge'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    currency text GENERATED ALWAYS AS ((_raw_data ->> 'currency'::text)) STORED,
    destination_details jsonb GENERATED ALWAYS AS ((_raw_data -> 'destination_details'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    reason text GENERATED ALWAYS AS ((_raw_data ->> 'reason'::text)) STORED,
    receipt_number text GENERATED ALWAYS AS ((_raw_data ->> 'receipt_number'::text)) STORED,
    source_transfer_reversal text GENERATED ALWAYS AS ((_raw_data ->> 'source_transfer_reversal'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    transfer_reversal text GENERATED ALWAYS AS ((_raw_data ->> 'transfer_reversal'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: reviews; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.reviews (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    billing_zip text GENERATED ALWAYS AS ((_raw_data ->> 'billing_zip'::text)) STORED,
    charge text GENERATED ALWAYS AS ((_raw_data ->> 'charge'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    closed_reason text GENERATED ALWAYS AS ((_raw_data ->> 'closed_reason'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    ip_address text GENERATED ALWAYS AS ((_raw_data ->> 'ip_address'::text)) STORED,
    ip_address_location jsonb GENERATED ALWAYS AS ((_raw_data -> 'ip_address_location'::text)) STORED,
    open boolean GENERATED ALWAYS AS (((_raw_data ->> 'open'::text))::boolean) STORED,
    opened_reason text GENERATED ALWAYS AS ((_raw_data ->> 'opened_reason'::text)) STORED,
    payment_intent text GENERATED ALWAYS AS ((_raw_data ->> 'payment_intent'::text)) STORED,
    reason text GENERATED ALWAYS AS ((_raw_data ->> 'reason'::text)) STORED,
    session text GENERATED ALWAYS AS ((_raw_data ->> 'session'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: setup_intents; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.setup_intents (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    description text GENERATED ALWAYS AS ((_raw_data ->> 'description'::text)) STORED,
    payment_method text GENERATED ALWAYS AS ((_raw_data ->> 'payment_method'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    usage text GENERATED ALWAYS AS ((_raw_data ->> 'usage'::text)) STORED,
    cancellation_reason text GENERATED ALWAYS AS ((_raw_data ->> 'cancellation_reason'::text)) STORED,
    latest_attempt text GENERATED ALWAYS AS ((_raw_data ->> 'latest_attempt'::text)) STORED,
    mandate text GENERATED ALWAYS AS ((_raw_data ->> 'mandate'::text)) STORED,
    single_use_mandate text GENERATED ALWAYS AS ((_raw_data ->> 'single_use_mandate'::text)) STORED,
    on_behalf_of text GENERATED ALWAYS AS ((_raw_data ->> 'on_behalf_of'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: subscription_items; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.subscription_items (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    billing_thresholds jsonb GENERATED ALWAYS AS ((_raw_data -> 'billing_thresholds'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    deleted boolean GENERATED ALWAYS AS (((_raw_data ->> 'deleted'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    quantity integer GENERATED ALWAYS AS (((_raw_data ->> 'quantity'::text))::integer) STORED,
    price text GENERATED ALWAYS AS ((_raw_data ->> 'price'::text)) STORED,
    subscription text GENERATED ALWAYS AS ((_raw_data ->> 'subscription'::text)) STORED,
    tax_rates jsonb GENERATED ALWAYS AS ((_raw_data -> 'tax_rates'::text)) STORED,
    current_period_end integer GENERATED ALWAYS AS (((_raw_data ->> 'current_period_end'::text))::integer) STORED,
    current_period_start integer GENERATED ALWAYS AS (((_raw_data ->> 'current_period_start'::text))::integer) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: subscription_schedules; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.subscription_schedules (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    application text GENERATED ALWAYS AS ((_raw_data ->> 'application'::text)) STORED,
    canceled_at integer GENERATED ALWAYS AS (((_raw_data ->> 'canceled_at'::text))::integer) STORED,
    completed_at integer GENERATED ALWAYS AS (((_raw_data ->> 'completed_at'::text))::integer) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    current_phase jsonb GENERATED ALWAYS AS ((_raw_data -> 'current_phase'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    default_settings jsonb GENERATED ALWAYS AS ((_raw_data -> 'default_settings'::text)) STORED,
    end_behavior text GENERATED ALWAYS AS ((_raw_data ->> 'end_behavior'::text)) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    phases jsonb GENERATED ALWAYS AS ((_raw_data -> 'phases'::text)) STORED,
    released_at integer GENERATED ALWAYS AS (((_raw_data ->> 'released_at'::text))::integer) STORED,
    released_subscription text GENERATED ALWAYS AS ((_raw_data ->> 'released_subscription'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    subscription text GENERATED ALWAYS AS ((_raw_data ->> 'subscription'::text)) STORED,
    test_clock text GENERATED ALWAYS AS ((_raw_data ->> 'test_clock'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: subscriptions; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.subscriptions (
    _updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    cancel_at_period_end boolean GENERATED ALWAYS AS (((_raw_data ->> 'cancel_at_period_end'::text))::boolean) STORED,
    current_period_end integer GENERATED ALWAYS AS (((_raw_data ->> 'current_period_end'::text))::integer) STORED,
    current_period_start integer GENERATED ALWAYS AS (((_raw_data ->> 'current_period_start'::text))::integer) STORED,
    default_payment_method text GENERATED ALWAYS AS ((_raw_data ->> 'default_payment_method'::text)) STORED,
    items jsonb GENERATED ALWAYS AS ((_raw_data -> 'items'::text)) STORED,
    metadata jsonb GENERATED ALWAYS AS ((_raw_data -> 'metadata'::text)) STORED,
    pending_setup_intent text GENERATED ALWAYS AS ((_raw_data ->> 'pending_setup_intent'::text)) STORED,
    pending_update jsonb GENERATED ALWAYS AS ((_raw_data -> 'pending_update'::text)) STORED,
    status text GENERATED ALWAYS AS ((_raw_data ->> 'status'::text)) STORED,
    application_fee_percent double precision GENERATED ALWAYS AS (((_raw_data ->> 'application_fee_percent'::text))::double precision) STORED,
    billing_cycle_anchor integer GENERATED ALWAYS AS (((_raw_data ->> 'billing_cycle_anchor'::text))::integer) STORED,
    billing_thresholds jsonb GENERATED ALWAYS AS ((_raw_data -> 'billing_thresholds'::text)) STORED,
    cancel_at integer GENERATED ALWAYS AS (((_raw_data ->> 'cancel_at'::text))::integer) STORED,
    canceled_at integer GENERATED ALWAYS AS (((_raw_data ->> 'canceled_at'::text))::integer) STORED,
    collection_method text GENERATED ALWAYS AS ((_raw_data ->> 'collection_method'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    days_until_due integer GENERATED ALWAYS AS (((_raw_data ->> 'days_until_due'::text))::integer) STORED,
    default_source text GENERATED ALWAYS AS ((_raw_data ->> 'default_source'::text)) STORED,
    default_tax_rates jsonb GENERATED ALWAYS AS ((_raw_data -> 'default_tax_rates'::text)) STORED,
    discount jsonb GENERATED ALWAYS AS ((_raw_data -> 'discount'::text)) STORED,
    ended_at integer GENERATED ALWAYS AS (((_raw_data ->> 'ended_at'::text))::integer) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    next_pending_invoice_item_invoice integer GENERATED ALWAYS AS (((_raw_data ->> 'next_pending_invoice_item_invoice'::text))::integer) STORED,
    pause_collection jsonb GENERATED ALWAYS AS ((_raw_data -> 'pause_collection'::text)) STORED,
    pending_invoice_item_interval jsonb GENERATED ALWAYS AS ((_raw_data -> 'pending_invoice_item_interval'::text)) STORED,
    start_date integer GENERATED ALWAYS AS (((_raw_data ->> 'start_date'::text))::integer) STORED,
    transfer_data jsonb GENERATED ALWAYS AS ((_raw_data -> 'transfer_data'::text)) STORED,
    trial_end jsonb GENERATED ALWAYS AS ((_raw_data -> 'trial_end'::text)) STORED,
    trial_start jsonb GENERATED ALWAYS AS ((_raw_data -> 'trial_start'::text)) STORED,
    schedule text GENERATED ALWAYS AS ((_raw_data ->> 'schedule'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    latest_invoice text GENERATED ALWAYS AS ((_raw_data ->> 'latest_invoice'::text)) STORED,
    plan text GENERATED ALWAYS AS ((_raw_data ->> 'plan'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: tax_ids; Type: TABLE; Schema: stripe; Owner: -
--

CREATE TABLE stripe.tax_ids (
    _last_synced_at timestamp with time zone,
    _raw_data jsonb,
    _account_id text NOT NULL,
    object text GENERATED ALWAYS AS ((_raw_data ->> 'object'::text)) STORED,
    country text GENERATED ALWAYS AS ((_raw_data ->> 'country'::text)) STORED,
    customer text GENERATED ALWAYS AS ((_raw_data ->> 'customer'::text)) STORED,
    type text GENERATED ALWAYS AS ((_raw_data ->> 'type'::text)) STORED,
    value text GENERATED ALWAYS AS ((_raw_data ->> 'value'::text)) STORED,
    created integer GENERATED ALWAYS AS (((_raw_data ->> 'created'::text))::integer) STORED,
    livemode boolean GENERATED ALWAYS AS (((_raw_data ->> 'livemode'::text))::boolean) STORED,
    owner jsonb GENERATED ALWAYS AS ((_raw_data -> 'owner'::text)) STORED,
    id text GENERATED ALWAYS AS ((_raw_data ->> 'id'::text)) STORED NOT NULL
);


--
-- Name: ab_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_runs ALTER COLUMN id SET DEFAULT nextval('public.ab_runs_id_seq'::regclass);


--
-- Name: action_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_attempts ALTER COLUMN id SET DEFAULT nextval('public.action_attempts_id_seq'::regclass);


--
-- Name: action_outcomes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_outcomes ALTER COLUMN id SET DEFAULT nextval('public.action_outcomes_id_seq'::regclass);


--
-- Name: action_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_snapshots ALTER COLUMN id SET DEFAULT nextval('public.action_snapshots_id_seq'::regclass);


--
-- Name: activity_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log ALTER COLUMN id SET DEFAULT nextval('public.activity_log_id_seq'::regclass);


--
-- Name: agent_activity id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_activity ALTER COLUMN id SET DEFAULT nextval('public.agent_activity_id_seq'::regclass);


--
-- Name: agent_approvals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_approvals ALTER COLUMN id SET DEFAULT nextval('public.agent_approvals_id_seq'::regclass);


--
-- Name: agent_channels id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_channels ALTER COLUMN id SET DEFAULT nextval('public.agent_channels_id_seq'::regclass);


--
-- Name: agent_cost_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_cost_ledger ALTER COLUMN id SET DEFAULT nextval('public.agent_cost_ledger_id_seq'::regclass);


--
-- Name: agent_desks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_desks ALTER COLUMN id SET DEFAULT nextval('public.agent_desks_id_seq'::regclass);


--
-- Name: agent_evals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_evals ALTER COLUMN id SET DEFAULT nextval('public.agent_evals_id_seq'::regclass);


--
-- Name: agent_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs ALTER COLUMN id SET DEFAULT nextval('public.agent_jobs_id_seq'::regclass);


--
-- Name: agent_knowledge id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_knowledge ALTER COLUMN id SET DEFAULT nextval('public.agent_knowledge_id_seq'::regclass);


--
-- Name: agent_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs ALTER COLUMN id SET DEFAULT nextval('public.agent_runs_id_seq'::regclass);


--
-- Name: agent_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_settings ALTER COLUMN id SET DEFAULT nextval('public.agent_settings_id_seq'::regclass);


--
-- Name: agent_trace_spans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_trace_spans ALTER COLUMN id SET DEFAULT nextval('public.agent_trace_spans_id_seq'::regclass);


--
-- Name: agent_wake_schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_wake_schedules ALTER COLUMN id SET DEFAULT nextval('public.agent_wake_schedules_id_seq'::regclass);


--
-- Name: ai_insights id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_insights ALTER COLUMN id SET DEFAULT nextval('public.ai_insights_id_seq'::regclass);


--
-- Name: api_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys ALTER COLUMN id SET DEFAULT nextval('public.api_keys_id_seq'::regclass);


--
-- Name: architecture_decisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.architecture_decisions ALTER COLUMN id SET DEFAULT nextval('public.architecture_decisions_id_seq'::regclass);


--
-- Name: archive_rescue_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archive_rescue_orders ALTER COLUMN id SET DEFAULT nextval('public.archive_rescue_orders_id_seq'::regclass);


--
-- Name: audit_leads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_leads ALTER COLUMN id SET DEFAULT nextval('public.audit_leads_id_seq'::regclass);


--
-- Name: audit_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_reports ALTER COLUMN id SET DEFAULT nextval('public.audit_reports_id_seq'::regclass);


--
-- Name: autonomous_budget_claims id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autonomous_budget_claims ALTER COLUMN id SET DEFAULT nextval('public.autonomous_budget_claims_id_seq'::regclass);


--
-- Name: autonomy_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autonomy_log ALTER COLUMN id SET DEFAULT nextval('public.autonomy_log_id_seq'::regclass);


--
-- Name: autonomy_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autonomy_rules ALTER COLUMN id SET DEFAULT nextval('public.autonomy_rules_id_seq'::regclass);


--
-- Name: briefing_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefing_reports ALTER COLUMN id SET DEFAULT nextval('public.briefing_reports_id_seq'::regclass);


--
-- Name: briefing_widgets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefing_widgets ALTER COLUMN id SET DEFAULT nextval('public.briefing_widgets_id_seq'::regclass);


--
-- Name: browser_workflows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.browser_workflows ALTER COLUMN id SET DEFAULT nextval('public.browser_workflows_id_seq'::regclass);


--
-- Name: calendar_feeds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_feeds ALTER COLUMN id SET DEFAULT nextval('public.calendar_feeds_id_seq'::regclass);


--
-- Name: capabilities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capabilities ALTER COLUMN id SET DEFAULT nextval('public.capabilities_id_seq'::regclass);


--
-- Name: capability_gaps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_gaps ALTER COLUMN id SET DEFAULT nextval('public.capability_gaps_id_seq'::regclass);


--
-- Name: capability_reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_reviews ALTER COLUMN id SET DEFAULT nextval('public.capability_reviews_id_seq'::regclass);


--
-- Name: causal_chains id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.causal_chains ALTER COLUMN id SET DEFAULT nextval('public.causal_chains_id_seq'::regclass);


--
-- Name: channel_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_messages ALTER COLUMN id SET DEFAULT nextval('public.channel_messages_id_seq'::regclass);


--
-- Name: channel_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.channel_subscriptions_id_seq'::regclass);


--
-- Name: character_portrait_registry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_portrait_registry ALTER COLUMN id SET DEFAULT nextval('public.character_portrait_registry_id_seq'::regclass);


--
-- Name: code_health_findings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_health_findings ALTER COLUMN id SET DEFAULT nextval('public.code_health_findings_id_seq'::regclass);


--
-- Name: code_health_scans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_health_scans ALTER COLUMN id SET DEFAULT nextval('public.code_health_scans_id_seq'::regclass);


--
-- Name: code_proposals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_proposals ALTER COLUMN id SET DEFAULT nextval('public.code_proposals_id_seq'::regclass);


--
-- Name: commitments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commitments ALTER COLUMN id SET DEFAULT nextval('public.commitments_id_seq'::regclass);


--
-- Name: compaction_archives id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compaction_archives ALTER COLUMN id SET DEFAULT nextval('public.compaction_archives_id_seq'::regclass);


--
-- Name: competitor_changes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_changes ALTER COLUMN id SET DEFAULT nextval('public.competitor_changes_id_seq'::regclass);


--
-- Name: competitor_registry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_registry ALTER COLUMN id SET DEFAULT nextval('public.competitor_registry_id_seq'::regclass);


--
-- Name: competitor_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_snapshots ALTER COLUMN id SET DEFAULT nextval('public.competitor_snapshots_id_seq'::regclass);


--
-- Name: consolidation_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consolidation_log ALTER COLUMN id SET DEFAULT nextval('public.consolidation_log_id_seq'::regclass);


--
-- Name: contact_submissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_submissions ALTER COLUMN id SET DEFAULT nextval('public.contact_submissions_id_seq'::regclass);


--
-- Name: contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts ALTER COLUMN id SET DEFAULT nextval('public.contracts_id_seq'::regclass);


--
-- Name: conversation_facts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_facts ALTER COLUMN id SET DEFAULT nextval('public.conversation_facts_id_seq'::regclass);


--
-- Name: conversation_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_templates ALTER COLUMN id SET DEFAULT nextval('public.conversation_templates_id_seq'::regclass);


--
-- Name: conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations ALTER COLUMN id SET DEFAULT nextval('public.conversations_id_seq'::regclass);


--
-- Name: council_verdicts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.council_verdicts ALTER COLUMN id SET DEFAULT nextval('public.council_verdicts_id_seq'::regclass);


--
-- Name: crew_agents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_agents ALTER COLUMN id SET DEFAULT nextval('public.crew_agents_id_seq'::regclass);


--
-- Name: crew_flows id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_flows ALTER COLUMN id SET DEFAULT nextval('public.crew_flows_id_seq'::regclass);


--
-- Name: crew_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_runs ALTER COLUMN id SET DEFAULT nextval('public.crew_runs_id_seq'::regclass);


--
-- Name: crew_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_tasks ALTER COLUMN id SET DEFAULT nextval('public.crew_tasks_id_seq'::regclass);


--
-- Name: crews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crews ALTER COLUMN id SET DEFAULT nextval('public.crews_id_seq'::regclass);


--
-- Name: custom_tools id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_tools ALTER COLUMN id SET DEFAULT nextval('public.custom_tools_id_seq'::regclass);


--
-- Name: customer_interactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_interactions ALTER COLUMN id SET DEFAULT nextval('public.customer_interactions_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: daily_notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_notes ALTER COLUMN id SET DEFAULT nextval('public.daily_notes_id_seq'::regclass);


--
-- Name: decline_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decline_events ALTER COLUMN id SET DEFAULT nextval('public.decline_events_id_seq'::regclass);


--
-- Name: delegation_scratchpad id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delegation_scratchpad ALTER COLUMN id SET DEFAULT nextval('public.delegation_scratchpad_id_seq'::regclass);


--
-- Name: deliverable_contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverable_contracts ALTER COLUMN id SET DEFAULT nextval('public.deliverable_contracts_id_seq'::regclass);


--
-- Name: delivery_engagement id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_engagement ALTER COLUMN id SET DEFAULT nextval('public.delivery_engagement_id_seq'::regclass);


--
-- Name: delivery_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_logs ALTER COLUMN id SET DEFAULT nextval('public.delivery_logs_id_seq'::regclass);


--
-- Name: delivery_verifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_verifications ALTER COLUMN id SET DEFAULT nextval('public.delivery_verifications_id_seq'::regclass);


--
-- Name: department_budgets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_budgets ALTER COLUMN id SET DEFAULT nextval('public.department_budgets_id_seq'::regclass);


--
-- Name: doc_chunks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_chunks ALTER COLUMN id SET DEFAULT nextval('public.doc_chunks_id_seq'::regclass);


--
-- Name: doc_collections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_collections ALTER COLUMN id SET DEFAULT nextval('public.doc_collections_id_seq'::regclass);


--
-- Name: doc_heading_trees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_heading_trees ALTER COLUMN id SET DEFAULT nextval('public.doc_heading_trees_id_seq'::regclass);


--
-- Name: email_verification_codes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_codes ALTER COLUMN id SET DEFAULT nextval('public.email_verification_codes_id_seq'::regclass);


--
-- Name: eval_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs ALTER COLUMN id SET DEFAULT nextval('public.eval_runs_id_seq'::regclass);


--
-- Name: evaluator_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluator_snapshots ALTER COLUMN id SET DEFAULT nextval('public.evaluator_snapshots_id_seq'::regclass);


--
-- Name: event_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_log ALTER COLUMN id SET DEFAULT nextval('public.event_log_id_seq'::regclass);


--
-- Name: event_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.event_subscriptions_id_seq'::regclass);


--
-- Name: expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses ALTER COLUMN id SET DEFAULT nextval('public.expenses_id_seq'::regclass);


--
-- Name: experiments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiments ALTER COLUMN id SET DEFAULT nextval('public.experiments_id_seq'::regclass);


--
-- Name: express_lane_usage id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.express_lane_usage ALTER COLUMN id SET DEFAULT nextval('public.express_lane_usage_id_seq'::regclass);


--
-- Name: failure_attributions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failure_attributions ALTER COLUMN id SET DEFAULT nextval('public.failure_attributions_id_seq'::regclass);


--
-- Name: felix_loop_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.felix_loop_runs ALTER COLUMN id SET DEFAULT nextval('public.felix_loop_runs_id_seq'::regclass);


--
-- Name: felix_proposals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.felix_proposals ALTER COLUMN id SET DEFAULT nextval('public.felix_proposals_id_seq'::regclass);


--
-- Name: file_storage id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_storage ALTER COLUMN id SET DEFAULT nextval('public.file_storage_id_seq'::regclass);


--
-- Name: financial_models id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_models ALTER COLUMN id SET DEFAULT nextval('public.financial_models_id_seq'::regclass);


--
-- Name: flow_steps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_steps ALTER COLUMN id SET DEFAULT nextval('public.flow_steps_id_seq'::regclass);


--
-- Name: governance_actions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governance_actions ALTER COLUMN id SET DEFAULT nextval('public.governance_actions_id_seq'::regclass);


--
-- Name: governance_frameworks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governance_frameworks ALTER COLUMN id SET DEFAULT nextval('public.governance_frameworks_id_seq'::regclass);


--
-- Name: governance_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governance_rules ALTER COLUMN id SET DEFAULT nextval('public.governance_rules_id_seq'::regclass);


--
-- Name: graph_memory id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.graph_memory ALTER COLUMN id SET DEFAULT nextval('public.graph_memory_id_seq'::regclass);


--
-- Name: graph_memory_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.graph_memory_links ALTER COLUMN id SET DEFAULT nextval('public.graph_memory_links_id_seq'::regclass);


--
-- Name: heartbeat_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heartbeat_logs ALTER COLUMN id SET DEFAULT nextval('public.heartbeat_logs_id_seq'::regclass);


--
-- Name: heartbeat_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heartbeat_tasks ALTER COLUMN id SET DEFAULT nextval('public.heartbeat_tasks_id_seq'::regclass);


--
-- Name: hypothesis_evidence_edges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hypothesis_evidence_edges ALTER COLUMN id SET DEFAULT nextval('public.hypothesis_evidence_edges_id_seq'::regclass);


--
-- Name: inbox_classifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_classifications ALTER COLUMN id SET DEFAULT nextval('public.inbox_classifications_id_seq'::regclass);


--
-- Name: inbox_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages ALTER COLUMN id SET DEFAULT nextval('public.inbox_messages_id_seq'::regclass);


--
-- Name: invoice_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items ALTER COLUMN id SET DEFAULT nextval('public.invoice_items_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: jury_drain_ledger id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jury_drain_ledger ALTER COLUMN id SET DEFAULT nextval('public.jury_drain_ledger_id_seq'::regclass);


--
-- Name: jury_experiences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jury_experiences ALTER COLUMN id SET DEFAULT nextval('public.jury_experiences_id_seq'::regclass);


--
-- Name: knowledge_communities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_communities ALTER COLUMN id SET DEFAULT nextval('public.knowledge_communities_id_seq'::regclass);


--
-- Name: knowledge_diversity_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_diversity_snapshots ALTER COLUMN id SET DEFAULT nextval('public.knowledge_diversity_snapshots_id_seq'::regclass);


--
-- Name: knowledge_nudges id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_nudges ALTER COLUMN id SET DEFAULT nextval('public.knowledge_nudges_id_seq'::regclass);


--
-- Name: knowledge_triples id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_triples ALTER COLUMN id SET DEFAULT nextval('public.knowledge_triples_id_seq'::regclass);


--
-- Name: kpi_metrics id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_metrics ALTER COLUMN id SET DEFAULT nextval('public.kpi_metrics_id_seq'::regclass);


--
-- Name: lead_enrichments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_enrichments ALTER COLUMN id SET DEFAULT nextval('public.lead_enrichments_id_seq'::regclass);


--
-- Name: lead_scoring_rules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_scoring_rules ALTER COLUMN id SET DEFAULT nextval('public.lead_scoring_rules_id_seq'::regclass);


--
-- Name: legal_risk_reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_risk_reviews ALTER COLUMN id SET DEFAULT nextval('public.legal_risk_reviews_id_seq'::regclass);


--
-- Name: marketing_calendar id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_calendar ALTER COLUMN id SET DEFAULT nextval('public.marketing_calendar_id_seq'::regclass);


--
-- Name: marketing_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_results ALTER COLUMN id SET DEFAULT nextval('public.marketing_results_id_seq'::regclass);


--
-- Name: mcp_api_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_api_keys ALTER COLUMN id SET DEFAULT nextval('public.mcp_api_keys_id_seq'::regclass);


--
-- Name: mcp_servers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_servers ALTER COLUMN id SET DEFAULT nextval('public.mcp_servers_id_seq'::regclass);


--
-- Name: memory_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_categories ALTER COLUMN id SET DEFAULT nextval('public.memory_categories_id_seq'::regclass);


--
-- Name: memory_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_entries ALTER COLUMN id SET DEFAULT nextval('public.memory_entries_id_seq'::regclass);


--
-- Name: memory_geometry_audits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_geometry_audits ALTER COLUMN id SET DEFAULT nextval('public.memory_geometry_audits_id_seq'::regclass);


--
-- Name: memory_links id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_links ALTER COLUMN id SET DEFAULT nextval('public.memory_links_id_seq'::regclass);


--
-- Name: message_feedback id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_feedback ALTER COLUMN id SET DEFAULT nextval('public.message_feedback_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: mind_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mind_events ALTER COLUMN id SET DEFAULT nextval('public.mind_events_id_seq'::regclass);


--
-- Name: mind_tickets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mind_tickets ALTER COLUMN id SET DEFAULT nextval('public.mind_tickets_id_seq'::regclass);


--
-- Name: minds id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minds ALTER COLUMN id SET DEFAULT nextval('public.minds_id_seq'::regclass);


--
-- Name: moa_responses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moa_responses ALTER COLUMN id SET DEFAULT nextval('public.moa_responses_id_seq'::regclass);


--
-- Name: model_context_lengths id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_context_lengths ALTER COLUMN id SET DEFAULT nextval('public.model_context_lengths_id_seq'::regclass);


--
-- Name: model_harness_deltas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_harness_deltas ALTER COLUMN id SET DEFAULT nextval('public.model_harness_deltas_id_seq'::regclass);


--
-- Name: model_registry_updates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_registry_updates ALTER COLUMN id SET DEFAULT nextval('public.model_registry_updates_id_seq'::regclass);


--
-- Name: mvp_briefs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mvp_briefs ALTER COLUMN id SET DEFAULT nextval('public.mvp_briefs_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: oauth_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.oauth_subscriptions_id_seq'::regclass);


--
-- Name: orchestration_efficiency id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestration_efficiency ALTER COLUMN id SET DEFAULT nextval('public.orchestration_efficiency_id_seq'::regclass);


--
-- Name: outcome_patterns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcome_patterns ALTER COLUMN id SET DEFAULT nextval('public.outcome_patterns_id_seq'::regclass);


--
-- Name: outreach_enrollments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_enrollments ALTER COLUMN id SET DEFAULT nextval('public.outreach_enrollments_id_seq'::regclass);


--
-- Name: outreach_sequence_steps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_sequence_steps ALTER COLUMN id SET DEFAULT nextval('public.outreach_sequence_steps_id_seq'::regclass);


--
-- Name: outreach_sequences id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_sequences ALTER COLUMN id SET DEFAULT nextval('public.outreach_sequences_id_seq'::regclass);


--
-- Name: parallel_job_findings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parallel_job_findings ALTER COLUMN id SET DEFAULT nextval('public.parallel_job_findings_id_seq'::regclass);


--
-- Name: pending_deliveries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_deliveries ALTER COLUMN id SET DEFAULT nextval('public.pending_deliveries_id_seq'::regclass);


--
-- Name: personality_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personality_files ALTER COLUMN id SET DEFAULT nextval('public.personality_files_id_seq'::regclass);


--
-- Name: personas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas ALTER COLUMN id SET DEFAULT nextval('public.personas_id_seq'::regclass);


--
-- Name: pinned_hypotheses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pinned_hypotheses ALTER COLUMN id SET DEFAULT nextval('public.pinned_hypotheses_id_seq'::regclass);


--
-- Name: pipeline_stage_artifacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stage_artifacts ALTER COLUMN id SET DEFAULT nextval('public.pipeline_stage_artifacts_id_seq'::regclass);


--
-- Name: plan_nodes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_nodes ALTER COLUMN id SET DEFAULT nextval('public.plan_nodes_id_seq'::regclass);


--
-- Name: plan_replay_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_replay_cache ALTER COLUMN id SET DEFAULT nextval('public.plan_replay_cache_id_seq'::regclass);


--
-- Name: plan_rollout_simulations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_rollout_simulations ALTER COLUMN id SET DEFAULT nextval('public.plan_rollout_simulations_id_seq'::regclass);


--
-- Name: plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans ALTER COLUMN id SET DEFAULT nextval('public.plans_id_seq'::regclass);


--
-- Name: policy_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_audit ALTER COLUMN id SET DEFAULT nextval('public.policy_audit_id_seq'::regclass);


--
-- Name: presenter_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presenter_sessions ALTER COLUMN id SET DEFAULT nextval('public.presenter_sessions_id_seq'::regclass);


--
-- Name: presenter_slide_images id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presenter_slide_images ALTER COLUMN id SET DEFAULT nextval('public.presenter_slide_images_id_seq'::regclass);


--
-- Name: proactive_actions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proactive_actions ALTER COLUMN id SET DEFAULT nextval('public.proactive_actions_id_seq'::regclass);


--
-- Name: procedure_edits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procedure_edits ALTER COLUMN id SET DEFAULT nextval('public.procedure_edits_id_seq'::regclass);


--
-- Name: procedure_evolution_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procedure_evolution_runs ALTER COLUMN id SET DEFAULT nextval('public.procedure_evolution_runs_id_seq'::regclass);


--
-- Name: project_conversations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_conversations ALTER COLUMN id SET DEFAULT nextval('public.project_conversations_id_seq'::regclass);


--
-- Name: project_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_files ALTER COLUMN id SET DEFAULT nextval('public.project_files_id_seq'::regclass);


--
-- Name: project_notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_notes ALTER COLUMN id SET DEFAULT nextval('public.project_notes_id_seq'::regclass);


--
-- Name: projects id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects ALTER COLUMN id SET DEFAULT nextval('public.projects_id_seq'::regclass);


--
-- Name: proposed_skills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposed_skills ALTER COLUMN id SET DEFAULT nextval('public.proposed_skills_id_seq'::regclass);


--
-- Name: provider_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_keys ALTER COLUMN id SET DEFAULT nextval('public.provider_keys_id_seq'::regclass);


--
-- Name: repair_incidents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_incidents ALTER COLUMN id SET DEFAULT nextval('public.repair_incidents_id_seq'::regclass);


--
-- Name: repo_surgeon_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_surgeon_attempts ALTER COLUMN id SET DEFAULT nextval('public.repo_surgeon_attempts_id_seq'::regclass);


--
-- Name: research_evidence id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_evidence ALTER COLUMN id SET DEFAULT nextval('public.research_evidence_id_seq'::regclass);


--
-- Name: research_experiments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_experiments ALTER COLUMN id SET DEFAULT nextval('public.research_experiments_id_seq'::regclass);


--
-- Name: research_programs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_programs ALTER COLUMN id SET DEFAULT nextval('public.research_programs_id_seq'::regclass);


--
-- Name: research_schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_schedules ALTER COLUMN id SET DEFAULT nextval('public.research_schedules_id_seq'::regclass);


--
-- Name: research_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_sessions ALTER COLUMN id SET DEFAULT nextval('public.research_sessions_id_seq'::regclass);


--
-- Name: sandbox_improvements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_improvements ALTER COLUMN id SET DEFAULT nextval('public.sandbox_improvements_id_seq'::regclass);


--
-- Name: sandbox_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_results ALTER COLUMN id SET DEFAULT nextval('public.sandbox_results_id_seq'::regclass);


--
-- Name: sandbox_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_runs ALTER COLUMN id SET DEFAULT nextval('public.sandbox_runs_id_seq'::regclass);


--
-- Name: scheduled_posts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_posts ALTER COLUMN id SET DEFAULT nextval('public.scheduled_posts_id_seq'::regclass);


--
-- Name: scraped_pages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scraped_pages ALTER COLUMN id SET DEFAULT nextval('public.scraped_pages_id_seq'::regclass);


--
-- Name: sculptor_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sculptor_sessions ALTER COLUMN id SET DEFAULT nextval('public.sculptor_sessions_id_seq'::regclass);


--
-- Name: security_intent_checks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_intent_checks ALTER COLUMN id SET DEFAULT nextval('public.security_intent_checks_id_seq'::regclass);


--
-- Name: security_scan_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_scan_results ALTER COLUMN id SET DEFAULT nextval('public.security_scan_results_id_seq'::regclass);


--
-- Name: security_tool_blocks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_tool_blocks ALTER COLUMN id SET DEFAULT nextval('public.security_tool_blocks_id_seq'::regclass);


--
-- Name: self_heal_attempts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_heal_attempts ALTER COLUMN id SET DEFAULT nextval('public.self_heal_attempts_id_seq'::regclass);


--
-- Name: self_initiatives id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_initiatives ALTER COLUMN id SET DEFAULT nextval('public.self_initiatives_id_seq'::regclass);


--
-- Name: sentiment_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentiment_events ALTER COLUMN id SET DEFAULT nextval('public.sentiment_events_id_seq'::regclass);


--
-- Name: skill_rag_decisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_rag_decisions ALTER COLUMN id SET DEFAULT nextval('public.skill_rag_decisions_id_seq'::regclass);


--
-- Name: skills id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills ALTER COLUMN id SET DEFAULT nextval('public.skills_id_seq'::regclass);


--
-- Name: smart_enrichment_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_enrichment_reports ALTER COLUMN id SET DEFAULT nextval('public.smart_enrichment_reports_id_seq'::regclass);


--
-- Name: social_connections id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_connections ALTER COLUMN id SET DEFAULT nextval('public.social_connections_id_seq'::regclass);


--
-- Name: social_posts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts ALTER COLUMN id SET DEFAULT nextval('public.social_posts_id_seq'::regclass);


--
-- Name: sprint_contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sprint_contracts ALTER COLUMN id SET DEFAULT nextval('public.sprint_contracts_id_seq'::regclass);


--
-- Name: step_rewards id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_rewards ALTER COLUMN id SET DEFAULT nextval('public.step_rewards_id_seq'::regclass);


--
-- Name: storefront_checkout_hits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_checkout_hits ALTER COLUMN id SET DEFAULT nextval('public.storefront_checkout_hits_id_seq'::regclass);


--
-- Name: synthetic_customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synthetic_customers ALTER COLUMN id SET DEFAULT nextval('public.synthetic_customers_id_seq'::regclass);


--
-- Name: task_forces id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_forces ALTER COLUMN id SET DEFAULT nextval('public.task_forces_id_seq'::regclass);


--
-- Name: team_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members ALTER COLUMN id SET DEFAULT nextval('public.team_members_id_seq'::regclass);


--
-- Name: tenant_persona_names id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_persona_names ALTER COLUMN id SET DEFAULT nextval('public.tenant_persona_names_id_seq'::regclass);


--
-- Name: tenant_provider_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_provider_keys ALTER COLUMN id SET DEFAULT nextval('public.tenant_provider_keys_id_seq'::regclass);


--
-- Name: tenant_voice_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_voice_profiles ALTER COLUMN id SET DEFAULT nextval('public.tenant_voice_profiles_id_seq'::regclass);


--
-- Name: tenants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants ALTER COLUMN id SET DEFAULT nextval('public.tenants_id_seq'::regclass);


--
-- Name: tensions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tensions ALTER COLUMN id SET DEFAULT nextval('public.tensions_id_seq'::regclass);


--
-- Name: tool_compression_stats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_compression_stats ALTER COLUMN id SET DEFAULT nextval('public.tool_compression_stats_id_seq'::regclass);


--
-- Name: tool_optimizations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_optimizations ALTER COLUMN id SET DEFAULT nextval('public.tool_optimizations_id_seq'::regclass);


--
-- Name: tool_performance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_performance ALTER COLUMN id SET DEFAULT nextval('public.tool_performance_id_seq'::regclass);


--
-- Name: tool_policies id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_policies ALTER COLUMN id SET DEFAULT nextval('public.tool_policies_id_seq'::regclass);


--
-- Name: trust_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trust_scores ALTER COLUMN id SET DEFAULT nextval('public.trust_scores_id_seq'::regclass);


--
-- Name: usage_tracking id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_tracking ALTER COLUMN id SET DEFAULT nextval('public.usage_tracking_id_seq'::regclass);


--
-- Name: user_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles ALTER COLUMN id SET DEFAULT nextval('public.user_profiles_id_seq'::regclass);


--
-- Name: validation_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_runs ALTER COLUMN id SET DEFAULT nextval('public.validation_runs_id_seq'::regclass);


--
-- Name: venture_artifacts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_artifacts ALTER COLUMN id SET DEFAULT nextval('public.venture_artifacts_id_seq'::regclass);


--
-- Name: venture_decisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_decisions ALTER COLUMN id SET DEFAULT nextval('public.venture_decisions_id_seq'::regclass);


--
-- Name: venture_discovery_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_discovery_runs ALTER COLUMN id SET DEFAULT nextval('public.venture_discovery_runs_id_seq'::regclass);


--
-- Name: venture_ideas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_ideas ALTER COLUMN id SET DEFAULT nextval('public.venture_ideas_id_seq'::regclass);


--
-- Name: venture_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_scores ALTER COLUMN id SET DEFAULT nextval('public.venture_scores_id_seq'::regclass);


--
-- Name: video_job_frame_pool id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_job_frame_pool ALTER COLUMN id SET DEFAULT nextval('public.video_job_frame_pool_id_seq'::regclass);


--
-- Name: watchlist_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_alerts ALTER COLUMN id SET DEFAULT nextval('public.watchlist_alerts_id_seq'::regclass);


--
-- Name: watchlist_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_items ALTER COLUMN id SET DEFAULT nextval('public.watchlist_items_id_seq'::regclass);


--
-- Name: wellbeing_interventions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellbeing_interventions ALTER COLUMN id SET DEFAULT nextval('public.wellbeing_interventions_id_seq'::regclass);


--
-- Name: _sync_status id; Type: DEFAULT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe._sync_status ALTER COLUMN id SET DEFAULT nextval('stripe._sync_status_id_seq'::regclass);


--
-- Name: ab_runs ab_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_runs
    ADD CONSTRAINT ab_runs_pkey PRIMARY KEY (id);


--
-- Name: action_attempts action_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_attempts
    ADD CONSTRAINT action_attempts_pkey PRIMARY KEY (id);


--
-- Name: action_outcomes action_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_outcomes
    ADD CONSTRAINT action_outcomes_pkey PRIMARY KEY (id);


--
-- Name: action_snapshots action_snapshots_action_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_snapshots
    ADD CONSTRAINT action_snapshots_action_id_key UNIQUE (action_id);


--
-- Name: action_snapshots action_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_snapshots
    ADD CONSTRAINT action_snapshots_pkey PRIMARY KEY (id);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: agent_activity agent_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_activity
    ADD CONSTRAINT agent_activity_pkey PRIMARY KEY (id);


--
-- Name: agent_approvals agent_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_approvals
    ADD CONSTRAINT agent_approvals_pkey PRIMARY KEY (id);


--
-- Name: agent_channels agent_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_channels
    ADD CONSTRAINT agent_channels_pkey PRIMARY KEY (id);


--
-- Name: agent_channels agent_channels_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_channels
    ADD CONSTRAINT agent_channels_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: agent_cost_ledger agent_cost_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_cost_ledger
    ADD CONSTRAINT agent_cost_ledger_pkey PRIMARY KEY (id);


--
-- Name: agent_desks agent_desks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_desks
    ADD CONSTRAINT agent_desks_pkey PRIMARY KEY (id);


--
-- Name: agent_desks agent_desks_tenant_id_persona_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_desks
    ADD CONSTRAINT agent_desks_tenant_id_persona_id_key UNIQUE (tenant_id, persona_id);


--
-- Name: agent_evals agent_evals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_evals
    ADD CONSTRAINT agent_evals_pkey PRIMARY KEY (id);


--
-- Name: agent_jobs agent_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_pkey PRIMARY KEY (id);


--
-- Name: agent_knowledge agent_knowledge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_knowledge
    ADD CONSTRAINT agent_knowledge_pkey PRIMARY KEY (id);


--
-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);


--
-- Name: agent_settings agent_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_settings
    ADD CONSTRAINT agent_settings_pkey PRIMARY KEY (id);


--
-- Name: agent_trace_spans agent_trace_spans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_trace_spans
    ADD CONSTRAINT agent_trace_spans_pkey PRIMARY KEY (id);


--
-- Name: agent_trace_spans agent_trace_spans_span_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_trace_spans
    ADD CONSTRAINT agent_trace_spans_span_id_key UNIQUE (span_id);


--
-- Name: agent_wake_schedules agent_wake_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_wake_schedules
    ADD CONSTRAINT agent_wake_schedules_pkey PRIMARY KEY (id);


--
-- Name: ai_insights ai_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_insights
    ADD CONSTRAINT ai_insights_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: architecture_decisions architecture_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.architecture_decisions
    ADD CONSTRAINT architecture_decisions_pkey PRIMARY KEY (id);


--
-- Name: archive_rescue_orders archive_rescue_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.archive_rescue_orders
    ADD CONSTRAINT archive_rescue_orders_pkey PRIMARY KEY (id);


--
-- Name: audit_leads audit_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_leads
    ADD CONSTRAINT audit_leads_pkey PRIMARY KEY (id);


--
-- Name: audit_reports audit_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_reports
    ADD CONSTRAINT audit_reports_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (token);


--
-- Name: autonomous_budget_claims autonomous_budget_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autonomous_budget_claims
    ADD CONSTRAINT autonomous_budget_claims_pkey PRIMARY KEY (id);


--
-- Name: autonomy_log autonomy_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autonomy_log
    ADD CONSTRAINT autonomy_log_pkey PRIMARY KEY (id);


--
-- Name: autonomy_rules autonomy_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autonomy_rules
    ADD CONSTRAINT autonomy_rules_pkey PRIMARY KEY (id);


--
-- Name: briefing_reports briefing_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefing_reports
    ADD CONSTRAINT briefing_reports_pkey PRIMARY KEY (id);


--
-- Name: briefing_widgets briefing_widgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefing_widgets
    ADD CONSTRAINT briefing_widgets_pkey PRIMARY KEY (id);


--
-- Name: browser_workflows browser_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.browser_workflows
    ADD CONSTRAINT browser_workflows_pkey PRIMARY KEY (id);


--
-- Name: calendar_feeds calendar_feeds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_feeds
    ADD CONSTRAINT calendar_feeds_pkey PRIMARY KEY (id);


--
-- Name: capabilities capabilities_kind_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capabilities
    ADD CONSTRAINT capabilities_kind_name_key UNIQUE (kind, name);


--
-- Name: capabilities capabilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capabilities
    ADD CONSTRAINT capabilities_pkey PRIMARY KEY (id);


--
-- Name: capability_gaps capability_gaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_gaps
    ADD CONSTRAINT capability_gaps_pkey PRIMARY KEY (id);


--
-- Name: capability_reviews capability_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capability_reviews
    ADD CONSTRAINT capability_reviews_pkey PRIMARY KEY (id);


--
-- Name: causal_chains causal_chains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.causal_chains
    ADD CONSTRAINT causal_chains_pkey PRIMARY KEY (id);


--
-- Name: channel_messages channel_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_messages
    ADD CONSTRAINT channel_messages_pkey PRIMARY KEY (id);


--
-- Name: channel_subscriptions channel_subscriptions_channel_id_persona_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_subscriptions
    ADD CONSTRAINT channel_subscriptions_channel_id_persona_id_key UNIQUE (channel_id, persona_id);


--
-- Name: channel_subscriptions channel_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_subscriptions
    ADD CONSTRAINT channel_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: character_portrait_registry character_portrait_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_portrait_registry
    ADD CONSTRAINT character_portrait_registry_pkey PRIMARY KEY (id);


--
-- Name: code_health_findings code_health_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_health_findings
    ADD CONSTRAINT code_health_findings_pkey PRIMARY KEY (id);


--
-- Name: code_health_scans code_health_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_health_scans
    ADD CONSTRAINT code_health_scans_pkey PRIMARY KEY (id);


--
-- Name: code_health_scans code_health_scans_scan_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_health_scans
    ADD CONSTRAINT code_health_scans_scan_id_key UNIQUE (scan_id);


--
-- Name: code_proposals code_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.code_proposals
    ADD CONSTRAINT code_proposals_pkey PRIMARY KEY (id);


--
-- Name: commitments commitments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commitments
    ADD CONSTRAINT commitments_pkey PRIMARY KEY (id);


--
-- Name: compaction_archives compaction_archives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compaction_archives
    ADD CONSTRAINT compaction_archives_pkey PRIMARY KEY (id);


--
-- Name: competitor_changes competitor_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_changes
    ADD CONSTRAINT competitor_changes_pkey PRIMARY KEY (id);


--
-- Name: competitor_registry competitor_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_registry
    ADD CONSTRAINT competitor_registry_pkey PRIMARY KEY (id);


--
-- Name: competitor_snapshots competitor_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_snapshots
    ADD CONSTRAINT competitor_snapshots_pkey PRIMARY KEY (id);


--
-- Name: consolidation_log consolidation_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consolidation_log
    ADD CONSTRAINT consolidation_log_pkey PRIMARY KEY (id);


--
-- Name: contact_submissions contact_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_submissions
    ADD CONSTRAINT contact_submissions_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: conversation_facts conversation_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_facts
    ADD CONSTRAINT conversation_facts_pkey PRIMARY KEY (id);


--
-- Name: conversation_templates conversation_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_templates
    ADD CONSTRAINT conversation_templates_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: council_verdicts council_verdicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.council_verdicts
    ADD CONSTRAINT council_verdicts_pkey PRIMARY KEY (id);


--
-- Name: crew_agents crew_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_agents
    ADD CONSTRAINT crew_agents_pkey PRIMARY KEY (id);


--
-- Name: crew_flows crew_flows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_flows
    ADD CONSTRAINT crew_flows_pkey PRIMARY KEY (id);


--
-- Name: crew_runs crew_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_runs
    ADD CONSTRAINT crew_runs_pkey PRIMARY KEY (id);


--
-- Name: crew_tasks crew_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_tasks
    ADD CONSTRAINT crew_tasks_pkey PRIMARY KEY (id);


--
-- Name: crews crews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crews
    ADD CONSTRAINT crews_pkey PRIMARY KEY (id);


--
-- Name: custom_tools custom_tools_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_tools
    ADD CONSTRAINT custom_tools_name_unique UNIQUE (name);


--
-- Name: custom_tools custom_tools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_tools
    ADD CONSTRAINT custom_tools_pkey PRIMARY KEY (id);


--
-- Name: customer_interactions customer_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_interactions
    ADD CONSTRAINT customer_interactions_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: daily_notes daily_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_notes
    ADD CONSTRAINT daily_notes_pkey PRIMARY KEY (id);


--
-- Name: decline_events decline_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decline_events
    ADD CONSTRAINT decline_events_pkey PRIMARY KEY (id);


--
-- Name: delegation_scratchpad delegation_scratchpad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delegation_scratchpad
    ADD CONSTRAINT delegation_scratchpad_pkey PRIMARY KEY (id);


--
-- Name: deliverable_contracts deliverable_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverable_contracts
    ADD CONSTRAINT deliverable_contracts_pkey PRIMARY KEY (id);


--
-- Name: delivery_engagement delivery_engagement_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_engagement
    ADD CONSTRAINT delivery_engagement_pkey PRIMARY KEY (id);


--
-- Name: delivery_logs delivery_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_logs
    ADD CONSTRAINT delivery_logs_pkey PRIMARY KEY (id);


--
-- Name: delivery_verifications delivery_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_verifications
    ADD CONSTRAINT delivery_verifications_pkey PRIMARY KEY (id);


--
-- Name: department_budgets department_budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.department_budgets
    ADD CONSTRAINT department_budgets_pkey PRIMARY KEY (id);


--
-- Name: doc_chunks doc_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_chunks
    ADD CONSTRAINT doc_chunks_pkey PRIMARY KEY (id);


--
-- Name: doc_collections doc_collections_name_tenant_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_collections
    ADD CONSTRAINT doc_collections_name_tenant_id_unique UNIQUE (name, tenant_id);


--
-- Name: doc_collections doc_collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_collections
    ADD CONSTRAINT doc_collections_pkey PRIMARY KEY (id);


--
-- Name: doc_heading_trees doc_heading_trees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_heading_trees
    ADD CONSTRAINT doc_heading_trees_pkey PRIMARY KEY (id);


--
-- Name: email_verification_codes email_verification_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verification_codes
    ADD CONSTRAINT email_verification_codes_pkey PRIMARY KEY (id);


--
-- Name: eval_runs eval_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_pkey PRIMARY KEY (id);


--
-- Name: evaluator_snapshots evaluator_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evaluator_snapshots
    ADD CONSTRAINT evaluator_snapshots_pkey PRIMARY KEY (id);


--
-- Name: event_log event_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_log
    ADD CONSTRAINT event_log_pkey PRIMARY KEY (id);


--
-- Name: event_subscriptions event_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_subscriptions
    ADD CONSTRAINT event_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: experiments experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_pkey PRIMARY KEY (id);


--
-- Name: express_lane_usage express_lane_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.express_lane_usage
    ADD CONSTRAINT express_lane_usage_pkey PRIMARY KEY (id);


--
-- Name: failure_attributions failure_attributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failure_attributions
    ADD CONSTRAINT failure_attributions_pkey PRIMARY KEY (id);


--
-- Name: felix_loop_runs felix_loop_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.felix_loop_runs
    ADD CONSTRAINT felix_loop_runs_pkey PRIMARY KEY (id);


--
-- Name: felix_proposals felix_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.felix_proposals
    ADD CONSTRAINT felix_proposals_pkey PRIMARY KEY (id);


--
-- Name: file_storage file_storage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_storage
    ADD CONSTRAINT file_storage_pkey PRIMARY KEY (id);


--
-- Name: financial_models financial_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_models
    ADD CONSTRAINT financial_models_pkey PRIMARY KEY (id);


--
-- Name: flow_steps flow_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_steps
    ADD CONSTRAINT flow_steps_pkey PRIMARY KEY (id);


--
-- Name: governance_actions governance_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governance_actions
    ADD CONSTRAINT governance_actions_pkey PRIMARY KEY (id);


--
-- Name: governance_frameworks governance_frameworks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governance_frameworks
    ADD CONSTRAINT governance_frameworks_pkey PRIMARY KEY (id);


--
-- Name: governance_rules governance_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governance_rules
    ADD CONSTRAINT governance_rules_pkey PRIMARY KEY (id);


--
-- Name: governance_rules governance_rules_tenant_id_rule_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governance_rules
    ADD CONSTRAINT governance_rules_tenant_id_rule_name_key UNIQUE (tenant_id, rule_name);


--
-- Name: graph_memory_links graph_memory_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.graph_memory_links
    ADD CONSTRAINT graph_memory_links_pkey PRIMARY KEY (id);


--
-- Name: graph_memory graph_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.graph_memory
    ADD CONSTRAINT graph_memory_pkey PRIMARY KEY (id);


--
-- Name: heartbeat_logs heartbeat_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heartbeat_logs
    ADD CONSTRAINT heartbeat_logs_pkey PRIMARY KEY (id);


--
-- Name: heartbeat_tasks heartbeat_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heartbeat_tasks
    ADD CONSTRAINT heartbeat_tasks_pkey PRIMARY KEY (id);


--
-- Name: hypothesis_evidence_edges hypothesis_evidence_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hypothesis_evidence_edges
    ADD CONSTRAINT hypothesis_evidence_edges_pkey PRIMARY KEY (id);


--
-- Name: inbox_classifications inbox_classifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_classifications
    ADD CONSTRAINT inbox_classifications_pkey PRIMARY KEY (id);


--
-- Name: inbox_messages inbox_messages_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_message_id_key UNIQUE (message_id);


--
-- Name: inbox_messages inbox_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_pkey PRIMARY KEY (id);


--
-- Name: inbox_sender_allowlist inbox_sender_allowlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_sender_allowlist
    ADD CONSTRAINT inbox_sender_allowlist_pkey PRIMARY KEY (tenant_id, address);


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: jury_drain_ledger jury_drain_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jury_drain_ledger
    ADD CONSTRAINT jury_drain_ledger_pkey PRIMARY KEY (id);


--
-- Name: jury_experiences jury_experiences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jury_experiences
    ADD CONSTRAINT jury_experiences_pkey PRIMARY KEY (id);


--
-- Name: key_value_store key_value_store_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.key_value_store
    ADD CONSTRAINT key_value_store_pkey PRIMARY KEY (key);


--
-- Name: knowledge_communities knowledge_communities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_communities
    ADD CONSTRAINT knowledge_communities_pkey PRIMARY KEY (id);


--
-- Name: knowledge_diversity_snapshots knowledge_diversity_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_diversity_snapshots
    ADD CONSTRAINT knowledge_diversity_snapshots_pkey PRIMARY KEY (id);


--
-- Name: knowledge_nudges knowledge_nudges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_nudges
    ADD CONSTRAINT knowledge_nudges_pkey PRIMARY KEY (id);


--
-- Name: knowledge_triples knowledge_triples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_triples
    ADD CONSTRAINT knowledge_triples_pkey PRIMARY KEY (id);


--
-- Name: kpi_metrics kpi_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_metrics
    ADD CONSTRAINT kpi_metrics_pkey PRIMARY KEY (id);


--
-- Name: lead_enrichments lead_enrichments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_enrichments
    ADD CONSTRAINT lead_enrichments_pkey PRIMARY KEY (id);


--
-- Name: lead_scoring_rules lead_scoring_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_scoring_rules
    ADD CONSTRAINT lead_scoring_rules_pkey PRIMARY KEY (id);


--
-- Name: legal_risk_reviews legal_risk_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_risk_reviews
    ADD CONSTRAINT legal_risk_reviews_pkey PRIMARY KEY (id);


--
-- Name: marketing_calendar marketing_calendar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_calendar
    ADD CONSTRAINT marketing_calendar_pkey PRIMARY KEY (id);


--
-- Name: marketing_results marketing_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_results
    ADD CONSTRAINT marketing_results_pkey PRIMARY KEY (id);


--
-- Name: mcp_api_keys mcp_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_api_keys
    ADD CONSTRAINT mcp_api_keys_pkey PRIMARY KEY (id);


--
-- Name: mcp_servers mcp_servers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mcp_servers
    ADD CONSTRAINT mcp_servers_pkey PRIMARY KEY (id);


--
-- Name: memory_categories memory_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_categories
    ADD CONSTRAINT memory_categories_pkey PRIMARY KEY (id);


--
-- Name: memory_entries memory_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_entries
    ADD CONSTRAINT memory_entries_pkey PRIMARY KEY (id);


--
-- Name: memory_geometry_audits memory_geometry_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_geometry_audits
    ADD CONSTRAINT memory_geometry_audits_pkey PRIMARY KEY (id);


--
-- Name: memory_links memory_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_links
    ADD CONSTRAINT memory_links_pkey PRIMARY KEY (id);


--
-- Name: message_feedback message_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_feedback
    ADD CONSTRAINT message_feedback_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: mind_events mind_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mind_events
    ADD CONSTRAINT mind_events_pkey PRIMARY KEY (id);


--
-- Name: mind_tickets mind_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mind_tickets
    ADD CONSTRAINT mind_tickets_pkey PRIMARY KEY (id);


--
-- Name: minds minds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.minds
    ADD CONSTRAINT minds_pkey PRIMARY KEY (id);


--
-- Name: moa_responses moa_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moa_responses
    ADD CONSTRAINT moa_responses_pkey PRIMARY KEY (id);


--
-- Name: model_context_lengths model_context_lengths_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_context_lengths
    ADD CONSTRAINT model_context_lengths_pkey PRIMARY KEY (id);


--
-- Name: model_harness_deltas model_harness_deltas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_harness_deltas
    ADD CONSTRAINT model_harness_deltas_pkey PRIMARY KEY (id);


--
-- Name: model_registry_updates model_registry_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_registry_updates
    ADD CONSTRAINT model_registry_updates_pkey PRIMARY KEY (id);


--
-- Name: mvp_briefs mvp_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mvp_briefs
    ADD CONSTRAINT mvp_briefs_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: oauth_subscriptions oauth_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_subscriptions
    ADD CONSTRAINT oauth_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: oauth_subscriptions oauth_subscriptions_provider_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_subscriptions
    ADD CONSTRAINT oauth_subscriptions_provider_tenant_id_key UNIQUE (provider, tenant_id);


--
-- Name: orchestration_efficiency orchestration_efficiency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestration_efficiency
    ADD CONSTRAINT orchestration_efficiency_pkey PRIMARY KEY (id);


--
-- Name: order_lookup_codes order_lookup_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_lookup_codes
    ADD CONSTRAINT order_lookup_codes_pkey PRIMARY KEY (email);


--
-- Name: outcome_patterns outcome_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcome_patterns
    ADD CONSTRAINT outcome_patterns_pkey PRIMARY KEY (id);


--
-- Name: outreach_enrollments outreach_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_enrollments
    ADD CONSTRAINT outreach_enrollments_pkey PRIMARY KEY (id);


--
-- Name: outreach_sequence_steps outreach_sequence_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_sequence_steps
    ADD CONSTRAINT outreach_sequence_steps_pkey PRIMARY KEY (id);


--
-- Name: outreach_sequences outreach_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_sequences
    ADD CONSTRAINT outreach_sequences_pkey PRIMARY KEY (id);


--
-- Name: parallel_job_findings parallel_job_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parallel_job_findings
    ADD CONSTRAINT parallel_job_findings_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (token);


--
-- Name: pending_deliveries pending_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_deliveries
    ADD CONSTRAINT pending_deliveries_pkey PRIMARY KEY (id);


--
-- Name: personality_files personality_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personality_files
    ADD CONSTRAINT personality_files_pkey PRIMARY KEY (id);


--
-- Name: personality_files personality_files_tenant_id_persona_id_file_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personality_files
    ADD CONSTRAINT personality_files_tenant_id_persona_id_file_type_key UNIQUE (tenant_id, persona_id, file_type);


--
-- Name: personas personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personas
    ADD CONSTRAINT personas_pkey PRIMARY KEY (id);


--
-- Name: pinned_hypotheses pinned_hypotheses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pinned_hypotheses
    ADD CONSTRAINT pinned_hypotheses_pkey PRIMARY KEY (id);


--
-- Name: pipeline_stage_artifacts pipeline_stage_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stage_artifacts
    ADD CONSTRAINT pipeline_stage_artifacts_pkey PRIMARY KEY (id);


--
-- Name: plan_nodes plan_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_nodes
    ADD CONSTRAINT plan_nodes_pkey PRIMARY KEY (id);


--
-- Name: plan_nodes plan_nodes_tenant_id_plan_id_node_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_nodes
    ADD CONSTRAINT plan_nodes_tenant_id_plan_id_node_id_key UNIQUE (tenant_id, plan_id, node_id);


--
-- Name: plan_replay_cache plan_replay_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_replay_cache
    ADD CONSTRAINT plan_replay_cache_pkey PRIMARY KEY (id);


--
-- Name: plan_rollout_simulations plan_rollout_simulations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_rollout_simulations
    ADD CONSTRAINT plan_rollout_simulations_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: policy_audit policy_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_audit
    ADD CONSTRAINT policy_audit_pkey PRIMARY KEY (id);


--
-- Name: presenter_sessions presenter_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presenter_sessions
    ADD CONSTRAINT presenter_sessions_pkey PRIMARY KEY (id);


--
-- Name: presenter_slide_images presenter_slide_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presenter_slide_images
    ADD CONSTRAINT presenter_slide_images_pkey PRIMARY KEY (id);


--
-- Name: presenter_slide_images presenter_slide_images_session_id_slide_index_quality_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presenter_slide_images
    ADD CONSTRAINT presenter_slide_images_session_id_slide_index_quality_key UNIQUE (session_id, slide_index, quality);


--
-- Name: proactive_actions proactive_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proactive_actions
    ADD CONSTRAINT proactive_actions_pkey PRIMARY KEY (id);


--
-- Name: procedure_edits procedure_edits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procedure_edits
    ADD CONSTRAINT procedure_edits_pkey PRIMARY KEY (id);


--
-- Name: procedure_evolution_runs procedure_evolution_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.procedure_evolution_runs
    ADD CONSTRAINT procedure_evolution_runs_pkey PRIMARY KEY (id);


--
-- Name: project_conversations project_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_conversations
    ADD CONSTRAINT project_conversations_pkey PRIMARY KEY (id);


--
-- Name: project_files project_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_files
    ADD CONSTRAINT project_files_pkey PRIMARY KEY (id);


--
-- Name: project_notes project_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_notes
    ADD CONSTRAINT project_notes_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: proposed_skills proposed_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proposed_skills
    ADD CONSTRAINT proposed_skills_pkey PRIMARY KEY (id);


--
-- Name: provider_keys provider_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_keys
    ADD CONSTRAINT provider_keys_pkey PRIMARY KEY (id);


--
-- Name: provider_keys provider_keys_provider_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provider_keys
    ADD CONSTRAINT provider_keys_provider_unique UNIQUE (provider);


--
-- Name: repair_incidents repair_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repair_incidents
    ADD CONSTRAINT repair_incidents_pkey PRIMARY KEY (id);


--
-- Name: repo_surgeon_attempts repo_surgeon_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repo_surgeon_attempts
    ADD CONSTRAINT repo_surgeon_attempts_pkey PRIMARY KEY (id);


--
-- Name: research_evidence research_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_evidence
    ADD CONSTRAINT research_evidence_pkey PRIMARY KEY (id);


--
-- Name: research_experiments research_experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_experiments
    ADD CONSTRAINT research_experiments_pkey PRIMARY KEY (id);


--
-- Name: research_programs research_programs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_programs
    ADD CONSTRAINT research_programs_pkey PRIMARY KEY (id);


--
-- Name: research_schedules research_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_schedules
    ADD CONSTRAINT research_schedules_pkey PRIMARY KEY (id);


--
-- Name: research_sessions research_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_sessions
    ADD CONSTRAINT research_sessions_pkey PRIMARY KEY (id);


--
-- Name: sandbox_improvements sandbox_improvements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_improvements
    ADD CONSTRAINT sandbox_improvements_pkey PRIMARY KEY (id);


--
-- Name: sandbox_results sandbox_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_results
    ADD CONSTRAINT sandbox_results_pkey PRIMARY KEY (id);


--
-- Name: sandbox_runs sandbox_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_runs
    ADD CONSTRAINT sandbox_runs_pkey PRIMARY KEY (id);


--
-- Name: scheduled_posts scheduled_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_posts
    ADD CONSTRAINT scheduled_posts_pkey PRIMARY KEY (id);


--
-- Name: scraped_pages scraped_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scraped_pages
    ADD CONSTRAINT scraped_pages_pkey PRIMARY KEY (id);


--
-- Name: sculptor_sessions sculptor_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sculptor_sessions
    ADD CONSTRAINT sculptor_sessions_pkey PRIMARY KEY (id);


--
-- Name: security_intent_checks security_intent_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_intent_checks
    ADD CONSTRAINT security_intent_checks_pkey PRIMARY KEY (id);


--
-- Name: security_scan_results security_scan_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_scan_results
    ADD CONSTRAINT security_scan_results_pkey PRIMARY KEY (id);


--
-- Name: security_tool_blocks security_tool_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_tool_blocks
    ADD CONSTRAINT security_tool_blocks_pkey PRIMARY KEY (id);


--
-- Name: self_heal_attempts self_heal_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_heal_attempts
    ADD CONSTRAINT self_heal_attempts_pkey PRIMARY KEY (id);


--
-- Name: self_initiatives self_initiatives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.self_initiatives
    ADD CONSTRAINT self_initiatives_pkey PRIMARY KEY (id);


--
-- Name: sentiment_events sentiment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sentiment_events
    ADD CONSTRAINT sentiment_events_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: skill_rag_decisions skill_rag_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skill_rag_decisions
    ADD CONSTRAINT skill_rag_decisions_pkey PRIMARY KEY (id);


--
-- Name: skills skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (id);


--
-- Name: smart_enrichment_reports smart_enrichment_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.smart_enrichment_reports
    ADD CONSTRAINT smart_enrichment_reports_pkey PRIMARY KEY (id);


--
-- Name: social_connections social_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_connections
    ADD CONSTRAINT social_connections_pkey PRIMARY KEY (id);


--
-- Name: social_connections social_connections_tenant_id_platform_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_connections
    ADD CONSTRAINT social_connections_tenant_id_platform_key UNIQUE (tenant_id, platform);


--
-- Name: social_posts social_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_pkey PRIMARY KEY (id);


--
-- Name: sprint_contracts sprint_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sprint_contracts
    ADD CONSTRAINT sprint_contracts_pkey PRIMARY KEY (id);


--
-- Name: step_rewards step_rewards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.step_rewards
    ADD CONSTRAINT step_rewards_pkey PRIMARY KEY (id);


--
-- Name: storefront_checkout_hits storefront_checkout_hits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storefront_checkout_hits
    ADD CONSTRAINT storefront_checkout_hits_pkey PRIMARY KEY (id);


--
-- Name: synthetic_customers synthetic_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synthetic_customers
    ADD CONSTRAINT synthetic_customers_pkey PRIMARY KEY (id);


--
-- Name: task_forces task_forces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_forces
    ADD CONSTRAINT task_forces_pkey PRIMARY KEY (id);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: tenant_persona_names tenant_persona_names_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_persona_names
    ADD CONSTRAINT tenant_persona_names_pkey PRIMARY KEY (id);


--
-- Name: tenant_provider_keys tenant_provider_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_provider_keys
    ADD CONSTRAINT tenant_provider_keys_pkey PRIMARY KEY (id);


--
-- Name: tenant_provider_keys tenant_provider_keys_tenant_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_provider_keys
    ADD CONSTRAINT tenant_provider_keys_tenant_id_provider_key UNIQUE (tenant_id, provider);


--
-- Name: tenant_voice_profiles tenant_voice_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_voice_profiles
    ADD CONSTRAINT tenant_voice_profiles_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_email_unique UNIQUE (email);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_public_chat_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_public_chat_token_unique UNIQUE (public_chat_token);


--
-- Name: tenants tenants_replit_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_replit_user_id_unique UNIQUE (replit_user_id);


--
-- Name: tenants tenants_vanity_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_vanity_slug_unique UNIQUE (vanity_slug);


--
-- Name: tensions tensions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tensions
    ADD CONSTRAINT tensions_pkey PRIMARY KEY (id);


--
-- Name: tool_compression_stats tool_compression_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_compression_stats
    ADD CONSTRAINT tool_compression_stats_pkey PRIMARY KEY (id);


--
-- Name: tool_optimizations tool_optimizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_optimizations
    ADD CONSTRAINT tool_optimizations_pkey PRIMARY KEY (id);


--
-- Name: tool_performance tool_performance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_performance
    ADD CONSTRAINT tool_performance_pkey PRIMARY KEY (id);


--
-- Name: tool_policies tool_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_policies
    ADD CONSTRAINT tool_policies_pkey PRIMARY KEY (id);


--
-- Name: trust_scores trust_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trust_scores
    ADD CONSTRAINT trust_scores_pkey PRIMARY KEY (id);


--
-- Name: trust_scores trust_scores_tenant_persona_category_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trust_scores
    ADD CONSTRAINT trust_scores_tenant_persona_category_uniq UNIQUE (tenant_id, persona_id, category);


--
-- Name: usage_tracking usage_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT usage_tracking_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: validation_runs validation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_runs
    ADD CONSTRAINT validation_runs_pkey PRIMARY KEY (id);


--
-- Name: venture_artifacts venture_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_artifacts
    ADD CONSTRAINT venture_artifacts_pkey PRIMARY KEY (id);


--
-- Name: venture_decisions venture_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_decisions
    ADD CONSTRAINT venture_decisions_pkey PRIMARY KEY (id);


--
-- Name: venture_discovery_runs venture_discovery_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_discovery_runs
    ADD CONSTRAINT venture_discovery_runs_pkey PRIMARY KEY (id);


--
-- Name: venture_ideas venture_ideas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_ideas
    ADD CONSTRAINT venture_ideas_pkey PRIMARY KEY (id);


--
-- Name: venture_scores venture_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_scores
    ADD CONSTRAINT venture_scores_pkey PRIMARY KEY (id);


--
-- Name: video_job_frame_pool video_job_frame_pool_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_job_frame_pool
    ADD CONSTRAINT video_job_frame_pool_pkey PRIMARY KEY (id);


--
-- Name: video_jobs video_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_jobs
    ADD CONSTRAINT video_jobs_pkey PRIMARY KEY (job_id);


--
-- Name: watchlist_alerts watchlist_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_alerts
    ADD CONSTRAINT watchlist_alerts_pkey PRIMARY KEY (id);


--
-- Name: watchlist_items watchlist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_items
    ADD CONSTRAINT watchlist_items_pkey PRIMARY KEY (id);


--
-- Name: watchlist_items watchlist_items_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_items
    ADD CONSTRAINT watchlist_items_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (provider, event_id);


--
-- Name: wellbeing_interventions wellbeing_interventions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wellbeing_interventions
    ADD CONSTRAINT wellbeing_interventions_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_auth whatsapp_auth_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_auth
    ADD CONSTRAINT whatsapp_auth_pkey PRIMARY KEY (key);


--
-- Name: _migrations _migrations_name_key; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe._migrations
    ADD CONSTRAINT _migrations_name_key UNIQUE (name);


--
-- Name: _migrations _migrations_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe._migrations
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (id);


--
-- Name: _sync_status _sync_status_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe._sync_status
    ADD CONSTRAINT _sync_status_pkey PRIMARY KEY (id);


--
-- Name: _sync_status _sync_status_resource_account_key; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe._sync_status
    ADD CONSTRAINT _sync_status_resource_account_key UNIQUE (resource, account_id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: active_entitlements active_entitlements_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.active_entitlements
    ADD CONSTRAINT active_entitlements_pkey PRIMARY KEY (id);


--
-- Name: charges charges_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.charges
    ADD CONSTRAINT charges_pkey PRIMARY KEY (id);


--
-- Name: checkout_session_line_items checkout_session_line_items_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.checkout_session_line_items
    ADD CONSTRAINT checkout_session_line_items_pkey PRIMARY KEY (id);


--
-- Name: checkout_sessions checkout_sessions_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.checkout_sessions
    ADD CONSTRAINT checkout_sessions_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: credit_notes credit_notes_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.credit_notes
    ADD CONSTRAINT credit_notes_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: disputes disputes_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.disputes
    ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);


--
-- Name: early_fraud_warnings early_fraud_warnings_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.early_fraud_warnings
    ADD CONSTRAINT early_fraud_warnings_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: features features_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.features
    ADD CONSTRAINT features_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: _managed_webhooks managed_webhooks_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe._managed_webhooks
    ADD CONSTRAINT managed_webhooks_pkey PRIMARY KEY (id);


--
-- Name: _managed_webhooks managed_webhooks_url_account_unique; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe._managed_webhooks
    ADD CONSTRAINT managed_webhooks_url_account_unique UNIQUE (url, account_id);


--
-- Name: payment_intents payment_intents_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.payment_intents
    ADD CONSTRAINT payment_intents_pkey PRIMARY KEY (id);


--
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);


--
-- Name: payouts payouts_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.payouts
    ADD CONSTRAINT payouts_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: prices prices_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.prices
    ADD CONSTRAINT prices_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: setup_intents setup_intents_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.setup_intents
    ADD CONSTRAINT setup_intents_pkey PRIMARY KEY (id);


--
-- Name: subscription_items subscription_items_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.subscription_items
    ADD CONSTRAINT subscription_items_pkey PRIMARY KEY (id);


--
-- Name: subscription_schedules subscription_schedules_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.subscription_schedules
    ADD CONSTRAINT subscription_schedules_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: tax_ids tax_ids_pkey; Type: CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.tax_ids
    ADD CONSTRAINT tax_ids_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.sessions USING btree (expire);


--
-- Name: ab_runs_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ab_runs_tenant_created_idx ON public.ab_runs USING btree (tenant_id, created_at DESC);


--
-- Name: action_snapshots_tenant_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_snapshots_tenant_pending_idx ON public.action_snapshots USING btree (tenant_id, created_at DESC) WHERE (undone_at IS NULL);


--
-- Name: agent_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_jobs_claim_idx ON public.agent_jobs USING btree (status, next_run_at) WHERE (status = 'pending'::text);


--
-- Name: agent_jobs_failure_class_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_jobs_failure_class_idx ON public.agent_jobs USING btree (failure_class, created_at DESC) WHERE (failure_class IS NOT NULL);


--
-- Name: agent_jobs_kind_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_jobs_kind_status_idx ON public.agent_jobs USING btree (kind, status, created_at DESC);


--
-- Name: agent_jobs_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_jobs_lease_idx ON public.agent_jobs USING btree (status, lease_until) WHERE (status = 'running'::text);


--
-- Name: agent_jobs_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_jobs_tenant_idx ON public.agent_jobs USING btree (tenant_id, created_at DESC);


--
-- Name: agent_knowledge_tsv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_knowledge_tsv_idx ON public.agent_knowledge USING gin (tsv);


--
-- Name: agent_runs_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_runs_parent_idx ON public.agent_runs USING btree (parent_run_id);


--
-- Name: agent_runs_tenant_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_runs_tenant_status_idx ON public.agent_runs USING btree (tenant_id, status);


--
-- Name: agent_trace_spans_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_trace_spans_recent_idx ON public.agent_trace_spans USING btree (tenant_id, started_at DESC);


--
-- Name: agent_trace_spans_trace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_trace_spans_trace_idx ON public.agent_trace_spans USING btree (tenant_id, trace_id, started_at);


--
-- Name: autonomous_budget_claims_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX autonomous_budget_claims_tenant_created_idx ON public.autonomous_budget_claims USING btree (tenant_id, created_at);


--
-- Name: autonomy_rules_ta_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX autonomy_rules_ta_uq ON public.autonomy_rules USING btree (tenant_id, action_type) WHERE (persona_id IS NULL);


--
-- Name: autonomy_rules_tpa_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX autonomy_rules_tpa_uq ON public.autonomy_rules USING btree (tenant_id, persona_id, action_type) WHERE (persona_id IS NOT NULL);


--
-- Name: character_portrait_registry_tenant_id_view_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX character_portrait_registry_tenant_id_view_uq ON public.character_portrait_registry USING btree (tenant_id, identifier, view);


--
-- Name: code_health_findings_scan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX code_health_findings_scan_idx ON public.code_health_findings USING btree (scan_id);


--
-- Name: code_health_findings_severity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX code_health_findings_severity_idx ON public.code_health_findings USING btree (severity);


--
-- Name: commitments_draft_status_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commitments_draft_status_due_idx ON public.commitments USING btree (draft_status, due_at) WHERE (due_at IS NOT NULL);


--
-- Name: commitments_tenant_dedupe_active_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX commitments_tenant_dedupe_active_uidx ON public.commitments USING btree (tenant_id, dedupe_key) WHERE ((dedupe_key IS NOT NULL) AND ((status)::text = ANY ((ARRAY['active'::character varying, 'escalated'::character varying])::text[])));


--
-- Name: commitments_tenant_status_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commitments_tenant_status_due_idx ON public.commitments USING btree (tenant_id, status, due_at);


--
-- Name: delivery_engagement_delivery_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_engagement_delivery_id_idx ON public.delivery_engagement USING btree (delivery_id);


--
-- Name: delivery_engagement_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_engagement_tenant_id_idx ON public.delivery_engagement USING btree (tenant_id);


--
-- Name: delivery_logs_customer_email_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_logs_customer_email_lower_idx ON public.delivery_logs USING btree (lower(customer_email));


--
-- Name: delivery_logs_order_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_logs_order_id_idx ON public.delivery_logs USING btree (order_id);


--
-- Name: delivery_logs_stripe_payment_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_logs_stripe_payment_id_idx ON public.delivery_logs USING btree (stripe_payment_id);


--
-- Name: delivery_logs_stripe_payment_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX delivery_logs_stripe_payment_id_unique ON public.delivery_logs USING btree (stripe_payment_id) WHERE (stripe_payment_id IS NOT NULL);


--
-- Name: delivery_logs_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delivery_logs_tenant_id_idx ON public.delivery_logs USING btree (tenant_id);


--
-- Name: doc_heading_trees_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX doc_heading_trees_tenant ON public.doc_heading_trees USING btree (tenant_id);


--
-- Name: doc_heading_trees_unique_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX doc_heading_trees_unique_doc ON public.doc_heading_trees USING btree (collection_id, doc_path, tenant_id);


--
-- Name: idx_action_attempts_idem_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_attempts_idem_key ON public.action_attempts USING btree (idempotency_key);


--
-- Name: idx_action_attempts_tenant_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_attempts_tenant_state ON public.action_attempts USING btree (tenant_id, state);


--
-- Name: idx_action_outcomes_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_outcomes_persona ON public.action_outcomes USING btree (persona_id, action_type);


--
-- Name: idx_action_outcomes_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_action_outcomes_tenant ON public.action_outcomes USING btree (tenant_id, outcome_status);


--
-- Name: idx_activity_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_log_tenant ON public.activity_log USING btree (tenant_id, created_at DESC);


--
-- Name: idx_adrs_supersedes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adrs_supersedes ON public.architecture_decisions USING btree (supersedes);


--
-- Name: idx_adrs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adrs_tenant ON public.architecture_decisions USING btree (tenant_id);


--
-- Name: idx_adrs_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adrs_tenant_status ON public.architecture_decisions USING btree (tenant_id, status);


--
-- Name: idx_agent_activity_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_activity_created ON public.agent_activity USING btree (created_at DESC);


--
-- Name: idx_agent_activity_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_activity_persona ON public.agent_activity USING btree (persona_id);


--
-- Name: idx_agent_activity_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_activity_status ON public.agent_activity USING btree (status);


--
-- Name: idx_agent_activity_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_activity_tenant ON public.agent_activity USING btree (tenant_id);


--
-- Name: idx_agent_approvals_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_approvals_run ON public.agent_approvals USING btree (run_id);


--
-- Name: idx_agent_approvals_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_approvals_tenant_status ON public.agent_approvals USING btree (tenant_id, status);


--
-- Name: idx_agent_channels_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_channels_tenant ON public.agent_channels USING btree (tenant_id);


--
-- Name: idx_agent_desks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_desks_tenant ON public.agent_desks USING btree (tenant_id);


--
-- Name: idx_agent_knowledge_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_knowledge_category ON public.agent_knowledge USING btree (category);


--
-- Name: idx_agent_knowledge_persona_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_knowledge_persona_id ON public.agent_knowledge USING btree (persona_id);


--
-- Name: idx_agent_knowledge_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_knowledge_tenant_id ON public.agent_knowledge USING btree (tenant_id);


--
-- Name: idx_agent_knowledge_tenant_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_knowledge_tenant_source ON public.agent_knowledge USING btree (tenant_id, source);


--
-- Name: idx_agent_trace_spans_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_trace_spans_started_at ON public.agent_trace_spans USING btree (started_at DESC);


--
-- Name: idx_agent_trace_spans_tool_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_trace_spans_tool_started ON public.agent_trace_spans USING btree (tool_name, started_at DESC) WHERE (tool_name IS NOT NULL);


--
-- Name: idx_ai_insights_engine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_insights_engine ON public.ai_insights USING btree (engine_type);


--
-- Name: idx_ai_insights_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_insights_tenant ON public.ai_insights USING btree (tenant_id);


--
-- Name: idx_api_keys_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_hash ON public.api_keys USING btree (key_hash) WHERE (NOT is_revoked);


--
-- Name: idx_api_keys_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_tenant ON public.api_keys USING btree (tenant_id, is_revoked);


--
-- Name: idx_archive_rescue_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_archive_rescue_email ON public.archive_rescue_orders USING btree (contact_email);


--
-- Name: idx_archive_rescue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_archive_rescue_status ON public.archive_rescue_orders USING btree (status, created_at);


--
-- Name: idx_archive_rescue_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_archive_rescue_tenant_created ON public.archive_rescue_orders USING btree (tenant_id, created_at);


--
-- Name: idx_audit_leads_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_leads_email ON public.audit_leads USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_audit_leads_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_leads_kind ON public.audit_leads USING btree (kind, created_at DESC);


--
-- Name: idx_audit_leads_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_leads_tenant_created ON public.audit_leads USING btree (tenant_id, created_at DESC);


--
-- Name: idx_audit_reports_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_reports_score ON public.audit_reports USING btree (overall_score);


--
-- Name: idx_audit_reports_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_reports_tenant_created ON public.audit_reports USING btree (tenant_id, created_at);


--
-- Name: idx_auth_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_expires ON public.auth_sessions USING btree (expires_at);


--
-- Name: idx_auth_sessions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_tenant ON public.auth_sessions USING btree (tenant_id);


--
-- Name: idx_auth_sessions_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_sessions_tenant_id ON public.auth_sessions USING btree (tenant_id);


--
-- Name: idx_autonomy_log_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autonomy_log_persona ON public.autonomy_log USING btree (persona_id, action_type);


--
-- Name: idx_autonomy_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autonomy_log_tenant ON public.autonomy_log USING btree (tenant_id, created_at);


--
-- Name: idx_autonomy_rules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autonomy_rules_tenant ON public.autonomy_rules USING btree (tenant_id, action_type);


--
-- Name: idx_cap_review_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cap_review_tenant_created ON public.capability_reviews USING btree (tenant_id, created_at);


--
-- Name: idx_capabilities_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capabilities_active ON public.capabilities USING btree (is_active);


--
-- Name: idx_capabilities_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capabilities_kind ON public.capabilities USING btree (kind);


--
-- Name: idx_capability_gaps_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_capability_gaps_dedup ON public.capability_gaps USING btree (tenant_id, gap_description) WHERE (status <> ALL (ARRAY['resolved'::text, 'safety_blocked'::text]));


--
-- Name: idx_capability_gaps_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capability_gaps_status ON public.capability_gaps USING btree (status);


--
-- Name: idx_capability_gaps_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capability_gaps_tenant ON public.capability_gaps USING btree (tenant_id);


--
-- Name: idx_cc_cause; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cc_cause ON public.causal_chains USING btree (tenant_id, cause_subject);


--
-- Name: idx_cc_effect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cc_effect ON public.causal_chains USING btree (tenant_id, effect_subject);


--
-- Name: idx_cc_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cc_tenant ON public.causal_chains USING btree (tenant_id);


--
-- Name: idx_channel_messages_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_messages_channel ON public.channel_messages USING btree (channel_id, created_at);


--
-- Name: idx_channel_messages_channel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_messages_channel_id ON public.channel_messages USING btree (channel_id);


--
-- Name: idx_channel_messages_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_messages_tenant_id ON public.channel_messages USING btree (tenant_id);


--
-- Name: idx_channel_messages_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_messages_thread ON public.channel_messages USING btree (thread_id);


--
-- Name: idx_channel_subs_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_subs_channel ON public.channel_subscriptions USING btree (channel_id);


--
-- Name: idx_channel_subs_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_subs_persona ON public.channel_subscriptions USING btree (persona_id);


--
-- Name: idx_code_proposals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_code_proposals_status ON public.code_proposals USING btree (status);


--
-- Name: idx_code_proposals_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_code_proposals_tenant ON public.code_proposals USING btree (tenant_id);


--
-- Name: idx_compaction_archives_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compaction_archives_conversation_id ON public.compaction_archives USING btree (conversation_id);


--
-- Name: idx_compaction_archives_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compaction_archives_tenant_id ON public.compaction_archives USING btree (tenant_id);


--
-- Name: idx_competitor_changes_comp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_changes_comp ON public.competitor_changes USING btree (competitor_id);


--
-- Name: idx_competitor_changes_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_changes_tenant ON public.competitor_changes USING btree (tenant_id);


--
-- Name: idx_competitor_registry_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_registry_tenant ON public.competitor_registry USING btree (tenant_id);


--
-- Name: idx_competitor_snapshots_comp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_snapshots_comp ON public.competitor_snapshots USING btree (competitor_id);


--
-- Name: idx_competitor_snapshots_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_snapshots_tenant ON public.competitor_snapshots USING btree (tenant_id);


--
-- Name: idx_contracts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_tenant ON public.contracts USING btree (tenant_id);


--
-- Name: idx_conv_facts_conv_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_facts_conv_status ON public.conversation_facts USING btree (conversation_id, status);


--
-- Name: idx_conv_facts_status_refcount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_facts_status_refcount ON public.conversation_facts USING btree (status, ref_count) WHERE (status = 'active'::text);


--
-- Name: idx_conv_facts_tenant_lastref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_facts_tenant_lastref ON public.conversation_facts USING btree (tenant_id, last_referenced_at DESC);


--
-- Name: idx_conversations_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_created_at ON public.conversations USING btree (created_at DESC);


--
-- Name: idx_conversations_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_deleted ON public.conversations USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_conversations_persona_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_persona_id ON public.conversations USING btree (persona_id);


--
-- Name: idx_conversations_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_project_id ON public.conversations USING btree (project_id);


--
-- Name: idx_conversations_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_tenant_id ON public.conversations USING btree (tenant_id);


--
-- Name: idx_conversations_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_updated_at ON public.conversations USING btree (updated_at DESC) WHERE (persona_id IS NOT NULL);


--
-- Name: idx_cost_ledger_dept; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_ledger_dept ON public.agent_cost_ledger USING btree (tenant_id, department, created_at);


--
-- Name: idx_cost_ledger_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_ledger_run ON public.agent_cost_ledger USING btree (run_id);


--
-- Name: idx_cost_ledger_tenant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_ledger_tenant_date ON public.agent_cost_ledger USING btree (tenant_id, created_at DESC);


--
-- Name: idx_council_verdicts_tenant_edit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_council_verdicts_tenant_edit ON public.council_verdicts USING btree (tenant_id, procedure_edit_id, requested_at DESC);


--
-- Name: idx_council_verdicts_tenant_verdict; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_council_verdicts_tenant_verdict ON public.council_verdicts USING btree (tenant_id, verdict, completed_at DESC);


--
-- Name: idx_council_verdicts_track_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_council_verdicts_track_record ON public.council_verdicts USING btree (tenant_id, agreed_with_council, final_decided_at DESC) WHERE (final_decision IS NOT NULL);


--
-- Name: idx_cpr_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpr_tenant ON public.character_portrait_registry USING btree (tenant_id);


--
-- Name: idx_cpr_tenant_identifier_view; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cpr_tenant_identifier_view ON public.character_portrait_registry USING btree (tenant_id, identifier, view);


--
-- Name: idx_crew_agents_crew; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_agents_crew ON public.crew_agents USING btree (crew_id);


--
-- Name: idx_crew_flows_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_flows_tenant ON public.crew_flows USING btree (tenant_id);


--
-- Name: idx_crew_runs_crew; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_runs_crew ON public.crew_runs USING btree (crew_id);


--
-- Name: idx_crew_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_runs_status ON public.crew_runs USING btree (status);


--
-- Name: idx_crew_tasks_crew; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_tasks_crew ON public.crew_tasks USING btree (crew_id);


--
-- Name: idx_crews_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crews_tenant ON public.crews USING btree (tenant_id);


--
-- Name: idx_customers_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_stage ON public.customers USING btree (deal_stage);


--
-- Name: idx_customers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_tenant ON public.customers USING btree (tenant_id);


--
-- Name: idx_daily_notes_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_notes_date ON public.daily_notes USING btree (date);


--
-- Name: idx_daily_notes_persona_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_notes_persona_id ON public.daily_notes USING btree (persona_id);


--
-- Name: idx_daily_notes_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_notes_tenant_id ON public.daily_notes USING btree (tenant_id);


--
-- Name: idx_decline_events_persona_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_decline_events_persona_reason ON public.decline_events USING btree (persona_id, reason);


--
-- Name: idx_decline_events_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_decline_events_source ON public.decline_events USING btree (source);


--
-- Name: idx_decline_events_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_decline_events_tenant_created ON public.decline_events USING btree (tenant_id, created_at DESC);


--
-- Name: idx_dept_budget_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_dept_budget_uniq ON public.department_budgets USING btree (tenant_id, department, period_start);


--
-- Name: idx_doc_chunks_collection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_chunks_collection ON public.doc_chunks USING btree (collection_id);


--
-- Name: idx_doc_chunks_collection_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_chunks_collection_id ON public.doc_chunks USING btree (collection_id);


--
-- Name: idx_doc_chunks_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_chunks_path ON public.doc_chunks USING btree (doc_path, collection_id);


--
-- Name: idx_doc_chunks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_chunks_tenant ON public.doc_chunks USING btree (tenant_id);


--
-- Name: idx_doc_chunks_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_chunks_tenant_id ON public.doc_chunks USING btree (tenant_id);


--
-- Name: idx_dv_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dv_status ON public.delivery_verifications USING btree (status);


--
-- Name: idx_dv_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dv_tenant ON public.delivery_verifications USING btree (tenant_id, verified_at);


--
-- Name: idx_eval_runs_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_runs_tenant_created ON public.eval_runs USING btree (tenant_id, created_at);


--
-- Name: idx_evals_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evals_task ON public.agent_evals USING btree (task_name, persona_id);


--
-- Name: idx_evals_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evals_tenant ON public.agent_evals USING btree (tenant_id, persona_id);


--
-- Name: idx_event_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_log_created_at ON public.event_log USING btree (created_at DESC);


--
-- Name: idx_event_log_salience; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_log_salience ON public.event_log USING btree (salience_score DESC NULLS LAST, created_at DESC);


--
-- Name: idx_event_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_log_tenant ON public.event_log USING btree (tenant_id, created_at);


--
-- Name: idx_event_log_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_log_tenant_id ON public.event_log USING btree (tenant_id);


--
-- Name: idx_event_log_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_log_type ON public.event_log USING btree (event_type, status);


--
-- Name: idx_event_subs_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_subs_persona ON public.event_subscriptions USING btree (persona_id);


--
-- Name: idx_event_subs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_subs_tenant ON public.event_subscriptions USING btree (tenant_id, event_type);


--
-- Name: idx_expenses_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_category ON public.expenses USING btree (category);


--
-- Name: idx_expenses_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_date ON public.expenses USING btree (date);


--
-- Name: idx_expenses_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_tenant ON public.expenses USING btree (tenant_id);


--
-- Name: idx_fa_tenant_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fa_tenant_scope ON public.failure_attributions USING btree (tenant_id, scope, scope_ref, id);


--
-- Name: idx_felix_loop_runs_tenant_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_felix_loop_runs_tenant_started ON public.felix_loop_runs USING btree (tenant_id, started_at DESC);


--
-- Name: idx_felix_proposals_kind_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_felix_proposals_kind_status ON public.felix_proposals USING btree (kind, status, executed_at DESC);


--
-- Name: idx_felix_proposals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_felix_proposals_status ON public.felix_proposals USING btree (tenant_id, status, created_at DESC);


--
-- Name: idx_file_storage_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_storage_tenant_id ON public.file_storage USING btree (tenant_id);


--
-- Name: idx_financial_models_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_models_run ON public.financial_models USING btree (run_id);


--
-- Name: idx_financial_models_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_financial_models_tenant ON public.financial_models USING btree (tenant_id);


--
-- Name: idx_flow_steps_flow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flow_steps_flow ON public.flow_steps USING btree (flow_id);


--
-- Name: idx_governance_actions_rule_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_governance_actions_rule_id ON public.governance_actions USING btree (rule_id);


--
-- Name: idx_governance_actions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_governance_actions_tenant ON public.governance_actions USING btree (tenant_id, created_at DESC);


--
-- Name: idx_governance_actions_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_governance_actions_tenant_id ON public.governance_actions USING btree (tenant_id);


--
-- Name: idx_governance_frameworks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_governance_frameworks_tenant ON public.governance_frameworks USING btree (tenant_id, status);


--
-- Name: idx_heartbeat_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heartbeat_logs_created_at ON public.heartbeat_logs USING btree (created_at DESC);


--
-- Name: idx_heartbeat_logs_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heartbeat_logs_task_id ON public.heartbeat_logs USING btree (task_id);


--
-- Name: idx_heartbeat_tasks_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heartbeat_tasks_enabled ON public.heartbeat_tasks USING btree (enabled);


--
-- Name: idx_heartbeat_tasks_persona_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heartbeat_tasks_persona_id ON public.heartbeat_tasks USING btree (persona_id);


--
-- Name: idx_heartbeat_tasks_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_heartbeat_tasks_tenant_id ON public.heartbeat_tasks USING btree (tenant_id);


--
-- Name: idx_hee_tenant_hypothesis; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hee_tenant_hypothesis ON public.hypothesis_evidence_edges USING btree (tenant_id, hypothesis_id);


--
-- Name: idx_inbox_classifications_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_classifications_kind ON public.inbox_classifications USING btree (kind, classified_at);


--
-- Name: idx_inbox_classifications_message_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_inbox_classifications_message_uniq ON public.inbox_classifications USING btree (inbox_message_id);


--
-- Name: idx_inbox_classifications_tenant_classified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_classifications_tenant_classified ON public.inbox_classifications USING btree (tenant_id, classified_at);


--
-- Name: idx_inbox_messages_direction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_messages_direction ON public.inbox_messages USING btree (tenant_id, direction, received_at DESC);


--
-- Name: idx_inbox_messages_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_messages_message_id ON public.inbox_messages USING btree (message_id);


--
-- Name: idx_inbox_messages_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_messages_read ON public.inbox_messages USING btree (tenant_id, is_read);


--
-- Name: idx_inbox_messages_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_messages_received ON public.inbox_messages USING btree (received_at DESC);


--
-- Name: idx_inbox_messages_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_messages_tenant ON public.inbox_messages USING btree (tenant_id);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);


--
-- Name: idx_invoices_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_tenant ON public.invoices USING btree (tenant_id);


--
-- Name: idx_jury_exp_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jury_exp_created ON public.jury_experiences USING btree (created_at);


--
-- Name: idx_jury_exp_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jury_exp_status ON public.jury_experiences USING btree (status);


--
-- Name: idx_jury_exp_tenant_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jury_exp_tenant_class ON public.jury_experiences USING btree (tenant_id, request_class);


--
-- Name: idx_kc_refreshed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kc_refreshed ON public.knowledge_communities USING btree (tenant_id, refreshed_at);


--
-- Name: idx_kc_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kc_tenant ON public.knowledge_communities USING btree (tenant_id);


--
-- Name: idx_kds_tenant_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kds_tenant_persona ON public.knowledge_diversity_snapshots USING btree (tenant_id, persona_id, snapshot_at DESC);


--
-- Name: idx_knowledge_embedding_vec; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_embedding_vec ON public.agent_knowledge USING hnsw (embedding_vec public.vector_cosine_ops);


--
-- Name: idx_knowledge_nudges_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_nudges_tenant ON public.knowledge_nudges USING btree (tenant_id, created_at DESC);


--
-- Name: idx_kpi_metrics_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_metrics_name ON public.kpi_metrics USING btree (metric_name, period_start);


--
-- Name: idx_kpi_metrics_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_metrics_tenant ON public.kpi_metrics USING btree (tenant_id);


--
-- Name: idx_kt_object; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kt_object ON public.knowledge_triples USING btree (object);


--
-- Name: idx_kt_predicate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kt_predicate ON public.knowledge_triples USING btree (predicate);


--
-- Name: idx_kt_subject; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kt_subject ON public.knowledge_triples USING btree (subject);


--
-- Name: idx_kt_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kt_tenant ON public.knowledge_triples USING btree (tenant_id);


--
-- Name: idx_kt_validity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kt_validity ON public.knowledge_triples USING btree (valid_from, valid_until);


--
-- Name: idx_kt_wing_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kt_wing_room ON public.knowledge_triples USING btree (wing, room);


--
-- Name: idx_lead_enrichments_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_enrichments_score ON public.lead_enrichments USING btree (tenant_id, icp_score);


--
-- Name: idx_lead_enrichments_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_enrichments_stage ON public.lead_enrichments USING btree (tenant_id, stage);


--
-- Name: idx_lead_enrichments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_enrichments_tenant ON public.lead_enrichments USING btree (tenant_id);


--
-- Name: idx_lead_scoring_rules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_scoring_rules_tenant ON public.lead_scoring_rules USING btree (tenant_id);


--
-- Name: idx_legal_risk_reviews_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_legal_risk_reviews_run ON public.legal_risk_reviews USING btree (run_id);


--
-- Name: idx_legal_risk_reviews_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_legal_risk_reviews_tenant ON public.legal_risk_reviews USING btree (tenant_id);


--
-- Name: idx_marketing_calendar_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_calendar_status ON public.marketing_calendar USING btree (tenant_id, status);


--
-- Name: idx_marketing_calendar_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_calendar_tenant ON public.marketing_calendar USING btree (tenant_id);


--
-- Name: idx_marketing_results_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketing_results_tenant ON public.marketing_results USING btree (tenant_id);


--
-- Name: idx_mcp_api_keys_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mcp_api_keys_prefix ON public.mcp_api_keys USING btree (key_prefix);


--
-- Name: idx_mcp_api_keys_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mcp_api_keys_tenant ON public.mcp_api_keys USING btree (tenant_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_memory_categories_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_categories_parent ON public.memory_categories USING btree (parent_id);


--
-- Name: idx_memory_categories_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_categories_tenant ON public.memory_categories USING btree (tenant_id);


--
-- Name: idx_memory_embedding_vec; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_embedding_vec ON public.memory_entries USING hnsw (embedding_vec public.vector_cosine_ops);


--
-- Name: idx_memory_entries_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_entries_category ON public.memory_entries USING btree (category);


--
-- Name: idx_memory_entries_kin_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_entries_kin_group ON public.memory_entries USING btree (kin_group_id) WHERE (kin_group_id IS NOT NULL);


--
-- Name: idx_memory_entries_last_reinforced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_entries_last_reinforced ON public.memory_entries USING btree (last_reinforced_at) WHERE ((status = 'active'::text) AND (deleted_at IS NULL));


--
-- Name: idx_memory_entries_persona_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_entries_persona_id ON public.memory_entries USING btree (persona_id);


--
-- Name: idx_memory_entries_quality_below; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_entries_quality_below ON public.memory_entries USING btree (quality_score) WHERE ((quality_score < (0.5)::double precision) AND (status = 'active'::text) AND (deleted_at IS NULL));


--
-- Name: idx_memory_entries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_entries_status ON public.memory_entries USING btree (status);


--
-- Name: idx_memory_entries_succeeded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_entries_succeeded_by ON public.memory_entries USING btree (succeeded_by_id) WHERE (succeeded_by_id IS NOT NULL);


--
-- Name: idx_memory_entries_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_entries_tenant_id ON public.memory_entries USING btree (tenant_id);


--
-- Name: idx_memory_geometry_audits_regime; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_geometry_audits_regime ON public.memory_geometry_audits USING btree (tenant_id, regime, computed_at DESC);


--
-- Name: idx_memory_geometry_audits_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_geometry_audits_tenant ON public.memory_geometry_audits USING btree (tenant_id, computed_at DESC);


--
-- Name: idx_memory_links_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_links_source ON public.memory_links USING btree (source_memory_id);


--
-- Name: idx_memory_links_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_links_target ON public.memory_links USING btree (target_memory_id);


--
-- Name: idx_memory_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_room ON public.memory_entries USING btree (room) WHERE (room IS NOT NULL);


--
-- Name: idx_memory_wing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_wing ON public.memory_entries USING btree (wing) WHERE (wing IS NOT NULL);


--
-- Name: idx_message_feedback_tenant_msg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_feedback_tenant_msg ON public.message_feedback USING btree (tenant_id, message_id);


--
-- Name: idx_message_feedback_tenant_rating_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_feedback_tenant_rating_created ON public.message_feedback USING btree (tenant_id, rating, created_at DESC);


--
-- Name: idx_message_feedback_tenant_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_feedback_tenant_topic ON public.message_feedback USING btree (tenant_id, topic_hint) WHERE (topic_hint IS NOT NULL);


--
-- Name: idx_messages_conv_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conv_created ON public.messages USING btree (conversation_id, created_at);


--
-- Name: idx_messages_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation_id ON public.messages USING btree (conversation_id);


--
-- Name: idx_messages_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_created_at ON public.messages USING btree (created_at DESC);


--
-- Name: idx_messages_tenant_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_tenant_conversation ON public.messages USING btree (tenant_id, conversation_id);


--
-- Name: idx_messages_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_tenant_id ON public.messages USING btree (tenant_id);


--
-- Name: idx_mind_events_handled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mind_events_handled ON public.mind_events USING btree (mind_id, handled);


--
-- Name: idx_mind_events_mind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mind_events_mind ON public.mind_events USING btree (mind_id);


--
-- Name: idx_mind_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mind_events_tenant ON public.mind_events USING btree (tenant_id);


--
-- Name: idx_mind_tickets_mind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mind_tickets_mind ON public.mind_tickets USING btree (mind_id);


--
-- Name: idx_mind_tickets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mind_tickets_status ON public.mind_tickets USING btree (status);


--
-- Name: idx_mind_tickets_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mind_tickets_tenant ON public.mind_tickets USING btree (tenant_id);


--
-- Name: idx_minds_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minds_tenant ON public.minds USING btree (tenant_id);


--
-- Name: idx_moa_responses_concordance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_moa_responses_concordance ON public.moa_responses USING btree (tenant_id, created_at DESC) WHERE (concordance IS NOT NULL);


--
-- Name: idx_model_context_lengths_model_base; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_context_lengths_model_base ON public.model_context_lengths USING btree (model_id, base_url);


--
-- Name: idx_model_harness_deltas_model_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_harness_deltas_model_status ON public.model_harness_deltas USING btree (model_id, status);


--
-- Name: idx_model_harness_deltas_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_model_harness_deltas_tenant_created ON public.model_harness_deltas USING btree (tenant_id, created_at);


--
-- Name: idx_mvp_briefs_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mvp_briefs_run ON public.mvp_briefs USING btree (run_id);


--
-- Name: idx_mvp_briefs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mvp_briefs_tenant ON public.mvp_briefs USING btree (tenant_id);


--
-- Name: idx_notifications_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_tenant ON public.notifications USING btree (tenant_id, is_read, created_at DESC);


--
-- Name: idx_oauth_subs_provider_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_subs_provider_tenant ON public.oauth_subscriptions USING btree (provider, tenant_id);


--
-- Name: idx_orch_eff_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orch_eff_class ON public.orchestration_efficiency USING btree (request_class, created_at);


--
-- Name: idx_orch_eff_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orch_eff_tenant_created ON public.orchestration_efficiency USING btree (tenant_id, created_at);


--
-- Name: idx_outcome_patterns_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outcome_patterns_tenant ON public.outcome_patterns USING btree (tenant_id, action_type);


--
-- Name: idx_outreach_enrollments_next; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_enrollments_next ON public.outreach_enrollments USING btree (next_send_at);


--
-- Name: idx_outreach_enrollments_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_enrollments_seq ON public.outreach_enrollments USING btree (sequence_id);


--
-- Name: idx_outreach_enrollments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_enrollments_status ON public.outreach_enrollments USING btree (tenant_id, status);


--
-- Name: idx_outreach_enrollments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_enrollments_tenant ON public.outreach_enrollments USING btree (tenant_id);


--
-- Name: idx_outreach_sequences_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_sequences_tenant ON public.outreach_sequences USING btree (tenant_id);


--
-- Name: idx_outreach_steps_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_steps_seq ON public.outreach_sequence_steps USING btree (sequence_id);


--
-- Name: idx_pa_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pa_tenant ON public.policy_audit USING btree (tenant_id, created_at);


--
-- Name: idx_pa_tool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pa_tool ON public.policy_audit USING btree (tool_name);


--
-- Name: idx_pending_deliveries_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_deliveries_conv ON public.pending_deliveries USING btree (conversation_id, delivered);


--
-- Name: idx_pending_deliveries_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pending_deliveries_tenant ON public.pending_deliveries USING btree (tenant_id, delivered, created_at DESC);


--
-- Name: idx_ph_tenant_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ph_tenant_conv ON public.pinned_hypotheses USING btree (tenant_id, conversation_id, status);


--
-- Name: idx_pipeline_stage_artifacts_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_stage_artifacts_job ON public.pipeline_stage_artifacts USING btree (tenant_id, job_key);


--
-- Name: idx_pipeline_stage_artifacts_job_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pipeline_stage_artifacts_job_unit ON public.pipeline_stage_artifacts USING btree (tenant_id, job_key, stage, unit_key);


--
-- Name: idx_pjf_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pjf_claim ON public.parallel_job_findings USING btree (tenant_id, job_id, slot_key) WHERE (claim = true);


--
-- Name: idx_pjf_tenant_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pjf_tenant_job ON public.parallel_job_findings USING btree (tenant_id, job_id, id);


--
-- Name: idx_plan_replay_last_hit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_replay_last_hit ON public.plan_replay_cache USING btree (last_hit_at);


--
-- Name: idx_plan_replay_tenant_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_replay_tenant_class ON public.plan_replay_cache USING btree (tenant_id, request_class);


--
-- Name: idx_plans_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_status ON public.plans USING btree (status);


--
-- Name: idx_plans_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_tenant_status ON public.plans USING btree (tenant_id, status);


--
-- Name: idx_pn_tenant_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pn_tenant_plan ON public.plan_nodes USING btree (tenant_id, plan_id);


--
-- Name: idx_presenter_sessions_pid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_presenter_sessions_pid ON public.presenter_sessions USING btree (presentation_id);


--
-- Name: idx_presenter_sessions_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_presenter_sessions_tenant_id ON public.presenter_sessions USING btree (tenant_id);


--
-- Name: idx_presenter_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_presenter_sessions_token ON public.presenter_sessions USING btree (token);


--
-- Name: idx_procedure_edits_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procedure_edits_tenant_status ON public.procedure_edits USING btree (tenant_id, status, proposed_at);


--
-- Name: idx_procedure_edits_tenant_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procedure_edits_tenant_target ON public.procedure_edits USING btree (tenant_id, target_kind, target_id);


--
-- Name: idx_procedure_evo_runs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_procedure_evo_runs_tenant ON public.procedure_evolution_runs USING btree (tenant_id, started_at);


--
-- Name: idx_project_conversations_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_conversations_conversation_id ON public.project_conversations USING btree (conversation_id);


--
-- Name: idx_project_conversations_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_conversations_project ON public.project_conversations USING btree (project_id);


--
-- Name: idx_project_conversations_project_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_conversations_project_id ON public.project_conversations USING btree (project_id);


--
-- Name: idx_project_files_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_files_project ON public.project_files USING btree (project_id);


--
-- Name: idx_projects_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_tenant_id ON public.projects USING btree (tenant_id);


--
-- Name: idx_prs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prs_tenant ON public.plan_rollout_simulations USING btree (tenant_id, simulated_at DESC);


--
-- Name: idx_psi_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psi_session ON public.presenter_slide_images USING btree (session_id);


--
-- Name: idx_repair_incidents_classification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_incidents_classification ON public.repair_incidents USING btree (classification, created_at);


--
-- Name: idx_repair_incidents_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_incidents_source ON public.repair_incidents USING btree (source, created_at);


--
-- Name: idx_repair_incidents_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repair_incidents_tenant_created ON public.repair_incidents USING btree (tenant_id, created_at);


--
-- Name: idx_repo_surgeon_attempts_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repo_surgeon_attempts_outcome ON public.repo_surgeon_attempts USING btree (outcome, created_at);


--
-- Name: idx_repo_surgeon_attempts_tenant_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_repo_surgeon_attempts_tenant_incident ON public.repo_surgeon_attempts USING btree (tenant_id, incident_id);


--
-- Name: idx_research_evidence_query; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_evidence_query ON public.research_evidence USING btree (tenant_id, query);


--
-- Name: idx_research_evidence_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_evidence_tenant ON public.research_evidence USING btree (tenant_id);


--
-- Name: idx_research_evidence_theme; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_evidence_theme ON public.research_evidence USING btree (tenant_id, theme);


--
-- Name: idx_research_experiments_program; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_experiments_program ON public.research_experiments USING btree (program_id);


--
-- Name: idx_research_experiments_replayable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_experiments_replayable ON public.research_experiments USING btree (status, replayed_at) WHERE (status = 'keep'::text);


--
-- Name: idx_research_experiments_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_experiments_session ON public.research_experiments USING btree (session_id);


--
-- Name: idx_research_experiments_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_experiments_session_id ON public.research_experiments USING btree (session_id);


--
-- Name: idx_research_experiments_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_experiments_tenant_id ON public.research_experiments USING btree (tenant_id);


--
-- Name: idx_research_sessions_program_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_sessions_program_id ON public.research_sessions USING btree (program_id);


--
-- Name: idx_research_sessions_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_sessions_tenant_id ON public.research_sessions USING btree (tenant_id);


--
-- Name: idx_sandbox_improvements_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sandbox_improvements_tenant_status ON public.sandbox_improvements USING btree (tenant_id, status);


--
-- Name: idx_sandbox_results_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sandbox_results_run ON public.sandbox_results USING btree (run_id);


--
-- Name: idx_sandbox_results_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sandbox_results_tenant ON public.sandbox_results USING btree (tenant_id);


--
-- Name: idx_sandbox_runs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sandbox_runs_tenant ON public.sandbox_runs USING btree (tenant_id);


--
-- Name: idx_scheduled_posts_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_posts_due ON public.scheduled_posts USING btree (status, scheduled_for) WHERE (status = ANY (ARRAY['pending'::text, 'publishing'::text]));


--
-- Name: idx_scheduled_posts_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_posts_tenant_status ON public.scheduled_posts USING btree (tenant_id, status, scheduled_for DESC);


--
-- Name: idx_scraped_pages_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scraped_pages_domain ON public.scraped_pages USING btree (domain);


--
-- Name: idx_scraped_pages_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scraped_pages_tenant ON public.scraped_pages USING btree (tenant_id);


--
-- Name: idx_scraped_pages_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scraped_pages_tenant_id ON public.scraped_pages USING btree (tenant_id);


--
-- Name: idx_scraped_pages_url; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scraped_pages_url ON public.scraped_pages USING btree (url);


--
-- Name: idx_scratchpad_chain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scratchpad_chain ON public.delegation_scratchpad USING btree (chain_key, tenant_id);


--
-- Name: idx_sculptor_comparison; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sculptor_comparison ON public.sculptor_sessions USING btree (comparison_group);


--
-- Name: idx_sculptor_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sculptor_status ON public.sculptor_sessions USING btree (status);


--
-- Name: idx_sculptor_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sculptor_tenant ON public.sculptor_sessions USING btree (tenant_id);


--
-- Name: idx_security_intent_checks_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_intent_checks_action ON public.security_intent_checks USING btree (action, created_at DESC);


--
-- Name: idx_security_intent_checks_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_intent_checks_persona ON public.security_intent_checks USING btree (persona_id, created_at DESC);


--
-- Name: idx_security_tool_blocks_tool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_tool_blocks_tool ON public.security_tool_blocks USING btree (tool_name, created_at DESC);


--
-- Name: idx_self_heal_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_self_heal_run ON public.self_heal_attempts USING btree (run_id) WHERE (run_id IS NOT NULL);


--
-- Name: idx_self_heal_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_self_heal_tenant_created ON public.self_heal_attempts USING btree (tenant_id, created_at DESC);


--
-- Name: idx_self_initiatives_open_sig; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_self_initiatives_open_sig ON public.self_initiatives USING btree (tenant_id, signature) WHERE (status = ANY (ARRAY['surfaced'::text, 'approved'::text, 'acting'::text]));


--
-- Name: idx_self_initiatives_tenant_sig; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_self_initiatives_tenant_sig ON public.self_initiatives USING btree (tenant_id, signature);


--
-- Name: idx_self_initiatives_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_self_initiatives_tenant_status ON public.self_initiatives USING btree (tenant_id, status, created_at);


--
-- Name: idx_sentiment_events_conversation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sentiment_events_conversation_id ON public.sentiment_events USING btree (conversation_id);


--
-- Name: idx_sentiment_events_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sentiment_events_tenant_id ON public.sentiment_events USING btree (tenant_id);


--
-- Name: idx_skills_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_skills_status ON public.skills USING btree (status) WHERE (status <> 'active'::text);


--
-- Name: idx_smart_enrichment_routing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_smart_enrichment_routing ON public.smart_enrichment_reports USING btree (routing, created_at);


--
-- Name: idx_smart_enrichment_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_smart_enrichment_score ON public.smart_enrichment_reports USING btree (icp_fit_score);


--
-- Name: idx_smart_enrichment_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_smart_enrichment_tenant_created ON public.smart_enrichment_reports USING btree (tenant_id, created_at);


--
-- Name: idx_sprint_contracts_tenant_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sprint_contracts_tenant_ref ON public.sprint_contracts USING btree (tenant_id, ref_kind, ref_id);


--
-- Name: idx_sprint_contracts_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sprint_contracts_tenant_status ON public.sprint_contracts USING btree (tenant_id, status, pinned_at);


--
-- Name: idx_step_rewards_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_step_rewards_plan ON public.step_rewards USING btree (tenant_id, plan_id);


--
-- Name: idx_synthetic_customers_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_synthetic_customers_run ON public.synthetic_customers USING btree (run_id);


--
-- Name: idx_synthetic_customers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_synthetic_customers_tenant ON public.synthetic_customers USING btree (tenant_id);


--
-- Name: idx_task_forces_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_forces_tenant ON public.task_forces USING btree (tenant_id, status);


--
-- Name: idx_team_members_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_members_tenant ON public.team_members USING btree (tenant_id);


--
-- Name: idx_team_members_tenant_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_team_members_tenant_email ON public.team_members USING btree (tenant_id, email);


--
-- Name: idx_tenants_forked_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_forked_from ON public.tenants USING btree (forked_from);


--
-- Name: idx_tensions_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tensions_source ON public.tensions USING btree (source_kind, source_id);


--
-- Name: idx_tensions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tensions_tenant ON public.tensions USING btree (tenant_id);


--
-- Name: idx_tensions_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tensions_tenant_status ON public.tensions USING btree (tenant_id, status);


--
-- Name: idx_tool_compression_tenant_day; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tool_compression_tenant_day ON public.tool_compression_stats USING btree (tenant_id, day);


--
-- Name: idx_tool_optimizations_applied; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_optimizations_applied ON public.tool_optimizations USING btree (tenant_id, applied);


--
-- Name: idx_tool_optimizations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_optimizations_tenant ON public.tool_optimizations USING btree (tenant_id);


--
-- Name: idx_tool_optimizations_tenant_tool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_optimizations_tenant_tool ON public.tool_optimizations USING btree (tenant_id, tool_name);


--
-- Name: idx_tool_performance_fail_rate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_performance_fail_rate ON public.tool_performance USING btree (tenant_id, fail_count DESC);


--
-- Name: idx_tool_performance_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tool_performance_tenant ON public.tool_performance USING btree (tenant_id);


--
-- Name: idx_tool_performance_tenant_tool; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tool_performance_tenant_tool ON public.tool_performance USING btree (tenant_id, tool_name);


--
-- Name: idx_tp_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tp_scope ON public.tool_policies USING btree (tenant_id, scope_kind, scope_value);


--
-- Name: idx_tp_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tp_tenant ON public.tool_policies USING btree (tenant_id);


--
-- Name: idx_trust_scores_persona_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trust_scores_persona_id ON public.trust_scores USING btree (persona_id);


--
-- Name: idx_trust_scores_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trust_scores_tenant_id ON public.trust_scores USING btree (tenant_id);


--
-- Name: idx_tvp_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tvp_tenant ON public.tenant_voice_profiles USING btree (tenant_id);


--
-- Name: idx_usage_tenant_metric_period; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_usage_tenant_metric_period ON public.usage_tracking USING btree (tenant_id, metric, period);


--
-- Name: idx_usage_tracking_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_tracking_tenant_id ON public.usage_tracking USING btree (tenant_id);


--
-- Name: idx_user_profiles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_profiles_tenant ON public.user_profiles USING btree (tenant_id);


--
-- Name: idx_validation_runs_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validation_runs_run ON public.validation_runs USING btree (run_id);


--
-- Name: idx_validation_runs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validation_runs_tenant ON public.validation_runs USING btree (tenant_id);


--
-- Name: idx_venture_artifacts_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venture_artifacts_run ON public.venture_artifacts USING btree (run_id);


--
-- Name: idx_venture_artifacts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venture_artifacts_tenant ON public.venture_artifacts USING btree (tenant_id);


--
-- Name: idx_venture_decisions_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venture_decisions_run ON public.venture_decisions USING btree (run_id);


--
-- Name: idx_venture_decisions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venture_decisions_tenant ON public.venture_decisions USING btree (tenant_id);


--
-- Name: idx_venture_ideas_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venture_ideas_run ON public.venture_ideas USING btree (run_id);


--
-- Name: idx_venture_ideas_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venture_ideas_tenant ON public.venture_ideas USING btree (tenant_id);


--
-- Name: idx_venture_runs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venture_runs_tenant ON public.venture_discovery_runs USING btree (tenant_id);


--
-- Name: idx_venture_scores_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venture_scores_run ON public.venture_scores USING btree (run_id);


--
-- Name: idx_venture_scores_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_venture_scores_tenant ON public.venture_scores USING btree (tenant_id);


--
-- Name: idx_video_jobs_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_jobs_tenant_created ON public.video_jobs USING btree (tenant_id, created_at);


--
-- Name: idx_video_jobs_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_jobs_tenant_status ON public.video_jobs USING btree (tenant_id, status, updated_at);


--
-- Name: idx_vjfp_tenant_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vjfp_tenant_job ON public.video_job_frame_pool USING btree (tenant_id, job_id);


--
-- Name: idx_vjfp_tenant_job_frame; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vjfp_tenant_job_frame ON public.video_job_frame_pool USING btree (tenant_id, job_id, frame_idx);


--
-- Name: idx_wake_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wake_due ON public.agent_wake_schedules USING btree (status, wake_at);


--
-- Name: idx_wake_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wake_tenant ON public.agent_wake_schedules USING btree (tenant_id, status);


--
-- Name: idx_watchlist_alerts_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchlist_alerts_item ON public.watchlist_alerts USING btree (watchlist_item_id);


--
-- Name: idx_watchlist_alerts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchlist_alerts_tenant ON public.watchlist_alerts USING btree (tenant_id, acknowledged);


--
-- Name: idx_watchlist_items_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_watchlist_items_tenant ON public.watchlist_items USING btree (tenant_id, enabled);


--
-- Name: idx_wellbeing_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wellbeing_created ON public.wellbeing_interventions USING btree (created_at);


--
-- Name: idx_wellbeing_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wellbeing_tenant ON public.wellbeing_interventions USING btree (tenant_id);


--
-- Name: inbox_messages_quarantined_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_quarantined_idx ON public.inbox_messages USING btree (tenant_id, quarantined) WHERE (quarantined = true);


--
-- Name: inbox_sender_allowlist_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_sender_allowlist_status_idx ON public.inbox_sender_allowlist USING btree (tenant_id, status);


--
-- Name: jury_drain_ledger_entry_key_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX jury_drain_ledger_entry_key_uniq ON public.jury_drain_ledger USING btree (entry_key);


--
-- Name: jury_drain_ledger_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jury_drain_ledger_tenant_idx ON public.jury_drain_ledger USING btree (tenant_id);


--
-- Name: memory_entries_tsv_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX memory_entries_tsv_gin_idx ON public.memory_entries USING gin (tsv);


--
-- Name: moa_responses_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX moa_responses_tenant_created_idx ON public.moa_responses USING btree (tenant_id, created_at DESC);


--
-- Name: proposed_skills_tenant_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX proposed_skills_tenant_status_idx ON public.proposed_skills USING btree (tenant_id, status, created_at DESC);


--
-- Name: skill_rag_decisions_skill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_rag_decisions_skill_idx ON public.skill_rag_decisions USING btree (skill_used);


--
-- Name: skill_rag_decisions_tenant_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skill_rag_decisions_tenant_created_idx ON public.skill_rag_decisions USING btree (tenant_id, created_at DESC);


--
-- Name: storefront_checkout_hits_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX storefront_checkout_hits_expires_at ON public.storefront_checkout_hits USING btree (expires_at);


--
-- Name: storefront_checkout_hits_hit_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX storefront_checkout_hits_hit_at ON public.storefront_checkout_hits USING btree (hit_at);


--
-- Name: storefront_checkout_hits_key_exp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX storefront_checkout_hits_key_exp ON public.storefront_checkout_hits USING btree (rate_key, expires_at);


--
-- Name: uniq_felix_proposals_active_n; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_felix_proposals_active_n ON public.felix_proposals USING btree (tenant_id, kind) WHERE ((target IS NULL) AND (status = ANY (ARRAY['pending'::text, 'approved'::text])));


--
-- Name: uniq_felix_proposals_active_t; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_felix_proposals_active_t ON public.felix_proposals USING btree (tenant_id, kind, target) WHERE ((target IS NOT NULL) AND (status = ANY (ARRAY['pending'::text, 'approved'::text])));


--
-- Name: uniq_plans_tenant_source_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_plans_tenant_source_ref ON public.plans USING btree (tenant_id, source, source_ref) WHERE (source_ref IS NOT NULL);


--
-- Name: uq_causal_chains_tenant_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_causal_chains_tenant_hash ON public.causal_chains USING btree (tenant_id, chain_hash);


--
-- Name: uq_dc_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_dc_type ON public.deliverable_contracts USING btree (deliverable_type);


--
-- Name: uq_message_feedback_tenant_msg_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_message_feedback_tenant_msg_user ON public.message_feedback USING btree (tenant_id, message_id, COALESCE(user_id, 0));


--
-- Name: uq_model_context_lengths_model_base; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_model_context_lengths_model_base ON public.model_context_lengths USING btree (model_id, base_url);


--
-- Name: uq_sandbox_improvements_tenant_run; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_sandbox_improvements_tenant_run ON public.sandbox_improvements USING btree (tenant_id, run_id) WHERE (run_id IS NOT NULL);


--
-- Name: uq_sprint_contracts_open_per_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_sprint_contracts_open_per_ref ON public.sprint_contracts USING btree (tenant_id, ref_kind, ref_id) WHERE (status = 'open'::text);


--
-- Name: uq_tp_tenant_scope_action; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tp_tenant_scope_action ON public.tool_policies USING btree (tenant_id, scope_kind, scope_value, action);


--
-- Name: uq_tvp_tenant_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tvp_tenant_profile ON public.tenant_voice_profiles USING btree (tenant_id, profile_name);


--
-- Name: webhook_events_received_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX webhook_events_received_at_idx ON public.webhook_events USING btree (received_at);


--
-- Name: active_entitlements_lookup_key_key; Type: INDEX; Schema: stripe; Owner: -
--

CREATE UNIQUE INDEX active_entitlements_lookup_key_key ON stripe.active_entitlements USING btree (lookup_key) WHERE (lookup_key IS NOT NULL);


--
-- Name: features_lookup_key_key; Type: INDEX; Schema: stripe; Owner: -
--

CREATE UNIQUE INDEX features_lookup_key_key ON stripe.features USING btree (lookup_key) WHERE (lookup_key IS NOT NULL);


--
-- Name: idx_accounts_api_key_hashes; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX idx_accounts_api_key_hashes ON stripe.accounts USING gin (api_key_hashes);


--
-- Name: idx_accounts_business_name; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX idx_accounts_business_name ON stripe.accounts USING btree (business_name);


--
-- Name: idx_sync_status_resource_account; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX idx_sync_status_resource_account ON stripe._sync_status USING btree (resource, account_id);


--
-- Name: stripe_active_entitlements_customer_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_active_entitlements_customer_idx ON stripe.active_entitlements USING btree (customer);


--
-- Name: stripe_active_entitlements_feature_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_active_entitlements_feature_idx ON stripe.active_entitlements USING btree (feature);


--
-- Name: stripe_checkout_session_line_items_price_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_checkout_session_line_items_price_idx ON stripe.checkout_session_line_items USING btree (price);


--
-- Name: stripe_checkout_session_line_items_session_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_checkout_session_line_items_session_idx ON stripe.checkout_session_line_items USING btree (checkout_session);


--
-- Name: stripe_checkout_sessions_customer_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_checkout_sessions_customer_idx ON stripe.checkout_sessions USING btree (customer);


--
-- Name: stripe_checkout_sessions_invoice_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_checkout_sessions_invoice_idx ON stripe.checkout_sessions USING btree (invoice);


--
-- Name: stripe_checkout_sessions_payment_intent_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_checkout_sessions_payment_intent_idx ON stripe.checkout_sessions USING btree (payment_intent);


--
-- Name: stripe_checkout_sessions_subscription_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_checkout_sessions_subscription_idx ON stripe.checkout_sessions USING btree (subscription);


--
-- Name: stripe_credit_notes_customer_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_credit_notes_customer_idx ON stripe.credit_notes USING btree (customer);


--
-- Name: stripe_credit_notes_invoice_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_credit_notes_invoice_idx ON stripe.credit_notes USING btree (invoice);


--
-- Name: stripe_dispute_created_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_dispute_created_idx ON stripe.disputes USING btree (created);


--
-- Name: stripe_early_fraud_warnings_charge_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_early_fraud_warnings_charge_idx ON stripe.early_fraud_warnings USING btree (charge);


--
-- Name: stripe_early_fraud_warnings_payment_intent_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_early_fraud_warnings_payment_intent_idx ON stripe.early_fraud_warnings USING btree (payment_intent);


--
-- Name: stripe_invoices_customer_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_invoices_customer_idx ON stripe.invoices USING btree (customer);


--
-- Name: stripe_invoices_subscription_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_invoices_subscription_idx ON stripe.invoices USING btree (subscription);


--
-- Name: stripe_managed_webhooks_enabled_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_managed_webhooks_enabled_idx ON stripe._managed_webhooks USING btree (enabled);


--
-- Name: stripe_managed_webhooks_status_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_managed_webhooks_status_idx ON stripe._managed_webhooks USING btree (status);


--
-- Name: stripe_payment_intents_customer_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_payment_intents_customer_idx ON stripe.payment_intents USING btree (customer);


--
-- Name: stripe_payment_intents_invoice_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_payment_intents_invoice_idx ON stripe.payment_intents USING btree (invoice);


--
-- Name: stripe_payment_methods_customer_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_payment_methods_customer_idx ON stripe.payment_methods USING btree (customer);


--
-- Name: stripe_refunds_charge_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_refunds_charge_idx ON stripe.refunds USING btree (charge);


--
-- Name: stripe_refunds_payment_intent_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_refunds_payment_intent_idx ON stripe.refunds USING btree (payment_intent);


--
-- Name: stripe_reviews_charge_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_reviews_charge_idx ON stripe.reviews USING btree (charge);


--
-- Name: stripe_reviews_payment_intent_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_reviews_payment_intent_idx ON stripe.reviews USING btree (payment_intent);


--
-- Name: stripe_setup_intents_customer_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_setup_intents_customer_idx ON stripe.setup_intents USING btree (customer);


--
-- Name: stripe_tax_ids_customer_idx; Type: INDEX; Schema: stripe; Owner: -
--

CREATE INDEX stripe_tax_ids_customer_idx ON stripe.tax_ids USING btree (customer);


--
-- Name: _managed_webhooks handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe._managed_webhooks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_metadata();


--
-- Name: _sync_status handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe._sync_status FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_metadata();


--
-- Name: accounts handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: active_entitlements handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.active_entitlements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: charges handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.charges FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: checkout_session_line_items handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.checkout_session_line_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: checkout_sessions handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.checkout_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: coupons handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.coupons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customers handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: disputes handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.disputes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: early_fraud_warnings handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.early_fraud_warnings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: events handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: features handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.features FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: invoices handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payouts handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.payouts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: plans handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prices handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.prices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: products handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: refunds handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.refunds FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: reviews handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.reviews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscriptions handle_updated_at; Type: TRIGGER; Schema: stripe; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON stripe.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: agent_activity agent_activity_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_activity
    ADD CONSTRAINT agent_activity_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);


--
-- Name: agent_activity agent_activity_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_activity
    ADD CONSTRAINT agent_activity_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id);


--
-- Name: agent_activity agent_activity_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_activity
    ADD CONSTRAINT agent_activity_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: agent_jobs agent_jobs_parent_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_jobs
    ADD CONSTRAINT agent_jobs_parent_job_id_fkey FOREIGN KEY (parent_job_id) REFERENCES public.agent_jobs(id) ON DELETE SET NULL;


--
-- Name: agent_knowledge agent_knowledge_persona_id_personas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_knowledge
    ADD CONSTRAINT agent_knowledge_persona_id_personas_id_fk FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: channel_messages channel_messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_messages
    ADD CONSTRAINT channel_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.agent_channels(id) ON DELETE CASCADE;


--
-- Name: channel_subscriptions channel_subscriptions_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_subscriptions
    ADD CONSTRAINT channel_subscriptions_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.agent_channels(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: conversation_facts conversation_facts_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_facts
    ADD CONSTRAINT conversation_facts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_templates conversation_templates_persona_id_personas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_templates
    ADD CONSTRAINT conversation_templates_persona_id_personas_id_fk FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_persona_id_personas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_persona_id_personas_id_fk FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: conversations conversations_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: crew_agents crew_agents_crew_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_agents
    ADD CONSTRAINT crew_agents_crew_id_fkey FOREIGN KEY (crew_id) REFERENCES public.crews(id) ON DELETE CASCADE;


--
-- Name: crew_runs crew_runs_crew_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_runs
    ADD CONSTRAINT crew_runs_crew_id_fkey FOREIGN KEY (crew_id) REFERENCES public.crews(id) ON DELETE CASCADE;


--
-- Name: crew_tasks crew_tasks_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_tasks
    ADD CONSTRAINT crew_tasks_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.crew_agents(id) ON DELETE SET NULL;


--
-- Name: crew_tasks crew_tasks_crew_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_tasks
    ADD CONSTRAINT crew_tasks_crew_id_fkey FOREIGN KEY (crew_id) REFERENCES public.crews(id) ON DELETE CASCADE;


--
-- Name: customer_interactions customer_interactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_interactions
    ADD CONSTRAINT customer_interactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: daily_notes daily_notes_persona_id_personas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_notes
    ADD CONSTRAINT daily_notes_persona_id_personas_id_fk FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: delivery_verifications delivery_verifications_contract_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_verifications
    ADD CONSTRAINT delivery_verifications_contract_id_fk FOREIGN KEY (contract_id) REFERENCES public.deliverable_contracts(id) ON DELETE SET NULL;


--
-- Name: financial_models financial_models_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_models
    ADD CONSTRAINT financial_models_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.venture_ideas(id);


--
-- Name: financial_models financial_models_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_models
    ADD CONSTRAINT financial_models_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.venture_discovery_runs(id);


--
-- Name: financial_models financial_models_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_models
    ADD CONSTRAINT financial_models_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: flow_steps flow_steps_crew_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_steps
    ADD CONSTRAINT flow_steps_crew_id_fkey FOREIGN KEY (crew_id) REFERENCES public.crews(id) ON DELETE SET NULL;


--
-- Name: flow_steps flow_steps_flow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flow_steps
    ADD CONSTRAINT flow_steps_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.crew_flows(id) ON DELETE CASCADE;


--
-- Name: governance_actions governance_actions_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.governance_actions
    ADD CONSTRAINT governance_actions_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.governance_rules(id);


--
-- Name: heartbeat_tasks heartbeat_tasks_persona_id_personas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.heartbeat_tasks
    ADD CONSTRAINT heartbeat_tasks_persona_id_personas_id_fk FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: invoice_items invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: legal_risk_reviews legal_risk_reviews_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_risk_reviews
    ADD CONSTRAINT legal_risk_reviews_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.venture_ideas(id);


--
-- Name: legal_risk_reviews legal_risk_reviews_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_risk_reviews
    ADD CONSTRAINT legal_risk_reviews_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.venture_discovery_runs(id);


--
-- Name: legal_risk_reviews legal_risk_reviews_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_risk_reviews
    ADD CONSTRAINT legal_risk_reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: memory_categories memory_categories_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_categories
    ADD CONSTRAINT memory_categories_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: memory_entries memory_entries_persona_id_personas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_entries
    ADD CONSTRAINT memory_entries_persona_id_personas_id_fk FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: memory_links memory_links_source_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_links
    ADD CONSTRAINT memory_links_source_memory_id_fkey FOREIGN KEY (source_memory_id) REFERENCES public.memory_entries(id) ON DELETE CASCADE;


--
-- Name: memory_links memory_links_target_memory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_links
    ADD CONSTRAINT memory_links_target_memory_id_fkey FOREIGN KEY (target_memory_id) REFERENCES public.memory_entries(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: mind_events mind_events_mind_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mind_events
    ADD CONSTRAINT mind_events_mind_id_fkey FOREIGN KEY (mind_id) REFERENCES public.minds(id);


--
-- Name: mind_tickets mind_tickets_mind_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mind_tickets
    ADD CONSTRAINT mind_tickets_mind_id_fkey FOREIGN KEY (mind_id) REFERENCES public.minds(id);


--
-- Name: mvp_briefs mvp_briefs_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mvp_briefs
    ADD CONSTRAINT mvp_briefs_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.venture_ideas(id);


--
-- Name: mvp_briefs mvp_briefs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mvp_briefs
    ADD CONSTRAINT mvp_briefs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.venture_discovery_runs(id);


--
-- Name: mvp_briefs mvp_briefs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mvp_briefs
    ADD CONSTRAINT mvp_briefs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: plans plans_ceo_decided_by_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_ceo_decided_by_persona_id_fkey FOREIGN KEY (ceo_decided_by_persona_id) REFERENCES public.personas(id);


--
-- Name: plans plans_parent_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_parent_plan_id_fkey FOREIGN KEY (parent_plan_id) REFERENCES public.plans(id);


--
-- Name: plans plans_planner_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_planner_persona_id_fkey FOREIGN KEY (planner_persona_id) REFERENCES public.personas(id);


--
-- Name: policy_audit policy_audit_matched_policy_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.policy_audit
    ADD CONSTRAINT policy_audit_matched_policy_id_fk FOREIGN KEY (matched_policy_id) REFERENCES public.tool_policies(id) ON DELETE SET NULL;


--
-- Name: presenter_slide_images presenter_slide_images_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presenter_slide_images
    ADD CONSTRAINT presenter_slide_images_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.presenter_sessions(id) ON DELETE CASCADE;


--
-- Name: sandbox_improvements sandbox_improvements_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_improvements
    ADD CONSTRAINT sandbox_improvements_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.sandbox_runs(id) ON DELETE SET NULL;


--
-- Name: sandbox_results sandbox_results_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sandbox_results
    ADD CONSTRAINT sandbox_results_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.sandbox_runs(id) ON DELETE CASCADE;


--
-- Name: security_intent_checks security_intent_checks_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_intent_checks
    ADD CONSTRAINT security_intent_checks_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: security_tool_blocks security_tool_blocks_persona_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_tool_blocks
    ADD CONSTRAINT security_tool_blocks_persona_id_fkey FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: skills skills_persona_id_personas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_persona_id_personas_id_fk FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE SET NULL;


--
-- Name: synthetic_customers synthetic_customers_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synthetic_customers
    ADD CONSTRAINT synthetic_customers_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.venture_ideas(id);


--
-- Name: synthetic_customers synthetic_customers_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synthetic_customers
    ADD CONSTRAINT synthetic_customers_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.venture_discovery_runs(id);


--
-- Name: synthetic_customers synthetic_customers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synthetic_customers
    ADD CONSTRAINT synthetic_customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: tenant_persona_names tenant_persona_names_persona_id_personas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_persona_names
    ADD CONSTRAINT tenant_persona_names_persona_id_personas_id_fk FOREIGN KEY (persona_id) REFERENCES public.personas(id) ON DELETE CASCADE;


--
-- Name: tenant_persona_names tenant_persona_names_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_persona_names
    ADD CONSTRAINT tenant_persona_names_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: validation_runs validation_runs_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_runs
    ADD CONSTRAINT validation_runs_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.venture_ideas(id);


--
-- Name: validation_runs validation_runs_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_runs
    ADD CONSTRAINT validation_runs_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.venture_discovery_runs(id);


--
-- Name: validation_runs validation_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validation_runs
    ADD CONSTRAINT validation_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: venture_artifacts venture_artifacts_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_artifacts
    ADD CONSTRAINT venture_artifacts_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.venture_ideas(id);


--
-- Name: venture_artifacts venture_artifacts_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_artifacts
    ADD CONSTRAINT venture_artifacts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.venture_discovery_runs(id);


--
-- Name: venture_artifacts venture_artifacts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_artifacts
    ADD CONSTRAINT venture_artifacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: venture_decisions venture_decisions_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_decisions
    ADD CONSTRAINT venture_decisions_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.venture_ideas(id);


--
-- Name: venture_decisions venture_decisions_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_decisions
    ADD CONSTRAINT venture_decisions_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.venture_discovery_runs(id);


--
-- Name: venture_decisions venture_decisions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_decisions
    ADD CONSTRAINT venture_decisions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: venture_discovery_runs venture_discovery_runs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_discovery_runs
    ADD CONSTRAINT venture_discovery_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: venture_ideas venture_ideas_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_ideas
    ADD CONSTRAINT venture_ideas_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.venture_discovery_runs(id);


--
-- Name: venture_ideas venture_ideas_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_ideas
    ADD CONSTRAINT venture_ideas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: venture_scores venture_scores_idea_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_scores
    ADD CONSTRAINT venture_scores_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES public.venture_ideas(id);


--
-- Name: venture_scores venture_scores_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_scores
    ADD CONSTRAINT venture_scores_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.venture_discovery_runs(id);


--
-- Name: venture_scores venture_scores_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venture_scores
    ADD CONSTRAINT venture_scores_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: active_entitlements fk_active_entitlements_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.active_entitlements
    ADD CONSTRAINT fk_active_entitlements_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: charges fk_charges_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.charges
    ADD CONSTRAINT fk_charges_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: checkout_session_line_items fk_checkout_session_line_items_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.checkout_session_line_items
    ADD CONSTRAINT fk_checkout_session_line_items_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: checkout_sessions fk_checkout_sessions_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.checkout_sessions
    ADD CONSTRAINT fk_checkout_sessions_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: credit_notes fk_credit_notes_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.credit_notes
    ADD CONSTRAINT fk_credit_notes_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: customers fk_customers_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.customers
    ADD CONSTRAINT fk_customers_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: disputes fk_disputes_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.disputes
    ADD CONSTRAINT fk_disputes_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: early_fraud_warnings fk_early_fraud_warnings_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.early_fraud_warnings
    ADD CONSTRAINT fk_early_fraud_warnings_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: features fk_features_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.features
    ADD CONSTRAINT fk_features_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: invoices fk_invoices_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.invoices
    ADD CONSTRAINT fk_invoices_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: _managed_webhooks fk_managed_webhooks_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe._managed_webhooks
    ADD CONSTRAINT fk_managed_webhooks_account FOREIGN KEY (account_id) REFERENCES stripe.accounts(id);


--
-- Name: payment_intents fk_payment_intents_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.payment_intents
    ADD CONSTRAINT fk_payment_intents_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: payment_methods fk_payment_methods_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.payment_methods
    ADD CONSTRAINT fk_payment_methods_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: plans fk_plans_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.plans
    ADD CONSTRAINT fk_plans_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: prices fk_prices_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.prices
    ADD CONSTRAINT fk_prices_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: products fk_products_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.products
    ADD CONSTRAINT fk_products_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: refunds fk_refunds_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.refunds
    ADD CONSTRAINT fk_refunds_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: reviews fk_reviews_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.reviews
    ADD CONSTRAINT fk_reviews_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: setup_intents fk_setup_intents_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.setup_intents
    ADD CONSTRAINT fk_setup_intents_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: subscription_items fk_subscription_items_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.subscription_items
    ADD CONSTRAINT fk_subscription_items_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: subscription_schedules fk_subscription_schedules_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.subscription_schedules
    ADD CONSTRAINT fk_subscription_schedules_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: subscriptions fk_subscriptions_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.subscriptions
    ADD CONSTRAINT fk_subscriptions_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: _sync_status fk_sync_status_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe._sync_status
    ADD CONSTRAINT fk_sync_status_account FOREIGN KEY (account_id) REFERENCES stripe.accounts(id);


--
-- Name: tax_ids fk_tax_ids_account; Type: FK CONSTRAINT; Schema: stripe; Owner: -
--

ALTER TABLE ONLY stripe.tax_ids
    ADD CONSTRAINT fk_tax_ids_account FOREIGN KEY (_account_id) REFERENCES stripe.accounts(id);


--
-- Name: agent_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_trace_spans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_trace_spans ENABLE ROW LEVEL SECURITY;

--
-- Name: contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: file_storage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.file_storage ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: memory_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.memory_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: message_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: mind_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mind_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: procedure_edits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.procedure_edits ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_runs r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.agent_runs USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- Name: agent_trace_spans r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.agent_trace_spans USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- Name: contracts r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.contracts USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- Name: conversations r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.conversations USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- Name: customers r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.customers USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- Name: file_storage r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.file_storage USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- Name: invoices r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.invoices USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- Name: memory_entries r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.memory_entries USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- Name: message_feedback r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.message_feedback USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- Name: messages r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.messages USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- Name: mind_tickets r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.mind_tickets USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- Name: procedure_edits r120_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY r120_tenant_isolation ON public.procedure_edits USING (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer))) WITH CHECK (((NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NULL) OR (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::integer)));


--
-- PostgreSQL database dump complete
--

\unrestrict iMqBm4Ug7pOKI22l8MHM27Pj0Qt0lsguteMmcJVS1MI2T3ObZFVdepqovvVEZI3

