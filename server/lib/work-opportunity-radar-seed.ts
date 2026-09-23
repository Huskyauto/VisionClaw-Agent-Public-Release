import { sql } from "drizzle-orm";
import { db } from "../db";
import { ADMIN_TENANT_ID } from "../tenant-constants";

const PROJECT_NAME = "VisionClaw Work Opportunity Radar";
const DESCRIPTION =
  "Agent-originated project for finding evidence-backed sources of paid work VisionClaw can fulfill. Advisory only: no outreach, building, publishing, or payment without owner approval.";
const TAGS = ["agent-originated", "money-opportunity", "opportunity-sourcing", "revenue-research"];
const FILE_PATH = "data/money-opportunities/agent-originated/2026-09-21-work-opportunity-source-channels.md";
const NOTE =
  "Recommended first experiment: select one local industry, inspect 20 businesses using public evidence, rank the five clearest problems, prepare one sample audit, and seek one owner or agency conversation before building more software.";
const COMPASS_ENTRIES = [
  {
    id: "radar-goal",
    category: "goal",
    statement: "Find evidence-backed sources of paid work that VisionClaw can fulfill with capabilities that already exist.",
    provenance: "agent_inferred",
    confidence: 1,
    status: "confirmed",
  },
  {
    id: "radar-first-test",
    category: "desired_outcome",
    statement: "Run one bounded 20-business Local AI Trust and Lead-Loss Scan, prepare one sample audit, and obtain one real owner or agency conversation.",
    provenance: "agent_inferred",
    confidence: 1,
    status: "confirmed",
  },
  {
    id: "radar-done",
    category: "definition_of_done",
    statement: "A buyer commits to a conversation, pilot, or payment before additional software is built.",
    provenance: "agent_inferred",
    confidence: 1,
    status: "confirmed",
  },
  {
    id: "radar-guardrail",
    category: "constraint",
    statement: "No prospect contact, publication, purchasing, payment collection, or fulfillment starts without Bob's approval.",
    provenance: "agent_inferred",
    confidence: 1,
    status: "confirmed",
  },
  {
    id: "radar-data",
    category: "guiding_principle",
    statement: "Use only necessary public evidence, respect source terms, minimize retained data, and keep employment-related analysis focused on tasks and processes rather than workers.",
    provenance: "agent_inferred",
    confidence: 1,
    status: "confirmed",
  },
];

export type WorkOpportunityRadarSeedResult = {
  projectId: number | null;
  created: boolean;
  noteCreated: boolean;
  filePointerCreated: boolean;
  compassCreated: boolean;
  skippedDueToConcurrentSeed: boolean;
};

export async function seedWorkOpportunityRadar(
  database: Pick<typeof db, "transaction"> = db,
): Promise<WorkOpportunityRadarSeedResult> {
  return database.transaction(async (tx) => {
    const lockResult = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${PROJECT_NAME})) AS acquired`,
    );
    const lock = ((lockResult as any).rows || lockResult)[0];
    if (lock?.acquired !== true && lock?.acquired !== "t") {
      return {
        projectId: null,
        created: false,
        noteCreated: false,
        filePointerCreated: false,
        compassCreated: false,
        skippedDueToConcurrentSeed: true,
      };
    }

    const tenantResult = await tx.execute(
      sql`SELECT id FROM tenants WHERE id = ${ADMIN_TENANT_ID} LIMIT 1`,
    );
    if (!((tenantResult as any).rows || tenantResult)[0]?.id) {
      throw new Error(`Refusing to seed Work Opportunity Radar: owner tenant ${ADMIN_TENANT_ID} does not exist`);
    }

    const existingResult = await tx.execute(sql`
      SELECT id FROM projects
      WHERE tenant_id = ${ADMIN_TENANT_ID} AND name = ${PROJECT_NAME}
      ORDER BY id
    `);
    const existing = (existingResult as any).rows || existingResult;
    if (existing.length > 1) {
      throw new Error("Refusing to seed Work Opportunity Radar: duplicate owner projects already exist");
    }

    let projectId = Number(existing[0]?.id);
    let created = false;
    if (!projectId) {
      const inserted = await tx.execute(sql`
        INSERT INTO projects (name, description, status, customer_name, customer_email, tags, metadata, tenant_id, current_state)
        VALUES (
          ${PROJECT_NAME}, ${DESCRIPTION}, 'active', NULL, NULL,
          ${`{${TAGS.map((tag) => `"${tag}"`).join(",")}}`}::text[],
          ${JSON.stringify({
            origin: "replit-agent",
            status: "ranked",
            authority: "advisory-only",
            originFile: FILE_PATH,
            recommendedExperiment: "20-business Local AI Trust and Lead-Loss Scan",
          })}::jsonb,
          ${ADMIN_TENANT_ID},
          'Ranked source channels documented. Next decision: choose one local industry for a bounded 20-business public-evidence scan.'
        )
        RETURNING id
      `);
      projectId = Number(((inserted as any).rows || inserted)[0]?.id);
      if (!projectId) throw new Error("Work Opportunity Radar project insert returned no id");
      created = true;
    }

    const noteResult = await tx.execute(sql`
      INSERT INTO project_notes (project_id, note, author)
      SELECT ${projectId}, ${NOTE}, 'seed-work-opportunity-radar'
      WHERE NOT EXISTS (
        SELECT 1 FROM project_notes WHERE project_id = ${projectId} AND note = ${NOTE}
      )
      RETURNING id
    `);
    const noteCreated = (((noteResult as any).rows || noteResult).length ?? 0) === 1;

    const fileResult = await tx.execute(sql`
      INSERT INTO project_files (project_id, file_name, file_path, file_type, uploaded_by)
      SELECT ${projectId}, 'Work Opportunity Source Channels', ${FILE_PATH}, 'text/markdown', 'seed-work-opportunity-radar'
      WHERE NOT EXISTS (
        SELECT 1 FROM project_files WHERE project_id = ${projectId} AND file_path = ${FILE_PATH}
      )
      RETURNING id
    `);
    const filePointerCreated = (((fileResult as any).rows || fileResult).length ?? 0) === 1;

    const compassResult = await tx.execute(sql`
      INSERT INTO project_compasses (project_id, tenant_id, entries, revision)
      VALUES (${projectId}, ${ADMIN_TENANT_ID}, ${JSON.stringify(COMPASS_ENTRIES)}::jsonb, 1)
      ON CONFLICT (tenant_id, project_id) DO NOTHING
      RETURNING id
    `);
    const compassCreated = (((compassResult as any).rows || compassResult).length ?? 0) === 1;

    const verification = await tx.execute(sql`
      SELECT id, customer_name, customer_email
      FROM projects
      WHERE id = ${projectId} AND tenant_id = ${ADMIN_TENANT_ID}
    `);
    const verified = ((verification as any).rows || verification)[0];
    if (!verified || verified.customer_name !== null || verified.customer_email !== null) {
      throw new Error("Work Opportunity Radar verification failed");
    }

    return {
      projectId,
      created,
      noteCreated,
      filePointerCreated,
      compassCreated,
      skippedDueToConcurrentSeed: false,
    };
  });
}