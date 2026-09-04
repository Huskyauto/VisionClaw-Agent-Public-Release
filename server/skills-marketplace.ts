import { db } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { isManagedSkillSecurityError } from "./lib/managed-skill-safety";

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  promptContent: string;
  author: string;
  version: string;
  downloads: number;
  tags: string[];
}

const BUILT_IN_TEMPLATES: SkillTemplate[] = [];

const CATEGORIES = [
  { id: "all", name: "All Skills", icon: "Grid" },
  { id: "communication", name: "Communication", icon: "MessageSquare" },
  { id: "development", name: "Development", icon: "Code" },
  { id: "analytics", name: "Analytics", icon: "BarChart3" },
  { id: "productivity", name: "Productivity", icon: "Zap" },
  { id: "marketing", name: "Marketing", icon: "Megaphone" },
  { id: "legal", name: "Legal", icon: "Shield" },
  { id: "finance", name: "Finance", icon: "DollarSign" },
  { id: "business", name: "Business", icon: "Briefcase" },
  { id: "ai", name: "AI & ML", icon: "Brain" },
];

export function getMarketplaceTemplates(category?: string, search?: string): SkillTemplate[] {
  let results = [...BUILT_IN_TEMPLATES];

  if (category && category !== "all") {
    results = results.filter((t) => t.category === category);
  }

  if (search) {
    const q = search.toLowerCase();
    results = results.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q))
    );
  }

  return results;
}

export function getCategories() {
  return CATEGORIES;
}

export async function installSkillFromTemplate(templateId: string): Promise<{ success: boolean; skillId?: number; error?: string }> {
  const template = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return { success: false, error: "Template not found" };
  }

  const existing = await db.execute(sql`SELECT id FROM skills WHERE name = ${template.name}`);
  const existingRows = (existing as any).rows || existing;
  if (existingRows?.length > 0) {
    return { success: false, error: "Skill already installed" };
  }

  try {
    const skill = await storage.createSkill({
      name: template.name,
      description: template.description,
      icon: template.icon,
      enabled: true,
      category: template.category,
      promptContent: template.promptContent,
    });
    return { success: true, skillId: skill.id };
  } catch (error) {
    if (!isManagedSkillSecurityError(error)) throw error;
    return {
      success: false,
      error: `Skill content rejected by security scan (${error.patterns.join(", ")}).`,
    };
  }
}

export async function exportSkill(skillId: number): Promise<{ success: boolean; data?: any; error?: string }> {
  const result = await db.execute(sql`SELECT * FROM skills WHERE id = ${skillId}`);
  const rows = (result as any).rows || result;
  const skill = rows?.[0];
  if (!skill) return { success: false, error: "Skill not found" };

  return {
    success: true,
    data: {
      format: "visionclaw-skill-v1",
      name: skill.name,
      description: skill.description,
      icon: skill.icon,
      category: skill.category,
      promptContent: skill.prompt_content,
      exportedAt: new Date().toISOString(),
      version: "1.0",
    },
  };
}

export async function importSkill(skillData: any): Promise<{ success: boolean; skillId?: number; error?: string }> {
  if (!skillData?.format || !skillData.format.startsWith("visionclaw-skill")) {
    return { success: false, error: "Invalid skill format" };
  }
  if (!skillData.name || !skillData.promptContent) {
    return { success: false, error: "Skill must have name and promptContent" };
  }

  try {
    const skill = await storage.createSkill({
      name: skillData.name,
      description: skillData.description || "",
      icon: skillData.icon || "Zap",
      enabled: true,
      category: skillData.category || "general",
      promptContent: skillData.promptContent,
    });
    return { success: true, skillId: skill.id };
  } catch (error) {
    if (!isManagedSkillSecurityError(error)) throw error;
    return {
      success: false,
      error: `Skill content rejected by security scan (${error.patterns.join(", ")}).`,
    };
  }
}
