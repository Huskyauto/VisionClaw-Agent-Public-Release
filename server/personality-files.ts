import { db } from "./db";
import { sql } from "drizzle-orm";

export async function ensurePersonalityFilesTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS personality_files (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      persona_id INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(tenant_id, persona_id, file_type)
    )
  `);
}

ensurePersonalityFilesTable().catch(e => console.error("[personality-files] Table init error:", e.message));

const VALID_FILE_TYPES = ["SOUL", "STYLE", "USER", "RULES", "CONTEXT"] as const;
type FileType = typeof VALID_FILE_TYPES[number];

export interface PersonalityFile {
  id: number;
  tenantId: number;
  personaId: number;
  fileType: string;
  content: string;
  updatedAt: string;
}

const FILE_DESCRIPTIONS: Record<string, string> = {
  SOUL: "Core personality, values, and behavioral boundaries. Defines who the agent IS at its deepest level.",
  STYLE: "Communication style, tone, vocabulary preferences, and formatting rules.",
  USER: "Context about the user/CEO — their preferences, business, goals, and working style.",
  RULES: "Hard rules and constraints the agent must always follow. Non-negotiable directives.",
  CONTEXT: "Business context, domain knowledge, and situational awareness the agent should maintain.",
};

export function getFileDescriptions() {
  return VALID_FILE_TYPES.map(ft => ({
    type: ft,
    description: FILE_DESCRIPTIONS[ft],
  }));
}

export async function getPersonalityFiles(tenantId: number, personaId: number): Promise<PersonalityFile[]> {
  const result = await db.execute(sql`
    SELECT id, tenant_id as "tenantId", persona_id as "personaId", 
           file_type as "fileType", content, updated_at as "updatedAt"
    FROM personality_files 
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId}
    ORDER BY file_type
  `);
  return ((result as any).rows || result) as PersonalityFile[];
}

export async function getAllPersonalityFiles(tenantId: number): Promise<PersonalityFile[]> {
  const result = await db.execute(sql`
    SELECT pf.id, pf.tenant_id as "tenantId", pf.persona_id as "personaId",
           pf.file_type as "fileType", pf.content, pf.updated_at as "updatedAt"
    FROM personality_files pf
    WHERE pf.tenant_id = ${tenantId} AND pf.content != ''
    ORDER BY pf.persona_id, pf.file_type
  `);
  return ((result as any).rows || result) as PersonalityFile[];
}

export async function upsertPersonalityFile(
  tenantId: number, personaId: number, fileType: string, content: string
): Promise<PersonalityFile> {
  if (!VALID_FILE_TYPES.includes(fileType as FileType)) {
    throw new Error(`Invalid file type: ${fileType}. Valid: ${VALID_FILE_TYPES.join(", ")}`);
  }

  const result = await db.execute(sql`
    INSERT INTO personality_files (tenant_id, persona_id, file_type, content, updated_at)
    VALUES (${tenantId}, ${personaId}, ${fileType}, ${content}, NOW())
    ON CONFLICT (tenant_id, persona_id, file_type) 
    DO UPDATE SET content = ${content}, updated_at = NOW()
    RETURNING id, tenant_id as "tenantId", persona_id as "personaId",
              file_type as "fileType", content, updated_at as "updatedAt"
  `);
  const rows = (result as any).rows || result;
  return rows[0] as PersonalityFile;
}

export async function deletePersonalityFile(tenantId: number, personaId: number, fileType: string): Promise<boolean> {
  const result = await db.execute(sql`
    DELETE FROM personality_files 
    WHERE tenant_id = ${tenantId} AND persona_id = ${personaId} AND file_type = ${fileType}
  `);
  return ((result as any).rowCount || 0) > 0;
}

export async function buildPersonalityContext(tenantId: number, personaId: number): Promise<string | null> {
  const files = await getPersonalityFiles(tenantId, personaId);
  const nonEmpty = files.filter(f => f.content.trim().length > 0);
  if (nonEmpty.length === 0) return null;

  const sections: string[] = [];
  for (const file of nonEmpty) {
    sections.push(`### ${file.fileType}.md\n${file.content.trim()}`);
  }
  return `## PERSONALITY FILES (tenant-specific customization)\n${sections.join("\n\n")}`;
}
