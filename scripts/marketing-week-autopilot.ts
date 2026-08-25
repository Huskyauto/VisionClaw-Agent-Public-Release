#!/usr/bin/env tsx
/**
 * Marketing Week Autopilot — one-shot orchestrator
 *
 * Generates a full week of marketing drafts (newsletter + social + ads + thumbnails)
 * into a single review packet, uploads PDF to Drive, emails Bob the link.
 *
 * NOTHING IS AUTO-PUBLISHED. Every item is a draft awaiting HITL approval.
 *
 * Usage:
 *   TENANT_SLUG=built-with-bob WEEK_OF=2026-05-25 \
 *     npx tsx scripts/marketing-week-autopilot.ts
 *
 * Env:
 *   TENANT_SLUG     required — must match data/profiles/<slug>/voice.json
 *   WEEK_OF         optional — YYYY-MM-DD of the week-of-Monday; defaults to next Monday
 *   STUDY_ONLY      optional — "1" to skip generation, only produce competitor brief
 *   LAUNCH_BRIEF    optional — path to a launch brief (.md) to align copy to
 *   SEND_EMAIL      optional — "0" to skip the email step (still uploads + prints links)
 *
 * Exit codes:
 *   0  success
 *   2  voice or audience profile missing — bootstrap required (see output-skill)
 *   3  packet generation failed
 *   4  delivery failed
 */

import * as fs from "fs";
import * as path from "path";

const TENANT_SLUG = process.env.TENANT_SLUG;
const WEEK_OF = process.env.WEEK_OF || nextMondayISO();
const STUDY_ONLY = process.env.STUDY_ONLY === "1";
const LAUNCH_BRIEF = process.env.LAUNCH_BRIEF;
const SEND_EMAIL = process.env.SEND_EMAIL !== "0";

function nextMondayISO(): string {
  const now = new Date();
  const dow = now.getUTCDay();
  const daysToMon = (8 - dow) % 7 || 7;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() + daysToMon);
  return mon.toISOString().slice(0, 10);
}

function bail(code: number, msg: string): never {
  console.error(`[autopilot] FATAL: ${msg}`);
  process.exit(code);
}

if (!TENANT_SLUG) bail(2, "TENANT_SLUG env required");

const PROFILE_DIR = path.join("data", "profiles", TENANT_SLUG);
const VOICE_PATH = path.join(PROFILE_DIR, "voice.json");
const AUDIENCE_PATH = path.join(PROFILE_DIR, "audience.json");
const LESSONS_PATH = path.join(PROFILE_DIR, "lessons.md");

if (!fs.existsSync(VOICE_PATH)) {
  bail(
    2,
    `voice.json missing at ${VOICE_PATH}. Bootstrap per data/output-skills/voice-and-audience-profile.md before running.`,
  );
}
if (!fs.existsSync(AUDIENCE_PATH)) {
  bail(
    2,
    `audience.json missing at ${AUDIENCE_PATH}. Bootstrap per data/output-skills/voice-and-audience-profile.md before running.`,
  );
}

const voice = JSON.parse(fs.readFileSync(VOICE_PATH, "utf-8"));
const audience = JSON.parse(fs.readFileSync(AUDIENCE_PATH, "utf-8"));
const lessonsRaw = fs.existsSync(LESSONS_PATH) ? fs.readFileSync(LESSONS_PATH, "utf-8") : "";
const recentLessons = lessonsRaw.split("\n").filter(Boolean).slice(-30).join("\n");

const launchBriefText = LAUNCH_BRIEF && fs.existsSync(LAUNCH_BRIEF)
  ? fs.readFileSync(LAUNCH_BRIEF, "utf-8")
  : null;

console.log(`[autopilot] tenant=${TENANT_SLUG} week_of=${WEEK_OF} study_only=${STUDY_ONLY} launch=${LAUNCH_BRIEF || "(none)"}`);
console.log(`[autopilot] voice loaded (${Object.keys(voice).length} keys, last_updated=${voice.last_updated})`);
console.log(`[autopilot] audience loaded (primary=${audience.primary_persona?.name?.slice(0, 60)}...)`);
console.log(`[autopilot] lessons applied: ${recentLessons.split("\n").length} lines from ${LESSONS_PATH}`);

// ---------- Compose persona prompts ----------

function systemPromptFor(persona: string, role: string): string {
  return `You are ${persona}, ${role}.

You are producing copy for tenant "${TENANT_SLUG}" for the week of ${WEEK_OF}.

VOICE PROFILE (durable, do not violate):
${JSON.stringify(voice, null, 2)}

AUDIENCE PROFILE:
${JSON.stringify(audience, null, 2)}

LESSONS LEARNED (most recent 30 corrections — apply them):
${recentLessons || "(no lessons yet)"}

${launchBriefText ? `\nLAUNCH BRIEF (align all copy to this week's launch):\n${launchBriefText}\n` : ""}

HARD RULES:
- Never use a banned_phrase from voice.json.
- Respect platform_overrides for each destination.
- Speak to the primary_persona in their vocabulary, not yours.
- NEVER auto-publish — all output is draft for HITL review.
`;
}

// ---------- Build the packet ----------

async function buildPacket(): Promise<{ packetMd: string; pdfLocalPath: string | null }> {
  const sections: string[] = [];

  sections.push(`# Marketing Week — ${TENANT_SLUG} — Week of ${WEEK_OF}\n`);
  sections.push(`_Generated ${new Date().toISOString()} by marketing-week-autopilot._\n`);
  sections.push(`_Voice last_updated: ${voice.last_updated} · Audience last_updated: ${audience.last_updated}_\n`);
  if (launchBriefText) sections.push(`_Launch mode: ${LAUNCH_BRIEF}_\n`);
  sections.push("\n---\n");

  // Section: lessons applied (transparency)
  sections.push("## Lessons Applied This Run\n");
  sections.push(recentLessons || "_(no lessons yet — first run)_");
  sections.push("\n\n---\n");

  // Section: competitor brief (always — first step)
  sections.push("## Competitor Brief\n");
  sections.push(await draftCompetitorBrief());
  sections.push("\n\n---\n");

  if (STUDY_ONLY) {
    sections.push("\n_STUDY_ONLY mode — generation skipped. Use the brief to refresh voice/audience profiles._\n");
    return { packetMd: sections.join("\n"), pdfLocalPath: null };
  }

  // Section: newsletter
  sections.push("## Newsletter Draft\n");
  sections.push(await draftNewsletter());
  sections.push("\n\n---\n");

  // Section: social (X / LinkedIn / Facebook)
  for (const platform of ["x", "linkedin", "facebook"] as const) {
    sections.push(`## ${platform.toUpperCase()} — 4 posts\n`);
    sections.push(await draftSocialPosts(platform, 4));
    sections.push("\n\n---\n");
  }

  // Section: ads
  sections.push("## Facebook Ad Variants (5)\n");
  sections.push(await draftAdVariants(5));
  sections.push("\n\n---\n");

  // Section: thumbnails (placeholders — actual generation routes through Felix)
  sections.push("## YouTube Thumbnail Queue\n");
  sections.push(await draftThumbnailBriefs(3));
  sections.push("\n\n---\n");

  sections.push("\n## Review Instructions\n");
  sections.push("Reply with: `approve <section>` to dispatch publish, `edit <section>: <change>` to regenerate, `reject <section>` to drop.");
  sections.push("\nExample: `approve x.post1`, `edit newsletter: shorten subject to 50 chars`, `reject ad.3`.\n");

  const packetMd = sections.join("\n");

  // PDF render via the existing styled-PDF pipeline (sections shape).
  let pdfLocalPath: string | null = null;
  try {
    const { generateStyledPdf } = await import("../server/pdf-create");
    const pdf = await generateStyledPdf({
      title: `Marketing Week — ${TENANT_SLUG}`,
      subtitle: `Week of ${WEEK_OF}`,
      sections: [{ heading: "Review Packet", content: packetMd }] as any,
      orientation: "portrait",
      fileName: `marketing-week-${TENANT_SLUG}-${WEEK_OF}`,
      uploadToDrive: false,
      tenantId: 1,
    });
    if (pdf.success && pdf.localPath) {
      pdfLocalPath = pdf.localPath;
    } else if (!pdf.success) {
      console.warn(`[autopilot] PDF render failed (continuing with markdown only): ${pdf.error}`);
    }
  } catch (err) {
    console.warn(`[autopilot] PDF render threw (continuing with markdown only): ${(err as Error).message}`);
  }

  return { packetMd, pdfLocalPath };
}

// ---------- Draft functions ----------
// Each delegates to LLM via the platform's existing model providers.
// Kept lightweight intentionally — the autopilot is an *orchestrator*, not a model.

async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    const { getClientForModel, getModelForTier } = await import("../server/providers");
    const modelId = getModelForTier("balanced");
    const { client, actualModelId } = await getClientForModel(modelId, 1);
    const out = await client.chat.completions.create({
      model: actualModelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2000,
    });
    const content = out?.choices?.[0]?.message?.content;
    return (typeof content === "string" && content.trim()) || "(LLM returned empty)";
  } catch (err) {
    // Fallback: emit a structured placeholder so the packet still ships and Bob sees the shape.
    return `_[LLM call failed: ${(err as Error).message}. The system prompt and user prompt are valid; dispatch failed.]_\n\n**Prompt that would have been sent:**\n\n${userPrompt.slice(0, 400)}${userPrompt.length > 400 ? "..." : ""}`;
  }
}

async function draftCompetitorBrief(): Promise<string> {
  const sys = systemPromptFor("Cassandra", "the research persona");
  const user = `Produce a 1-page competitor brief: 3 names from the tenant's space, what each posted in the last 7 days, what got measurable engagement, and one actionable takeaway for our own week.

Output format:
### <Competitor name>
- **Posted:** <1-line summary of their best-performing piece>
- **Why it worked:** <pattern, hook, format>
- **For us:** <one actionable steal>
`;
  return await callLLM(sys, user);
}

async function draftNewsletter(): Promise<string> {
  const sys = systemPromptFor("Scribe", "the long-form copy persona");
  const user = `Draft this week's newsletter. Output:

**Subject:** <one line, ≤55 chars, lead with the result>

**Preview:** <one line, ≤80 chars>

**Body:**
<3-5 short paragraphs in the tenant's voice. Open with the same hook as the subject. One CTA at the bottom — but make it specific, not generic.>

**Estimated open rate based on lessons:** <use lessons.md historical signal if present>
`;
  return await callLLM(sys, user);
}

async function draftSocialPosts(platform: "x" | "linkedin" | "facebook", n: number): Promise<string> {
  const sys = systemPromptFor("Teagan", "the social-media persona");
  const user = `Draft ${n} posts for ${platform.toUpperCase()} for the week of ${WEEK_OF}. Respect voice.platform_overrides.${platform}.

For each post output:
### Post <i>
- **Text:** <the post itself>
- **Schedule:** <suggested day + time, e.g. "Tue 9:30am">
- **Image prompt (if needed):** <one line, or "(no image)">
- **Why this works:** <1 line citing voice/audience/lessons>
`;
  return await callLLM(sys, user);
}

async function draftAdVariants(n: number): Promise<string> {
  const sys = systemPromptFor("Apollo", "the paid-ads persona");
  const user = `Draft ${n} Facebook ad variants. Test different hooks (problem-first, identity-first, social-proof-first, curiosity-gap, direct-offer).

For each variant output:
### Variant <i>: <hook style>
- **Headline:** <≤40 chars>
- **Primary text:** <≤90 words, line breaks ok>
- **CTA:** <one of: Learn More, Sign Up, Get Offer, Subscribe, Shop Now>
- **Image prompt:** <one line for image generation>
- **Compliance check:** <flag any medical claim, wellness claim that needs a disclaimer, before/after framing, etc. — or "clean">
`;
  return await callLLM(sys, user);
}

async function draftThumbnailBriefs(n: number): Promise<string> {
  const sys = systemPromptFor("Felix", "the visual + delivery persona");
  const user = `Draft ${n} YouTube thumbnail concepts for any video brief in the tenant's queue this week.

For each output:
### Concept <i>
- **Big text on thumbnail:** <≤6 words, all caps, the hook>
- **Visual:** <one line: what's in frame>
- **Color palette:** <reference brand-style-guide if BWB>
- **Why it earns the click:** <1 line>
`;
  return await callLLM(sys, user);
}

// ---------- Deliver ----------

async function deliver(packetMd: string, pdfLocalPath: string | null): Promise<void> {
  const mdPath = path.join("uploads", `marketing-week-${TENANT_SLUG}-${WEEK_OF}.md`);
  fs.mkdirSync("uploads", { recursive: true });
  fs.writeFileSync(mdPath, packetMd);
  console.log(`[autopilot] wrote markdown packet: ${mdPath}`);

  if (!pdfLocalPath || !fs.existsSync(pdfLocalPath)) {
    console.log(`[autopilot] no PDF generated (markdown-only). Markdown: ${mdPath}`);
    return;
  }
  const pdfPath = pdfLocalPath;
  console.log(`[autopilot] PDF at: ${pdfPath} (${fs.statSync(pdfPath).size} bytes)`);

  try {
    const { deliverDigitalProduct } = await import("../server/delivery-pipeline");
    const result = await deliverDigitalProduct({
      customerName: "Bob",
      customerEmail: SEND_EMAIL ? "huskyauto@gmail.com" : undefined,
      productName: `Marketing Week — ${TENANT_SLUG} — Week of ${WEEK_OF}`,
      filePath: pdfPath,
      fileName: path.basename(pdfPath),
      mimeType: "application/pdf",
      sendEmail: SEND_EMAIL,
      metadata: { kind: "marketing_week_autopilot", tenant_slug: TENANT_SLUG, week_of: WEEK_OF },
    } as any);

    if ((result as any)?.success === false) {
      bail(4, `delivery failed: ${JSON.stringify(result)}`);
    }
    console.log(`[autopilot] delivered. Result:`);
    console.log(JSON.stringify({
      shareableLink: (result as any).shareableLink,
      downloadLink: (result as any).downloadLink,
      folderLink: (result as any).folderLink,
      deliveryId: (result as any).deliveryId,
    }, null, 2));
  } catch (err) {
    bail(4, `deliverDigitalProduct call failed: ${(err as Error).message}`);
  }
}

// ---------- Main ----------

(async () => {
  try {
    const { packetMd, pdfLocalPath } = await buildPacket();
    await deliver(packetMd, pdfLocalPath);
    console.log(`[autopilot] DONE — ${TENANT_SLUG} ${WEEK_OF}`);
    process.exit(0);
  } catch (err) {
    console.error(`[autopilot] uncaught: ${(err as Error).stack || err}`);
    process.exit(3);
  }
})();
