import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { HomeReleaseArchive } from "@/components/home-release-archive";

export function HomeReleaseUpdates({ releaseExpanded, toggleRelease }: {
  releaseExpanded: Set<string>;
  toggleRelease: (id: string) => void;
}) {
  const [showAllUpdates, setShowAllUpdates] = useState(false);

  return (
    <>
        {/* R128 (2026-09-11) — NEW (teal): model-agnostic delegation contracts. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r128")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-teal-500/10 via-primary/5 to-transparent border border-teal-500/30 hover:border-teal-500/50 hover:bg-teal-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r128"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-teal-600 text-white leading-none shrink-0 mt-0.5">R128 NEW</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r128") ? "" : "line-clamp-2"}`}>{"Model-agnostic delegation contracts — main-agent guidance now requires explicit outcomes, file ownership, authority limits, known facts, verification, evidence requirements, bounded context, and stop conditions for substantial subagents."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r128") ? "" : "truncate"}`}>{"Guidance and regression gates, not runtime interception · read-only fan-out · disjoint writer ownership · risk-based independent review · provenance-aware handoffs · no fixed model roles or new model calls."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r128") ? "rotate-180" : ""}`} />
        </button>
        {/* R127+sec (2026-09-11) — historical (violet): state-grounded plan memory. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r127")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r127"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R127+sec</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r127") ? "" : "line-clamp-2"}`}>{"State-grounded plan memory — persisted plans now carry a compact checker-derived view of unresolved goals, verified progress, blockers, failures, evidence gaps, and relevant declared tools into each next execution step."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r127") ? "" : "truncate"}`}>{"Exact opt-in · zero additional model calls · tenant-scoped idempotent events · bounded to 8,000 prompt characters · HIGH closures for stale replan-ID collisions and oversized declared tools · untrusted JSON data framing."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r127") ? "rotate-180" : ""}`} />
        </button>
        {/* R126+sec (2026-09-11) — historical (orange): AI Task Fit & Human Agency Audit. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r126_sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-orange-500/10 via-primary/5 to-transparent border border-orange-500/30 hover:border-orange-500/50 hover:bg-orange-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r126_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-orange-600 text-white leading-none shrink-0 mt-0.5">R126+sec</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r126_sec") ? "" : "line-clamp-2"}`}>{"AI Task Fit & Human Agency Audit — owner-reviewed manual paid service with exact-off production launch, durable replay-safe orders, and reviewed delivery. HIGH #1: paid orders could disappear from an ephemeral queue or age out during compaction; database mirroring now serializes adds/updates, repairs deduplicated retries, and preserves unresolved orders. HIGH #2: durable PDF copies could disconnect after publish; queue identities now rehydrate tenant-scoped storage and fail closed on invalid bytes. HIGH #3: prohibited employment and affiliation phrasing could bypass checks; conservative clause-local validation rejects workforce actions and protected-source affiliation claims while allowing exact neutral limits. MEDIUM #1: PDF parsing and cleanup lacked bounds; a killable child process enforces byte/page/text/output/deadline caps and replacement cleanup. MEDIUM #2: compaction could return the wrong order after terminal transition; updates re-find by stable order id. Followups: final reviews closed retry repair, cache-loss recovery, orphan cleanup, neutral-limit handling, hard parser termination, unresolved-order retention, selector validation, path-confined deletion, and compaction identity."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r126_sec") ? "" : "truncate"}`}>{"417 tools · 67 skills · 18 personas · 168 declared / 246 live tables · 767 indexes · 137 capabilities · 41 governance rules · $497/$1,997 packages · exact-off manual owner review · 29/29 focused tests · storefront remains pending explicit owner approval; no live storefront implied."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r126_sec") ? "rotate-180" : ""}`} />
        </button>
        {/* R125+155.23+sec (2026-09-11) — Historical: Commercial Research Frontier owner workspace. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_23_sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_23_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+155.23+sec Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_23_sec") ? "" : "line-clamp-2"}`}>{"Commercial Research Frontier owner workspace — search, filter, inspect, create, and edit the evidence portfolio with bounded navigation and complete score transparency."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_23_sec") ? "" : "truncate"}`}>{"Owner-only and exact-opt-in · all 13 score factors visible · no outreach, payments, missions, publishing, or trading."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_23_sec") ? "rotate-180" : ""}`} />
        </button>
         <button onClick={() => toggleRelease("banner-whats-new-r125_155_19")} className="w-full text-left rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 transition-colors px-4 py-3" data-testid="banner-whats-new-r125_155_19">
           <div className="text-sm font-semibold">R125+155.19 Historical — Bounded Human-AI Synergy Trial</div>
           <div className="mt-0.5 text-xs text-muted-foreground">Owner-only, tenant-scoped, report-only three-arm comparison; zero model calls and no hiring or causal claims.</div>
         </button>
          <div id="home-recent-historical-releases" data-testid="home-recent-releases" className={`space-y-5 [&>button]:relative [&>button]:before:absolute [&>button]:before:right-3 [&>button]:before:top-3 [&>button]:before:rounded-sm [&>button]:before:bg-muted [&>button]:before:px-1.5 [&>button]:before:py-0.5 [&>button]:before:text-[10px] [&>button]:before:font-bold [&>button]:before:content-['Historical'] ${showAllUpdates ? "" : "hidden"}`}>
         <button onClick={() => toggleRelease("banner-whats-new-r125_155_18")} className="w-full text-left rounded-lg bg-gradient-to-r from-indigo-500/10 via-primary/5 to-transparent border border-indigo-500/30 transition-colors px-4 py-3" data-testid="banner-whats-new-r125_155_18">
           <div className="text-sm font-semibold">R125+155.18+sec Historical — Durable full-archive opportunity review</div>
           <div className="mt-0.5 text-xs text-muted-foreground">Bounded top-30 simulation and verified report delivery across the scored archive.</div>
         </button>
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_22_sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 transition-colors px-4 py-3"
          data-testid="banner-whats-new-r125_155_22_sec"
        >
          <div className="text-sm font-semibold">R125+155.22+sec — Commercial Research Frontier API and database foundation</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Owner-only CRUD, deterministic scoring, atomic lifecycle validation, and database-enforced evidence integrity.</div>
        </button>
        {/* R125+155.9+sec (2026-09-06) — historical: always hidden until expanded. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_9_sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-rose-500/10 via-primary/5 to-transparent border border-rose-500/30 hover:border-rose-500/50 hover:bg-rose-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_9_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+155.9+sec Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_9_sec") ? "" : "line-clamp-2"}`}>{"Evidence-backed owner decisions — Claude Fable 5.1 is now an explicit owner-only final-decision option, never an automatic customer route. Every paid result stays buffered until valid provider usage is durably recorded. Also shipped: proof-backed capability evidence, content-free Built With Bob oversight, adaptive Astra report budgeting, and deterministic `[S#]` research citations."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_9_sec") ? "" : "truncate"}`}>{"417 tools · 80 curated models + 1000+ discovered daily · 135 capabilities · 18 personas · 165 declared / 242 live tables · 743 indexes · 41 governance rules — 37/37 focused tests, live exact-model proof, build, wiring audit, and independent review PASS."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_9_sec") ? "rotate-180" : ""}`} />
        </button>
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_8_sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_8_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+155.8+sec Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_8_sec") ? "" : "line-clamp-2"}`}>{"R125+155.8+sec — Public Release Integrity. Fresh public checkouts carry self-contained mirror fixtures; complete public-test classification fails closed; generated facts distinguish 417 total registered from 386 publicly documented tools."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_8_sec") ? "" : "truncate"}`}>{"RLS guidance and its value-free receipt accurately describe opt-in enforcement, while repository and component licensing remain precise."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_8_sec") ? "rotate-180" : ""}`} />
        </button>
        {/* R125+155.7+sec (2026-09-04) — DEMOTED (violet): bounded relational memory context. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_7_sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_7_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+155.7+sec Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_7_sec") ? "" : "line-clamp-2"}`}>{"R125+155.7+sec — Bounded relational memory context. Complex turns can connect typed memory relationships without recursive model calls; default shadow mode never changes prompts."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_7_sec") ? "" : "truncate"}`}>{"HIGH closed: recalled facts cannot imitate prompt fences. Both graph endpoints are tenant-scoped; live packets are confidence/top-k/character bounded with a database-enforced deadline. 17/17 focused checks passed."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_7_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155.5+sec (2026-09-03) — DEMOTED (rose): reliable supplied-roster SAM routing. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_5_sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-rose-500/10 via-primary/5 to-transparent border border-rose-500/30 hover:border-rose-500/50 hover:bg-rose-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_5_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+155.5+sec Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_5_sec") ? "" : "line-clamp-2"}`}>{"R125+155.5+sec — Reliable supplied-roster SAM routing. Exact, supplied-batch, and discovery requests stay on their correct authoritative path across main, engine, and public chat."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_5_sec") ? "" : "truncate"}`}>{"Mandatory tools survive production caps; server-owned dispatch locks block wrong modes, introspection, and web/delegation fallbacks."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_5_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155.4 (2026-09-03) — DEMOTED (sky): reliable SAM reports and Gemini routing. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_4")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-sky-500/10 via-primary/5 to-transparent border border-sky-500/30 hover:border-sky-500/50 hover:bg-sky-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_4"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-sky-600 text-white leading-none shrink-0 mt-0.5">R125+155.4 Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_4") ? "" : "line-clamp-2"}`}>{"R125+155.4 — Reliable SAM reports and Gemini 3.7 routing. SAM.gov reports keep a verified durable database copy before Drive delivery, retired Gemini 3.5 routes normalize to 3.7, and Wikipedia misses return a normal result."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_4") ? "" : "truncate"}`}>{"52 focused regressions, all 247 Node suites effectively green, and final independent architect plus silent-failure reviews passed."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_4") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155.3 (2026-09-03) — DEMOTED (emerald): economical parallel-agent workers. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_3")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_3"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+155.3 Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_3") ? "" : "line-clamp-2"}`}>{"R125+155.3 — Economical parallel-agent workers. Nemotron 3 Super is now the first worker in VisionClaw's built-in cheap multi-agent proposer pool and the first economical seat in the mixed pool, helping parallel tasks finish with a stronger cost-to-capability balance."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_3") ? "" : "truncate"}`}>{"Free-only remapping and runtime overrides still win; frontier, premium, final-synthesis, tenant, spend-ceiling, and quarantine contracts remain unchanged. 38/38 focused assertions and final independent architect review passed."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_3") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155.2+sec13 (2026-09-03) — DEMOTED (violet): cost-aware fallback and quarantine. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_2_sec13")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_2_sec13"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+155.2+sec13 Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_2_sec13") ? "" : "line-clamp-2"}`}>{"R125+155.2+sec13 — Cost-aware Nemotron routing and provider quarantine. Powerful and reasoning work prefers Nemotron 3 Super when paid OpenRouter capacity is required, with exact accounting and provider quarantine at selection and client resolution."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_2_sec13") ? "" : "truncate"}`}>{"15/15 focused pricing and routing assertions, TypeScript, production build, stale-string and wiring gates, application restart, and final independent architect PASS."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_2_sec13") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155.2+sec11 (2026-08-30) — DEMOTED (indigo): provider-independent, spend-bounded jury recovery. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_2_sec11")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-indigo-500/10 via-primary/5 to-transparent border border-indigo-500/30 hover:border-indigo-500/50 hover:bg-indigo-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_2_sec11"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-indigo-600 text-white leading-none shrink-0 mt-0.5">R125+155.2+sec11 Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_2_sec11") ? "" : "line-clamp-2"}`}>{"R125+155.2+sec11 — Provider-independent jury recovery and spend-boundary hardening. **HIGH #1:** paid recovery now rechecks the canonical kill switch at the provider choke point. **HIGH #2:** direct Z.AI can no longer be reached through generic routing. **MEDIUM #1:** failed OpenRouter recovery is sidelined. **MEDIUM #2:** paid usage gets an estimate unless durable ledger persistence is confirmed."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_2_sec11") ? "" : "truncate"}`}>{"415 tools, 135 capabilities, 18 personas, 182 declared / 237 live tables, 720 platform indexes, and 41 governance rules — live strict-majority jury recovery, focused regressions, typecheck, production build, and independent reviews passed."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_2_sec11") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155.2+sec9 (2026-08-27) — DEMOTED (amber): binary-safe uploads with fail-closed completion recovery. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_2_sec9")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_2_sec9"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+155.2+sec9 Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_2_sec9") ? "" : "line-clamp-2"}`}>{"R125+155.2+sec9 — Fail-closed Drive delivery completion. Any non-definitive post-dispatch outcome requires reconciliation, not a repeat upload. Raw bytes remain read-back verified, and recovered receipts repair missing file sharing before any delivery can continue."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_2_sec9") ? "" : "truncate"}`}>{"28 focused delivery/content/tenant checks, 414 tools, 135 capabilities, 18 personas, 182 declared / 237 live tables, 720 platform indexes, and 41 governance rules — full 241-suite run, typecheck, and production build passed."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_2_sec9") ? "rotate-180" : ""}`} />
        </button>

        <p className="text-xs text-muted-foreground px-1" data-testid="text-historical-release-notice">
          Historical release snapshots — figures below describe their release dates and do not represent current platform totals.
        </p>
        {/* R125+155.2+sec5 (2026-08-27) — DEMOTED (amber): dependency remediation removed high and critical audit exposure. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_2_sec5")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_2_sec5"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+155.2+sec5 Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_2_sec5") ? "" : "line-clamp-2"}`}>{"R125+155.2+sec5 — Dependency remediation removed all high- and critical-severity audit exposure. The primary application production image runs Node 22.12+, matching puppeteer-core 25.9.0, and defuddle was refreshed to 0.19.3."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_2_sec5") ? "" : "truncate"}`}>{"0 high / 0 critical advisories; 9 moderate / 1 low remained for later review — 414 tools, 135 capabilities, 18 personas, 182 declared / 237 live tables, 720 platform indexes, 41 governance rules. Full 240-suite run, typecheck, production build, and restart passed."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_2_sec5") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155.2+sec4 (2026-08-27) — DEMOTED (emerald): final media is durable by default and private staging cannot publish. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_2_sec4")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_2_sec4"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+155.2+sec4 Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_2_sec4") ? "" : "line-clamp-2"}`}>{"R125+155.2+sec4 — **Final customer media now completes only after verified Drive durability, while renderer staging stays private.** **HIGH #1:** temporary narration cannot enter instant-play. **HIGH #2:** caller-supplied local-only flags cannot bypass final video verification. **HIGH #3:** pending and routed owner attention stays visible while terminal history is excluded. **HIGH #4:** private renderer capabilities survive the trusted dispatcher boundary without becoming caller-controlled."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_2_sec4") ? "" : "truncate"}`}>{"**414 tools**, **135 capabilities**, **18 personas**, **180 declared / 235 live tables**, **709 platform indexes**, **41 governance rules** — 5 durability regressions, full 238-suite run, typecheck, production build, and clean final independent review."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_2_sec4") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155.2+sec3 (2026-08-26) — DEMOTED (sky): durable artifact manifests make delivery receipts recoverable. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_2_sec3")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-sky-500/10 via-primary/5 to-transparent border border-sky-500/30 hover:border-sky-500/50 hover:bg-sky-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_2_sec3"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-sky-600 text-white leading-none shrink-0 mt-0.5">R125+155.2+sec3 Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_2_sec3") ? "" : "line-clamp-2"}`}>{"R125+155.2+sec3 — **Durable work and delivery records connect every generated artifact to its verified Drive receipt, checksum, revision, source delivery, and lifecycle history.** Vault users can inspect, reconcile, resend, and explicitly resolve uncertain delivery without duplicating remote work. **HIGH #1:** delivery retry refuses a duplicate Drive upload after a receipt. **HIGH #2:** uncertain email results remain visible until confirmed or explicitly resolved."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_2_sec3") ? "" : "truncate"}`}>{"Tenant-scoped artifact receipts and lifecycle records — focused durable-record tests, typecheck, production build, and final security review are clean."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_2_sec3") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155.2+sec2 (2026-08-26) — DEMOTED (cyan): recovery evidence is append-only, tenant-safe, and inspect-only. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_2_sec2")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_2_sec2"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+155.2+sec2 Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_2_sec2") ? "" : "line-clamp-2"}`}>{"R125+155.2+sec2 — **Recovery evidence is now an append-only, tenant-safe timeline for inspection, never execution.** You can inspect sanitized run and trace boundaries without creating a path to resume, retry, rerun, or mutate work. **HIGH #1:** source identities are checked against the active workspace before capture. **HIGH #2:** untrusted strings and object keys become value-free correlation metadata. **HIGH #3:** run state and trace boundaries share one atomic sequence."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_2_sec2") ? "" : "truncate"}`}>{"**414 tools**, **135 capabilities**, **18 personas**, **180 declared / 235 live tables**, **709 platform indexes**, **41 governance rules** — 7 focused regressions, typecheck, production build, wiring audit, restart, and clean final security reviews."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_2_sec2") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155.2+sec (2026-08-25) — DEMOTED (violet): authoritative operational runbooks cannot be impersonated or cross-scoped. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_2_sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_2_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+155.2+sec Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_2_sec") ? "" : "line-clamp-2"}`}>{"R125+155.2+sec — **Trusted operational runbooks now have reserved provenance and explicit persona-scoped retrieval.** Tenant-controlled knowledge cannot impersonate authoritative guidance, and embeddings are persisted only when they match the runbook's content."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_2_sec") ? "" : "truncate"}`}>{"**414 tools**, **135 capabilities**, **155 reference surfaces**, **18 personas**, **179 declared / 234 live tables**, **703 indexes**, **41 governance rules** — focused provenance, persona-scope, embedding, typecheck, build, and independent review gates are clean."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_2_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155.2 (2026-08-25) — DEMOTED (sky): CMMC delivery atomically claims the report and approval before customer delivery. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155_2")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-sky-500/10 via-primary/5 to-transparent border border-sky-500/30 hover:border-sky-500/50 hover:bg-sky-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155_2"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-sky-600 text-white leading-none shrink-0 mt-0.5">R125+155.2</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155_2") ? "" : "line-clamp-2"}`}>{"R125+155.2 — **CMMC delivery now atomically claims the exact report and records approval before any Drive or email side effect.** Generate and deliver actions cannot race each other into an inconsistent assessment state; retryable failures remain retryable, while unknown in-progress sends remain protected from automatic reclamation."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155_2") ? "" : "truncate"}`}>{"**414 tools**, **135 capabilities**, **155 reference surfaces**, **18 personas**, **179 declared / 234 live tables**, **703 indexes**, **41 governance rules** — 9 focused CMMC contract/report regressions clean locally; database-backed race coverage was validated in the prior run, alongside typecheck, production build, and independent reviews."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155_2") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155+sec12 (2026-08-23) — DEMOTED (violet): descriptor-verified retry sources reject symlink/path swaps before delivery state changes. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155sec12")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155sec12"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+155+sec12</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155sec12") ? "" : "line-clamp-2"}`}>{"R125+155+sec12 — **Customer-delivery retries now use a descriptor-verified byte snapshot, not a pathname that can change underneath them.** **HIGH #1:** malformed, missing, non-file, escaped, final-symlink, ancestor-symlink, and swapped sources are refused before retry state changes. Safe retries preserve the original media type while delivering the checked regular file."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155sec12") ? "" : "truncate"}`}>{"**414 tools**, **134 capabilities**, **155 reference surfaces**, **18 personas**, **135 declared / 230 live tables**, **679 indexes**, **41 governance rules** — 14 focused delivery/tenant/contract regressions, typecheck, production build, stale-string preflight, wiring audit, public browser smoke, and two independent reviews."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155sec12") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155+sec10 (2026-08-23) — DEMOTED (violet): bounded context acquisition and honest model × harness evaluation. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155sec10")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155sec10"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+155+sec10</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155sec10") ? "" : "line-clamp-2"}`}>{"R125+155+sec10 — **Context acquisition and model × harness evaluation now report only evidence that is safe, complete, and comparable.** The new bounded scorer remains report-only: it cannot alter live routing, prompts, models, or data. **HIGH #1:** a structural security failure zeroes and disqualifies the full configuration. **MEDIUM #1:** every configuration must meet its own coverage floor, so a strong global average cannot hide incomplete evidence."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155sec10") ? "" : "truncate"}`}>{"**413 tools**, **134 capabilities**, **155 reference surfaces**, **18 personas**, **135 declared / 230 live tables**, **679 indexes**, **41 governance rules** — 6 focused regressions, CLI fixture report, full 238-suite run, typecheck, production build, wiring audit, and two independent reviews."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155sec10") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155+sec9 (2026-08-22) — DEMOTED (fuchsia): owner-only frontier research archive and strict report integrity. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155sec9")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-fuchsia-500/10 via-primary/5 to-transparent border border-fuchsia-500/30 hover:border-fuchsia-500/50 hover:bg-fuchsia-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155sec9"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-fuchsia-600 text-white leading-none shrink-0 mt-0.5">R125+155+sec9</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155sec9") ? "" : "line-clamp-2"}`}>{"R125+155+sec9 — **Frontier revenue research is now browseable from Projects without becoming a product, mission, outreach, payment, or customer record.** Accepted novel concepts and raw jury research stay separate and owner-only. **HIGH #1:** non-interactive tenant API keys cannot access owner evidence. **MEDIUMs:** artifact delivery requires the authenticated owner route, research responses are not cached, and unsafe or non-regular report entries fail closed."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155sec9") ? "" : "truncate"}`}>{"**413 tools**, **134 capabilities**, **155 reference surfaces**, **18 personas**, **135 declared / 230 live tables**, **679 indexes**, **41 governance rules** — 12 focused regressions, full 234-suite run, typecheck, browser coverage, stale-string preflight, wiring audit, and clean final reviews."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155sec9") ? "rotate-180" : ""}`} />
        </button>

        </div>
        <button
          onClick={() => setShowAllUpdates(v => !v)}
          className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2 rounded-lg border border-border/60 hover:border-border hover:bg-muted/40 transition-colors text-xs text-muted-foreground"
          data-testid="button-toggle-all-updates"
          aria-expanded={showAllUpdates}
          aria-controls="home-recent-historical-releases home-older-updates"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAllUpdates ? "rotate-180" : ""}`} />
          {showAllUpdates ? "Hide older updates" : "Show older updates"}
        </button>

        <div id="home-older-updates" className={`space-y-5 [&>button]:relative [&>button]:before:absolute [&>button]:before:right-3 [&>button]:before:top-3 [&>button]:before:rounded-sm [&>button]:before:bg-muted [&>button]:before:px-1.5 [&>button]:before:py-0.5 [&>button]:before:text-[10px] [&>button]:before:font-bold [&>button]:before:content-['Historical'] ${showAllUpdates ? "" : "hidden"}`}>
        <p className="text-xs text-muted-foreground px-1">
          Historical release archive — every card below is a release-time snapshot, not a current platform-total claim.
        </p>
        {/* R125+155+sec5 (2026-08-19) — DEMOTED (emerald): Tenant-isolation hardening across identity, analysis, commerce, and reset credentials. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155sec5")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155sec5"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+155+sec5</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155sec5") ? "" : "line-clamp-2"}`}>{"R125+155+sec5 — **Tenant isolation now holds across account changes, automatic insights, commerce links, and password resets.** Switching identities cancels stale work before a prior customer’s state can render or replay; tenant analysis stays tenant-local; catalog and payment links prove mission ownership; and reset links bind an opaque 256-bit secret to the customer it belongs to."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155sec5") ? "" : "truncate"}`}>{"**413 tools**, **134 capabilities**, **155 reference surfaces**, **18 personas**, **229 tables**, **679 indexes**, **41 governance rules** — 30 focused regressions, full 232-suite run, typecheck, production build, browser smoke test, wiring audit, and independent final reviews clean."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155sec5") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155+sec3 (2026-08-19) — DEMOTED (rose): Tenant-isolation audit remediation. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155sec3")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-rose-500/10 via-primary/5 to-transparent border border-rose-500/30 hover:border-rose-500/50 hover:bg-rose-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155sec3"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+155+sec3</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155sec3") ? "" : "line-clamp-2"}`}>{"R125+155+sec3 — **A bounded tenant-isolation audit remediation closes two HIGH findings and one MEDIUM.** Agent-run mutations now prove both the run and customer identity before changing state. The repaired automatic memory path works one tenant at a time with stable cursors and prompt-bounded batches, retains sparse activity for later context, and advances only after its durable write. Approval claims now record their audit step atomically and retain recoverable state until the run reaches a terminal outcome."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155sec3") ? "" : "truncate"}`}>{"**413 tools**, **134 capabilities**, **155 reference surfaces**, **18 personas**, **229 tables**, **679 indexes**, **41 governance rules** — focused tenant checks, full 232-suite regression, wiring audit, and two independent final reviews clean."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155sec3") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155+sec2 (2026-08-19) — DEMOTED (red): Managed DB-skill prompt boundary hardened + honest agents + generic video-retention guidance. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155sec2")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-red-500/10 via-primary/5 to-transparent border border-red-500/30 hover:border-red-500/50 hover:bg-red-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155sec2"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-red-600 text-white leading-none shrink-0 mt-0.5">R125+155+sec2</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155sec2") ? "" : "line-clamp-2"}`}>{"R125+155+sec2 — **Unsafe database-backed skills can no longer slip into an agent's system prompt through alternate write paths.** Every admin, marketplace, proposal, seed, phantom-memory, and tool-driven skill mutation now crosses one fail-closed storage boundary. Active skills are validated again immediately before prompt injection, with atomic locked updates, active-status filtering, categorical oversize blocking, Unicode/confusable normalization, and safe pattern-only errors. Two independent final reviews found no Critical, High, or Medium issues. **More honest conversations:** every persona now avoids automatic agreement and can validate emotions without endorsing unsupported beliefs. **Stronger generic video planning:** non-recap videos now open a real curiosity gap, delay the payoff, progress meaningfully slide to slide, and use only natural non-invented calls to action. The dedicated Built With Bob weekly recap path, Bob's Fish voice, real clips, and protected weight facts are unchanged."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155sec2") ? "" : "truncate"}`}>{"**413 tools**, **134 capabilities**, **155 reference surfaces**, **18 personas**, **229 tables**, **679 indexes**, **41 governance rules** — R125+155+sec2 closes the managed-skill prompt-injection HIGH at both write and read boundaries; 25/25 focused checks, 63 live skills audited, two independent reviews clean."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155sec2") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+155+sec (2026-08-18) — DEMOTED (violet): Skill-precision defense + 72h security review closing 1 HIGH + 2 MEDIUM. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_155sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_155sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+155+sec Historical</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_155sec") ? "" : "line-clamp-2"}`}>{"R125+155+sec — **Sharper skill focus for every agent, plus a full-platform security review with three fixes shipped.** **Skill-precision defense:** research shows AI agents get less precise as their skill library grows — every skill handed to an agent is now tagged with its semantic fit to the current request (High = follow it, Medium = adapt it, Low = background only), with a hard rule that a skill the user explicitly names always wins regardless of tag. The scoring is strictly advisory and fails open: any failure or slow response (1.5-second budget) falls back to exactly the old behavior. A new weekly watchdog also compares all 70+ skills pairwise and flags near-duplicates for merge or prune before they blur agent precision (first live run: zero merge-worthy duplicates). **Security review (72-hour window + all sensitive areas, two independent passes plus a fix-verification pass):** **HIGH #1** — a WhatsApp approval sender authorized for one customer could, on a short-code collision, approve a DIFFERENT customer's pending dangerous action; both approval paths now verify the pending action belongs to the approver's own tenant before resolving. **MEDIUM #1** — research reports were rendering 'Evidence Confidence: n/a' because the confidence rating was dropped during assembly (and on section retry); it's preserved end-to-end now. **MEDIUM #2** — WhatsApp-connected approval requests were auto-denying at 2 minutes instead of the configured 10 because the timer armed before the configuration loaded; the timer now honors the real window while keeping the fail-closed default."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_155sec") ? "" : "truncate"}`}>{"**413 tools**, **134 capabilities**, **155 reference surfaces**, **18 personas**, **229 tables**, **679 indexes**, **41 governance rules** — R125+155+sec adds fit-tagged skill injection + the weekly skill-confusability watchdog, and closes 1 HIGH + 2 MEDIUM from the 72h full-platform review."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_155sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+154 (2026-08-17) — DEMOTED (cyan): Loop-integrity governance skill + delivery-email backup links + publish reliability restored. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_154")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_154"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+154</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_154") ? "" : "line-clamp-2"}`}>{"R125+154 — **One integrity rulebook for every self-improving loop, backup links on media delivery emails, and publishing un-stuck.** **Loop-integrity policy (new governance skill, skills 52 → 53):** every loop that changes the platform's own behavior — the nightly skill optimizer, the research engine, the multi-model jury's auto-apply lane, self-harness prompt addenda, repair autofix, and plan-replay — is now governed by one unified 5-principle evaluator-integrity contract with a 9-line audit checklist: the thing being improved must never reach the thing judging it; LLM-reviews-LLM is advisory, never structural; held-out never-seen signals close the metric-gaming channel; quality gates fail open while safety gates fail closed; and every relaxation of a loop's gate must itself pass the audit. Distilled from the AQuA and CUDA Agent papers plus the platform's own verifier-gaming incidents; architect-reviewed with zero corrections. **Delivery emails hardened:** video and audio delivery emails now include a permanent Google Drive backup link alongside the instant-play button whenever a Drive view link is available, so a customer can still get their file even if the instant-play route is ever unavailable. **Publishing un-stuck:** a failed publish was traced to stale auto-added port mappings in the project config — workspace test servers had appended four phantom ports that production never opens, so the deploy sat at 'waiting to be ready' until timeout; the config is back to the single real port and the failure mode is documented so it can't recur silently."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_154") ? "" : "truncate"}`}>{"**413 tools**, **134 capabilities**, **155 reference surfaces**, **18 personas**, **229 tables**, **679 indexes**, **41 governance rules** — R125+154 adds the loop-integrity governance skill (skills 52 → 53), adds Drive backup links to media delivery emails, and restores publish reliability (stale auto-added ports removed)."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_154") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+153+sec (2026-08-14) — DEMOTED (amber): Derived API recipes — "watch once, skip the browser" — 5 new tools + 4 HIGH closed across 4 architect rounds. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_153_sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-amber-500/10 via-primary/5 to-transparent border border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_153_sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+153+sec</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_153_sec") ? "" : "line-clamp-2"}`}>{"R125+153+sec — **Derived API recipes: watch once, skip the browser — 5 new tools, hardened across 4 architect review rounds (final PASS).** While any agent browses a site, the platform now passively captures the site's own background data calls (per-tenant, in-memory, credentials stripped before anything is buffered). One $0-lane model call distills that captured traffic into a saved recipe; from then on the data is re-fetched in about a second with a single direct call — no browser, near-zero cost — with an automatic 'needs re-verify' flag when a site changes. **HIGH #1 (would have shipped dead):** capture was never attached on any real browsing path — every tenant browsing session now attaches it, including popups and already-open tabs, fail-open so capture can never break browsing. **HIGH #2 (redirect SSRF + DNS rebinding):** replay follows redirects manually (max 3 hops), re-validating AND re-pinning the connection to pre-validated IPs on every hop — a public URL can no longer bounce the platform into localhost, private ranges, or cloud metadata. **HIGH #3 (credential retention):** captured request bodies are now structurally redacted (nested JSON keys, camelCase variants) plus regex fallback and URL query scrubbing; recipes are validated fail-closed before saving (HTTPS-only, method allowlist, SSRF-checked host). **HIGH #4 (round 3):** user:pass@host userinfo stripped unconditionally from every captured URL. MEDIUMs: tenant-scoped re-verify updates, kill switch DERIVED_API_DISABLED covers all five tools, HTTPS-only contract aligned end-to-end. Known gap (deferred, logged): behavioral regression tests for the capture/redaction/redirect branches. Gates: tsc 0, seamtests 85/85, silent-failure hunter at baseline, wiring audit CLEAN 18/18 personas, round-4 architect PASS."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_153_sec") ? "" : "truncate"}`}>{"**413 tools**, **134 capabilities**, **154 reference surfaces**, **18 personas**, **229 tables**, **679 indexes**, **41 governance rules** — R125+153+sec ships browser-free replay of previously watched site data (5 new tools, new derived_api_recipes table) and closes 4 HIGH security findings caught across 4 architect rounds before ship."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_153_sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+152 (2026-08-13) — DEMOTED (violet): "Best of the best" drafting program + model refresh + clean 72h review (3 MEDIUM closed). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_152")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_152"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+152</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_152") ? "" : "line-clamp-2"}`}>{"R125+152 — **The \"best of the best\" drafting program, a model refresh, and a clean 72-hour review.** **Premium drafting for paid deliverables:** audit, research, and executive reports now draft every prose section through 3 frontier-class models in parallel (DeepSeek V4 Pro, GLM-5.2, Gemini 3.7 Flash), then a strong fourth model redrafts the best combined version — with automatic fallback to the standard path so a partial ensemble never ships. **Premium pool platform-wide:** the same program is available to every agent for hard reasoning via the ensemble tool's new premium pool; real metered spend stays owner-only under a $20/day reserve-then-settle ceiling. **Model refresh:** DeepSeek default → V4 Pro 0813 snapshot; Gemini 3.7 Flash added as an escalation-only lane. **72h review (2 parallel architect passes, 52 files): 0 CRITICAL/HIGH.** **MEDIUM #1:** two cost trackers were missing the Gemini 3.7 Flash price (one over-estimated, one reported $0) — priced + pinned in all three maps. **MEDIUM #2:** the ensemble tool still described a months-old model lineup and overstated metered access — resynced to runtime truth. **MEDIUM #3:** missing pricing/premium-pool regression tests — added; the premium trio is now test-locked against the weekly model refresh. Gates: tsc 0, pricing drift 22/22, pool resolver 17/17, ensemble 10/10."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_152") ? "" : "truncate"}`}>{"**408 tools**, **134 capabilities**, **154 reference surfaces**, **18 personas**, **228 tables**, **676 indexes**, **41 governance rules** — R125+152 ships the premium 3-drafters-plus-redraft program for paid reports and platform-wide hard reasoning, refreshes the DeepSeek/Gemini lanes, and closes 3 MEDIUM review findings."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_152") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+151 (2026-08-13) — DEMOTED (cyan): Contrastive tool routing + nightly plan pre-warm + Diagram Design skill + silent research-graph data loss repaired. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_151")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-cyan-500/10 via-primary/5 to-transparent border border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_151"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+151</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_151") ? "" : "line-clamp-2"}`}>{"R125+151 — **Smarter tool picking, faster planning, a Diagram Design skill for every agent — and a silently-failing research memory repaired.** **Contrastive tool routing (arXiv 2601.12538):** when the router picks a tool it now also explains why that tool beats its near-miss alternates, cutting wrong-tool calls on ambiguous requests. **Nightly plan pre-warm:** a scheduled job refreshes the plan-replay cache each morning so common orchestration requests skip the planner LLM call entirely — faster and cheaper. **Diagram Design skill (MIT import):** 27 diagram types — architecture, flowcharts, sequence, ER, Gantt, org charts, funnels and more — with brand-token onboarding, wired to all 18 agents. **HIGH closed (full-app review):** the durable research knowledge graph had been silently losing every write since Aug 10 — its bootstrap collided with an older table's incompatible layout and the failure was swallowed; it now writes to its own research_evidence_triples table, live-verified write+read+dedupe. Gates: tsc 0, 231 test suites green, seamtests 85/85, wiring audit CLEAN."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_151") ? "" : "truncate"}`}>{"**408 tools**, **134 capabilities**, **154 reference surfaces**, **18 personas**, **228 tables**, **676 indexes**, **41 governance rules** — R125+151 adds contrastive tool routing, nightly plan pre-warm, and the Diagram Design skill, and repairs the silently-failing research memory."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_151") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+150+sec (2026-08-11) — DEMOTED (emerald): Knowledge learns from use + flagship Claude models at $0 — 1 CRITICAL + 2 HIGH closed, round-2 architect verified. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_150sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-emerald-500/10 via-primary/5 to-transparent border border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_150sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+150+sec</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_150sec") ? "" : "line-clamp-2"}`}>{"R125+150+sec — **Knowledge learns from use + flagship Claude models at $0 — 1 CRITICAL + 2 HIGH + 2 MEDIUM closed in a 72h-depth review (2 parallel architect passes + a dedicated silent-failure hunt, round-2 pass verified every fix).** **Feature:** the knowledge layer now tracks how often every knowledge row is actually retrieved (access count + last-accessed on every retrieval path via one central usage marker), proven-useful knowledge wins ranking ties (strict tie-breaker — relevance ALWAYS dominates, usage never boosts it), and platform-wide knowledge briefs are finally visible to semantic search (they were only findable by keyword before). **Models:** claude-opus-5, claude-opus-4-8, and claude-fable-5 now serve through the flat-rate Profundo lane at $0 instead of downgrading. **CRITICAL #1 (swallowed boot migration):** the boot-time database change that the new retrieval queries REQUIRE was wrapped in an empty catch — a failed migration on a fresh deployment would silently break every knowledge search; the boot now verifies the columns actually exist via information_schema and logs an explicit schema-gap error with the exact manual fix. **HIGH #1 (broken tier masked as empty):** a failing search tier was indistinguishable from a genuinely empty result — retrieval now tracks per-tier errors and fires a loud DEGRADED signal before falling back, while staying fail-open for the customer. **HIGH #2 (flat-rate spend mismetered):** flat-rate Claude calls through Profundo were being recorded as metered Anthropic spend and counted against the Anthropic daily circuit breaker — the lane is now excluded from the breaker and ledgered at $0, live-verified with a real Opus-5 call. **MEDIUM #1:** permanent schema errors (undefined column/table) in the usage marker are classified and error-logged once instead of warning forever. **MEDIUM #2:** the boot verification is schema-scoped (current_schema()) so a same-named table in another schema can't falsely verify. Gates: tsc 0, wiring audit CLEAN, round-2 architect PASS."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_150sec") ? "" : "truncate"}`}>{"**408 tools**, **134 capabilities**, **149 reference surfaces**, **18 personas**, **227 tables**, **673 indexes**, **41 governance rules** — R125+150+sec makes knowledge retrieval learn from use, wires 3 flagship Claude models at $0, and closes 1 CRITICAL + 2 HIGH + 2 MEDIUM; round-2 architect pass verified all fixes. _(model: Replit Agent)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_150sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+149+sec (2026-08-10) — DEMOTED (violet): Whole-project code review — 4 HIGH + 2 MEDIUM closed, round-2 architect verified. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_149sec")}
          className="w-full text-left rounded-lg bg-gradient-to-r from-violet-500/10 via-primary/5 to-transparent border border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/15 transition-colors px-4 py-3 flex items-start gap-3"
          data-testid="banner-whats-new-r125_149sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+149+sec</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_149sec") ? "" : "line-clamp-2"}`}>{"R125+149+sec — **Whole-project thorough code review: 4 HIGH + 2 MEDIUM closed across 3 parallel architect passes, all fixes verified by a round-2 architect pass.** **HIGH #1 (cross-tenant subagent spawn):** the helper-agent spawner fell back to the ADMIN tenant when no tenant id was supplied — a missing check could have run spawned work under the admin account; spawning now fails closed without a verified numeric tenant, the tool path forwards the trusted dispatcher-stamped tenant id, and the admin route resolves the request tenant explicitly. **HIGH #2 (webhook signature bytes):** the AgentMail inbound-email webhook verified its HMAC over a re-serialized JSON.stringify(req.body) — formatting differences between the provider's bytes and Express's re-serialization could reject good mail or, worse, blur the signature boundary; verification now runs over the exact captured raw request bytes, with stringify only as a dev fallback. **HIGH #3 (private uploads auto-shared):** user vault uploads were backed up to Google Drive with a public share link on both upload routes — backups are now private; only explicit customer deliverables get share links. **HIGH #4 (orchestrator throttle fail-open):** the CEO orchestrator's pace gate soft-allowed on a database error with NO bound on parallel work — an in-memory reservation cap is now enforced unconditionally (reserve-then-check, release on cap hit), so a DB outage can no longer permit unbounded parallelism. **MEDIUM #1:** credential-vault last-used timestamps now update only within the owning tenant. **MEDIUM #2:** the chromium probe and all five ffmpeg capability probes now run with a sanitized child environment (round-2 architect caught three probe sites the first fix missed). Gates: tsc 0, full suite 231 suites green, seamtests green, wiring audit CLEAN."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_149sec") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **18 personas**, **226 tables** — R125+149+sec closes 4 HIGH (cross-tenant spawn, webhook raw-byte HMAC, private Drive backups, orchestrator throttle bound) + 2 MEDIUM in a whole-project review; round-2 architect pass verified all fixes. _(model: Replit Agent)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_149sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+148+sec (2026-08-09) — DEMOTED (cyan): Rate-limit pace-not-kill + avenue spreading + 72h security review round 4 — 2 HIGH + 2 MEDIUM closed, second-pass hardening applied. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_148sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/15 via-primary/5 to-transparent border border-cyan-500/40 hover:border-cyan-500/60 hover:bg-cyan-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_148sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+148+sec</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_148sec") ? "" : "line-clamp-2"}`}>{"R125+148+sec — **Rate-limit pace-not-kill + research avenue spreading + 72h whole-app security review round 4: 2 HIGH + 2 MEDIUM closed, second-pass hardening applied, final architect pass verified.** Agents no longer die on internal minute-window rate limits — the checker now waits once (up to 70s) when only the minute window is full, hour/day ceilings still hard-stop, and every denial names sibling research tools with separate buckets (minute) or says consolidate-don't-switch (hour/day — a spend-ceiling evasion guard); wired at both enforcement points, with a new avenue-spreading doctrine pushed to all 18 personas and 10 regression tests. **HIGH #1 (SSRF):** the competitor-snapshot/outreach fetcher used a naive literal private-host check with a raw fetch and broken relative-redirect handling — every hop now routes through the shared SSRF jail (DNS-resolved private-address rejection + connect-time IP pinning against DNS rebinding), relative redirects resolve against the current URL, and responses stream under a hard 2MB byte cap (no unbounded buffering — a second-pass catch). **HIGH #2 (digest integrity):** the weekly wedge digest converted database failures into fake zeros and recommended 'zero traction' actions off them, and counted shipped content with the wrong tag — failed queries now report 'metrics unavailable — no trend call made' per-track AND at the portfolio headline (second-pass catch: aggregates stay nullable), and content matching uses the canonical wedge tag. **MEDIUM #1:** the rate-limiter's fail-closed backstop list had drifted 5 expensive tools behind the limiter config (those would have failed OPEN on a limiter outage) — parity restored, architect-verified exact 48/48. **MEDIUM #2:** the mission reply scanner accepted malformed mission ids (0, 1e3, 0x10) and silently widened the scan to ALL live missions — strict decimal positive-integer validation now aborts. Gates: tsc 0, full suite 225 suites green."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_148sec") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **18 personas**, **226 tables** — R125+148+sec ships pace-not-kill rate limiting + research avenue spreading across all 18 personas and closes 2 HIGH (SSRF jail on competitor research, wedge-digest false zeros) + 2 MEDIUM in 72h review round 4; second architect pass verified the fixes. _(model: Replit Agent)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_148sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+147+sec (2026-08-06) — DEMOTED (amber): Premium $497 audit report upgrade + 72h security review round 3 — 3 HIGH + 2 MEDIUM + 1 LOW closed, 1 HIGH FALSE POSITIVE probe-disproven. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_147sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/15 via-primary/5 to-transparent border border-amber-500/40 hover:border-amber-500/60 hover:bg-amber-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_147sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+147+sec</span>
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_147sec") ? "" : "line-clamp-2"}`}>{"R125+147+sec — **Premium $497 AI Readiness Audit report upgrade + 72h whole-app security review round 3: 3 HIGH + 2 MEDIUM + 1 LOW closed, 1 HIGH FALSE POSITIVE probe-disproven, second architect pass PASS.** The self-serve $497 audit deliverable now ships as the premium styled report (dark gradient cover, stats grid, branded sections). **HIGH #1 (Stripe metadata provenance):** checkout fulfillment trusted metadata.mission_id straight from Stripe metadata (app-writable) for mission cost attribution and review-queue linkage — the id is now resolved against the owner tenant AND gated on a post-approval mission stage before ANY use; invalid ids drop to null with a warn and fulfillment is never blocked. **HIGH #2 (corrupt-PDF delivery block):** a Browserless HTTP-200 with a corrupt body could have shipped to a paying customer — generateStyledPdf now runs a fail-closed render-integrity gate (size + %PDF- magic + parse + ≥1 page) before anything is written or persisted; failure triggers the plain-renderer fallback. **HIGH #3 (backup/purge tenant scoping):** the data-protection backup SELECTs and purge child DELETEs now carry explicit tenant predicates. **HIGH FALSE POSITIVE:** 'fire-and-forget cost write loses mission attribution' — disproven by a live Node probe (AsyncLocalStorage binds context at continuation registration); a synchronous mission-id snapshot was still added as defense-in-depth, pinned by test. **MEDIUM #1 (outreach reply-pause race):** a reply that pauses an outreach enrollment mid-send can no longer be overwritten back to active — the advance UPDATE is conditional on status='active' + tenant with RETURNING, zero rows ⇒ skipped, and skipped rows are excluded from the sent count (the LOW). **MEDIUM #2 (deferred + documented):** the PDF persistence ADMIN-tenant loud-warn fallback, documented in the known-gaps register. Second architect pass on the fixes: PASS, no new findings. Gates: tsc 0, seamtests 85/85, suite 223 suites green, targeted 37/37."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_147sec") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **18 personas**, **226 tables** — R125+147+sec ships the premium $497 audit report and closes 3 HIGH (Stripe metadata provenance, corrupt-PDF delivery block, backup tenant scoping) + 2 MEDIUM + 1 LOW in a 72h review; 1 HIGH probe-disproven FALSE POSITIVE; second architect pass PASS. _(model: Replit Agent)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_147sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+146+sec (2026-08-02) — DEMOTED (rose): 72h whole-app security review — 3 HIGH + 2 MEDIUM closed, second architect pass PASS. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_146sec")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/15 via-primary/5 to-transparent border border-rose-500/40 hover:border-rose-500/60 hover:bg-rose-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_146sec"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+146+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_146sec") ? "" : "line-clamp-2"}`}>{"R125+146+sec — **72h whole-app security review: 3 HIGH + 2 MEDIUM closed, second architect pass PASS.** **HIGH #1 (capability-map policy-edge leak):** /api/agent-insights/capability-map answered any authenticated tenant without tenant resolution and included every agent's blocked-tool policy edges — a map of exactly what each role is forbidden to do; the endpoint now requires resolveTenantId and returns blocked-tool edges ONLY to platform admins (personas/capabilities stay visible to all). **HIGH #2 (prefix-shadowing mispricing, caught twice):** DeepSeek V4 Flash 0731 was billed at a generic family prefix rate ($0.14/$0.28 vs the real $0.09/$0.18); an exact pricing row was added plus a NEW prefix-shadowing order guard in the pricing-drift suite — which immediately caught a second live bug: gpt-4.1-mini shadowed by gpt-4.1 ($2/$8 vs $0.4/$1.6), also fixed. **HIGH #3 (pre-existing — email-reply ownership):** /api/email/reply never verified the messageId belonged to the requesting tenant (shared provider inbox → cross-tenant thread replies); replies now require a tenant-scoped inbox_messages ownership match with 404 on mismatch, pinned by a source-scan regression test. **MEDIUMs (2):** scratchpad reads fail CLOSED without tenant ctx; all 3 per-row scheduled-post status UPDATEs pin AND tenant_id. Second architect pass on the fixes: PASS, no new findings. Gates: tsc 0, seamtests 85/85, suite 173/173, wiring audit CLEAN (408 tools)."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_146sec") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **18 personas**, **226 tables** — R125+146+sec closes 3 HIGH (capability-map policy-edge leak, prefix-shadowed model mispricing ×2, email-reply cross-tenant ownership) + 2 MEDIUMs in a 72h whole-app review; second architect pass PASS. _(model: claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_146sec") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+146 (2026-08-01) — DEMOTED (emerald): Agent Insights — scorecards, capability map, workflow replay (Tasks #126/#127/#128). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_146")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/15 via-primary/5 to-transparent border border-emerald-500/40 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_146"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+146</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_146") ? "" : "line-clamp-2"}`}>{"R125+146 — **Agent Insights: every agent's real track record, a live capability map, and step-by-step workflow replay.** **Agent Scorecards (/agent-scorecards):** each active agent's REAL numbers over a 7/30/90-day window — tasks completed + success rate from the activity ledger, actual spend + cost-per-task from the cost ledger, average quality /100 from the step grader, and your team's human-approval rate. **Capability Map (/capability-map):** a searchable goals → capabilities → agents → tools map from the live capability registry, including per-agent blocked-tool edges so you see what each agent deliberately CANNOT do. **Workflow Replay (/replay):** replay any finished run step by step — which agent, which tools, duration, output, grader score and rationale, plus planned-but-never-executed steps; strictly read-only. **Architect-hardened before ship:** lifecycle log events filtered out of replay (no phantom steps), per-step grades joined EXACTLY on the step number (off-by-one fixed), and replay text passes a widened redaction layer (emails, phones, Bearer/Authorization headers, cookies, connection-string credentials, password/api-key assignments, long opaque tokens) pinned by 14 dedicated tests. Gates: tsc 0, seamtests 85/85, suite 170/170, route census 714→718. Tasks #126/#127/#128 delivered."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_146") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **18 personas**, **226 tables** — R125+146 ships three tenant-facing observability surfaces: agent scorecards, the capability map, and workflow replay. _(model: claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_146") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+145 (2026-08-01) — DEMOTED (cyan): admin-rights consistency across both auth paths + owner-binding takeover guard + 72h whole-app security review (1 HIGH email-reply redaction gate + 5 MEDIUMs closed, second architect pass PASS). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_145")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/15 via-primary/5 to-transparent border border-cyan-500/40 hover:border-cyan-500/60 hover:bg-cyan-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_145"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+145</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_145") ? "" : "line-clamp-2"}`}>{"R125+145 — **Admin rights made consistent + whole-app 72h security review: 1 HIGH and 5 MEDIUMs closed, second architect pass PASS.** **Admin-auth fixes:** /api/auth/user now returns isAdmin for flagged admins (admin tenant OR tenant.is_admin), matching /api/tenants/me — no more missing admin sidebar after a Replit-auth login; isAdminRequest honors is_admin consistently across the Replit-auth AND token paths (Task #124 merged); owner-email detection merges the real OWNER_EMAIL secret with legacy OWNER_EMAILS and gains a takeover guard — admin tenant #1 can never be silently rebound to a DIFFERENT Replit subject (binds only on empty or exact replitUserId match). **HIGH #1 (fixed):** replyToEmail bypassed the R95 enforceOutbound secret-redaction gate that every regular outbound email passes — a prompt-influenced reply could have leaked credential-shaped content to an external correspondent; fail-closed text+html gates added (email:reply:text / email:reply:html) and pinned by a static source-scan regression test. **MEDIUM #1:** the internal event resolver could finalize customer-scoped events without a tenant check on two branches — tenant now resolved once at entry, fails CLOSED on missing tenant. **MEDIUM #2:** the usage-insights pricing map missed the z-ai/glm-5.2 and moonshotai/kimi-k2.6 price refresh (cost reports would show wrong numbers) — synced above their generic prefixes. **MEDIUM #3:** voice conversations ignored the tenant when picking an AI provider — now routed through getClientForModel(model, tenantId) so tenant provider keys and subscription lanes apply. **MEDIUMs #4–5:** two wedge-wiring scripts updated heartbeat/project rows by bare id — now tenant-scoped. **Deferred (documented):** set JURY_QUEUE_HMAC_SECRET wherever jury auto-apply is enabled. Second architect pass on the fixes: PASS, no new findings. Gates: tsc 0, seamtests 69/69, suite 169/169, wiring audit CLEAN."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_145") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **146 reference surfaces**, **18 personas**, **226 tables**, **667 indexes**, **41 governance rules** — R125+145 closes 1 HIGH (email-reply redaction gate) + 5 MEDIUMs in a 72h whole-app review and makes admin rights consistent across both sign-in paths with an owner-binding takeover guard. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_145") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+143 (2026-08-01) — DEMOTED (rose): all 18 agents fully wired — expanded scopes for 7 personas (agency-agents market validation, reauthored natively), capability registry completed (Echo/Hermes/Robert), universal 408-tool awareness, 5-layer persona-drift defense line, 72h review (0 security findings, 1 HIGH correctness fixed). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_143")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-rose-500/15 via-primary/5 to-transparent border border-rose-500/40 hover:border-rose-500/60 hover:bg-rose-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_143"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-rose-600 text-white leading-none shrink-0 mt-0.5">R125+143</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_143") ? "" : "line-clamp-2"}`}>{"R125+143 — **All 18 agents are now fully wired: seven personas gain market-validated expanded scopes, every agent knows the full 408-tool registry, and a five-layer persona-drift defense line locks agent identities to their source of truth.** **Expanded scopes (reauthored natively from the market-validated 137k★ agency-agents roster — never copied):** Teagan adds AEO/GEO and AI-citation optimization so content ranks in AI answers, not just search; Hermes adds paid-media operations under Felix's budget gate ($0 spend without CEO approval, unchanged); Apollo adds discovery-call prep, proposal drafting, and pipeline hygiene; Echo adds cross-channel feedback synthesis with an ethical-nudge review lens; Cassandra adds FP&A/controller duties, investment memos, and tax-flag spotting; Luna adds DPO-grade compliance and vendor review; Proof adds accessibility checks, reality checks, and performance sanity passes — every block preserves the explicit spend/approval and privacy boundaries and is written byte-identical to BOTH identity source files AND the live DB. **Capability registry completed:** Hermes, Echo, and Robert were missing from the agent capability registry (invisible to cross-agent routing); all 18 are now registered, and Robert's stale 'Security' role is corrected to Wellness Coach ([Your Product]). **Universal tool awareness:** all 18 personas re-synced against the full 408-tool registry; wiring audit fully CLEAN — 0 dead tools, 0 drift, 0 schema gaps, 0 orphan tables. **Persona-drift defense line (5 merged tasks):** identity drift (DB vs source-of-truth, both directions), operating-loop drift, tools-doc drift, unified persona-doc writers, and a curated-doc staleness gate wired fail-closed into the public-mirror build — an agent's identity, operating loops, or tool docs can no longer silently diverge from code. **72h review (3 parallel architect passes over all 127 code files changed in 72h + the sensitive core): 0 security findings; 1 HIGH correctness fixed** — the orphan-table introspector had generated duplicate Drizzle declarations for 4 live self-repair tables (the audit never scanned the self-repair schema module; now it does, and the generated schema is regenerated clean) — plus the curated-doc staleness test promoted into the canonical suite with its flaky teardown fixed, gate scripts normalized to their documented fail-closed exit code, and the drift test's subprocess/DB timeouts bounded under the harness limit. Gates: tsc 0, seamtests 71/71, wiring audit CLEAN."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_143") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **146 reference surfaces**, **18 personas**, **226 tables**, **667 indexes**, **41 governance rules** — R125+143 wires all 18 agents end-to-end: expanded scopes for 7 personas, universal 408-tool awareness, and a 5-layer persona-drift defense line. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_143") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+141/+142 (2026-07-30) — DEMOTED (amber): speculative read-only tool prefetch on plan-replay hits (guarded, fail-open, single-use cache) + LLM-Wiki borrows: compile-on-ingest concept distillation in the knowledge refresh (update-not-append, fail-open, hard-clamped spend) and weekly cross-store knowledge lint Pass 19 (advisory). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_142")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-amber-500/15 via-primary/5 to-transparent border border-amber-500/40 hover:border-amber-500/60 hover:bg-amber-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_142"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-amber-600 text-white leading-none shrink-0 mt-0.5">R125+142</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_142") ? "" : "line-clamp-2"}`}>{"R125+141/+142 — **The platform compiles what it learns, lints its own knowledge weekly, and pre-fetches tool results on replayed plans.** **Compile-on-ingest (R125+142, Karpathy LLM-Wiki borrow):** the nightly Agent Knowledge Refresh now distills every CHANGED source into ≤5 concept summaries that UPDATE existing `concept:` entries instead of appending raw chunks — a maintained wiki, not an append-only log. Fast-tier model, fail-open 90s timeout, per-run cap hard-clamped at 16 (env can only lower it), kill switch KNOWLEDGE_COMPILE_DISABLED=1, source and existing text delimited as untrusted data against prompt injection; concepts join the embedding backfill and are immediately retrievable. **Cross-store knowledge lint (R125+142):** new read-only weekly-maintenance Pass 19 catches duplicate active triples (supersession races), superseded memories missing succeeded_by links, stale-active memories, retrieval-dead knowledge rows (missing embeddings, scoped to embedded sources only), and compiled concepts lagging a fresher triple on the same subject — advisory YELLOW, never RED; first live run clean. **Architect findings closed pre-ship:** admin-tenant+persona predicates on the backfill selects, same-tenant lint join, hard spend clamp + 4000-token ceiling — pinned by tests (13/13 lib, suite 166/166, tsc 0). **Speculative prefetch (R125+141):** on a plan-replay cache hit the tool chain is known upfront, so 8 allowlisted read-only tools pre-execute through the FULL guard path (same tenant, policy re-checked fail-closed at consume); 45s single-use cache, error envelopes never cached, trust params stripped from keys, kill switch SPEC_PREFETCH_DISABLED=1 (15/15 targeted tests)."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_142") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **146 reference surfaces**, **18 personas**, **226 tables**, **667 indexes**, **41 governance rules** — R125+141/+142 adds compile-on-ingest concept distillation, weekly cross-store knowledge lint (Pass 19), and guarded speculative tool prefetch on plan-replay hits. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_142") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+140+sec (2026-07-30) — (violet): repo-surgeon plan-vs-diff conformance gate (undeclared touches roll back + count toward stop budget), video-finalize corruption gate (corrupt render can never ship), outbound quality-gate degraded telemetry, 72h review closing 2 HIGH (fail-closed operator-script flag gates; ErrorBoundary raw-error redaction) + MEDIUM sweep + glm-5.2 pricing sync. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_140")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-violet-500/15 via-primary/5 to-transparent border border-violet-500/40 hover:border-violet-500/60 hover:bg-violet-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_140"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-violet-600 text-white leading-none shrink-0 mt-0.5">R125+140+sec</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_140") ? "" : "line-clamp-2"}`}>{"R125+140+sec — **Self-repair conformance gate, corrupt-render delivery block, and a 72h review closing 2 HIGH fail-closed.** **Plan-vs-diff conformance gate (Harness Handbook adoption):** the guarded repo-surgeon now compares its DECLARED edit scope against the ACTUAL working-tree delta after every fix attempt — any undeclared touched file triggers an automatic rollback, conformance is recorded per attempt, and a rollback counts toward the durable stop budget (repo-surgeon-conformance suite pins the fail-closed rollback). **Corrupt-render delivery block:** final video artifacts are verified BEFORE being marked done or uploaded; invalid output fails CLOSED back to retryable state with an incident report (video-finalize-gate suite) — a corrupt render can never reach a customer. **Outbound degraded telemetry:** email send, email reply, and scheduled-post all report outbound_quality_gate_degraded when the content scanner fails open (static wiring tests pin the coverage). **72h review (3 parallel architect passes + wiring audit exit 0 — 408 tools / 18 personas):** server pass PASS 0 CRITICAL / 0 HIGH (Stripe signature-before-side-effect, livemode parity, replay dedupe, paid-state gating all re-verified). **HIGH #1 (scripts):** build-public-mirror.sh accepted unknown argv flags and proceeded to a LIVE force-push of the public repo — a --dryrun typo was a real push; a strict allowlist (only --dry-run) now refuses with exit 2 before any side effect, and the same unknown-flags-run-live class was swept into resolve-escalations.ts and drain-jury-queue.ts. **HIGH #2 (client):** the ErrorBoundary rendered raw error.message to end users (internal paths / integration detail could leak); replaced with safe generic copy. **MEDIUMs:** two silent catches made observable (onboarding-seen POST now warns; resend-verification warns + shows a user-facing retry message); stale stats fixed (onboarding persona roster 16→18 verified against the live DB; governance fallback 40→41). **Also:** z-ai/glm-5.2 pricing drift fixed in BOTH pricing maps (model-pricing-drift suite green) and the stale-string preflight gate itself cured of a glob@7 ESM-import break — the drift safety net was silently down."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_140") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **146 reference surfaces**, **18 personas**, **226 tables**, **667 indexes**, **41 governance rules** — R125+140+sec adds the plan-vs-diff conformance gate, blocks corrupt-render delivery, and closes 2 HIGH (fail-closed operator scripts + client error redaction). _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_140") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+139 (2026-07-28) — (emerald): majority-rule autonomous repair — the 3-frontier-model jury auto-applies FIX on a strict majority (was unanimous), majority ACCEPT/REJECT terminally closes, all safety gates intact; all three self-repair autonomy flags ON; fail-closed public-mirror persona/tool doc guards (Tasks 84/85). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_139")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/15 via-primary/5 to-transparent border border-emerald-500/40 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_139"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+139</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_139") ? "" : "line-clamp-2"}`}>{"R125+139 — **Majority-rule autonomous repair: the three-frontier-model jury now auto-applies fixes on a strict majority vote, and full self-repair autonomy is switched ON.** **Policy change (owner-directed):** `mapJuryDecision`'s auto-fix gate moved from UNANIMOUS to STRICT MAJORITY — a 2/3 (or 3/4, 3/5…) FIX now routes to the guarded repo-surgeon instead of parking in the owner's inbox, and a majority ACCEPT/REJECT terminally closes the incident on the ledger with votes + rationale (denied and done, never lingering). **Every guard intact and pinned by tests:** the jury's own escalation flag and the fix-direction concordance floor (0.45) still override any majority; enforceSafetyRouting still forces protected surfaces (tests/guards/safety layers) away from auto-fix; the repo-surgeon still typechecks/tests and lands-or-rolls-back; prod code edits still refused; REPAIR_AUTOFIX_ENABLED still the opt-in master switch. **New invariants from the architect round:** even jury sizes (2-of-4 must NOT act, 3-of-4 acts), malformed vote cardinality (empty votes ⇒ legacy 3-seat default, sub-majority never closes or fixes) — 66/66 unit tests green, tsc 0. **Autonomy flags:** REPAIR_AUTOFIX_ENABLED + JURY_AUTOAPPLY + TENANT_AUDIT_ENQUEUE_FIXES all =1 in the owner environment — the detect → jury → auto-apply loop is live end-to-end. **Public mirror hardening (Tasks 84/85):** fail-closed persona-count (stage 0.1) and tool-count (stage 0.2) guards abort the mirror build on docs drift vs the live registry/DB; comparison logic extracted into a pure lib with a DB-free test suite (missing doc, header/row drift, dropped/rogue rows, vacuous parse, empty registry) wired into tests/run.sh. **Post-edit 72h review (2 parallel architect passes):** server pass PASS (0 CRITICAL/0 HIGH); client pass caught two stale public stats — signup SEO (296→408 tools) and compare page (263→408) — both fixed."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_139") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **145 reference surfaces**, **18 personas**, **225 tables**, **663 indexes**, **41 governance rules** — R125+139 flips the jury to majority-rule auto-apply with all safety gates intact, turns on full self-repair autonomy, and adds fail-closed public-mirror doc guards."}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_139") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+138 (2026-07-28) — (cyan): two new personas onboarded (16 → 18) — Hermes (Growth Hacker) + Echo (UX Researcher) — with intent-gate fallback/hint coverage added for 3 previously under-covered restricted categories and 16 new AHB fixtures (68/68, ASR 0%). */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_138")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-cyan-500/15 via-primary/5 to-transparent border border-cyan-500/40 hover:border-cyan-500/60 hover:bg-cyan-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_138"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-cyan-600 text-white leading-none shrink-0 mt-0.5">R125+138</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_138") ? "" : "line-clamp-2"}`}>{"R125+138 — **The AI team grows from 16 to 18: Hermes (Growth Hacker) and Echo (UX Researcher) join, and the jailbreak gate gains coverage for three previously under-covered restricted categories.** **Hermes 🚀 — Growth Hacker (Acquisition & Experiments):** owns the growth-experiment loop — pre-registered hypotheses with success metrics and kill criteria written BEFORE launch, weekly Monday-launch/Friday-readout cycle, fully-loaded CAC math, organic-before-paid doctrine, and $0 spend without CEO approval; feeds validated channels into the marketing autopilot and routes every lead to Apollo same-day. **Echo 👂 — UX Researcher (Voice of the User):** decision-question-first studies, mines existing signals (support threads, churn, analytics) before new interviews, anonymize-at-capture PII rule (P-labels, never names), one-page readouts with evidence + severity, blocker findings escalate to the CEO same day. Both roles mirror the market-validated agency-agents roster (137k★) but are reauthored natively — never copied. **Safety onboarding per the 9-step checklist:** both run the moderate intent gate with persona-voice refusals (Hermes: mass-email/public-post/money-movement/credential/tenant categories; Echo: mass-email/public-post/credential/tenant). **Intent-gate hardening shipped alongside:** `public_post_unapproved` had ZERO hint-tier coverage and 3 categories (mass_email_unapproved, public_post_unapproved, tenant_isolation_bypass) had ZERO fallback-regex coverage — meaning moderate-gate personas (Felix, Scribe, Chief of Staff, Proof…) could never accumulate the 2nd blocking signal for those categories when the LLM destyler is unavailable; one pattern per category added. **Verification:** AHB adversarial suite extended with 10 attack + 6 benign fixtures for the two personas — 68/68 pass, ASR 0%; tools_doc synced live for both (push-persona-sync); emoji/catchphrase seeded; tsc 0."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_138") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **45 (.agents) + 62 (db) + 38 (output-skills) = 145 reference surfaces**, **18 personas**, **225 tables**, **663 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+138 onboards Hermes (Growth Hacker) + Echo (UX Researcher) per the 9-step persona checklist and closes the intent-gate coverage gap for 3 restricted categories. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_138") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+137.94 (2026-07-27) — DEMOTED (emerald): AI Fix Kit for the $1,997 done-for-you audit tier (generate_audit_fix_kit, tools 407→408) + 72h sweep closing 1 HIGH — DFY orders could auto-ship past the review queue; canAuto hard-gated manual-only. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_137_94")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-emerald-500/15 via-primary/5 to-transparent border border-emerald-500/40 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_137_94"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-emerald-600 text-white leading-none shrink-0 mt-0.5">R125+137.94</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_137_94") ? "" : "line-clamp-2"}`}>{"R125+137.94 — **The AI Fix Kit ships for the $1,997 done-for-you audit tier (tools 407 → 408), and a 72h full-platform sweep hard-locks done-for-you orders to human review — they can never auto-ship.** **AI Fix Kit:** new Felix tool `generate_audit_fix_kit` re-audits the customer's site through the SSRF-jailed fetcher and generates a ready-to-apply kit — 3 LLM files grounded ONLY on the fetched content + audit findings, each fail-closed validated with domain-grounding checks (generated JSON-LD/meta URLs must match the audited domain; 14/14 validator tests), plus deterministic robots additions + README, zipped with post-write verification and attached to the order's HITL review item; kit failure holds the order for manual review, never blocks the audit PDF. **3 feature-round architect findings closed:** HIGH — collision-prone flat zip name could cross-deliver same-day kits (now orderId slug + random hex); MEDIUM — fetched page text now wrapped in a <<<UNTRUSTED_PAGE_CONTENT>>> data-never-instructions prompt-injection boundary; MEDIUM — domain-grounding validators added. **72h full-platform sweep (3 parallel architect passes over all 87 files touched in 72h + the sensitive core): 1 HIGH fixed** — `server/webhookHandlers.ts` could auto-ship a DFY order if the SKU was auto-ship-graduated and QA passed, bypassing the human review queue; `canAuto` is now hard-gated with `!isDfyManualOnly` (done-for-you = manual-only, always); fix-pass confirmed closed, no new CRITICAL/HIGH. **1 MEDIUM fixed** — `generate_audit_fix_kit` had no explicit TOOL_POLICIES row (permissive fallback); now sensitive/MEDIUM/structured-args/trustedPersonasOnly. Known gap (deferred, documented): end-to-end webhook harness for the DFY fix-kit path. Gates: tsc 0, suite 155/155, seamtests 69/69, wiring audit CLEAN — 408 tools, 0 dead/drift/leaks."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_137_94") ? "" : "truncate"}`}>{"**408 tools**, **131 capabilities**, **44 (.agents) + 62 (db) + 38 (output-skills) = 144 reference surfaces**, **16 personas**, **225 tables**, **663 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+137.94 lands the AI Fix Kit for the done-for-you audit tier and closes 1 HIGH (DFY orders hard manual-only) in a 72h full-platform sweep. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_137_94") ? "rotate-180" : ""}`} />
        </button>

        {/* R125+137.93 (2026-07-26) — DEMOTED (indigo): release window R125+137.89+sec → +137.93 — nightly-audit FP wave 2 (77/77 FALSE POSITIVE); SEED behavior-shift pre-jury filter; gstack review-rubric borrow; Google Vertex AI express provider lane; 72h full-platform sweep closing 1 HIGH — cost-tracking wrapper mutated the shared cached client (N-fold ledger recording + tenant attribution race) → request-local Proxy facade. */}
        <button
          onClick={() => toggleRelease("banner-whats-new-r125_137_93")}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-gradient-to-r from-indigo-500/15 via-primary/5 to-transparent border border-indigo-500/40 hover:border-indigo-500/60 hover:bg-indigo-500/20 transition-colors text-left"
          data-testid="banner-whats-new-r125_137_93"
        >
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-sm bg-indigo-600 text-white leading-none shrink-0 mt-0.5">R125+137.93</span>
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-semibold leading-tight ${releaseExpanded.has("banner-whats-new-r125_137_93") ? "" : "line-clamp-2"}`}>{"R125+137.93 — **Release window R125+137.89+sec → +137.93: the AI-spend meter is hardened against multi-counting, a Google Vertex AI express provider lane goes live, the nightly audit's 77 kept severe findings all verdict FALSE POSITIVE, and the skill optimizer gains a behavior-shift pre-jury filter.** **.89+sec — nightly-audit FP wave 2:** the 2026-07-25 nightly tenant-isolation audit kept 77 CRITICAL/HIGH findings — all 77 verdicted FALSE POSITIVE by 8 parallel read-only subagent passes (no code change required); plus a CI docs fix. **.90 — SEED behavior-shift pre-jury filter (arXiv:2607.14777 borrow):** `server/lib/behavior-shift.ts` replays ≤4 eval cases with seed-vs-candidate doc between the strict-improvement gate and the 3-LLM jury in the nightly skill optimizer; behaviorally-inert candidates (0 shifted of ≥2 clean probes, word-Jaccard ≥0.88) are culled before the paid jury call — quality filter, fails OPEN everywhere, can only SKIP a jury call, never force an apply; kill switch `SKILL_OPT_SHIFT=off`; 15 hermetic tests. **.91 — gstack review-rubric borrow (MIT):** 6 portable rubric items folded into the post-edit-code-review skill — scope-drift check, enum/value-completeness grep, QUOTE-OR-DOWNGRADE finding hygiene, and a UI-change design addendum; doc-only. **.92 — Google Vertex AI express lane:** a new Gemini provider lane in getClientForModel — x-goog-api-key auth with the SDK Bearer header stripped, OpenAI-compat aiplatform endpoint, google/-prefixed model ids, bare-id cost tracking; sits after tenant/DB/env google keys, before the metered integration fallback; the $0 cost-safety policy untouched; verified live end-to-end. **.93 — 72h full-platform sweep (3 parallel architect passes + wiring audit CLEAN): 1 HIGH fixed** — `wrapClientWithCostTracking` mutated the shared cached SDK client per request, so stacked wrappers recorded ONE API call N times in the cost ledger (probe: 3 inserts after 3 wraps) and raced tenant billing attribution; rewritten as a request-local Proxy facade (probe after: exactly 1 insert/call, per-facade tenant closures); second architect pass on the fix PASS. Gates: tsc 0, suite 153/153, wiring audit CLEAN."}</div>
            <div className={`text-xs text-muted-foreground mt-0.5 ${releaseExpanded.has("banner-whats-new-r125_137_93") ? "" : "truncate"}`}>{"**407 tools**, **131 capabilities**, **44 (.agents) + 62 (db) + 38 (output-skills) = 144 reference surfaces**, **16 personas**, **225 tables**, **663 indexes**, **41 governance rules**, MCP scopes 5, MCP tools 12 — R125+137.89+sec → +137.93 land the Vertex AI express lane + behavior-shift pre-jury filter and close 1 HIGH (N-fold cost-ledger recording) in a 72h full-platform sweep; 77/77 nightly findings FALSE POSITIVE. _(model: anthropic/claude-opus-4)_"}</div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-0.5 transition-transform ${releaseExpanded.has("banner-whats-new-r125_137_93") ? "rotate-180" : ""}`} />
        </button>

         <HomeReleaseArchive releaseExpanded={releaseExpanded} toggleRelease={toggleRelease} />
         </div>
    </>
  );
}
