# Current Platform Totals — Single Source of Truth

> **This is the authoritative count for VisionClaw Agent.** Every other doc
> (README, SETUP, FORK-SETUP, ROADMAP, CONTRIBUTING, GitHub repo description)
> must agree with the numbers here. If you find a mismatch, fix the other doc
> — not this one.

**Last verified:** 2026-07-08 (manual — `psql $DATABASE_URL` live counts + source-tree greps)
**Verification method:** Live runtime counts from the production database
plus source-tree grep against `server/` and `shared/`. `scripts/refresh-totals.ts`
regenerates this file from live registries and has a `--check` mode
(`npx tsx scripts/refresh-totals.ts --check` → exit 1 if the doc would change) for
drift detection. It is run by hand during `website-surface-sync` / release passes
rather than as a blind CI gate, because its raw `registerTool(` grep OVERCOUNTS the
tool total (the authoritative 395 comes from the 3-source reconciliation, not the
grep) and its skills/models greps under-count — so the generator's numbers must be
reconciled by hand against the commands below before they can gate CI.

---

## Authoritative Counts

| Metric | Value | How it's verified |
|---|---|---|
| **AI agent personas (active)** | **16** | `SELECT count(*) FROM personas WHERE is_active=true` |
| **Built-in tools** | **395** | Verified across 3 runtime sources (registry + dispatcher + smoke-test manifest; the raw `registerTool(` grep overcounts) |
| **Skills (DB seeded)** | **62** | `SELECT count(*) FROM skills` |
| **Skills (total: DB + `.agents/skills/` + `data/output-skills/`)** | **143** | 62 DB + 43 `.agents/skills/` dirs + 38 `data/output-skills/` registered (`_registry.json`; 1 unregistered `.md` on disk not counted) |
| **Database tables (declared)** | **173** | `rg -c "pgTable(" shared/schema.ts` |
| **Database tables (live in `public` schema)** | **212** | `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'` |
| **Governance rules** | **41** | `SELECT count(*) FROM governance_rules` |
| **Capabilities (active)** | **129** | `SELECT count(*) FROM capabilities` |
| **Production indexes (all)** | **623** | `SELECT count(*) FROM pg_indexes WHERE schemaname='public'` |
| **Production indexes (non-PK)** | **411** | `SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname NOT LIKE '%_pkey'` |
| **AI providers** | **6** | OpenAI, Anthropic, Google, xAI, OpenRouter, Perplexity |
| **AI models (core registry)** | **45 curated** | `MODEL_REGISTRY` entry count in `server/providers.ts` |
| **AI models (daily catalog discovery)** | **1000+** | Nightly OpenRouter scanner (`server/model-catalog.ts`) |

---

## Tools layer layout (strangler-fig split, in progress)

The tool surface is being split out of the legacy `server/tools.ts` monolith into
a per-domain package:

- `server/tools/domains/` — 70+ domain modules (crm, finance, media, legal,
  knowledge, delivery, governance, …) holding the migrated tool definitions +
  executors (~294/395 tools migrated so far).
- `server/tools/middleware/` — dispatch middleware extracted at the same
  call-site/order (policy, telemetry, tenant seam).
- `server/tools.ts` — legacy facade + dispatcher; remaining unmigrated tools
  live here until their slice lands. The fail-closed tenant seam and the AHB
  destructive-tool policy semantics are preserved verbatim on both paths.

The tool COUNT is unchanged by the split — 395 total regardless of which file a
tool lives in.

---

## Why the schema-declared vs. live-DB delta exists

The HyperAgent review of 2026-05-06 flagged the historical confusion between
`shared/schema.ts` declarations and live database table count. To remove
ambiguity:

- **173 declared** — auditable, version-controlled,
  type-safe Drizzle schema in `shared/schema.ts`. This is what `db:push`
  manages and what `tests/security/` locks down.
- **212 live** — includes the four externally-managed Stripe
  Sync mirror tables (`stripe.accounts/products/prices/payment_intents`),
  internal pgvector tables, and historical tables not yet pruned.

Use the declared number for code reviews and schema audits. Use the live
number for ops/observability. Headline marketing copy may round to a single
combined figure as long as it stays within these bounds.

---

## How to keep this current

1. After any release that adds tools/skills/tables/personas, run
   `npx tsx scripts/refresh-totals.ts` and hand-reconcile the tool/skills/models
   rows against the verification commands above before committing.
2. The public mirror pulls this file through unchanged. Reference it in
   `README-PUBLIC.md` (link, not hardcoded numbers).

_Re-run with `--check` for drift detection (advisory, not a blind CI gate)._
