import { storage } from "./storage";
import { replitOpenai } from "./providers";
import { generateEmbedding, cosineSimilarity, keywordSimilarity } from "./embeddings";
import { classifyMemoryCategory, linkRelatedMemories } from "./memory-graph";
import { db } from "./db";
import { sql } from "drizzle-orm";

const SIMILARITY_THRESHOLD = 0.82;
const CONTRADICTION_THRESHOLD = 0.55;
const MAX_FACTS_PER_TURN = 4;

interface ExtractedFact {
  fact: string;
  category: string;
  confidence: number;
  wing?: string;
  room?: string;
  supersedes?: string;
}

interface MemoryAction {
  type: "create" | "update" | "skip";
  fact: string;
  category: string;
  wing?: string;
  room?: string;
  existingId?: number;
  reason?: string;
}

async function findSimilarMemories(fact: string, personaId?: number | null, tenantId?: number): Promise<any[]> {
  const allMemories = await storage.getMemoryEntries(personaId ?? undefined, 500, 0, tenantId);
  const active = allMemories.data.filter((m: any) => m.status === "active");
  if (active.length === 0) return [];

  const factEmbedding = await generateEmbedding(fact);

  const scored = active.map((m: any) => {
    let similarity = 0;
    if (factEmbedding && m.embedding) {
      similarity = cosineSimilarity(factEmbedding, m.embedding as number[]);
    } else {
      similarity = keywordSimilarity(fact, m.fact);
    }
    return { ...m, similarity };
  });

  return scored
    .filter((m: any) => m.similarity > 0.3)
    .sort((a: any, b: any) => b.similarity - a.similarity)
    .slice(0, 10);
}

async function classifyRelationship(
  newFact: string,
  existingFact: string
): Promise<{ relation: "duplicate" | "contradiction" | "update" | "unrelated"; confidence: number }> {
  try {
    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You classify the relationship between two facts about a user. Output JSON: {"relation": "duplicate|contradiction|update|unrelated", "confidence": 0.0-1.0}

- "duplicate": same information, just worded differently
- "contradiction": directly conflicts (e.g., "lives in Texas" vs "lives in Florida")  
- "update": new fact is a newer version of the old fact (e.g., "works at Acme" vs "works at Globex" — same topic, changed value)
- "unrelated": different topics entirely

"update" and "contradiction" are similar but "update" implies temporal progression (things changed), while "contradiction" implies the facts cannot coexist.`,
        },
        {
          role: "user",
          content: `Existing fact: "${existingFact}"\nNew fact: "${newFact}"`,
        },
      ],
      max_completion_tokens: 80,
      response_format: { type: "json_object" },
    });

    const content = resp.choices[0]?.message?.content;
    if (!content) return { relation: "unrelated", confidence: 0 };

    const parsed = JSON.parse(content);
    return {
      relation: parsed.relation || "unrelated",
      confidence: parsed.confidence || 0.5,
    };
  } catch {
    return { relation: "unrelated", confidence: 0 };
  }
}

async function resolveMemoryActions(
  facts: ExtractedFact[],
  personaId?: number | null,
  tenantId?: number
): Promise<MemoryAction[]> {
  const actions: MemoryAction[] = [];

  for (const fact of facts) {
    const similar = await findSimilarMemories(fact.fact, personaId, tenantId);

    if (similar.length === 0) {
      actions.push({ type: "create", fact: fact.fact, category: fact.category, wing: fact.wing, room: fact.room });
      continue;
    }

    const topMatch = similar[0];

    if (topMatch.similarity > SIMILARITY_THRESHOLD) {
      actions.push({
        type: "skip",
        fact: fact.fact,
        category: fact.category,
        existingId: topMatch.id,
        reason: `Duplicate of memory #${topMatch.id} (similarity: ${topMatch.similarity.toFixed(2)})`,
      });
      continue;
    }

    if (topMatch.similarity > CONTRADICTION_THRESHOLD) {
      const classification = await classifyRelationship(fact.fact, topMatch.fact);

      if (classification.relation === "duplicate" && classification.confidence > 0.7) {
        actions.push({
          type: "skip",
          fact: fact.fact,
          category: fact.category,
          existingId: topMatch.id,
          reason: `LLM classified as duplicate of #${topMatch.id}`,
        });
      } else if (
        (classification.relation === "contradiction" || classification.relation === "update") &&
        classification.confidence > 0.6
      ) {
        actions.push({
          type: "update",
          fact: fact.fact,
          category: fact.category,
          wing: fact.wing,
          room: fact.room,
          existingId: topMatch.id,
          reason: `${classification.relation} of memory #${topMatch.id}: "${topMatch.fact}" → "${fact.fact}"`,
        });
      } else {
        actions.push({ type: "create", fact: fact.fact, category: fact.category, wing: fact.wing, room: fact.room });
      }
    } else {
      actions.push({ type: "create", fact: fact.fact, category: fact.category, wing: fact.wing, room: fact.room });
    }
  }

  return actions;
}

export async function intelligentExtractMemory(
  assistantResponse: string,
  userMessage: string,
  personaId?: number | null,
  tenantId: number = 1
): Promise<{ created: number; updated: number; skipped: number; actions: MemoryAction[] }> {
  const stats = { created: 0, updated: 0, skipped: 0, actions: [] as MemoryAction[] };

  try {
    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You extract durable facts about the user from conversations. Output JSON: {"facts": [{"fact": "...", "category": "...", "confidence": 0.0-1.0, "wing": "...", "room": "..."}]}

Categories:
- "identity": name, age, location, job, company, role
- "preference": likes, dislikes, communication style, tool preferences
- "relationship": people they mention, family, colleagues
- "goal": objectives, plans, aspirations, projects
- "context": current situation, recent events, ongoing work
- "skill": things they know, expertise, capabilities

Wing (which project, person, or domain this fact belongs to):
- Use a short lowercase slug like "main-project", "personal", "marketing", "engineering"
- If the fact is general/personal about the user, use "personal"
- If it relates to a specific project or product, use that name

Room (which topic within the wing):
- Use a short lowercase slug like "architecture", "preferences", "team", "goals", "finances", "branding"
- Describes the aspect or subtopic of the wing this fact falls under

Rules:
- Only extract facts that would be useful to remember across future conversations
- Keep facts concise, specific, and third-person ("User lives in Texas" not "I live in Texas")
- Set confidence based on how clearly stated the fact is (explicit statement = 0.9+, implied = 0.5-0.7)
- If nothing worth remembering, return {"facts": []}
- Max ${MAX_FACTS_PER_TURN} facts per extraction`,
        },
        {
          role: "user",
          content: `User said: "${userMessage.slice(0, 500)}"\nAssistant responded: "${assistantResponse.slice(0, 500)}"\n\nExtract durable facts:`,
        },
      ],
      max_completion_tokens: 300,
      response_format: { type: "json_object" },
    });

    const content = resp.choices[0]?.message?.content;
    if (!content) return stats;

    const parsed = JSON.parse(content);
    const facts: ExtractedFact[] = (parsed.facts || [])
      .filter((f: any) => f.fact && f.fact.length > 5 && (f.confidence ?? 1) >= 0.5)
      .slice(0, MAX_FACTS_PER_TURN);

    if (facts.length === 0) return stats;

    const actions = await resolveMemoryActions(facts, personaId, tenantId);
    stats.actions = actions;

    for (const action of actions) {
      try {
        if (action.type === "create") {
          const entry = await storage.createMemoryEntry({
            fact: action.fact,
            category: action.category,
            source: "conversation",
            status: "active",
            personaId: personaId ?? null,
            tenantId,
            wing: action.wing || null,
            room: action.room || null,
          });
          generateEmbedding(action.fact)
            .then((emb) => {
              if (emb) {
                storage.updateMemoryEmbedding(entry.id, emb).catch(() => {});
                linkRelatedMemories(entry.id, action.fact, emb, tenantId).catch(() => {});
              }
            })
            .catch(() => {});
          classifyMemoryCategory(action.fact, action.category, tenantId, personaId)
            .then(({ categoryId }) => {
              db.execute(sql`UPDATE memory_entries SET category_id = ${categoryId} WHERE id = ${entry.id}`).catch(() => {});
            })
            .catch(() => {});
          stats.created++;
          console.log(`[memory-intel] Created #${entry.id}: "${action.fact.slice(0, 60)}"`);
        } else if (action.type === "update" && action.existingId) {
          await storage.updateMemoryEntry(action.existingId, { status: "superseded" });
          const entry = await storage.createMemoryEntry({
            fact: action.fact,
            category: action.category,
            source: "conversation",
            status: "active",
            personaId: personaId ?? null,
            tenantId,
            wing: action.wing || null,
            room: action.room || null,
          });
          generateEmbedding(action.fact)
            .then((emb) => {
              if (emb) {
                storage.updateMemoryEmbedding(entry.id, emb).catch(() => {});
                linkRelatedMemories(entry.id, action.fact, emb, tenantId).catch(() => {});
              }
            })
            .catch(() => {});
          classifyMemoryCategory(action.fact, action.category, tenantId, personaId)
            .then(({ categoryId }) => {
              db.execute(sql`UPDATE memory_entries SET category_id = ${categoryId} WHERE id = ${entry.id}`).catch(() => {});
            })
            .catch(() => {});
          stats.updated++;
          console.log(`[memory-intel] Updated #${action.existingId} → #${entry.id}: ${action.reason}`);
        } else if (action.type === "skip") {
          stats.skipped++;
          console.log(`[memory-intel] Skipped: ${action.reason}`);
        }
      } catch (err: any) {
        console.error(`[memory-intel] Action failed:`, err.message);
      }
    }

    extractTriples(userMessage, assistantResponse, tenantId, personaId).catch((e) =>
      console.error("[memory-intel] Triple extraction failed:", e.message)
    );

    return stats;
  } catch (err: any) {
    console.error(`[memory-intel] Extraction failed:`, err.message);
    return stats;
  }
}

async function extractTriples(userMessage: string, assistantResponse: string, tenantId: number, personaId?: number | null) {
  const resp = await replitOpenai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content: `Extract entity-relationship facts as temporal triples from conversation. Output JSON:
{"triples": [{"subject": "...", "predicate": "...", "object": "...", "confidence": 0.0-1.0, "valid_from": "YYYY-MM-DD or null", "wing": "...", "room": "..."}]}

Triple format: (Subject) —predicate→ (Object). Examples:
- ("Alice", "is CEO of", "Acme Corp")
- ("VisionClaw", "uses", "PostgreSQL 15")
- ("Felix", "has role", "CEO agent")

Rules:
- Only extract clear entity-relationship facts, not opinions or vague statements
- Predicates should be short verb phrases: "is", "uses", "lives in", "works at", "has role", "owns", "created", "manages"
- Subject and object should be specific named entities or values
- Set valid_from to the date when this fact became true if mentioned, otherwise null
- Wing/room follow Memory Palace convention (wing=project/domain, room=topic)
- If no triples worth extracting, return {"triples": []}
- Max 3 triples per extraction`,
      },
      {
        role: "user",
        content: `User: "${userMessage.slice(0, 400)}"\nAssistant: "${assistantResponse.slice(0, 400)}"\n\nExtract triples:`,
      },
    ],
    max_completion_tokens: 250,
    response_format: { type: "json_object" },
  });

  const content = resp.choices[0]?.message?.content;
  if (!content) return;
  const parsed = JSON.parse(content);
  const triples = (parsed.triples || []).filter((t: any) => t.subject && t.predicate && t.object && (t.confidence ?? 1) >= 0.5).slice(0, 3);
  if (triples.length === 0) return;

  for (const t of triples) {
    const validFrom = t.valid_from ? new Date(t.valid_from) : new Date();
    const existing = await db.execute(sql`
      SELECT id FROM knowledge_triples
      WHERE subject = ${t.subject} AND predicate = ${t.predicate} AND object = ${t.object}
        AND tenant_id = ${tenantId} AND valid_until IS NULL
      LIMIT 1
    `);
    if (((existing as any).rows || existing).length > 0) continue;

    const contradictions = await db.execute(sql`
      SELECT id FROM knowledge_triples
      WHERE subject = ${t.subject} AND predicate = ${t.predicate}
        AND tenant_id = ${tenantId} AND valid_until IS NULL
    `);
    for (const c of ((contradictions as any).rows || contradictions)) {
      await db.execute(sql`UPDATE knowledge_triples SET valid_until = ${validFrom}, updated_at = NOW() WHERE id = ${c.id}`);
    }

    await db.execute(sql`
      INSERT INTO knowledge_triples (subject, predicate, object, confidence, source, valid_from, wing, room, tenant_id, persona_id)
      VALUES (${t.subject}, ${t.predicate}, ${t.object}, ${t.confidence ?? 0.8}, 'conversation',
              ${validFrom}, ${t.wing || null}, ${t.room || null}, ${tenantId}, ${personaId || null})
    `);
    console.log(`[memory-intel] Triple: (${t.subject}) —${t.predicate}→ (${t.object})`);
  }
}

export async function deduplicateMemories(personaId?: number | null, tenantId?: number): Promise<{ merged: number; removed: number }> {
  const allMemories = await storage.getMemoryEntries(personaId ?? undefined, 1000, 0, tenantId);
  const active = allMemories.data.filter((m: any) => m.status === "active");
  const stats = { merged: 0, removed: 0 };

  const processed = new Set<number>();

  for (let i = 0; i < active.length; i++) {
    if (processed.has(active[i].id)) continue;

    for (let j = i + 1; j < active.length; j++) {
      if (processed.has(active[j].id)) continue;

      let similarity = 0;
      if (active[i].embedding && active[j].embedding) {
        similarity = cosineSimilarity(
          active[i].embedding as number[],
          active[j].embedding as number[]
        );
      } else {
        similarity = keywordSimilarity(active[i].fact, active[j].fact);
      }

      if (similarity > SIMILARITY_THRESHOLD) {
        const keep = (active[i].accessCount || 0) >= (active[j].accessCount || 0) ? active[i] : active[j];
        const remove = keep.id === active[i].id ? active[j] : active[i];

        await storage.updateMemoryEntry(remove.id, { status: "superseded" });
        processed.add(remove.id);
        stats.merged++;
        stats.removed++;
        console.log(`[memory-intel] Dedup: removed #${remove.id} (dup of #${keep.id}, sim=${similarity.toFixed(2)})`);
      }
    }
  }

  return stats;
}

export async function getMemoryHealth(personaId?: number | null, tenantId?: number): Promise<{
  totalActive: number;
  byCategory: Record<string, number>;
  withEmbeddings: number;
  withoutEmbeddings: number;
  oldestMemory: string | null;
  newestMemory: string | null;
  avgAccessCount: number;
  potentialDuplicates: number;
}> {
  const allMemories = await storage.getMemoryEntries(personaId ?? undefined, 1000, 0, tenantId);
  const active = allMemories.data.filter((m: any) => m.status === "active");

  const byCategory: Record<string, number> = {};
  let withEmbeddings = 0;
  let withoutEmbeddings = 0;
  let totalAccess = 0;

  for (const m of active) {
    byCategory[m.category] = (byCategory[m.category] || 0) + 1;
    if (m.embedding) withEmbeddings++;
    else withoutEmbeddings++;
    totalAccess += m.accessCount || 0;
  }

  let potentialDuplicates = 0;
  for (let i = 0; i < Math.min(active.length, 50); i++) {
    for (let j = i + 1; j < Math.min(active.length, 50); j++) {
      const sim = keywordSimilarity(active[i].fact, active[j].fact);
      if (sim > 0.7) potentialDuplicates++;
    }
  }

  const sorted = [...active].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return {
    totalActive: active.length,
    byCategory,
    withEmbeddings,
    withoutEmbeddings,
    oldestMemory: sorted[0]?.createdAt?.toISOString?.() || sorted[0]?.createdAt || null,
    newestMemory: sorted[sorted.length - 1]?.createdAt?.toISOString?.() || sorted[sorted.length - 1]?.createdAt || null,
    avgAccessCount: active.length > 0 ? Math.round(totalAccess / active.length) : 0,
    potentialDuplicates,
  };
}

export async function findAndResolveContradictions(
  newFact: string,
  category: string,
  personaId?: number | null,
  tenantId?: number
): Promise<{ action: "create" | "update" | "skip"; existingId?: number; reason?: string }> {
  try {
    const similar = await findSimilarMemories(newFact, personaId, tenantId);

    if (similar.length === 0) {
      return { action: "create" };
    }

    const topMatch = similar[0];

    if (topMatch.similarity > SIMILARITY_THRESHOLD) {
      return { action: "skip", existingId: topMatch.id, reason: `Duplicate of memory #${topMatch.id} (similarity: ${topMatch.similarity.toFixed(2)})` };
    }

    if (topMatch.similarity > CONTRADICTION_THRESHOLD) {
      const classification = await classifyRelationship(newFact, topMatch.fact);

      if (classification.relation === "duplicate" && classification.confidence > 0.7) {
        return { action: "skip", existingId: topMatch.id, reason: `LLM classified as duplicate of #${topMatch.id}` };
      }

      if ((classification.relation === "contradiction" || classification.relation === "update") && classification.confidence > 0.6) {
        return { action: "update", existingId: topMatch.id, reason: `Supersedes memory #${topMatch.id}: ${classification.relation} (${classification.confidence.toFixed(2)} confidence)` };
      }
    }

    return { action: "create" };
  } catch {
    return { action: "create" };
  }
}
