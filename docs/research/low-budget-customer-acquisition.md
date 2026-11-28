# Low-budget customer acquisition — evidence and next actions

Reviewed November 26, 2026. This is an engineering/commercial reference, not
proof of demand, an application submission or permission to send messages.

## Verified funded-work source: OpenAI OpenWorks

Primary sources read:

- https://openai.com/openworks/
- https://help.openai.com/en/articles/20001724-how-to-apply-to-openworks-and-follow-up-on-your-application
- Partner form linked by those sources: https://openai.com/form/openworks-partner/

The official pages list Chicago among pilot communities and invite individuals
and small teams, explicitly including software and AI consultancies, to apply
as partners alongside existing client work. Partners are contractors; the
advertised stipend is **up to $8,000/month**, not guaranteed income. Minimum
commitment: four full days each month helping businesses plus one monthly
workshop. The pilot prefers in-person work in the United States.

Important distinction: software/SaaS companies are excluded from the
business-recipient pilot, not from applying as consulting partners. Do not
discard the partner possibility based on the wrong eligibility section.

Unknowns: acceptance, local placement, actual stipend, payment duration,
contract terms, whether outside tooling such as VisionClaw may be used, and
ownership/retention requirements. Verify those before committing. No form
was submitted, account created or third-party message sent.

Suggested work-sample description, subject to Bob's review:

> I build AI-assisted business workflows and reports that turn public research
> and owner-provided context into practical, reviewable next steps. I can show
> how I scope a small pilot, keep the owner in control, and measure results
> without promising unsupported savings. I would focus on a workflow chosen by
> the business, use its existing tools where practical, and teach the owner how
> to continue the process.

This deliberately does not claim paying clients, measured business outcomes,
certifications or availability that have not been established.

## Start with permissioned, small-scale direct work

1. Review existing owner-authorized contacts, requested previews and referrals
   before buying lists or generating cold prospects at scale.
2. Offer one useful, small workflow conversation or an already-prepared,
   company-matched preview. Explain the concrete next step rather than selling
   a large collection of AI features.
3. Track contact, reply, meeting, quoted offer and payment separately. A sent
   email or a positive conversation is not a paying customer.
4. Prefer introductions from web designers, bookkeepers, consultants and
   IT providers who already have the prospective business's trust. This is a
   proposed channel, not a verified partner relationship.
5. Confirm sender deliverability, owner approval and the recipient context
   before any outreach. Stop on decline or opt-out; do not automate a campaign
   until reply/stop behavior is verified.

Initial conversation draft, not sent:

> I help small businesses identify one practical workflow where AI might be
> useful, using tools they already have where possible. If there is a repetitive
> task you would like to improve, I can walk through it with you and suggest a
> small first test. No advertising purchase or software subscription is needed
> for that initial conversation.

## Protect the economics of free previews

Do not interpret "free preview for the prospect" as "free generation for Bob."
Do not generate ten paid full three-report packages speculatively. Reuse an
existing company-matched approved preview where available, or do a bounded
public-information/manual qualification first. Paid research, full generation,
review and delivery must retain their existing spend approval and accounting.

Next engineering priority after the guard/action guidance: trace one complete
report's costs before expanding free fulfillment or changing model routes.
No cost reconciliation, Google adapter migration or model-routing downgrade is
claimed implemented by this reference.

## Cost visibility design — November 26

The existing package status will distinguish durable **model reservations**
from actual charges. Reservations survive uncertain requests and retries;
they must not be presented as an invoice total or profit.

1. Cost: pure arithmetic over at most 2,000 existing reservation entries;
   no provider calls, extra queries or paid generation.
2. State: read the existing package payload; no table, ledger or cache added.
3. Failure: malformed amounts, unsafe sums and missing evidence display unknown,
   never a fabricated zero or a clean reconciliation.
4. Identity: aggregate each existing reservation key once, including recovery
   keys. Do not merge independently reserved corrective attempts.
5. Tenant/limits: reuse the current owner-authenticated package projection;
   no new endpoint or cross-tenant lookup.
6. Stop/observe: no scheduler. The owner can see recorded reservations and the
   unreconciled status alongside the existing package progress.
7. Authority: informational only; it cannot approve spending, retry work, refund
   a claim, generate a report, contact a customer or publish.
8. Evidence: offline malformed/missing/duplicate/recovery fixtures and the real
   projection/UI wiring. Historical actual charges remain unproven until matched
   to provider/ledger receipts. Research, audio, hosting, delivery and labor are
   explicitly outside the model-reservation sum.

## IdeaBrowser decision projection

The November 23 production report ranks a $-240 expected-profit dental idea
first while its validator says NO-GO. Ranking is not a recommendation. Its
bulk-email instructions, unsupported savings headline and zero-cost claims
are not adopted.

Apply a deterministic report projection: recalculate expected profit using
both reported probabilities; withhold launch plans for negative economics,
SKIP/NO-GO, missing validation or ambiguous verdicts. A positive result remains
a candidate for owner review, never execution approval.

Design gate: (1) zero added model/API calls; (2) pure computation over existing
results, with decision metadata stored in existing project records; (3) malformed
numbers and missing validation withhold actions; (4) same inputs give the same
decision, without rerunning a report; (5) existing owner scope stays unchanged;
(6) no scheduler or new autonomy; (7) models advise, deterministic code withholds,
the owner alone authorizes consequential action; (8) offline fixtures cover
negative, conflicting, missing, malformed and positive cases plus both callers.
Historical Drive reports are not overwritten.
