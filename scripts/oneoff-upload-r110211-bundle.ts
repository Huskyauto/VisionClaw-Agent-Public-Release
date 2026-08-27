import { deliverDigitalProduct } from "../server/delivery-pipeline";

async function main() {
  const filePath = "project-assets/R110.21.1-Felix-Video-Pipeline-FullCodeReview.md";
  const res = await deliverDigitalProduct({
    customerName: "Bob (Owner) — Manus AI cross-review",
    customerEmail: process.env.OWNER_EMAIL || process.env.OWNER_ALERT_EMAIL,
    productName: "R110.21.1 Felix Video Pipeline — Full Code Review Bundle",
    filePath,
    fileName: "R110.21.1-Felix-Video-Pipeline-FullCodeReview.md",
    mimeType: "text/markdown",
    sendEmail: false,
    metadata: { round: "R110.21.1", purpose: "manus-cross-review" },
  });
  console.log("\n=== DELIVERY RESULT ===");
  console.log(JSON.stringify({
    success: res.success,
    deliveryId: res.deliveryId,
    folderLink: res.folderLink,
    shareableLink: res.shareableLink,
    downloadLink: res.downloadLink,
    publicPlayLink: res.publicPlayLink,
    linkVerified: res.linkVerified,
    error: res.error,
  }, null, 2));
  process.exit(0);
}
main().catch(e => { console.error("UPLOAD FAILED:", e?.message || e); process.exit(1); });
