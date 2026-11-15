/**
 * A paid checkout is historical payment evidence, not current entitlement.
 * Both activation entry points must inspect the live matching subscription.
 */
export function hasCurrentSubscriptionEntitlement(
  subscription: any,
  expected: { subscriptionId: string; customerId: string; tenantId: number; plan: string },
): boolean {
  const amounts: Record<string, number> = { starter: 2900, pro: 9900, enterprise: 29900 };
  const item = subscription?.items?.data?.[0];
  const price = item?.price;
  return amounts[expected.plan] !== undefined
    && subscription?.id === expected.subscriptionId
    && (subscription.status === "active" || subscription.status === "trialing")
    && subscription.customer === expected.customerId
    && subscription.metadata?.tenantId === String(expected.tenantId)
    && subscription.metadata?.plan === expected.plan
    && subscription.items.data.length === 1
    && item.quantity === 1
    && price?.unit_amount === amounts[expected.plan]
    && price.currency === "usd"
    && price.recurring?.interval === "month"
    && price.recurring.interval_count === 1;
}
