import { sendEmail, getOrCreateTenantInbox, getPrimaryInboxId, isEmailConfigured } from "./email";
import { siteConfig } from "./site-config";

const FROM_NAME = process.env.SITE_AGENT_NAME || siteConfig.platformName || "Platform Agent";
const BRAND_COLOR = "#dc2626";

function getSiteUrl(): string {
  return siteConfig.websiteUrl || `http://localhost:${process.env.PORT || 5000}`;
}

function wrapHtml(body: string): string {
  const siteUrl = getSiteUrl();
  const companyLegal = siteConfig.companyLegal || "Platform";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
<div style="text-align:center;margin-bottom:30px;">
<span style="font-size:40px;">🦞</span>
<h1 style="color:#fff;margin:10px 0 0;font-size:24px;">${FROM_NAME}</h1>
<p style="color:#888;margin:4px 0 0;font-size:13px;">${siteConfig.platformTagline || "Agentic AI Platform"}</p>
</div>
<div style="background:#1a1a1a;border-radius:12px;padding:30px;border:1px solid #333;">
${body}
</div>
<div style="text-align:center;margin-top:30px;color:#666;font-size:12px;">
<p>&copy; ${new Date().getFullYear()} ${companyLegal}. All rights reserved.</p>
<p style="margin-top:8px;">
<a href="${siteUrl}/terms" style="color:#888;text-decoration:none;">Terms</a> &middot;
<a href="${siteUrl}/privacy" style="color:#888;text-decoration:none;">Privacy</a>
</p>
</div>
</div>
</body>
</html>`;
}

export async function sendVerificationEmail(tenantEmail: string, code: string): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  try {
    const inboxId = await getPrimaryInboxId();

    const html = wrapHtml(`
      <h2 style="color:#fff;margin:0 0 15px;font-size:20px;">Verify Your Email</h2>
      <p style="color:#ccc;line-height:1.6;">Welcome! Enter this code to verify your email address:</p>
      <div style="text-align:center;margin:25px 0;">
        <div style="display:inline-block;background:#222;border:2px solid ${BRAND_COLOR};border-radius:12px;padding:20px 40px;">
          <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#fff;font-family:monospace;">${code}</span>
        </div>
      </div>
      <p style="color:#999;line-height:1.6;font-size:13px;">This code expires in 15 minutes. If you didn't create an account, you can safely ignore this email.</p>
    `);

    const text = `Your verification code is: ${code}\n\nThis code expires in 15 minutes.`;

    await sendEmail({
      inboxId,
      to: tenantEmail,
      subject: `${code} — ${FROM_NAME} verification code`,
      text,
      html,
    });

    console.log(`[email-notify] Verification email sent to ${tenantEmail}`);
    return true;
  } catch (err: any) {
    console.error(`[email-notify] Failed to send verification email:`, err.message);
    return false;
  }
}

export async function sendWelcomeEmail(tenantEmail: string, tenantName: string): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  try {
    const inboxId = await getPrimaryInboxId();

    const html = wrapHtml(`
      <h2 style="color:#fff;margin:0 0 15px;font-size:20px;">Welcome to ${FROM_NAME}!</h2>
      <p style="color:#ccc;line-height:1.6;">Hi ${tenantName},</p>
      <p style="color:#ccc;line-height:1.6;">You now have access to your own AI-powered agent team — specialized personas ready to help you with everything from research and content creation to code generation and business analytics.</p>
      <p style="color:#ccc;line-height:1.6;font-weight:600;">Here's what you can do right now:</p>
      <ul style="color:#ccc;line-height:1.8;padding-left:20px;">
        <li><strong style="color:#fff;">Start a conversation</strong> — Ask anything, your AI team will figure out who handles it</li>
        <li><strong style="color:#fff;">Try voice mode</strong> — Talk naturally with your AI assistant</li>
        <li><strong style="color:#fff;">Explore personas</strong> — Meet the specialized agents for code, content, research, and more</li>
        <li><strong style="color:#fff;">Use tools</strong> — Email, web browsing, file creation, and 30+ built-in capabilities</li>
      </ul>
      <p style="color:#ccc;line-height:1.6;">Your free trial includes 5 conversations to experience the full platform. When you're ready, upgrade to unlock unlimited access.</p>
      <div style="text-align:center;margin-top:25px;">
        <a href="${getSiteUrl()}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px 30px;border-radius:8px;font-weight:600;">Launch ${FROM_NAME}</a>
      </div>
    `);

    const text = `Welcome to ${FROM_NAME}!\n\nHi ${tenantName},\n\nYou now have access to your own AI-powered agent team. Start a conversation at ${getSiteUrl()}\n\nYour free trial includes 5 conversations.\n\n- The ${FROM_NAME} Team`;

    await sendEmail({
      inboxId,
      to: tenantEmail,
      subject: `Welcome to ${FROM_NAME}, ${tenantName}!`,
      text,
      html,
    });

    console.log(`[email-notify] Welcome email sent to ${tenantEmail}`);
    return true;
  } catch (err: any) {
    console.error(`[email-notify] Failed to send welcome email:`, err.message);
    return false;
  }
}

export async function sendPasswordResetEmail(tenantEmail: string, tenantName: string, resetToken: string, baseUrl?: string): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  try {
    const inboxId = await getPrimaryInboxId();

    const base = baseUrl || getSiteUrl();
    const resetUrl = `${base}/reset-password?token=${resetToken}`;

    const html = wrapHtml(`
      <h2 style="color:#fff;margin:0 0 15px;font-size:20px;">Password Reset Request</h2>
      <p style="color:#ccc;line-height:1.6;">Hi ${tenantName},</p>
      <p style="color:#ccc;line-height:1.6;">We received a request to reset your password. Click the button below to create a new password:</p>
      <div style="text-align:center;margin:25px 0;">
        <a href="${resetUrl}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px 30px;border-radius:8px;font-weight:600;">Reset Password</a>
      </div>
      <p style="color:#999;line-height:1.6;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password will remain unchanged.</p>
      <p style="color:#666;line-height:1.6;font-size:12px;margin-top:20px;border-top:1px solid #333;padding-top:15px;">If the button doesn't work, copy and paste this link into your browser:<br><span style="color:#888;word-break:break-all;">${resetUrl}</span></p>
    `);

    const text = `Password Reset Request\n\nHi ${tenantName},\n\nWe received a request to reset your password. Visit this link to create a new password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.\n\n- The ${FROM_NAME} Team`;

    await sendEmail({
      inboxId,
      to: tenantEmail,
      subject: `${FROM_NAME} — Password Reset`,
      text,
      html,
    });

    console.log(`[email-notify] Password reset email sent to ${tenantEmail}`);
    return true;
  } catch (err: any) {
    console.error(`[email-notify] Failed to send password reset email:`, err.message);
    return false;
  }
}

export async function sendUsageWarningEmail(
  tenantEmail: string,
  tenantName: string,
  metric: string,
  current: number,
  limit: number,
  plan: string
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  try {
    const inboxId = await getPrimaryInboxId();

    const pct = Math.round((current / limit) * 100);
    const metricLabel = metric === "messages_day" ? "daily messages" :
                        metric === "tool_calls_day" ? "daily tool calls" :
                        "monthly conversations";

    const html = wrapHtml(`
      <h2 style="color:#fff;margin:0 0 15px;font-size:20px;">Usage Alert: ${pct}% of ${metricLabel} used</h2>
      <p style="color:#ccc;line-height:1.6;">Hi ${tenantName},</p>
      <p style="color:#ccc;line-height:1.6;">You've used <strong style="color:#fff;">${current} of ${limit}</strong> ${metricLabel} on your <strong style="color:#fff;">${plan}</strong> plan.</p>
      <div style="background:#222;border-radius:8px;padding:3px;margin:20px 0;">
        <div style="background:${pct >= 90 ? '#dc2626' : '#f59e0b'};height:24px;border-radius:6px;width:${Math.min(pct, 100)}%;transition:width 0.3s;"></div>
      </div>
      <p style="color:#ccc;line-height:1.6;">Upgrade your plan to get more capacity and keep your AI team running without interruptions.</p>
      <div style="text-align:center;margin-top:25px;">
        <a href="${getSiteUrl()}/?upgrade=true" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px 30px;border-radius:8px;font-weight:600;">Upgrade Plan</a>
      </div>
    `);

    const text = `Usage Alert: ${pct}% of ${metricLabel} used\n\nYou've used ${current} of ${limit} ${metricLabel} on your ${plan} plan.\n\nUpgrade at ${getSiteUrl()}/?upgrade=true`;

    await sendEmail({
      inboxId,
      to: tenantEmail,
      subject: `${FROM_NAME} Usage Alert: ${pct}% of ${metricLabel} used`,
      text,
      html,
    });

    console.log(`[email-notify] Usage warning sent to ${tenantEmail} (${pct}% ${metricLabel})`);
    return true;
  } catch (err: any) {
    console.error(`[email-notify] Failed to send usage warning:`, err.message);
    return false;
  }
}

export async function sendPlanUpgradeEmail(
  tenantEmail: string,
  tenantName: string,
  newPlan: string
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  try {
    const inboxId = await getPrimaryInboxId();

    const planFeatures: Record<string, string[]> = {
      starter: ["200 messages/day", "100 conversations/month", "3 AI personas", "Email support"],
      pro: ["1,000 messages/day", "Unlimited conversations", "5 AI personas", "Voice conversations", "Priority support"],
      enterprise: ["5,000 messages/day", "Unlimited conversations", "Full 12-agent team", "Autonomous heartbeat", "Dedicated support"],
    };

    const features = planFeatures[newPlan] || [];

    const html = wrapHtml(`
      <h2 style="color:#fff;margin:0 0 15px;font-size:20px;">You're now on the ${newPlan.charAt(0).toUpperCase() + newPlan.slice(1)} plan!</h2>
      <p style="color:#ccc;line-height:1.6;">Hi ${tenantName},</p>
      <p style="color:#ccc;line-height:1.6;">Your plan has been upgraded successfully. Here's what you now have access to:</p>
      <ul style="color:#ccc;line-height:1.8;padding-left:20px;">
        ${features.map(f => `<li><strong style="color:#fff;">${f}</strong></li>`).join("")}
      </ul>
      <p style="color:#ccc;line-height:1.6;">Thank you for upgrading. Your AI team is ready to work harder for you.</p>
      <div style="text-align:center;margin-top:25px;">
        <a href="${getSiteUrl()}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px 30px;border-radius:8px;font-weight:600;">Open ${FROM_NAME}</a>
      </div>
    `);

    const text = `You're now on the ${newPlan.charAt(0).toUpperCase() + newPlan.slice(1)} plan!\n\nYour features: ${features.join(", ")}\n\nThank you for upgrading!`;

    await sendEmail({
      inboxId,
      to: tenantEmail,
      subject: `Plan Upgraded: ${FROM_NAME} ${newPlan.charAt(0).toUpperCase() + newPlan.slice(1)}`,
      text,
      html,
    });

    console.log(`[email-notify] Plan upgrade email sent to ${tenantEmail} (${newPlan})`);
    return true;
  } catch (err: any) {
    console.error(`[email-notify] Failed to send plan upgrade email:`, err.message);
    return false;
  }
}

export async function sendLimitReachedEmail(
  tenantEmail: string,
  tenantName: string,
  metric: string,
  limit: number,
  plan: string
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  try {
    const inboxId = await getPrimaryInboxId();

    const metricLabel = metric === "messages_day" ? "daily messages" :
                        metric === "tool_calls_day" ? "daily tool calls" :
                        "monthly conversations";

    const resetTime = metric.includes("day") ? "midnight UTC" : "the 1st of next month";

    const html = wrapHtml(`
      <h2 style="color:#fff;margin:0 0 15px;font-size:20px;">Limit Reached: ${metricLabel}</h2>
      <p style="color:#ccc;line-height:1.6;">Hi ${tenantName},</p>
      <p style="color:#ccc;line-height:1.6;">You've reached your <strong style="color:#fff;">${limit} ${metricLabel}</strong> limit on the <strong style="color:#fff;">${plan}</strong> plan.</p>
      <p style="color:#ccc;line-height:1.6;">Your usage will reset at <strong style="color:#fff;">${resetTime}</strong>, or you can upgrade now for immediate access.</p>
      <div style="text-align:center;margin-top:25px;">
        <a href="${getSiteUrl()}/?upgrade=true" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px 30px;border-radius:8px;font-weight:600;">Upgrade Now</a>
      </div>
    `);

    const text = `Limit Reached: ${metricLabel}\n\nYou've hit your ${limit} ${metricLabel} limit on the ${plan} plan. Resets at ${resetTime}.\n\nUpgrade: ${getSiteUrl()}/?upgrade=true`;

    await sendEmail({
      inboxId,
      to: tenantEmail,
      subject: `${FROM_NAME}: ${metricLabel} limit reached`,
      text,
      html,
    });

    console.log(`[email-notify] Limit reached email sent to ${tenantEmail}`);
    return true;
  } catch (err: any) {
    console.error(`[email-notify] Failed to send limit email:`, err.message);
    return false;
  }
}

export async function sendPaymentFailedEmail(
  tenantEmail: string,
  tenantName: string
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  try {
    const inboxId = await getPrimaryInboxId();

    const html = wrapHtml(`
      <h2 style="color:#fff;margin:0 0 15px;font-size:20px;">Payment Failed</h2>
      <p style="color:#ccc;line-height:1.6;">Hi ${tenantName},</p>
      <p style="color:#ccc;line-height:1.6;">We were unable to process your latest payment for your ${FROM_NAME} subscription. This could be due to an expired card, insufficient funds, or a temporary issue with your payment method.</p>
      <p style="color:#ccc;line-height:1.6;"><strong style="color:#f59e0b;">Please update your payment method to avoid any service interruptions.</strong></p>
      <p style="color:#ccc;line-height:1.6;">If your payment continues to fail, your account will be downgraded to the free tier and you'll lose access to premium features.</p>
      <div style="text-align:center;margin-top:25px;">
        <a href="${getSiteUrl()}/settings" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px 30px;border-radius:8px;font-weight:600;">Update Payment Method</a>
      </div>
    `);

    const text = `Payment Failed\n\nHi ${tenantName},\n\nWe couldn't process your latest payment. Please update your payment method at ${getSiteUrl()}/settings to avoid service interruptions.\n\n- The ${FROM_NAME} Team`;

    await sendEmail({
      inboxId,
      to: tenantEmail,
      subject: `Action Required: ${FROM_NAME} Payment Failed`,
      text,
      html,
    });

    console.log(`[email-notify] Payment failed email sent to ${tenantEmail}`);
    return true;
  } catch (err: any) {
    console.error(`[email-notify] Failed to send payment failed email:`, err.message);
    return false;
  }
}

export async function sendSubscriptionCancelledEmail(
  tenantEmail: string,
  tenantName: string
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  try {
    const inboxId = await getPrimaryInboxId();

    const html = wrapHtml(`
      <h2 style="color:#fff;margin:0 0 15px;font-size:20px;">Subscription Cancelled</h2>
      <p style="color:#ccc;line-height:1.6;">Hi ${tenantName},</p>
      <p style="color:#ccc;line-height:1.6;">Your subscription has been cancelled. Your account has been moved to the free tier.</p>
      <p style="color:#ccc;line-height:1.6;">You still have access to basic features, but premium capabilities like additional personas, higher usage limits, and priority support are no longer available.</p>
      <p style="color:#ccc;line-height:1.6;">We'd love to have you back anytime — you can resubscribe whenever you're ready.</p>
      <div style="text-align:center;margin-top:25px;">
        <a href="${getSiteUrl()}" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px 30px;border-radius:8px;font-weight:600;">Resubscribe</a>
      </div>
    `);

    const text = `Subscription Cancelled\n\nHi ${tenantName},\n\nYour subscription has been cancelled and your account moved to the free tier. You can resubscribe anytime at ${getSiteUrl()}\n\n- The ${FROM_NAME} Team`;

    await sendEmail({
      inboxId,
      to: tenantEmail,
      subject: `${FROM_NAME}: Subscription Cancelled`,
      text,
      html,
    });

    console.log(`[email-notify] Subscription cancelled email sent to ${tenantEmail}`);
    return true;
  } catch (err: any) {
    console.error(`[email-notify] Failed to send cancellation email:`, err.message);
    return false;
  }
}

export async function sendAccountDeletionScheduledEmail(
  tenantEmail: string,
  tenantName: string,
  deletionDate: Date
): Promise<boolean> {
  if (!isEmailConfigured()) return false;

  try {
    const inboxId = await getPrimaryInboxId();
    const dateStr = deletionDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    const html = wrapHtml(`
      <h2 style="color:#fff;margin:0 0 15px;font-size:20px;">Account Deletion Scheduled</h2>
      <p style="color:#ccc;line-height:1.6;">Hi ${tenantName},</p>
      <p style="color:#ccc;line-height:1.6;">Your account has been scheduled for permanent deletion on <strong style="color:#fff;">${dateStr}</strong>.</p>
      <div style="background:#2a1515;border:1px solid #dc2626;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="color:#fca5a5;font-weight:600;margin:0 0 8px;">Important — Before your data is deleted:</p>
        <ul style="color:#fca5a5;margin:0;padding-left:16px;font-size:13px;line-height:1.8;">
          <li><strong>Download your files</strong> from the Files page</li>
          <li><strong>Export your data</strong> from Settings &gt; Data &gt; Data Export</li>
          <li>All conversations, memories, files, and API keys will be permanently removed</li>
        </ul>
      </div>
      <p style="color:#ccc;line-height:1.6;">You have <strong style="color:#fff;">30 days</strong> to download your data or cancel the deletion. After ${dateStr}, all data will be permanently and irreversibly deleted.</p>
      <p style="color:#ccc;line-height:1.6;">Changed your mind? You can cancel the deletion anytime from your Settings page.</p>
      <div style="text-align:center;margin-top:25px;display:flex;gap:12px;justify-content:center;">
        <a href="${getSiteUrl()}/settings" style="display:inline-block;background:#333;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Cancel Deletion</a>
        <a href="${getSiteUrl()}/files" style="display:inline-block;background:${BRAND_COLOR};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Download My Files</a>
      </div>
    `);

    const text = `Account Deletion Scheduled\n\nHi ${tenantName},\n\nYour account is scheduled for permanent deletion on ${dateStr}.\n\nBefore that date, please:\n- Download your files from the Files page\n- Export your data from Settings > Data\n\nAll data will be permanently deleted after ${dateStr}.\n\nTo cancel, visit ${getSiteUrl()}/settings\n\n- The ${FROM_NAME} Team`;

    await sendEmail({
      inboxId,
      to: tenantEmail,
      subject: `${FROM_NAME}: Account Deletion Scheduled for ${dateStr}`,
      text,
      html,
    });

    console.log(`[email-notify] Account deletion scheduled email sent to ${tenantEmail}`);
    return true;
  } catch (err: any) {
    console.error(`[email-notify] Failed to send deletion email:`, err.message);
    return false;
  }
}

export async function sendSystemHealthAlert(report: any): Promise<boolean> {
  try {
    if (!isEmailConfigured()) return false;
    const inboxId = await getPrimaryInboxId();
    if (!inboxId) return false;

    const issues = report.checks?.filter((c: any) => c.status !== "healthy") || [];
    const issueRows = issues.map((i: any) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #333;color:#fff;">${i.name}</td>
        <td style="padding:8px;border-bottom:1px solid #333;">
          <span style="color:${i.status === 'down' ? '#ef4444' : '#f59e0b'};font-weight:600;">${i.status.toUpperCase()}</span>
        </td>
        <td style="padding:8px;border-bottom:1px solid #333;color:#999;font-size:12px;">${i.category}</td>
        <td style="padding:8px;border-bottom:1px solid #333;color:#ccc;font-size:12px;">${i.message}</td>
      </tr>
    `).join("");

    const remediations = report.autoRemediations?.length > 0
      ? `<div style="margin-top:16px;padding:12px;background:#1a2e1a;border:1px solid #2d5a2d;border-radius:8px;">
          <p style="color:#4ade80;font-weight:600;margin:0 0 8px;">Auto-Remediations Applied:</p>
          <ul style="margin:0;padding-left:16px;color:#86efac;font-size:13px;">
            ${report.autoRemediations.map((r: string) => `<li>${r}</li>`).join("")}
          </ul>
        </div>`
      : "";

    const html = wrapHtml(`
      <div style="text-align:center;padding:16px 0;background:${report.overall === 'down' ? '#2a1515' : '#2a2515'};border-radius:8px;margin-bottom:16px;">
        <span style="font-size:32px;">${report.overall === 'down' ? '🚨' : '⚠️'}</span>
        <h2 style="color:${report.overall === 'down' ? '#ef4444' : '#f59e0b'};margin:8px 0 0;font-size:20px;">
          System ${report.overall === 'down' ? 'DOWN' : 'DEGRADED'}
        </h2>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <thead>
          <tr style="border-bottom:2px solid #444;">
            <th style="text-align:left;padding:8px;color:#888;font-size:11px;text-transform:uppercase;">Service</th>
            <th style="text-align:left;padding:8px;color:#888;font-size:11px;text-transform:uppercase;">Status</th>
            <th style="text-align:left;padding:8px;color:#888;font-size:11px;text-transform:uppercase;">Type</th>
            <th style="text-align:left;padding:8px;color:#888;font-size:11px;text-transform:uppercase;">Details</th>
          </tr>
        </thead>
        <tbody>${issueRows}</tbody>
      </table>
      ${remediations}
      <p style="color:#888;font-size:12px;margin-top:16px;">
        Checked at: ${report.generatedAt}<br/>
        <strong>App issues</strong> = application code problem. <strong>Infrastructure</strong> = hosting issue. <strong>Integration</strong> = third-party service.
      </p>
    `);

    const text = `System ${report.overall.toUpperCase()}: ${issues.map((i: any) => `${i.name}: ${i.status}`).join(", ")}`;

    await sendEmail({
      inboxId: inboxId as string,
      to: process.env.OWNER_ALERT_EMAIL || siteConfig.contactEmail || "",
      subject: `🚨 ${FROM_NAME}: System ${report.overall.toUpperCase()}`,
      text,
      html,
    });

    console.log(`[email-notify] System health alert sent`);
    return true;
  } catch (err: any) {
    console.error(`[email-notify] Failed to send health alert:`, err.message);
    return false;
  }
}
