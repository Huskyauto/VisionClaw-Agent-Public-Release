import { db } from "../db";
import { sql } from "drizzle-orm";
import {
  getRevenueWorkspace,
  type RevenueIdeaDefinition,
} from "./revenue-idea-catalog";
import { ADMIN_TENANT_ID } from "../tenant-constants";

const OWNER_TENANT_ID = ADMIN_TENANT_ID;
const WORKSPACE = getRevenueWorkspace("fable-5");

export type Fable5SeedResult = {
  parentProjectId: number | null;
  childProjectIds: number[];
  createdParent: boolean;
  createdChildren: number;
  skippedDueToConcurrentSeed: boolean;
};

type SqlExecutor = { execute: (query: any) => Promise<any> };

async function findProject(tx: SqlExecutor, name: string) {
  const result = await tx.execute(sql`
    SELECT id
    FROM projects
    WHERE tenant_id = ${OWNER_TENANT_ID} AND name = ${name}
    ORDER BY id
  `);
  return (result as any).rows || result;
}

async function insertProject(
  tx: SqlExecutor,
  name: string,
  description: string,
  tags: string[]
) {
  const tagLiteral = `{${tags.map((tag) => `"${tag}"`).join(",")}}`;
  const result = await tx.execute(sql`
    INSERT INTO projects (name, description, status, customer_name, customer_email, tags, tenant_id)
    VALUES (${name}, ${description}, 'active', NULL, NULL, ${tagLiteral}::text[], ${OWNER_TENANT_ID})
    RETURNING id
  `);
  const row = ((result as any).rows || result)[0];
  if (!row?.id) throw new Error(`Fable 5 project insert returned no id for ${name}`);
  return Number(row.id);
}

function childTags() {
  return ["revenue", "fable-5", "fable-5-idea", "owner-only"];
}

export async function seedFable5Workspace(
  database: Pick<typeof db, "transaction"> = db
): Promise<Fable5SeedResult> {
  return database.transaction(async (tx) => {
    const lockResult = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${WORKSPACE.parentProjectName})) AS acquired`
    );
    const lock = ((lockResult as any).rows || lockResult)[0];
    if (lock?.acquired !== true && lock?.acquired !== "t") {
      return {
        parentProjectId: null,
        childProjectIds: [],
        createdParent: false,
        createdChildren: 0,
        skippedDueToConcurrentSeed: true,
      };
    }

    const ownerResult = await tx.execute(sql`
      SELECT id FROM tenants WHERE id = ${OWNER_TENANT_ID} LIMIT 1
    `);
    const owner = ((ownerResult as any).rows || ownerResult)[0];
    if (!owner?.id) {
      throw new Error(`Refusing to seed Fable 5: canonical owner tenant ${OWNER_TENANT_ID} does not exist`);
    }

    const parentRows = await findProject(tx, WORKSPACE.parentProjectName);
    if (parentRows.length > 1) {
      throw new Error("Refusing to seed Fable 5: duplicate Fable 5 parent projects already exist");
    }

    let parentProjectId: number;
    let createdParent = false;
    if (parentRows[0]?.id) {
      parentProjectId = Number(parentRows[0].id);
    } else {
      parentProjectId = await insertProject(
        tx,
        WORKSPACE.parentProjectName,
        WORKSPACE.parentProjectDescription,
        WORKSPACE.parentProjectTags
      );
      createdParent = true;
    }

    const childProjectIds: number[] = [];
    let createdChildren = 0;
    for (const idea of WORKSPACE.ideas) {
      const rows = await findProject(tx, idea.linkedProjectName || idea.title);
      if (rows.length > 1) {
        throw new Error(`Refusing to seed Fable 5: duplicate child project "${idea.linkedProjectName || idea.title}" already exists`);
      }
      if (rows[0]?.id) {
        childProjectIds.push(Number(rows[0].id));
      } else {
        childProjectIds.push(await insertProject(tx, idea.linkedProjectName || idea.title, idea.summary, childTags()));
        createdChildren++;
      }
    }

    return {
      parentProjectId,
      childProjectIds,
      createdParent,
      createdChildren,
      skippedDueToConcurrentSeed: false,
    };
  });
}

export function fableIdeaProjectName(idea: RevenueIdeaDefinition): string {
  return idea.linkedProjectName || idea.title;
}