import { getStripeSync } from './stripeClient';
import { deliverDigitalProduct, getDeliveryByStripePayment } from './delivery-pipeline';
import { storage } from './storage';
import { db } from './db';
import { sql } from 'drizzle-orm';
import { sendPlanUpgradeEmail, sendPaymentFailedEmail, sendSubscriptionCancelledEmail } from './email-notifications';
import path from 'path';

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

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    const event = JSON.parse(payload.toString());
    await WebhookHandlers.handleDeliveryEvents(event);
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
    try {
      const plan = session.metadata.plan;
      const tenantId = parseInt(session.metadata.tenantId, 10);
      if (isNaN(tenantId) || !['starter', 'pro', 'enterprise'].includes(plan)) return;

      const customerId = session.customer || null;
      const subscriptionId = session.subscription || null;

      await db.execute(sql`UPDATE tenants SET plan = ${plan}, stripe_customer_id = COALESCE(${customerId}, stripe_customer_id), stripe_subscription_id = COALESCE(${subscriptionId}, stripe_subscription_id) WHERE id = ${tenantId}`);
      console.log(`[stripe-webhook] Auto-activated ${plan} plan for tenant ${tenantId} (customer: ${customerId}, subscription: ${subscriptionId})`);

      const tenant = await storage.getTenant(tenantId);
      if (tenant?.email) {
        await sendPlanUpgradeEmail(tenant.email, tenant.name, plan);
      }
    } catch (err: any) {
      console.error('[stripe-webhook] Subscription activation error:', err.message);
    }
  }

  static async handleSetupFeeCompleted(session: any): Promise<void> {
    try {
      const tenantIdStr = session.metadata?.visionclaw_tenant_id;
      if (!tenantIdStr) return;

      const tenantId = parseInt(tenantIdStr, 10);
      if (isNaN(tenantId)) return;

      await storage.updateTenant(tenantId, { stripeSetupFeePaid: true });
      console.log(`[stripe-setup-fee] Setup fee paid for tenant ${tenantId} (type: ${session.metadata?.setup_type})`);
    } catch (err: any) {
      console.error('[stripe-setup-fee] Error processing setup fee:', err.message);
    }
  }

  static resolvePaymentKey(session: any): string {
    return session.payment_intent || `cs_${session.id}`;
  }

  static async handleCheckoutCompleted(session: any): Promise<void> {
    try {
      const paymentKey = WebhookHandlers.resolvePaymentKey(session);
      const customerEmail = session.customer_details?.email || session.customer_email;
      const customerName = session.customer_details?.name || customerEmail || 'Customer';

      if (!customerEmail) {
        console.log('[stripe-delivery] Checkout completed but no customer email found, skipping auto-delivery');
        return;
      }

      if (pendingDeliveries.has(paymentKey)) {
        console.log(`[stripe-delivery] Delivery already in progress for ${paymentKey}, skipping`);
        return;
      }

      const existing = await getDeliveryByStripePayment(paymentKey);
      if (existing) {
        console.log(`[stripe-delivery] Delivery already exists for payment ${paymentKey}, skipping`);
        return;
      }

      const metadata = session.metadata || {};
      const productName = metadata.product_name || metadata.productName;
      const fileName = metadata.file_name || metadata.fileName;

      if (!productName || !fileName) {
        console.log(`[stripe-delivery] Checkout ${session.id} has no delivery metadata (product_name, file_name), skipping auto-delivery`);
        return;
      }

      pendingDeliveries.add(paymentKey);
      console.log(`[stripe-delivery] Auto-delivering "${productName}" to ${customerEmail} (key: ${paymentKey})`);

      try {
        const safePath = sanitizeFilePath(metadata.file_path || metadata.filePath, fileName);

        const result = await deliverDigitalProduct({
          customerName,
          customerEmail,
          productName,
          fileName,
          filePath: safePath,
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
          console.log(`[stripe-delivery] Auto-delivery COMPLETED: #${result.deliveryId} → ${customerEmail}`);
        } else {
          console.error(`[stripe-delivery] Auto-delivery FAILED: #${result.deliveryId} — ${result.error}`);
        }
      } finally {
        pendingDeliveries.delete(paymentKey);
      }
    } catch (err: any) {
      console.error('[stripe-delivery] handleCheckoutCompleted error:', err.message);
    }
  }

  static async handlePaymentFailed(invoice: any): Promise<void> {
    try {
      const customerEmail = invoice.customer_email;
      const metadata = invoice.subscription_details?.metadata || invoice.metadata || {};
      const tenantId = metadata.tenantId ? parseInt(metadata.tenantId, 10) : null;

      if (tenantId) {
        const tenant = await storage.getTenant(tenantId);
        if (tenant?.email) {
          await sendPaymentFailedEmail(tenant.email, tenant.name);
        }
      } else if (customerEmail) {
        const result = await db.execute(sql`SELECT id, name, email FROM tenants WHERE email = ${customerEmail} LIMIT 1`);
        const rows = (result as any).rows || result;
        if (rows.length > 0) {
          await sendPaymentFailedEmail(rows[0].email, rows[0].name);
        }
      }

      console.log(`[stripe-webhook] Payment failed for ${customerEmail || `tenant ${tenantId}`}`);
    } catch (err: any) {
      console.error('[stripe-webhook] handlePaymentFailed error:', err.message);
    }
  }

  static async handleSubscriptionCancelled(subscription: any): Promise<void> {
    try {
      const metadata = subscription.metadata || {};
      const tenantId = metadata.tenantId ? parseInt(metadata.tenantId, 10) : null;

      if (tenantId) {
        await db.execute(sql`UPDATE tenants SET plan = 'trial' WHERE id = ${tenantId}`);
        console.log(`[stripe-webhook] Subscription cancelled — tenant ${tenantId} downgraded to trial`);

        const tenant = await storage.getTenant(tenantId);
        if (tenant?.email) {
          await sendSubscriptionCancelledEmail(tenant.email, tenant.name);
        }
      } else {
        const customerId = subscription.customer;
        if (customerId) {
          const result = await db.execute(sql`SELECT id, name, email FROM tenants WHERE stripe_customer_id = ${customerId} LIMIT 1`);
          const rows = (result as any).rows || result;
          if (rows.length > 0) {
            await db.execute(sql`UPDATE tenants SET plan = 'trial' WHERE id = ${rows[0].id}`);
            console.log(`[stripe-webhook] Subscription cancelled — tenant ${rows[0].id} (by customer ${customerId}) downgraded to trial`);
            await sendSubscriptionCancelledEmail(rows[0].email, rows[0].name);
          }
        }
      }
    } catch (err: any) {
      console.error('[stripe-webhook] handleSubscriptionCancelled error:', err.message);
    }
  }

  static async handleSubscriptionUpdated(subscription: any): Promise<void> {
    try {
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
        await db.execute(sql`UPDATE tenants SET plan = ${plan} WHERE id = ${tenantId}`);
        console.log(`[stripe-webhook] Subscription updated — tenant ${tenantId} plan set to ${plan}`);
      }
    } catch (err: any) {
      console.error('[stripe-webhook] handleSubscriptionUpdated error:', err.message);
    }
  }

  static async handlePaymentSucceeded(paymentIntent: any): Promise<void> {
    try {
      const metadata = paymentIntent.metadata || {};
      if (!metadata.product_name && !metadata.productName) return;

      const paymentKey = paymentIntent.id;

      if (pendingDeliveries.has(paymentKey)) return;

      const existing = await getDeliveryByStripePayment(paymentKey);
      if (existing) return;

      const customerEmail = paymentIntent.receipt_email || metadata.customer_email;
      const customerName = metadata.customer_name || customerEmail || 'Customer';
      const productName = metadata.product_name || metadata.productName;
      const fileName = metadata.file_name || metadata.fileName;

      if (!customerEmail || !productName || !fileName) return;

      pendingDeliveries.add(paymentKey);
      console.log(`[stripe-delivery] PaymentIntent auto-delivery: "${productName}" → ${customerEmail}`);

      try {
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
      console.error('[stripe-delivery] handlePaymentSucceeded error:', err.message);
    }
  }
}
