import { db } from "../db";
import { sql } from "drizzle-orm";
import { ADMIN_TENANT_ID } from "../tenant-constants";

const OWNER_TENANT_ID = ADMIN_TENANT_ID;
const PROJECT_NAME = "Customer Revenue Launchpad";
const DESCRIPTION =
  "Owner-only workspace for five evidence-driven customer offers. Manual validation only; no outreach, customer records, payments, or automatic fulfillment.";
const TAGS = ["revenue", "launchpad", "owner-only", "manual-validation"];
const POINTER_NOTE =
  "Workspace created in project-assets/customer-revenue-launchpad. Five offer briefs, the first-proof runbook, and the report-only learning ledger are ready for owner review. This setup does not send outreach, create customers, collect payment, or start fulfillment.";

export type CustomerRevenueLaunchpadSeedResult = {
  projectId: number | null;
  created: boolean;
  pointerNoteCreated: boolean;
  skippedDueToConcurrentSeed: boolean;
};

/**
 * Idempotently provisions the owner-only Customer Revenue Launchpad project.
 * It creates no contacts, messages, payments, delivery work, or customer PII.
 */
export async function seedCustomerRevenueLaunchpad(
  database: Pick<typeof db, "transaction"> = db
): Promise<CustomerRevenueLaunchpadSeedResult> {
  return database.transaction(async (tx) => {
    // Projects has no tenant/name uniqueness constraint. Serialize this exact
    // seed so concurrent runs cannot each create a matching owner workspace.
    // Do not delay application boot when a sibling instance already owns it.
    const lockResult = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${PROJECT_NAME})) AS acquired`
    );
    const lock = ((lockResult as any).rows || lockResult)[0];
    if (lock?.acquired !== true && lock?.acquired !== "t") {
      return {
        projectId: null,
        created: false,
        pointerNoteCreated: false,
        skippedDueToConcurrentSeed: true,
      };
    }

    const ownerResult = await tx.execute(sql`
      SELECT id
      FROM tenants
      WHERE id = ${OWNER_TENANT_ID}
      LIMIT 1
    `);
    const owner = ((ownerResult as any).rows || ownerResult)[0];
    if (!owner?.id) {
      throw new Error(`Refusing to seed launchpad: canonical owner tenant ${OWNER_TENANT_ID} does not exist`);
    }

    const existingResult = await tx.execute(sql`
      SELECT id
      FROM projects
      WHERE tenant_id = ${OWNER_TENANT_ID} AND name = ${PROJECT_NAME}
      ORDER BY id
    `);
    const existingRows = (existingResult as any).rows || existingResult;
    if (existingRows.length > 1) {
      throw new Error("Refusing to seed launchpad: duplicate owner projects already exist");
    }

    let projectId: number;
    let created = false;
    if (existingRows[0]?.id) {
      projectId = Number(existingRows[0].id);
    } else {
      const inserted = await tx.execute(sql`
        INSERT INTO projects (name, description, status, customer_name, customer_email, tags, tenant_id)
        VALUES (
          ${PROJECT_NAME},
          ${DESCRIPTION},
          'active',
          NULL,
          NULL,
          ${`{${TAGS.map((tag) => `"${tag}"`).join(",")}}`}::text[],
          ${OWNER_TENANT_ID}
        )
        RETURNING id
      `);
      const row = ((inserted as any).rows || inserted)[0];
      if (!row?.id) throw new Error("Launchpad project insert returned no id");
      projectId = Number(row.id);
      created = true;
    }

    const existingNotesResult = await tx.execute(sql`
      SELECT id
      FROM project_notes
      WHERE project_id = ${projectId} AND note = ${POINTER_NOTE}
      ORDER BY id
    `);
    const existingNotes = (existingNotesResult as any).rows || existingNotesResult;
    if (existingNotes.length > 1) {
      throw new Error("Refusing to seed launchpad: duplicate pointer notes already exist");
    }

    const pointerNoteCreated = existingNotes.length === 0;
    if (pointerNoteCreated) {
      await tx.execute(sql`
        INSERT INTO project_notes (project_id, note, author)
        VALUES (${projectId}, ${POINTER_NOTE}, 'seed-customer-revenue-launchpad')
      `);
    }

    const verification = await tx.execute(sql`
      SELECT id, customer_name, customer_email
      FROM projects
      WHERE id = ${projectId} AND tenant_id = ${OWNER_TENANT_ID}
    `);
    const verified = ((verification as any).rows || verification)[0];
    if (!verified || verified.customer_name !== null || verified.customer_email !== null) {
      throw new Error("Launchpad verification failed: missing project or customer fields are not NULL");
    }

    return { projectId, created, pointerNoteCreated, skippedDueToConcurrentSeed: false };
  });
}