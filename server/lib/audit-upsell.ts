/**
 * Post-purchase upgrade offer for the AI Readiness Audit line: a customer
 * who bought the $497 self-serve audit gets a CTA in the delivery email to
 * upgrade to the $1,997 done-for-you package (we already wrote the report —
 * the DFY tier ships the implemented solutions / Fix Kit).
 *
 * Detection is name/sku-based and deliberately conservative: only fires for
 * readiness-audit orders that are NOT already the done-for-you tier.
 */

export interface DeliveryUpsell {
  headline: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}

function publicBaseUrl(): string {
  const domain = (process.env.REPLIT_DOMAINS?.split(",")[0] || process.env.REPLIT_DEV_DOMAIN || "localhost:5000").trim();
  const protocol = domain.includes("localhost") ? "http" : "https";
  return `${protocol}://${domain}`;
}

function isDfy(s: string): boolean {
  const n = s.toLowerCase();
  return n.includes("done-for-you") || n.includes("done for you") || n.includes("dfy");
}

function isEnterprise(s: string): boolean {
  return s.toLowerCase().includes("enterprise");
}

function isReadinessAudit(s: string): boolean {
  const n = s.toLowerCase();
  return n.includes("audit") && (n.includes("readiness") || n.includes("ai"));
}

/**
 * Returns the DFY upgrade offer when this delivery is a self-serve ($497)
 * readiness-audit order, else undefined. `tierHint` (checkout metadata.tier)
 * wins when present; otherwise falls back to sku/productName sniffing.
 */
export function auditDfyUpsell(params: { sku?: string; productName?: string; tierHint?: string }): DeliveryUpsell | undefined {
  const sku = params.sku || "";
  const name = params.productName || "";
  // Tier is authoritative when present (checkout metadata.tier): the upsell
  // fires ONLY for the explicit self-serve tier. Any other tier value
  // (done-for-you, enterprise, unknown future tiers) is excluded.
  if (params.tierHint) {
    if (params.tierHint.toLowerCase() !== "self-serve") return undefined;
  } else {
    // No tier available (older queue items) — conservative name/sku sniff:
    // exclude anything that looks DFY or enterprise.
    if (isDfy(sku) || isDfy(name) || isEnterprise(sku) || isEnterprise(name)) return undefined;
  }
  if (!isReadinessAudit(sku) && !isReadinessAudit(name)) return undefined;
  return {
    headline: "Want us to just do it all for you?",
    body: "Your report shows exactly what to fix. Upgrade to the $1,997 Done-For-You package and our team builds the solutions for you — llms.txt written from your real site content, validated schema markup, corrected meta tags, AI-crawler rules, and a prioritized implementation plan, delivered ready to apply. The heavy analysis is already done; this is the implementation step.",
    ctaLabel: "Upgrade to Done-For-You ($1,997)",
    ctaUrl: `${publicBaseUrl()}/audit#pricing`,
  };
}
