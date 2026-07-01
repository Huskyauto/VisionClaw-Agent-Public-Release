import { db } from "./db";
import { sql } from "drizzle-orm";
import { getClientForModel } from "./providers";

import { logSilentCatch } from "./lib/silent-catch";
const DERIVE_COOLDOWN_MS = 60_000;
const MAX_OBSERVATIONS = 100;
const lastDeriveTime = new Map<number, number>();

async function quickLLM(tenantId: number, systemPrompt: string, userPrompt: string, maxTokens = 400, temperature = 0.3): Promise<string> {
  // Use the RETURNED actualModelId: the $0 policy may swap the client to the free
  // modelfarm lane, and sending the original id to that endpoint 400s.
  const { client, actualModelId } = await getClientForModel("openai/gpt-4.1-mini", tenantId, {});
  const resp = await client.chat.completions.create({
    model: actualModelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: maxTokens,
    temperature,
  });
  return resp.choices?.[0]?.message?.content?.trim() || "";
}

interface UserProfile {
  tenantId: number;
  observations: Observation[];
  communicationStyle: string | null;
  decisionPatterns: string | null;
  preferences: Record<string, any>;
  personalityTraits: Record<string, any>;
  interactionCount: number;
}

interface Observation {
  fact: string;
  type: "preference" | "behavior" | "communication" | "decision" | "context";
  confidence: number;
  derivedAt: string;
  source: string;
}

export async function getOrCreateProfile(tenantId: number): Promise<UserProfile> {
  const result = await db.execute(sql`
    INSERT INTO user_profiles (tenant_id)
    VALUES (${tenantId})
    ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW()
    RETURNING *
  `);
  const row = ((result as any).rows || [])[0];
  if (!row) {
    return {
      tenantId,
      observations: [],
      communicationStyle: null,
      decisionPatterns: null,
      preferences: {},
      personalityTraits: {},
      interactionCount: 0,
    };
  }
  return {
    tenantId: row.tenant_id,
    observations: Array.isArray(row.observations) ? row.observations : [],
    communicationStyle: row.communication_style,
    decisionPatterns: row.decision_patterns,
    preferences: row.preferences || {},
    personalityTraits: row.personality_traits || {},
    interactionCount: row.interaction_count || 0,
  };
}

export async function deriveObservations(
  tenantId: number,
  userMessage: string,
  agentResponse: string,
  conversationContext?: string
): Promise<void> {
  const now = Date.now();
  const lastTime = lastDeriveTime.get(tenantId) || 0;
  if (now - lastTime < DERIVE_COOLDOWN_MS) return;
  if (userMessage.length < 20) return;
  lastDeriveTime.set(tenantId, now);

  try {
    const profile = await getOrCreateProfile(tenantId);
    const existingObs = profile.observations.slice(-10).map(o => o.fact).join("; ");

    const derivation = await quickLLM(
      tenantId,
      `You are a User Modeling Deriver. Analyze this user interaction and extract observations about the user's:
- Communication style (formal/casual, verbose/terse, technical/plain)
- Decision patterns (data-driven, intuitive, consensus-seeking, decisive)
- Preferences (output format, detail level, tone expectations)
- Behavioral patterns (time pressure, delegation style, follow-up habits)
- Context clues (industry, role, goals, constraints)

Existing observations: ${existingObs || "none yet"}

Return a JSON array of new observations only. Each observation:
{"fact": "...", "type": "preference|behavior|communication|decision|context", "confidence": 0.0-1.0}

Only include genuinely new insights not already captured. Return [] if nothing new. Max 3 observations per interaction.`,
      `User said: "${userMessage.slice(0, 500)}"
Agent responded: "${agentResponse.slice(0, 300)}"
${conversationContext ? `Context: ${conversationContext.slice(0, 200)}` : ""}`,
    );

    let newObs: Observation[] = [];
    try {
      const cleaned = derivation.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        newObs = parsed
          .filter((o: any) => o.fact && o.type && o.confidence)
          .map((o: any) => ({
            fact: String(o.fact).slice(0, 200),
            type: o.type,
            confidence: Math.min(1, Math.max(0, Number(o.confidence))),
            derivedAt: new Date().toISOString(),
            source: "deriver",
          }));
      }
    } catch {
      return;
    }

    if (newObs.length === 0) return;

    const allObs = [...profile.observations, ...newObs].slice(-MAX_OBSERVATIONS);
    await db.execute(sql`
      UPDATE user_profiles SET
        observations = ${JSON.stringify(allObs)}::jsonb,
        interaction_count = interaction_count + 1,
        last_derived_at = NOW(),
        updated_at = NOW()
      WHERE tenant_id = ${tenantId}
    `);
    console.log(`[user-model] Derived ${newObs.length} observations for tenant ${tenantId}`);
  } catch (err: any) {
    console.warn(`[user-model] Derive failed for tenant ${tenantId}:`, err.message);
  }
}

export async function consolidateUserModel(tenantId: number): Promise<void> {
  try {
    const profile = await getOrCreateProfile(tenantId);
    if (profile.observations.length < 5) return;

    const obsText = profile.observations
      .map(o => `[${o.type}] ${o.fact} (confidence: ${o.confidence})`)
      .join("\n");

    const synthesis = await quickLLM(
      tenantId,
      `You are a User Model Consolidator (Dreamer). Analyze accumulated observations about a user and synthesize a coherent user profile. Return JSON:
{
  "communicationStyle": "2-3 sentence summary of how this user communicates",
  "decisionPatterns": "2-3 sentence summary of how this user makes decisions",
  "preferences": {"outputFormat": "...", "detailLevel": "...", "tonePreference": "...", "otherKey": "..."},
  "personalityTraits": {"trait1": 0.0-1.0, "trait2": 0.0-1.0, ...},
  "prunedObservations": [indices of observations that are redundant or superseded]
}
Traits use 0-1 scale. Include traits like: directness, technical_depth, urgency, detail_orientation, delegation_tendency.`,
      `${profile.observations.length} observations:\n${obsText}\n\nCurrent profile:
Communication: ${profile.communicationStyle || "not yet modeled"}
Decisions: ${profile.decisionPatterns || "not yet modeled"}`,
      600,
      0.2,
    );

    try {
      const cleaned = synthesis.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);

      let prunedObs = profile.observations;
      if (Array.isArray(parsed.prunedObservations) && parsed.prunedObservations.length > 0) {
        const pruneSet = new Set(parsed.prunedObservations);
        prunedObs = profile.observations.filter((_, i) => !pruneSet.has(i));
      }

      await db.execute(sql`
        UPDATE user_profiles SET
          communication_style = ${parsed.communicationStyle || profile.communicationStyle},
          decision_patterns = ${parsed.decisionPatterns || profile.decisionPatterns},
          preferences = ${JSON.stringify(parsed.preferences || profile.preferences)}::jsonb,
          personality_traits = ${JSON.stringify(parsed.personalityTraits || profile.personalityTraits)}::jsonb,
          observations = ${JSON.stringify(prunedObs)}::jsonb,
          last_consolidated_at = NOW(),
          updated_at = NOW()
        WHERE tenant_id = ${tenantId}
      `);
      console.log(`[user-model] Consolidated profile for tenant ${tenantId} (${prunedObs.length} obs kept)`);
    } catch {
      console.warn(`[user-model] Failed to parse consolidation for tenant ${tenantId}`);
    }
  } catch (err: any) {
    console.warn(`[user-model] Consolidation failed:`, err.message);
  }
}

export async function queryUserModel(tenantId: number, question?: string): Promise<string> {
  const profile = await getOrCreateProfile(tenantId);

  if (profile.interactionCount === 0 && profile.observations.length === 0) {
    return "No user model built yet — not enough interactions observed.";
  }

  const lines: string[] = ["[User Model — Dialectic Profile]"];

  if (profile.communicationStyle) {
    lines.push(`Communication: ${profile.communicationStyle}`);
  }
  if (profile.decisionPatterns) {
    lines.push(`Decisions: ${profile.decisionPatterns}`);
  }
  if (Object.keys(profile.preferences).length > 0) {
    lines.push(`Preferences: ${JSON.stringify(profile.preferences)}`);
  }
  if (Object.keys(profile.personalityTraits).length > 0) {
    const traits = Object.entries(profile.personalityTraits)
      .map(([k, v]) => `${k}: ${((v as number) * 100).toFixed(0)}%`)
      .join(", ");
    lines.push(`Traits: ${traits}`);
  }

  lines.push(`Interactions observed: ${profile.interactionCount}`);
  lines.push(`Observations: ${profile.observations.length}`);

  if (question) {
    try {
      const answer = await quickLLM(
        tenantId,
        `You are a Dialectic agent. Answer questions about a user based on their profile data. Be specific and actionable. If the profile doesn't contain enough data, say so honestly.`,
        `User profile:\n${lines.join("\n")}\n\nRecent observations:\n${profile.observations.slice(-15).map(o => `- [${o.type}] ${o.fact}`).join("\n")}\n\nQuestion: ${question}`,
        300,
      );
      lines.push(`\nDialectic answer: ${answer}`);
    } catch (_silentErr) { logSilentCatch("server/user-modeling.ts", _silentErr); }
  }

  return lines.join("\n");
}

export function buildUserModelContext(profile: UserProfile): string {
  if (profile.interactionCount === 0 && !profile.communicationStyle) return "";

  const parts: string[] = ["[User Adaptation Model]"];
  if (profile.communicationStyle) parts.push(`Style: ${profile.communicationStyle}`);
  if (profile.decisionPatterns) parts.push(`Decisions: ${profile.decisionPatterns}`);
  if (Object.keys(profile.preferences).length > 0) {
    const prefs = Object.entries(profile.preferences).map(([k, v]) => `${k}=${v}`).join(", ");
    parts.push(`Prefs: ${prefs}`);
  }
  if (Object.keys(profile.personalityTraits).length > 0) {
    const top = Object.entries(profile.personalityTraits)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 5)
      .map(([k, v]) => `${k}:${((v as number) * 100).toFixed(0)}%`)
      .join(", ");
    parts.push(`Traits: ${top}`);
  }
  parts.push("Adapt your tone, detail level, and format to match this user's preferences.");
  return parts.join("\n");
}
