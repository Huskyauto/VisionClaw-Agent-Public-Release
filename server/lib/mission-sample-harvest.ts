// ─────────────────────────────────────────────────────────────────────────────
// Mission sample harvester — S2 of data/feature-contracts/revenue-missions.
//
// READ-ONLY Gmail harvest: pulls candidate prospects from the owner's Google
// contacts + recent correspondents, ICP-filters them with one bounded LLM call,
// drafts 2 message variants, and persists a review packet as a
// mission_experiments row with status='awaiting_approval'. NOTHING IS SENT —
// the send path (S3) fails closed unless approvedByOwnerAt is set.
// ─────────────────────────────────────────────────────────────────────────────
import { createExperimentDraft, getMission, type ExperimentProspect, type ExperimentVariant } from "./revenue-missions";
import { logSilentCatch } from "./silent-catch";

interface RawContact {
  name: string;
  email: string;
  organization?: string;
  source: string; // contacts | correspondent
}

const GENERIC_LOCALPARTS = /^(no-?reply|noreply|support|info|billing|notifications?|alerts?|newsletter|hello|team|sales|help|admin|mailer|updates?|news|do-?not-?reply)$/i;

function isPlausibleHuman(email: string): boolean {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return false;
  if (GENERIC_LOCALPARTS.test(local)) return false;
  if (/(bounce|unsubscribe|list|daemon)/.test(local)) return false;
  return true;
}

async function harvestContacts(tenantId: number, limit: number): Promise<RawContact[]> {
  const out = new Map<string, RawContact>();
  try {
    const { contactsList } = await import("../google-workspace");
    const res = await contactsList(tenantId, undefined, Math.min(limit, 200));
    const connections = res?.connections || res?.results || res?.contacts || [];
    for (const c of connections) {
      const email: string | undefined =
        c?.emailAddresses?.[0]?.value || c?.email || c?.person?.emailAddresses?.[0]?.value;
      const name: string =
        c?.names?.[0]?.displayName || c?.name || c?.person?.names?.[0]?.displayName || (email ? email.split("@")[0] : "");
      const organization: string | undefined = c?.organizations?.[0]?.name;
      if (email && isPlausibleHuman(email) && !out.has(email.toLowerCase())) {
        out.set(email.toLowerCase(), { name, email, organization, source: "contacts" });
      }
    }
  } catch (err) {
    logSilentCatch("mission-sample-harvest.contactsList", err);
  }

  // Recent correspondents from sent mail (people Bob actually talks to).
  try {
    const { gmailSearch, gmailGetMessage } = await import("../google-workspace");
    const res = await gmailSearch(tenantId, "in:sent newer_than:180d", 40);
    const messages = res?.messages || [];
    for (const m of messages.slice(0, 40)) {
      if (out.size >= limit) break;
      try {
        const msg = await gmailGetMessage(tenantId, m.id);
        const headers = msg?.payload?.headers || [];
        const toHeader = headers.find((h: any) => h?.name?.toLowerCase() === "to")?.value || "";
        for (const part of String(toHeader).split(",")) {
          const match = part.match(/(?:"?([^"<]*)"?\s*)?<?([^<>\s,]+@[^<>\s,]+)>?/);
          if (!match) continue;
          const email = match[2]?.trim();
          const name = (match[1] || "").trim() || (email ? email.split("@")[0] : "");
          if (email && isPlausibleHuman(email) && !out.has(email.toLowerCase())) {
            out.set(email.toLowerCase(), { name, email, source: "correspondent" });
          }
        }
      } catch (err) {
        logSilentCatch("mission-sample-harvest.gmailGetMessage", err);
      }
    }
  } catch (err) {
    logSilentCatch("mission-sample-harvest.gmailSearch", err);
  }

  return Array.from(out.values()).slice(0, limit);
}

interface IcpMatchResult {
  prospects: ExperimentProspect[];
  variants: ExperimentVariant[];
}

async function icpFilterAndDraft(args: {
  tenantId: number;
  mission: any;
  contacts: RawContact[];
  maxProspects: number;
}): Promise<IcpMatchResult> {
  const { getClientForModel, getModelForTierAsync } = await import("../providers");
  const modelId = await getModelForTierAsync("balanced");
  const { client, actualModelId } = await getClientForModel(modelId, args.tenantId);

  const contactLines = args.contacts
    .map((c, i) => `${i}. ${c.name} <${c.email}>${c.organization ? ` (${c.organization})` : ""} [${c.source}]`)
    .join("\n");

  const prompt = `You are helping validate a business offer with a SMALL, respectful email sample to existing contacts.

OFFER: ${args.mission.offer}
PRICE: $${args.mission.price_usd}
IDEAL CUSTOMER: ${args.mission.ideal_customer}
PAIN: ${args.mission.pain_statement || "n/a"}
HYPOTHESIS: ${args.mission.hypothesis}

CONTACTS (candidates — pick ONLY plausible ideal-customer matches, max ${args.maxProspects}; if fewer than 5 genuinely match, return fewer — do NOT pad with weak matches):
${contactLines}

Also draft 2 SHORT email variants (A/B). Rules: honest sender identity, no fake personalization claims, conversational not salesy, one clear ask (a reply or a 15-min call), and end with an opt-out line like "If this isn't relevant, just say so and I won't bring it up again." No URLs.

Return STRICT JSON:
{"prospects":[{"index":<contact index>,"whyMatched":"one line"}],"variants":[{"label":"A","subject":"...","body":"..."},{"label":"B","subject":"...","body":"..."}]}`;

  const comp = await client.chat.completions.create({
    model: actualModelId,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 3000,
  } as any);
  const text = comp.choices?.[0]?.message?.content?.trim() ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("ICP filter: unparseable model output");
  const parsed = JSON.parse(jsonMatch[0]);

  const prospects: ExperimentProspect[] = [];
  for (const p of Array.isArray(parsed.prospects) ? parsed.prospects : []) {
    const c = args.contacts[Number(p.index)];
    if (!c) continue;
    prospects.push({ name: c.name, email: c.email, whyMatched: String(p.whyMatched || "").slice(0, 300) });
    if (prospects.length >= args.maxProspects) break;
  }
  const variants: ExperimentVariant[] = (Array.isArray(parsed.variants) ? parsed.variants : [])
    .slice(0, 2)
    .map((v: any) => ({
      label: String(v.label || "A").slice(0, 10),
      subject: String(v.subject || "").slice(0, 200),
      body: String(v.body || "").slice(0, 4000),
    }));
  if (variants.length < 2) throw new Error("ICP filter: expected 2 message variants");
  return { prospects, variants };
}

export interface DraftSampleResult {
  experiment: any;
  harvestedCount: number;
  matchedCount: number;
  belowMinimum: boolean;
}

/** Full S2 pipeline: harvest → ICP filter → draft variants → persist packet. */
export async function draftSampleExperiment(args: {
  tenantId: number;
  missionId: number;
  name?: string;
}): Promise<DraftSampleResult> {
  const mission = await getMission(args.tenantId, args.missionId);
  if (!mission) throw new Error("mission not found");
  if (mission.stage === "killed") throw new Error("mission is killed");

  const contacts = await harvestContacts(args.tenantId, 200);
  if (contacts.length === 0) {
    throw new Error("Gmail harvest returned 0 usable contacts — check the Google connection");
  }

  const maxProspects = Number(mission.max_prospects) || 25;
  const { prospects, variants } = await icpFilterAndDraft({ tenantId: args.tenantId, mission, contacts, maxProspects });

  const belowMinimum = prospects.length < 5;
  const experiment = await createExperimentDraft({
    tenantId: args.tenantId,
    missionId: args.missionId,
    name: args.name || `Sample #1 — ${mission.name}`,
    prospects,
    variants,
  });

  return { experiment, harvestedCount: contacts.length, matchedCount: prospects.length, belowMinimum };
}
