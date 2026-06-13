// One-shot: send a delivery email for an existing delivery_logs row that
// shipped without one (e.g. Felix bypassed deliverDigitalProduct). Reads the
// row, generates a signed streaming URL, composes a four-link email body,
// fires sendEmail, marks email_sent=true.
//
// Usage:  DELIVERY_ID=127 npx tsx scripts/resend-delivery-email.ts
//         DELIVERY_ID=127 TENANT_ID=8 npx tsx scripts/resend-delivery-email.ts        # explicit tenant
//         DELIVERY_ID=127 ALLOW_DEFAULT_OWNER=1 npx tsx scripts/resend-delivery-email.ts  # opt-in to owner fallback
//         DELIVERY_ID=127 DRY_RUN=1 npx tsx scripts/resend-delivery-email.ts          # print, do not send
//
// R112.16+sec — Architect HIGH: previously SELECT omitted `metadata` so
// row.metadata.tenantId was always undefined → silently fell back to
// hardcoded tenant 8. That risks signing/sending a recipient's URL with
// the wrong tenant scope and creates an operator footgun for cross-tenant
// rescues. Now: SELECT includes metadata, and tenant must come from
// TENANT_ID env OR metadata.tenantId. Falling back to owner (8) requires
// explicit ALLOW_DEFAULT_OWNER=1.

import crypto from "crypto";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { sendEmail, isEmailConfigured, getPrimaryInboxId } from "../server/email";

const id = Number(process.env.DELIVERY_ID || "0");
if (!id) { console.error("DELIVERY_ID env var required"); process.exit(1); }
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const ALLOW_DEFAULT_OWNER = process.env.ALLOW_DEFAULT_OWNER === "1" || process.env.ALLOW_DEFAULT_OWNER === "true";

async function main() {
  const rows = (await db.execute(sql`SELECT id, customer_name, customer_email, product_name, file_name, drive_file_id, shareable_link, download_link, metadata FROM delivery_logs WHERE id = ${id} LIMIT 1`) as any).rows || [];
  if (!rows.length) { console.error(`delivery #${id} not found`); process.exit(2); }
  const row = rows[0];
  if (!row.customer_email) { console.error(`delivery #${id} has no customer_email`); process.exit(3); }
  if (!isEmailConfigured() && !DRY_RUN) { console.error("email not configured"); process.exit(4); }

  const SECRET = process.env.SESSION_SECRET!;
  if (!SECRET) { console.error("SESSION_SECRET required for URL signing"); process.exit(5); }
  const filename = row.file_name as string;
  // R112.16+sec — explicit tenant resolution, no silent default.
  // Priority: TENANT_ID env > metadata.tenantId > (only if ALLOW_DEFAULT_OWNER) 8.
  const envTid = Number(process.env.TENANT_ID);
  const metaTid = Number((row.metadata as any)?.tenantId);
  let tenantId: number;
  if (Number.isFinite(envTid) && envTid > 0) {
    tenantId = envTid;
  } else if (Number.isFinite(metaTid) && metaTid > 0) {
    tenantId = metaTid;
  } else if (ALLOW_DEFAULT_OWNER) {
    tenantId = 8;
    console.warn(`[resend-delivery-email] WARNING: defaulting to tenant 8 (owner) — set TENANT_ID env or store metadata.tenantId for safer rescues.`);
  } else {
    console.error(`[resend-delivery-email] #${id} has no resolvable tenant. Pass TENANT_ID=<n> explicitly, or re-run with ALLOW_DEFAULT_OWNER=1 to fall back to owner (tenant 8).`);
    process.exit(6);
  }
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 60;
  const sig = crypto.createHmac("sha256", SECRET).update(`${filename}|${tenantId}|${exp}`).digest("hex");
  const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const stream = `${base}/uploads/${encodeURIComponent(filename)}?tid=${tenantId}&exp=${exp}&sig=${sig}`;
  const download = `${stream}&dl=1`;
  const driveView = row.shareable_link || `https://drive.google.com/file/d/${row.drive_file_id}/view?usp=sharing`;
  const driveDl = row.download_link || `https://drive.google.com/uc?export=download&id=${row.drive_file_id}`;

  const subject = `Your video is ready — ${row.product_name}`;
  const text = `Hi ${row.customer_name},\n\n${row.product_name} is ready.\n\n` +
    `▶ Play instantly (bypasses Drive transcoding):\n${stream}\n\n` +
    `⬇ Download (force save):\n${download}\n\n` +
    `Drive view (may take time to finish "processing" on Drive's side):\n${driveView}\n\n` +
    `Drive direct download (works regardless of Drive's preview state):\n${driveDl}\n\n` +
    `If the Drive view shows "still rendering," use the top streaming link — it serves the file directly from our server with byte-range support so it plays the moment you tap it.\n\n— VisionClaw delivery pipeline`;
  const html = `<p>Hi ${row.customer_name},</p>
<p><strong>${row.product_name}</strong> is ready.</p>
<p><a href="${stream}"><strong>▶ Play instantly</strong></a> (bypasses Drive transcoding)</p>
<p><a href="${download}"><strong>⬇ Download</strong></a> (force save)</p>
<p><a href="${driveView}">Drive view</a> — may show "still rendering" briefly on Drive's side.</p>
<p><a href="${driveDl}">Drive direct download</a> — works regardless of Drive's preview state.</p>
<p style="color:#666;font-size:0.9em">If Drive shows "still rendering," use the top streaming link — it serves the file directly from our server with byte-range support so it plays the moment you tap it.</p>
<p style="color:#999;font-size:0.85em">— VisionClaw delivery pipeline · delivery #${id}</p>`;

  if (DRY_RUN) {
    console.log(`[resend-delivery-email] DRY_RUN — would send delivery #${id} to ${row.customer_email} (tenantId=${tenantId})`);
    console.log(`  subject:  ${subject}`);
    console.log(`  stream:   ${stream}`);
    console.log(`  download: ${download}`);
    console.log(`  driveView: ${driveView}`);
    console.log(`  driveDl:   ${driveDl}`);
    return;
  }
  const inboxId = await getPrimaryInboxId();
  const res = await sendEmail({ inboxId, to: row.customer_email, subject, text, html } as any);
  const messageId = (res as any)?.id || (res as any)?.messageId || null;

  await db.execute(sql`UPDATE delivery_logs SET email_sent = true, email_message_id = ${messageId}, status = 'completed' WHERE id = ${id}`);
  console.log(`[resend-delivery-email] #${id} sent to ${row.customer_email} (tenantId=${tenantId}, messageId=${messageId})`);
  console.log(`  stream:   ${stream}`);
  console.log(`  download: ${download}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FAILED:", e?.message || e); process.exit(10); });
