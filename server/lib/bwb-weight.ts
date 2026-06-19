// Built With Bob — Bob's persisted weight context (agentic, not hardcoded).
//
// Bob's current weight + total-lost are FACTS the recap must speak exactly and
// never invent (post-synthesis guard fail-closes on a hallucinated figure). They
// used to be hardcoded into the BWB Weekly Render workflow command, which goes
// stale every week and isn't agentic. Instead: when Bob states his numbers in a
// prompt, the chat tool persists them HERE (single row, shared dev+prod DB), and
// EVERY run — chat, manual workflow, or autonomous/scheduled — reads the latest
// value from here. Bob updates his stats simply by telling an agent; nothing is
// baked into code or a command line.
import { db } from "../db";
import { agentSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface BwbWeight {
  currentWeight?: number;
  totalLost?: number;
  startWeight?: number;
  updatedAt?: Date | null;
}

export async function getBwbWeight(): Promise<BwbWeight> {
  const [s] = await db.select().from(agentSettings).limit(1);
  if (!s) return {};
  return {
    currentWeight: (s as any).bwbCurrentWeight ?? undefined,
    totalLost: (s as any).bwbTotalLost ?? undefined,
    startWeight: (s as any).bwbStartWeight ?? undefined,
    updatedAt: (s as any).bwbWeightUpdatedAt ?? null,
  };
}

// Persist only the positive, finite figures provided; leave the rest untouched.
// Always stamps the update time so the recap can describe "where Bob is right
// now". Returns the figures actually written.
export async function setBwbWeight(w: {
  currentWeight?: number;
  totalLost?: number;
  startWeight?: number;
}): Promise<BwbWeight> {
  const patch: Record<string, any> = { bwbWeightUpdatedAt: new Date() };
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (ok(w.currentWeight)) patch.bwbCurrentWeight = Math.round(w.currentWeight);
  if (ok(w.totalLost)) patch.bwbTotalLost = Math.round(w.totalLost);
  if (ok(w.startWeight)) patch.bwbStartWeight = Math.round(w.startWeight);
  const [s] = await db.select({ id: agentSettings.id }).from(agentSettings).limit(1);
  if (!s) return {};
  await db.update(agentSettings).set(patch).where(eq(agentSettings.id, s.id));
  return getBwbWeight();
}
