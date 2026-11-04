/** Stripe copies link metadata to Sessions, not automatically to PaymentIntents. */
export function missionLinkMetadata(sku: string, missionId: number | null) {
  if (!sku || (missionId !== null && (!Number.isSafeInteger(missionId) || missionId <= 0)))
    throw new Error("Invalid vetted payment-link association");
  const metadata: Record<string, string> = {
    bundle_sku: sku,
    ...(missionId !== null ? { mission_id: String(missionId) } : {}),
  };
  return { metadata, payment_intent_data: { metadata: { ...metadata } } };
}

type AssociationReads = {
  parse: (metadata: any) => number | null;
  retrieveIntent: (id: string) => Promise<any>;
  listSessions: (intentId: string) => Promise<{ data: any[]; has_more?: boolean }>;
};

function explicitMission(metadata: any): boolean {
  return metadata != null && (
    Object.prototype.hasOwnProperty.call(metadata, "mission_id") ||
    Object.prototype.hasOwnProperty.call(metadata, "missionId")
  );
}

/** Read-only recovery of old-link/refund provenance. Never guesses from the current catalog. */
export async function resolveStripeMissionId(
  kind: "payment" | "refund", object: any, reads: AssociationReads,
): Promise<number | null> {
  if (explicitMission(object?.metadata)) return reads.parse(object.metadata);
  const parent = kind === "refund" ? object?.payment_intent : object;
  const id = typeof parent === "string" ? parent : parent?.id;
  if (typeof id !== "string" || !id.startsWith("pi_")) return null;
  const intent = typeof parent === "string" ? await reads.retrieveIntent(id) : parent;
  if (intent?.id !== id) return null;
  if (explicitMission(intent?.metadata)) return reads.parse(intent.metadata);
  const sessions = await reads.listSessions(id);
  if (sessions.has_more || sessions.data.length !== 1) return null;
  const session = sessions.data[0];
  const sessionIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const link = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
  if (sessionIntent !== id || typeof link !== "string" || !link.startsWith("plink_")) return null;
  return reads.parse(session.metadata);
}
