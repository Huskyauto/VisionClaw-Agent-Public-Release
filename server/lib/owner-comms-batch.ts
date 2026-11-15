import { assertEmailRecipientsDeliverable } from "./outbound-email-preflight";

/** Deterministic owner digest. No chat history, memory recall, generation or egress. */
export interface OwnerCommsEvidence {
  now: Date;
  weight: { currentWeight?: number; totalLost?: number; startWeight?: number; updatedAt?: Date | null };
  jobs: { name: string; status: string; createdAt: Date; output: string }[];
  notifications: { title: string; createdAt: Date }[];
  wedges: { name: string; currentState: string }[];
  legacyJobsEnabled: number;
  weekly?: {
    id: number; date: string; createdAt: Date; winner: string;
    expectedProfitUsd: number; successProbabilityPct: number; roi: number;
    verdict: string; confidence: string;
  };
}

const DAY = 86_400_000;
const clean = (value: string, max = 80) => String(value).replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").slice(0, max);
const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const date = (d: Date) => d.toISOString().slice(0, 10);

export function ownerWeekDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  const local = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
  return date(local);
}

export function renderOwnerCommsBatch(e: OwnerCommsEvidence): string {
  const fresh = (d: Date) => Number.isFinite(d.getTime()) && d <= e.now && d.getTime() >= e.now.getTime() - 7 * DAY;
  const week = ownerWeekDate(e.now);
  const sections: string[] = [`Monday owner communications — ${date(e.now)}`];
  const w = e.weight;
  if (positive(w.currentWeight) && w.updatedAt && fresh(w.updatedAt) && ownerWeekDate(w.updatedAt) === week) {
    sections.push(`1) Monday Weigh-In\n${w.currentWeight} lb current${positive(w.totalLost) ? `; ${w.totalLost} lb lost` : ""}${positive(w.startWeight) ? `; ${w.startWeight} lb start` : ""}. Updated ${date(w.updatedAt)}; no reminder needed.`);
  } else {
    const last = w.updatedAt && Number.isFinite(w.updatedAt.getTime()) && w.updatedAt <= e.now ? ` Last recorded ${date(w.updatedAt)}.` : "";
    sections.push(`1) Monday Weigh-In\nPlease log your current weight; no verified reading for this week.${last}`);
  }
  const notices = e.notifications.filter(n => fresh(n.createdAt)).slice(0, 2).map(n => `Pending notification (${date(n.createdAt)}): ${clean(n.title)}.`);
  for (const job of e.jobs.filter(j => fresh(j.createdAt) && ownerWeekDate(j.createdAt) === week && j.status !== "success").slice(0, 2)) {
    notices.push(`Source job failed (${date(job.createdAt)}): ${clean(job.name)}. Check its run before retrying.`);
  }
  if (e.legacyJobsEnabled > 0) notices.push(`Source coverage: ${e.legacyJobsEnabled} source jobs remain enabled; their scans and updates are retained.`);
  if (notices.length) sections.push(`2) Owner Notifications\n${notices.join("\n")}`);
  const wedges = e.wedges.flatMap(wedge => {
    const last = wedge.currentState.trim().split("\n").at(-1) || "";
    const stamp = last.match(/^(\d{4}-\d{2}-\d{2}) ·/);
    if (!stamp || stamp[1] < week || !fresh(new Date(`${stamp[1]}T00:00:00Z`))) return [];
    const stage = last.match(/stage:([a-z-]+)/)?.[1];
    const signups = last.match(/signups 7d=(\d+)/)?.[1];
    const paid = last.match(/paid orders 7d=(\d+)/)?.[1];
    if (!stage || signups === undefined || paid === undefined) return [];
    return [`${clean(wedge.name, 60)} (${stamp[1]}): ${stage}; ${signups} signups and ${paid} paid orders in 7 days.`];
  }).slice(0, 3);
  if (wedges.length) sections.push(`3) Wedge Lifecycle\n${wedges.join("\n")}`);
  const scan = e.jobs.filter(j => j.name === "Revenue Mission Opportunity Scan (weekly)" &&
    fresh(j.createdAt) && ownerWeekDate(j.createdAt) === week)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (scan?.status === "success") sections.push(`4) Revenue Opportunities\nScan completed (${date(scan.createdAt)}): ${clean(scan.output, 160)}.`);
  else sections.push(`4) Revenue Opportunities\n${scan ? "Scan failed; no verified opportunity result available." : "Scan: no verified result in the last 7 days; check the source job."}`);
  if (e.weekly && e.weekly.date === week && fresh(e.weekly.createdAt)) {
    const r = e.weekly;
    sections.push(`5) Idea Scenario\n${clean(r.winner)} — weekly run ${r.date}. Modeled expected profit $${r.expectedProfitUsd.toLocaleString("en-US")}; success probability ${r.successProbabilityPct}%; ROI ${r.roi}x. Evidence confidence: ${clean(r.confidence, 12)}; estimates, not earnings. Saved verdict: ${clean(r.verdict, 160)}`);
  } else sections.push("5) Idea Scenario\nNo verified current-week report available; do not substitute last week's winner.");
  sections.push("Reply with the number of any item you want me to action.");
  const text = sections.join("\n\n");
  if (text.length > 3900 || text.split(/\s+/).length > 400) throw new Error("Owner batch exceeds delivery budget");
  return text;
}

export interface OwnerCommsSchedule {
  id: number;
  tenantId: number;
  title: string;
  source: string;
  expandViaPersona?: number | string;
}

/** Reserve the deployed schedule identity even if its mutable fields drift.
 * Never let that row silently fall back to the historical persona chat.
 */
export function isOwnerCommsSchedule(job: OwnerCommsSchedule, ownerTenantId: number): boolean {
  return Number.isSafeInteger(ownerTenantId) && ownerTenantId > 0 &&
    job.tenantId === ownerTenantId && job.id === 2612;
}

export async function prepareOwnerCommsBatch(
  job: OwnerCommsSchedule,
  now: Date,
  dependencies: {
    ownerTenantId: number;
    ownerEmail: string;
    load: (tenantId: number, now: Date) => Promise<OwnerCommsEvidence>;
  },
): Promise<{ target: { channel: "email"; email: string }; text: string }> {
  if (!isOwnerCommsSchedule(job, dependencies.ownerTenantId)) throw new Error("Owner batch requires the owner schedule");
  if (job.source !== "cron_scheduler" ||
      job.title !== "Owner Communications Batch (Monday 13:00)" ||
      (job.expandViaPersona !== 6 && job.expandViaPersona !== "6")) {
    throw new Error("Owner batch schedule fields changed; reconcile before delivery");
  }
  const email = dependencies.ownerEmail.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Valid configured owner email required");
  try {
    assertEmailRecipientsDeliverable({ to: email });
  } catch {
    throw new Error("Configured owner email is blocked; repair recipient before sending");
  }
  const evidence = await dependencies.load(job.tenantId, now);
  return { target: { channel: "email", email }, text: renderOwnerCommsBatch(evidence) };
}
