# Current Platform Totals — Single Source of Truth

> **This is the authoritative count for VisionClaw Agent.** Every other doc
> (README, SETUP, FORK-SETUP, ROADMAP, CONTRIBUTING, GitHub repo description)
> must agree with the numbers here. If you find a mismatch, fix the other doc
> — not this one.

**Last verified:** 2026-07-01 (manual — `psql $DATABASE_URL` live counts + source-tree greps)
**Verification method:** Live runtime counts from the production database
plus source-tree grep against `server/` and `shared/`. `scripts/refresh-totals.ts`
regenerates this file from live registries and has a `--check` mode
(`npx tsx scripts/refresh-totals.ts --check` → exit 1 if the doc would change) for
drift detection. It is run by hand during `website-surface-sync` / release passes
rather than as a blind CI gate, because its raw `registerTool(` grep OVERCOUNTS the
tool total (the authoritative 394 comes from the `replit.md` 3-source reconciliation,
not the grep) — so the generator's tool number must be reconciled by hand before it
can gate CI. Everything else it emits (tables/skills/personas/gov/indexes) is exact.

---

## Authoritative Counts

| Metric | Value | How it's verified |
|---|---|---|
| **AI agent personas (active)** | **16** | `SELECT count(*) FROM personas WHERE is_active=true` |
| **Built-in tools** | **394** | Verified across 3 runtime sources (`replit.md` aggregate; the raw `registerTool(` grep overcounts) |
| **Skills (DB seeded)** | **62** | `SELECT count(*) FROM skills` |
| **Skills (total: DB + `.agents/skills/` + `data/output-skills/`)** | **133** | 62 DB + 33 `.agents/skills/` dirs + 38 `data/output-skills/` registered (`_registry.json`; 1 unregistered `.md` on disk not counted) |
| **Database tables (declared)** | **173** | `rg -c "pgTable(" shared/schema.ts` |
| **Database tables (live in `public` schema)** | **212** | `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'` |
| **Governance rules** | **41** | `SELECT count(*) FROM governance_rules` |
| **Capabilities (active)** | **129** | `SELECT count(*) FROM capabilities` |
| **Production indexes (all)** | **623** | `SELECT count(*) FROM pg_indexes WHERE schemaname='public'` |
| **Production indexes (non-PK)** | **409** | `SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname NOT LIKE '%_pkey'` |
| **AI providers** | **6** | OpenAI, Anthropic, Google, xAI, OpenRouter, Perplexity |
| **AI models (core registry)** | **41 curated** | `MODEL_REGISTRY.length` in `server/providers.ts` |
| **AI models (daily catalog discovery)** | **1000+** | Nightly OpenRouter scanner (`server/model-catalog.ts`) |

---

## Why the schema-declared vs. live-DB delta exists

The HyperAgent review of 2026-05-06 flagged the historical confusion between
`shared/schema.ts` declarations and live database table count. To remove
ambiguity:

- **173 declared** — auditable, version-controlled,
  type-safe Drizzle schema in `shared/schema.ts`. This is what `db:push`
  manages and what `tests/security/` locks down. (Additional declarations live
  in `shared/models/*.ts` and the deprecated `shared/schema-orphans.ts`.)
- **212 live** — includes the externally-managed Stripe
  Sync mirror tables, internal pgvector tables, and historical tables not yet
  pruned.

Use the declared number for code reviews and schema audits. Use the live
number for ops/observability and headline marketing copy (the public surfaces
quote **212 tables / 623 indexes**).

---

## How to keep this current

1. After any release that adds tools/skills/tables/personas, rerun the live
   `psql` queries above and the `.agents/skills/` + `data/output-skills/`
   directory counts, then update the table and the **Last verified** date.
2. The public mirror references this file (link, not hardcoded numbers) via
   `README-PUBLIC.md`.
