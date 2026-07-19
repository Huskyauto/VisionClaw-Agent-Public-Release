/**
 * Wires the 3 Archive Rescue tiers into Stripe with metadata.kind='archive-rescue'
 * so anonymous checkout from /archive-rescue is permitted by the allowlist.
 *
 * One-shot, idempotent: looks up existing products by metadata.kind+tier and
 * creates them only if missing. Prints the resulting product/price IDs so
 * Bob can verify in the Stripe dashboard.
 *
 * Run: npx tsx scripts/wire-archive-rescue-stripe.ts
 */
import { getUncachableStripeClient } from "../server/stripeClient";

interface TierSpec {
  tier: "starter" | "standard" | "pro";
  name: string;
  description: string;
  amountUsd: number;
  recurring: "month" | null;
}

const TIERS: TierSpec[] = [
  { tier: "starter",  name: "Archive Rescue — Starter",  description: "500 pages OCR'd + indexed + private search portal (1 year). One-time.", amountUsd: 99,  recurring: null },
  { tier: "standard", name: "Archive Rescue — Standard", description: "2,500 pages OCR'd + indexed + auto-classification + date extraction + portal (1 year). One-time.", amountUsd: 299, recurring: null },
  { tier: "pro",      name: "Archive Rescue — Pro",      description: "10,000 pages + ongoing 500/mo add-on scans + custom classifier + quarterly call + lifetime portal. Recurring monthly add-on.", amountUsd: 49,  recurring: "month" },
];

async function main() {
  const stripe = await getUncachableStripeClient();
  console.log(`Wiring Archive Rescue Stripe products (mode=${(stripe as any)._api?.host || "live/test depending on key"}) …\n`);

  for (const t of TIERS) {
    const existing = await stripe.products.search({ query: `active:'true' AND metadata['kind']:'archive-rescue' AND metadata['tier']:'${t.tier}'` });
    let product = existing.data[0];
    if (product) {
      console.log(`✓ ${t.tier.padEnd(8)} product exists: ${product.id} (${product.name})`);
    } else {
      product = await stripe.products.create({
        name: t.name,
        description: t.description,
        metadata: { kind: "archive-rescue", tier: t.tier, canonical: "true" },
      });
      console.log(`+ ${t.tier.padEnd(8)} product CREATED: ${product.id}`);
    }

    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    const targetAmount = Math.round(t.amountUsd * 100);
    const matching = prices.data.find(p =>
      p.unit_amount === targetAmount &&
      p.currency === "usd" &&
      ((t.recurring && p.recurring?.interval === t.recurring) || (!t.recurring && !p.recurring))
    );
    if (matching) {
      console.log(`  ✓ price exists: ${matching.id} (${matching.unit_amount} ${matching.currency}${matching.recurring ? "/" + matching.recurring.interval : ""})`);
    } else {
      const priceData: any = { product: product.id, unit_amount: targetAmount, currency: "usd" };
      if (t.recurring) priceData.recurring = { interval: t.recurring };
      const created = await stripe.prices.create(priceData);
      console.log(`  + price CREATED: ${created.id} ($${t.amountUsd}${t.recurring ? "/" + t.recurring : ""})`);
    }
  }
  console.log(`\nDone. Verify in Stripe dashboard → Products → filter by metadata kind=archive-rescue.`);
  console.log(`The /archive-rescue page will surface them automatically via /api/public/archive-rescue/products.`);
}

main().catch(e => { console.error("FAILED:", e?.message || e); process.exit(1); });
