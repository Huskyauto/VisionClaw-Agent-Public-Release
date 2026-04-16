import { db } from "./db";
import { sql } from "drizzle-orm";
import { replitOpenai } from "./providers";
import { generateEmbedding, cosineSimilarity } from "./embeddings";

const CATEGORY_SIMILARITY_THRESHOLD = 0.75;
const LINK_SIMILARITY_THRESHOLD = 0.6;
const MAX_LINKS_PER_MEMORY = 5;

interface CategoryMatch {
  id: number;
  name: string;
  description: string | null;
  similarity: number;
}

export async function ensureCategory(
  categoryName: string,
  tenantId: number = 1,
  personaId?: number | null,
  parentId?: number | null
): Promise<number> {
  const existingResult = await db.execute(
    sql`SELECT id FROM memory_categories WHERE LOWER(name) = LOWER(${categoryName}) AND tenant_id = ${tenantId} LIMIT 1`
  );
  const existing = ((existingResult as any).rows || existingResult)[0];
  if (existing) return existing.id;

  const insertResult = await db.execute(
    sql`INSERT INTO memory_categories (name, parent_id, tenant_id, persona_id, description)
        VALUES (${categoryName}, ${parentId || null}, ${tenantId}, ${personaId || null}, ${categoryName})
        RETURNING id`
  );
  const row = ((insertResult as any).rows || insertResult)[0];
  return row.id;
}

export async function classifyMemoryCategory(
  fact: string,
  existingCategory: string,
  tenantId: number = 1,
  personaId?: number | null
): Promise<{ categoryId: number; categoryPath: string }> {
  try {
    const categoriesResult = await db.execute(
      sql`SELECT id, name, description, parent_id FROM memory_categories WHERE tenant_id = ${tenantId}`
    );
    const categories = (categoriesResult as any).rows || categoriesResult;

    if (categories.length === 0) {
      const topLevel = mapCategoryFromFlat(existingCategory);
      const catId = await ensureCategory(topLevel, tenantId, personaId);
      await db.execute(
        sql`UPDATE memory_categories SET memory_count = memory_count + 1 WHERE id = ${catId}`
      );
      return { categoryId: catId, categoryPath: topLevel };
    }

    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You organize memory facts into categories. Given a fact and existing categories, either assign to the best matching one or suggest a new category name.

Existing categories: ${categories.map((c: any) => c.name).join(", ")}

Output JSON: {"category": "CategoryName", "isNew": true/false, "parentCategory": "ParentName or null"}
- Use existing category if the fact fits well
- Only create new if truly novel topic
- parentCategory only if this is a subcategory of an existing one`
        },
        { role: "user", content: `Fact: "${fact}"\nOriginal tag: ${existingCategory}` }
      ],
      max_completion_tokens: 100,
      response_format: { type: "json_object" },
    });

    const content = resp.choices[0]?.message?.content;
    if (!content) throw new Error("No response");

    const parsed = JSON.parse(content);
    const catName = parsed.category || mapCategoryFromFlat(existingCategory);

    let parentCatId: number | null = null;
    if (parsed.parentCategory) {
      const parentMatch = categories.find((c: any) =>
        c.name.toLowerCase() === parsed.parentCategory.toLowerCase()
      );
      if (parentMatch) parentCatId = parentMatch.id;
    }

    const catId = await ensureCategory(catName, tenantId, personaId, parentCatId);
    await refreshCategoryCount(catId);

    const pathParts = [catName];
    if (parentCatId) {
      const parent = categories.find((c: any) => c.id === parentCatId);
      if (parent) pathParts.unshift(parent.name);
    }

    return { categoryId: catId, categoryPath: pathParts.join(" / ") };
  } catch (err: any) {
    const fallback = mapCategoryFromFlat(existingCategory);
    const catId = await ensureCategory(fallback, tenantId, personaId);
    await refreshCategoryCount(catId);
    return { categoryId: catId, categoryPath: fallback };
  }
}

async function refreshCategoryCount(categoryId: number): Promise<void> {
  try {
    await db.execute(
      sql`UPDATE memory_categories SET memory_count = (
        SELECT count(*)::int FROM memory_entries
        WHERE category_id = ${categoryId} AND status = 'active' AND deleted_at IS NULL
      ) WHERE id = ${categoryId}`
    );
  } catch {}
}

function mapCategoryFromFlat(category: string): string {
  const mapping: Record<string, string> = {
    preference: "Preferences",
    identity: "Identity",
    goal: "Goals & Plans",
    context: "Context",
    skill: "Skills & Abilities",
    relationship: "Relationships",
    tool_pattern: "Tool Patterns",
  };
  return mapping[category] || "General";
}

export async function linkRelatedMemories(
  newMemoryId: number,
  newFact: string,
  newEmbedding: number[] | null,
  tenantId: number = 1
): Promise<number> {
  try {
    const memoriesResult = await db.execute(
      sql`SELECT id, fact, embedding FROM memory_entries
          WHERE status = 'active' AND tenant_id = ${tenantId}
          AND id != ${newMemoryId} AND deleted_at IS NULL
          ORDER BY last_accessed DESC LIMIT 200`
    );
    const memories = (memoriesResult as any).rows || memoriesResult;
    if (memories.length === 0) return 0;

    const scored: { id: number; similarity: number }[] = [];

    for (const m of memories) {
      let sim = 0;
      if (newEmbedding && m.embedding) {
        const emb = typeof m.embedding === "string" ? JSON.parse(m.embedding) : m.embedding;
        sim = cosineSimilarity(newEmbedding, emb);
      }
      if (sim >= LINK_SIMILARITY_THRESHOLD) {
        scored.push({ id: m.id, similarity: sim });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    const toLink = scored.slice(0, MAX_LINKS_PER_MEMORY);

    let linked = 0;
    for (const target of toLink) {
      const existsResult = await db.execute(
        sql`SELECT 1 FROM memory_links
            WHERE (source_memory_id = ${newMemoryId} AND target_memory_id = ${target.id})
            OR (source_memory_id = ${target.id} AND target_memory_id = ${newMemoryId})
            LIMIT 1`
      );
      const exists = ((existsResult as any).rows || existsResult)[0];
      if (exists) continue;

      await db.execute(
        sql`INSERT INTO memory_links (source_memory_id, target_memory_id, link_type, strength)
            VALUES (${newMemoryId}, ${target.id}, 'related', ${target.similarity})`
      );
      linked++;
    }

    return linked;
  } catch (err: any) {
    console.warn("[memory-graph] Link creation warning:", err.message);
    return 0;
  }
}

export async function getLinkedMemories(memoryId: number): Promise<number[]> {
  try {
    const result = await db.execute(
      sql`SELECT CASE
            WHEN ml.source_memory_id = ${memoryId} THEN ml.target_memory_id
            ELSE ml.source_memory_id
          END as linked_id
          FROM memory_links ml
          JOIN memory_entries me ON me.id = CASE
            WHEN ml.source_memory_id = ${memoryId} THEN ml.target_memory_id
            ELSE ml.source_memory_id
          END
          WHERE (ml.source_memory_id = ${memoryId} OR ml.target_memory_id = ${memoryId})
          AND me.status = 'active' AND me.deleted_at IS NULL
          ORDER BY ml.strength DESC`
    );
    const rows = (result as any).rows || result;
    return rows.map((r: any) => r.linked_id);
  } catch {
    return [];
  }
}

export async function proactiveContextLoad(
  userMessage: string,
  tenantId: number = 1,
  personaId?: number | null,
  maxCategories: number = 3
): Promise<{ relevantCategoryIds: number[]; anticipatedMemoryIds: number[] }> {
  try {
    const categoriesResult = await db.execute(
      sql`SELECT id, name, description, memory_count FROM memory_categories
          WHERE tenant_id = ${tenantId} AND memory_count > 0
          ORDER BY memory_count DESC LIMIT 50`
    );
    const categories = (categoriesResult as any).rows || categoriesResult;
    if (categories.length === 0) return { relevantCategoryIds: [], anticipatedMemoryIds: [] };

    const resp = await replitOpenai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `Given a user message and available memory categories, predict which categories are most likely relevant. Also predict what the user might ask about NEXT (anticipatory loading).

Categories: ${categories.map((c: any) => `${c.name} (${c.memory_count} items)`).join(", ")}

Output JSON: {"relevant": ["CategoryName1", "CategoryName2"], "anticipated": ["CategoryName3"]}
- "relevant": categories directly related to the current message
- "anticipated": categories the user is likely to reference soon based on context
- Return max ${maxCategories} relevant and 2 anticipated`
        },
        { role: "user", content: userMessage }
      ],
      max_completion_tokens: 120,
      response_format: { type: "json_object" },
    });

    const content = resp.choices[0]?.message?.content;
    if (!content) return { relevantCategoryIds: [], anticipatedMemoryIds: [] };

    const parsed = JSON.parse(content);
    const allNames = [...(parsed.relevant || []), ...(parsed.anticipated || [])];
    const matchedIds: number[] = [];

    for (const name of allNames) {
      const cat = categories.find((c: any) =>
        c.name.toLowerCase() === name.toLowerCase()
      );
      if (cat) matchedIds.push(cat.id);
    }

    if (matchedIds.length === 0) return { relevantCategoryIds: [], anticipatedMemoryIds: [] };

    const relevantCategoryIds = matchedIds.slice(0, maxCategories);

    const memResult = await db.execute(
      sql`SELECT id FROM memory_entries
          WHERE category_id IN (${sql.join(matchedIds.map(id => sql`${id}`), sql`, `)})
          AND status = 'active' AND deleted_at IS NULL AND tenant_id = ${tenantId}
          ORDER BY last_accessed DESC LIMIT 20`
    );
    const anticipatedMemoryIds = ((memResult as any).rows || memResult).map((r: any) => r.id);

    return { relevantCategoryIds, anticipatedMemoryIds };
  } catch (err: any) {
    console.warn("[memory-graph] Proactive context warning:", err.message);
    return { relevantCategoryIds: [], anticipatedMemoryIds: [] };
  }
}

export async function getCategoryTree(tenantId: number = 1): Promise<any[]> {
  try {
    const result = await db.execute(
      sql`SELECT id, name, parent_id, description, memory_count, persona_id, created_at
          FROM memory_categories WHERE tenant_id = ${tenantId}
          ORDER BY memory_count DESC`
    );
    const rows = (result as any).rows || result;

    const byId = new Map<number, any>();
    for (const row of rows) {
      byId.set(row.id, { ...row, children: [] });
    }

    const roots: any[] = [];
    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) {
        byId.get(node.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  } catch {
    return [];
  }
}

export async function getMemoryGraph(tenantId: number = 1): Promise<{
  categories: any[];
  totalMemories: number;
  totalLinks: number;
  topCategories: { name: string; count: number }[];
}> {
  try {
    const categories = await getCategoryTree(tenantId);

    const memCountResult = await db.execute(
      sql`SELECT count(*)::int as count FROM memory_entries
          WHERE tenant_id = ${tenantId} AND status = 'active' AND deleted_at IS NULL`
    );
    const totalMemories = ((memCountResult as any).rows || memCountResult)[0]?.count || 0;

    const linkCountResult = await db.execute(
      sql`SELECT count(*)::int as count FROM memory_links ml
          JOIN memory_entries me ON ml.source_memory_id = me.id
          WHERE me.tenant_id = ${tenantId}`
    );
    const totalLinks = ((linkCountResult as any).rows || linkCountResult)[0]?.count || 0;

    const topResult = await db.execute(
      sql`SELECT name, memory_count FROM memory_categories
          WHERE tenant_id = ${tenantId} AND memory_count > 0
          ORDER BY memory_count DESC LIMIT 10`
    );
    const topCategories = ((topResult as any).rows || topResult).map((r: any) => ({
      name: r.name,
      count: r.memory_count,
    }));

    return { categories, totalMemories, totalLinks, topCategories };
  } catch {
    return { categories: [], totalMemories: 0, totalLinks: 0, topCategories: [] };
  }
}

export async function categorizeExistingMemories(tenantId: number = 1): Promise<number> {
  try {
    const result = await db.execute(
      sql`SELECT id, fact, category, persona_id FROM memory_entries
          WHERE status = 'active' AND deleted_at IS NULL AND tenant_id = ${tenantId}
          AND category_id IS NULL
          ORDER BY created_at DESC LIMIT 100`
    );
    const uncategorized = (result as any).rows || result;
    if (uncategorized.length === 0) return 0;

    let categorized = 0;
    for (const mem of uncategorized) {
      try {
        const { categoryId } = await classifyMemoryCategory(
          mem.fact, mem.category, tenantId, mem.persona_id
        );
        await db.execute(
          sql`UPDATE memory_entries SET category_id = ${categoryId} WHERE id = ${mem.id}`
        );
        categorized++;
      } catch {
        continue;
      }
    }

    console.log(`[memory-graph] Categorized ${categorized} existing memories`);
    return categorized;
  } catch (err: any) {
    console.warn("[memory-graph] Batch categorize warning:", err.message);
    return 0;
  }
}
