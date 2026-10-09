import { Link } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";
import { CURRENT_SOURCE_RELEASE } from "./prepublication-notice";

const updates = [
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
    <section className="max-w-6xl mx-auto px-6 py-12" aria-labelledby="recent-platform-title" data-testid={technical ? "technical-recent-updates" : "business-recent-updates"}>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 id="recent-platform-title" className="text-2xl font-bold">Recent platform updates</h2>
        <span className="rounded bg-cyan-600 text-white px-2 py-1 text-xs font-semibold">{CURRENT_SOURCE_RELEASE}</span>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        October 4–8 source changes. Integration access, account allowances and feature flags still apply.
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
