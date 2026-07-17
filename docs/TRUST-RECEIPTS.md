# Trust Receipts — Every Claim, Its Evidence, and the Command to Verify It

VisionClaw makes large platform claims. This page is the fast index a skeptical
reviewer can use to check them in minutes, without trusting our word for
anything. Every row pairs a **claim** with the **file or test that backs it**
and the **exact command** that reproduces the proof on a clean checkout.

For the deep, round-by-round audit trail (architect review passes, call-site
line numbers, exploit-class coverage), see [`docs/EVIDENCE.md`](EVIDENCE.md).
For the authoritative live platform counts, see
[`docs/CURRENT_PLATFORM_TOTALS.md`](CURRENT_PLATFORM_TOTALS.md) — that file is
the single source of truth and is updated every release.

> **Stance.** We would rather show a real number we are driving down than ship
> a green-CI lie. Where a claim is partial or experimental, it says so.

---

## 1. The build actually compiles

| Claim | Evidence | Verify |
|---|---|---|
| The full production bundle builds end-to-end. | `.github/workflows/ci.yml` → `build` job (hard gate). | `npm ci && npm run build` |
| TypeScript is clean (no `any`-hiding behind `continue-on-error`). | `ci.yml` → `typecheck` job (hard gate). | `npm run check` |

A green CI badge means the latest **non-doc code change** passed both of these
gates. Docs/markdown-only commits intentionally skip CI (see `paths-ignore` in
`ci.yml`), so a docs-only push leaves the badge reflecting the last code commit.

## 2. Security is tested, not asserted

Every test under `tests/security/`, `tests/storage/`, `tests/safety/`,
`tests/queue/`, `tests/cost/`, and `tests/tools/` defends a specific exploit
class. The `security-tests` CI job is a **hard gate** — a failure blocks merge.

| Claim | Evidence | Verify |
|---|---|---|
| SSRF + DNS-rebinding are blocked on every outbound fetch. | `tests/security/ssrf.test.ts` | `node --import tsx --test tests/security/ssrf.test.ts` |
| Admin routes reject anonymous escalation (even with no PIN set). | `tests/security/admin-gate.test.ts` | `node --import tsx --test tests/security/admin-gate.test.ts` |
| Tenant isolation: no INSERT may omit `tenantId`. | `tests/storage/tenant-isolation.test.ts` | `node --import tsx --test tests/storage/tenant-isolation.test.ts` |
| `tenantScope()` rejects every fail-open shape (`0`/`NaN`/`"1"`/…). | `tests/storage/tenant-scope.test.ts` | `node --import tsx --test tests/storage/tenant-scope.test.ts` |
| Destructive shell/db commands are denied (`db:push --force`, `DROP TABLE`, `rm -rf /`, `git push --force`). | `tests/safety/*.test.ts` | `node --import tsx --test tests/safety/*.test.ts` |
| The whole security gate (what CI runs). | `.github/workflows/ci.yml` → `security-tests`. | `node --import tsx --test tests/security/*.test.ts tests/storage/*.test.ts tests/queue/*.test.ts tests/safety/*.test.ts tests/cost/*.test.ts tests/tools/*.test.ts` |

## 3. The Docker image actually boots

| Claim | Evidence | Verify |
|---|---|---|
| The container builds and answers a liveness probe. | `ci.yml` → `docker` job (hard gate) builds the image, boots it against a real Postgres, and probes `/healthz`. | See [`QUICKSTART_DOCKER.md`](../QUICKSTART_DOCKER.md) |

## 4. Supply chain is scanned

| Claim | Evidence | Verify |
|---|---|---|
| Dependencies are audited in CI; criticals block. | `ci.yml` → `dependency-audit` job. | `npm audit --omit=dev` |
| Automated dependency-update PRs run weekly. | `.github/dependabot.yml`. | (runs on GitHub) |

We are honest about the current state: there are transitive **high** advisories
in the `googleapis` / `google-cloud-storage` dependency chain (`gaxios` → `uuid`)
that require an upstream major bump to clear. CI gates on **critical** (0 today)
and surfaces the high/moderate count on every run so the trend is visible rather
than hidden.

## 5. Autonomy is opt-in, off by default

The platform can self-modify and act autonomously — but every high-blast-radius
capability ships **disabled**. See the full matrix in
[`docs/PRODUCTION-SAFETY.md`](PRODUCTION-SAFETY.md).

| Claim | Evidence | Verify |
|---|---|---|
| Self-repair auto-fix is off unless explicitly enabled. | `.env.example` → `REPAIR_AUTOFIX_ENABLED=0`. | `grep REPAIR_AUTOFIX_ENABLED .env.example` |
| The platform has no write access to its own source unless a token is set. | `.env.example` → `GITHUB_TOKEN` commented out, with a written warning. | `grep -n GITHUB_TOKEN .env.example` |

## 6. Platform scale claims

The headline counts (tools, tables, indexes, capabilities, personas, skills)
are maintained in one place and quoted everywhere from it.

| Claim | Evidence | Verify |
|---|---|---|
| All scale numbers trace to one source of truth. | [`docs/CURRENT_PLATFORM_TOTALS.md`](CURRENT_PLATFORM_TOTALS.md) | open the file |
| Persona count. | `client/src/pages/about.tsx` `PERSONAS` array. | `grep -c "name:" client/src/pages/about.tsx` |

---

## Reproduce the whole gate in one shot

```bash
git clone <this repo> && cd <repo>
npm ci
npm run build      # build hard gate
npm run check      # typecheck hard gate
npm audit --omit=dev   # supply-chain visibility
node --import tsx --test tests/security/*.test.ts tests/storage/*.test.ts \
  tests/queue/*.test.ts tests/safety/*.test.ts tests/cost/*.test.ts tests/tools/*.test.ts
```

If any hard gate fails on `main`, that is a bug — please open an issue.
