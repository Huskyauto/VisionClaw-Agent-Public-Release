import { db } from "../db";
import { sql } from "drizzle-orm";
import { postMessage } from "../agent-channels";
import { runLlmTask } from "../llm-task";
import { claimAutonomousBudget } from "../agentic/autonomous-budget";
import { logSilentCatch } from "../lib/silent-catch";

/**
 * feature.shipped attention handler (R125+67).
 *
 * When a `feature.shipped` event is emitted, the platform proactively DRAFTS an
 * announcement of the new capability — it does NOT publish anything. The draft
 * is persisted as an owner notification and posted into #content-pipeline (the
 * channel Teagan/Scribe/Proof/Felix already watch for content briefs) so a human
 * (or the content review queue) can edit + decide whether to ship it.
 *
 * Safety posture:
 *  - DRAFT ONLY. No social post, no email send, no publish. Publishing customer-
 *    facing comms stays human-gated (AHB: mass-comms is a fail-closed surface).
 *  - Budget is reserved BEFORE any LLM spend (claim-before-spend); a missing /
 *    exhausted autonomous budget fails CLOSED — the handler returns without
 *    drafting rather than spending unprovable money.
 *  - Fire-and-forget from the event bus: a failure here NEVER blocks emitEvent.
 */
export async function draftFeatureAnnouncement(params: {
  tenantId: number;
  eventId?: number;
  feature?: string;
  summary?: string;
  details?: string;
  source?: string;
}): Promise<{ ok: boolean; reason: string; drafted: boolean }> {
  const tenantId = params.tenantId;
  const feature = (params.feature || params.summary || "a new feature").toString().slice(0, 200);

  // 1) Reserve budget BEFORE any LLM spend (fails CLOSED if unprovable).
  const claim = await claimAutonomousBudget({
    tenantId,
    estimatedUsd: 0.03,
    label: "feature-announce-draft",
  });
  if (!claim.ok) {
    return { ok: true, reason: `budget-blocked:${claim.reason}`, drafted: false };
  }

  // 2) Draft the announcement (structured JSON, no publish).
  const prompt = [
    "You are the content engine of VisionClaw, a multi-persona AI corporation.",
    "A new platform feature just shipped. DRAFT a short announcement for it.",
    "This is a DRAFT for human review — do NOT write it as if already published.",
    "Keep it factual and grounded ONLY in the provided feature details; invent no metrics, dates, or claims.",
    "Return JSON: { \"title\": string (<=90 chars), \"body\": string (2-4 sentences, plain text), \"suggestedChannels\": string[] (subset of [\"blog\",\"email\",\"x\",\"linkedin\"]) }",
  ].join("\n");

  const draft = await runLlmTask({
    prompt,
    input: {
      feature,
      summary: params.summary || null,
      details: params.details || null,
      source: params.source || null,
    },
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        suggestedChannels: { type: "array", items: { type: "string" } },
      },
      required: ["title", "body"],
    },
    model: "gpt-5-mini",
    tenantId,
    requiresTools: false,
    timeoutMs: 30000,
  });

  if (!draft.success || !draft.json) {
    return { ok: false, reason: `draft-failed:${draft.error || "no-json"}`, drafted: false };
  }

  const title = String(draft.json.title || `Announcement: ${feature}`).slice(0, 200);
  const body = String(draft.json.body || "").slice(0, 4000);
  const suggestedChannels: string[] = Array.isArray(draft.json.suggestedChannels)
    ? draft.json.suggestedChannels.map((c: any) => String(c)).slice(0, 6)
    : [];

  // 3) Persist the DRAFT as an owner notification (review surface).
  try {
    const metadata = JSON.stringify({
      source: "feature-announce-handler",
      kind: "feature-announcement-draft",
      status: "draft",
      eventId: params.eventId ?? null,
      feature,
      suggestedChannels,
      model: draft.model,
    });
    await db.execute(sql`
      INSERT INTO notifications (tenant_id, type, title, message, category, metadata)
      VALUES (${tenantId}, 'digest', ${`📝 Draft announcement: ${title}`.slice(0, 200)}, ${body}, 'owner_digest', ${metadata}::jsonb)`);
  } catch (e) {
    logSilentCatch("server/attention-handlers/feature-announce.ts", e);
  }

  // 4) Post the DRAFT into #content-pipeline for the content team to refine.
  try {
    const channelLine = suggestedChannels.length ? `\n_Suggested channels:_ ${suggestedChannels.join(", ")}` : "";
    await postMessage({
      tenantId,
      channelName: "#content-pipeline",
      content: `📝 **DRAFT announcement (not published)** — ${title}\n\n${body}${channelLine}\n\n_Auto-drafted from feature.shipped. Review + edit before publishing._`,
      messageType: "alert",
      metadata: { kind: "feature-announcement-draft", eventId: params.eventId ?? null, suggestedChannels },
      eventRef: params.eventId,
    });
  } catch (e) {
    logSilentCatch("server/attention-handlers/feature-announce.ts", e);
  }

  return { ok: true, reason: "drafted", drafted: true };
}
