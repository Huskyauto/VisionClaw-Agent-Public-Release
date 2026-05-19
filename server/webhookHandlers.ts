import { getStripeSync } from './stripeClient';
import { deliverDigitalProduct, getDeliveryByStripePayment } from './delivery-pipeline';
import { lookupProduct } from './product-catalog';
import { storage } from './storage';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { sendPlanUpgradeEmail, sendPaymentFailedEmail, sendSubscriptionCancelledEmail } from './email-notifications';
import { claimWebhookEvent, markWebhookEventCompleted } from './webhook-dedupe';
import path from 'path';

// R74.13u — Tag signature-verification failures so the outer route can map
// them to a 400 (alerting/monitoring discrimination) while genuine
// processing failures bubble as 500. Note: Stripe retries on ANY non-2xx
// response (400 and 500 both trigger retry), so this is purely a
// classification signal — not a retry-control mechanism.
export class StripeWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeWebhookSignatureError';
  }
}

const ALLOWED_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

function sanitizeFilePath(rawPath: string | undefined, fileName: string): string {
  const candidate = rawPath || `uploads/${fileName}`;
  const resolved = path.resolve(process.cwd(), candidate);
  if (!resolved.startsWith(ALLOWED_UPLOAD_DIR)) {
    console.warn(`[stripe-delivery] Blocked file path traversal attempt: ${candidate}`);
    return path.join('uploads', path.basename(fileName));
  }
  return candidate;
}

const pendingDeliveries = new Set<string>();

/**
 * Email Bob (the platform owner) when a service-product order has been
 * generated and is waiting in the review queue. Best-effort: a failure to
 * send the email must not break the webhook (the item is already on disk
 * in the queue and visible in the admin UI).
 */
async function notifyOwnerOfReviewItem(params: {
  sessionId: string;
  productName: string;
  customerEmail: string;
  reviewId?: string;
  reviewToken?: string;
  qaPassed?: boolean;
  qaIssues?: string[];
  pages?: number;
  intake?: Record<string, string | undefined>;
  failed?: boolean;
  error?: string;
}): Promise<void> {
  try {
    const { siteConfig } = await import('./site-config');
    const { sendEmail, isEmailConfigured } = await import('./email');
    const ownerEmail = siteConfig.ownerEmail || process.env.SITE_OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL;
    if (!ownerEmail) {
      console.warn('[service-review] No owner email configured — skipping notification');
      return;
    }
    if (!isEmailConfigured()) {
      console.warn('[service-review] Email not configured — skipping notification');
      return;
    }
    const domains = process.env.REPLIT_DOMAINS || process.env.REPLIT_DEV_DOMAIN || '';
    const primaryDomain = domains.split(',')[0]?.trim();
    const baseUrl = primaryDomain ? `https://${primaryDomain}` : '';
    const reviewUrl = baseUrl && params.reviewToken ? `${baseUrl}/admin/service-orders?token=${params.reviewToken}` : `${baseUrl}/admin/service-orders`;

    const safeProductName = String(params.productName ?? '')
      .replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) || 'Untitled';
    const safeCustomerEmail = String(params.customerEmail ?? '')
      .replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 254);
    const subject = params.failed
      ? `[ACTION REQUIRED] Service order FAILED — ${safeProductName}`
      : params.qaPassed
        ? `[Review queue] New service order ready: ${safeProductName}`
        : `[Review queue — flagged] ${safeProductName}`;

    const intakeLines = Object.entries(params.intake || {})
      .filter(([, v]) => v != null && String(v).trim().length > 0)
      .map(([k, v]) => `  ${String(k).slice(0, 80)}: ${String(v).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 300)}`)
      .join('\n');

    const cleanLine = (s: unknown, max = 300) =>
      String(s ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    const issuesBlock = (params.qaIssues || []).length
      ? `\nQA issues:\n${(params.qaIssues || []).map(i => `  - ${cleanLine(i)}`).join('\n')}\n`
      : '';
    const safeError = params.error ? cleanLine(params.error, 1000) : undefined;

    const text = [
      params.failed
        ? `A service-product order failed during generation. Customer has paid but no PDF was produced.`
        : `A service-product order is ready for your review.`,
      ``,
      `Product:      ${safeProductName}`,
      `Customer:     ${safeCustomerEmail || 'N/A'}`,
      `Stripe order: ${params.sessionId}`,
      params.pages != null ? `Pages:        ${params.pages}` : '',
      params.qaPassed != null ? `Auto-QA:      ${params.qaPassed ? 'PASSED' : 'FLAGGED'}` : '',
      issuesBlock,
      intakeLines ? `Intake:\n${intakeLines}\n` : '',
      safeError ? `Error: ${safeError}\n` : '',
      reviewUrl ? `Review queue: ${reviewUrl}` : '',
      ``,
      `The customer will NOT receive their PDF until you approve it from the review queue.`,
    ].filter(Boolean).join('\n');

    await sendEmail({
      inboxId: '',
      to: ownerEmail,
      subject,
      text,
    });
    console.log(`[service-review] Notified owner ${ownerEmail} about ${params.failed ? 'FAILED' : 'PENDING'} order ${params.sessionId}`);
  } catch (err: any) {
    console.error(`[service-review] Failed to notify owner: ${err.message}`);
  }
}

/**
 * Send the customer a "we got your order, your report is being reviewed"
 * holding email so they know the purchase succeeded even though delivery
 * is gated on Bob's approval. Best-effort.
 */
async function sendCustomerHoldingNotice(params: {
  customerEmail?: string;
  customerName?: string;
  productName: string;
  intake?: Record<string, string | undefined>;
}): Promise<void> {
  try {
    if (!params.customerEmail) return;
    const { sendEmail, isEmailConfigured } = await import('./email');
    if (!isEmailConfigured()) return;
    const clean = (s: string | undefined, max: number) =>
      String(s ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    const safeName = clean(params.customerName, 120);
    const safeProduct = clean(params.productName, 150) || 'your order';
    const topic = clean(params.intake?.topic, 200) || 'your requested topic';
    const text = [
      `Hi${safeName ? ' ' + safeName : ''},`,
      ``,
      `Thanks for your order of "${safeProduct}". Payment received.`,
      ``,
      `Our research agent is generating your report on: ${topic}`,
      ``,
      `Each report is reviewed by a human before it ships, so the delivery email`,
      `with your download link will arrive within the next hour or two — usually`,
      `sooner. If you don't see it within 24 hours, just reply to this email.`,
      ``,
      `— The VisionClaw team`,
    ].join('\n');
    await sendEmail({
      inboxId: '',
      to: params.customerEmail,
      subject: `Order received — ${safeProduct}`,
      text,
    });
  } catch (err: any) {
    console.warn(`[service-review] Failed to send customer holding notice: ${err.message}`);
  }
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    // R74.13k — C-HIGH fix from whole-app review pass. Verification MUST run
    // first, before ANY downstream side effects. Previously sync.processWebhook
    // ran first; if that third-party impl ever silently no-op'd or partially
    // dispatched on bad signatures, we'd have leaked grant-credit/email/
    // activation effects through handleDeliveryEvents. Now: constructEvent is
    // the SOLE gate. sync.processWebhook is dispatched AFTER verification
    // succeeds, so it never sees an unverified payload.
    let event: any;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (webhookSecret) {
      try {
        const { getUncachableStripeClient } = await import('./stripeClient');
        const stripe = await getUncachableStripeClient();
        event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      } catch (sigErr: any) {
        console.error(`[stripe-webhook] SIGNATURE VERIFICATION FAILED — refusing to process: ${sigErr.message?.slice(0, 200)}`);
        // Tag the error so the outer route returns 400 instead of 500 —
        // pure classification for monitoring; Stripe retries either way
        // until the 3-day window expires or the secret is fixed.
        throw new StripeWebhookSignatureError(`Stripe webhook signature verification failed: ${sigErr.message}`);
      }

      // R74.13z-tris (architect Area E #7): enforce livemode parity. After the
      // signature has verified the payload originated from Stripe, we must also
      // verify the event's mode matches our environment. Without this, ops
      // accidentally wiring a TEST-mode webhook secret into the production
      // environment would let signed test events trigger plan activations,
      // setup-fee state changes, and credit grants on real customer accounts.
      // In production: only livemode=true accepted. In dev/test: only
      // livemode=false accepted (so a leaked production webhook can't grant
      // dev credits either). Override with STRIPE_ALLOW_MODE_MISMATCH=true
      // for one-off ops scenarios.
      const isProd = process.env.NODE_ENV === "production";
      const expectLive = isProd;
      const eventLive = !!event?.livemode;
      const allowMismatch = process.env.STRIPE_ALLOW_MODE_MISMATCH === "true";
      if (eventLive !== expectLive && !allowMismatch) {
        console.error(`[stripe-webhook] LIVEMODE MISMATCH — refusing event ${event?.id} (${event?.type}). NODE_ENV=${process.env.NODE_ENV} expected livemode=${expectLive} got livemode=${eventLive}`);
        throw new StripeWebhookSignatureError(`Stripe webhook livemode mismatch: NODE_ENV=${process.env.NODE_ENV} expected livemode=${expectLive}, got ${eventLive}. Check STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY are from the same mode.`);
      }
    } else {
      // R64.A — fail CLOSED in production. Without STRIPE_WEBHOOK_SECRET we
      // have no way to prove the payload came from Stripe, and the event can
      // grant credit / send emails / activate subscriptions. Refuse rather
      // than trust whatever JSON arrived. Dev/test environments may still run
      // unsigned for local fixture testing.
      if (process.env.NODE_ENV === "production") {
        console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set in production — refusing to process unsigned webhook");
        throw new Error("Stripe webhook secret not configured; refusing unsigned payload");
      }
      console.warn("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set — accepting unsigned payload (dev only)");
      event = JSON.parse(payload.toString());
    }

    // R74.13u — Durable replay protection. Stripe retries failed deliveries
    // for up to 3 days; without dedupe a single payment could be granted
    // multiple times. The DB-backed dedupe uses a claim-then-commit pattern
    // so a transient failure during dispatch (which makes the outer route
    // return 500 → Stripe retries) does NOT cause the next attempt to be
    // dropped as a duplicate. The claim is recorded after signature
    // verification so an attacker cannot poison the table by spamming
    // unsigned events with chosen IDs. The completion stamp is written
    // ONLY after both pipelines succeed.
    let claim: 'fresh' | 'retry' | 'completed' = 'fresh';
    if (event?.id) {
      claim = await claimWebhookEvent('stripe', event.id);
      if (claim === 'completed') {
        console.log(`[stripe-webhook] Duplicate event ${event.id} (${event.type}) — already completed, skipping`);
        return;
      }
      if (claim === 'retry') {
        console.warn(`[stripe-webhook] Retrying event ${event.id} (${event.type}) — previous attempt did not complete`);
      }
    }

    // Signature verified — now safe to dispatch to both pipelines in parallel
    // semantics: the third-party sync layer can update its own bookkeeping,
    // and our delivery-events dispatcher can grant credits / send emails.
    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);
    await WebhookHandlers.handleDeliveryEvents(event);

    // Both pipelines succeeded — commit the claim so future Stripe retries
    // for this event id short-circuit. If we threw above, completed_at
    // stays NULL and the next retry will re-process (intended behavior).
    if (event?.id) {
      await markWebhookEventCompleted('stripe', event.id);
    }
  }

  static async handleDeliveryEvents(event: any): Promise<void> {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.metadata?.fee_type === 'stripe_setup') {
        await WebhookHandlers.handleSetupFeeCompleted(session);
      }
      if (session.metadata?.plan && session.metadata?.tenantId) {
        await WebhookHandlers.handleSubscriptionActivation(session);
      }
      await WebhookHandlers.handleCheckoutCompleted(session);
    } else if (event.type === 'payment_intent.succeeded') {
      await WebhookHandlers.handlePaymentSucceeded(event.data.object);
    } else if (event.type === 'invoice.payment_failed') {
      await WebhookHandlers.handlePaymentFailed(event.data.object);
    } else if (event.type === 'customer.subscription.deleted') {
      await WebhookHandlers.handleSubscriptionCancelled(event.data.object);
    } else if (event.type === 'customer.subscription.updated') {
      await WebhookHandlers.handleSubscriptionUpdated(event.data.object);
    }
  }

  static async handleSubscriptionActivation(session: any): Promise<void> {
    // R74.13c — H2 fix. State-changing handlers must NOT swallow DB errors.
    // The outer route returns 200 on success, which ACKs to Stripe. If we
    // catch here and return normally, Stripe never retries → revenue event
    // silently lost. Only wrap NON-CRITICAL side effects (notification email)
    // in inner try/catch.
    const plan = session.metadata.plan;
    const tenantId = parseInt(session.metadata.tenantId, 10);
    if (isNaN(tenantId) || !['starter', 'pro', 'enterprise'].includes(plan)) return;

    const customerId = session.customer || null;
    const subscriptionId = session.subscription || null;

    // R74.13c — M1 fix. Ownership cross-check. If this tenant already has a
    // DIFFERENT stripe_customer_id on file, refuse to silently bind a new
    // customer to them — that's the "metadata-spoof" failure mode (one
    // tenant's metadata pointing at another tenant's id). First-bind wins;
    // re-binds require explicit ops review.
    if (customerId) {
      const existing = await storage.getTenant(tenantId);
      if (existing?.stripeCustomerId && existing.stripeCustomerId !== customerId) {
        console.error(`[stripe-webhook] OWNERSHIP MISMATCH: tenant ${tenantId} already bound to customer ${existing.stripeCustomerId}, refusing to overwrite with ${customerId}. Manual ops review required.`);
        // Throw → Stripe retries → ops gets paged. This is a rare, real-money case.
        throw new Error(`Stripe customer ownership mismatch for tenant ${tenantId}`);
      }
    }

    // R74.13z-quint+7 SECURITY (Tier-1 #6): re-fetch the subscription from
    // the Stripe API and verify the price actually matches the plan claimed
    // in metadata. Pre-fix, an attacker could create a $1/year price in
    // their own Stripe Connect account, attach `metadata.plan=enterprise`,
    // and the webhook would happily set tenants.plan='enterprise'. We now
    // require unit_amount === priceMap[plan] AND interval === 'month'. Any
    // mismatch throws so Stripe retries (gives ops a chance to investigate)
    // and the row is NOT mutated.
    const PLAN_PRICE_CENTS: Record<string, number> = { starter: 2900, pro: 9900, enterprise: 29900 };
    const expectedAmount = PLAN_PRICE_CENTS[plan];
    if (subscriptionId) {
      try {
        const { getUncachableStripeClient } = await import('./stripeClient');
        const stripe = await getUncachableStripeClient();
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const item = sub.items?.data?.[0];
        const price = item?.price;
        if (!price) {
          throw new Error(`subscription ${subscriptionId} has no price item`);
        }
        if (price.unit_amount !== expectedAmount) {
          throw new Error(`price mismatch for plan ${plan}: expected ${expectedAmount} cents, got ${price.unit_amount}`);
        }
        if (price.recurring?.interval !== 'month') {
          throw new Error(`expected monthly interval for plan ${plan}, got ${price.recurring?.interval}`);
        }
        if (price.currency && price.currency.toLowerCase() !== 'usd') {
          throw new Error(`expected USD currency for plan ${plan}, got ${price.currency}`);
        }
      } catch (priceErr: any) {
        console.error(`[stripe-webhook] PRICE VERIFICATION FAILED for tenant ${tenantId} plan ${plan}: ${priceErr.message}`);
        // Throw → Stripe retries → ops gets paged. Plan stays unchanged.
        throw new Error(`Stripe price verification failed: ${priceErr.message}`);
      }
    } else {
      console.error(`[stripe-webhook] activation event for tenant ${tenantId} plan ${plan} has no subscription id; refusing to upgrade`);
      throw new Error(`Stripe activation missing subscription id`);
    }

    await db.execute(sql`UPDATE tenants SET plan = ${plan}, stripe_customer_id = COALESCE(${customerId}, stripe_customer_id), stripe_subscription_id = COALESCE(${subscriptionId}, stripe_subscription_id) WHERE id = ${tenantId}`);
    console.log(`[stripe-webhook] Auto-activated ${plan} plan for tenant ${tenantId} (customer: ${customerId}, subscription: ${subscriptionId})`);

    // Notification email is best-effort; if it fails, the plan IS activated
    // and Stripe doesn't need a retry — keep the inner catch for this only.
    try {
      const tenant = await storage.getTenant(tenantId);
      if (tenant?.email) {
        await sendPlanUpgradeEmail(tenant.email, tenant.name, plan);
      }
    } catch (notifErr: any) {
      console.error('[stripe-webhook] Plan upgrade notification email failed (plan activation succeeded):', notifErr.message);
    }
  }

  static async handleSetupFeeCompleted(session: any): Promise<void> {
    // R74.13u — Do NOT swallow DB errors. The outer route ACKs 200 + commits
    // the dedupe row only after this returns; a swallowed failure here would
    // permanently lose the setup-fee-paid flag with no Stripe retry.
    const tenantIdStr = session.metadata?.visionclaw_tenant_id;
    if (!tenantIdStr) return;

    const tenantId = parseInt(tenantIdStr, 10);
    if (isNaN(tenantId)) return;

    await storage.updateTenant(tenantId, { stripeSetupFeePaid: true });
    console.log(`[stripe-setup-fee] Setup fee paid for tenant ${tenantId} (type: ${session.metadata?.setup_type})`);
  }

  static resolvePaymentKey(session: any): string {
    return session.payment_intent || `cs_${session.id}`;
  }

  static async handleCheckoutCompleted(session: any): Promise<void> {
    try {
      const paymentKey = WebhookHandlers.resolvePaymentKey(session);
      // Customer email MUST come from the Stripe session — never hardcoded,
      // never inferred. See .agents/skills/customer-delivery/SKILL.md
      // ("Where the customer's email address comes from — DO NOT
      // HALLUCINATE") for the canonical rule. Round 8 / delivery #69
      // surfaced this failure mode (agent invented an address; SMTP
      // accepted it; customer never saw the email). If Stripe didn't
      // give us an email, we refuse to deliver — better a missed auto-
      // delivery than a real product shipped to a hallucinated inbox.
      const customerEmail = session.customer_details?.email || session.customer_email;
      const customerName = session.customer_details?.name || customerEmail || 'Customer';

      if (!customerEmail) {
        console.log('[stripe-delivery] Checkout completed but no customer email found, skipping auto-delivery');
        return;
      }

      // RACE-CONDITION GATE: in-process Set check + add MUST be synchronous
      // (no await between them) or parallel events all slip past the gate.
      // Round 11 stress test caught this: 5 events fired in parallel produced
      // 5 deliveries because the previous code awaited the DB check BEFORE
      // calling .add(). Now we claim the slot immediately, then wrap the
      // rest of the work in try/finally so the slot always gets released.
      if (pendingDeliveries.has(paymentKey)) {
        console.log(`[stripe-delivery] Delivery already in progress for ${paymentKey}, skipping`);
        return;
      }
      pendingDeliveries.add(paymentKey);

    try {
      const existing = await getDeliveryByStripePayment(paymentKey);
      if (existing) {
        console.log(`[stripe-delivery] Delivery already exists for payment ${paymentKey}, skipping`);
        return;
      }

      const metadata = session.metadata || {};

      // PREFERRED PATH: bundle_sku → server-side product catalog. The
      // catalog is the trusted source of truth for what a paid SKU
      // delivers. Stripe metadata only carries the SKU, never raw file
      // paths, which means a misconfigured Stripe product can't trick
      // us into delivering arbitrary files. Bundle SKUs can include
      // a primary file PLUS additionalFiles[] (Round 8 bundle support).
      const bundleSku = metadata.bundle_sku || metadata.bundleSku;
      let productName: string | undefined;
      let fileName: string | undefined;
      let safePath: string | undefined;
      let additionalFiles: import('./delivery-pipeline').BundleFile[] | undefined;

      if (bundleSku) {
        const product = lookupProduct(bundleSku);
        if (!product) {
          console.error(`[stripe-delivery] Unknown bundle_sku "${bundleSku}" on session ${session.id} — refusing delivery (would have shipped a hallucinated product)`);
          return;
        }
        productName = metadata.product_name || metadata.productName || product.productName;
        // Narrow + guard: lookupProduct should never return an empty productName,
        // but the metadata-prefer chain above keeps TS unable to prove it. Bail
        // explicitly so downstream addReviewItem/deliverDigitalProduct calls
        // can rely on `productName: string` (and so a misconfigured catalog
        // entry doesn't ship as a blank-titled order).
        if (!productName) {
          console.error(`[stripe-delivery] Catalog SKU "${bundleSku}" produced empty productName on session ${session.id} — refusing delivery`);
          return;
        }

        // SERVICE PRODUCTS: no pre-built file — generate the artifact, then
        // ENQUEUE for Bob's review. We do NOT auto-deliver. Customers paid
        // for a real, proofread report — Bob explicitly wants to confirm
        // each PDF and download link before anything ships.
        if (product.kind === 'service' && product.serviceType === 'research-report') {
          // ──────────────────────────────────────────────────────────────
          // SERVICE-PRODUCT BRANCH — wrapped in its own safety net.
          // Bob's #1 rule: a paid order must NEVER vanish silently. So
          // ANYTHING that throws inside this block (queue I/O, generation
          // crash, notifier crash) gets caught at the bottom and turns
          // into a best-effort "failed" review item + owner alert. If
          // even THAT recovery fails, we re-throw so the outer Stripe
          // webhook returns non-2xx → Stripe will retry the event.
          // ──────────────────────────────────────────────────────────────
          const queueMod = await import('./service-review-queue');
          const { addReviewItem, runQualityChecks, findReviewItemBySessionId,
                  isAutoShipEligible, autoDisableForBrokenShip, updateReviewItem } = queueMod;

          // Webhook idempotency: Stripe is at-least-once. If we've already
          // enqueued this session, do nothing. Auto-shipped items are
          // marked `shipped` and the delivery dedupe gate above catches
          // those before we even get here, but a `pending` retry would
          // otherwise generate a second PDF and double-bill the LLM.
          const dupe = findReviewItemBySessionId(session.id);
          if (dupe) {
            console.log(`[stripe-delivery] Service order ${session.id} already in queue as ${dupe.id} (status=${dupe.status}) — skipping retry`);
            return;
          }

          console.log(`[stripe-delivery] Service product "${productName}" — kicking off research-report fulfillment for ${customerEmail}`);
          const { fulfillResearchReport } = await import('./research-report-fulfillment');
          const intake = {
            topic: metadata.intake_topic || '',
            audience: metadata.intake_audience || undefined,
            focus: metadata.intake_focus || undefined,
            depth: (metadata.intake_depth === 'deep' ? 'deep' : 'standard') as 'standard' | 'deep',
          };
          try {
            // VisionClaw's public storefront is operated by the platform owner
            // (tenant 1, "Robert Washburn"). End-buyers are anonymous consumers,
            // not platform tenants. Research-report fulfillment runs in the
            // platform owner's tenant scope so the audit trail / storage / cost
            // attribution lands on the operator. If/when per-tenant storefronts
            // ship, read tenantId from session.metadata.tenantId here instead.
            const PLATFORM_OWNER_TENANT_ID = 1;
            const fulfillment = await fulfillResearchReport({
              intake,
              customerEmail,
              orderId: session.id,
              tenantId: PLATFORM_OWNER_TENANT_ID,
            });
            if (!fulfillment.success || !fulfillment.filePath || !fulfillment.fileName) {
              console.error(`[stripe-delivery] Service fulfillment FAILED for ${session.id}: ${fulfillment.error}`);
              await addReviewItem({
                sessionId: session.id,
                sku: bundleSku,
                productName,
                customerEmail: customerEmail || '',
                customerName: customerName || customerEmail || 'Customer',
                intake,
                filePath: fulfillment.filePath || '',
                fileName: fulfillment.fileName || '',
                qa: { passed: false, issues: [`Generation failed: ${fulfillment.error || 'unknown error'}`] },
                status: 'failed',
                modelUsed: fulfillment.modelUsed,
              });
              await notifyOwnerOfReviewItem({ sessionId: session.id, productName, customerEmail: customerEmail || '', failed: true, error: fulfillment.error });
              return;
            }
            // Run automated QA checks on the generated PDF + sections.
            const qa = runQualityChecks({
              filePath: fulfillment.filePath,
              pageCount: fulfillment.pages,
              depth: intake.depth,
              sections: fulfillment.sections || [],
            });
            // Decide: auto-ship (graduated SKU + QA passed) or hold for review.
            const eligibility = isAutoShipEligible(bundleSku);
            const canAuto = eligibility.eligible && qa.passed;

            const queued = await addReviewItem({
              sessionId: session.id,
              sku: bundleSku,
              productName,
              customerEmail: customerEmail || '',
              customerName: customerName || customerEmail || 'Customer',
              intake,
              filePath: fulfillment.filePath,
              fileName: fulfillment.fileName,
              qa,
              modelUsed: fulfillment.modelUsed,
              pages: fulfillment.pages,
            });
            console.log(`[stripe-delivery] Service product enqueued id=${queued.id} qa.passed=${qa.passed} issues=${qa.issues.length} auto=${canAuto} (${eligibility.reason})`);

            if (canAuto) {
              // Auto-ship: deliver immediately, then update queue. If link
              // verification comes back false, snap auto-ship OFF for this
              // SKU so subsequent orders go back to manual review.
              try {
                const result = await deliverDigitalProduct({
                  customerName: customerName || customerEmail || 'Customer',
                  customerEmail: customerEmail || '',
                  productName,
                  filePath: fulfillment.filePath,
                  fileName: fulfillment.fileName,
                  mimeType: 'application/pdf',
                  orderId: session.id,
                  // Use the same paymentKey the outer dedupe gate uses, so
                  // a Stripe replay can't squeeze through and double-deliver.
                  stripePaymentId: paymentKey,
                  sendEmail: true,
                  metadata: { sku: bundleSku, reviewItemId: queued.id, source: 'auto-ship' },
                });
                if (result.success) {
                  await updateReviewItem(queued.id, {
                    status: 'shipped',
                    reviewedAt: new Date().toISOString(),
                    deliveryId: result.deliveryId,
                    deliveryLinkVerified: result.linkVerified,
                  });
                  if (result.linkVerified === false) {
                    const policy = await autoDisableForBrokenShip(bundleSku, result.deliveryId);
                    console.warn(`[stripe-delivery] Auto-shipped #${result.deliveryId} but link verification FAILED — auto-ship for ${bundleSku} disabled (${policy.lastAutoDisableReason})`);
                    await notifyOwnerOfReviewItem({
                      sessionId: session.id,
                      productName,
                      customerEmail: customerEmail || '',
                      reviewId: queued.id,
                      reviewToken: queued.reviewToken,
                      qaPassed: qa.passed,
                      qaIssues: ['Auto-shipped delivery failed link verification — auto-ship for this SKU has been turned OFF. Investigate Drive/email pipeline.'],
                      pages: fulfillment.pages,
                      intake,
                    });
                  } else {
                    console.log(`[stripe-delivery] Auto-shipped ${queued.id} → delivery #${result.deliveryId}`);
                  }
                } else {
                  await updateReviewItem(queued.id, {
                    status: 'failed',
                    rejectedReason: `Auto-ship delivery failed: ${result.error || 'unknown'}`,
                    reviewedAt: new Date().toISOString(),
                  });
                  await autoDisableForBrokenShip(bundleSku, result.deliveryId);
                  await notifyOwnerOfReviewItem({
                    sessionId: session.id,
                    productName,
                    customerEmail: customerEmail || '',
                    reviewId: queued.id,
                    reviewToken: queued.reviewToken,
                    failed: true,
                    error: `Auto-ship delivery failed: ${result.error}. Auto-ship for ${bundleSku} disabled.`,
                  });
                }
              } catch (autoErr: any) {
                console.error(`[stripe-delivery] Auto-ship threw: ${autoErr.message}`);
                await updateReviewItem(queued.id, {
                  status: 'failed',
                  rejectedReason: `Auto-ship exception: ${autoErr.message}`,
                  reviewedAt: new Date().toISOString(),
                });
                await autoDisableForBrokenShip(bundleSku);
                await notifyOwnerOfReviewItem({
                  sessionId: session.id,
                  productName,
                  customerEmail: customerEmail || '',
                  reviewId: queued.id,
                  reviewToken: queued.reviewToken,
                  failed: true,
                  error: `Auto-ship exception: ${autoErr.message}. Auto-ship disabled.`,
                });
              }
            } else {
              // Manual review path
              await notifyOwnerOfReviewItem({
                sessionId: session.id,
                productName,
                customerEmail: customerEmail || '',
                reviewId: queued.id,
                reviewToken: queued.reviewToken,
                qaPassed: qa.passed,
                qaIssues: qa.issues,
                pages: fulfillment.pages,
                intake,
              });
              await sendCustomerHoldingNotice({ customerEmail, customerName, productName, intake });
            }
          } catch (svcErr: any) {
            // Catastrophic safety net. Best-effort: persist a failed item
            // (idempotent via sessionId) + alert Bob. If even that fails,
            // re-throw so Stripe sees a 5xx and will retry — better a
            // duplicate alert than a silent loss.
            console.error(`[stripe-delivery] CATASTROPHIC service-product failure for session ${session.id}: ${svcErr.message}\n${svcErr.stack}`);
            try {
              const fallback = await addReviewItem({
                sessionId: session.id,
                sku: bundleSku,
                productName: productName || bundleSku,
                customerEmail: customerEmail || '',
                customerName: customerName || customerEmail || 'Customer',
                intake,
                filePath: '',
                fileName: '',
                qa: { passed: false, issues: [`Pipeline crashed: ${svcErr.message}`] },
                status: 'failed',
              });
              await notifyOwnerOfReviewItem({
                sessionId: session.id,
                productName: productName || bundleSku,
                customerEmail: customerEmail || '',
                reviewId: fallback.id,
                reviewToken: fallback.reviewToken,
                failed: true,
                error: `Pipeline exception: ${svcErr.message}. Customer paid — investigate immediately.`,
              });
            } catch (recoverErr: any) {
              console.error(`[stripe-delivery] Recovery ALSO failed for ${session.id}: ${recoverErr.message} — re-throwing for Stripe retry`);
              throw svcErr;
            }
          }
          // STOP HERE — for manual path delivery happens on approval; for auto
          // path delivery already happened above.
          return;
        } else if (product.primary) {
          fileName = product.primary.fileName;
          safePath = product.primary.filePath;
          additionalFiles = product.additionalFiles;
          console.log(`[stripe-delivery] Resolved bundle_sku="${bundleSku}" → ${productName} (${1 + (additionalFiles?.length || 0)} file${additionalFiles?.length ? 's' : ''})`);
        } else {
          console.error(`[stripe-delivery] Product "${bundleSku}" has neither static file nor known service handler — cannot deliver`);
          return;
        }
      } else {
        // LEGACY single-file path: metadata carries productName + fileName + filePath.
        productName = metadata.product_name || metadata.productName;
        fileName = metadata.file_name || metadata.fileName;
        if (!productName || !fileName) {
          console.log(`[stripe-delivery] Checkout ${session.id} has no delivery metadata (bundle_sku OR product_name+file_name), skipping auto-delivery`);
          return;
        }
        safePath = sanitizeFilePath(metadata.file_path || metadata.filePath, fileName);
      }

      console.log(`[stripe-delivery] Auto-delivering "${productName}" to ${customerEmail} (key: ${paymentKey})`);

      const result = await deliverDigitalProduct({
        customerName,
        customerEmail,
        productName: productName!,
        fileName: fileName!,
        filePath: safePath,
        additionalFiles,
        stripePaymentId: paymentKey,
        orderId: session.id,
        metadata: {
          stripeSessionId: session.id,
          amountTotal: session.amount_total,
          currency: session.currency,
          ...metadata,
        },
      });

      if (result.success) {
        console.log(`[stripe-delivery] Auto-delivery COMPLETED: #${result.deliveryId} → ${customerEmail} (bundle items: ${result.bundleFiles?.length || 0})`);
      } else {
        // R74.13h: throw on soft-failure so the outer R60 catch rethrows and
        // Stripe sees non-2xx + retries. Previously this only logged, so a
        // delivery-failure-after-charge silently ACK'd the webhook and Stripe
        // stopped retrying — paid-without-delivery.
        console.error(`[stripe-delivery] Auto-delivery FAILED: #${result.deliveryId} — ${result.error}`);
        throw new Error(`Delivery failed for ${paymentKey}: ${result.error || 'unknown error'}`);
      }
    } finally {
      pendingDeliveries.delete(paymentKey);
    }
    } catch (err: any) {
      // R60 — Do NOT swallow: rethrow so Stripe sees non-2xx and retries.
      // Previously this catch returned the webhook 200 even on delivery
      // failures outside the service-product branch (legacy single-file
      // path, deliverDigitalProduct exceptions, etc.), causing silent
      // payment-without-delivery. Logging preserved for triage.
      console.error('[stripe-delivery] handleCheckoutCompleted error:', err.message, err.stack);
      throw err;
    }
  }

  static async handlePaymentFailed(invoice: any): Promise<void> {
    // R74.13u — Do NOT swallow tenant-lookup DB errors (those should retry
    // via Stripe). The outbound notification email is best-effort: a stuck
    // SMTP must not cause Stripe to redeliver the same invoice.failed event.
    const customerEmail = invoice.customer_email;
    const metadata = invoice.subscription_details?.metadata || invoice.metadata || {};
    const tenantId = metadata.tenantId ? parseInt(metadata.tenantId, 10) : null;

    let recipient: { email: string; name: string } | null = null;
    if (tenantId) {
      const tenant = await storage.getTenant(tenantId);
      if (tenant?.email) recipient = { email: tenant.email, name: tenant.name };
    } else if (customerEmail) {
      const result = await db.execute(sql`SELECT id, name, email FROM tenants WHERE email = ${customerEmail} LIMIT 1`);
      const rows = (result as any).rows || result;
      if (rows.length > 0) recipient = { email: rows[0].email, name: rows[0].name };
    }

    if (recipient) {
      try {
        await sendPaymentFailedEmail(recipient.email, recipient.name);
      } catch (notifErr: any) {
        console.error('[stripe-webhook] payment-failed notification email failed (non-fatal):', notifErr.message);
      }
    }

    console.log(`[stripe-webhook] Payment failed for ${customerEmail || `tenant ${tenantId}`}`);
  }

  static async handleSubscriptionCancelled(subscription: any): Promise<void> {
    // R74.13c — H2 fix. Re-throw on DB failures so Stripe retries.
    // Wrap only the notification email in inner try/catch.
    const metadata = subscription.metadata || {};
    const tenantId = metadata.tenantId ? parseInt(metadata.tenantId, 10) : null;

    let resolvedTenantId: number | null = tenantId;
    let tenantEmail: string | null = null;
    let tenantName: string | null = null;

    if (tenantId) {
      await db.execute(sql`UPDATE tenants SET plan = 'trial' WHERE id = ${tenantId}`);
      console.log(`[stripe-webhook] Subscription cancelled — tenant ${tenantId} downgraded to trial`);
      const tenant = await storage.getTenant(tenantId);
      tenantEmail = tenant?.email ?? null;
      tenantName = tenant?.name ?? null;
    } else {
      const customerId = subscription.customer;
      if (customerId) {
        const result = await db.execute(sql`SELECT id, name, email FROM tenants WHERE stripe_customer_id = ${customerId} LIMIT 1`);
        const rows = (result as any).rows || result;
        if (rows.length > 0) {
          resolvedTenantId = rows[0].id;
          tenantEmail = rows[0].email;
          tenantName = rows[0].name;
          await db.execute(sql`UPDATE tenants SET plan = 'trial' WHERE id = ${rows[0].id}`);
          console.log(`[stripe-webhook] Subscription cancelled — tenant ${rows[0].id} (by customer ${customerId}) downgraded to trial`);
        }
      }
    }

    if (tenantEmail) {
      try {
        await sendSubscriptionCancelledEmail(tenantEmail, tenantName ?? "");
      } catch (notifErr: any) {
        console.error(`[stripe-webhook] Cancellation email failed for tenant ${resolvedTenantId} (plan downgrade succeeded):`, notifErr.message);
      }
    }
  }

  static async handleSubscriptionUpdated(subscription: any): Promise<void> {
    // R74.13c — H2 fix. Re-throw on DB failures so Stripe retries.
    const metadata = subscription.metadata || {};
    let tenantId = metadata.tenantId ? parseInt(metadata.tenantId, 10) : null;

    if (!tenantId) {
      const customerId = subscription.customer;
      if (customerId) {
        const result = await db.execute(sql`SELECT id FROM tenants WHERE stripe_customer_id = ${customerId} LIMIT 1`);
        const rows = (result as any).rows || result;
        if (rows.length > 0) tenantId = rows[0].id;
      }
    }

    if (subscription.cancel_at_period_end) {
      console.log(`[stripe-webhook] Subscription set to cancel at period end for tenant ${tenantId || 'unknown'}`);
      return;
    }

    const plan = metadata.plan;
    if (tenantId && plan && ['starter', 'pro', 'enterprise'].includes(plan)) {
      // R74.13z-quint+7 SECURITY follow-up (Tier-1 #6 extension): the
      // architect re-review caught that update-driven plan changes
      // (subscription.updated) skipped the price re-verification we added
      // to handleSubscriptionActivation. Mirror the check: pull the live
      // price off the inbound subscription and verify it matches the
      // PLAN_PRICE_CENTS map before mutating tenants.plan. Any mismatch
      // throws → Stripe retries → ops gets paged.
      const PLAN_PRICE_CENTS: Record<string, number> = { starter: 2900, pro: 9900, enterprise: 29900 };
      const expectedAmount = PLAN_PRICE_CENTS[plan];
      const item = subscription.items?.data?.[0];
      const price = item?.price;
      if (!price || price.unit_amount !== expectedAmount) {
        const got = price?.unit_amount;
        console.error(`[stripe-webhook] subscription.updated PRICE VERIFICATION FAILED for tenant ${tenantId} plan ${plan}: expected ${expectedAmount} cents, got ${got}`);
        throw new Error(`Stripe subscription.updated price mismatch (plan=${plan}, got=${got})`);
      }
      if (price.recurring?.interval !== 'month') {
        console.error(`[stripe-webhook] subscription.updated INTERVAL MISMATCH for tenant ${tenantId} plan ${plan}: ${price.recurring?.interval}`);
        throw new Error(`Stripe subscription.updated interval mismatch (plan=${plan})`);
      }
      if (price.currency && price.currency.toLowerCase() !== 'usd') {
        console.error(`[stripe-webhook] subscription.updated CURRENCY MISMATCH for tenant ${tenantId} plan ${plan}: ${price.currency}`);
        throw new Error(`Stripe subscription.updated currency mismatch (plan=${plan})`);
      }

      await db.execute(sql`UPDATE tenants SET plan = ${plan} WHERE id = ${tenantId}`);
      console.log(`[stripe-webhook] Subscription updated — tenant ${tenantId} plan set to ${plan} (price verified: ${expectedAmount} cents)`);
    }
  }

  static async handlePaymentSucceeded(paymentIntent: any): Promise<void> {
    try {
      const metadata = paymentIntent.metadata || {};
      if (!metadata.product_name && !metadata.productName) return;

      const paymentKey = paymentIntent.id;

      // SECURITY: Claim the in-process lock BEFORE the async DB lookup.
      // Stripe retries duplicate events aggressively; a parallel-event race
      // could pass both the has() check and the DB check and double-deliver.
      // The DB-side guard via getDeliveryByStripePayment remains for
      // cross-process safety — but the local claim has to come first to win
      // in-process races.
      if (pendingDeliveries.has(paymentKey)) return;
      pendingDeliveries.add(paymentKey);

      try {
        const existing = await getDeliveryByStripePayment(paymentKey);
        if (existing) return;

        // Email comes from Stripe (receipt_email or merchant-supplied
        // metadata.customer_email). NEVER hardcode or infer. See
        // .agents/skills/customer-delivery/SKILL.md "DO NOT HALLUCINATE".
        const customerEmail = paymentIntent.receipt_email || metadata.customer_email;
        const customerName = metadata.customer_name || customerEmail || 'Customer';
        const productName = metadata.product_name || metadata.productName;
        const fileName = metadata.file_name || metadata.fileName;

        if (!customerEmail || !productName || !fileName) return;

        console.log(`[stripe-delivery] PaymentIntent auto-delivery: "${productName}" → ${customerEmail}`);

        const safePath = sanitizeFilePath(metadata.file_path || metadata.filePath, fileName);

        await deliverDigitalProduct({
          customerName,
          customerEmail,
          productName,
          fileName,
          filePath: safePath,
          stripePaymentId: paymentKey,
          metadata: {
            paymentIntentId: paymentIntent.id,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency,
            ...metadata,
          },
        });
      } finally {
        pendingDeliveries.delete(paymentKey);
      }
    } catch (err: any) {
      // R74.13c — H2 fix. Re-throw so Stripe retries the delivery if it
      // failed on our end. The in-process and DB-side dedupe locks above
      // already protect against double-delivery on retry. Logging stays.
      console.error('[stripe-delivery] handlePaymentSucceeded error:', err.message);
      throw err;
    }
  }
}
