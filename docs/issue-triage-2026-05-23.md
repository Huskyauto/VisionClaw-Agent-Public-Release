# Project-Issues Triage Register — 2026-05-23 (R125+3.5)

Bob asked for a full ACCEPT / FIX / REJECT decision on every open project issue.
"Issues" = the entries in `docs/architecture-notes.md § Known defense-in-depth gaps (open)`
plus the CI-self-healer owner-digest queue. Agent-inbox is not enabled for this repl.

Triage framework: `.agents/skills/architect-finding-triage/SKILL.md`.

Severity classes used below:
- **FIX**  — action this session, lock-in or close.
- **ACCEPT** — explicitly defer / keep documented, no action this session (justified).
- **REJECT** — false-alarm / non-issue; keep documentation as tribal-knowledge only.

| # | Issue | Severity | Decision | Rationale |
|---|---|---|---|---|
| 1 | AHB `safety_profile` coverage (14 of 16 personas empty) | MEDIUM | **ACCEPT** | Only Felix + Robert take external traffic; the other 14 only receive internal subagent traffic from already-screened personas. Re-opens automatically on first external surface added to any of the 14. Tracked via `psql ... SELECT id,name,(safety_profile->>'intentGate') FROM personas`. |
| 2 | 4 skills in `_registry.json` review status `pending` | LOW (cosmetic) | **ACCEPT** | `pending` flag is review-promotion bookkeeping only; does NOT gate CI/CD. Promotion via `scripts/skills-registry.ts audit` is a real Claude-Haiku-API LLM run, not a free bookkeeping cycle — burning the spend on 4 stable load-bearing runbooks (post-edit-code-review, post-edit-pipeline, public-mirror-push, release-cutting) that I author and use weekly is poor ROI. Defer to next material edit to any of them. |
| 3 | Tool-embedding cache lag at startup log | LOW | **REJECT** (non-issue) | Source-of-truth is `TOOL_DEFINITIONS.length`; the startup log lag is informational, self-heals on next embedding-refresh tick. Keep the gap doc as tribal-knowledge so a future agent doesn't false-alarm on the log line. |
| 4 | Capability-registry drift (registry 92 vs aggregate over-claim) | MEDIUM | **ACCEPT** | Backfill of ~15 missed capability rows requires per-round forensic reconciliation across R98–R125; non-trivial work for cosmetic stat-accuracy gain. Plan stands: backfill incrementally when next ADDING a capability. |
| 5 | Stale model-registry candidates (Ling-2.6-1T:free, grok-4 test-path) | LOW | **ACCEPT** | Already silenced via `FRESHNESS_EXEMPT` at R109.4. The gap entry is documentation of the prior decision, not an actionable item. Will re-verify Ling at next quarterly model refresh. |
| 6 | R112 architect findings — 24 deferred until multi-user | HIGH-mix (5H + 7M + 8L) | **ACCEPT** | Explicit Bob policy (2026-05-14): "declined to implement until multi-user." Solo-user blast radius LOW today. Tier 1 (customer-safety) re-opens to HIGH on ANY second user (customer, teammate, public deploy). Already fully enumerated in Known-gaps for one-shot un-defer when trigger fires. |
| 7 | Video-job stale-cutoff vs heartbeat drift | MEDIUM | **ACCEPT** | Per-chapter heartbeat write inside runner loop is real work for marginal value at single-user volume. Defer to first multi-user video traffic. |
| 8 | Tier 1 `Accept-Encoding: br` portability | LOW | **REJECT** (non-issue) | Verified Node 20 undici supports brotli natively + production container ships brotli userland; only matters in hypothetical future container migration. Keep gap doc as tribal-knowledge. |
| 9 | Direct-upload callsites bypass `deliverDigitalProduct()` (29 executable sites) | HIGH (deferred R125+1.1) | **FIX — lock-in only; migration still deferred** | Architect's proposed shape was a 3-part plan: (a) migrate top customer-facing sites, (b) add CI regression test, (c) leave internal scratch on direct upload. Steps (a)+(c) require a dedicated R-round (multi-hour, 29-site audit, breakage risk on working pipelines). Step (b) — the CI regression test — is the **stop-the-bleeding** move and is FIXED THIS SESSION: NEW `tests/security/upload-direct-callsites.test.ts` snapshots all 29 audited callsites by `{file, line, text}`; any new direct-upload site fails CI with a pointer to the replit.md HARD RULE. Migration of the existing 29 sites stays deferred (still HIGH, still single-user-low blast radius) — but the surface area is now PINNED at 29 instead of growing silently. |
| 10 | Direct-test coverage gap for R106 nuggets (`failure-attribution`, `parallel-findings-bus`, `plan-graph`, `ssrf-jail`) | MEDIUM | **ACCEPT** | Each library exercises distinct mocking surface (DAG cycle rejection, private-IP/DNS-rebinding denial, bus read/publish boundaries, tenant scoping) — each test is hours, not minutes. Indirect coverage via chat-engine + html-app-builder integration paths exists. Plan stands: add when next touching any of these libs. |

**Owner-digest queue:** cleared in R125+3.4 (sql-raw-callsite-snapshot-drift baseline updated, test re-run CLEAN).

## Aggregate

- **1 FIX** (lock-in): regression test for direct-upload callsites.
- **7 ACCEPT** (documented deferrals with explicit re-open triggers).
- **2 REJECT** (non-issues kept as tribal-knowledge).

## Re-open triggers (auto-promote ACCEPT → action)

| # | Trigger |
|---|---|
| 1 | New external surface added to ANY of the 14 internal personas. |
| 2 | Material edit to any of the 4 pending skills. |
| 4 | Next R-round that genuinely adds a capability. |
| 5 | Next quarterly model-registry refresh. |
| 6 | First non-Bob human on the platform (customer, teammate, public deploy). |
| 7 | First non-Bob video render or any multi-user video traffic. |
| 9 (migration) | (a) Any new direct-upload site attempted — CI fails; (b) first non-Bob deliverable consumer; (c) opportunistic when next editing any of the 13 server files containing baselined sites. |
| 10 | Next material edit to `failure-attribution.ts`, `parallel-findings-bus.ts`, `plan-graph.ts`, or `ssrf-jail.ts`. |

## R-round classification

R125+3.5 — **no `+sec` suffix** despite a HIGH-related action, because the underlying HIGH (29-site migration) is NOT closed; only the lock-in component is added. Per architect-finding-triage's `+sec` rule, the bump requires a CRITICAL or HIGH **closed**, not "fenced." The lock-in genuinely prevents the HIGH from getting worse but does not eliminate the existing surface.
