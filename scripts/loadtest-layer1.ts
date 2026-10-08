// Layer-1 synthetic burst load test against the production deploy.
// Hammers public-facing endpoints at increasing concurrency, measures p50/p95
// latency, error rate, and tail behavior. Emails Bob a one-page report when
// done. Does NOT cost real money — only hits public/static surfaces and the
// public chat endpoint with anonymized synthetic prompts.
//
// Usage: npx tsx scripts/loadtest-layer1.ts
// Configurable via env: LOADTEST_TARGET, LOADTEST_DURATION_S, LOADTEST_TIERS

import { getOrCreateTenantInbox, sendEmail } from "../server/email";

const TARGET = process.env.LOADTEST_TARGET || process.env.SITE_WEBSITE_URL || "https://agenticcorporation.net";
const TIERS = (process.env.LOADTEST_TIERS || "10,50,100,250").split(",").map(s => parseInt(s, 10));
const DURATION_S = parseInt(process.env.LOADTEST_DURATION_S || "30", 10);
const OWNER_EMAIL = process.env.OWNER_ALERT_EMAIL || "huskyauto@gmail.com";

interface Sample { ms: number; status: number; ok: boolean; }
const ENDPOINTS = [
  { name: "homepage",      path: "/",                method: "GET" as const },
  { name: "agent-card",    path: "/.well-known/agent.json", method: "GET" as const },
  { name: "health",        path: "/api/health",      method: "GET" as const },
];

function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function probe(url: string, method: "GET" | "POST"): Promise<Sample> {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method, signal: AbortSignal.timeout(10_000) });
    return { ms: Date.now() - t0, status: r.status, ok: r.status < 500 };
  } catch {
    return { ms: Date.now() - t0, status: 0, ok: false };
  }
}

async function runTier(concurrency: number): Promise<Record<string, Sample[]>> {
  const samples: Record<string, Sample[]> = {};
  for (const ep of ENDPOINTS) samples[ep.name] = [];

  const stopAt = Date.now() + DURATION_S * 1000;
  const workers = Array.from({ length: concurrency }, async () => {
    while (Date.now() < stopAt) {
      const ep = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
      const s = await probe(TARGET + ep.path, ep.method);
      samples[ep.name].push(s);
    }
  });
  await Promise.all(workers);
  return samples;
}

(async () => {
  console.log(`[loadtest] target=${TARGET} tiers=${TIERS.join(",")} duration_per_tier=${DURATION_S}s`);
  const report: string[] = [];
  report.push(`# VisionClaw Load Test — Layer 1 (Synthetic Burst)\n`);
  report.push(`Target: ${TARGET}`);
  report.push(`Run: ${new Date().toISOString()}`);
  report.push(`Per-tier duration: ${DURATION_S}s\n`);

  for (const concurrency of TIERS) {
    console.log(`[loadtest] tier ${concurrency} concurrent — ${DURATION_S}s`);
    const t0 = Date.now();
    const samples = await runTier(concurrency);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    report.push(`## Tier: ${concurrency} concurrent (${elapsed}s)\n`);
    report.push("| Endpoint | Reqs | p50 ms | p95 ms | p99 ms | Errors | Err% |");
    report.push("|---|---:|---:|---:|---:|---:|---:|");
    for (const ep of ENDPOINTS) {
      const s = samples[ep.name];
      const lats = s.map(x => x.ms);
      const errs = s.filter(x => !x.ok).length;
      const errPct = s.length ? (100 * errs / s.length).toFixed(1) : "0.0";
      report.push(`| ${ep.name} | ${s.length} | ${pct(lats, 50)} | ${pct(lats, 95)} | ${pct(lats, 99)} | ${errs} | ${errPct}% |`);
      console.log(`  ${ep.name}: ${s.length} reqs, p50=${pct(lats,50)}ms p95=${pct(lats,95)}ms err=${errPct}%`);
    }
    report.push("");
  }

  const reportText = report.join("\n");
  console.log("\n" + reportText);

  try {
    const inboxResult = await getOrCreateTenantInbox(1);
    const inboxId = typeof inboxResult === "string" ? inboxResult : (inboxResult as any).inboxId || (inboxResult as any).email;
    await sendEmail({
      inboxId, to: OWNER_EMAIL,
      subject: `Load test layer 1 complete — ${TARGET.replace(/^https?:\/\//, "")}`,
      text: reportText + "\n\n— VisionClaw load-test layer 1\n",
    });
    console.log("[loadtest] report emailed to", OWNER_EMAIL);
  } catch (e) {
    console.error("[loadtest] email failed:", (e as Error).message);
  }
  process.exit(0);
})().catch(e => { console.error("[loadtest] FATAL", e); process.exit(1); });
