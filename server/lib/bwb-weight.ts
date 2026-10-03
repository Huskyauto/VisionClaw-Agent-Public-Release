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
  // `agent_settings` is a global singleton (no tenant_id; all required columns
  // have defaults). Update the row if it exists, otherwise create it — never
  // silently no-op, or a weigh-in could be reported "logged" while nothing was
  // persisted and the recap would speak a stale figure.
  const [s] = await db.select({ id: agentSettings.id }).from(agentSettings).limit(1);
  if (s) {
    await db.update(agentSettings).set(patch).where(eq(agentSettings.id, s.id));
  } else {
    await db.insert(agentSettings).values(patch);
  }
  const saved = await getBwbWeight();
  if (!saved.updatedAt) {
    throw new Error("setBwbWeight: persistence could not be confirmed (no row after write)");
  }
  return saved;
}

// Bob weighs in Monday mornings; the weekly recap is built Saturday evening.
// "Stale for this week" means the stored weight has NOT been updated since the
// most recent Monday 00:00 (server local time) — i.e. it predates this week's
// weigh-in. Used by the project-page card, the agent readiness check, and the
// Monday email nudge to decide whether to prompt Bob for a fresh number.
export interface BwbWeightStatus extends BwbWeight {
  /** Whole days since the stored weight was last updated (null if never set). */
  daysSinceUpdate: number | null;
  /** True when the weight has no value OR predates this week's Monday weigh-in. */
  staleThisWeek: boolean;
  /** True when a current weight has ever been recorded. */
  hasWeight: boolean;
}

/** Start-of-day (00:00 local) for the most recent Monday on/before `from`. */
export function mostRecentMonday(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  // getDay(): 0=Sun..6=Sat. Days to step back to Monday (Mon→0, Sun→6).
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  return d;
}

export async function getBwbWeightStatus(now: Date = new Date()): Promise<BwbWeightStatus> {
  const w = await getBwbWeight();
  const updatedAt = w.updatedAt ? new Date(w.updatedAt) : null;
  const daysSinceUpdate = updatedAt
    ? Math.floor((now.getTime() - updatedAt.getTime()) / 86_400_000)
    : null;
  const hasWeight = typeof w.currentWeight === "number" && w.currentWeight > 0;
  const staleThisWeek = !hasWeight || !updatedAt || updatedAt < mostRecentMonday(now);
  return { ...w, daysSinceUpdate, staleThisWeek, hasWeight };
}
