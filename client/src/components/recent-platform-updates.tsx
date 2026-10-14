import { Link } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";
import { CURRENT_SOURCE_RELEASE } from "./prepublication-notice";

const updates = [
  {
    title: "Stock and crypto paper simulations",
    business: "Treasury's owner-only pilot compares historical stock, Bitcoin, Ethereum and Solana strategies with explicit fees, slippage and a benchmark. It does not place trades or promise returns.",
    technical: "Historical daily-bar replay with causal next-open fills, frozen trend/reversion/breakout/RSI presets, persisted equity/fill evidence and optional Jev shadow review. No broker connection, real-money orders or automatic strategy promotion.",
  },
  {
    title: "Optional AgentID sign-in",
    business: "Configured installations can offer AgentID alongside existing human sign-in. Agent accounts have limited access and do not become administrators.",
    technical: "OIDC identity validation, state/nonce/PKCE, session rotation and token-expiry enforcement. Reserved agent identities use non-admin trial tenants; credentials and an exact opt-in flag are required. Authenticated live expiry and cross-tenant behavior are not independently certified.",
  },
  {
    title: "Personal support with Robert",
    business: "Robert is a dedicated specialist for journaling, emotional check-ins, recognizing personal patterns and choosing practical next steps. Shared installation defaults do not include private owner history.",
    technical: "Name-based persona synchronization retains existing environment-local identities. Clean-install tests preserve canonical planner/orchestrator identities independently of the configured generalist name.",
  },
  {
    title: "Clearer model choices and cost controls",
    business: "Owner workflows prefer Luna for routine work and Sol for demanding work, with authorized fallbacks. An optional CheaperInference paid lane has its own shared $20-per-day cap—not a platform-wide spending guarantee.",
    technical: "Requested, resolved and provider-reported models are separate evidence fields. The owner-only paid fallback uses reserve-before-spend accounting and exact opt-in; selected image operations share the lane cap. No new automatic paid retry or guaranteed serving floor.",
  },
  {
    title: "More reliable long-running conversations",
    business: "Progress checks can detect stalled replies; compacted conversations retain recent corrections and cancellations. Approval recovery keeps uncertain work visible instead of blindly repeating it.",
    technical: "OpenClaw-inspired native adaptations add SSE progress deadlines, separately budgeted recent context, correction-aware compaction and renewable fenced approval leases. Prepared-history comparisons are advisory, not provider cache-hit or billing proof.",
  },
  {
    title: "Safer files, approvals and repair evidence",
    business: "Stronger checks keep customer files, owner controls and background work tied to the right account. Proposed code changes still need trustworthy evidence; a diagnostic panel is not a completed verification.",
    technical: "Tenant-bound storage/Drive operations, owner-only voice-wake controls with UI cache masking, task-owned watchdog events and scoped approval writes. Workspace source snapshots and verifier receipts are implemented; production capacity and successful live completion remain unverified.",
  },
  {
    title: "Muse advisory coordination and setup guidance",
    business: "Muse can contribute advisory context through the owner's configured workflow. The integration is partial: a queued message does not prove a reply arrived. The Cue/Felix guide explains setup, not a new active integration.",
    technical: "Owner advisory outbox/poll coordination retains pending/unconfirmed states; correlated cross-conversation reply ingestion and subscription usage are not proven. No new Cue ingress/outbox route or expanded credential-sharing permission is advertised.",
  },
  {
    title: "Current source, portable builds and research discipline",
    business: "Source documentation and repository checks distinguish available features from pilots and research. HERMES and parallel-agent worktree ideas remain references, not newly installed agent swarms.",
    technical: "Public npm tarballs, Node 22.22+ and classified public-test inventory support portable builds. Append-only sanitized mirror history preserves private/public boundaries. REA informed native AST import checks; REA itself, HERMES and worktree orchestration were not installed.",
  },
  {
    title: "More reliable multi-model decisions",
    business: "Owner-requested juries can investigate any topic, retain successful answers and recover failed seats without pretending a substitute was the original model.",
    technical: "Subscription-first, identity-pinned owner jury recovery; preserved seat-owned evidence; bounded Standard Compute fallback. Native paid exceptions keep pre-dispatch reservations and kill switches.",
  },
  {
    title: "Restricted GitHub Copilot chat",
    business: "The owner can explicitly ask Felix or Forge to consult Copilot. This is a chat-only connection, not autonomous access to files, code or customer data.",
    technical: "Official SDK in a fresh isolated subprocess; trusted owner-authored question only; durable 20-attempt daily quota, one concurrent call, 120-second hard deadline and no retries or fallback.",
  },
  {
    title: "Scoped Haiku 5.5 content drafts",
    business: "The existing content-repurposing operation uses Haiku 5.5 at fixed medium effort for eligible paid requests. It drafts content without posting or scheduling it.",
    technical: "Task-only native Anthropic adapter with trusted tenant identity, conservative admission, observed-usage accounting and no paid retry. Automatic effort changes remain shadow-only.",
  },
  {
    title: "New model selection and availability watch",
    business: "Muse Spark 1.3 is registered for selection. A daily OpenRouter watch can add eligible Reflection Beam listings when they appear; Beam is not available yet.",
    technical: "Spark 1.3 pricing/context maps; Beam admission requires supported text modality and valid token rates, refuses request fees, atomically persists pricing and activates the registry. No default or jury promotion.",
  },
  {
    title: "Evidence-backed research and safer recovery",
    business: "Research-first income discovery keeps source quotations and separates evidence from proposals. Missing evidence or failed providers remain visibly incomplete.",
    technical: "Candidate-owned source receipts, preserved failed-attempt metadata, no post-timeout paid retries, scoped Google credentials and fenced scheduled Gmail sends. REA informed a parser-based CI import check, not a new runtime toolkit.",
  },
  {
    title: "Access controls and security maintenance",
    business: "Export of owner-managed skill prompts is now owner-only. Dependency patches and regression checks strengthen the existing tenant and spending boundaries.",
    technical: "Admin export gate, existing Drive ancestry checks regression-verified, Beam metered-cost persistence and compatible dependency patches. Review coverage and remaining findings are documented, not presented as blanket certification.",
  },
];

export function RecentPlatformUpdates({ technical = false }: { technical?: boolean }) {
  return (
    <section id="section-recent-updates" className="max-w-6xl mx-auto px-6 py-12 scroll-mt-24" aria-labelledby="recent-platform-title" data-testid={technical ? "technical-recent-updates" : "business-recent-updates"}>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 id="recent-platform-title" className="text-2xl font-bold">Recent platform updates</h2>
        <span className="rounded bg-cyan-600 text-white px-2 py-1 text-xs font-semibold">{CURRENT_SOURCE_RELEASE}</span>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Source updates through October 14. Counts remain the dated development snapshot.
        Integration access, account allowances and feature flags still apply.
        These notes describe the source, not a guarantee that every option is enabled on this deployment.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {updates.map(update => (
          <article key={update.title} className="rounded-xl border bg-card p-5">
            <h3 className="font-semibold mb-2">{update.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{technical ? update.technical : update.business}</p>
          </article>
        ))}
      </div>
      <Link href="/updates" className="inline-flex items-center gap-2 text-sm text-primary font-medium mt-5">
        Read the full change history <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
