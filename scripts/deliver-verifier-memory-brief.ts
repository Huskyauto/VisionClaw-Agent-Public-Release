import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deliverDigitalProduct } from "../server/delivery-pipeline";
import { isPlatformGoogleConnectorTenant } from "../server/lib/google-connector-ownership";

async function main() {
  const tenantId = Number(process.env.ADMIN_TENANT_ID || "1");
  if (!isPlatformGoogleConnectorTenant(tenantId)) throw new Error("Owner delivery scope unavailable");
  const fileData = await readFile("docs/diagnostics/verifier-memory-issue-for-external-review.md");
  const result = await deliverDigitalProduct({
    tenantId, customerName: "Bob",
    customerEmail: process.env.OWNER_EMAIL,
    productName: "Verifier memory issue — independent troubleshooting brief",
    fileData, fileName: "verifier-memory-issue-for-external-review.md",
    mimeType: "text/markdown", sendEmail: false,
    idempotencyKey: `verifier-memory-brief-${createHash("sha256").update(fileData).digest("hex")}`,
  });
  console.log(JSON.stringify({
    success: result.success, linkVerified: result.linkVerified,
    shareableLink: result.shareableLink, emailSent: result.emailSent,
  }));
  const { pool } = await import("../server/db");
  await pool.end();
}
void main().catch(() => { console.error("Brief delivery did not confirm success; inspect pipeline receipt before retrying"); process.exitCode = 1; });