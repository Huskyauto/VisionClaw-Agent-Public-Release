import { createHash, randomUUID } from "node:crypto";
import { publicIncomeScoutQuery } from "./income-discovery";
import type { JuryEvidencePass } from "./jury-evidence";

/** One fixed-topic public lookup, using only the host's guarded tool executor. */
export async function scoutIncomePublicEvidence(
  seat: number,
  request: string,
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<JuryEvidencePass> {
  const runId = randomUUID();
  const query = publicIncomeScoutQuery(request, seat);
  const startedAt = new Date().toISOString();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let output: unknown;
  try {
    output = await Promise.race([
      execute("web_search", { free_only: true, query }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Public scouting deadline exceeded")), 12_000);
      }),
    ]);
  } catch {
    output = { error: "Public scouting failed or exceeded deadline" };
  } finally {
    if (timer) clearTimeout(timer);
  }
  const raw = output && typeof output === "object" ? output as Record<string, unknown> : {};
  const sources = (Array.isArray(raw.results) ? raw.results : []).slice(0, 4).flatMap((r: unknown) => {
    if (!r || typeof r !== "object" || !("url" in r) || !("text" in r) ||
      typeof r.url !== "string" || typeof r.text !== "string" ||
      !/^https?:\/\//.test(r.url) || !r.text.trim()) return [];
    return [{ url: r.url.slice(0, 600), text: r.text.slice(0, 650) }];
  });
  const ok = !("error" in raw) && raw.success !== false && raw.blocked !== true && sources.length > 0;
  const serialized = JSON.stringify(output ?? { error: "No public source" });
  const excerpt = JSON.stringify({ query, quarantined: true, instruction_authority: "none",
    source_records: sources, status: ok ? "returned" : "unavailable" });
  return { seatId: `income-seat-${seat + 1}`, runId, actor: "server-owned-juror-evidence-runner",
    receipts: [{ id: `${runId}/scout`, runId, tool: "web_search", ok,
      startedAt, completedAt: new Date().toISOString(),
      sha256: `sha256-base64url:${createHash("sha256").update(serialized).digest("base64url")}`,
      excerpt: excerpt.length <= 1800 ? excerpt : `${excerpt.slice(0, 1800)}[TRUNCATED; additional records in sources]`,
      sources }] };
}
